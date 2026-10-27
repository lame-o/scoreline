import SwiftUI

// The football theater, checked on a real game: Monday Night Football, DAL at
// PHI (Tests/Fixtures/mnf-dal-phi-plays.json, every core play as ESPN sent
// it). ESPN's plays parsed into scenes (the kind, the spots read from the home
// team's goal line, the hole, the depth and side, the downs, the flag), what's
// news, the choreography (a pass comes down where it was caught, a run goes
// through the hole it names, a field goal through the uprights), the broadcast
// camera, the stamp, and one celebration per moment.

extension ScorelineTests {
    static func footballTheater() {
        print("\nFootball theater")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("mnf-dal-phi-plays.json")) else {
            return check(false, "MNF plays fixture loads")
        }
        let items = JSON(data: data)["items"].array
        // DAL (6) visiting, the top team; PHI (21) at home.
        let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
        func item(_ suffix: String) -> JSON? { items.first { $0["id"].string?.hasSuffix(suffix) == true } }
        func scene(_ suffix: String) -> FootballScene? { item(suffix).flatMap { FootballScene.parse($0, teams: teams) } }
        func script(_ suffix: String) -> FootballScript? { scene(suffix).map(FootballScript.init) }
        func stamp(_ s: FootballScene?) -> String { s.map { FootballStamp($0).parts.map(\.text).joined(separator: " ") } ?? "nil" }

        // MARK: Every play

        let scenes = items.compactMap { FootballScene.parse($0, teams: teams) }
        let admin = items.filter { FootballScene.parse($0, teams: teams) == nil }.compactMap { $0["type"]["text"].string }
        check(scenes.count == 156 && Set(admin).isSubset(of: ["Coin Toss", "Official Timeout", "Timeout", "End Period", "End of Half",
                                                             "Two-minute warning"]),
              "every snap and kick in the game is a scene; timeouts, quarter ends and the coin toss aren't",
              "\(scenes.count) scenes; not: \(Set(admin))")
        check(scenes.allSatisfy { $0.kind != .other }, "all 156 replay as what they were: none falls back to a generic replay",
              scenes.filter { $0.kind == .other }.map(\.text).joined(separator: " | "))
        // The home team's yard line, read for the offense, agrees with ESPN's yards to the end zone (on the
        // snaps: on two punts ESPN counts those from the other end).
        let spotted = items.filter { i in
            i["start"]["yardsToEndzone"].int.map { $0 > 0 } == true
                && FootballScene.parse(i, teams: teams).map { $0.kind != .punt && $0.kind != .kickoff } == true
        }
        let misread = spotted.filter { i in
            FootballScene.parse(i, teams: teams).map { abs($0.from - (100 - Double(i["start"]["yardsToEndzone"].int ?? 0))) > 0.01 } ?? true
        }
        check(misread.isEmpty, "every snap's spot (from the home team's goal line) matches ESPN's yards to the end zone",
              misread.compactMap { $0["text"].string }.prefix(3).joined(separator: " | "))
        // The drive chart's coordinates: the same play, the same spot (the top team attacks right).
        let charted = items.compactMap { i -> (FootballScene, DrivePlay)? in
            guard let s = FootballScene.parse(i, teams: teams), let d = FootballFeed.play(i, teams: teams) else { return nil }
            return (s, d)
        }
        check(charted.count == scenes.count && charted.allSatisfy { s, d in abs((s.offense == .top ? s.from : 100 - s.from) - d.startX) < 0.01 },
              "…and where the drive chart draws it")

        // MARK: Kinds and what the text adds

