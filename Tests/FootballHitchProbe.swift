import AppKit
import SwiftUI
import simd

// Opt-in diagnostic: --football-hitch-probe [--native-only|--offline-only|--describe-only].
// Uses production timing, scripts, painters and frame tiers in an isolated
// football stage, not the entire detail page or its broadcast publications.
// Native render callbacks are not display-present timestamps or measured FPS.
// No performance assertion: run the optimized executable on a quiet machine.
@MainActor final class FootballHitchCase {
    let name: String
    let clip: GridClip
    let chain: PlanChain<GridClip>
    let range: ClosedRange<Double>
    let scratch = FrameScratch()
    let cast: TheaterCast
    let names = FootballStatus.Names(top: "Cowboys", bottom: "Eagles", topColor: "002a5c", bottomColor: "06424d")
    let labels = TheaterLabels.make(kits: nil, scheme: .dark, teams: ("Cowboys", "Eagles"))
    let size = CGSize(width: 540, height: 270)
    let ink = TheaterInk(.dark)
    let teams = FootballTeams(offense: Uniform(.green), defense: Uniform(.blue))
    var callbacks: [(wall: Double, clip: Double)] = []

    init(name: String, clip: GridClip, range: ClosedRange<Double>) {
        self.name = name; self.clip = clip; self.range = range
        let ids = clip.figures.indices.map { ActorID(UInt16($0)) }
        let placement = ClipPlacement(clip: clip, offset: 0, start: 0, cast: ids)
        let plan = Plan(revision: 1, start: 0, horizon: max(range.upperBound + 1, clip.length.isFinite ? clip.length : range.upperBound + 1),
                        state: nil, placements: [placement], actors: Dictionary(uniqueKeysWithValues: zip(ids, clip.figures)))
        let baked = TheaterBake.bake(plan)
        var chain = PlanChain<GridClip>(); chain.splice(baked, now: 0); self.chain = chain
        cast = clip.script.cast(clip.scene, offense: clip.offense, people: [:], scope: name)
    }

    func drawn(_ t: Double) -> (clip: GridClip, t: Double, world: FootballFrame.World)? {
        chain.sample(t, into: scratch)
        return GridPainter.frame(chain, scratch, size: size)
    }

    func frame(_ drawn: (clip: GridClip, t: Double, world: FootballFrame.World)) -> FootballFrame {
        let status = status(drawn.t)
        let tags = TheaterTags(cast: cast, labels: labels, pointer: TheaterPointer(), at: Date(timeIntervalSince1970: drawn.t),
                               reduceMotion: false, status: status.tag, flip: false)
        return FootballFrame(scene: clip.scene, script: clip.script, t: drawn.t, teams: teams, ink: ink, size: size, tags: tags, world: drawn.world)
    }

    func status(_ t: Double) -> TheaterStatus {
        if let scene = clip.scene {
            let banner = clip.script.banner.map { t >= $0.at - 0.3 && t < $0.until + 0.3 } ?? false
            return banner ? TheaterStatus() : FootballStatus.replay(scene, script: clip.script, t: t, names: names)
        }
        guard let idle = clip.idle else { return TheaterStatus() }
        return FootballStatus.idle(idle, stoppage: nil, script: clip.script, t: t, names: names, situation: "2nd & 4 at DAL 41",
                                   timeoutsLeft: (3, 3))
    }

    func callback(_ t: Double) {
        let wall = Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW)) / 1e9
        if callbacks.last.map({ abs($0.clip - t) > 1e-6 }) ?? true { callbacks.append((wall, t)) }
    }

    func describe() {
        let s = clip.script
        print("\nCASE \(name) \(clip.scene?.text ?? "between-snap huddle")")
        print(String(format: "script duration %.3f; clip duration %.3f; measured clip window %.3f...%.3f", s.duration,
                     clip.length.isFinite ? clip.length : clip.warp.clip(s.duration), range.lowerBound, range.upperBound))
        if s.stamp.isFinite {
            let decisive = GridClip.decisive(s) ?? s.stamp
            print(String(format: "script decisive %.3f stamp %.3f settle %.3f; clip decisive %.3f stamp %.3f settle %.3f; stamp→settle %.3f script / %.3f clip seconds",
                         decisive, s.stamp, s.settle, clip.warp.clip(decisive), clip.warp.clip(s.stamp), clip.warp.clip(s.settle),
                         s.settle - s.stamp, clip.warp.clip(s.settle) - clip.warp.clip(s.stamp)))
        }
        let tiers = chain.tiers.filter { $0.until >= range.lowerBound && $0.from <= range.upperBound }
        print("tiers " + tiers.map { String(format: "%.3f...%.3f@%d", max($0.from, range.lowerBound), min($0.until, range.upperBound), Int($0.fps)) }.joined(separator: ", "))
        print("clock " + stride(from: range.lowerBound, through: range.upperBound, by: 0.5).map { t in
            let rate = (clip.local(t + 0.005) - clip.local(t - 0.005)) / 0.01
            return String(format: "clip %.2f→script %.2f (%.3fx)", t, clip.local(t), rate)
        }.joined(separator: "; "))
    }
}

@MainActor struct FootballNativeHitchView: View {
    let probe: FootballHitchCase
    let clock: PresentationClock
    let time: TheaterTime
    var body: some View {
        TimelineView(TheaterSchedule(tiers: probe.chain.tiers, time: time, clock: clock, running: true)) { context in
            let t = time.at(context.date.timeIntervalSince1970, clock: clock)
            if let drawn = probe.drawn(t) {
                ZStack(alignment: .topLeading) {
                    probe.frame(drawn).equatable()
                    TheaterStatusTag(status: probe.status(drawn.t), height: probe.size.height).padding(.top, 8)
                    Canvas { _, _ in probe.callback(t) }.allowsHitTesting(false)
                }
            }
        }
        .frame(width: 540, height: 270)
        .background(Color(white: 0.12))
        .environment(\.colorScheme, .dark)
    }
}

