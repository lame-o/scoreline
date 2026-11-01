import AppKit
import SwiftUI
import Vision

// Native acceptance surface: production OddsSection and MatchTimelineSection,
// real captured ESPN/Polymarket histories, isolated preferences, HTTP blocked.
// The scripted hover/pin/step/clear calls use the same shared pointer as the
// graph controls. No mock chart or altered production geometry is rendered.
//
// Checks: two modules render; axis-label pixel centers agree; named teams and
// percentages survive narrow layouts; pin survives quote updates/hover; reset
// returns both readers; and presentation-clipped data contains no future tick,
// event, ESPN estimate or period endpoint. PNGs + OCR/geometry receipt are in
// build/odds-history-acceptance. This does not claim a measured frame rate.

private final class HistoryOffline: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}

private final class HistoryPanel: NSPanel { override var canBecomeKey: Bool { false } }
private struct SectionFrames: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}
@MainActor private final class HistoryProbe { var frames: [String: CGRect] = [:] }

private struct HistoryFixture {
    let name: String
    let sport: Sport
    let path: String
    let id: String
    let names: (top: String, bottom: String)
    let full: SpokenTeams
    let colors: (top: String, bottom: String)
    let start: Date
    let baseline: OddsBaseline
    let history: MatchHistory
    let market: OddsMarket
    let series: [OddsMarket.Outcome: [OddsPoint]]

    var selected: MatchHistory.Event {
        let scores = history.keyEvents.filter { $0.kind == .goal || $0.kind == .score }
        return scores[scores.count / 2]
    }

    func event(_ state: EventState = .final) -> Event {
        let top = Competitor(id: nil, name: full.top, abbreviation: names.top, score: nil, logo: nil, isWinner: false, color: colors.top)
        let bottom = Competitor(id: nil, name: full.bottom, abbreviation: names.bottom, score: nil, logo: nil, isWinner: false, color: colors.bottom)
        return Event(id: "espn-\(id)", content: .match(top: top, bottom: bottom), state: state, start: start,
                     detail: state == .final ? "Final" : "Live", caption: nil, link: nil, ref: .espn(path: path, id: id, sport: sport))
    }

    static func load(soccer: Bool) throws -> HistoryFixture {
        func json(_ name: String) throws -> JSON {
            JSON(data: try Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/odds/\(name).json")))
        }
        let sport: Sport = soccer ? .soccer : .basketball
        let summary = try json(soccer ? "espn-epl-401879252" : "espn-nba-401909888")
        let topID = soccer ? "360" : "9", bottomID = soccer ? "349" : "16"
        let baseline = OddsBaseline.parse(summary, sport: sport, topID: topID, bottomID: bottomID)
        let history = MatchHistory.parse(summary, sport: sport, topID: topID, bottomID: bottomID)
        let start = DateParser.parse(soccer ? "2026-10-25T14:00:00Z" : "2026-10-29T00:00:00Z")!
        let listing = Polymarket.events(try json(soccer ? "pm-epl-events-2026-10-25" : "pm-nba-events-2026-10-28"))
        guard let matched = OddsMatch.event(in: listing, start: start, top: baseline.topNames, bottom: baseline.bottomNames),
              let market = Polymarket.market(try json(soccer ? "pm-epl-mun-bou-markets" : "pm-nba-gsw-min-market").array,
                                              event: matched.0, start: start, top: baseline.topNames, bottom: baseline.bottomNames)
        else { throw NSError(domain: "OddsHistoryAcceptance", code: 1, userInfo: [NSLocalizedDescriptionKey: "Captured market did not match its game"]) }
        let raw = try json(soccer ? "pm-epl-mun-bou-history" : "pm-nba-gsw-min-history")
        var series: [OddsMarket.Outcome: [OddsPoint]] = [:]
        for token in market.tokens {
            series[token.outcome] = Polymarket.history(soccer ? JSON(["history": raw[token.id].raw ?? []]) : raw)
        }
        guard !history.keyEvents.isEmpty, !series.isEmpty else {
            throw NSError(domain: "OddsHistoryAcceptance", code: 2, userInfo: [NSLocalizedDescriptionKey: "Captured history is empty"])
        }
        return HistoryFixture(name: soccer ? "soccer" : "nba", sport: sport, path: soccer ? "soccer/eng.1" : "basketball/nba",
                              id: soccer ? "401879252" : "401909888", names: soccer ? ("MUN", "BOU") : ("GSW", "MIN"),
                              full: soccer ? SpokenTeams(top: "Manchester United", bottom: "Bournemouth")
                                           : SpokenTeams(top: "Golden State Warriors", bottom: "Minnesota Timberwolves"),
                              colors: soccer ? ("DA291C", "CF1F2D") : ("FFC72C", "0C2340"), start: start,
                              baseline: baseline, history: history, market: market, series: series)
    }
}

private struct HistorySurface: View {
    let fixture: HistoryFixture
    let feed: OddsFeed
    let pointer: OddsPointer
    let scheme: ColorScheme
    let probe: HistoryProbe

