import Foundation
import Observation

// The odds for the open game page, and nothing else: no list, tile, menu bar
// title, notification or docked bar ever asks. Discovery (a league's day,
// cached, and the game's market) runs when the page opens, because it decides
// whether the chart exists at all; the price history and the live market
// channel run only while the chart is on screen. One market is tracked at a
// time, app-wide.

// MARK: - Directory

/// The day's listings and the matches made from them, shared by every game
/// page: a league's day is fetched once per 10 minutes, a game's market once
/// per session (a game with no market is asked again after 10 minutes: one
/// can be listed later).
@MainActor
final class OddsDirectory {
    static let shared = OddsDirectory()

    private static let listingLife: TimeInterval = 600
    private static let missLife: TimeInterval = 600

    private var listings: [String: (at: Date, events: [PolyEvent])] = [:]
    private var listingTasks: [String: Task<[PolyEvent]?, Never>] = [:]
    private var matches: [String: (at: Date, market: OddsMarket?)] = [:]
    private var matchTasks: [String: Task<OddsMarket?, Never>] = [:]

    /// A league's day, from memory while it's fresh. Two pages asking at once share one request.
    func listing(series: Int, day: String) async -> [PolyEvent]? {
        let key = "\(series)|\(day)"
        if let cached = listings[key], Date.now.timeIntervalSince(cached.at) < Self.listingLife { return cached.events }
        if let running = listingTasks[key] { return await running.value }
        let task = Task<[PolyEvent]?, Never> {
            guard let url = Polymarket.listingURL(series: series, day: day), let json = try? await JSON.fetch(url) else { return nil }
            return Polymarket.events(json)
        }
        listingTasks[key] = task
        let events = await task.value
        listingTasks[key] = nil
        if let events { listings[key] = (.now, events) }
        return events
    }

    /// Warms the game's day while the page loads its summary (the names to match by come with it).
    func prefetch(_ event: Event) {
        guard let series = OddsLeague.series(for: event.ref), matches[event.id] == nil else { return }
        Task { _ = await listing(series: series, day: OddsLeague.day(event.start)) }
    }

    /// The game's market, or nil when Polymarket has none we can be sure of.
    /// A live game's is re-read every 10 minutes (one small request) for the
    /// money traded, which mostly happens during the game.
    func market(for event: Event, baseline: OddsBaseline) async -> OddsMarket? {
        if let cached = matches[event.id], cached.market != nil || Date.now.timeIntervalSince(cached.at) < Self.missLife {
            guard let market = cached.market, event.state == .live, Date.now.timeIntervalSince(cached.at) >= Self.listingLife
            else { return cached.market }
            let next = await refreshed(market) ?? market
            matches[event.id] = (.now, next)
            return next
        }
        if let running = matchTasks[event.id] { return await running.value }
        let task = Task<OddsMarket?, Never> { await self.find(event, baseline: baseline) }
        matchTasks[event.id] = task
        let market = await task.value
        matchTasks[event.id] = nil
        matches[event.id] = (.now, market)
        return market
    }

    /// The same market's latest volume and state.
    private func refreshed(_ market: OddsMarket) async -> OddsMarket? {
        for closed in [market.closed, !market.closed] {
            guard let url = Polymarket.marketsURL(slugs: market.slugs, closed: closed), let json = try? await JSON.fetch(url) else { continue }
            let lines = json.array.filter { $0["sportsMarketType"].string == "moneyline" }
            guard !lines.isEmpty else { continue }
            var next = market
            next.volume = lines.compactMap { $0["volume"].double }.reduce(0, +)
            next.closed = lines.contains { $0["closed"].bool == true }
            return next
        }
        return nil
    }