        let short = scene("9274")
        check(short?.kind == .pass && short?.lane == .right && short?.depth == .short && short?.air == 1 && short?.yards == 12
              && short?.outOfBounds == true && short?.position("receiver") == .back && short?.firstDown == true,
              "a short pass right to the back, caught a yard past the line (12 gained, 11 after the catch), pushed out: a first down",
              "\(String(describing: short))")
        check(short?.offense == .bottom && short?.from == 25 && short?.to == 37, "…PHI's, from its 25 to its 37")
        let deep = scene("2186")
        check(deep?.kind == .pass && deep?.depth == .deep && deep?.air == 22 && deep?.to == 91 && deep?.offense == .top,
              "a deep pass right: caught 22 yards downfield, out at PHI 9 (DAL's 91)")
        let run = scene("3403")
        check(run?.kind == .rush && run?.lane == .left && run?.gap == .tackle && run?.yards == 34 && run?.position("rusher") == .back,
              "a run through left tackle, 34 yards", "\(String(describing: run))")
        check(scene("9493")?.gap == .guard && scene("9168")?.gap == .end && scene("9780")?.gap == .middle,
              "…the holes by name: left guard, left end, up the middle")
        check(scene("1477")?.position("rusher") == .quarterback && scene("1477")?.kind == .rush, "a scramble: the quarterback keeps it")
        let touchdown = scene("1152")
        check(touchdown?.kind == .rush && touchdown?.scoring == .touchdown && touchdown?.from == 95 && touchdown?.to == 100
              && touchdown?.scorer == .bottom && touchdown?.gap == .tackle,
              "Pierce's 5-yard touchdown run through left tackle, PHI's points")
        let sack = scene("3888")
        check(sack?.kind == .sack && sack?.yards == -8 && sack?.stopped == 9 && sack?.position("sackedBy") == .defensiveLine,
              "a sack: 8 yards lost, down at the 9, by a lineman")
        let fieldGoal = scene("9213")
        check(fieldGoal?.kind == .fieldGoal(good: true) && fieldGoal?.kickYards == 55 && fieldGoal?.scoring == .fieldGoal
              && fieldGoal?.penalty == nil, "a 55-yard field goal (the declined flag on it doesn't count)")
        let punt = scene("1812")
        check(punt?.kind == .punt && punt?.kick == .downed && punt?.turn == 98 && punt?.kickYards == 48 && punt?.flips == true,
              "a punt downed at the 2")
        let touchback = scene("1592")
        check(touchback?.kind == .kickoff && touchback?.kick == .touchback && (touchback?.turn ?? 0) > 100, "a kickoff into the end zone: a touchback")
        let kickoff = scene("0940")
        check(kickoff?.kick == .returned && kickoff?.turn == 90 && kickoff?.returnYards == 25 && kickoff?.offense == .bottom,
              "a kickoff from PHI's 35 to DAL's 10, returned 25 yards")
        let pick = scene("3701")
        check(pick?.kind == .interception && pick?.turn == 70 && pick?.air == 2 && pick?.to == 66 && pick?.flips == true
              && pick?.position("returner") == .linebacker && pick?.lane == .right && pick?.depth == .short,
              "an interception: picked off 2 yards past the line by a linebacker, returned to DAL's 34", "\(String(describing: pick))")
        let flag = scene("9361")
        check(flag?.kind == .penalty && flag?.penalty == FootballScene.Penalty(name: "Neutral Zone Infraction", yards: 5, noPlay: true)
              && flag?.to == 92 && flag?.firstDown == false, "a flag before the snap: neutral zone infraction, 5 yards, no play")
        check(scene("9756")?.firstDown == true && scene("3169")?.firstDown == false && scene("3169")?.to == 8,
              "…a flag's first down (2nd & 4, encroachment: 1st & 10); a hold that walks it back isn't one")
        check(scene("3933")?.onDowns == true && scene("3933")?.flips == true && scene("3933")?.kind == .incomplete,
              "fourth down, incomplete: a turnover on downs")
        let reversed = scene("2976")
        check(reversed?.kind == .incomplete && reversed?.lane == .left && reversed?.depth == .short && reversed?.flips == false,
              "a fumble return the review reversed: replayed as the incompletion it became")
        let kickFlag = scene("9423")
        check(kickFlag?.stopped == 68 && kickFlag?.to == 82 && kickFlag?.penalty?.noPlay == false,
              "a return with a hold on it: stopped at DAL's 32, walked back to the 18")
        check(scene("1916")?.kick == .downed && scene("1916")?.stopped == 49 && scene("1916")?.to == 59,
              "a punt downed at DAL's 49, then a hold on the return team: walked back to PHI's 41")
        check(scene("3048")?.scoring == .touchdown && scene("3048")?.depth == .deep && scene("3048")?.lane == .left,
              "a touchdown pass with a two-point try after it: still a deep pass left")

        // MARK: Stamps

        let stamps: [(String, String, String)] = [("9274", "+12 1ST DOWN", "Short right to Barkley"), ("3888", "−8 SACK", "By Williams"),
                                                  ("9145", "INC", "Deep left to Lamb"), ("9213", "FG 55 ✓", "Aubrey"),
                                                  ("1152", "+5 TD", "Pierce, left tackle"), ("1812", "PUNT 48", "Downed"),
                                                  ("3701", "INT", "Overshown · 4 yd return"), ("9361", "+5 FLAG", "Neutral Zone Infraction · No play"),
                                                  ("1592", "KICK 65", "Touchback"), ("0940", "+25 RETURN", "Mingo")]
        let wrong = stamps.filter { id, code, title in
            guard let s = scene(id) else { return true }
            return stamp(s) != code || FootballStamp(s).title != title
        }
        check(wrong.isEmpty, "the stamps: +12 1ST DOWN, −8 SACK, INC, FG 55 ✓, +5 TD, PUNT 48, INT, +5 FLAG, KICK 65, +25 RETURN",
              wrong.map { "\($0.0): \(stamp(scene($0.0))) | \(scene($0.0).map { FootballStamp($0).title } ?? "")" }.joined(separator: "; "))
        check(scene("9213").map { FootballStamp($0).tone } == .score && sack.map { FootballStamp($0).tone } == .loss
              && flag.map { FootballStamp($0).tone } == .flag, "…a score in the team's color, a sack in red, a flag in yellow")

        // MARK: Graceful with what it doesn't know