    var body: some View {
        let palette = TeamPalette(top: fixture.colors.top, bottom: fixture.colors.bottom, scheme: scheme)
        VStack(alignment: .leading, spacing: 24) {
            OddsSection(feed: feed, baseline: fixture.baseline, event: fixture.event(), names: fixture.names,
                        spoken: fixture.full, palette: palette, history: fixture.history, inspection: pointer)
                .background(frame("odds"))
            DetailSection(title: "Timeline", caption: "Key events on the same time scale as win probability.") {
                MatchTimelineSection(history: fixture.history, baseline: fixture.baseline, feed: feed, event: fixture.event(),
                                     names: fixture.names, palette: palette, pointer: pointer)
            }
            .background(frame("timeline"))
        }
        .padding(.vertical, 16)
        .coordinateSpace(name: "history-acceptance")
        .onPreferenceChange(SectionFrames.self) { probe.frames = $0 }
    }

    private func frame(_ name: String) -> some View {
        GeometryReader { geometry in
            Color.clear.preference(key: SectionFrames.self, value: [name: geometry.frame(in: .named("history-acceptance"))])
        }
    }
}

private struct RecognizedLine {
    let text: String
    let rect: CGRect
}

@main struct OddsHistoryAcceptance {
    @MainActor static func pump(_ seconds: Double = 0.25) {
        let end = Date(timeIntervalSinceNow: seconds)
        while Date() < end { _ = RunLoop.main.run(mode: .default, before: min(end, Date(timeIntervalSinceNow: 0.005))) }
    }

