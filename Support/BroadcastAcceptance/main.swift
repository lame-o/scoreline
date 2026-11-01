import AppKit
import SwiftUI
import Vision

// The offscreen check for the court (CHOREOGRAPHY Phase 0's acceptance test),
// extending the broadcast's (BROADCAST Phase A): the real DetailView of
// mac/choreo for NBA 401909285's fourth quarter, fed from the recording on a
// virtual clock at the app's cadence (the summary every 30 s, the core lane
// every 5 s, the scoreboard every 30 s), with the Live View open. At every
// step the page is drawn; the court's directed stage reports what it drew
// (the play in charge, its clip time, its decisive moment) against the hero's
// presented broadcast state. Optional pixel verification reads the final hero too.
// At each change of the presented score, the
// court's frame at that step is the scoring play's decisive frame (or after
// it) and the step before is not: the score and the court land together.
// Hosted in a borderless panel at alpha 0 far offscreen, the app unable to
// activate; no network.

let out = ProcessInfo.processInfo.environment["SCORELINE_ACCEPTANCE_OUTPUT"] ?? "build/broadcast-acceptance"

final class Offline: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}

@MainActor var results: [(Bool, String)] = []

@MainActor
func check(_ ok: Bool, _ name: String, _ detail: @autoclosure () -> String = "") {
    results.append((ok, name))
    print("\(ok ? "PASS" : "FAIL")  \(name)\(ok ? "" : "  [\(detail())]")")
}

@MainActor
func pump(_ seconds: Double) {
    let end = Date(timeIntervalSinceNow: seconds)
    while Date() < end { _ = RunLoop.main.run(mode: .default, before: min(end, Date(timeIntervalSinceNow: 0.005))) }
}

final class AcceptancePanel: NSPanel {
    override var canBecomeKey: Bool { false }
}