        func entry(_ type: String, _ text: String, from: Double = 40, to: Double = 40, extra: [String: Any] = [:]) -> JSON {
            var raw: [String: Any] = ["id": "x\(type.hashValue)", "type": ["text": type], "text": text, "statYardage": Int(to - from),
                                      "start": ["yardLine": from, "down": 1, "distance": 10, "team": ["$ref": "/teams/21"]],
                                      "end": ["yardLine": to, "down": 2, "distance": 10, "team": ["$ref": "/teams/21"]]]
            raw.merge(extra) { $1 }
            return JSON(raw)
        }
        let odd = FootballScene.parse(entry("Brand New Play", "Something new happened.", to: 46), teams: teams)
        check(odd?.kind == .other && odd.map { FootballScript($0).duration > 2 } == true,
              "an unknown play still replays: the ball from its spot to where it ended")
        check(FootballScene.parse(JSON(["id": "y", "type": ["text": "Rush"], "text": "", "start": ["yardLine": 40], "end": ["yardLine": 44]]
                                       as [String: Any]), teams: teams) == nil, "a play with no team on it is left alone")
        let kneel = FootballScene.parse(entry("Rush", "T.McKee kneels to PHI 39 for -1 yards.", to: 39), teams: teams)
        let spike = FootballScene.parse(entry("Pass Incompletion", "T.McKee spiked the ball to stop the clock."), teams: teams)
        check(kneel?.kind == .kneel && spike?.kind == .spike && stamp(kneel) == "−1 KNEEL" && stamp(spike) == "INC SPIKE",
              "a kneel and a spike, from the text (they share a type with runs and incompletions)")
        let missed = FootballScene.parse(entry("Field Goal Missed", "J.Elliott 52 yard field goal is No Good, Wide Right, Center-R.Underwood.",
                                               from: 65, to: 72), teams: teams)
        check(missed?.kind == .fieldGoal(good: false) && missed?.miss == .wideRight && stamp(missed) == "FG 52 ✗",
              "a missed field goal: no good, wide right, FG 52 ✗")

        // MARK: What's news

        if let play = deep, let at = play.wallclock {
            let opened = FootballFeed.theater(play, after: FootballTheaterState(), primed: false, now: at + 600)
            check(opened.play?.id == play.id && !opened.news, "a page opened ten minutes after a play shows it as it ended")
            check(FootballFeed.theater(play, after: FootballTheaterState(), primed: false, now: at + 25).news,
                  "…but replays one that happened 25 s ago (ESPN posts plays late)")
            check(FootballFeed.theater(play, after: FootballTheaterState(play: short), primed: true, now: .distantFuture).news,
                  "a play that arrives while the page is open is news")
            check(!FootballFeed.theater(play, after: FootballTheaterState(play: play, news: false), primed: true, now: .distantFuture).news,
                  "a play already showing (edited in place) stays what it was")
        }

        // MARK: Choreography

