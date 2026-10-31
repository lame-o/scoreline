import SwiftUI

// The theater bench (CHOREOGRAPHY §8.5, §9): the theaters' frame cost and
// continuity, before and after the choreography engine, on recorded games.
//
//   ./test.sh --bench --theater cost [sport…]          per-frame cost of today's frames (sample + pose, the Canvas, allocations)
//   ./test.sh --bench --theater today|engine [sport…]  continuity of today's stages and of the engine (THEATER_TRACE=1: every jump;
//                                                       --twice: the engine run twice, its determinism hashes compared;
//                                                       --real: the recorder's live recordings too, beside the fixtures;
//                                                       --event=ID: that recording only)
//   ./test.sh --bench --theater engine-cost [sport…]   per-frame cost of the engine's frames (sampling + posing, the Canvas, allocations)
//   ./test.sh --bench --theater video <out.mp4>        today and the engine side by side on the NBA fixture's dense stretch
//
// Every number is measured on this machine, inside this process: the Canvas
// is drawn through an offscreen ImageRenderer, timed and counted by
// `TheaterProbe` inside its own closure (so the renderer's own overhead is
// left out); allocations come from libmalloc's logger hook.

@MainActor
enum TheaterBench {
    static let sports = ["basketball", "football", "soccer", "baseball"]

    static func main(_ arguments: [String]) -> Int32 {
        var args = arguments
        let mode = args.isEmpty ? "cost" : args.removeFirst()
        // The allocation counter only where allocations are counted (it sees every malloc).
        if mode.hasSuffix("cost") || args.contains("--cost") { TheaterProbe.install() }
        let wanted = args.filter { !$0.hasPrefix("--") }
        real = args.contains("--real")
        event = args.first { $0.hasPrefix("--event=") }.map { String($0.dropFirst("--event=".count)) }
        let chosen = wanted.isEmpty ? sports : sports.filter { s in wanted.contains { $0.hasPrefix(s) } }
        switch mode {
        case "cost":
            for sport in chosen { print(Cost.render(Cost.today(sport))) }
            return 0
        case "today":
            for sport in chosen {
                for (recording, units) in recordings(sport) {
                    let label = "\(recording.sportDirectory) \(recording.event), today's stage"
                    switch sport {
                    case "basketball": print(Today.basketball(recording, label: label).render(units: units))
                    default: print("  \(label): not yet")
                    }
                }
            }
            return 0
        case "engine":
            for sport in chosen {
                for (recording, units) in recordings(sport) {
                    let label = "\(recording.sportDirectory) \(recording.event), the engine"
                    guard let run = engine(sport, recording, label: label) else { continue }
                    print(run.report.render(units: units))
                    print(String(format: "    determinism hash %016llx", run.hash))
                    // Run again from scratch: the bench is deterministic when both hashes agree.
                    if args.contains("--twice"), let again = engine(sport, recording, label: label) {
                        print(String(format: "    determinism hash, second run %016llx: %@", again.hash, again.hash == run.hash ? "identical" : "DIFFERENT"))
                    }
                }
            }
            return 0
        case "engine-cost":
            for sport in chosen {
                guard let (recording, _) = recordings(sport).first,
                      let run = engine(sport, recording, label: "\(recording.sportDirectory) \(recording.event)", cost: true) else { continue }
                var series = Cost.Series(label: "engine")
                series.pose = zip(run.sampling, run.cost.pose).map { $0 + $1 }
                series.poseAllocations = zip(run.samplingAllocations, run.cost.poseAllocations).map { $0 + $1 }
                series.canvas = run.cost.canvas
                series.canvasAllocations = run.cost.canvasAllocations
                var sampling = Cost.Series(label: "sample")
                sampling.pose = run.sampling
                sampling.poseAllocations = run.samplingAllocations
                print(Cost.render(Cost.Report(sport: sport, size: Cost.size, series: [series, sampling]), title: "the engine's frames (sample + pose, the Canvas)"))
            }
            return 0
        case "video":
            return BenchVideo.run(wanted)
        default:
            print("Unknown theater bench mode: \(mode)")
            return 64
        }
    }

    // MARK: Fixtures

    /// The theater bench's recordings: Tests/Fixtures/theater/<sport>_<league>/<event>.
    static let root = FixtureProtocol.directory.appendingPathComponent("theater")

    /// A sport through the engine (nil: a sport it doesn't know).
    static func engine(_ sport: String, _ recording: Recording, label: String, cost: Bool = false) -> EngineRun.Result? {
        switch sport {
        case "basketball": EngineRun.run(HoopsBench.self, recording, label: label, cost: cost)
        case "football": EngineRun.run(GridBench.self, recording, label: label, cost: cost)
        case "soccer": EngineRun.run(PitchBench.self, recording, label: label, cost: cost)
        case "baseball": EngineRun.run(DiamondBench.self, recording, label: label, cost: cost)
        default: nil
        }
    }