func ocr(_ image: CGImage?, _ region: CGRect?, pointWidth: CGFloat) -> [String] {
    guard let image else { return [] }
    var cropped = image
    if let region {
        let scale = CGFloat(image.width) / pointWidth
        let rect = CGRect(x: region.minX * scale, y: region.minY * scale, width: region.width * scale, height: region.height * scale)
            .intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
        guard !rect.isEmpty, let c = image.cropping(to: rect) else { return [] }
        cropped = c
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    do { try VNImageRequestHandler(cgImage: cropped).perform([request]) }
    catch { print("OCR failed: \(error)") }
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}

func scoreRead(_ lines: [String]) -> (Int, Int)? {
    let joined = lines.joined(separator: " ")
    let numbers = joined.split { !$0.isNumber }.compactMap { Int($0) }.filter { $0 >= 30 && $0 < 200 }
    return numbers.count >= 2 ? (numbers[0], numbers[1]) : nil
}

@MainActor
enum Game {
    static let recording: Recording = {
        if let path = ProcessInfo.processInfo.environment["SCORELINE_ACCEPTANCE_RECORDINGS"] {
            return Recording.load(root: URL(fileURLWithPath: path), sport: "basketball_nba", event: "401909285")
        }
        let real = Recording.load(sport: "basketball_nba", event: "401909285")
        if !real.snapshots.isEmpty { return real }
        let fixtures = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("Tests/Fixtures/theater")
        return Recording.load(root: fixtures, sport: "basketball_nba", event: "401909285")
    }()
    static let header: JSON = recording.summary(recording.snapshots.last!)!["header"]
    static func team(_ side: String) -> (id: String, abbreviation: String, name: String) {
        let c = header["competitions"][0]["competitors"].array.first { $0["homeAway"].string == side }!
        return (c["team"]["id"].string ?? "", c["team"]["abbreviation"].string ?? "", c["team"]["displayName"].string ?? "")
    }
    static let away = team("away"), home = team("home")
    static func competitor(_ t: (id: String, abbreviation: String, name: String), score: String?) -> Competitor {
        Competitor(id: "espn-basketball-\(t.id)", name: t.name, abbreviation: t.abbreviation, score: score, logo: nil, isWinner: false, color: nil)
    }

    static func event(at t: PTime) -> Event {
        let row = recording.rows.last { ($0.json["at"].double ?? 0) <= t }?.json
        var e = Event(id: "espn-401909285",
                      content: .match(top: competitor(away, score: row?["score"]["away"].string ?? "0"),
                                      bottom: competitor(home, score: row?["score"]["home"].string ?? "0")),
                      state: .live, start: Date(timeIntervalSince1970: t - 7200),
                      detail: row.map { "\($0["clock"].string ?? "") - \(Ordinal.string($0["period"].int ?? 4))" } ?? "Live",
                      caption: nil, link: nil, ref: .espn(path: NBADetail.path, id: "401909285", sport: .basketball))
        if let row, let seconds = NBADetail.seconds(row["clock"].string ?? ""), let period = row["period"].int {
            e.clock = GameClock(seconds: seconds, sampledAt: Date(timeIntervalSince1970: t), period: period, direction: .down,
                                display: e.detail ?? "", running: false)
        }
        return e
    }

    static func detail(_ snapshot: Recording.Snapshot) -> GameDetail? {
        guard let summary = recording.summary(snapshot) else { return nil }
        return ESPNDetail.parse(summary: summary, board: nil, path: NBADetail.path, id: "401909285", sport: .basketball,
                                event: event(at: snapshot.arrived))
    }
}

@MainActor
final class Box {
    var probe: PageProbe?
    var court: TheaterFrameReport?
    var frames = 0
}

@MainActor
final class Page {
    let window: AcceptancePanel
    let box = Box()
    let width: CGFloat
    init(store: ScoreStore, harness: BroadcastHarness, width: CGFloat = 520, height: CGFloat = 1300) {
        self.width = width
        window = AcceptancePanel(contentRect: NSRect(x: -4000, y: 200, width: width, height: height), styleMask: [.borderless, .nonactivatingPanel],
                       backing: .buffered, defer: false)
        window.alphaValue = 0
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .darkAqua)
        let layout = PanelLayout.resolve(width: width, from: PanelLayout())
        let root = DetailView(snapshot: Game.event(at: Game.recording.snapshots[0].arrived), onBack: {})
            .environment(store)
            .environment(\.panelLayout, layout)
            .environment(\.widthClass, layout.page)
            .environment(\.glassStandIn, true)
            .environment(\.broadcastHarness, harness)
            .environment(\.pageProbe) { [box] in box.probe = $0 }
            .environment(\.theaterFrameProbe) { [box] in
                box.court = $0
                box.frames += 1
            }
            .frame(width: width, height: height)
            .background(Color(white: 0.12))
            .environment(\.colorScheme, .dark)
            .environment(\.locale, Locale(identifier: "en_US"))
        window.contentView = NSHostingView(rootView: root)
        window.orderFrontRegardless()
    }

    func rect(_ section: String) -> CGRect? {
        guard let geometry = box.probe?.geometry, let frame = geometry.frames[section] else { return nil }
        let viewport = geometry.viewportFrame
        return CGRect(x: viewport.minX + frame.minX, y: viewport.minY + (frame.minY - geometry.visible.minY), width: frame.width, height: frame.height)
    }

    var hero: CGRect? { rect(PageGeometry.hero) }

    func snapshot() -> CGImage? {
        guard let view = window.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: rep)
        return rep.cgImage
    }
}

struct Reading {
    var t: PTime
    var p: PTime
    var shown: ScoreLine?
    var court: TheaterFrameReport?
    var image: CGImage?
    /// The newest play the timeline has told (not history), and whether it was anchored.
    var told: String? = nil
}

