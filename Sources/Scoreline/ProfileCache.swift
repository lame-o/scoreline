import CryptoKit
import Foundation

/// Raw responses for team and player pages, cached by URL: in memory, and on
/// disk across launches. Fresh within a TTL; after it, revalidated with the
/// ETag when the server sent one (bo3.gg, IFSC: 304s cost nothing) or fetched
/// again (ESPN sends none). Concurrent requests for one URL share a fetch; a
/// failed fetch returns the stale copy when there is one and backs off.
///
/// Values are kept as bytes and parsed by the caller off the main actor, so
/// the models don't need to be `Codable`. (When Schedules' `ScheduleCache`
/// lands, the two can fold together: hook P3 in the rosters spec.)
actor ProfileCache {
    static let shared = ProfileCache()

    struct Entry: Codable {
        var fetchedAt: Date
        var etag: String?
        var data: Data
    }

    private var memory: [URL: Entry] = [:]
    private var inFlight: [URL: Task<Data, Error>] = [:]
    private var failures: [URL: (until: Date, step: Int)] = [:]
    private let session: URLSession
    private let directory: URL?
    private let diskLimit: Int
    private var writesSincePrune = 0

    /// `directory` nil keeps everything in memory (tests).
    init(session: URLSession = HTTP.session, directory: URL? = ProfileCache.defaultDirectory, diskLimit: Int = 8 << 20) {
        self.session = session
        self.directory = directory
        self.diskLimit = diskLimit
        if let directory { try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
    }

    static var defaultDirectory: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Scoreline", isDirectory: true)
            .appendingPathComponent("Profiles/v1", isDirectory: true)
    }

    /// The response body for `url`, from cache when it's younger than `ttl`.
    func data(_ url: URL, headers: [String: String] = [:], ttl: TimeInterval, force: Bool = false) async throws -> Data {
        let cached = entry(for: url)
        if !force, let cached, Date().timeIntervalSince(cached.fetchedAt) < ttl { return cached.data }
        if let failure = failures[url], failure.until > .now, let cached { return cached.data }
        if let task = inFlight[url] { return try await task.value }

        let task = Task { [session] () throws -> Data in
            var request = URLRequest(url: url)
            headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
            if let etag = cached?.etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            if http.statusCode == 304, let cached { return self.store(url, data: cached.data, etag: cached.etag) }
            guard (200..<300).contains(http.statusCode) else {
                Log.network.error("HTTP \(http.statusCode) from \(url.host() ?? "", privacy: .public)\(url.path(), privacy: .public)")
                throw URLError(.badServerResponse)
            }
            return self.store(url, data: data, etag: http.value(forHTTPHeaderField: "ETag"))
        }
        inFlight[url] = task
        defer { inFlight[url] = nil }
        do {
            let data = try await task.value
            failures[url] = nil
            return data
        } catch {
            // Back off 30 s → 2 min → 10 min, serving what we have meanwhile.
            let step = min((failures[url]?.step ?? 0) + 1, 3)
            failures[url] = (Date().addingTimeInterval([30, 120, 600][step - 1]), step)
            if let cached { return cached.data }
            throw error
        }
    }

    /// Whether `url` is cached and younger than `ttl` (prefetch skips those).
    func isFresh(_ url: URL, ttl: TimeInterval) -> Bool {
        entry(for: url).map { Date().timeIntervalSince($0.fetchedAt) < ttl } ?? false
    }

    /// Drops a response so the next request refetches it (a game went final).
    func invalidate(_ url: URL) {
        memory[url] = nil
        if let file = file(for: url) { try? FileManager.default.removeItem(at: file) }
    }

    // MARK: Storage

    private func store(_ url: URL, data: Data, etag: String?) -> Data {
        let entry = Entry(fetchedAt: .now, etag: etag, data: data)
        memory[url] = entry
        if memory.count > 200, let oldest = memory.min(by: { $0.value.fetchedAt < $1.value.fetchedAt })?.key {
            memory[oldest] = nil
        }
        if let file = file(for: url), let encoded = try? PropertyListEncoder.binary.encode(entry) {
            try? encoded.write(to: file, options: .atomic)
            writesSincePrune += 1
            if writesSincePrune >= 20 { prune() }
        }
        return data
    }

    private func entry(for url: URL) -> Entry? {
        if let entry = memory[url] { return entry }
        guard let file = file(for: url), let data = try? Data(contentsOf: file),
              let entry = try? PropertyListDecoder().decode(Entry.self, from: data) else { return nil }
        memory[url] = entry
        return entry
    }

    private func file(for url: URL) -> URL? {
        guard let directory else { return nil }
        let hash = SHA256.hash(data: Data(url.absoluteString.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(hash + ".plist")
    }

    /// Least recently written first, down to the size limit.
    private func prune() {
        writesSincePrune = 0
        guard let directory, let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]) else { return }
        var items = files.compactMap { url -> (URL, Date, Int)? in
            guard let v = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]) else { return nil }
            return (url, v.contentModificationDate ?? .distantPast, v.fileSize ?? 0)
        }.sorted { $0.1 < $1.1 }
        var total = items.reduce(0) { $0 + $1.2 }
        while total > diskLimit, !items.isEmpty {
            let (url, _, size) = items.removeFirst()
            try? FileManager.default.removeItem(at: url)
            total -= size
        }
    }
}

private extension PropertyListEncoder {
    static var binary: PropertyListEncoder {
        let e = PropertyListEncoder()
        e.outputFormat = .binary
        return e
    }
}