    /// The broadcast's fixtures: soccer's core-lane recording lives there (synthetic until a real one exists).
    static let broadcastRoot = FixtureProtocol.directory.appendingPathComponent("broadcast")

    /// `--real`: the recorder's own folder first (the weekend's live recordings, whole, as they are), then the
    /// fixtures it doesn't have (a fixture cut from a recording is skipped for the whole one).
    static var real = false
    /// `--event=ID`: only that recording.
    static var event: String?

    static func recordings(_ sport: String) -> [(Recording, String)] {
        var roots = sport == "soccer" ? [root, broadcastRoot] : [root]
        if real { roots.insert(Recording.defaultRoot, at: 0) }
        var seen = Set<String>()
        return roots.flatMap { root in
            Recording.sports(root: root).filter { $0.hasPrefix(sport) }.flatMap { dir in
                Recording.events(root: root, sport: dir).filter { e in event.map { e.contains($0) } ?? true }.filter { seen.insert(dir + "/" + $0).inserted }.map {
                    (Recording.load(root: root, sport: dir, event: $0, settle: 0), sport == "soccer" ? "m" : "ft")
                }
            }
        }
    }

    nonisolated static func fixture(_ name: String) -> JSON? {
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent(name)) else { return nil }
        let json = JSON(data: data)
        return json.raw == nil ? nil : json
    }
}

// MARK: - Per-frame cost

extension TheaterBench {
    @MainActor enum Cost {
        /// One kind of frame's numbers: seconds and allocations per frame.
        struct Series {
            var label: String
            var pose: [Double] = []
            var poseAllocations: [Int] = []
            var canvas: [Double] = []
            var canvasAllocations: [Int] = []
        }

        struct Report {
            var sport: String
            var size: CGSize
            var series: [Series] = []
        }

        /// The well's size the frames are drawn at (a 540 pt column, half as tall), at 2× like a Retina display.
        static let size = CGSize(width: 540, height: 270)
        static let scale = 2.0

        /// Today's frames, every 1/60 s of each script while it moves.
        static func today(_ sport: String) -> Report {
            var report = Report(sport: sport, size: size)
            let ink = TheaterInk(.dark)
            switch sport {
            case "basketball":
                let (replays, beats, rests) = Samples.basketball()
                let teams = BasketballTeams(offense: Uniform(.orange), defense: Uniform(.blue))
                for (label, scripts) in [("replay", replays), ("beat", beats), ("rest beat", rests)] {
                    var series = Series(label: label)
                    for (scene, script) in scripts {
                        for t in times(script.duration, active: label == "rest beat" ? script.active : nil) {
                            measure(BasketballFrame(scene: scene, script: script, t: t, teams: teams, ink: ink, size: size),
                                    pose: { $0.benchPosed(size) }, into: &series)
                        }
                    }
                    report.series.append(series)
                }
            case "football":
                let (replays, idles) = Samples.football()
                let teams = FootballTeams(offense: Uniform(.green), defense: Uniform(.blue))
                for (label, scripts) in [("replay", replays), ("idle beat", idles)] {
                    var series = Series(label: label)
                    for (scene, script) in scripts {
                        let windows = label == "idle beat" ? script.beats : nil
                        for t in times(script.duration, active: windows) {
                            measure(FootballFrame(scene: scene, script: script, t: t, teams: teams, ink: ink, size: size),
                                    pose: { $0.benchPosed(size) }, into: &series)
                        }
                    }
                    report.series.append(series)
                }
            case "soccer":
                let (replays, idles) = Samples.soccer()
                let teams = SoccerTeams(attacking: Uniform(.red), defending: Uniform(.blue))
                for (label, scripts) in [("replay", replays), ("idle", idles)] {
                    var series = Series(label: label)
                    for (scene, script) in scripts {
                        for t in times(min(script.duration, label == "idle" ? 12 : .infinity), active: nil) {
                            measure(SoccerFrame(scene: scene, script: script, t: t, teams: teams, ink: ink, size: size),
                                    pose: { $0.benchPosed(size) }, into: &series)
                        }
                    }
                    report.series.append(series)
                }
            case "baseball":
                let (replays, beats) = Samples.baseball()
                let teams = TheaterTeams(batting: .red, fielding: .blue)
                for (label, scripts) in [("replay", replays), ("pitch beat", beats)] {
                    var series = Series(label: label)
                    for (scene, script) in scripts {
                        for t in times(script.duration, active: nil) {
                            measure(PlayFrame(scene: scene, script: script, t: t, teams: teams, ink: ink, size: size),
                                    pose: { $0.benchPosed(size) }, into: &series)
                        }
                    }
                    report.series.append(series)
                }
            default: break
            }
            return report
        }

