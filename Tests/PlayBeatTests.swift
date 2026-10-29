import Foundation

// The ballpark theater between balls in play (PlayBeat.swift,
// PlayBeatScript.swift) against real games: World Series Game 5 as ESPN had
// it (Tests/Fixtures/ws-g5-plays.json), MLB's feed for it
// (statcast-849799.json, recorded with Statcast.fields) and its live poll
// (statcast-live-849799.json, Statcast.liveFields); and a Brewers–Reds rain
// delay (statcast-824468-delay.json, the at-bats round it). Every pitch shows,
// in ESPN's order, with MLB's call and flight; what came between pitches
// shows where it happened; nothing shows twice. And the choreography's facts:
// a pitch ends at its plate location, two real pitches at their two spots, a
// throw over to its bag, a steal's throw to the bag he stole, the reliever
// named is the one who jogs in, the sides change between halves, the idle
// life starts and ends on the field as it stands.

extension ScorelineTests {
    static func playBeats() {
        print("\nPlay theater: every pitch, and what comes between")
        let dir = FixtureProtocol.directory
        guard let espn = try? Data(contentsOf: dir.appendingPathComponent("ws-g5-plays.json")),
              let mlbData = try? Data(contentsOf: dir.appendingPathComponent("statcast-849799.json")),
              let liveData = try? Data(contentsOf: dir.appendingPathComponent("statcast-live-849799.json")),
              let delayData = try? Data(contentsOf: dir.appendingPathComponent("statcast-824468-delay.json")) else {
            return check(false, "Game 5's plays, MLB's feed and live poll, and the rain delay load")
        }
        let g5 = JSON(data: espn)
        let items = g5["items"].array
        var names: [String: String] = [:]
        for (id, name) in (g5["names"].raw as? [String: String]) ?? [:] { names[id] = name }
        let atBats = Statcast.atBats(JSON(data: mlbData))
        let line = PlayBeat.timeline(items, mlb: atBats, names: names)
        let espnOnly = PlayBeat.timeline(items, mlb: [], names: names)
        func pitch(_ b: PlayBeat) -> PlayBeat.Pitch? { if case let .pitch(p) = b.kind { return p }; return nil }
        let pitches = line.filter { pitch($0) != nil }

        // MARK: MLB's events

        check(Statcast.fields.contains("reviewDetails") && Statcast.fields.contains("eventType") && Statcast.fields.contains("count"),
              "MLB's feed is asked for each event's kind, count and challenge")
        let events = atBats.flatMap(\.events)
        func count(_ kind: Statcast.PlayEvent.Kind) -> Int { events.filter { $0.kind == kind }.count }
        check(atBats.count == 70 && events.filter(\.isPitch).count == 255 && count(.action("mound_visit")) == 9
              && count(.action("pitching_substitution")) == 9 && count(.pickoff(base: 1, catcher: false)) == 1 && count(.stepOff) == 1,
              "Game 5's 70 at-bats: 255 pitches, 9 mound visits, 9 pitching changes, a throw over to first, a step off",
              "\(atBats.count) \(events.filter(\.isPitch).count) \(count(.action("mound_visit"))) \(count(.action("pitching_substitution")))")
        let reviewed = events.filter { $0.review != nil }
        check(reviewed.count == 2 && reviewed.allSatisfy { $0.review?.pitch == true && $0.review?.overturned == true }
              && reviewed.compactMap { $0.review?.challenger }.sorted() == ["Liam Hicks", "William Contreras"],
              "its two ABS challenges, both overturned, each naming who asked (Contreras, Hicks)")
        let live = Statcast.live(JSON(data: liveData))
        check(live.atBat?.index == 69 && live.status == "Final" && live.inning == 9 && live.atBat?.events.first?.kind == .action("mound_visit")
              && Statcast.liveFields.contains("currentPlay") && !Statcast.liveFields.contains("allPlays"),
              "the live poll reads only the at-bat under way (its mound visit first), the inning and the game's status",
              "\(String(describing: live.atBat?.index)) \(String(describing: live.status))")

        // MARK: Every pitch, in order

        let espnPitches = items.filter { $0["summaryType"].string == "P" || ($0["text"].string ?? "").hasPrefix("Pitch") }
        let deciding = espnPitches.filter { p in
            let b = p["resultCount"]["balls"].int ?? 0, s = p["resultCount"]["strikes"].int ?? 0
            let type = p["type"]["type"].string?.components(separatedBy: "---").first ?? ""
            return b >= 4 || s >= 3 || !["ball", "strike-looking", "strike-swinging", "foul-ball", "foul-tip", "bunted-foul", "missed-bunt"].contains(type)
        }
        let shownIDs = pitches.map(\.id), espnOrder = espnPitches.compactMap { $0["id"].string }.filter { shownIDs.contains($0) }
        check(pitches.count == 185 && pitches.count == espnPitches.count - deciding.count && shownIDs == espnOrder,
              "every pitch that didn't end its at-bat is a beat (185 of 255), in ESPN's order", "\(pitches.count)")
        check(!deciding.compactMap({ $0["id"].string }).contains(where: shownIDs.contains),
              "the pitch that ends an at-bat (strike three, ball four, in play) is its play's: never shown twice")
        check(line.filter(\.isPlay).count == 84 && line.filter { if case .inningBreak = $0.kind { return true }; return false }.count == 18,
              "each of the 84 plays is in the timeline (replayed from its scene), and each of the 18 half-innings' ends")
        let tracked = pitches.compactMap(pitch).filter { $0.flight != nil }
        check(tracked.count == pitches.count && espnOnly.compactMap(pitch).allSatisfy { $0.flight == nil },
              "with MLB's feed every pitch carries its measured flight; ESPN's alone, none (a path shaped like its type)")
        let calls = Set(pitches.compactMap(pitch).map(\.call))
        check(calls.isSuperset(of: [.ball, .calledStrike, .swingingStrike, .foul, .foulBunt, .ballInDirt]),
              "MLB's exact calls: a foul bunt, a ball in the dirt, as well as balls, strikes and fouls", "\(calls)")
        if let first = line.first(where: { pitch($0) != nil }), let p = pitch(first) {
            check(p.call == .foul && p.number == 1 && p.strikes == 1 && p.code == "FF" && first.bats == .right && first.arm == .right
                  && PlayBeat.call(p, wide: true) == "FOUL · \(Int((p.mph ?? 0).rounded())) MPH FOUR-SEAM FASTBALL",
                  "the game's first pitch: Chourio fouls off Rasmussen's four-seamer (\"FOUL · 96 MPH FOUR-SEAM FASTBALL\")",
                  PlayBeat.call(p, wide: true))
            check(first.standing == "TOP 1ST · 0-1 · 0 OUTS", "after it, the tag between pitches: the half, the count, the outs",
                  first.standing ?? "nil")
        }
        let called = PlayBeat.Pitch(call: .calledStrike, number: 3, balls: 1, strikes: 2, code: "FF", mph: 97.2)
        check(PlayBeat.call(called, wide: true) == "STRIKE 2 · 97 MPH FOUR-SEAM FASTBALL"
              && PlayBeat.call(called, wide: false) == "STRIKE 2 · 97 MPH FOUR-SEAM"
              && PlayBeat.call(PlayBeat.Pitch(call: .ball, number: 4, balls: 3, strikes: 2, code: "ST", mph: 84), wide: true) == "BALL 3 · 84 MPH SWEEPER"
              && PlayBeat.call(PlayBeat.Pitch(call: .automaticBall, number: 1, balls: 1, strikes: 0), wide: true) == "AUTOMATIC BALL 1 · PITCH CLOCK",
              "the call tag: the call and its count, the speed and MLB's name (short in a narrow well); a pitch-clock ball")

        // MARK: What came between

        func beats(_ match: (PlayBeat.Kind) -> Bool) -> [PlayBeat] { line.filter { match($0.kind) } }
        let visits = beats { if case .moundVisit = $0 { return true }; return false }
        let changes = beats { if case .pitchingChange = $0 { return true }; return false }
        check(visits.count == 9 && changes.count == 9, "all 9 mound visits and 9 pitching changes", "\(visits.count) \(changes.count)")
        let coached = visits.filter { $0.kind == .moundVisit(coach: true) }.map(\.id)
        check(["mlb.35.0", "mlb.42.0", "mlb.45.0", "mlb.54.0"].allSatisfy(coached.contains) && visits.contains { $0.kind == .moundVisit(coach: false) },
              "a visit just before a change is the manager's (coming to make it); others the catcher's or the coach's")
        let relievers = changes.compactMap { b -> String? in if case let .pitchingChange(name) = b.kind { return name }; return nil }
        check(relievers == ["Kelly", "Cleavinger", "Wells", "Matz", "Romero", "Uribe", "Baker", "Megill", "Seymour"]
              && changes.contains { $0.tag(wide: true) == "PITCHING CHANGE · ROMERO" },
              "each change names its reliever, in order (\"PITCHING CHANGE · ROMERO\")", "\(relievers)")
        // Romero came in mid-at-bat (Hicks, 0-1, after an injury delay): between pitches 1 and 2, after the delay.
        if let romero = line.firstIndex(where: { $0.id == "mlb.48.2" }), let delay = line.firstIndex(where: { $0.id == "mlb.48.1" }) {
            let before = line[..<delay].last { pitch($0) != nil }, after = line[(romero + 1)...].first { pitch($0) != nil || $0.isPlay }
            check(delay < romero && before.flatMap(pitch)?.number == 1 && (after.map { pitch($0)?.number == 2 || $0.isPlay } ?? false)
                  && line[delay].kind == .delay(.injury(.batter)),
                  "mid-at-bat, in its place: Hicks hurt (the batter: the trainer to the plate), then Romero in, between his pitches")
        } else {
            check(false, "Romero's change and Hicks's injury delay are in the timeline")
        }
        let pickoffs = beats { if case .pickoff = $0 { return true }; return false }
        if let throwOver = pickoffs.first, let i = line.firstIndex(of: throwOver) {
            let next = line[(i + 1)...].first { pitch($0) != nil || $0.isPlay }
            check(pickoffs.count == 1 && throwOver.kind == .pickoff(base: 1, catcher: false) && throwOver.tag(wide: true) == "PICKOFF ATTEMPT · FIRST"
                  && throwOver.inning == 5 && throwOver.top == true && (next.map { pitch($0)?.number == 1 || $0.isPlay } ?? false)
                  && throwOver.bases?[0] == true,
                  "Kelly's throw over to first in the 5th, before the first pitch to Mitchell, with a runner on it")
        } else {
            check(false, "the throw over is in the timeline")
        }
        let injuries = beats { if case .delay(.injury) = $0 { return true }; return false }
        check(injuries.count == 4 && injuries.allSatisfy { $0.tag(wide: true) == "INJURY DELAY" } && injuries.first?.kind == .delay(.injury(.batter)),
              "the four injury delays (each where the trainer goes: here, the batter)", "\(injuries.map(\.kind))")
        let pinch = beats { if case .batterUp(_, true) = $0 { return true }; return false }
        check(pinch.map { $0.tag(wide: true) } == ["PINCH HITTER · PALACIOS", "PINCH HITTER · MESA JR"],
              "a pinch hitter steps in, said so (\"PINCH HITTER · PALACIOS\")", "\(pinch.map { $0.tag(wide: true) })")
        let switches = beats { if case .substitution = $0 { return true }; return false }
        check(switches.map { $0.tag(wide: true) } == ["DEFENSIVE SWITCH · PALACIOS · 2B", "DEFENSIVE SWITCH · MESA JR. · RF"],
              "they take the field: \"DEFENSIVE SWITCH · MESA JR. · RF\"", "\(switches.map { $0.tag(wide: true) })")
        let stealEvents = atBats.flatMap { ab in ab.events.filter { $0.kind == .action("stolen_base_2b") }.map { "mlb.\(ab.index).\($0.index)" } }
        check(stealEvents.count == 1 && !line.contains { stealEvents.contains($0.id) }
              && line.contains { b in b.isPlay && (items.first { $0["id"].string == b.id }?["text"].string ?? "").contains("stole") },
              "a steal is ESPN's play (replayed from its scene), never MLB's action as well")
        let challenged = pitches.filter { pitch($0)?.review != nil }
        if let c = challenged.first, let p = pitch(c), let words = PlayBeat.challenge(p) {
            check(challenged.count == 2 && p.call == .calledStrike && PlayBeat.call(p, wide: true, asCalled: true).hasPrefix("BALL ")
                  && words.asked == "ABS CHALLENGE · CONTRERAS" && words.result == "OVERTURNED · STRIKE \(p.strikes)",
                  "an ABS challenge: the call as made (a ball), who asked, then \"OVERTURNED · STRIKE 1\"", "\(words)")
        } else {
            check(false, "the challenged pitches are in the timeline")
        }
        let breaks = beats { if case .inningBreak = $0 { return true }; return false }
        check(breaks.first?.tag(wide: true) == "MIDDLE 1ST" && breaks.dropFirst().first?.tag(wide: true) == "END 1ST"
              && breaks.first?.standing == "MIDDLE 1ST",
              "between halves the tag says so, and it stands until play resumes (\"MIDDLE 1ST\", \"END 1ST\")")

        // The rain delay: the tarp out, and back in.
        let rain = Statcast.atBats(JSON(data: delayData))
        let rainBeats = rain.flatMap { ab in ab.events.compactMap { PlayBeat.beat($0, in: ab) } }.filter { if case .delay = $0.kind { return true }; return false }
        check(rainBeats.map(\.kind) == [.delay(.weather("Rain")), .delay(.over)] && rainBeats.map { $0.tag(wide: true) } == ["RAIN DELAY", "PLAY RESUMES"]
              && BaseballFeed.delay(mlb: "Delayed: Rain") == .weather("Rain")
              && BaseballFeed.delay(JSON(["type": ["name": "STATUS_RAIN_DELAY", "detail": "Rain Delay"]])) == .weather("Rain")
              && BaseballFeed.delay(JSON(["type": ["name": "STATUS_IN_PROGRESS", "detail": "Top 4th"]])) == nil,
              "a rain delay as MLB posts it (and its live status, and ESPN's): \"RAIN DELAY\", then \"PLAY RESUMES\"")

        // MARK: The pitch

        let field = PlayScript.Rest(bases: [false, false, false], bats: .right)
        /// Where the ball crosses the front of the plate in a pitch's script.
        func crossing(_ s: PlayScript) -> FieldPoint? {
            guard let f = s.flights.first else { return nil }
            var t = f.start, last = f.point(at: t)
            while t < f.end {
                t += 0.0005
                let p = f.point(at: t)
                if p.y <= 17.0 / 12 { return last.y - p.y > 0 ? p : last }
                last = p
            }
            return nil
        }
        // (A pitch that bounced in front of the plate ends in the dirt there.)
        let measured = pitches.filter { b in
            pitch(b).map { ($0.call == .calledStrike || $0.call == .ball) && ($0.flight?.plate.y ?? 0) > 0.3 } ?? false
        }
        let spots = measured.compactMap { b -> (PlayBeat, FieldPoint, SIMD2<Double>)? in
            guard let p = pitch(b), let f = p.flight, let x = crossing(PlayScript(beat: b, rest: field)) else { return nil }
            return (b, x, f.plate)
        }
        let zoned = measured.compactMap { b -> (CGPoint, SIMD2<Double>)? in
            guard let f = pitch(b)?.flight, let z = PlayScript(beat: b, rest: field).zone else { return nil }
            return (z.crossing, f.plate)
        }
        check(zoned.count == measured.count && zoned.allSatisfy { abs($0.0.x - $0.1.x) < 0.01 && abs($0.0.y - $0.1.y) < 0.01 },
              "…and its strike zone marks the spot it crossed")
        let worst = spots.map { max(abs($0.1.x - $0.2.x), abs($0.1.z - $0.2.y)) }.max() ?? 0
        check(spots.count == measured.count && worst < 0.06,
              "every taken pitch crosses the plate exactly where MLB measured it (\(spots.count) of them)",
              "\(spots.count)/\(measured.count), worst \(worst) ft")
        if let inside = spots.min(by: { $0.2.x < $1.2.x }), let away = spots.max(by: { $0.2.x < $1.2.x }) {
            check(abs(inside.1.x - away.1.x) > 2 && abs(inside.1.x - inside.2.x) < 0.06 && abs(away.1.x - away.2.x) < 0.06
                  && abs(inside.1.z - inside.2.y) < 0.06 && abs(away.1.z - away.2.y) < 0.06,
                  "two real pitches end at two different spots, each its own (\(String(format: "%.2f", inside.2.x)) and \(String(format: "%.2f", away.2.x)) ft across)")
        }
        if let b = espnOnly.first(where: { pitch($0)?.call == .calledStrike }), let p = pitch(b), let x = crossing(PlayScript(beat: b, rest: field)) {
            let want = BeatBuilder.plateLocation(p, seed: b.seed)
            check(abs(x.x - want.x) < 0.06 && abs(x.z - want.y) < 0.06 && p.x != nil,
                  "without MLB's flight, a pitch still ends at ESPN's plate location (its strike zone chart's)")
        }
        let sinker = BeatBuilder.shaped(PlayBeat.Pitch(call: .ball, number: 1, balls: 1, strikes: 0, code: "SI", mph: 95), arm: .right, seed: 1)
        let sweeper = BeatBuilder.shaped(PlayBeat.Pitch(call: .ball, number: 1, balls: 1, strikes: 0, code: "ST", mph: 84), arm: .right, seed: 1)
        let lefty = BeatBuilder.shaped(PlayBeat.Pitch(call: .ball, number: 1, balls: 1, strikes: 0, code: "ST", mph: 84), arm: .left, seed: 1)
        let four = BeatBuilder.shaped(PlayBeat.Pitch(call: .ball, number: 1, balls: 1, strikes: 0, code: "FF", mph: 95), arm: .right, seed: 1)
        check(sinker.acceleration.x < 0 && sweeper.acceleration.x > 0 && lefty.acceleration.x < 0 && sinker.release.x < 0 && lefty.release.x > 0
              && sinker.acceleration.z < four.acceleration.z,
              "a pitch shaped like its type: a righty's sinker runs to his arm side and sinks, his sweeper sweeps the other way (a lefty's mirrored)")
        if let b = line.first(where: { pitch($0)?.flight != nil }), let f = pitch(b)?.flight {
            check((0...1).contains(BeatBuilder.slot(f))
                  && BeatBuilder.slot(Statcast.Pitch(release: [-0.2, 50, 6.6], velocity: [0, -140, 0], acceleration: [0, 30, -20], plate: [0, 2.5],
                                                     zone: nil, mph: 95, spin: nil, type: "FF")) > 0.9
                  && BeatBuilder.slot(Statcast.Pitch(release: [-3.4, 50, 5.0], velocity: [0, -140, 0], acceleration: [0, 30, -20], plate: [0, 2.5],
                                                     zone: nil, mph: 90, spin: nil, type: "SI")) < 0.15,
                  "his arm slot from where the ball left his hand: high and in line over the top, low and wide sidearm")
        }

        // Swings and fouls.
        let swung = pitches.filter { pitch($0)?.call == .swingingStrike }, takes = pitches.filter { pitch($0)?.call == .calledStrike }
        let fouls = pitches.filter { pitch($0)?.call == .foul }
        func batter(_ s: PlayScript) -> PlayScript.Actor? { s.actors.first { $0.role == .batter } }
        check(swung.allSatisfy { batter(PlayScript(beat: $0, rest: field))?.swing != nil }
              && takes.allSatisfy { let a = batter(PlayScript(beat: $0, rest: field)); return a?.swing == nil && a?.check == nil },
              "he swings through a swinging strike and takes a called one")
        let foulScripts = fouls.map { PlayScript(beat: $0, rest: field) }
        let away = foulScripts.compactMap { s in s.watch.map { s.flights[$0].to } }
        check(away.count == fouls.count && away.allSatisfy { $0.y < 0 || abs($0.x) > $0.y }
              && foulScripts.allSatisfy { s in s.flashes.contains { $0.beat == .contact } && batter(s)?.swing != nil },
              "every foul is hit (contact) and goes foul: back, or over a line")
        let ways = Set(away.map { $0.y < 0 ? "back" : $0.x < 0 ? "left" : "right" })
        check(ways.count == 3 && PlayScript(beat: fouls[0], rest: field) == foulScripts[0],
              "fouls go every way, as their pitches make likely, and the same foul always goes the same way", "\(ways)")
        if let checkSwing = pitches.first(where: { b in batter(PlayScript(beat: b, rest: field))?.check != nil }) {
            check(pitch(checkSwing)?.call == .ball && pitch(checkSwing)?.strikes == 2, "a check swing only ever on a ball, with two strikes")
        }
        if let dirt = pitches.first(where: { pitch($0)?.call == .ballInDirt }) {
            let s = PlayScript(beat: dirt, rest: field)
            check(s.actors[1].actions.filter { $0.kind == .scoop }.count == 2 && s.flights.count >= 3,
                  "a ball in the dirt: the catcher drops to block it, picks it up, and throws it back")
        }
        let caught = PlayScript(beat: takes[0], rest: PlayScript.Rest(bases: [true, false, true], bats: .left))
        let back = caught.flights.last
        check(back.map { abs($0.to.x - Ballpark.position(1).x) < 1 && abs($0.to.y - Ballpark.position(1).y) < 2 } ?? false
              && caught.captions.first?.line == .call(asCalled: false) && caught.duration < 3.2
              && caught.actors.filter { $0.role == .runner }.allSatisfy { r in r.moves.count == 2 && r.position(at: caught.duration) == r.at },
              "a taken pitch: back to the mound, its call as it pops, under 3.2 s, each runner off on a secondary lead and back")

        // MARK: Throws and changes

        if let throwOver = pickoffs.first {
            let s = PlayScript(beat: throwOver, rest: PlayScript.Rest(bases: [true, false, false], bats: .left))
            let throwing = s.flights.first, runner = s.actors.first { $0.role == .runner }
            check(throwing.map { hypot($0.to.x - Ballpark.bag(1).x, $0.to.y - Ballpark.bag(1).y) < 0.5 } ?? false
                  && s.actors[0].actions.contains { $0.kind == .throwBall } && s.actors[2].actions.contains { $0.kind == .glove }
                  && runner?.diveBack != nil && runner.map { $0.position(at: s.duration) == Ballpark.lead(1) } ?? false,
                  "the throw over goes from the pitcher to the first baseman at the bag; the runner dives back and takes his lead again")
        }
        let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        if let i = items.firstIndex(where: { $0["type"]["type"].string == "play-result" && ($0["text"].string ?? "").contains("stole second") }),
           let steal = PlayScene.parse(items, at: i, side: side, names: names) {
            let s = PlayScript(steal, rest: PlayScript.Rest(bases: steal.basesAfter, bats: .right))
            let toBag = s.flights.dropFirst().first { hypot($0.to.x - Ballpark.bag(2).x, $0.to.y - Ballpark.bag(2).y) < 1 }
            check(steal.kind == .stolenBase && toBag != nil && s.actors[1].actions.contains { $0.kind == .throwBall }
                  && s.actors.contains { $0.role == .runner && $0.moves.contains { $0.path.last == Ballpark.base(2) } },
                  "Turang's steal: he breaks for second, and the catcher's throw goes to second",
                  "\(steal.kind) \(steal.runners) flights \(s.flights.map { "\(Int($0.to.x)),\(Int($0.to.y))" })")
        } else {
            check(false, "Turang's steal of second is in Game 5's plays")
        }
        if let romero = changes.first(where: { $0.tag(wide: true) == "PITCHING CHANGE · ROMERO" }) {
            // TB batting in the bottom of the 6th: the Brewers (visitors) in the field, out of the third-base dugout and left field's pen.
            let rest = PlayScript.Rest(bases: [false, false, false], bats: .right, fieldingHome: false)
            let s = PlayScript(beat: romero, rest: rest)
            let reliever = s.actors.dropFirst(9).first { $0.role == .fielder(1) }
            let manager = s.actors.first { $0.role == .coach }
            check(reliever.map { $0.position(at: s.duration) == rest.spot(1) && $0.at.x < 0 && $0.team == .fielding } ?? false
                  && s.actors[0].vanish < s.duration && s.actors[0].moves.last?.path.last == Ballpark.dugout(home: false)
                  && manager.map { $0.position(at: 1.8).y > 45 && $0.vanish < s.duration } ?? false,
                  "the pitching change: the manager walks out, the pitcher off to his dugout, Romero in from his team's bullpen to the rubber")
        }
        let visit = PlayScript(beat: visits.first { $0.kind == .moundVisit(coach: false) } ?? visits[0], rest: field)
        check(visit.actors[1].position(at: 2.5).y > 45 && visit.actors[1].position(at: visit.duration) == field.spot(2),
              "a mound visit: the catcher out to the mound and back behind the plate")

        // Between halves: the sides change.
        if let i = items.firstIndex(where: { $0["type"]["type"].string == "play-result" && $0["outs"].int == 3 && $0["period"]["type"].string == "Top" }),
           let third = PlayScene.parse(items, at: i, side: side, names: names) {
            let rest = PlayScript.Rest(bases: [false, false, false], bats: nil, swapped: true, fieldingHome: false)
            let s = PlayScript(third, rest: rest)
            let old = s.actors.prefix(9), new = s.actors.filter { a in
                guard a.team == .batting, case .fielder = a.role else { return false }
                return true
            }
            let leaving = Ballpark.dugout(home: true), coming = Ballpark.dugout(home: false)
            /// Nearer `p` as he goes than when the play settled.
            func toward(_ a: PlayScript.Actor, _ p: CGPoint, at t: Double) -> Bool {
                let then = a.position(at: s.settle), now = a.position(at: t)
                return hypot(now.x - p.x, now.y - p.y) < hypot(then.x - p.x, then.y - p.y) - 1
            }
            check(old.allSatisfy { $0.vanish < s.duration && toward($0, leaving, at: $0.vanish) }
                  && new.count == 9 && new.allSatisfy { a in if case let .fielder(n) = a.role { return a.position(at: s.duration) == rest.spot(n) }; return false }
                  && new.allSatisfy { a in if case let .fielder(n) = a.role {
                      return hypot(a.at.x - coming.x, a.at.y - coming.y) < hypot(rest.spot(n).x - coming.x, rest.spot(n).y - coming.y) }; return false },
                  "after the third out the Rays jog off to their dugout and the Brewers come out of theirs to take the field")
        }
        let middle = breaks[0]
        let warm = PlayScript(beat: middle, rest: PlayScript.Rest(bases: [false, false, false], bats: nil, fieldingHome: false))
        check(warm.release != nil && warm.flights.contains { $0.fresh } && warm.actors.count == 9 && middle.tag(wide: true) == "MIDDLE 1ST",
              "the break: the team out there warms up (the pitcher's toss, a grounder round the infield), nobody batting")
        let rained = PlayScript(beat: rainBeats[0], rest: field)
        check(rained.tarp?.out == true && rained.actors.allSatisfy { $0.vanish < rained.duration }
              && PlayScript(rest: PlayScript.Rest(standing: .tarp)).tarp?.cover(at: .infinity) == 1,
              "the rain delay: everyone off, the tarp out over the infield, and it stays out while the delay stands")

        // MARK: The idle life

        let between = PlayScript.Rest(bases: [false, false, false], bats: nil)
        let busy = PlayScript.Rest(bases: [true, false, true], bats: .left)
        let picks = (0..<40).compactMap { IdleBeat.next($0, rest: busy, between: false, seed: 7) }
        check(picks.count == 40 && zip(picks, picks.dropFirst()).allSatisfy { $0.beat != $1.beat } && picks.allSatisfy { (4.5...8).contains($0.wait) }
              && Set(picks.map(\.beat)).count >= 4 && picks.map(\.beat) == (0..<40).compactMap { IdleBeat.next($0, rest: busy, between: false, seed: 7)?.beat },
              "idle moves: one every 4.5–8 s, never the same twice running, the same every time")
        check(IdleBeat.fitting(between, between: true).allSatisfy { [.warmup, .infield, .outfield, .weight].contains($0) }
              && !IdleBeat.fitting(field, between: false).contains(.lead) && IdleBeat.fitting(busy, between: false).contains(.lead)
              && IdleBeat.next(0, rest: PlayScript.Rest(standing: .tarp), between: false, seed: 1) == nil,
              "only moves that fit: warm-ups between halves, a lead off with a runner on, nothing under the tarp")
        let still = PlayScript(rest: busy)
        let moves = IdleBeat.allCases.filter { $0 != .trainer }.map { PlayScript(idle: $0, rest: $0 == .warmup || $0 == .infield || $0 == .outfield ? between : busy, seed: 3) }
        check(moves.allSatisfy { m in m.duration <= 3 && m.actors.allSatisfy { $0.position(at: 0) == $0.at && $0.position(at: m.duration) == $0.at } }
              && moves[0].actors.count == still.actors.count,
              "each idle move is short and starts and ends on the field as it stands (so the field is still in between)")

        // MARK: The queue

        let backlog = (1...9).map { PlayBeat(id: "p\($0)", kind: .pitch(PlayBeat.Pitch(call: .ball, number: $0, balls: 1, strikes: 0))) }
            + [PlayBeat(id: "visit", kind: .moundVisit(coach: false))]
        check(PlayBeat.catchUp(backlog).map(\.id) == ["p6", "p7", "p8", "p9", "visit"] && PlayBeat.catchUp(Array(backlog.prefix(4))).count == 4,
              "a backlog (the feed was slow) plays its last few pitches, and everything else")
        let withPlay = Array(backlog.prefix(3)) + [PlayBeat(id: "play", kind: .play), backlog[3]]
        check(PlayBeat.catchUp(withPlay).map(\.id) == ["play", "p4"],
              "a play waiting goes first (a scoring slide keeps time with its replay), what came after it after")
    }
}
