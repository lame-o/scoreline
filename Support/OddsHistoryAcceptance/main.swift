import AppKit
import SwiftUI
import Vision

// Native acceptance surfaces: production odds and shared sport timelines,
// plus the original minute-based SoccerTimeline fallback for untimed history.
// Real captured histories, isolated preferences, HTTP blocked.
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
                    .background(frame("rail"))
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
    var fragments: [String: CGRect] = [:]
}

private struct RailFixture {
    let name: String
    let history: MatchHistory
    let names: (top: String, bottom: String)
    let colors: (top: String, bottom: String)
    let start: Date
    let source: String
    let mutation: String
}

@main struct OddsHistoryAcceptance {
    @MainActor static func pump(_ seconds: Double = 0.25) {
        let end = Date(timeIntervalSinceNow: seconds)
        while Date() < end { _ = RunLoop.main.run(mode: .default, before: min(end, Date(timeIntervalSinceNow: 0.005))) }
    }

    private static func words(_ image: CGImage, size: CGSize, rail: CGRect? = nil) -> [RecognizedLine] {
        var result = recognize(image, region: CGRect(origin: .zero, size: size))
        if let rail, rail.height > 0 {
            // Vision can drop small timeline text when classifying a whole
            // panel dominated by sparse chart graphics. Re-read the real
            // rendered rail and its two text regions, retaining pixel bounds.
            // No text is supplied to the recognizer or inferred from fixtures.
            let regions = [rail.insetBy(dx: 0, dy: -3),
                           CGRect(x: rail.minX, y: rail.minY, width: 40, height: 45),
                           CGRect(x: rail.minX + 28, y: rail.minY + 44, width: rail.width - 28, height: 19)]
            let scale = CGFloat(image.width) / size.width
            for region in regions {
                let bounded = region.intersection(CGRect(origin: .zero, size: size))
                let pixels = CGRect(x: bounded.minX * scale, y: bounded.minY * scale,
                                    width: bounded.width * scale, height: bounded.height * scale).integral
                guard let crop = image.cropping(to: pixels) else { continue }
                result += recognize(crop, region: CGRect(x: pixels.minX / scale, y: pixels.minY / scale,
                                                        width: pixels.width / scale, height: pixels.height / scale))
            }
        }
        return result
    }

    private static func recognize(_ image: CGImage, region: CGRect) -> [RecognizedLine] {
        let request = VNRecognizeTextRequest()
        // Diagnostic override for hosts whose revision-3 model compilation
        // fails in TextRecognition/e5rt. Keep the same strict render assertions
        // and record the selected revision in the receipt.
        if ProcessInfo.processInfo.environment["SCORELINE_OCR_REVISION"] == "2" {
            request.revision = 2
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        do {
            try VNImageRequestHandler(cgImage: image).perform([request])
        } catch {
            fputs("OCR ERROR (revision \(request.revision)): \(String(reflecting: error))\n", stderr)
        }
        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            func rect(_ b: CGRect) -> CGRect {
                CGRect(x: region.minX + b.minX * region.width, y: region.minY + (1 - b.maxY) * region.height,
                       width: b.width * region.width, height: b.height * region.height)
            }
            var fragments: [String: CGRect] = [:]
            let text = candidate.string
            var remaining = text.startIndex..<text.endIndex
            while let range = text.range(of: "\\S+", options: .regularExpression, range: remaining) {
                if let box = try? candidate.boundingBox(for: range) { fragments[String(text[range])] = rect(box.boundingBox) }
                remaining = range.upperBound..<text.endIndex
            }
            return RecognizedLine(text: text, rect: rect(observation.boundingBox), fragments: fragments)
        }
    }