        /// Every 1/60 s through `duration` (or only inside the windows that move).
        static func times(_ duration: Double, active: [ClosedRange<Double>]?) -> [Double] {
            let end = duration.isFinite ? duration : 0
            let all = stride(from: 0.0, through: end, by: 1.0 / 60).map { $0 }
            guard let active else { return all }
            return all.filter { t in active.contains { $0.contains(t) } }
        }

        /// One frame: its posing on its own (measured), then the whole Canvas drawn offscreen (measured inside the probe).
        static func measure<Frame: View>(_ frame: Frame, pose: (Frame) -> Int, into series: inout Series) {
            let posed = TheaterProbe.measure { pose(frame) }
            series.pose.append(posed.seconds)
            series.poseAllocations.append(posed.allocations)
            TheaterProbe.canvases.removeAll(keepingCapacity: true)
            TheaterProbe.recording = true
            let renderer = ImageRenderer(content: frame.frame(width: size.width, height: size.height))
            renderer.scale = scale
            _ = renderer.cgImage
            TheaterProbe.recording = false
            if let drawn = TheaterProbe.canvases.first {
                series.canvas.append(drawn.seconds)
                series.canvasAllocations.append(drawn.allocations)
            }
        }

        static func render(_ r: Report, title: String = "today's frames") -> String {
            func ms(_ values: [Double], _ q: Double) -> String { String(format: "%.3f", Stats.quantile(values, q) * 1000) }
            func n(_ values: [Int], _ q: Double) -> String { String(format: "%.0f", Stats.quantile(values.map(Double.init), q)) }
            var lines = ["", "== \(r.sport): per-frame cost, \(title) (\(Int(r.size.width))×\(Int(r.size.height)) pt at \(Int(scale))×)"]
            lines.append("  kind          frames  pose ms p50/p99/max      allocs p50/p99   canvas ms p50/p99/max    allocs p50/p99   sum p99")
            var all = Series(label: "all")
            for s in r.series {
                all.pose += s.pose; all.poseAllocations += s.poseAllocations
                all.canvas += s.canvas; all.canvasAllocations += s.canvasAllocations
            }
            for s in r.series + [all] where !s.pose.isEmpty {
                let sum = zip(s.pose, s.canvas).map { $0 + $1 }
                lines.append(String(format: "  %@ %7d  %@/%@/%@  %8@/%@   %@/%@/%@  %8@/%@   %@",
                                    s.label.padding(toLength: 12, withPad: " ", startingAt: 0), s.pose.count, ms(s.pose, 0.5), ms(s.pose, 0.99), ms(s.pose, 1),
                                    n(s.poseAllocations, 0.5), n(s.poseAllocations, 0.99),
                                    ms(s.canvas, 0.5), ms(s.canvas, 0.99), ms(s.canvas, 1),
                                    n(s.canvasAllocations, 0.5), n(s.canvasAllocations, 0.99), ms(sum, 0.99)))
            }
            return lines.joined(separator: "\n")
        }
    }
}

// MARK: - Today's scripts from the fixtures

extension TheaterBench {
    @MainActor enum Samples {
        /// The NBA bench fixture's plays (401909285's 4th quarter): its replays, its beats from the floor
        /// as the beat before left it, and the court between plays' sparse beats.
        static func basketball(limit: Int = 24) -> (replays: [(BasketballScene?, BasketballScript)], beats: [(BasketballScene?, BasketballScript)],
                                                     rests: [(BasketballScene?, BasketballScript)]) {
            let scenes = nbaScenes()
            let ends = HoopsEnds(period: 4, topIsHome: false, flipped: false)
            var replays: [(BasketballScene?, BasketballScript)] = []
            var beats: [(BasketballScene?, BasketballScript)] = []
            var rests: [(BasketballScene?, BasketballScript)] = []
            var lineup: Lineup?
            for scene in scenes {
                if scene.replays {
                    if replays.count < limit { replays.append((scene, BasketballScript(scene, right: ends.right(scene.offense)))) }
                } else if beats.count < limit {
                    let script = BasketballScript(beat: scene, ends: ends, from: lineup, fallback: scene.offense)
                    lineup = script.lineup(at: script.duration)
                    beats.append((scene, script))
                }
                if rests.count < limit / 3, scene.made {
                    let rest = BasketballFlow.rest(after: scene, previous: nil, from: lineup, ends: ends, possession: scene.offense)
                    rests.append((nil, BasketballScript(rest: rest)))
                }
            }
            return (replays, beats, rests)
        }

