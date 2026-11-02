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
        footballResultHold(items, teams: teams)
    }

    /// The result is a deliberate short pause, not slack for the motion
    /// solver. Check the actual mapped duration and trajectories, including
    /// both boundaries where an unconditional clock clamp would cause a jerk.
    private static func footballResultHold(_ items: [JSON], teams: FootballFeed.Teams) {
        print("\nFootball result hold and reset motion")
        let pause = 1.017...1.717
        let need: (Double) -> Double = { pause.contains($0) ? 1 : 3 }
        let normal = ClipWarp.make(length: 3, need: need, steady: { _ in false })!
        let fixed = ClipWarp.make(length: 3, need: need, steady: { _ in false }, rest: pause)!
        check(normal.clip(pause.upperBound) - normal.clip(pause.lowerBound) > 0.9,
              "the regression exercises slowdown smoothing bleeding into a hold")
        check(abs(fixed.clip(pause.upperBound) - fixed.clip(pause.lowerBound) - 0.7) < 1e-9,
              "a fractional-frame hold retains exactly its authored duration")
        let instants = [0.0, 0.13, pause.lowerBound - 0.001, pause.lowerBound, 1.35,
                        pause.upperBound, pause.upperBound + 0.001, 2.8, 3.0, 3.1]
        check(instants.allSatisfy { abs(fixed.script(fixed.clip($0)) - $0) < 1e-8 },
              "protected clock mapping is monotone and invertible across both exact boundaries")
        for shift in [-1e-12, 1e-12] {
            let nearGrid = (1 + shift)...(1.7 + shift)
            let warp = ClipWarp.make(length: 3, need: { nearGrid.contains($0) ? 1 : 3 }, steady: { _ in false }, rest: nearGrid)!
            let elapsed = warp.clip(nearGrid.upperBound) - warp.clip(nearGrid.lowerBound)
            check(abs(elapsed - 0.7) < 1e-10,
                  "an exact result boundary \(shift > 0 ? "above" : "below") a frame-grid sample retains the 0.700-second hold",
                  "\(elapsed) seconds")
        }

        for (name, suffix) in [("rush tackle", "63"), ("completed pass", "85"), ("touchdown", "385")] {
            guard let raw = items.first(where: { $0["id"].string == "401873009" + suffix }),
                  let scene = FootballScene.parse(raw, teams: teams) else {
                check(false, "\(name): recorded result-pause fixture parses"); continue
            }
            let script = FootballScript(scene)
            let clip = GridClip(script, scene: scene, idle: nil, offense: scene.offense ?? .top)
            guard let hold = clip.resultHold else {
                check(false, "\(name): a settled result declares its protected hold"); continue
            }
            let start = clip.warp.clip(hold.lowerBound), end = clip.warp.clip(hold.upperBound)
            check(abs(end - start - (script.settle - script.stamp)) < 1e-8 && abs(end - start - 0.7) < 1e-8,
                  "\(name): the result holds 0.700 seconds on the actual playback clock",
                  "script \(script.settle - script.stamp), clip \(end - start)")
            var moved = 0.0, boundarySpeed = 0.0, boundaryAcceleration = 0.0
            var contactError = 0.0, contacts = 0
            let contactKinds: [FootballScript.Action.Kind] = [.catchHigh, .catchChest, .throwBall, .handoff, .kick, .tackle, .strip, .scoop]
            for i in clip.paths.indices {
                guard let path = clip.paths[i] else { continue }
                let at = path.position(at: hold.lowerBound)
                for u in stride(from: hold.lowerBound, through: hold.upperBound, by: 1.0 / 120) {
                    moved = max(moved, simd_length(path.position(at: u) - at))
                }
                for u in [hold.lowerBound, hold.upperBound] {
                    boundarySpeed = max(boundarySpeed, simd_length(path.velocity(at: u)))
                    boundaryAcceleration = max(boundaryAcceleration, simd_length(path.acceleration(at: u)))
                }
                for action in script.players[i].actions where contactKinds.contains(action.kind) {
                    let u = clip.local(clip.warp.clip(action.at)), expected = script.players[i].position(at: action.at)
                    contactError = max(contactError, simd_length(path.position(at: u) - SIMD2(expected.x, expected.y)))
                    contacts += 1
                }
            }
            check(moved < 1e-7 && boundarySpeed < 1e-7 && boundaryAcceleration < 1e-7,
                  "\(name): arrivals and resets meet the hold at rest without borrowing its time",
                  "motion \(moved), boundary speed \(boundarySpeed), acceleration \(boundaryAcceleration)")
            check(contacts > 0 && contactError < 1e-5,
                  "\(name): explicit ball and tackle contacts retain their original positions on the shared clock",
                  "\(contacts) contacts, error \(contactError)")

            // The rendered path, in clip time, across the pause and reset.
            // 60Hz is the engine's own physics-audit rate; include samples on
            // both boundaries rather than accidentally stepping over them.
            let dt = 1.0 / 60
            var samples = Array(stride(from: max(start - 0.1, dt), through: clip.length - dt, by: dt))
            samples += [start, end, end + dt]
            var speedRatio = 0.0, accelRatio = 0.0, badAcceleration = 0, count = 0
            for i in clip.paths.indices where clip.paths[i] != nil {
                let band = MotionLimits.football.band(clip.figures[i].band)
                for t in samples where t > 0 && t < clip.length && clip.opacity(i, at: t) > 0.05 {
                    let p0 = clip.position(i, at: t - dt), p1 = clip.position(i, at: t), p2 = clip.position(i, at: t + dt)
                    let v = (p2 - p0) / (2 * dt), a = (p2 - 2 * p1 + p0) / (dt * dt)
                    let speed = simd_length(v)
                    speedRatio = max(speedRatio, speed / band.sprint)
                    let ratio: Double
                    if speed > 0.25 {
                        let along = simd_dot(a, v / speed), across = simd_length(a - along * v / speed)
                        ratio = max(along / band.accel, -along / band.decel, across / band.lateral)
                    } else {
                        ratio = simd_length(a) / max(band.accel, band.decel)
                    }
                    accelRatio = max(accelRatio, ratio)
                    if ratio > 1.0001 { badAcceleration += 1 }
                    count += 1
                }
            }
            check(count > 0 && speedRatio <= 1.0001 && Double(badAcceleration) <= Double(count) * 0.01,
                  "\(name): hold boundaries and reset travel retain sprint and acceleration audit limits",
                  "sprint \(speedRatio), acceleration peak \(accelRatio), over-limit samples \(badAcceleration)/\(count)")
            if name == "completed pass" {
                var late = script
                late.players[0].actions.append(.init(kind: .catchChest, at: script.stamp + 0.2, toward: .zero))
                check(GridClip.resultHold(late) == nil, "a real contact during the result window prevents hold protection")
                if var flight = script.flights.first {
                    flight.start = script.stamp - 0.1
                    flight.end = script.stamp + 0.2
                    late = script
                    late.flights.append(flight)
                    check(GridClip.resultHold(late) == nil, "a late ball flight keeps its original motion clock")
                } else { check(false, "completed-pass fixture contains a flight for the opt-out regression") }
            }
        }
        let idle = FootballIdle(phase: .between, offense: .top, yard: 41, gain: 45)
        let idleScript = FootballScript(idle: idle)
        let idleClip = GridClip(idleScript, scene: nil, idle: idle, offense: .top)
        check(idleClip.resultHold == nil, "huddle stillness and the idle clock are unchanged")
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