    private static func matching(_ text: String, in lines: [RecognizedLine]) -> [RecognizedLine] {
        func normalize(_ value: String) -> String { value.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
        return lines.flatMap { line -> [RecognizedLine] in
            if normalize(line.text) == normalize(text) { return [line] }
            // Vision may merge separate inning/quarter labels into one line.
            // Its own character boxes recover their individual x positions.
            return line.fragments.compactMap { word, rect in
                normalize(word) == normalize(text) ? RecognizedLine(text: word, rect: rect) : nil
            }
        }
    }

    private static func matchingAxis(_ label: String, in lines: [RecognizedLine], labels: Set<String>) -> [RecognizedLine] {
        matching(label, in: lines.filter { line in
            let words = line.text.split(whereSeparator: \.isWhitespace).map(String.init)
            return words.joined(separator: " ") == label.split(whereSeparator: \.isWhitespace).joined(separator: " ")
                || (!words.isEmpty && words.allSatisfy { labels.contains($0) })
        })
    }

    /// Team identity belongs to the left gutter, never to the odds-label
    /// column on the right. Check the rendered text position, not just its
    /// presence somewhere in a selected play's description.
    private static func leftTeams(_ lines: [RecognizedLine], names: (top: String, bottom: String), rail: CGRect) -> Bool {
        let gutterEnd = rail.minX + 8 + OddsStyle.gutter + 2
        func match(_ name: String) -> RecognizedLine? {
            matching(name, in: lines).first { line in
                rail.contains(CGPoint(x: line.rect.midX, y: line.rect.midY))
                    && line.rect.maxX <= gutterEnd
            }
        }
        guard let top = match(names.top), let bottom = match(names.bottom) else { return false }
        return top.rect.midY < bottom.rect.midY
    }

    @MainActor static func main() throws {
        HTTP.stubProtocol = HistoryOffline.self
        NSApplication.shared.setActivationPolicy(.prohibited)
        let hoverOnly = ProcessInfo.processInfo.environment["SCORELINE_HOVER_ONLY"] == "1"
        let out = "build/odds-history-acceptance"
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        var passed = 0, failed = 0
        var receipts: [[String: Any]] = []
        var checks: [[String: Any]] = []
        func check(_ ok: Bool, _ name: String) {
            print("\(ok ? "PASS" : "FAIL") \(name)")
            fflush(stdout)
            checks.append(["name": name, "passed": ok])
            if ok { passed += 1 } else { failed += 1 }
        }
        for fixture in try [HistoryFixture.load(soccer: false), HistoryFixture.load(soccer: true)] {
            for scheme in [ColorScheme.dark, .light] {
                for width: CGFloat in [350, 400, 520] {
                    if hoverOnly && !(fixture.name == "nba" && scheme == .dark && width == 520) { continue }
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
                        return words(image, size: size, rail: probe.frames["rail"])
                    }
                    // The mounted native scrub may receive initial keyboard
                    // focus and inspect Latest. Resting captures intentionally
                    // clear that state; production focus policy stays intact.
                    pointer.clear(); pump()
                    let resting = try snapshot("resting")
                    let oddsFrame = probe.frames["odds"] ?? .zero, timelineFrame = probe.frames["timeline"] ?? .zero
                    let railFrame = probe.frames["rail"] ?? .zero
                    check(railFrame.height == 60, "\(name): the production timeline itself is exactly 60pt tall")
                    let expectedData = OddsChartData.make(feed: feed, baseline: fixture.baseline, state: .final, window: .game,
                                                         eventStart: fixture.start, history: fixture.history)!
                    let labelWidth = OddsStyle.labelWidth([fixture.names.top, fixture.names.bottom] + (fixture.market.threeWay ? ["Draw"] : []))
                    let innerWidth = width - 2 * (Metrics.gutter + 8)
                    let oddsGeometry = OddsLayout(size: CGSize(width: innerWidth, height: 165), plotHeight: 150,
                                                  domain: expectedData.domain, labelWidth: labelWidth)
                    let railGeometry = OddsLayout(size: CGSize(width: railFrame.width - 16, height: MatchTimelineStyle.height),
                                                  plotHeight: MatchTimelineStyle.plotHeight, domain: expectedData.domain, labelWidth: labelWidth)
                    check(fixture.history.keyEvents.allSatisfy { event in
                        abs((Metrics.gutter + 8 + oddsGeometry.x(event.t)) - (railFrame.minX + 8 + railGeometry.x(event.t))) < 0.01
                    }, "\(name): every scoring/card timestamp maps to the same page x coordinate as odds")
                    check(leftTeams(resting, names: fixture.names, rail: railFrame),
                          "\(name): both team labels stay in the left gutter in team order")
                    pointer.hover(fixture.selected.t); pump()
                    check(pointer.active && !pointer.pinned && pointer.moment == fixture.selected.t, "\(name): hover inspects the reported event")
                    pointer.pin(fixture.selected.t); pump()
                    let recognized = try snapshot("pinned")
                    let text = recognized.map(\.text).joined(separator: " ")
                    let lower = text.lowercased()
                    check(lower.contains("timeline") && lower.contains("odds moved"), "\(name): both production modules render")
                    check(text.contains(fixture.names.top) && text.contains(fixture.names.bottom) && text.contains("%"),
                          "\(name): teams and probability values stay readable")
                    let selectedRow = recognized.filter { railFrame.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY))
                        && $0.rect.midY > railFrame.minY + 45 }
                    let periodNames = Set(fixture.history.periods.map(\.label))
                    check(recognized.contains { $0.text.lowercased().contains("pinned") }
                          && !selectedRow.isEmpty && !selectedRow.contains { periodNames.contains($0.text) },
                          "\(name): odds shows the pin while timeline replaces its period row with event detail")
                    check(oddsFrame.width == width && timelineFrame.width == width && timelineFrame.minY >= oddsFrame.maxY,
                          "\(name): separate modules keep equal widths without overlapping")
                    check(probe.frames["rail"]?.height == 60 && probe.frames["timeline"]?.height == timelineFrame.height,
                          "\(name): inspection remains inside the 60pt track without a separate footer")
                    var alignments: [[String: Any]] = []
                    for label in Set(fixture.history.periods.map(\.label)) {
                        let matches = matchingAxis(label, in: resting, labels: periodNames)
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
                        check(pointer.moment == fixture.selected.t && pointer.pinned,
                              "\(name): final window normalization preserves the inspected event")
                        pointer.clear(); pump()
                        let recent = try snapshot("final-recent-resting")
                        if let firstPeriod = fixture.history.periods.first?.label {
                            let matches = matchingAxis(firstPeriod, in: recent, labels: periodNames)
                            check(matches.contains { oddsFrame.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) }
                                  && matches.contains { railFrame.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) },
                                  "\(name): final with remembered 10 min selection still shows the first period in both modules")
                        }
                        pointer.pin(fixture.selected.t)
                        pointer.window = .game

                        // Sparse / long / corrected plays must not make the
                        // controls below the inspector hop under the pointer.
                        let variants = [fixture.history.events.first, fixture.history.events.max(by: { $0.text.count < $1.text.count }),
                                        fixture.history.events.first(where: { $0.timing == .adjusted }), fixture.selected].compactMap { $0 }
                        var heights: [CGFloat] = []
                        for variant in variants {
                            pointer.pin(variant.t); pump(0.1)
                            if let height = probe.frames["rail"]?.height { heights.append(height) }
                        }
                        check(!heights.isEmpty && (heights.max() ?? 0) - (heights.min() ?? 0) <= 0.5
                              && heights.allSatisfy { $0 == 60 },
                              "\(name): sparse, long and corrected event details keep the timeline at 60pt")
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
                    let resetLines = try snapshot("latest")
                    let reset = resetLines.map(\.text).joined(separator: " ").lowercased()
                    check(!pointer.active && !pointer.pinned && !reset.contains("pinned"), "\(name): Latest clears inspection in both modules")
                    check(periodNames.contains { label in matchingAxis(label, in: resetLines, labels: periodNames).contains {
                        railFrame.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) } },
                          "\(name): clearing inspection restores the timeline's period labels")
                    if fixture.name == "nba", scheme == .dark, width == 520 {
                        NativeHoverChecks.run(panel: panel, pointer: pointer, frames: probe.frames,
                                              data: before, history: fixture.history, names: fixture.names, check: check)
                    }

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
                                     "ocr": text, "restingOCR": resting.map(\.text), "oddsFrame": NSStringFromRect(oddsFrame),
                                     "timelineFrame": NSStringFromRect(timelineFrame), "railFrame": NSStringFromRect(railFrame),
                                     "scope": "Production odds and timeline modules on a shared wall-clock domain. These trimmed summary fixtures omit play team IDs, so their marks are correctly neutral; team-lane appearance is covered by separate attributed NBA and soccer captures.",
                                     "teamAttributedKeyEvents": fixture.history.keyEvents.filter { $0.side != nil }.count])
                    panel.orderOut(nil); panel.contentView = nil; feed.stop(); pump(0.05)
                }
            }
        }
        if !hoverOnly {
            receipts += try nflRenders(out: out, check: check)
            receipts += try originalSoccerRenders(out: out, check: check)
            receipts += try additionalRailRenders(out: out, check: check)
        }
        let receipt: [String: Any] = ["passed": passed, "failed": failed, "checks": checks, "renders": receipts,
                                      "ocrRevision": ProcessInfo.processInfo.environment["SCORELINE_OCR_REVISION"] == "2" ? 2 : VNRecognizeTextRequest.defaultRevision,
                                      "ocrRegions": "Full panel plus actual rail, left labels and detail-row pixel crops; merged axis labels use Vision character bounds",
                                      "network": "HTTP blocked; pageLive false prevents market tracking",
                                      "timezone": "System-local display; event timestamps are Unix seconds"]
        let resultName = hoverOnly ? "hover-result-\(ProcessInfo.processInfo.environment["SCORELINE_HOVER_DISPATCH"] ?? "queue").json" : "result.json"
        try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
            .write(to: URL(fileURLWithPath: "\(out)/\(resultName)"))
        print("\n\(passed) passed, \(failed) failed")
        exit(failed == 0 ? 0 : 1)
    }

    /// The untouched 1.0.30 soccer component on its original minute axis. The
    /// real Carabao Cup goal capture preserves provider IDs, clocks and replay
    /// inputs; only the core team reference is normalized for the summary parser.
    @MainActor private static func originalSoccerRenders(out: String, check: (Bool, String) -> Void) throws -> [[String: Any]] {
        let captured = JSON(data: try Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/competitions/cup-goals.json")))["items"].array
        let untimed = captured.map { play -> JSON in
            var raw = play.raw as? [String: Any] ?? [:]
            raw.removeValue(forKey: "wallclock")
            return JSON(raw)
        }
        let missingHistory = MatchHistory.parse(JSON(["keyEvents": untimed.compactMap(\.raw)]), sport: .soccer, topID: "364", bottomID: "363")
        check(missingHistory.events.isEmpty && missingHistory.missingTimeCount == 2,
              "untimed soccer: absent wall timestamps retain the original minute fallback instead of fabricated alignment")
        let moments = untimed.compactMap { play -> GameDetail.Moment? in
            guard var raw = play.raw as? [String: Any], let id = SoccerScene.teamID(play) else { return nil }
            raw["team"] = ["id": id]
            return ESPNDetail.soccerMoment(JSON(raw), side: { $0 == "364" ? .top : $0 == "363" ? .bottom : nil })
        }
        guard let selected = moments.last, moments.count == 2 else {
            throw NSError(domain: "OddsHistoryAcceptance", code: 8, userInfo: [NSLocalizedDescriptionKey: "Carabao goal capture did not produce the original minute-based moments"])
        }
        check(captured.indices.allSatisfy { Replays.soccer(captured, at: $0, homeTeamID: "364", keepers: [:]) != nil },
              "original soccer: both captured Carabao goals retain replay inputs")
        var receipts: [[String: Any]] = []
        for scheme in [ColorScheme.dark, .light] {
            for width: CGFloat in [350, 520] {
                let name = "soccer-untimed-fallback-\(scheme)-\(Int(width))"
                let linked = LinkedFocus(), probe = HistoryProbe()
                let layout = PanelLayout.resolve(width: width, from: PanelLayout())
                let size = CGSize(width: width, height: 190)
                let panel = HistoryPanel(contentRect: NSRect(origin: CGPoint(x: -4000, y: 100), size: size),
                                         styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
                panel.alphaValue = 0; panel.isReleasedWhenClosed = false
                panel.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
                let palette = TeamPalette(top: "C8102E", bottom: "034694", scheme: scheme)
                let surface = DetailSection(title: "Timeline", caption: "Goals and cards by minute. LIV above, CHE below. Event timestamps unavailable.") {
                    SoccerTimeline(moments: moments, currentMinute: nil, palette: palette, topName: "LIV", bottomName: "CHE")
                        .background(GeometryReader { geometry in
                            Color.clear.preference(key: SectionFrames.self, value: ["rail": geometry.frame(in: .named("soccer-original"))])
                        })
                }
                .onPreferenceChange(SectionFrames.self) { probe.frames = $0 }
                .padding(.vertical, 16).coordinateSpace(name: "soccer-original")
                .environment(linked).environment(\.panelLayout, layout).environment(\.widthClass, layout.page)
                .environment(\.colorScheme, scheme).environment(\.glassStandIn, true)
                .environment(\.locale, Locale(identifier: "en_US"))
                .frame(width: width, height: size.height, alignment: .topLeading)
                .background(scheme == .dark ? Color(white: 0.12) : .white)
                panel.contentView = NSHostingView(rootView: surface)
                panel.orderFrontRegardless(); pump()
                func snapshot(_ state: String) throws -> String {
                    guard let view = panel.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                        throw NSError(domain: "OddsHistoryAcceptance", code: 9, userInfo: [NSLocalizedDescriptionKey: "Original soccer timeline did not render"])
                    }
                    view.cacheDisplay(in: view.bounds, to: bitmap)
                    guard let image = bitmap.cgImage, let png = bitmap.representation(using: .png, properties: [:]) else {
                        throw NSError(domain: "OddsHistoryAcceptance", code: 10, userInfo: [NSLocalizedDescriptionKey: "Original soccer timeline has no pixels"])
                    }
                    try png.write(to: URL(fileURLWithPath: "\(out)/\(name)-\(state).png"))
                    return words(image, size: size, rail: probe.frames["rail"]).map(\.text).joined(separator: " ")
                }
                let resting = try snapshot("resting"), initialHeight = probe.frames["rail"]?.height
                // Vision revision 2 can read the rendered Latin T as its
                // visually identical Cyrillic counterpart. Preserve raw OCR
                // in the receipt and accept only this exact landmark variant.
                func hasHalftime(_ text: String) -> Bool {
                    text.split(separator: " ").contains { $0 == "HT" || $0 == "H\u{0422}" }
                }
                check(initialHeight == 60, "\(name): the original soccer rail remains exactly 60pt tall")
                check(resting.contains("LIV") && resting.contains("CHE") && hasHalftime(resting) && resting.contains("90"),
                      "\(name): team abbreviations and original minute landmarks remain readable")
                linked.hover(Focus(play: selected.id), true); pump(0.25)
                let focused = try snapshot("focused")
                check(linked.focus?.play == selected.id && focused.contains("Gakpo") && !hasHalftime(focused),
                      "\(name): linked event focus replaces the minute-label row with the selected goal")
                check(probe.frames["rail"]?.height == initialHeight && !focused.contains("Pinned"),
                      "\(name): event detail stays within the original rail without an extra inspector")
                linked.clear(); pump(0.25)
                let reset = try snapshot("reset")
                check(linked.focus == nil && hasHalftime(reset),
                      "\(name): clearing linked hover restores the minute labels")
                receipts.append(["case": name, "width": width, "railHeight": initialHeight ?? -1,
                                 "source": "Unmodified SoccerTimeline from release 1.0.30; real Carabao goal fixture 401921842",
                                 "mutation": "wallclock removed from both goals to exercise the untimed fallback; original minute and replay inputs retained",
                                 "scope": "Original component used only when soccer history has no event timestamps; minute axis cannot align with wall-clock odds",
                                 "restingOCR": resting, "focusedOCR": focused, "resetOCR": reset])
                panel.orderOut(nil); panel.contentView = nil; pump(0.05)
            }
        }
        return receipts
    }

    /// Baseball has a real captured World Series chronology. NBA edge cases
    /// are explicitly labeled mutations of the existing capture, not alleged
    /// live data: an empty history and a reported score in an overtime period.
    @MainActor private static func additionalRailRenders(out: String, check: (Bool, String) -> Void) throws -> [[String: Any]] {
        let baseball = JSON(data: try Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/ws-g5-plays.json")))
        let mlb = MatchHistory.parse(JSON(["plays": baseball["items"].array.compactMap(\.raw)]), sport: .baseball, topID: "8", bottomID: "30")
        let richNBA = JSON(data: try Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/nba-every-play-401909890.json")))["games"][0]
        let away = richNBA["away"], home = richNBA["home"]
        let attributedNBA = MatchHistory.parse(JSON(["plays": richNBA["items"].array.compactMap(\.raw)]), sport: .basketball,
                                               topID: away["id"].string, bottomID: home["id"].string)
        let cup = JSON(data: try Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/competitions/cup-goals.json")))["items"].array
        let cupPlays = cup.compactMap { play -> [String: Any]? in
            guard var raw = play.raw as? [String: Any], let id = SoccerScene.teamID(play) else { return nil }
            // Normalize the captured core team's explicit $ref, just as the
            // feed does. Timestamps and team attribution stay provider data.
            raw["team"] = ["id": id]
            return raw
        }
        let attributedSoccer = MatchHistory.parse(JSON(["keyEvents": cupPlays]), sport: .soccer, topID: "364", bottomID: "363")
        let nba = try HistoryFixture.load(soccer: false)
        guard let last = nba.history.keyEvents.last, let end = nba.history.end, let baseballStart = mlb.start,
              let nbaStart = attributedNBA.start, let soccerStart = attributedSoccer.start,
              let awayName = away["abbreviation"].string, let homeName = home["abbreviation"].string,
              let awayColor = away["color"].string, let homeColor = home["color"].string else {
            throw NSError(domain: "OddsHistoryAcceptance", code: 11, userInfo: [NSLocalizedDescriptionKey: "Additional timeline captures are empty"])
        }
        var overtime = nba.history
        overtime.events.append(MatchHistory.Event(id: "acceptance-overtime", t: end + 1200, period: 5, clock: "OT 0:30",
                                                  text: last.text, side: last.side, kind: .score, score: nil, timing: .reported))
        overtime.periods.append(OddsPeriod(number: 5, label: "OT", start: end + 120, end: end + 1320))
        let mlbFixture = RailFixture(name: "mlb", history: mlb, names: ("MIL", "TB"), colors: ("FFC52F", "092C5C"),
                                    start: baseballStart, source: "Captured World Series Game 5, 401908046", mutation: "None")
        let attributedNBAFixture = RailFixture(name: "nba-attributed", history: attributedNBA, names: (awayName, homeName),
                                              colors: (awayColor, homeColor), start: nbaStart,
                                              source: "Captured SA–UTAH 401909890; provider team IDs and all 515 wall timestamps retained", mutation: "None")
        let attributedSoccerFixture = RailFixture(name: "soccer-attributed", history: attributedSoccer, names: ("LIV", "CHE"),
                                                 colors: ("C8102E", "034694"), start: soccerStart,
                                                 source: "Captured Carabao Cup 401921842 scoring segment; both provider timestamps and explicit team references retained",
                                                 mutation: "None")
        let empty = RailFixture(name: "nba-empty", history: MatchHistory(sport: .basketball), names: nba.names, colors: nba.colors,
                                start: nba.start, source: "GSW–MIN capture 401909888", mutation: "All events removed to test honest empty inspection")
        let ot = RailFixture(name: "nba-overtime", history: overtime, names: nba.names, colors: nba.colors, start: nba.start,
                             source: "GSW–MIN capture 401909888", mutation: "One existing score text copied to a clearly synthetic overtime event and period")
        let cases: [(RailFixture, CGFloat, ColorScheme)] = [
            (mlbFixture, 350, .dark), (mlbFixture, 350, .light), (mlbFixture, 520, .dark), (mlbFixture, 520, .light),
            (attributedNBAFixture, 350, .dark), (attributedNBAFixture, 350, .light), (attributedNBAFixture, 520, .dark), (attributedNBAFixture, 520, .light),
            (attributedSoccerFixture, 350, .dark), (attributedSoccerFixture, 350, .light), (attributedSoccerFixture, 520, .dark), (attributedSoccerFixture, 520, .light),
            (empty, 350, .dark), (ot, 350, .dark)
        ]
        check(mlb.keyEvents.contains { $0.side == .top } && mlb.keyEvents.contains { $0.side == .bottom },
              "MLB: captured scoring plays preserve both teams without invented attribution")
        check(attributedNBA.keyEvents.filter { $0.side == .top }.count == 61
              && attributedNBA.keyEvents.filter { $0.side == .bottom }.count == 57,
              "NBA: all 118 captured SA–UTAH scores retain their explicit provider teams")
        check(attributedSoccer.keyEvents.count == 2 && attributedSoccer.keyEvents.contains { $0.side == .top }
              && attributedSoccer.keyEvents.contains { $0.side == .bottom },
              "Soccer: both captured Carabao goals retain their real timestamps and opposing teams")
        var receipts: [[String: Any]] = []
        for (fixture, width, scheme) in cases {
            let name = "\(fixture.name)-\(scheme)-\(Int(width))", history = fixture.history
            let domain = history.events.isEmpty ? nba.start...(nba.start + 7200)
                : history.domain(state: .final, window: .game, eventStart: fixture.start)
            let pointer = OddsPointer(), probe = HistoryProbe()
            let size = CGSize(width: width, height: 190), labelWidth = OddsStyle.labelWidth([fixture.names.top, fixture.names.bottom])
            let panel = HistoryPanel(contentRect: NSRect(origin: CGPoint(x: -4000, y: 100), size: size),
                                     styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.alphaValue = 0; panel.isReleasedWhenClosed = false
            panel.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            let palette = TeamPalette(top: fixture.colors.top, bottom: fixture.colors.bottom, scheme: scheme)
            let layout = PanelLayout.resolve(width: width, from: PanelLayout())
            let caption = fixture.mutation != "None" ? "Acceptance edge case · \(fixture.name)"
                : history.sport == .baseball ? "Scoring plays by inning."
                : history.sport == .soccer ? "Goals and cards · Captured scoring segment."
                : "Scoring plays by period."
            let surface = DetailSection(title: "Timeline", caption: caption) {
                MatchTimeline(history: history, domain: domain, names: fixture.names, palette: palette,
                              pointer: pointer, labelWidth: labelWidth, final: true)
                    .background(GeometryReader { geometry in
                        Color.clear.preference(key: SectionFrames.self, value: ["rail": geometry.frame(in: .named("additional-rail"))])
                    })
            }
            .onPreferenceChange(SectionFrames.self) { probe.frames = $0 }
            .padding(.vertical, 16).coordinateSpace(name: "additional-rail")
            .environment(\.panelLayout, layout).environment(\.widthClass, layout.page)
            .environment(\.colorScheme, scheme).environment(\.glassStandIn, true).environment(\.pageLive, false)
            .environment(\.locale, Locale(identifier: "en_US"))
            .frame(width: width, height: size.height, alignment: .topLeading)
            .background(scheme == .dark ? Color(white: 0.12) : .white)
            panel.contentView = NSHostingView(rootView: surface)
            panel.orderFrontRegardless(); pump()
            func snapshot(_ state: String) throws -> [RecognizedLine] {
                guard let view = panel.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                    throw NSError(domain: "OddsHistoryAcceptance", code: 12, userInfo: [NSLocalizedDescriptionKey: "Additional timeline did not render"])
                }
                view.cacheDisplay(in: view.bounds, to: bitmap)
                guard let image = bitmap.cgImage, let png = bitmap.representation(using: .png, properties: [:]) else {
                    throw NSError(domain: "OddsHistoryAcceptance", code: 13, userInfo: [NSLocalizedDescriptionKey: "Additional timeline has no pixels"])
                }
                try png.write(to: URL(fileURLWithPath: "\(out)/\(name)-\(state).png"))
                return words(image, size: size, rail: probe.frames["rail"])
            }
            pointer.clear(); pump()
            let resting = try snapshot("resting"), rail = probe.frames["rail"] ?? .zero
            check(rail.height == 60, "\(name): the timeline retains the original soccer height")
            check(leftTeams(resting, names: fixture.names, rail: rail), "\(name): both neutral team labels occupy the left gutter")
            if fixture.name == "nba-overtime" {
                check(matchingAxis("OT", in: resting, labels: Set(history.periods.map(\.label))).contains { rail.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) },
                      "\(name): the extra period stays visible in the compact bottom row")
            }
            let selection = history.keyEvents.last?.t ?? domain.lowerBound + 600
            pointer.pin(selection); pump()
            let pinned = try snapshot("pinned")
            let row = pinned.filter { rail.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) && $0.rect.midY > rail.minY + 45 }
            check(!row.isEmpty && pointer.pinned && pointer.moment == selection && probe.frames["rail"]?.height == 60,
                  "\(name): pinning shows one detail row without changing track height")
            if history.events.isEmpty {
                check(row.map(\.text).joined(separator: " ").localizedCaseInsensitiveContains("unavailable"),
                      "\(name): missing history is stated explicitly instead of fabricating a play")
            }
            pointer.clear(); pump()
            let reset = try snapshot("reset")
            let geometry = OddsLayout(size: CGSize(width: rail.width - 16, height: MatchTimelineStyle.height),
                                      plotHeight: MatchTimelineStyle.plotHeight, domain: domain, labelWidth: labelWidth)
            let axis = history.periods.isEmpty ? OddsPlot.hourLabels(geometry) : OddsPlot.periodLabels(history.periods, layout: geometry)
            let labels = Set(axis.map(\.label))
            check(!pointer.active && probe.frames["rail"]?.height == 60 && labels.contains { label in matchingAxis(label, in: reset, labels: labels).contains {
                rail.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) } },
                  "\(name): clearing restores clock or period labels in the same row")
            receipts.append(["case": name, "railFrame": NSStringFromRect(rail), "restingOCR": resting.map(\.text),
                             "pinnedOCR": pinned.map(\.text), "source": fixture.source, "mutation": fixture.mutation,
                             "topKeyEvents": history.keyEvents.filter { $0.side == .top }.count,
                             "bottomKeyEvents": history.keyEvents.filter { $0.side == .bottom }.count,
                             "scope": "Production timeline-only render; no market prices invented"])
            panel.orderOut(nil); panel.contentView = nil; pump(0.05)
        }
        return receipts
    }

    /// The captured NFL summary has ESPN probabilities but no captured market
    /// for this event. Render its real timeline, not a made-up Polymarket line.
    /// NBA above exercises the production two-module surface; these cases
    /// exercise the football rail and compare its x geometry to the same odds
    /// layout. A clearly labeled mutation also forces opposing scores together.
    @MainActor private static func nflRenders(out: String, check: (Bool, String) -> Void) throws -> [[String: Any]] {
        let summary = JSON(data: try Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/odds/espn-nfl-401873029.json")))
        let history = MatchHistory.parse(summary, sport: .football, topID: "13", bottomID: "20", path: "football/nfl")
        let baseline = OddsBaseline.parse(summary, sport: .football, topID: "13", bottomID: "20")
        let start = DateParser.parse("2026-11-01T18:00:00Z")!
        guard let top = history.keyEvents.first(where: { $0.side == .top }),
              let bottom = history.keyEvents.first(where: { $0.side == .bottom }) else {
            throw NSError(domain: "OddsHistoryAcceptance", code: 5, userInfo: [NSLocalizedDescriptionKey: "NFL capture lacks team-attributed scoring plays"])
        }
        check(!baseline.espn.isEmpty && history.keyEvents.count >= 2, "NFL: captured ESPN chronology includes both teams and actual probabilities")
        var collided = history
        collided.events = history.events.map { event in
            guard event.id == bottom.id else { return event }
            return MatchHistory.Event(id: event.id, t: top.t, period: top.period, clock: event.clock, text: event.text,
                                      side: event.side, kind: event.kind, score: event.score, timing: .adjusted)
        }.sorted { $0.t < $1.t }
        var receipts: [[String: Any]] = []
        for scheme in [ColorScheme.dark, .light] {
            for width: CGFloat in [350, 520] {
                for (variant, shown) in [("recorded", history), ("same-time", collided)] {
                    let name = "nfl-\(scheme)-\(Int(width))-\(variant)"
                    let domain = shown.domain(state: .final, window: .game, eventStart: start)
                    let pointer = OddsPointer(), probe = HistoryProbe()
                    let labelWidth = OddsStyle.labelWidth(["LV", "NYJ"])
                    let plotSize = CGSize(width: width - 2 * (Metrics.gutter + 8), height: MatchTimelineStyle.height)
                    let railLayout = OddsLayout(size: plotSize, plotHeight: MatchTimelineStyle.plotHeight, domain: domain, labelWidth: labelWidth)
                    let oddsLayout = OddsLayout(size: plotSize, plotHeight: 150, domain: domain, labelWidth: labelWidth)
                    let marks = MatchTimelineRail.marks(events: shown.keyEvents, layout: railLayout)
                    check(shown.keyEvents.allSatisfy { railLayout.x($0.t) == oddsLayout.x($0.t) },
                          "\(name): every football score shares the odds horizontal scale")
                    check(marks.flatMap(\.events).count == shown.keyEvents.count
                          && (variant != "same-time" || marks.contains(where: { $0.events.contains(where: { $0.id == top.id }) && $0.events.contains(where: { $0.id == bottom.id }) })),
                          "\(name): counted rail preserves both teams when scores coincide")
                    let overlap = marks.enumerated().contains { index, mark in
                        marks.dropFirst(index + 1).contains { other in
                            abs(mark.point.y - other.point.y) < 12 && abs(mark.point.x - other.point.x) < mark.radius + other.radius
                        }
                    }
                    check(!overlap, "\(name): football markers remain distinct in the compact rail")
                    let size = CGSize(width: width, height: 280)
                    let panel = HistoryPanel(contentRect: NSRect(origin: CGPoint(x: -4000, y: 100), size: size),
                                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
                    panel.alphaValue = 0; panel.isReleasedWhenClosed = false
                    panel.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
                    let palette = TeamPalette(top: "A5ACAF", bottom: "125740", scheme: scheme)
                    let surface = DetailSection(title: "Timeline", caption: "Scoring events · Las Vegas at New York") {
                        MatchTimeline(history: shown, domain: domain, names: ("LV", "NYJ"), palette: palette,
                                      pointer: pointer, labelWidth: labelWidth, final: true)
                            .background(GeometryReader { geometry in
                                Color.clear.preference(key: SectionFrames.self, value: ["rail": geometry.frame(in: .named("nfl-acceptance"))])
                            })
                    }
                    .background(GeometryReader { geometry in
                        Color.clear.preference(key: SectionFrames.self, value: ["timeline": geometry.frame(in: .named("nfl-acceptance"))])
                    })
                    .onPreferenceChange(SectionFrames.self) { probe.frames = $0 }
                    .padding(.vertical, 16)
                    .coordinateSpace(name: "nfl-acceptance")
                    .environment(\.spokenTeams, SpokenTeams(top: "Las Vegas Raiders", bottom: "New York Jets"))
                    .environment(\.colorScheme, scheme).environment(\.glassStandIn, true)
                    .environment(\.locale, Locale(identifier: "en_US"))
                    .frame(width: width, height: size.height, alignment: .topLeading)
                    .background(scheme == .dark ? Color(white: 0.12) : .white)
                    panel.contentView = NSHostingView(rootView: surface)
                    panel.orderFrontRegardless(); pump()
                    let frame = probe.frames["timeline"] ?? .zero
                    let railFrame = probe.frames["rail"] ?? .zero
                    check(railFrame.height == 60, "\(name): football uses the same 60pt timeline height as soccer")
                    func snapshot(_ state: String) throws -> [RecognizedLine] {
                        guard let view = panel.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                            throw NSError(domain: "OddsHistoryAcceptance", code: 6, userInfo: [NSLocalizedDescriptionKey: "NFL surface did not render"])
                        }
                        view.cacheDisplay(in: view.bounds, to: bitmap)
                        guard let image = bitmap.cgImage, let png = bitmap.representation(using: .png, properties: [:]) else {
                            throw NSError(domain: "OddsHistoryAcceptance", code: 7, userInfo: [NSLocalizedDescriptionKey: "NFL surface has no pixels"])
                        }
                        try png.write(to: URL(fileURLWithPath: "\(out)/\(name)-\(state).png"))
                        return words(image, size: size, rail: probe.frames["rail"])
                    }
                    pointer.clear(); pump()
                    let resting = try snapshot("resting")
                    check(leftTeams(resting, names: ("LV", "NYJ"), rail: railFrame),
                          "\(name): football identities are on the left in the same order as soccer")
                    pointer.pin(top.t); pump()
                    let recognized = try snapshot("pinned"), text = recognized.map(\.text).joined(separator: " ")
                    let row = recognized.filter { railFrame.contains(CGPoint(x: $0.rect.midX, y: $0.rect.midY)) && $0.rect.midY > railFrame.minY + 45 }
                    check(leftTeams(recognized, names: ("LV", "NYJ"), rail: railFrame) && !row.isEmpty && pointer.pinned,
                          "\(name): both team identities remain readable while the bottom row shows the selected play")
                    var heights: [CGFloat] = []
                    for event in [top, bottom, shown.events.max(by: { $0.text.count < $1.text.count })].compactMap({ $0 }) {
                        pointer.pin(event.t); pump(0.05)
                        if let height = probe.frames["rail"]?.height { heights.append(height) }
                    }
                    check(!heights.isEmpty && heights.allSatisfy { $0 == 60 },
                          "\(name): long plays and opposing scores stay inside the same 60pt track")
                    receipts.append(["case": name, "width": width, "timelineFrame": NSStringFromRect(frame), "ocr": text,
                                     "source": "ESPN 401873029; timeline-only render, no captured market exists for this fixture",
                                     "mutation": variant == "same-time" ? "Second team's first score moved to first team's score time for collision coverage" : "None",
                                     "scoreCount": shown.keyEvents.count, "markerCount": marks.count,
                                     "railFrame": NSStringFromRect(railFrame), "restingOCR": resting.map(\.text)])
                    panel.orderOut(nil); panel.contentView = nil; pump(0.05)
                }
            }
        }
        return receipts
    }
}