        if let s = script("2186"), let play = deep {
            let pass = s.flights.first { $0.start > 1 && $0.end - $0.start > 0.3 }
            let caught = pass.map { abs($0.to.y - Gridiron.y(play.from + 22)) < 0.5 } ?? false
            let receiver = s.players.indices.first { s.players[$0].actions.contains { $0.kind == .catchHigh || $0.kind == .catchChest } }
            let hands = pass.flatMap { p in receiver.map { s.players[$0].position(at: p.end) } }
            check(caught && hands.map { hypot($0.x - pass!.to.x, $0.y - pass!.to.y) < 2 } == true,
                  "a deep pass comes down 22 yards downfield, in the receiver's hands", "\(String(describing: pass?.to)) vs \(String(describing: hands))")
            let end = receiver.map { s.players[$0].position(at: .infinity) }
            check(s.end.map { abs($0.y - Gridiron.y(91)) < 0.5 && $0.x > Gridiron.half } == true && end != nil,
                  "…and he runs out of bounds at the 9")
        } else {
            check(false, "deep pass script")
        }
        if let s = script("2403") {
            let pass = s.flights.first { $0.start > 1 && $0.end - $0.start > 0.3 }
            check(pass.map { abs($0.to.y - Gridiron.y(33 + 4)) < 0.5 } == true && s.end.map { abs($0.y - Gridiron.y(52)) < 0.5 } == true,
                  "a short pass with yards after the catch: caught 4 past the line, run on to the 52")
        }
        if let s = script("3403"), let play = run {
            let line = Gridiron.y(play.from)
            let runner = s.players.indices.first { i in s.legs.contains { $0.hand == .carry(i) && $0.until.isInfinite } }
            let crossing = runner.flatMap { r in stride(from: 0.0, to: s.settle, by: 1 / 120).first { s.players[r].position(at: $0).y >= line }
                .map { s.players[r].position(at: $0) } }
            check(crossing.map { $0.x < -9 && $0.x > -18 } == true, "a run through left tackle crosses the line between the left guard and the end",
                  "\(String(describing: crossing))")
            check(s.end.map { abs($0.y - Gridiron.y(75)) < 0.5 } == true && s.flashes.contains { $0.beat == .hit },
                  "…and is brought down at the 25 (DAL's 75)")
        }
        if let s = script("1152") {
            check(s.end.map { $0.y > 300 } == true && s.score.map { $0 < s.stamp } == true && s.banner?.text == "TOUCHDOWN"
                  && s.banner?.at == s.score, "a touchdown: into the end zone, the banner as the ball crosses the goal line")
            check(s.players.contains { $0.holds.contains { $0.kind == .touchdown } }, "…both arms up")
        }
        if let s = script("3888"), let qb = s.players.firstIndex(where: { $0.role == .quarterback }),
           let hit = s.players[qb].holds.first(where: { $0.kind == .down }) {
            let down = s.players[qb].position(at: hit.from)
            check(abs(down.y - Gridiron.y(9)) < 0.5
                  && s.players.contains { $0.team == .defense && $0.actions.contains { $0.kind == .tackle } },
                  "a sack: the quarterback taken down at the 9, behind the line")
        }
        func crossing(_ s: FootballScript) -> FieldPoint? {
            guard let kick = s.flights.first(where: { $0.end - $0.start > 0.6 }) else { return nil }
            let u = stride(from: kick.start, through: kick.end, by: 1 / 600).first { kick.point(at: $0).y >= Gridiron.backLine }
            return u.map { kick.point(at: $0) }
        }
        if let s = script("9213") {
            let through = crossing(s)
            check(s.yaw == 0 && through.map { abs($0.x) < Gridiron.upright && $0.z > Gridiron.crossbar } == true
                  && s.banner?.text == "FIELD GOAL" && s.score != nil,
                  "a field goal, shot from behind the kicker: through the uprights, over the bar", "\(String(describing: through))")
            check(s.ball(at: .infinity) == nil, "…and the ball is put away")
        }
        if let m = missed {
            let through = crossing(FootballScript(m))
            check(through.map { $0.x > Gridiron.upright } == true && FootballScript(m).banner?.text == "NO GOOD", "a miss wide right: past the right upright")
        }
        if let s = script("1812") {
            check(s.end.map { abs($0.y - Gridiron.y(98)) < 0.5 } == true && s.flights.contains { $0.end - $0.start > 1.2 }
                  && s.players.contains { $0.actions.contains { $0.kind == .scoop } }, "a punt: high and long, downed at the 2 by the coverage")
            check(s.next.gain.map { $0 < (s.next.scrimmage ?? 0) } == true, "…and the new lines point the other way (the other team's ball)")
        }
        if let s = script("1592") {
            check(s.flights.contains { $0.to.y > 300 } && s.lines.scrimmage == nil, "a kickoff into the end zone (and no line of scrimmage on a kickoff)")
        }
        if let s = script("3701") {
            let taker = s.players.indices.first { s.players[$0].team == .defense && s.players[$0].actions.contains { $0.kind == .catchChest } }
            check(taker != nil && s.banner?.text == "INTERCEPTION" && s.banner?.tone == .neutral
                  && s.next.gain.map { $0 < (s.next.scrimmage ?? 0) } == true,
                  "an interception: a defender catches it, INTERCEPTION across the top, the lines turn round")
        }
        if let s = script("9361"), let march = s.march, let thrown = s.flag {
            check(march.from == Gridiron.y(87) && march.to == Gridiron.y(92) && thrown.lands < march.start && s.stamp > march.end,
                  "a flag: thrown in, then 5 yards walked off, then the stamp")
        }
        if let s = script("9423"), let march = s.march {
            check(march.from == Gridiron.y(68) && march.to == Gridiron.y(82) && s.flag != nil, "a return, then the hold's 10 yards walked back")
        }
        // Every play in the game: a sane, finite script that ends on the static scene.
        let all = scenes.map(FootballScript.init)
        let finite = all.allSatisfy { s in
            stride(from: 0.0, through: s.duration, by: 0.1).allSatisfy { t in
                s.players.allSatisfy { p in let q = p.position(at: t); return q.x.isFinite && q.y.isFinite }
                    && (s.ball(at: t).map { $0.x.isFinite && $0.y.isFinite && $0.z >= -0.01 } ?? true)
            }
        }
        check(finite, "every play's players and ball stay finite, the ball never under the grass")
        let lengths = all.map(\.duration)
        check(lengths.allSatisfy { $0 > 3 && $0 < 10 }, "every replay runs 3–10 s, settle included (a return with a flag's walk the longest)",
              String(format: "%.2f–%.2f", lengths.min() ?? 0, lengths.max() ?? 0))
        check(all.allSatisfy { $0.stamp.isFinite && $0.stamp < $0.settle }, "every play's stamp lands before the field settles")
        if let s = script("9274") {
            let at = s.players.map { $0.position(at: .infinity) }
            check(zip(at, s.players).allSatisfy { abs($0.y - ($1.at.y + Gridiron.y(12))) < 0.01 && abs($0.x - $1.at.x) < 0.01 }
                  && s.ball(at: .infinity).map { abs($0.y - Gridiron.y(37)) < 0.01 } == true,
                  "after a gain both teams jog back into their places at the new line, the ball spotted there")
        }

        // MARK: Camera

