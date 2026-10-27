import CryptoKit
import Foundation

/// Parsed schedule responses, kept in memory and on disk (the Caches folder),
/// so reopening a schedule costs nothing until its data goes stale.
///
/// - Fresh entries (younger than the caller's TTL) come back without a request.
/// - Stale entries revalidate with `If-None-Match` where the source sends an
///   ETag (IFSC, bo3.gg); a 304 just refreshes the entry.
/// - Concurrent requests for one URL share a single fetch, and at most six
///   requests per host are in flight (a polite burst, like the MLB bracket).
/// - A failed request falls back to the stale entry and backs off (30 s,
///   2 min, 10 min) before trying that URL again.
actor ScheduleCache {
    static let shared = ScheduleCache()

    /// Bump when a parser changes, so old disk entries are ignored.
    /// 3: items carry results (`ScheduleItem.result`).
    /// 4: climbing categories carry their IDs, round links and podium athletes
    /// (a 304 would otherwise keep serving a detail parsed without them).
    static let parserVersion = 4
    /// Results add parsed past boards (an EPL month is about 60 KB).
    static let diskLimit = 12_000_000

    struct Fetched<T: Sendable>: Sendable {
        let value: T
        let fetchedAt: Date
        /// Served from an entry the network couldn't refresh.
        let stale: Bool
    }

    private struct Stored<T: Codable>: Codable {
        let fetchedAt: Date
        let etag: String?
        let parser: Int
        let value: T
    }

    private struct Entry {
        var fetchedAt: Date
        var etag: String?
        var value: Any
    }

    private var memory: [String: Entry] = [:]
    private var inFlight: [String: Task<Entry, Error>] = [:]
    private var backoff: [String: (failures: Int, until: Date)] = [:]
    private var running: [String: Int] = [:]
    private var waiting: [String: [CheckedContinuation<Void, Never>]] = [:]
    private let directory: URL?

    init(directory: URL? = ScheduleCache.defaultDirectory) {
        self.directory = directory
        if let directory { try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        if let directory, directory == Self.defaultDirectory {
            // Off the caller's thread: the first use is often the main thread.
            Task.detached(priority: .background) { Self.removeOldVersions(besides: directory) }
        }
    }

    /// Entries from an older parser live in their own folder ("v1"); nothing
    /// reads them again, so they go.
    nonisolated private static func removeOldVersions(besides current: URL) {
        let parent = current.deletingLastPathComponent()
        let siblings = (try? FileManager.default.contentsOfDirectory(at: parent, includingPropertiesForKeys: nil)) ?? []
        for folder in siblings where folder.lastPathComponent.hasPrefix("v") && folder.lastPathComponent != current.lastPathComponent {
            try? FileManager.default.removeItem(at: folder)
        }
    }

    static var defaultDirectory: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent("io.github.lame-o.Scoreline/Schedules/v\(parserVersion)", isDirectory: true)
    }

    /// The value for `url`, fetched and parsed if what's cached is older than `ttl`.
    func get<T: Codable & Sendable>(_ url: URL, headers: [String: String] = [:], ttl: TimeInterval,
                                    parse: @escaping @Sendable (Data) throws -> T) async throws -> Fetched<T> {
        let key = url.absoluteString
        let now = Date()
        if memory[key] == nil, let disk: Stored<T> = readDisk(key) {
            memory[key] = Entry(fetchedAt: disk.fetchedAt, etag: disk.etag, value: disk.value)
        }
        let cached = memory[key]
        if let cached, let value = cached.value as? T, now.timeIntervalSince(cached.fetchedAt) < ttl {
            return Fetched(value: value, fetchedAt: cached.fetchedAt, stale: false)
        }
        if let wait = backoff[key], wait.until > now {
            if let cached, let value = cached.value as? T { return Fetched(value: value, fetchedAt: cached.fetchedAt, stale: true) }
            throw URLError(.cannotLoadFromNetwork)
        }

        let task: Task<Entry, Error>
        if let existing = inFlight[key] {
            task = existing
        } else {
            let etag = cached?.etag
            let host = url.host() ?? ""
            // Detached: parsing a large response shouldn't hold up the cache.
            task = Task.detached(priority: .utility) {
                await self.acquire(host)
                defer { Task { await self.release(host) } }
                var request = URLRequest(url: url)
                headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
                if let etag, cached != nil { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
                let (data, response) = try await HTTP.session.data(for: request)
                let http = response as? HTTPURLResponse
                if http?.statusCode == 304, let cached { return Entry(fetchedAt: .now, etag: etag, value: cached.value) }
                guard let http, (200..<300).contains(http.statusCode) else {
                    Log.network.error("HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0) from \(url.host() ?? "", privacy: .public)\(url.path(), privacy: .public)")
                    throw URLError(.badServerResponse)
                }
                let value = try parse(data)
                return Entry(fetchedAt: .now, etag: http.value(forHTTPHeaderField: "ETag"), value: value)
            }
            inFlight[key] = task
        }

        do {
            let entry = try await task.value
            inFlight[key] = nil
            backoff[key] = nil
            memory[key] = entry
            guard let value = entry.value as? T else { throw URLError(.cannotDecodeContentData) }
            writeDisk(key, Stored(fetchedAt: entry.fetchedAt, etag: entry.etag, parser: Self.parserVersion, value: value))
            return Fetched(value: value, fetchedAt: entry.fetchedAt, stale: false)
        } catch {
            inFlight[key] = nil
            let failures = (backoff[key]?.failures ?? 0) + 1
            backoff[key] = (failures, Date().addingTimeInterval([30, 120, 600][min(failures, 3) - 1]))
            if let cached, let value = cached.value as? T { return Fetched(value: value, fetchedAt: cached.fetchedAt, stale: true) }
            throw error
        }
    }

    /// Whatever is saved for `url`, however old, without touching the network:
    /// a page paints this first, then replaces it with what's fresh.
    func peek<T: Codable & Sendable>(_ url: URL, as type: T.Type = T.self) -> Fetched<T>? {
        let key = url.absoluteString
        if memory[key] == nil, let disk: Stored<T> = readDisk(key) {
            memory[key] = Entry(fetchedAt: disk.fetchedAt, etag: disk.etag, value: disk.value)
        }
        guard let entry = memory[key], let value = entry.value as? T else { return nil }
        return Fetched(value: value, fetchedAt: entry.fetchedAt, stale: true)
    }

    /// Forget one URL (a followed team's game just ended: its next game is news).
    func invalidate(_ url: URL) {
        let key = url.absoluteString
        memory[key] = nil
        backoff[key] = nil
        if let file = file(for: key) { try? FileManager.default.removeItem(at: file) }
    }

    // MARK: Per-host gate

    private func acquire(_ host: String) async {
        if running[host, default: 0] < 6 {
            running[host, default: 0] += 1
            return
        }
        await withCheckedContinuation { waiting[host, default: []].append($0) }
    }

    private func release(_ host: String) {
        if var queue = waiting[host], !queue.isEmpty {
            let next = queue.removeFirst()
            waiting[host] = queue
            next.resume()
        } else {
            running[host] = max(running[host, default: 1] - 1, 0)
        }
    }

    // MARK: Disk

    private func file(for key: String) -> URL? {
        guard let directory else { return nil }
        let name = SHA256.hash(data: Data(key.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name + ".json")
    }

    private func readDisk<T: Codable>(_ key: String) -> Stored<T>? {
        guard let file = file(for: key), let data = try? Data(contentsOf: file),
              let stored = try? JSONDecoder().decode(Stored<T>.self, from: data), stored.parser == Self.parserVersion
        else { return nil }
        return stored
    }

    private func writeDisk<T: Codable>(_ key: String, _ stored: Stored<T>) {
        guard let file = file(for: key), let data = try? JSONEncoder().encode(stored) else { return }
        try? data.write(to: file, options: .atomic)
        trimDisk()
    }

    /// Oldest files go first once the folder passes the limit.
    private func trimDisk() {
        guard let directory,
              let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
        else { return }
        let info = files.map { url -> (URL, Date, Int) in
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            return (url, values?.contentModificationDate ?? .distantPast, values?.fileSize ?? 0)
        }
        var total = info.reduce(0) { $0 + $1.2 }
        guard total > Self.diskLimit else { return }
        for (url, _, size) in info.sorted(by: { $0.1 < $1.1 }) where total > Self.diskLimit {
            try? FileManager.default.removeItem(at: url)
            total -= size
        }
    }
}