    private func find(_ event: Event, baseline: OddsBaseline) async -> OddsMarket? {
        guard let series = OddsLeague.series(for: event.ref), !baseline.topNames.isEmpty, !baseline.bottomNames.isEmpty else { return nil }
        for day in OddsLeague.days(around: event.start) {
            guard let listing = await listing(series: series, day: day),
                  let (found, _) = OddsMatch.event(in: listing, start: event.start, top: baseline.topNames, bottom: baseline.bottomNames)
            else { continue }
            // A finished game's market is closed; ask the likelier state first.
            for closed in event.state == .final ? [true, false] : [false, true] {
                guard let url = Polymarket.marketsURL(found, closed: closed), let json = try? await JSON.fetch(url) else { continue }
                if let market = Polymarket.market(json.array, event: found, start: found.start,
                                                  top: baseline.topNames, bottom: baseline.bottomNames) {
                    return market
                }
            }
            // The slugs didn't resolve: the whole event, once.
            if let url = Polymarket.eventURL(found), let json = try? await JSON.fetch(url) {
                return Polymarket.market(json["markets"].array, event: found, start: found.start,
                                         top: baseline.topNames, bottom: baseline.bottomNames)
            }
            return nil
        }
        return nil
    }
}

// MARK: - Feed

/// The open page's market: its history, then the live market channel (or, if
/// the socket can't connect, the midpoint every 15 s). Book updates apply at
/// once; a point is published at most every 0.5 s, and only when the
/// displayed price moved, so the chart redraws on change and nothing else.
@MainActor
@Observable
final class OddsFeed {
    enum Connection: Equatable { case idle, loading, live, polling }

    /// The game's market, once found.
    private(set) var market: OddsMarket?
    /// Each outcome's prices, oldest first, compacted (US: the top team's only).
    private(set) var series: [OddsMarket.Outcome: [OddsPoint]] = [:]
    /// Bumped with every change to `series`: views compare this, not the arrays.
    private(set) var revision = 0
    /// When the market last said anything (written at most once a second).
    private(set) var heard: Date?
    private(set) var connection = Connection.idle

    /// The tracker running now, app-wide: starting another stops it.
    private static weak var active: OddsFeed?
    @ObservationIgnored private var event: Event?
    @ObservationIgnored private var quotes: [String: OddsQuote] = [:]
    @ObservationIgnored private var tracking: Task<Void, Never>?
    @ObservationIgnored private var polling: Task<Void, Never>?
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var flushing: Task<Void, Never>?
    @ObservationIgnored private var visibility: Task<Void, Never>?
    @ObservationIgnored private var lastFlush = Date.distantPast
    @ObservationIgnored private var lastHeard: Date?
    @ObservationIgnored private var discovered: String?
    /// The market channel's own session (the shared HTTP one is for requests).
    private static let session = URLSession(configuration: .ephemeral)

    /// Coalescing: at most one published point per outcome this often.
    static let flushInterval: TimeInterval = 0.5
    static let pingInterval: Duration = .seconds(10)
    static let pollInterval: Duration = .seconds(15)
    static let backoff: [Double] = [1, 2, 4, 8, 16, 30]
    /// How long the chart must be on (off) screen before tracking starts (stops).
    static let showDelay: Duration = .milliseconds(250)
    static let hideDelay: Duration = .seconds(2)

    var isTracking: Bool { tracking != nil }

    // MARK: Discovery

    /// The game's market (cached app-wide), or nil: Odds off in Settings, or a
    /// league Polymarket doesn't list (neither asks anything), or no market
    /// we can be sure of.
    func find(_ event: Event, baseline: OddsBaseline?, enabled: Bool) async -> OddsMarket? {
        guard enabled, let baseline, OddsLeague.series(for: event.ref) != nil else { return nil }
        if discovered == event.id, let market { return market }
        let found = await OddsDirectory.shared.market(for: event, baseline: baseline)
        discovered = event.id
        return found
    }

    /// Takes the market found (the page animates its arrival); nil forgets it.
    func adopt(_ found: OddsMarket?) {
        guard found != market else { return }
        guard let found else { return reset() }
        // The same market, re-read (its volume, closed): keep everything else.
        if let market, market.slug == found.slug, market.tokens == found.tokens {
            self.market = found
            return
        }
        stop()
        market = found
        series = [:]
        quotes = [:]
        revision += 1
    }

    // MARK: On screen

    /// The chart came on (or went off) screen: tracking follows after a beat,
    /// so scrolling past doesn't open and close connections.
    func show(_ visible: Bool, event: Event) {
        visibility?.cancel()
        let moved = self.event.map { $0.state != event.state } ?? false
        self.event = event
        if visible {
            // Already tracking (a pending stop just got cancelled): only a new state restarts it.
            if isTracking {
                if moved { restart(event) }
                return
            }
            visibility = Task { [weak self] in
                try? await Task.sleep(for: Self.showDelay)
                guard !Task.isCancelled else { return }
                self?.start()
            }
        } else if isTracking {
            visibility = Task { [weak self] in
                try? await Task.sleep(for: Self.hideDelay)
                guard !Task.isCancelled else { return }
                self?.stop()
            }
        }
    }