        func view(_ p: FieldPoint, _ c: CameraFrame, yaw: Double) -> (x: Double, y: Double) {
            let v = Gridiron.view(p, yaw: yaw)
            return (0.5 + (v.x - c.x) / (c.span * CameraFrame.aspect), 0.5 + (v.y * 0.5 + v.z * 0.82 - c.y) / c.span)
        }
        func inView(_ p: FieldPoint, _ c: CameraFrame, yaw: Double, slack: Double = 0) -> Bool {
            let v = view(p, c, yaw: yaw)
            return v.x >= -slack && v.x <= 1 + slack && v.y >= -slack && v.y <= 1 + slack
        }
        if let s = script("2186") {
            let open = s.camera.frame(at: 0)
            let offense = s.players.filter { $0.team == .offense }.map { view(FieldPoint($0.at), open, yaw: s.yaw).y }
            let defense = s.players.filter { $0.team == .defense }.map { view(FieldPoint($0.at), open, yaw: s.yaw).y }
            check(s.players.allSatisfy { inView(FieldPoint($0.at), open, yaw: s.yaw, slack: 0.02) }
                  && offense.reduce(0, +) / Double(offense.count) < defense.reduce(0, +) / Double(defense.count),
                  "the snap: behind the offense, all 22 in frame, the defense beyond them")
            if let pass = s.flights.first(where: { $0.start > 1 && $0.end - $0.start > 0.3 }) {
                let frames = Array(stride(from: pass.start, through: pass.end, by: 1 / 60))
                let seen = frames.filter { inView(pass.point(at: $0), s.camera.frame(at: $0), yaw: s.yaw, slack: 0.03) }.count
                check(Double(seen) / Double(frames.count) > 0.9, "a throw: the camera keeps the ball in frame", "\(seen) of \(frames.count)")
            }
            let end = s.camera.frame(at: s.settle)
            check(s.end.map { inView($0, end, yaw: s.yaw) } == true && s.next.scrimmage.map { inView(FieldPoint(x: s.end!.x, y: $0), end, yaw: s.yaw) } == true,
                  "the end: the spot and the new line in frame")
            check(s.camera.frame(at: s.duration) == s.camera.rest && s.camera.frame(at: .infinity) == s.camera.rest,
                  "…then it settles exactly on the rest framing")
        }
        if let s = script("3403") {
            let carrying = stride(from: 1.2, through: s.stamp, by: 1 / 30)
            let runner = s.players.indices.first { i in s.legs.contains { $0.hand == .carry(i) && $0.until.isInfinite } }!
            let seen = carrying.filter { inView(FieldPoint(s.players[runner].position(at: $0)), s.camera.frame(at: $0), yaw: s.yaw, slack: 0.02) }.count
            check(Double(seen) / Double(Array(carrying).count) > 0.95, "a run: the camera follows the ball carrier 34 yards",
                  "\(seen) of \(Array(carrying).count)")
        }
        // Never seasick: every play under the caps.
        var fastest = (pan: 0.0, closer: 0.0, wider: 0.0)
        for s in all {
            var previous = s.camera.frame(at: 0)
            for i in 1...Int(s.duration * 60) {
                let now = s.camera.frame(at: Double(i) / 60)
                let pan = hypot(now.x - previous.x, now.y - previous.y) * 60 / now.span, zoom = log(now.span / previous.span) * 60
                fastest = (max(fastest.pan, pan), max(fastest.closer, -zoom), max(fastest.wider, zoom))
                previous = now
            }
        }
        check(fastest.pan <= 1.5 && fastest.closer <= 1.2 && fastest.wider <= 2.3,
              "the camera never outruns its caps on any play: pans ≤ 1.4 view-heights/s, zooms in ≤ ×3/s, out ≤ ×9/s",
              String(format: "pan %.2f, in %.2f, out %.2f", fastest.pan, fastest.closer, fastest.wider))

        // MARK: One celebration per moment

