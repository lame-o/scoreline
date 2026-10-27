import SwiftUI

// The play theater with Statcast (World Series Game 3: ESPN's plays,
// Tests/Fixtures/ws-g3-plays.json, and MLB's at-bats for the same game,
// Tests/Fixtures/statcast-849804.json): each plate appearance found in MLB's
// feed by half-inning, batter and trip to the plate; the batted ball flown
// from its launch, coming down where MLB measured it in real hang times; the
// pitch along its tracked path to where it crossed the plate; the
// choreography keyed to the real flight; and ESPN's account alone, as
// before, whenever Statcast has nothing.

extension ScorelineTests {
    static func playStatcast() {
        print("\nPlay theater: Statcast")
        let dir = FixtureProtocol.directory
        guard let espn = try? Data(contentsOf: dir.appendingPathComponent("ws-g3-plays.json")),
              let feed = try? Data(contentsOf: dir.appendingPathComponent("statcast-849804.json")) else {
            return check(false, "Game 3's plays and Statcast fixtures load")
        }
        let g3 = JSON(data: espn)
        let plays = g3["items"].array
        var names: [String: String] = [:]
        for (id, name) in (g3["names"].raw as? [String: String]) ?? [:] { names[id] = name }
        let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        let atBats = Statcast.atBats(JSON(data: feed))
        func scene(_ id: String, names: [String: String] = names) -> PlayScene? {
            plays.firstIndex { $0["id"].string == id }.flatMap { PlayScene.parse(plays, at: $0, side: side, names: names) }
        }
        func measured(_ id: String) -> PlayScene? {
            scene(id).map { s in var s = s; s.measured = s.measurement(in: atBats); return s }
        }
        func script(_ s: PlayScene?) -> PlayScript? {
            s.map { PlayScript($0, rest: PlayScript.Rest(bases: $0.endsInning ? [false, false, false] : $0.basesAfter, bats: .right,
                                                          swapped: $0.endsInning)) }
        }
        let results = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
        let scenes = results.compactMap { PlayScene.parse(plays, at: $0, side: side, names: names) }

        // MARK: Matching

        let appearances = scenes.filter { $0.appearance != nil }
        let found = appearances.filter { $0.measurement(in: atBats) != nil }
        check(appearances.count == 74 && found.count == 74, "every plate appearance in Game 3 finds its Statcast at-bat",
              "\(found.count) of \(appearances.count): missing \(appearances.filter { $0.measurement(in: atBats) == nil }.map(\.text))")
        check(scenes.filter { $0.batter == nil }.allSatisfy { $0.appearance == nil && $0.measurement(in: atBats) == nil },
              "a runner's play (a steal, caught stealing) has nobody batting: nothing to look up")
        let bareNames = results.compactMap { PlayScene.parse(plays, at: $0, side: side) }.filter { $0.appearance != nil }
        check(bareNames.count == 74 && bareNames.allSatisfy { $0.measurement(in: atBats) != nil },
              "…and without the box score's names, by the surname the result's text opens with")
        let turang = measured("4019080440005990057")
        check(turang?.appearance == PlayScene.Appearance(inning: 1, top: true, surname: "Turang", occurrence: 0)
              && turang?.measured?.batted?.launchSpeed == 67 && turang?.measured?.batted?.trajectory == "ground_ball",
              "Turang's 6-3 in the top of the 1st: his at-bat, a 67 mph grounder")
        let mesa = measured("4019080440501990057")
        check(mesa?.appearance?.surname == "Mesa Jr" && mesa?.measured?.batted?.launchSpeed == 100.7,
              "\"V. Mesa Jr.\" is Statcast's \"Victor Mesa Jr.\" (periods aside)", "\(String(describing: mesa?.appearance))")
        // The Brewers bat around in the 5th: Hamilton and Chourio come up twice.
        let hamiltonAgain = measured("4019080440810990057"), chourioAgain = measured("4019080440811990057")
        check(hamiltonAgain?.appearance?.occurrence == 1 && hamiltonAgain?.measured?.batted?.launchSpeed == 96.5
              && measured("4019080440801990057")?.measured?.batted?.launchSpeed == 79.6,
              "a team that bats around: Hamilton's second trip in the 5th is his single, not his first's lineout")
        check(chourioAgain?.appearance?.occurrence == 1 && chourioAgain?.measured?.batted?.distance == 353,
              "…and Chourio's second, his 353 ft double")
        let looking = measured("4019080440902990057")
        check(looking?.measured?.batted == nil && looking?.measured?.pitch?.type == "SI" && looking?.measured?.pitch?.spin == 2141,
              "a strikeout: no ball in play, the deciding pitch as tracked (a 2,141 rpm sinker)")
        // ESPN's account and Statcast's must agree, or the theater keeps to ESPN's.
        if var wrong = scene("4019080440001990057") {
            wrong.kind = .double
            check(wrong.measurement(in: atBats) == nil, "a different result (ESPN's double, Statcast's single): not this at-bat")
            wrong.kind = .single
            wrong.spot = CGPoint(x: 40, y: 100)
            check(wrong.measurement(in: atBats) == nil, "a ball fielded somewhere else: not this at-bat")
        }
        check(scene("4019080440001990057")?.measurement(in: []) == nil && scene("4019080440001990057")?.measurement(in: Array(atBats.prefix(0))) == nil,
              "no Statcast (another league, a failed fetch): nothing measured")
        if let partial = atBats.first(where: { $0.batter == "Jackson Chourio" }) {
            let unfinished = Statcast.AtBat(index: partial.index, inning: partial.inning, top: partial.top, batter: partial.batter, event: nil,
                                            pitches: partial.pitches, batted: nil)
            check(scene("4019080440001990057")?.measurement(in: [unfinished]) == nil, "an at-bat Statcast hasn't finished posting: not yet")
        }
        let mlb = Event(id: "401908044", content: .match(top: comp("8", "Brewers"), bottom: comp("30", "Rays")), state: .live, start: .now,
                        detail: nil, caption: nil, link: nil, ref: .espn(path: "baseball/mlb", id: "401908044", sport: .baseball))
        let college = Event(id: "1", content: .match(top: comp("a", "Tigers"), bottom: comp("b", "Gators")), state: .live, start: .now,
                            detail: nil, caption: nil, link: nil, ref: .espn(path: "baseball/college-baseball", id: "1", sport: .baseball))
        check(Statcast.Lookup(mlb)?.teams == ["Brewers", "Rays"] && Statcast.Lookup(college) == nil,
              "MLB's feed is asked about MLB games only, by both teams' short names")

        // MARK: The batted ball's flight

        var landings: [String] = [], spots: [String] = [], hangs: [String] = [], under: [String] = []
        for s in scenes {
            var s = s
            s.measured = s.measurement(in: atBats)
            guard let batted = s.measured?.batted, let distance = batted.distance, let script = script(s), let b = script.batted,
                  case let .samples(points) = script.flights[b].arc else { continue }
            let flight = script.flights[b]
            let firstStep = flight.hops.first.map { Int(($0 * Double(points.count - 1)).rounded()) } ?? points.count - 1
            let first = points[firstStep]
            // In the air until caught or down; a ball hit into the ground, until it gets to its fielder.
            let angle = batted.launchAngle ?? 0
            let real = Double(angle < 8 ? points.count - 1 : firstStep) / 120
            let spot = batted.spot.map { Ballpark.feet(CGPoint(x: $0.x, y: $0.y)) } ?? .zero
            let wall = distance > Ballpark.fence(Ballpark.bearing(spot)) - 3
            // Where it first comes down (or is caught): Statcast's distance, on its spot's line.
            let off = abs(Ballpark.distance(first.ground) - distance)
            let across = abs(Ballpark.bearing(first.ground) - Ballpark.bearing(spot)) * distance
            if !wall, off > 1 || across > 3 { landings.append(String(format: "%@ %.0f ft off, %.0f ft across", s.text, off, across)) }
            // A ball on the ground ends where it was fielded.
            let end = points.last!.ground
            if case .samples = flight.arc, !(s.kind == .flyOut || s.kind == .lineOut || s.kind == .popOut || s.kind == .foulOut),
               hypot(end.x - spot.x, end.y - spot.y) > 1 {
                spots.append("\(s.text) \(Int(hypot(end.x - spot.x, end.y - spot.y))) ft from its spot")
            }
            let range: ClosedRange<Double> = switch angle {
            case ..<8: 0.8...4.5
            case ..<20: 1.2...3.8
            case ..<40: 2.5...5.5
            case ..<60: 3.0...6.5
            default: 4.0...6.5
            }
            // (A drive off the wall first touches the grass on its way back.)
            if !wall, !range.contains(real) { hangs.append(String(format: "%@ %.0f° %.2f s", s.text, angle, real)) }
            if points.contains(where: { $0.z < -0.01 || !$0.x.isFinite || !$0.y.isFinite }) { under.append(s.text) }
        }
        check(landings.isEmpty, "every measured ball comes down at Statcast's distance (within a foot) on its spot's line (within 3 ft)",
              landings.joined(separator: " | "))
        check(spots.isEmpty, "every ball not caught ends where it was fielded", spots.joined(separator: " | "))
        check(hangs.isEmpty, "real hang times by launch angle: under 8°, 1–4.5 s to the fielder; liners 1–4 s; flies 2.5–5.5 (higher, to 6.5); pop-ups 4–6.5",
              hangs.joined(separator: " | "))
        check(under.isEmpty, "never under the grass, always finite", under.joined(separator: " | "))

        func hang(_ id: String) -> Double? {
            guard let s = script(measured(id)), let b = s.batted, case let .samples(points) = s.flights[b].arc else { return nil }
            return Double(points.count - 1) / 120
        }
        check(hang("4019080440801990057").map { $0 > 1.4 && $0 < 2.0 } == true,
              "Hamilton's 80 mph liner at 12° is in a glove 163 ft out in under 2 s", "\(hang("4019080440801990057") ?? -1)")
        check(hang("4019080441001990057").map { $0 > 4.5 && $0 < 5.3 } == true,
              "Yelich's 105 mph fly at 29° hangs about 5 s on its way to the track in center", "\(hang("4019080441001990057") ?? -1)")

        // The physics on its own: a no-doubter's carry, a liner, a grounder's hops.
        let plate = CGPoint(x: 0, y: 1.4)
        let fly = BattedFlight(speed: 105, angle: 28, from: FieldPoint(plate, z: 3), landing: Ballpark.polar(400, 0), end: .caught(height: 0))
        check(abs(Ballpark.distance(fly.points.last!.ground) - 400) < 1 && fly.duration > 4.6 && fly.duration < 5.4,
              "a 105 mph fly at 28° carries 400 ft in about 5 s", String(format: "%.2f s", fly.duration))
        let deep = BattedFlight(speed: 105, angle: 28, from: FieldPoint(plate, z: 3), landing: Ballpark.polar(405, 0), end: .homeRun)
        check(deep.over.map { deep.point(at: $0).z > Ballpark.wallHeight } == true && (deep.points.last?.z ?? 0) >= Ballpark.wallHeight
              && Ballpark.distance(deep.points.last!.ground) > Ballpark.fence(0),
              "…a home run clears the wall and comes down in the seats")
        let liner = BattedFlight(speed: 100, angle: 10, from: FieldPoint(plate, z: 3), landing: nil, end: .fielded(Ballpark.polar(300, -10)))
        check(liner.touchdown > 1.6 && liner.touchdown < 2.3 && (200...250).contains(Ballpark.distance(liner.point(at: liner.touchdown).ground)),
              "a 100 mph liner at 10° (an average ball's drag) comes down about 220 ft out in under 2 s",
              String(format: "%.0f ft in %.2f s", Ballpark.distance(liner.point(at: liner.touchdown).ground), liner.touchdown))
        let through = Ballpark.polar(250, -20)
        let chopper = BattedFlight(speed: 95, angle: -20, from: FieldPoint(plate, z: 2.5), landing: Ballpark.polar(8, -20), end: .fielded(through))
        check(chopper.hops.count >= 3 && chopper.duration > 1.5 && chopper.duration < 4.2
              && hypot(chopper.points.last!.x - through.x, chopper.points.last!.y - through.y) < 0.5,
              "a −20° grounder through the left side hops on to the left fielder", "\(chopper.hops.count) hops, \(chopper.duration) s")
        let hopHeights = zip(chopper.hops, chopper.hops.dropFirst()).map { a, b in
            stride(from: a, through: b, by: 1 / 120.0).map { chopper.point(at: $0).z }.max() ?? 0
        }
        check(zip(hopHeights, hopHeights.dropFirst()).allSatisfy { $0 >= $1 }, "…each hop no higher than the last", "\(hopHeights)")

        // MARK: Its replay

        if let s = script(measured("4019080441001990057")), let b = s.batted, case let .samples(points) = s.flights[b].arc {
            let flight = s.flights[b], real = Double(points.count - 1) / 120
            let catcher = s.actors[7].actions.first { $0.kind == .catchHigh }
            check(abs((flight.end - flight.start) - real * PlayScript.Builder.pace(real)) < 0.001 && real / (flight.end - flight.start) > 2
                  && real / (flight.end - flight.start) < 3,
                  "a deep fly plays at one pace contact to glove, about 2.4× real time", String(format: "%.2f s real in %.2f s", real, flight.end - flight.start))
            check(catcher.map { abs($0.at - flight.end) < 0.001 } == true && abs(s.actors[7].position(at: flight.end).x - points.last!.x) < 0.5,
                  "…the center fielder gloves it where and when it comes down")
        }
        if let s = script(measured("4019080440005990057")), let b = s.batted, let out = s.flashes.first(where: { $0.beat == .out }) {
            let flight = s.flights[b]
            let scoop = s.actors[5].actions.first { $0.kind == .scoop }?.at ?? 0
            let throwAt = s.actors[5].actions.first { $0.kind == .throwBall }?.at ?? 0
            check(abs(scoop - flight.end) < 0.001 && throwAt > scoop && out.at > throwAt && out.at < (s.actors[9].moves.last?.end ?? 0),
                  "6-3 on a measured chopper: the shortstop fields it as it gets to him, then throws; the out still beats the runner")
            check(!s.puffs.isEmpty && s.puffs.allSatisfy { $0.at >= flight.start && $0.at <= flight.end }, "…dust at each of its hops")
        }
        if let s = script(measured("4019080441102990057")) {
            let outs = s.flashes.filter { $0.beat == .out }.sorted { $0.at < $1.at }.map(\.point.ground)
            check(outs == [Ballpark.base(2), Ballpark.base(1)], "4-6-3 on the measured grounder: out at second, then at first")
        }
        if let s = script(measured("4019080440101990057")), let b = s.batted, case let .samples(points) = s.flights[b].arc,
           let landing = s.landing {
            let flight = s.flights[b], touchdown = (flight.hops.first ?? 1) * (flight.end - flight.start) + flight.start
            check(touchdown < flight.end && abs(landing.at - flight.end) < 0.001 && landing.point == points.last!.ground,
                  "a liner that falls in: it lands, hops on to the center fielder, and the hit's mark is where he gathers it")
        }
        if let s = script(measured("4019080441704990057")), let b = s.batted, case let .samples(points) = s.flights[b].arc {
            func beyond(_ p: FieldPoint) -> Double { Ballpark.distance(p.ground) - Ballpark.fence(Ballpark.bearing(p.ground)) }
            let wall = points.firstIndex { beyond($0) > -2.5 }
            check(wall.map { points[$0].z < Ballpark.wallHeight && points[$0...].allSatisfy { beyond($0) <= 0 } } == true
                  && beyond(points.last!) < -15,
                  "a 413 ft drive that stayed in (Díaz's double): off this park's wall below its top, and back to the center fielder")
        }
        let measuredScripts = scenes.compactMap { s -> PlayScript? in var s = s; s.measured = s.measurement(in: atBats); return script(s) }
        let finite = measuredScripts.allSatisfy { s in
            stride(from: 0.0, through: s.duration, by: 0.05).allSatisfy { t in
                s.actors.allSatisfy { a in let p = a.position(at: t); return p.x.isFinite && p.y.isFinite }
                    && (s.ball(at: t).map { $0.x.isFinite && $0.y.isFinite && $0.z.isFinite && $0.z >= -0.01 } ?? true)
            }
        }
        check(finite, "every measured play's figures and ball stay finite, the ball never under the grass")
        let lengths = measuredScripts.map { $0.settle - 0.75 }
        check(lengths.allSatisfy { $0 >= 1.2 && $0 <= 4.8 }, "every measured replay runs 1.2–4.8 s before it settles",
              String(format: "%.2f–%.2f", lengths.min() ?? 0, lengths.max() ?? 0))
        check(measuredScripts.allSatisfy { $0.camera.frame(at: $0.duration) == .rest }, "…and the camera still ends exactly at rest")

        // A home run, measured (Game 2's two-run shot to right center, 411 ft, given a launch).
        if let summary = try? Data(contentsOf: dir.appendingPathComponent("3bd207fad0c0e7da8976ca99.bin")) {
            let g2 = JSON(data: summary)["plays"].array
            if var homer = g2.firstIndex(where: { $0["id"].string == "4019080430005990057" })
                .flatMap({ PlayScene.parse(g2, at: $0, side: { $0 == "30" ? .top : .bottom }) }), let spot = homer.spot {
                homer.measured = PlayScene.Measured(batted: Statcast.Batted(launchSpeed: 106.2, launchAngle: 29, distance: 411, trajectory: "fly_ball",
                                                                            spot: SIMD2(spot.x, spot.y)), pitch: nil)
                if let s = script(homer), let fence = s.fence, let b = s.batted, let landing = s.landing {
                    let flight = s.flights[b]
                    check(fence.at > flight.start && fence.at < flight.end && flight.point(at: fence.at).z > Ballpark.wallHeight
                          && landing.z > Ballpark.wallHeight && Ballpark.distance(landing.point) > Ballpark.fence(Ballpark.bearing(landing.point)),
                          "a measured home run clears the wall mid-flight and comes down in the seats")
                    check(s.stamp == fence.at + 0.05 && s.flashes.filter { $0.beat == .run }.count == 2 && s.settle - 0.75 < 4.6,
                          "…the mark as it clears, both runs home, the trot done in under five seconds", "\(s.settle - 0.75)")
                    check(homer.readout == "106.2 MPH · 29° · 411 FT", "…and its distance in the readout, not twice")
                }
            }
        }

        // MARK: The pitch

        var misses: [String] = []
        for s in scenes {
            var s = s
            s.measured = s.measurement(in: atBats)
            guard let pitch = s.measured?.pitch, let script = script(s), let first = script.flights.first,
                  case let .pitch(tracked, from, to) = first.arc, let plate = pitch.plateTime else { continue }
            let hand = first.point(at: first.start)
            let crossing = tracked.point(at: plate)
            if abs(hand.y - Ballpark.release) > 0.01 || abs(crossing.x - pitch.plate.x) > 1 / 12 || abs(crossing.z - pitch.plate.y) > 1 / 12
                || abs((first.end - first.start) - (to - from)) > 0.001 {
                misses.append(s.text)
            }
            if s.inPlay, abs(first.to.x - pitch.plate.x) > 1 / 12 || abs(first.to.z - pitch.plate.y) > 1 / 12 { misses.append("in play: \(s.text)") }
        }
        check(misses.isEmpty, "every tracked pitch leaves the hand (54 ft) and crosses the plate where Statcast measured, within an inch, in real time",
              misses.joined(separator: " | "))
        if let k = script(looking), let first = k.flights.first, case .pitch = first.arc {
            let mitt = first.to
            check(mitt.y < 0 && mitt.z >= 0.29 && abs(k.flashes.first { $0.beat == .catchBall }!.at - first.end) < 0.001,
                  "strike three: on past the plate into the catcher's mitt, where it pops")
        }

        // MARK: Without Statcast

        if let plain = scene("4019080441001990057"), var measuredScene = measured("4019080441001990057") {
            check(script(plain) != script(measuredScene), "a measured play replays differently…")
            measuredScene.measured = nil
            check(script(plain) == script(measuredScene), "…and without its measurements, exactly as ESPN's account alone always has")
        }
        let espnOnly = scenes.compactMap(script)
        check(espnOnly.allSatisfy { s in s.flights.allSatisfy { f in if case .samples = f.arc { return false }; if case .pitch = f.arc { return false }; return true } },
              "ESPN's plays alone draw no measured flight")

        // MARK: On screen

        check(measured("4019080440101990057")?.readout == "115.5 MPH · 10° · 302 FT", "the stamp's readout: exit velocity, launch angle, distance")
        check(turang?.readout == "67.0 MPH · −29°", "…a grounder's without its first hop's distance, a true minus on its angle")
        check(scene("4019080440101990057")?.readout == nil && looking?.readout == nil, "…and none unless it was measured (nor for a strikeout)")
        if let line = measured("4019080440101990057"), let s = script(line), let plain = script(scene("4019080440101990057")) {
            check(s.corner.height > plain.corner.height && s.corner.width >= plain.corner.width,
                  "the camera keeps the play out of the taller stamp")
        }
    }
}