    /// The event changed state (live to final): restart with the new rules.
    func restart(_ event: Event) {
        self.event = event
        guard isTracking else { return }
        stop()
        start()
    }

    /// Stops everything (page closed, panel hidden, Odds turned off). The
    /// series stays, so coming back fetches only what it missed.
    func stop() {
        visibility?.cancel()
        tracking?.cancel(); tracking = nil
        polling?.cancel(); polling = nil
        ticker?.cancel(); ticker = nil
        flushing?.cancel(); flushing = nil
        if connection != .idle { connection = .idle }
        if Self.active === self { Self.active = nil }
    }

    /// Forgets the market too (Odds turned off).
    func reset() {
        stop()
        market = nil
        series = [:]
        quotes = [:]
        discovered = nil
        revision += 1
    }

    private func start() {
        guard let market, let event, tracking == nil else { return }
        if let other = Self.active, other !== self { other.stop() }
        Self.active = self
        connection = .loading
        tracking = Task { [weak self] in
            await self?.loadHistory(market, event: event)
            // A finished game's market has nothing more to say.
            guard event.state != .final, !market.closed, !Task.isCancelled else {
                self?.connection = .idle
                return
            }
            self?.startTicker()
            await self?.listen(market)
        }
    }

    // MARK: History

    private func loadHistory(_ market: OddsMarket, event: Event) async {
        let now = Date.now
        let scheduled = event.state == .scheduled
        for token in market.tokens {
            let have = series[token.outcome] ?? []
            // Fetched before: only the tail since its last point.
            let from = have.last?.t ?? (scheduled ? now - 86_400 : min(market.start, event.start) - 1800)
            let to = event.state == .final ? min(now, max(from, event.start) + 6 * 3600) : now
            guard to > from + 1, let url = Polymarket.historyURL(token: token.id, from: from, to: to),
                  let json = try? await JSON.fetch(url), !Task.isCancelled else { continue }
            let points = Polymarket.history(json)
            guard !points.isEmpty else { continue }
            series[token.outcome] = OddsSeries.compact(have.isEmpty ? points : have + points.filter { $0.t > (have.last?.t ?? .distantPast) },
                                                       now: now)
        }
        revision += 1
    }

    // MARK: Live

