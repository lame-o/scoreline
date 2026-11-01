import AppKit
import SwiftUI
import Vision

// Real DetailView, captured halftime inputs, isolated preferences, no network.
final class Offline: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}
final class TestPanel: NSPanel { override var canBecomeKey: Bool { false } }
@MainActor final class Probe { var page: PageProbe?; var frame: TheaterFrameReport? }
@MainActor func pump(_ seconds: Double) {
    let end = Date(timeIntervalSinceNow: seconds)
    while Date() < end { _ = RunLoop.main.run(mode: .default, before: min(end, Date(timeIntervalSinceNow: 0.005))) }
}
@MainActor func settle() {
    pump(0.2)
    let end = Date(timeIntervalSinceNow: 30)
    while TheaterDebug.planning > 0 && Date() < end { pump(0.02) }
    pump(0.3)
}
func words(_ image: CGImage) -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    try? VNImageRequestHandler(cgImage: image).perform([request])
    return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
}
@main struct PresentationAcceptance {
    @MainActor static func main() throws {
        HTTP.stubProtocol = Offline.self
        NSApplication.shared.setActivationPolicy(.prohibited)
        let out = "build/presentation-acceptance"
        try FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
        let fixture = JSON(data: try Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/nfl-cle-pit-halftime.json")))
        let start = EventTime.parse("2026-11-01T19:43:00Z")!
        func team(_ id: String, _ name: String, _ code: String, _ score: String) -> Competitor {
            Competitor(id: "espn-football-\(id)", name: name, abbreviation: code, score: score, logo: nil, isWinner: false)
        }
        let event = Event(id: "espn-401873027", content: .match(top: team("5", "Browns", "CLE", "6"), bottom: team("23", "Steelers", "PIT", "20")),
                          state: .live, start: Date(timeIntervalSince1970: start - 7200), detail: "Halftime", caption: nil, link: nil,
                          ref: .espn(path: "football/nfl", id: "401873027", sport: .football))
        var detail = ESPNDetail.parse(summary: fixture, board: nil, path: "football/nfl", id: "401873027", sport: .football, event: event)
        detail.broadcastPlays = BroadcastLanes.entries(fixture["items"].array, sport: .football, policy: BroadcastLanes.policy(.football, path: "football/nfl"))
        detail.football = GameDetail.Football(downDistance: "1st & 10", ballX: 34, lineToGainX: 44, possession: .top, redZone: false,
                                             topTimeouts: 0, bottomTimeouts: 0, lastPlay: "END QUARTER 2")
        var passed = 0, failed = 0
        func check(_ ok: Bool, _ name: String) { print("\(ok ? "PASS" : "FAIL") \(name)"); if ok { passed += 1 } else { failed += 1 } }
        for scheme in [ColorScheme.dark, .light] {
            let suite = "scoreline.presentation-check.\(UUID().uuidString)"
            let defaults = UserDefaults(suiteName: suite)!
            let store = ScoreStore(defaults: defaults)
            let harness = BroadcastHarness(now: start)
            let probe = Probe()
            let layout = PanelLayout.resolve(width: 520, from: PanelLayout())
            let window = TestPanel(contentRect: NSRect(x: -4000, y: 200, width: 520, height: 1100), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            window.alphaValue = 0; window.isReleasedWhenClosed = false
            window.appearance = NSAppearance(named: scheme == .dark ? .darkAqua : .aqua)
            let root = DetailView(snapshot: event, onBack: {})
                .environment(store).environment(\.panelLayout, layout).environment(\.widthClass, layout.page)
                .environment(\.glassStandIn, true).environment(\.broadcastHarness, harness)
                .environment(\.pageProbe) { probe.page = $0 }.environment(\.theaterFrameProbe) { probe.frame = $0 }
                .frame(width: 520, height: 1100).background(scheme == .dark ? Color(white: 0.12) : .white)
                .environment(\.colorScheme, scheme).environment(\.locale, Locale(identifier: "en_US"))
            window.contentView = NSHostingView(rootView: root)
            window.orderFrontRegardless(); pump(0.5)
            harness.deliver(detail); settle()
            check(harness.broadcast?.present(event).detail == "Halftime", "\(scheme): actual page opens on halftime")
            for delta in stride(from: 5.0, through: 90, by: 5) {
                harness.now = start + delta
                harness.broadcast?.observe(status: fixture["status"])
                harness.broadcast?.noteRead()
                harness.tick(); settle()
            }
            func snapshot() -> CGImage? {
                guard let view = window.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
                view.cacheDisplay(in: view.bounds, to: rep); return rep.cgImage
            }
            guard let image = snapshot() else { check(false, "page renders"); continue }
            let path = "\(out)/halftime-\(scheme).png"
            let rep = NSBitmapImageRep(cgImage: image)
            try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
            let text = words(image).joined(separator: " ").lowercased()
            print("Rendered text: \(text)")
            check(text.contains("halftime") && !text.contains("1:10"), "\(scheme): rendered status pixels show halftime, no first-quarter clock")
            check(!text.contains("cle ball") && !text.contains("pit ball") && !text.contains("1st & 10"), "\(scheme): stale possession and down are absent during halftime")
            check(text.contains("home") && text.contains("away") && text.contains("team colors"), "\(scheme): player-color legend identifies home and away")
            check(probe.frame != nil, "\(scheme): the real directed football stage rendered")
            for delta in stride(from: 95.0, through: 180, by: 5) {
                harness.now = start + delta
                harness.broadcast?.observe(status: fixture["status"])
                harness.broadcast?.noteRead()
                harness.tick(); settle()
            }
            check(harness.broadcast?.presented.isInterval == true && harness.broadcast?.footballPossession(FootballFeed.Teams(event, topIsHome: false)) == nil,
                  "\(scheme): prolonged halftime stays stopped, without possession")
            window.orderOut(nil); window.contentView = nil; settle()
            defaults.removePersistentDomain(forName: suite)
        }
        print("\n\(passed) passed, \(failed) failed")
        exit(failed == 0 ? 0 : 1)
    }
}