final class FootballHitchPanel: NSPanel { override var canBecomeKey: Bool { false } }

enum FootballHitchProbe {
    @MainActor static func main() throws {
        setbuf(stdout, nil)
        NSApplication.shared.setActivationPolicy(.prohibited)
        let json = JSON(data: try Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("mnf-dal-phi-plays.json")))
        let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
        var cases: [FootballHitchCase] = []
        for (name, suffix) in [("rush-tackle", "63"), ("completion-tackle", "85"), ("touchdown", "385")] {
            guard let item = json["items"].array.first(where: { $0["id"].string == "401873009" + suffix }),
                  let scene = FootballScene.parse(item, teams: teams) else { fatalError("Missing \(name)") }
            let script = FootballScript(scene)
            let clip = GridClip(script, scene: scene, idle: nil, offense: scene.offense ?? .top)
            let anchor = clip.decisive ?? clip.warp.clip(script.stamp)
            cases.append(FootballHitchCase(name: name, clip: clip, range: max(anchor - 1.2, 0)...min(max(clip.warp.clip(script.settle) + 0.5, anchor + 2), clip.length)))
        }
        let idle = FootballIdle(phase: .between, offense: .top, yard: 41, gain: 45)
        let idleScript = FootballScript(idle: idle)
        let idleClip = GridClip(idleScript, scene: nil, idle: idle, offense: .top)
        cases.append(FootballHitchCase(name: "huddle", clip: idleClip, range: 0...min(idleClip.warp.clip(8), 12)))
        for probe in cases { probe.describe() }
        if CommandLine.arguments.contains("--describe-only") { return }
        if !CommandLine.arguments.contains("--native-only") {
            for probe in cases { offline(probe) }
        }
        if !CommandLine.arguments.contains("--offline-only") {
            for probe in cases { native(probe) }
        }
    }

    static func summary(_ values: [Double]) -> String {
        guard !values.isEmpty else { return "no samples" }
        let s = values.sorted()
        func q(_ fraction: Double) -> Double { s[min(Int(Double(s.count - 1) * fraction), s.count - 1)] }
        return String(format: "n=%d p50=%.3f p95=%.3f p99=%.3f max=%.3f ms", s.count, q(0.5) * 1000, q(0.95) * 1000, q(0.99) * 1000, s.last! * 1000)
    }

    @MainActor static func offline(_ probe: FootballHitchCase) {
        var sampled: [Double] = [], canvases: [Double] = [], total: [Double] = []
        // A first frame warms SwiftUI/CoreText; exclude only that explicit warmup.
        if let drawn = probe.drawn(probe.range.lowerBound) { _ = ImageRenderer(content: probe.frame(drawn)).cgImage }
        for t in stride(from: probe.range.lowerBound, through: probe.range.upperBound, by: 1.0 / 60) {
            autoreleasepool {
                let start = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
                guard let drawn = probe.drawn(t) else { return }
                sampled.append(Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - start) / 1e9)
                TheaterProbe.canvases.removeAll(keepingCapacity: true)
                TheaterProbe.recording = true
                let renderer = ImageRenderer(content: probe.frame(drawn).frame(width: 540, height: 270))
                renderer.scale = 2
                _ = renderer.cgImage
                TheaterProbe.recording = false
                canvases.append(contentsOf: TheaterProbe.canvases.map(\.seconds))
                total.append(Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - start) / 1e9)
            }
        }
        print("OFFLINE \(probe.name): sample+pose \(summary(sampled)); Canvas \(summary(canvases)); ImageRenderer total \(summary(total))")
    }

    @MainActor static func native(_ probe: FootballHitchCase) {
        let begin = Date().timeIntervalSince1970
        var clock = PresentationClock()
        clock.update(now: begin, inputs: .init(target: begin - probe.range.lowerBound, cap: begin + 1000))
        var time = TheaterTime(); time.advance(to: begin, ran: clock, then: [], now: clock)
        let panel = FootballHitchPanel(contentRect: NSRect(x: 40, y: 40, width: 540, height: 270),
                               styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.contentView = NSHostingView(rootView: FootballNativeHitchView(probe: probe, clock: clock, time: time))
        probe.callbacks.removeAll(keepingCapacity: true)
        TheaterProbe.canvases.removeAll(keepingCapacity: true)
        TheaterProbe.recording = true
        panel.orderFrontRegardless()
        let end = begin + probe.range.upperBound - probe.range.lowerBound
        while Date().timeIntervalSince1970 < end {
            _ = RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.003))
        }
        TheaterProbe.recording = false
        panel.orderOut(nil); panel.contentView = nil
        let points = probe.callbacks.filter { probe.range.contains($0.clip) }
        let gaps = zip(points, points.dropFirst()).map { $1.wall - $0.wall }
        let largest = zip(points, points.dropFirst()).sorted { $0.1.wall - $0.0.wall > $1.1.wall - $1.0.wall }.prefix(5)
        print("NATIVE \(probe.name): callback gaps \(summary(gaps)); Canvas \(summary(TheaterProbe.canvases.map(\.seconds)))")
        print("  largest " + largest.map { String(format: "%.2f ms at clip %.3f→%.3f / script %.3f→%.3f", ($0.1.wall - $0.0.wall) * 1000,
                                                   $0.0.clip, $0.1.clip, probe.clip.local($0.0.clip), probe.clip.local($0.1.clip)) }.joined(separator: "; "))
    }
}