        check(!FootballCelebration.driveChartBursts(theaterShown: true) && FootballCelebration.driveChartBursts(theaterShown: false),
              "a touchdown's burst: the theater's when it's on the page, else the drive chart's")
        if let play = touchdown, let s = script("1152"), let score = s.score {
            var moment = LiveMoment(id: play.id, chart: .field, tier: .score, kind: .touchdown, lead: "Touchdown", detail: play.text, side: .bottom)
            moment.burst = true
            let full = FootballCelebration.theater(moment, play: play, script: s, level: .full, reduceMotion: false, height: 306)
            let fireworks = full.first { if case .field = $0.anchor { return true }; return false }
            check(fireworks.map { $0.cue.effects == [.fireworks(shells: 2)] && abs($0.at + $0.cue.delay - score) < 0.001 } == true
                  && full.contains { $0.anchor == .banner && $0.cue.effects.contains { if case .confetti = $0 { return true }; return false } },
                  "a touchdown: two shells over the goal line as the ball crosses it, confetti off the banner")
            let subtle = FootballCelebration.theater(moment, play: play, script: s, level: .subtle, reduceMotion: false, height: 306)
            check(subtle.count == 1 && subtle[0].cue.effects == [.sparks(rays: 8, length: 13)], "Subtle: sparks, no confetti")
            check(FootballCelebration.theater(moment, play: play, script: s, level: .off, reduceMotion: false, height: 306).isEmpty, "Off: nothing")
            let still = FootballCelebration.theater(moment, play: play, script: s, level: .full, reduceMotion: true, height: 306)
            check(still.count == 1 && still[0].cue.effects == [.bloom(radius: 22)], "Reduce Motion: one bloom")
            var cooled = moment
            cooled.burst = false
            check(FootballCelebration.theater(cooled, play: play, script: s, level: .full, reduceMotion: false, height: 306)
                    .map(\.cue.effects) == [[.sparks(rays: 8, length: 13)]], "inside the page's 10 s cooldown: sparks, no confetti")
            var winner = moment
            winner.accents = [.decisive]
            check(FootballCelebration.theater(winner, play: play, script: s, level: .full, reduceMotion: false, height: 306)
                    .allSatisfy(\.cue.gold), "a game-winner: all gold")
            let other = LiveMoment(id: "elsewhere", chart: .field, tier: .score, kind: .touchdown, lead: "Touchdown", detail: "")
            check(FootballCelebration.theater(other, play: play, script: s, level: .full, reduceMotion: false, height: 306).isEmpty,
                  "another play's moment never bursts over this one")
        }
        if var six = pick {
            // The same pick, taken all the way back.
            six.scoring = .touchdown
            six.to = 0
            let s = FootballScript(six)
            var moment = LiveMoment(id: six.id, chart: .field, tier: .score, kind: .touchdown, lead: "Touchdown", detail: "", side: .top)
            moment.burst = true
            let bursts = FootballCelebration.theater(moment, play: six, script: s, level: .full, reduceMotion: false, height: 306)
            check(s.banner?.text == "PICK SIX" && six.scorer == .top && bursts.first?.cue.effects == [.fireworks(shells: 3)] && bursts.count == 2,
                  "a pick six: PICK SIX, the most the theater does (three shells and confetti), for the defense")
        }
        if let play = fieldGoal, let s = script("9213") {
            let moment = LiveMoment(id: play.id, chart: .field, tier: .score, kind: .fieldGoal, lead: "Field goal", detail: "", side: .top)
            let pop = FootballCelebration.theater(moment, play: play, script: s, level: .full, reduceMotion: false, height: 306)
            check(pop.count == 1 && pop[0].cue.effects == [.sparks(rays: 6, length: 16)] && pop[0].anchor == .field(s.scorePoint!),
                  "a field goal: a small pop at the crossbar")
        }
        let quiet: [(String, LiveMoment.Kind, String)] = [("3701", .turnover, "INTERCEPTION"), ("3933", .turnover, "TURNOVER ON DOWNS")]
        for (id, kind, banner) in quiet {
            guard let play = scene(id), let s = script(id) else { continue }
            let moment = LiveMoment(id: play.id, chart: .field, tier: .swing, kind: kind, lead: "", detail: "")
            check(FootballCelebration.theater(moment, play: play, script: s, level: .full, reduceMotion: false, height: 306).isEmpty
                  && s.banner?.text == banner && s.banner?.confetti == false, "\(banner): the banner alone")
        }

        // MARK: Formations

        func lineup(_ s: FootballScript, _ team: FootballScript.Team, _ roles: FootballScript.Role...) -> [CGPoint] {
            s.players.filter { $0.team == team && roles.contains($0.role) }.map(\.at)
        }
        if let gun = script("2186"), let heavy = script("3403"), let td = script("1152") {
            let line = Gridiron.y(deep?.from ?? 0)
            check(deep?.shotgun == true && deep?.formation == .base && lineup(gun, .offense, .quarterback).first.map { abs($0.y - (line - 15)) < 0.01 } == true
                  && lineup(gun, .defense, .corner).count == 3,
                  "(Shotgun): the quarterback five yards deep, three wide; the defense in its nickel")
            check(lineup(gun, .offense, .tightEnd, .receiver).filter { $0.x > 0 }.count == 3,
                  "…its strength (the tight end and the slot) to the side the pass went, the right")
            let under = Gridiron.y(run?.from ?? 0)
            check(run?.formation == .heavy && lineup(heavy, .offense, .line).count == 6 && lineup(heavy, .offense, .receiver).isEmpty
                  && lineup(heavy, .offense, .quarterback).first.map { abs($0.y - under) < 8 } == true,
                  "an extra lineman reported in as eligible: a heavy set, six on the line, no one wide, under center")
            let box = heavy.players.filter { $0.team == .defense && abs($0.at.x) < 26 && $0.at.y - under < 30 }.count
            check(box >= 8, "…and eight in the box against it", "\(box)")
            let backs = lineup(td, .offense, .back)
            check(touchdown?.formation == .base && !(touchdown?.shotgun ?? true) && backs.count == 2 && backs.allSatisfy { abs($0.x) < 0.01 }
                  && lineup(td, .defense, .backer).count == 3 && lineup(td, .offense, .tightEnd).first.map { $0.x < 0 } == true,
                  "a run under center: the I (a fullback in front of the back), the tight end to the side it went; base defense")
        }
        if let k = kneel {
            let s = FootballScript(k)
            let qb = lineup(s, .offense, .quarterback).first ?? .zero
            check(k.formation == .victory && lineup(s, .offense, .back).count == 3 && lineup(s, .offense, .receiver).isEmpty
                  && lineup(s, .offense, .back).allSatisfy { $0.y < qb.y }, "the kneel: the victory formation, three backs behind the quarterback")
        }
        let emptySet = FootballScene.parse(entry("Pass Reception", "(Shotgun, Empty) T.McKee pass short right to D.Smith to PHI 46 for 6 yards (D.Bland).",
                                                 to: 46), teams: teams)
        let bunchSet = FootballScene.parse(entry("Pass Reception", "(Shotgun, Bunch) T.McKee pass short left to A.Brown to PHI 45 for 5 yards (D.Bland).",
                                                 to: 45), teams: teams)
        if let e = emptySet, let b = bunchSet {
            let empty = FootballScript(e), bunch = FootballScript(b)
            let line = Gridiron.y(40)
            check(e.formation == .empty && empty.players.filter { $0.team == .offense && $0.role != .quarterback && $0.at.y < line - 6 }.isEmpty
                  && lineup(empty, .defense, .corner).count == 4, "(Empty): nobody behind the quarterback but him; dime against it")
            let trio = lineup(bunch, .offense, .tightEnd, .receiver).filter { $0.x < -20 }
            check(b.formation == .bunch && trio.count == 3 && (trio.map(\.x).max()! - trio.map(\.x).min()!) < 10,
                  "(Bunch): three receivers within a few yards of each other, on the side it went")
        }

