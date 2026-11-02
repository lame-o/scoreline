import SwiftUI
import simd
import Dispatch

extension ScorelineTests {
    /// A clip runs on its script's own clock: the ball to the frame, the credited man meeting it exactly, and nobody
    /// else slowing the game down for a man the script asked too much of.
    static func footballClipClock() {
        print("\nFootball clip clock")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("mnf-dal-phi-plays.json")) else {
            return check(false, "football clock fixture loads")
        }
        let items = JSON(data: data)["items"].array
        let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
        for (name, suffix) in [("deep pass", "2186"), ("punt", "1812"), ("rush", "63"), ("completion", "85"), ("touchdown", "385")] {
            guard let raw = items.first(where: { $0["id"].string?.hasSuffix(suffix) == true }),
                  let scene = FootballScene.parse(raw, teams: teams) else {
                check(false, "\(name): recorded play parses"); continue
            }
            let script = FootballScript(scene)
            let clip = GridClip(script, scene: scene, idle: nil, offense: scene.offense ?? .top)
            check(clip.length == script.duration && clip.still == script.leadIn, "\(name): the clip is as long as its script, at its pace")
            check(stride(from: 0.0, through: script.duration, by: 0.1).allSatisfy { clip.local($0) == $0 }, "\(name): the script's clock is the clip's")
            let placement = ClipPlacement(clip: clip, offset: 100, start: 100,
                                          cast: clip.figures.indices.map { ActorID(UInt16($0)) })
            let plan = Plan(revision: 1, start: 100, horizon: 100 + clip.length, state: nil,
                            placements: [placement], actors: [:])
            // Only the free-ball painter is under test here.
            let baked = BakedPlan(plan: plan, tracks: [], camera: [], cameraVelocity: [], ball: [], tiers: [], yawTargets: [])
            var chain = PlanChain<GridClip>()
            chain.splice(baked, now: 100)
            let scratch = FrameScratch()
            scratch.plan = 0
            scratch.placement = 0
            scratch.ball = .clip(0)
            var maximumError = 0.0, compared = 0
            for flight in script.flights {
                for fraction in [0.2, 0.5, 0.8] {
                    let t = flight.start + (flight.end - flight.start) * fraction
                    guard script.carrier(at: t) == nil, script.flight(at: t) != nil, let expected = script.ball(at: t) else { continue }
                    scratch.p = placement.offset + t
                    scratch.camera = clip.camera(at: t)
                    guard let drawn = GridPainter.frame(chain, scratch, size: CGSize(width: 540, height: 270)),
                          case let .free(actual, flying)? = drawn.world.ball else {
                        check(false, "\(name): a flight stays in the air at fraction \(fraction)"); continue
                    }
                    maximumError = max(maximumError, hypot(actual.x - expected.x, actual.y - expected.y) + abs(actual.z - expected.z))
                    compared += 1
                    check(flying, "\(name): the flight reads as one")
                }
            }
            check(script.flights.isEmpty || (compared > 0 && maximumError < 1e-6), "\(name): every flight sample is the script's ball at the script's time",
                  "samples \(compared), error \(maximumError)")
            // Every ball contact where the script has it, credited tackles too.
            let ballKinds: [FootballScript.Action.Kind] = [.catchHigh, .catchChest, .throwBall, .handoff, .kick, .scoop]
            var contactError = 0.0
            for i in script.players.indices {
                guard let path = clip.paths[i] else { continue }
                for action in script.players[i].actions where ballKinds.contains(action.kind) || (script.credits[i] != nil && [.tackle, .strip].contains(action.kind)) {
                    let was = script.players[i].position(at: action.at), now = path.position(at: action.at)
                    contactError = max(contactError, hypot(was.x - now.x, was.y - now.y))
                }
            }
            check(contactError < 1e-6, "\(name): every contact is exactly where it was", "off by \(contactError)")
            // Nobody outruns his legs: the far men at the reset end short instead of gliding home.
            var fastest = 0.0
            for i in clip.paths.indices {
                guard let path = clip.paths[i], script.players[i].opacity(at: script.duration / 2) > 0.05 || true else { continue }
                let p = script.players[i]
                let sprint = MotionLimits.football.band(p.team == .official || p.team == .staff ? "official" : [.line, .front].contains(p.role) ? "line" : "skill").sprint
                for u in stride(from: 0.0, through: script.duration, by: 1.0 / 120) { fastest = max(fastest, simd_length(path.velocity(at: u)) / sprint) }
            }
            // A ratchet, not the gate (+12%): a contact too far for his legs still wins.
            check(fastest <= 1.5, "\(name): nobody runs far past his sprint", "worst \(fastest)")
        }
        let idle = FootballIdle(phase: .between, offense: .top, yard: 41, gain: 45)
        let idleScript = FootballScript(idle: idle)
        let idleClip = GridClip(idleScript, scene: nil, idle: idle, offense: .top)
        check(idleClip.length == .infinity && idleClip.still == 0, "the field between snaps keeps its own clock too")
    }

    /// Opt-in diagnostic, deliberately without a timing pass/fail threshold.
    /// Run an optimized test binary with --football-tag-cost on a quiet Mac.
    /// A cold key change currently does this same work inside Canvas.draw.
    static func footballTagCost() {
        print("\nFootball receiver tag cost (540×270 pt, five cold keys and immediate cache hits)")
        func fixture(_ name: String) -> JSON? {
            (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent(name))).map { JSON(data: $0) }
        }
        func probe(_ scene: FootballScene, people: [String: TheaterPerson], names: (top: String, bottom: String)) {
            let script = FootballScript(scene)
            let cast = script.cast(scene, offense: scene.offense ?? .top, people: people, scope: scene.id)
            guard let key = cast.keys.dropFirst().first(where: { $0.figure.flatMap { cast.members[$0]?.who.person } != nil }),
                  let man = key.figure, let member = cast.members[man] else {
                check(false, "tag cost fixture has a named receiver handoff"); return
            }
            let size = CGSize(width: 540, height: 270)
            let labels = TheaterLabels.make(kits: nil, scheme: .dark, teams: names)
            let renderer = ImageRenderer(content: TheaterNameTag(who: member.who, label: labels[member.side], full: false,
                                                                 size: TheaterTags.type(size)))
            renderer.scale = 2
            guard let image = renderer.cgImage else {
                check(false, "tag cost fixture measures its actual surname tag"); return
            }
            let tag = CGSize(width: CGFloat(image.width) / renderer.scale, height: CGFloat(image.height) / renderer.scale)
            let stretch = cast.stretch(at: max(key.from, 0) + 1e-6)
            let replay = TheaterReplay(length: script.duration) { FootballFrame.spots(script, at: $0, size: size) }
            let run = UUID().uuidString
            var cold: [Double] = [], warm: [Double] = []
            var same = true
            func timed(_ operation: () -> [TheaterTagSpot]) -> (spots: [TheaterTagSpot], ms: Double) {
                let start = DispatchTime.now().uptimeNanoseconds
                let spots = operation()
                return (spots, Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
            }
            for i in 0..<5 {
                let scope = "football-tag-cost|\(run)|\(scene.id)|\(i)"
                func rank() -> [TheaterTagSpot] {
                    TheaterTagPlan.ranked(man, tag: tag, pointer: false, over: stretch, in: size, heartbeat: .trailing,
                                          replay: replay, scope: scope)
                }
                let first = timed(rank), cached = timed(rank)
                cold.append(first.ms)
                warm.append(cached.ms)
                same = same && !first.spots.isEmpty && first.spots == cached.spots
            }
            check(same, "\(member.who.person?.last ?? "receiver"): cached ranks equal cold ranks")
            let from = max(stretch.lowerBound, 0), to = min(stretch.upperBound, script.duration)
            print(String(format: "  %@: tag %.1f×%.1f pt; receiver at %.3f s, remaining %.3f s; %d figures",
                         member.who.person?.last ?? "receiver", tag.width, tag.height, key.from, max(to - from, 0), script.players.count))
            print(String(format: "    cold first %.3f ms, median %.3f ms, max %.3f ms; cache-hit median %.4f ms (60 Hz budget 16.667 ms)",
                         cold[0], cold.sorted()[2], cold.max() ?? 0, warm.sorted()[2]))
        }

        if let raw = fixture("mnf-dal-phi-plays.json")?["items"].array.first(where: { $0["id"].string?.hasSuffix("2186") == true }),
           let scene = FootballScene.parse(raw, teams: FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21",
                                                                         homeAbbreviation: "PHI", awayAbbreviation: "DAL")) {
            probe(scene, people: [:], names: ("Cowboys", "Eagles"))
        } else { check(false, "deep-pass tag cost fixture loads") }

        if let game = fixture("nfl-turnovers-plays.json")?["games"].array.first,
           let raw = game["items"].array.first(where: { ($0["text"].string ?? "").contains("pass short middle to E.Johnson") }),
           let box = fixture("names-nfl-401873022-boxscore.json"), let charts = fixture("nfl-depthcharts.json")?["teams"],
           let parsed = FootballScene.parse(raw, teams: FootballFeed.Teams(topIsHome: false, topID: "12", bottomID: "26",
                                                                          homeAbbreviation: "SEA", awayAbbreviation: "KC")) {
            var depth: [GameDetail.Side: FootballDepthChart] = [:]
            depth[.top] = FootballDepthChart(charts["12"])
            depth[.bottom] = FootballDepthChart(charts["26"])
            probe(parsed.slotted(by: depth), people: TheaterPeople.boxscore(box), names: ("Chiefs", "Seahawks"))
        } else { check(false, "short-pass tag cost fixture with real box score and depth chart loads") }
    }
}
