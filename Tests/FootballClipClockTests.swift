import SwiftUI
import simd
import Dispatch

extension ScorelineTests {
    /// The director's ball must use the same single clock conversion as its
    /// players. A second warp visibly leaves a pass behind its receiver.
    static func footballClipClock() {
        print("\nFootball clip clock")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("mnf-dal-phi-plays.json")) else {
            return check(false, "football clock fixture loads")
        }
        let items = JSON(data: data)["items"].array
        let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
        for (name, suffix) in [("deep pass", "2186"), ("punt", "1812")] {
            guard let raw = items.first(where: { $0["id"].string?.hasSuffix(suffix) == true }),
                  let scene = FootballScene.parse(raw, teams: teams) else {
                check(false, "\(name): recorded play parses"); continue
            }
            let script = FootballScript(scene)
            let clip = GridClip(script, scene: scene, idle: nil, offense: scene.offense ?? .top)
            check(!clip.warp.isIdentity, "\(name): regression exercises a nonidentity clip warp")
            let placement = ClipPlacement(clip: clip, offset: 100, start: 100,
                                          cast: clip.figures.indices.map { ActorID(UInt16($0)) })
            let plan = Plan(revision: 1, start: 100, horizon: 100 + clip.length, state: nil,
                            placements: [placement], actors: [:])
            // Only the free-ball painter is under test. Actor posing and a
            // full plan bake are unrelated to this clock-boundary regression.
            let baked = BakedPlan(plan: plan, tracks: [], camera: [], cameraVelocity: [], ball: [], tiers: [], yawTargets: [])
            var chain = PlanChain<GridClip>()
            chain.splice(baked, now: 100)
            let scratch = FrameScratch()
            scratch.plan = 0
            scratch.placement = 0
            scratch.ball = .clip(0)
            var compared = 0
            var maximumError = 0.0
            var originalBugDiffers = false
            for flight in script.flights {
                for fraction in [0.2, 0.5, 0.8] {
                    let scriptTime = flight.start + (flight.end - flight.start) * fraction
                    guard script.carrier(at: scriptTime) == nil, script.flight(at: scriptTime) != nil else { continue }
                    let clipTime = clip.warp.clip(scriptTime)
                    scratch.p = placement.offset + clipTime
                    scratch.camera = clip.camera(at: clipTime)
                    guard case let .free(authoritative, authoritativeFlying)? = clip.ball(at: clipTime),
                          let drawn = GridPainter.frame(chain, scratch, size: CGSize(width: 540, height: 270)),
                          case let .free(actual, flying)? = drawn.world.ball else {
                        check(false, "\(name): a recorded airborne ball remains visible at fraction \(fraction)"); continue
                    }
                    let expected = GridWorld.local(SIMD2(authoritative.x, authoritative.y), right: clip.right)
                    let error = simd_length(SIMD3(actual.x - expected.x, actual.y - expected.y, actual.z - authoritative.z))
                    maximumError = max(maximumError, error)
                    compared += 1
                    if case let .free(twice, _)? = clip.ball(at: clip.local(clipTime)) {
                        originalBugDiffers = originalBugDiffers || simd_length(twice - authoritative) > 0.01
                    } else {
                        originalBugDiffers = true
                    }
                    check(flying == authoritativeFlying, "\(name): rendered flight state uses the authoritative clip instant")
                }
            }
            check(compared > 0 && maximumError < 1e-6,
                  "\(name): every rendered flight sample equals the once-warped authoritative ball", "samples \(compared), error \(maximumError)")
            check(originalBugDiffers, "\(name): applying the warp twice changes or hides the ball, so the regression catches it")
        }
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