@main
struct Harness {
    @MainActor
    static func main() {
        HTTP.stubProtocol = Offline.self
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        let recording = Game.recording
        guard let last = recording.snapshots.last, recording.summary(last) != nil else {
            print("FAIL  NBA 401909285 recording is missing or unreadable")
            exit(66)
        }
        print("Recording: \(recording.snapshots.count) snapshots; \(Game.away.name) at \(Game.home.name)")
        let suite = "scoreline.acceptance.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let store = ScoreStore(defaults: defaults)
        // The Live View (the court) and the hero, nothing between them.
        for section: DetailView.Section in [.court, .flow, .leaders, .box, .injuries, .whereToWatch, .table, .stats] {
            store.modules.hide(section, on: .nba, true)
        }
        let t0 = recording.snapshots[0].arrived
        let harness = BroadcastHarness(now: t0)
        let page = Page(store: store, harness: harness)
        pump(1.0)

        var inputs: [(t: PTime, kind: Int)] = []
        let end = t0 + 600
        for t in stride(from: t0, through: end, by: 30) { inputs.append((t, 0)); inputs.append((t + 0.001, 2)) }
        for t in stride(from: t0 + 5, through: end, by: 5) { inputs.append((t, 1)) }
        inputs.sort { $0.t < $1.t }
        func latest(_ t: PTime) -> Recording.Snapshot? { recording.snapshots.last { $0.arrived <= t } }
        var readings: [Reading] = []
        var longestWait = 0.0
        var lastSummary: PTime?, lastCore: PTime?
        var t = t0
        var i = 0
        while true {
            let wake = harness.broadcast?.engine?.nextWake(after: t) ?? .infinity
            // The court between the broadcast's wakes too: a step every 2 s of the recording.
            let next = min(i < inputs.count ? inputs[i].t : .infinity, wake, t + 2)
            guard next.isFinite, next <= end else { break }
            t = next
            harness.now = t
            var delivered = false
            while i < inputs.count, inputs[i].t <= t {
                let input = inputs[i]
                i += 1
                guard let snapshot = latest(input.t) else { continue }
                switch input.kind {
                case 0 where snapshot.arrived != lastSummary:
                    if let d = Game.detail(snapshot) { harness.deliver(d); lastSummary = snapshot.arrived; delivered = true }
                case 1 where snapshot.arrived != lastCore:
                    if let plays = recording.summary(snapshot)?["plays"].array { harness.deliver(core: plays); lastCore = snapshot.arrived; delivered = true }
                case 2:
                    harness.deliver(board: Game.event(at: input.t))
                    delivered = true
                default:
                    break
                }
                pump(0.02)
            }
            if !delivered { harness.tick() }
            // The director plans off the main actor: let a plan land and the frame redraw (on the virtual clock it waits).
            pump(0.15)
            var waited = 0.0
            while waited < 30, page.box.court?.note.contains("busy true") == true || TheaterDebug.planning > 0 {
                pump(0.05)
                waited += 0.05
            }
            if waited >= 30 { print(String(format: "  (step +%.1f s: a plan still in flight after 30 s real)", t - t0)) }
            longestWait = max(longestWait, waited)
            pump(0.05)
            let b = harness.broadcast
            let score = b?.engine?.timeline.presentedScore(at: b?.p ?? 0)
            let timeline = b?.engine?.timeline
            let newestTold = timeline.flatMap { tl in tl.records.prefix(tl.toldCount).last { $0.told != .history }?.id }
            readings.append(Reading(t: t, p: b?.p ?? 0, shown: Broadcast.shown(score, floor: b?.floor), court: page.box.court,
                                    image: nil, told: newestTold))
            if readings.count % 25 == 1 {
                print(String(format: "  step %d +%.0f s p=%.1f: court %@ t=%.2f · %@", readings.count, t - t0, b?.p ?? 0, page.box.court?.play ?? "rest",
                             page.box.court?.clipTime ?? -1, page.box.court?.note ?? "no frame"))
            }
        }
        print("Stepped \(readings.count) times over \(Int(end - t0)) s; the court drew \(page.box.frames) frames.")
        print(String(format: "Longest wait for a plan (real seconds, optimized DEBUG harness): %.2f", longestWait))

        var changes = 0, together = 0, beforeClear = 0, inTime = 0, late = 0
        var lines: [String] = []
        for k in 1..<readings.count {
            let before = readings[k - 1], after = readings[k]
            guard let was = before.shown, let now = after.shown, was != now else { continue }
            changes += 1
            let play = harness.broadcast?.engine?.timeline.records.first { $0.entry.score == now }?.id
            let at = after.court, prior = before.court
            func reached(_ r: TheaterFrameReport?) -> Bool {
                guard let r, r.play == play, let d = r.decisive else { return false }
                return r.clipTime >= d - 1.0 / 60
            }
            let landed = reached(at), early = reached(prior)
            // Placed by the director before p reached it (its anchor published in time), or come too late for the court
            // (it arrived after its binding horizon: the timeline tells it as it comes, the court as a catch-up).
            let placed = play.map { id in prior?.placed.contains(id) == true } ?? false
            if placed { inTime += 1 } else { late += 1 }
            if landed, placed { together += 1 }
            if !early { beforeClear += 1 }
            if let id = play, let r = harness.broadcast?.engine?.timeline.record(id) {
                lines.append(String(format: "      %@ presentAt %.2f, p now %.2f, T %.2f, told %@ · %@", id, r.presentAt, after.p, at?.T ?? -1, "\(String(describing: r.told))",
                                    at?.note ?? ""))
            }
            lines.append(String(format: "  +%.1f s  %d–%d → %d–%d  play %@: court %@ t=%.2f (decisive %@) · the step before %@ t=%.2f",
                                after.t - t0, was.away, was.home, now.away, now.home, play ?? "?", at?.play ?? "rest", at?.clipTime ?? -1,
                                at?.decisive.map { String(format: "%.2f", $0) } ?? "-", prior?.play ?? "rest", prior?.clipTime ?? -1))
        }
        for l in lines { print(l) }
        print("Presented score changes: \(changes)")
        check(page.box.frames > 0 && readings.contains { $0.court?.play != nil }, "the court is the director's (its frames tell the plays)",
              "\(page.box.frames) frames")
        check(changes >= 5, "the score changed on the page during the slice", "\(changes)")
        print("Score changes the director had placed in time: \(inTime); arrived too late for the court (told as they came): \(late)")
        check(inTime > 0 && together == inTime,
              "at each change of the presented score the director placed in time, the court's frame at that step is the scoring play's decisive frame",
              "\(together)/\(inTime)")
        check(beforeClear == changes, "…and the step before, the court hadn't reached it (the score never runs ahead of the court)",
              "\(beforeClear)/\(changes)")

        // At every step: the court's newest decisive play is the timeline's newest told play (one scheduler).
        var compared = 0, disagree: [String] = []
        for r in readings {
            guard let told = r.told, let court = r.court?.newest else { continue }
            compared += 1
            if told != court, disagree.count < 8 {
                disagree.append(String(format: "+%.1f s told %@ court %@", r.t - t0, String(told.suffix(3)), String(court.suffix(3))))
                let tl = harness.broadcast?.engine?.timeline
                let tr = tl?.record(told), cr = tl?.record(court)
                print(String(format: "    disagree +%.1f s p=%.2f T=%.2f: told %@ presentAt %.2f toldAt %.2f %@ · court %@ presentAt %.2f toldAt %.2f · %@",
                             r.t - t0, r.p, r.court?.T ?? -1, String(told.suffix(3)), tr?.presentAt ?? -1, tr?.toldAt ?? -1,
                             "\(String(describing: tr?.told))", String(court.suffix(3)), cr?.presentAt ?? -1, cr?.toldAt ?? -1, r.court?.note ?? ""))
            }
            if told != court, disagree.count >= 8 { disagree.append("…") }
        }
        check(compared > 50 && disagree.isEmpty, "at every step the court's newest decisive play is the timeline's newest told play",
              "\(compared) steps; " + disagree.prefix(9).joined(separator: "; "))
        let overrides = harness.broadcast?.engine?.timeline.guardOverrides ?? []
        print("Order-guard overrides (an anchored play told past the guard): \(overrides.count) \(overrides.map { String($0.suffix(3)) })")
        let uncovered = harness.broadcast?.engine?.timeline.uncoveredTells ?? []
        print("Told without the theater's anchor (none within the wait): \(uncovered.count) \(uncovered.map { String($0.suffix(3)) })")

        if ProcessInfo.processInfo.environment["SCORELINE_ACCEPTANCE_PIXELS"] == "1" {
            pump(0.3)
            let image = page.snapshot()
            print("Hero crop: \(String(describing: page.hero)); image \(image?.width ?? 0) × \(image?.height ?? 0)")
            let lines = ocr(image, page.hero, pointWidth: page.width)
            let read = scoreRead(lines)
            let expected = readings.last?.shown
            check(read != nil && read?.0 == expected?.away && read?.1 == expected?.home,
                  "the rendered hero pixels show the presented score", "OCR: \(lines)")
            if let image {
                try? NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?
                    .write(to: URL(fileURLWithPath: out).appendingPathComponent("presented-page.png"))
            }
        }

        // Opened mid-run with the Live View folded, then unfolded: no tell time changes (the director plans unseen too).
        print("First page: peak outstanding plans \(TheaterDebug.most), outstanding before teardown \(TheaterDebug.planning)")
        page.window.contentView = nil
        page.window.orderOut(nil)
        pump(0.3)
        // A detached bake can finish after SwiftUI removes its page. Let the old
        // page drain before measuring a second independent director; the global
        // counter includes queued requests, not only the serial bakery's work.
        var drained = 0.0
        while TheaterDebug.planning > 0, drained < 30 {
            pump(0.05)
            drained += 0.05
        }
        print("After teardown: peak outstanding plans \(TheaterDebug.most), outstanding \(TheaterDebug.planning), drained for \(drained) s")
        check(TheaterDebug.planning == 0, "the removed page finishes its outstanding plan before the next page opens")
        store.modules.fold(.liveView, on: .nba, true)
        let open = t0 + 330
        let harness2 = BroadcastHarness(now: open)
        let page2 = Page(store: store, harness: harness2)
        pump(1.0)
        var t2 = open
        var i2 = inputs.firstIndex { $0.t > open } ?? inputs.count
        var lastSummary2: PTime?, lastCore2: PTime?
        var toldAtAnchor: [String: Bool] = [:]
        func run(until end: PTime) {
            while true {
                let wake = harness2.broadcast?.engine?.nextWake(after: t2) ?? .infinity
                let next = min(i2 < inputs.count ? inputs[i2].t : .infinity, wake, t2 + 2)
                guard next.isFinite, next <= end else { break }
                t2 = next
                harness2.now = t2
                var delivered = false
                while i2 < inputs.count, inputs[i2].t <= t2 {
                    let input = inputs[i2]
                    i2 += 1
                    guard let snapshot = latest(input.t) else { continue }
                    switch input.kind {
                    case 0 where snapshot.arrived != lastSummary2:
                        if let d = Game.detail(snapshot) { harness2.deliver(d); lastSummary2 = snapshot.arrived; delivered = true }
                    case 1 where snapshot.arrived != lastCore2:
                        if let plays = recording.summary(snapshot)?["plays"].array { harness2.deliver(core: plays); lastCore2 = snapshot.arrived; delivered = true }
                    case 2:
                        harness2.deliver(board: Game.event(at: input.t))
                        delivered = true
                    default:
                        break
                    }
                    pump(0.02)
                }
                if !delivered { harness2.tick() }
                pump(0.4)
                // Folded, the court draws no frames to say it's planning: wait on the director itself (on the virtual
                // clock a plan takes no time, as a release build's nearly does).
                var waited2 = 0.0
                while waited2 < 30, TheaterDebug.planning > 0 {
                    pump(0.05)
                    waited2 += 0.05
                }
                longestWait = max(longestWait, waited2)
                // Each play as it's told: anchored by the director (on time), not by the fallback?
                if let tl = harness2.broadcast?.engine?.timeline {
                    for r in tl.records.prefix(tl.toldCount) where r.told != nil && r.told != .history && toldAtAnchor[r.id] == nil {
                        toldAtAnchor[r.id] = tl.anchors[r.id] != nil && r.told == .onTime && !tl.uncoveredTells.contains(r.id)
                        print(String(format: "    folded: told %@ %@ at p %.2f presentAt %.2f anchor %@ · anchors %d covered %@",
                                     String(r.id.suffix(3)), "\(String(describing: r.told))", harness2.broadcast?.p ?? 0, r.presentAt,
                                     tl.anchors[r.id].map { String(format: "%.2f", $0) } ?? "none", tl.anchors.count,
                                     tl.covered.map { "\($0.count)" } ?? "nil"))
                    }
                }
            }
        }
        // The first summary and core look at the open.
        if let snapshot = latest(open) {
            if let d = Game.detail(snapshot) { harness2.deliver(d); lastSummary2 = snapshot.arrived }
            if let plays = recording.summary(snapshot)?["plays"].array { harness2.deliver(core: plays); lastCore2 = snapshot.arrived }
            harness2.deliver(board: Game.event(at: open))
            pump(0.5)
        }
        run(until: open + 150)
        func untold() -> [String: PTime] {
            guard let tl = harness2.broadcast?.engine?.timeline else { return [:] }
            return Dictionary(uniqueKeysWithValues: tl.records.dropFirst(tl.toldCount).map { ($0.id, $0.presentAt) })
        }
        let folded = untold(), anchoredFolded = harness2.broadcast?.engine?.timeline.anchors.count ?? 0
        // Told while folded: each at the director's anchor (it plans unseen), none by the fallback.
        let toldFolded = toldAtAnchor.keys.sorted()
        let anchoredTold = toldFolded.filter { toldAtAnchor[$0] == true }
        print(String(format: "Longest wait for a plan, folded run included (real s): %.2f", longestWait))
        print("Told while folded: \(toldFolded.count), each at its anchor then: \(anchoredTold.count) \(toldFolded.map { String($0.suffix(3)) })")
        check(toldFolded.count >= 3 && anchoredTold.count == toldFolded.count,
              "opened mid-run with the Live View folded: every play told while folded is told at the director's anchor",
              "\(anchoredTold.count)/\(toldFolded.count)")
        store.modules.fold(.liveView, on: .nba, false)
        pump(1.5)
        harness2.tick()
        pump(1.0)
        let unfolded = untold()
        let shared = Set(folded.keys).intersection(unfolded.keys)
        let moved = shared.map { abs((folded[$0] ?? 0) - (unfolded[$0] ?? 0)) }.max() ?? 0
        print(String(format: "Opened at +%.0f s folded: %d plays anchored while folded; %d untold plays compared across the unfold; largest move %.4f s",
                     open - t0, anchoredFolded, shared.count, moved))
        check(anchoredFolded > 0 && !shared.isEmpty && moved < 1e-3,
              "opened mid-run with the Live View folded, then unfolded: no play's tell time changes (the director plans unseen too)",
              String(format: "%d anchored, %d compared, moved %.4f s", anchoredFolded, shared.count, moved))
        page2.window.orderOut(nil)
        store.modules.fold(.liveView, on: .nba, false)
        check(TheaterDebug.most <= 1, "at most one plan in flight at a time, whatever the page did", "most \(TheaterDebug.most)")

        let failed = results.filter { !$0.0 }.count
        print("\n\(results.count - failed) passed, \(failed) failed")
        defaults.removePersistentDomain(forName: suite)
        exit(failed == 0 ? 0 : 1)
    }
}