        // MARK: The hash

        let onHashes: [FootballScene] = FootballFeed.spot(scenes, after: nil)
        check(onHashes.first?.hash == .middle, "the first snap with nothing before it: in the middle")
        if let i = onHashes.firstIndex(where: { $0.id.hasSuffix("9274") }), i + 1 < onHashes.count {
            check(onHashes[i + 1].hash == .right, "after a pass pushed out on the right: the next snap on the right hash",
                  "\(onHashes[i + 1].hash)")
        }
        if let i = items.firstIndex(where: { $0["id"].string?.hasSuffix("9304") == true }) {
            check(FootballFeed.spotted(items[...i], teams: teams)?.hash == .right,
                  "…as the feed spots it from the plays before it (Barkley's run off the right hash)")
        }
        let incompletions = zip(onHashes, onHashes.dropFirst()).filter { $0.0.kind == .incomplete && !$0.0.flips }
        check(!incompletions.isEmpty && incompletions.allSatisfy { $1.hash == $0.hash }, "after an incompletion: the same spot")
        let afterScores = zip(onHashes, onHashes.dropFirst()).filter { $0.0.scoring != nil }
        check(!afterScores.isEmpty && afterScores.allSatisfy { $1.hash == .middle }, "after a score: from the middle")
        var turned = FootballScene(id: "t", kind: .pass, offense: .top, from: 30, to: 40)
        turned.lane = .left
        turned.flips = true
        check(turned.nextHash == .right && { var s = turned; s.flips = false; return s.nextHash }() == .left,
              "when the ball changes hands, the hash turns round with the offense")
        let hashed: [FootballScript] = onHashes.map(FootballScript.init)
        let onHash = zip(onHashes, hashed).filter { (scene: FootballScene, _: FootballScript) in scene.kind != .kickoff && scene.hash != .middle }
        let snappedThere = onHash.allSatisfy { (scene: FootballScene, s: FootballScript) -> Bool in
            guard let ball = s.ball(at: 0) else { return false }
            return abs(ball.x - Gridiron.spot(scene.hash)) < 0.01
        }
        check(onHash.count > 30 && snappedThere, "the ball snapped from its hash", "\(onHash.count) snaps on a hash")
        check(hashed.allSatisfy { s in s.players.allSatisfy { abs($0.at.x) < Gridiron.half } }, "…and everyone lines up inside the sidelines")
        if let i = onHashes.firstIndex(where: { $0.id.hasSuffix("9274") }), i + 1 < onHashes.count {
            let next: FootballScript = hashed[i + 1]
            let center: CGPoint? = next.players.first { (p: FootballScript.Player) in p.role == .line && p.team == .offense }?.at
            check(center.map { abs($0.x - Gridiron.spot(.right)) < 0.01 } == true, "…the formation round it")
        }
        if var kick = fieldGoal {
            kick.hash = .left
            let s = FootballScript(kick)
            let through = crossing(s)
            check(through.map { abs($0.x) < Gridiron.upright && $0.z > Gridiron.crossbar } == true
                  && s.ball(at: 0).map { $0.x < -5 } == true, "a field goal from the left hash still splits the uprights")
        }

        // MARK: The try