    private static func words(_ image: CGImage, size: CGSize) -> [RecognizedLine] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        try? VNImageRequestHandler(cgImage: image).perform([request])
        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let b = observation.boundingBox
            return RecognizedLine(text: candidate.string,
                                  rect: CGRect(x: b.minX * size.width, y: (1 - b.maxY) * size.height,
                                               width: b.width * size.width, height: b.height * size.height))
        }
    }

    @MainActor static func main() throws {
        HTTP.stubProtocol = HistoryOffline.self
        NSApplication.shared.setActivationPolicy(.prohibited)
        NSTimeZone.default = TimeZone(secondsFromGMT: 0)!
        let out = "build/odds-history-acceptance"
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        var passed = 0, failed = 0
        var receipts: [[String: Any]] = []
        var checks: [[String: Any]] = []
        func check(_ ok: Bool, _ name: String) {
            print("\(ok ? "PASS" : "FAIL") \(name)")
            checks.append(["name": name, "passed": ok])
            if ok { passed += 1 } else { failed += 1 }
        }
        for fixture in try [HistoryFixture.load(soccer: false), HistoryFixture.load(soccer: true)] {
            for scheme in [ColorScheme.dark, .light] {
                for width: CGFloat in [350, 400, 520] {
                    let name = "\(fixture.name)-\(scheme)-\(Int(width))"
                    let suite = "scoreline.odds-history-check.\(UUID().uuidString)"
                    let defaults = UserDefaults(suiteName: suite)!
                    defer { defaults.removePersistentDomain(forName: suite) }
                    let store = ScoreStore(defaults: defaults)
                    let pointer = OddsPointer(), feed = OddsFeed(), probe = HistoryProbe()
                    feed.preview(market: fixture.market, series: fixture.series, heard: fixture.history.end, connection: .idle)
                    let layout = PanelLayout.resolve(width: width, from: PanelLayout())
                    let size = CGSize(width: width, height: 900)
                    let panel = HistoryPanel(contentRect: NSRect(origin: CGPoint(x: -4000, y: 100), size: size),
                                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
                    panel.alphaValue = 0; panel.isReleasedWhenClosed = false
                    panel.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
                    let surface = HistorySurface(fixture: fixture, feed: feed, pointer: pointer, scheme: scheme, probe: probe)
                        .environment(store).environment(\.panelLayout, layout).environment(\.widthClass, layout.page)
                        .environment(\.spokenTeams, fixture.full).environment(\.pageLive, false)
                        .environment(\.glassStandIn, true).environment(\.oddsHarness, OddsHarness(stills: false))
                        .environment(\.colorScheme, scheme)
                        .environment(\.locale, Locale(identifier: "en_US"))
                        .frame(width: width, height: size.height, alignment: .topLeading)
                        .background(scheme == .dark ? Color(white: 0.12) : .white)
                    panel.contentView = NSHostingView(rootView: surface)
                    panel.orderFrontRegardless(); pump()
                    func snapshot(_ suffix: String) throws -> [RecognizedLine] {
                        guard let view = panel.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                            throw NSError(domain: "OddsHistoryAcceptance", code: 3, userInfo: [NSLocalizedDescriptionKey: "Native surface did not render"])
                        }
                        view.cacheDisplay(in: view.bounds, to: bitmap)
                        guard let image = bitmap.cgImage, let png = bitmap.representation(using: .png, properties: [:]) else {
                            throw NSError(domain: "OddsHistoryAcceptance", code: 4, userInfo: [NSLocalizedDescriptionKey: "No rendered pixels"])
                        }
                        try png.write(to: URL(fileURLWithPath: "\(out)/\(name)-\(suffix).png"))
                        return words(image, size: size)
                    }
                    pointer.hover(fixture.selected.t); pump()
                    check(pointer.active && !pointer.pinned && pointer.moment == fixture.selected.t, "\(name): hover inspects the reported event")
                    pointer.pin(fixture.selected.t); pump()
                    let recognized = try snapshot("pinned")
                    let text = recognized.map(\.text).joined(separator: " ")
                    let lower = text.lowercased()
                    check(lower.contains("timeline") && lower.contains("odds moved"), "\(name): both production modules render")
                    check(text.contains(fixture.names.top) && text.contains(fixture.names.bottom) && text.contains("%"),
                          "\(name): teams and probability values stay readable")
                    check(recognized.filter { $0.text.lowercased().contains("pinned") }.count >= 2,
                          "\(name): pin state is visible in both modules")
                    let oddsFrame = probe.frames["odds"] ?? .zero, timelineFrame = probe.frames["timeline"] ?? .zero
                    check(oddsFrame.width == width && timelineFrame.width == width && timelineFrame.minY >= oddsFrame.maxY,
                          "\(name): separate modules keep equal widths without overlapping")
                    var alignments: [[String: Any]] = []
                    for label in Set(fixture.history.periods.map(\.label)) {
                        let matches = recognized.filter { $0.text == label }
                        guard let top = matches.first(where: { oddsFrame.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) }),
                              let bottom = matches.first(where: { timelineFrame.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) }) else { continue }
                        alignments.append(["label": label, "oddsX": top.rect.midX, "timelineX": bottom.rect.midX,
                                           "delta": abs(top.rect.midX - bottom.rect.midX)])
                    }
                    check(!alignments.isEmpty && alignments.allSatisfy { ($0["delta"] as? CGFloat ?? .infinity) <= 2 },
                          "\(name): rendered period-label centers align within 2pt")

                    if width == 350 {
                        // A game can finish while the user has 10 min selected.
                        // Finals must override that remembered preference in
                        // both modules, not only in the probability plot.
                        pointer.window = .recent; pump()
                        let recent = try snapshot("final-recent-selection")
                        if let firstPeriod = fixture.history.periods.first?.label {
                            check(recent.filter { $0.text == firstPeriod }.count >= 2,
                                  "\(name): final with remembered 10 min selection still shows the first period in both modules")
                        }
                        check(pointer.moment == fixture.selected.t && pointer.pinned,
                              "\(name): final window normalization preserves the inspected event")
                        pointer.window = .game

                        // Sparse / long / corrected plays must not make the
                        // controls below the inspector hop under the pointer.
                        let variants = [fixture.history.events.first, fixture.history.events.max(by: { $0.text.count < $1.text.count }),
                                        fixture.history.events.first(where: { $0.timing == .adjusted }), fixture.selected].compactMap { $0 }
                        var heights: [CGFloat] = []
                        for variant in variants {
                            pointer.pin(variant.t); pump(0.1)
                            if let height = probe.frames["timeline"]?.height { heights.append(height) }
                        }
                        check(!heights.isEmpty && (heights.max() ?? 0) - (heights.min() ?? 0) <= 0.5,
                              "\(name): timeline inspector reserves its height across sparse, long and corrected events")
                        pointer.pin(fixture.selected.t); pump(0.1)
                    }

                    guard let before = OddsChartData.make(feed: feed, baseline: fixture.baseline, state: .final, window: .game,
                                                         eventStart: fixture.start, history: fixture.history) else { fatalError("fixture chart data") }
                    let expected = before.observedSplit(at: fixture.selected.t)
                    var changed = fixture.series
                    if var top = changed[.top], let last = top.lastIndex(where: { $0.t <= before.domain.upperBound }) {
                        top[last] = OddsPoint(t: top[last].t, p: 0.5)
                        changed[.top] = top
                    }
                    feed.preview(market: fixture.market, series: changed, heard: fixture.history.end, connection: .idle)
                    pointer.hover(before.domain.upperBound); pump()
                    let after = OddsChartData.make(feed: feed, baseline: fixture.baseline, state: .final, window: .game,
                                                   eventStart: fixture.start, history: fixture.history)
                    check(pointer.pinned && pointer.moment == fixture.selected.t && after?.observedSplit(at: fixture.selected.t) == expected,
                          "\(name): a new quote and hover preserve pinned historical values")
                    pointer.step(seconds: 15, within: before.domain); pump(0.05)
                    check(pointer.moment == min(fixture.selected.t + 15, before.domain.upperBound) && pointer.pinned,
                          "\(name): keyboard-style stepping advances exactly fifteen seconds")
                    // Keep the saved Latest still faithful to the captured
                    // final, after testing the injected quote above.
                    feed.preview(market: fixture.market, series: fixture.series, heard: fixture.history.end, connection: .idle)
                    pointer.clear(); pump()
                    let reset = try snapshot("latest").map(\.text).joined(separator: " ").lowercased()
                    check(!pointer.active && !pointer.pinned && !reset.contains("pinned"), "\(name): Latest clears inspection in both modules")

                    let until = fixture.selected.t
                    let clipped = OddsChartData.make(feed: feed, baseline: fixture.baseline, state: .live, window: .game,
                                                     eventStart: fixture.start, now: until, until: until, history: fixture.history)
                    let shown = fixture.history.shown(until: until)
                    check(clipped.map { data in
                        data.points.allSatisfy { $0.t <= until } && data.espn.allSatisfy { $0.t <= until }
                            && data.periods.allSatisfy { $0.end <= until } && data.domain.upperBound <= until
                    } == true && shown.events.allSatisfy { $0.t <= until },
                          "\(name): delayed presentation excludes every future market tick, event and period endpoint")
                    receipts.append(["case": name, "width": width, "periodAlignment": alignments,
                                     "selectedEvent": fixture.selected.id, "selectedTime": fixture.selected.t.timeIntervalSince1970,
                                     "ocr": text, "oddsFrame": NSStringFromRect(oddsFrame), "timelineFrame": NSStringFromRect(timelineFrame)])
                    panel.orderOut(nil); panel.contentView = nil; feed.stop(); pump(0.05)
                }
            }
        }
        let receipt: [String: Any] = ["passed": passed, "failed": failed, "checks": checks, "renders": receipts,
                                      "network": "HTTP blocked; pageLive false prevents market tracking", "timezone": "UTC"]
        try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
            .write(to: URL(fileURLWithPath: "\(out)/result.json"))
        print("\n\(passed) passed, \(failed) failed")
        exit(failed == 0 ? 0 : 1)
    }
}