    private func listen(_ market: OddsMarket) async {
        let ids = market.tokens.map(\.id)
        var failures = 0
        while !Task.isCancelled {
            let socket = Self.session.webSocketTask(with: Polymarket.socket)
            socket.resume()
            let pinger = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: Self.pingInterval)
                    try? await socket.send(.string("PING"))
                }
            }
            // Leaving closes the socket at once (a receive waiting on a quiet market would otherwise hold it).
            await withTaskCancellationHandler {
                do {
                    let subscribe = try JSONSerialization.data(withJSONObject: ["assets_ids": ids, "type": "market"])
                    try await socket.send(.string(String(decoding: subscribe, as: UTF8.self)))
                    var first = true
                    while !Task.isCancelled {
                        let message = try await socket.receive()
                        guard case let .string(text) = message, text != "PONG" else { continue }
                        if first {
                            // Connected: anything missed while away comes from the history's tail.
                            first = false
                            failures = 0
                            polling?.cancel(); polling = nil
                            connection = .live
                            if let event { await loadHistory(market, event: event) }
                        }
                        receive(OddsFrame.parse(text))
                    }
                } catch {}
            } onCancel: {
                socket.cancel(with: .goingAway, reason: nil)
            }
            pinger.cancel()
            socket.cancel(with: .goingAway, reason: nil)
            guard !Task.isCancelled else { return }
            failures += 1
            // Two failed connects in a row: poll until the socket is back.
            if failures >= 2, polling == nil { startPolling(market) }
            try? await Task.sleep(for: .seconds(Self.backoff[min(failures - 1, Self.backoff.count - 1)]))
        }
    }

    private func receive(_ updates: [(asset: String, update: OddsFrame.Update)]) {
        guard let market, !updates.isEmpty else { return }
        var touched = false
        for (asset, update) in updates where market.tokens.contains(where: { $0.id == asset }) {
            OddsFrame.apply(update, to: &quotes[asset, default: OddsQuote()])
            touched = true
        }
        guard touched else { return }
        lastHeard = .now
        scheduleFlush()
    }

    /// Publishes now if the last publish was long enough ago, else once it is.
    private func scheduleFlush() {
        guard flushing == nil else { return }
        let wait = max(0, Self.flushInterval - Date.now.timeIntervalSince(lastFlush))
        flushing = Task { [weak self] in
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    private func flush() {
        flushing = nil
        lastFlush = .now
        guard let market else { return }
        var changed = false
        for token in market.tokens {
            guard let price = quotes[token.id]?.displayed else { continue }
            changed = publish(price, for: token.outcome, at: .now) || changed
        }
        if changed { revision += 1 }
        noteHeard()
    }

    /// Adds a point when the price moved at least a tenth of a point. A long
    /// quiet spell is kept as the flat stretch it was (a hold point just
    /// before the move), not a diagonal across it.
    @discardableResult
    private func publish(_ price: Double, for outcome: OddsMarket.Outcome, at t: Date) -> Bool {
        var points = series[outcome] ?? []
        if let last = points.last {
            guard abs(price - last.p) >= 0.001, t > last.t else { return false }
            if t.timeIntervalSince(last.t) > 10 { points.append(OddsPoint(t: t - 1, p: last.p)) }
        }
        points.append(OddsPoint(t: t, p: price))
        series[outcome] = points.count > OddsSeries.cap + 60 ? OddsSeries.compact(points, now: t) : points
        return true
    }

    private func noteHeard() {
        guard let lastHeard else { return }
        if heard.map({ lastHeard.timeIntervalSince($0) >= 1 }) ?? true { heard = lastHeard }
    }

    /// Once a minute while live: a quiet market's line still reaches now.
    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled, let self else { return }
                let now = Date.now
                var moved = false
                for (outcome, points) in self.series {
                    guard let last = points.last, now.timeIntervalSince(last.t) >= 50 else { continue }
                    self.series[outcome] = points + [OddsPoint(t: now, p: last.p)]
                    moved = true
                }
                if moved { self.revision += 1 }
            }
        }
    }

    private func startPolling(_ market: OddsMarket) {
        polling = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                if self.connection != .live { self.connection = .polling }
                var changed = false
                for token in market.tokens {
                    guard let url = Polymarket.midpointURL(token: token.id), let json = try? await JSON.fetch(url),
                          let mid = Polymarket.midpoint(json), !Task.isCancelled else { continue }
                    changed = self.publish(mid, for: token.outcome, at: .now) || changed
                    self.lastHeard = .now
                }
                if changed { self.revision += 1 }
                self.noteHeard()
                try? await Task.sleep(for: Self.pollInterval)
            }
        }
    }

    // MARK: Reading

    /// The newest split (US: the top team and its complement; soccer: three, normalized).
    var latest: OddsSplit? {
        guard let market else { return nil }
        if market.threeWay {
            guard let t = series[.top]?.last?.p, let d = series[.draw]?.last?.p, let b = series[.bottom]?.last?.p else {
                return market.snapshot
            }
            return OddsSeries.normalized(top: t, draw: d, bottom: b)
        }
        return series[.top]?.last.map { OddsSplit(top: $0.p, draw: nil, bottom: 1 - $0.p) } ?? market.snapshot
    }

    #if DEBUG
    /// The performance check: a tick as the market channel would publish it.
    func simulate(_ price: Double, outcome: OddsMarket.Outcome = .top) {
        if publish(price, for: outcome, at: .now) { revision += 1 }
        lastHeard = .now
        noteHeard()
    }

    /// The render harness: a market and its series without the network.
    func preview(market: OddsMarket, series: [OddsMarket.Outcome: [OddsPoint]], heard: Date? = nil, connection: Connection = .live) {
        self.market = market
        self.series = series
        self.heard = heard
        self.connection = connection
        revision += 1
    }
    #endif
}