        if let play = touchdown, let attempt = play.conversion {
            let s = FootballScript(attempt)
            let kick = s.flights.first { $0.end - $0.start > 0.6 }
            let through = kick.flatMap { k in stride(from: k.start, through: k.end, by: 1 / 600).first { k.point(at: $0).y >= Gridiron.backLine }
                .map { k.point(at: $0) } }
            check(play.attempt == FootballScene.Attempt(kind: .kick, good: true, text: "J.Elliott extra point is GOOD, Center-R.Underwood, Holder-B.Mann.")
                  && attempt.kind == .extraPoint(good: true) && attempt.pointAfter == .kick && attempt.from == 85 && attempt.id == play.id + "-try"
                  && attempt.offense == .bottom,
                  "a touchdown's extra point, from its entry: a kick from the 15 by the team that scored", "\(String(describing: play.attempt))")
            check(s.yaw == 0 && through.map { abs($0.x) < Gridiron.upright && $0.z > Gridiron.crossbar } == true && s.banner == nil
                  && stamp(attempt) == "XP ✓" && FootballStamp(attempt).title == "Elliott",
                  "…replayed as its own beat: through the uprights, no headline, XP ✓ by Elliott")
            check(s.duration < 3.6 && s.duration < (script("9213")?.duration ?? 0), "…and a short one, shorter than a field goal's",
                  String(format: "%.2f s", s.duration))
        } else {
            check(false, "the touchdown's extra point")
        }
        if let two = scene("3048"), let attempt = two.conversion {
            let s = FootballScript(attempt)
            let carrier = s.players.indices.first { i in s.legs.contains { $0.hand == .carry(i) && $0.until.isInfinite } }
            check(two.attempt?.kind == .rush && two.attempt?.good == true && attempt.kind == .rush && attempt.scoring == .touchdown
                  && attempt.lane == .left && attempt.gap == .guard && attempt.from == 98,
                  "a two-point try: Prescott rushes left guard from the 2, and it succeeds")
            check(carrier.map { s.players[$0].role == .quarterback } == true && s.end.map { $0.y > 300 } == true
                  && stamp(attempt) == "2PT ✓" && FootballStamp(attempt).title == "Prescott, left guard" && s.banner == nil,
                  "…the quarterback who threw the touchdown keeps it, into the end zone: 2PT ✓")
        }
        let separate = FootballScene.parse(entry("Extra Point Good", "C.Dicker extra point is GOOD, Center-C.Johnson, Holder-B.Mann.", from: 0, to: 0),
                                           teams: teams)
        let failed = FootballScene.parse(entry("Two Point Pass", "TWO-POINT CONVERSION ATTEMPT. J.Hurts pass to D.Smith is incomplete. ATTEMPT FAILS.",
                                               from: 98, to: 98), teams: teams)
        check(separate?.pointAfter == .kick && separate?.from == 85 && stamp(separate) == "XP ✓"
              && failed?.pointAfter == .pass && failed?.kind == .incomplete && stamp(failed) == "2PT ✗" && failed.map { FootballScript($0).banner == nil } == true,
              "a try logged as its own entry replays as one: XP ✓ from the 15, a failed two-point pass 2PT ✗")
        if var bare = touchdown {
            bare.attempt = nil
            check(bare.conversion == nil, "a touchdown before ESPN adds its try has none to replay (the edit brings it)")
        }

        // MARK: The stamp's corner and the pace

        // From the moment the stamp has landed, nobody in view stands in its corner (as measured from its
        // type): not while the play holds, not at rest; the camera's move to rest only rarely brushes it.
        var hold = (crowded: 0, frames: 0), toRest = (crowded: 0, frames: 0), atRest = 0
        for s in all where s.stamp.isFinite && s.corner.width > 0 {
            func crowded(_ t: Double) -> Bool {
                let c = s.camera.frame(at: t)
                return s.players.contains { p in
                    guard p.opacity(at: t) > 0.5 else { return false }
                    // His figure: a couple of feet either side of him, from his feet up.
                    let v = Gridiron.view(FieldPoint(p.position(at: t)), yaw: s.yaw)
                    let left = 0.5 + (v.x - 2 - c.x) / (c.span * CameraFrame.aspect), right = 0.5 + (v.x + 2 - c.x) / (c.span * CameraFrame.aspect)
                    let low = 0.5 + (v.y * 0.5 - c.y) / c.span, high = low + 9 / c.span
                    // (The corner as measured, less the margin it keeps beside the type.)
                    return right > 0 && left < s.corner.width - 0.03 && high > 0 && low < s.corner.height
                }
            }
            for t in stride(from: s.stamp + 0.4, through: s.settle, by: 0.05) {
                hold.frames += 1
                if crowded(t) { hold.crowded += 1 }
            }
            for t in stride(from: s.settle, through: s.duration, by: 0.05) {
                toRest.frames += 1
                if crowded(t) { toRest.crowded += 1 }
            }
            if crowded(.infinity) { atRest += 1 }
        }
        check(atRest == 0 && Double(hold.crowded) / Double(max(hold.frames, 1)) < 0.005
              && Double(toRest.crowded) / Double(max(toRest.frames, 1)) < 0.03,
              "once the stamp has landed nobody stands in its corner: not the pile as the play holds, not at rest; the camera's move to rest rarely brushes it",
              "hold \(hold.crowded) of \(hold.frames), to rest \(toRest.crowded) of \(toRest.frames), at rest \(atRest)")
        let median = lengths.sorted()[lengths.count / 2]
        check(median < 4.6, "the replays are brisk: half of them done in under 4.6 s", String(format: "median %.2f s", median))

        // MARK: Drawn

        // The last frame of a replay is the field at rest, pixel for pixel.
        for id in ["9274", "1152"] {
            guard let play = scene(id), let s = script(id) else { continue }
            func frame(_ t: Double) -> Data? {
                let view = FootballFrame(scene: play, script: s, t: t, teams: FootballTeams(offense: Uniform(.blue), defense: Uniform(.orange)),
                                         ink: TheaterInk(.dark), size: CGSize(width: 312, height: 156))
                    .frame(width: 312, height: 156)
                    .background(Color(white: 0.16))
                    .environment(\.colorScheme, .dark)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                return renderer.cgImage?.dataProvider?.data as Data?
            }
            let rest = frame(.infinity)
            check(rest != nil && frame(s.duration) == rest && frame(s.stamp - 0.4) != rest,
                  "\(id == "1152" ? "the touchdown" : "the short pass"): the replay ends exactly on the static scene (and mid-play it isn't)")
        }
    }
}