        /// 401909285's plays as scenes, in ESPN's order (the bench fixture's last snapshot).
        static func nbaScenes() -> [BasketballScene] {
            let root = FixtureProtocol.directory.appendingPathComponent("broadcast")
            let recording = Recording.load(root: root, sport: "basketball_nba", event: "401909285", settle: 0)
            guard let last = recording.snapshots.last, let summary = recording.summary(last) else { return [] }
            let plays = summary["plays"].array
            let teams = nbaTeams(summary)
            return plays.indices.compactMap { BasketballScene.parse(plays, at: $0, teams: teams) }
        }

        /// The summary's teams, the visitors on top (as the page does).
        static func nbaTeams(_ summary: JSON) -> BasketballFeed.Teams {
            let competitors = summary["header"]["competitions"][0]["competitors"].array
            let home = competitors.first { $0["homeAway"].string == "home" }, away = competitors.first { $0["homeAway"].string == "away" }
            return BasketballFeed.Teams(topIsHome: false, topID: away?["team"]["id"].string, bottomID: home?["team"]["id"].string,
                                        topName: away?["team"]["abbreviation"].string ?? "", bottomName: home?["team"]["abbreviation"].string ?? "")
        }

        /// Monday night's DAL at PHI: its snaps' replays, and the field between snaps' beats.
        static func football(limit: Int = 24) -> (replays: [(FootballScene?, FootballScript)], idles: [(FootballScene?, FootballScript)]) {
            guard let json = fixture("mnf-dal-phi-plays.json") else { return ([], []) }
            let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
            let scenes = json["items"].array.compactMap { FootballScene.parse($0, teams: teams) }
            let replays = scenes.prefix(limit).map { scene in
                (Optional(scene), FootballScript(scene, yaw: FieldFacing.yaw(scene.offense, period: scene.period, flipped: false)))
            }
            let idles = scenes.prefix(limit / 3).map { scene -> (FootballScene?, FootballScript) in
                let idle = FootballIdle.make(play: scene, stoppage: nil, rest: FootballScript.Rest(yard: 35, gain: 45), offense: scene.offense ?? .top,
                                             down: nil, kickoff: false, flipped: false)
                return (nil, FootballScript(idle: idle))
            }
            return (Array(replays), idles)
        }

        /// The weekend's soccer moments: their replays, and the pitch between moments.
        static func soccer(limit: Int = 16) -> (replays: [(SoccerScene?, SoccerScript)], idles: [(SoccerScene?, SoccerScript)]) {
            guard let json = fixture("soccer-theater-plays.json") else { return ([], []) }
            var replays: [(SoccerScene?, SoccerScript)] = []
            var idles: [(SoccerScene?, SoccerScript)] = []
            for match in json["matches"].array {
                let lineups = SoccerLineup.lineups(match["rosters"]) { $0 == match["home"]["id"].string ? .top : .bottom }
                for clip in match["clips"].array {
                    let plays = clip.array
                    let keepers = SoccerScene.keepers(in: plays)
                    for i in plays.indices where SoccerScene.isMoment(plays[i]) && replays.count < limit {
                        guard let scene = SoccerScene.parse(plays, at: i, homeTeamID: match["home"]["id"].string, keepers: keepers) else { continue }
                        replays.append((scene, SoccerScript(scene, lineups: lineups)))
                        if idles.count < limit / 4 {
                            let idle = SoccerIdle.make(event: nil, touch: nil, scene: scene, period: scene.period, lineups: lineups, flipped: false)
                            idles.append((nil, SoccerScript(idle: idle)))
                        }
                    }
                }
            }
            return (replays, idles)
        }

        /// World Series Game 3: its plays' replays, and the pitches between them.
        static func baseball(limit: Int = 24) -> (replays: [(PlayScene?, PlayScript)], beats: [(PlayScene?, PlayScript)]) {
            guard let json = fixture("ws-g3-plays.json") else { return ([], []) }
            let plays = json["items"].array
            var names: [String: String] = [:]
            for (id, name) in (json["names"].raw as? [String: String]) ?? [:] { names[id] = name }
            let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
            let results = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
            var replays: [(PlayScene?, PlayScript)] = []
            for i in results where replays.count < limit {
                guard let scene = PlayScene.parse(plays, at: i, side: side, names: names) else { continue }
                replays.append((scene, PlayScript(scene, rest: PlayScript.Rest(bases: scene.basesBefore, bats: scene.bats))))
            }
            var beats: [(PlayScene?, PlayScript)] = []
            for beat in PlayBeat.timeline(plays, mlb: [], names: names) where beats.count < limit {
                guard case .pitch = beat.kind else { continue }
                beats.append((nil, PlayScript(beat: beat, rest: PlayScript.Rest(bases: beat.bases ?? [false, false, false], bats: beat.bats))))
            }
            return (replays, beats)
        }
    }
}
