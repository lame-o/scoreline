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
                                                  ("3701", "INT", "Overshown · 4 yd return"), ("9361", "+5 FLAG", "Neutral Zone Infraction, Defense · No play"),
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
            check(march.from == Gridiron.y(72) && march.to == Gridiron.y(82) && s.flag.map { $0.lands < march.start } == true,
                  "a return, the flag on the hold during it, then 10 yards walked back from where it was enforced (DAL 28)")
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
        // Every player, every frame, every snap: the stances, the poses and every blend between them.
        let broken = zip(scenes, all).compactMap { scene, s -> String? in
            let teams = FootballTeams(offense: Uniform(.blue), defense: Uniform(.orange))
            return jointsBreak(s.duration, s.players.count) { i, t in
                FootballFrame(scene: scene, script: s, t: t, teams: teams, ink: TheaterInk(.dark), size: CGSize(width: 312, height: 156))
                    .pose(s.players[i], i, at: s.players[i].position(at: t), unit: 1.1 / 8.5).0
            }.map { "\(scene.text.prefix(30)): \($0)" }
        }
        check(broken.isEmpty, "in every snap of the game, knees and elbows bend only their own way, never past folded",
              broken.prefix(3).joined(separator: " | "))
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
        check(hashed.allSatisfy { s in s.players.filter { $0.team != .official }.allSatisfy { abs($0.at.x) < Gridiron.half } },
              "…and every player lines up inside the sidelines (an official who throws a flag works from his)")
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
                  && stamp(attempt) == "2-PT ✓" && FootballStamp(attempt).title == "Prescott, left guard" && s.banner == nil,
                  "…the quarterback who threw the touchdown keeps it, into the end zone: 2-PT ✓")
        }
        let separate = FootballScene.parse(entry("Extra Point Good", "C.Dicker extra point is GOOD, Center-C.Johnson, Holder-B.Mann.", from: 0, to: 0),
                                           teams: teams)
        let failed = FootballScene.parse(entry("Two Point Pass", "TWO-POINT CONVERSION ATTEMPT. J.Hurts pass to D.Smith is incomplete. ATTEMPT FAILS.",
                                               from: 98, to: 98), teams: teams)
        check(separate?.pointAfter == .kick && separate?.from == 85 && stamp(separate) == "XP ✓"
              && failed?.pointAfter == .pass && failed?.kind == .incomplete && stamp(failed) == "2-PT ✗" && failed.map { FootballScript($0).banner == nil } == true,
              "a try logged as its own entry replays as one: XP ✓ from the 15, a failed two-point pass 2-PT ✗")
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

        // MARK: Between plays

        if let play = scene("9274"), let td = scene("3048"), let attempt = td.conversion {
            let fresh = FootballTheaterState(play: play, news: true), old = FootballTheaterState(play: play, news: false)
            check(FootballTheater.shown(old, replaying: nil, rested: nil) == nil && FootballTheater.shown(fresh, replaying: nil, rested: nil) == play,
                  "opening the page on an old snap shows the game as it stands; a fresh one replays")
            check(FootballTheater.shown(fresh, replaying: play.id, rested: nil) == play && FootballTheater.shown(fresh, replaying: play.id, rested: play.id) == nil,
                  "a replay's end holds (the stamp, the ball, the players where it ended), then gives way to the live scene")
            let scored = FootballTheaterState(play: td, news: true)
            check(FootballTheater.shown(scored, replaying: attempt.id, rested: td.id) == attempt
                  && FootballTheater.shown(scored, replaying: attempt.id, rested: attempt.id) == nil,
                  "a touchdown's try plays its own beat after the touchdown, and holds the same")
            let next = FootballTheaterState(play: scene("2186"), news: true)
            check(FootballTheater.shown(next, replaying: play.id, rested: nil) == next.play, "the next snap cuts in, whatever is holding")
        }
        let live = FootballScript(rest: FootballScript.Rest(yard: 40, gain: 50))
        check(live.lines.scrimmage == Gridiron.y(40) && live.lines.gain == Gridiron.y(50) && live.stamp == .infinity && live.flights.isEmpty
              && live.players.count == 22 && live.players.filter { $0.role == .line }.allSatisfy { $0.inStance(at: .infinity) },
              "…the game as it stands: both teams at the line, the linemen down in their stances, the blue and yellow lines, no stamp, no flight")
        check(TheaterKit.hold == .seconds(8), "one hold for every theater: a replay's end stays 8 s")

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

// Every field the feed gives, read on real games: two college games
// (Tests/Fixtures/cfb-plays.json, every entry, in college's own grammar), the
// NFL's turnovers, sacks, flags and hits from four games of 25 Oct
// (nfl-turnovers-plays.json), and two NFL depth charts (nfl-depthcharts.json).

extension ScorelineTests {
    static func footballFidelity() {
        print("\nFootball theater: what the feed says")
        struct Game {
            let teams: FootballFeed.Teams
            let items: [JSON]
        }
        func games(_ file: String) -> [Game] {
            guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent(file)) else { return [] }
            return JSON(data: data)["games"].array.map { g in
                // The away team on top, as on the MNF page.
                Game(teams: FootballFeed.Teams(topIsHome: false, topID: g["away"]["id"].string, bottomID: g["home"]["id"].string,
                                               homeAbbreviation: g["home"]["abbreviation"].string ?? "",
                                               awayAbbreviation: g["away"]["abbreviation"].string ?? "",
                                               homeName: g["home"]["name"].string ?? "", awayName: g["away"]["name"].string ?? ""),
                     items: g["items"].array)
            }
        }
        let college = games("cfb-plays.json"), nfl = games("nfl-turnovers-plays.json")
        guard college.count == 2, nfl.count == 4 else { return check(false, "football fidelity fixtures load") }
        /// The play whose text says this, parsed with its game's teams.
        func play(_ clue: String, in set: [Game]) -> FootballScene? {
            for game in set {
                if let item = game.items.first(where: { ($0["text"].string ?? "").contains(clue) }) { return FootballScene.parse(item, teams: game.teams) }
            }
            return nil
        }
        func cfb(_ clue: String) -> FootballScene? { play(clue, in: college) }
        func pro(_ clue: String) -> FootballScene? { play(clue, in: nfl) }

        // MARK: Positions

        check(FootballScene.Position(espn: 35) == .defensiveBack && FootballScene.Position(espn: 37) == .defensiveLine
              && FootballScene.Position(espn: 45) == .lineman, "ESPN's 35 is a defensive back, 37 a defensive lineman, 45 an offensive lineman")
        check(FootballScene.Position(espn: 19) == .corner && FootballScene.Position(espn: 21) == .safety && FootballScene.Position(espn: 34) == .defensiveBack
              && FootballScene.Position(espn: 26) == .linebacker && FootballScene.Position(espn: 24) == .defensiveLine && FootballScene.Position(espn: 39) == .snapper
              && FootballScene.Position(espn: 79) == nil,
              "…and the depth chart's slots: RCB 19 a corner, FS 21 a safety, the nickel back, WLB, LDT, the long snapper (a holder is no position)")

        // MARK: College's grammar

        var tally: [String: (Int, Int)] = [:]
        func count(_ key: String, _ ok: Bool) { let (a, b) = tally[key] ?? (0, 0); tally[key] = (a + (ok ? 1 : 0), b + 1) }
        for game in college {
            for item in game.items {
                let type = (item["type"]["text"].string ?? "").lowercased()
                guard let s = FootballScene.parse(item, teams: game.teams) else { continue }
                count("lead", s.names["lead"] != nil)
                if ["pass reception", "pass incompletion", "passing touchdown"].contains(type) {
                    count("pass", s.depth != nil && s.lane != nil && s.air != nil)
                }
                if ["rush", "pass reception", "sack"].contains(type), !(item["text"].string ?? "").contains("TOUCHDOWN") { count("stop", s.stopped != nil) }
                if ["kickoff", "punt"].contains(type) { count("kick", s.kickYards != nil && s.turn != nil) }
                if type.contains("interception") { count("turnover", s.turn != nil) }
                if type.contains("fumble") { count("turnover", s.loose != nil && s.recovered != nil) }
            }
        }
        func share(_ key: String) -> Double { tally[key].map { Double($0.0) / Double(max($0.1, 1)) } ?? 0 }
        func shown(_ key: String) -> String { tally[key].map { "\($0.0)/\($0.1)" } ?? "none" }
        check(share("lead") >= 0.95 && share("stop") == 1 && share("pass") == 1 && share("kick") == 1 && share("turnover") == 1,
              "two college games: who has the ball \(shown("lead")), where he was stopped \(shown("stop")), every pass's depth, side and spot "
                + "\(shown("pass")), every kick's landing \(shown("kick")), every turnover's spots \(shown("turnover")) (all none before)")

        let run = cfb("#4 D.Hill rush middle for 2 yards gain to the ALA43")
        check(run?.lane == .middle && run?.gap == .middle && run?.stopped == 43 && run?.names["lead"] == "Hill" && run?.names["stop"] == "Jones",
              "Hill up the middle to Alabama's 43, stopped by Jones", "\(String(describing: run))")
        let caught = cfb("#12 K.Russell pass complete short left to #7 R.Scott caught at TAM24")
        check(caught?.depth == .short && caught?.lane == .left && caught?.air == 17 && caught?.stopped == 76 && caught?.names["target"] == "Scott",
              "a short pass left, caught exactly 17 yards downfield (\"caught at TAM24\"), to Scott")
        let thrown = cfb("pass incomplete short middle to #4 D.Hill thrown to TAM22")
        check(thrown?.kind == .incomplete && thrown?.air == 7, "an incompletion thrown exactly 7 yards downfield (\"thrown to TAM22\")")
        let kick = cfb("kickoff 41 yards to the ALA24 #81 K.Edwards return 9 yards")
        check(kick?.kickYards == 41 && kick?.turn == 76 && kick?.kick == .returned && kick?.stopped == 67 && kick?.returnYards == 9
              && kick?.names["returner"] == "Edwards", "a kickoff 41 yards to the 24, returned 9 by Edwards")
        check(cfb("punt 46 yards to the TAM00, Touchback")?.turn == 105 && cfb("punt 46 yards to the TAM00, Touchback")?.kick == .touchback
              && cfb("punt 49 yards to the ALA26 fair catch")?.kick == .fairCatch && cfb("punt 49 yards to the ALA26 fair catch")?.turn == 74,
              "a punt into the end zone, a touchback; another fair caught at the 26")
        let pick = cfb("intercepted by #5 D.Lee Jr. at TAM39")
        check(pick?.kind == .interception && pick?.turn == 39 && pick?.names["taker"] == "Lee Jr." && pick?.pickSix == true,
              "Lee's pick at the 39, returned for a touchdown")
        let lost = cfb("fumbled by #10 M.Reed at TAM45 recovered by ALA #36 Q.Reese")
        check(lost?.kind == .fumble && lost?.loose == 45 && lost?.turn == 45 && lost?.names["taker"] == "Reese", "a fumble lost at the 45, Reese on it")
        let kept = cfb("fumbled by #10 M.Reed at TAM18 forced by #90 L.Simmons")
        check(kept?.kind == .rush && kept?.loose == 18 && kept?.recovered == 22 && kept?.stripper?.name == "Simmons" && kept?.stripper?.id != nil,
              "a fumble kept: knocked out at the 18 by Simmons (his credit), recovered at the 22")
        let split = cfb("sacked for loss of 5 yards to the TAM15 (#3 M.Ratcliffe, #10 M.Jones)")
        check(split?.sackers.map(\.name) == ["Ratcliffe", "Jones"] && split?.sackers.allSatisfy { $0.id != nil } == true && split?.stopped == 85,
              "a split sack: Ratcliffe and Jones, both credited, down at the 15")
        let hurried = cfb("QB hurried by #3 M.Ratcliffe and #10 M.Jones")
        check(hurried?.pressure?.hit == false && hurried?.pressure?.by.map(\.name) == ["Ratcliffe", "Jones"] && hurried?.pressure?.by.first?.jersey == "3",
              "a hurried throw: Ratcliffe (#3) and Jones")
        let targeting = cfb("PENALTY ALA Targeting (#6 R.Morgan)")
        let flag = targeting?.flags.first
        check(flag?.name == "Targeting" && flag?.yards == 15 && flag?.from == 71 && flag?.to == 86 && flag?.noPlay == true && flag?.side == .bottom
              && flag?.player?.name == "Morgan" && flag?.player?.id != nil && flag?.timing == .duringPlay && targeting?.penalty?.name == "Targeting",
              "a college flag from the text: targeting on Alabama's Morgan, 15 yards from the 29 to the 14, no play", "\(String(describing: flag))")
        check(cfb("PENALTY ALA False Start (#65 T.Miller)")?.flags.first?.timing == .beforeSnap
              && cfb("PENALTY ALA Offside declined")?.flags.first?.status == .declined && cfb("PENALTY ALA Offside declined")?.penalty == nil,
              "…a false start before the snap; a declined offside that doesn't count")
        let overturned = cfb("pass intercepted by #19 C.McDonald III at TAM41, End Of Play. The previous play")
        check(overturned?.kind == .interception && overturned?.turn == 41 && overturned?.names["taker"] == "McDonald III",
              "a review that made it an interception: the ruling that stood, not the original", "\(String(describing: overturned))")
        // Kent State's spots by its name ("Kent38"), Akron's too.
        let named = cfb("punt 42 yards to the Akron09 fair catch by #13 S.Patrick at Akron09")
        check(named?.turn == 91 && named?.kick == .fairCatch, "spots by a team's name: a punt to Akron's 9")
        let offsetting = cfb("PENALTY Kent UNS: Unsportsmanlike Conduct offsetting Akron")
        check(offsetting?.flags.count == 2 && offsetting?.flags.allSatisfy { $0.status == .offsetting && $0.timing == .afterPlay } == true
              && Set(offsetting?.flags.compactMap(\.side) ?? []).count == 2, "offsetting fouls run together: two flags, one each, after the play")
        let muffed = cfb("muffed by #28 L.Reed at Akron04 recovered by Kent #24 T.Mintz at Akron13")
        check(muffed?.kick == .returned && muffed?.stopped == 87, "a muffed kick, recovered by the kicking team at the 13")

        // MARK: NFL turnovers

        let ints = nfl.flatMap { g in g.items.filter { ($0["type"]["text"].string ?? "").contains("Interception") }.compactMap { FootballScene.parse($0, teams: g.teams) } }
        // A fumble in the ruling that stood (one the review reversed isn't).
        let fumbles = nfl.flatMap { g in g.items.filter { FootballScene.ruling($0["text"].string ?? "").contains("FUMBLES") }.compactMap { FootballScene.parse($0, teams: g.teams) } }
        check(ints.count == 5 && ints.allSatisfy { $0.turn != nil } && fumbles.count >= 8 && fumbles.allSatisfy { $0.loose != nil && $0.recovered != nil },
              "every NFL pick has its spot (\(ints.filter { $0.turn != nil }.count)/\(ints.count); 2 before), every fumble where it came loose and "
                + "where it was recovered (\(fumbles.filter { $0.loose != nil && $0.recovered != nil }.count)/\(fumbles.count); 1 and 3 of 8 before)")
        let okada = pro("INTERCEPTED by T.Okada [N.Emmanwori] at SEA 34")
        check(okada?.turn == 66 && okada?.pressure?.hit == true && okada?.pressure?.by.first?.name == "Emmanwori" && okada?.pressure?.by.first?.id != nil,
              "a pick past the hitter's [brackets]: at SEA 34, Emmanwori credited with the hit on Mahomes")
        check(pro("INTERCEPTED by N.Williams [G.Karlaftis] at KC -9")?.turn == 109 && pro("INTERCEPTED by T.Smith (K.Scott) at CAR 32")?.turn == 32
              && pro("INTERCEPTED by Z.McCollum at 50")?.turn == 50,
              "…in the end zone (KC -9), past a breakup in (parentheses), at midfield")
        let strip = pro("P.Mahomes sacked at SEA 32 for -2 yards (D.Hall). FUMBLES (D.Hall) [D.Hall], touched at SEA 27, and recovers at SEA 32")
        check(strip?.kind == .sack && strip?.loose == 68 && strip?.recovered == 68 && strip?.stripper?.name == "Hall" && strip?.stripper?.id != nil
              && strip?.sackers.first?.name == "Hall", "a strip-sack he kept: loose where Hall sacked him, recovered there (\"and recovers at\")")
        let scoop = pro("FUMBLES (A.Muhammad) [A.Muhammad], RECOVERED by TB-C.Kancey at CAR 32")
        check(scoop?.kind == .fumble && scoop?.loose == 31 && scoop?.turn == 32 && scoop?.scoring == .touchdown && scoop?.stripper?.name == "Muhammad"
              && scoop?.sackers.map(\.name) == ["Muhammad"], "a strip-sack scooped for a touchdown: loose at the 31, Kancey's at the 32")
        let aborted = pro("J.Goff FUMBLES (Aborted) at DET 41")
        check(aborted?.loose == 41 && aborted?.turn == 42, "a botched snap: loose at the 41, recovered at the 42")
        let lower = pro("FUMBLES (W.Lee), recovered by TB-D.Sills at CAR 37")
        check(lower?.loose == 63 && lower?.recovered == 63 && lower?.stripper?.name == "Lee", "\"recovered by\" in lower case, and who punched it out")
        let splitSack = pro("sack split by D.Alexander and A.Reese")
        check(splitSack?.sackers.map(\.name) == ["Alexander", "Reese"] && splitSack?.sackers.allSatisfy { $0.id != nil } == true && splitSack?.stopped == 40,
              "a split sack, both credited, at HST 40 (the gamebook's code for Houston)")
        let blocked = pro("35 yard field goal is BLOCKED (D.Wonnum)")
        check(blocked?.blocker?.name == "Wonnum" && blocked?.blocker?.id != nil && blocked?.blocker?.position == .linebacker, "a blocked field goal: Wonnum got a hand on it")
        let hit = pro("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall].")
        check(hit?.pressure?.hit == true && hit?.pressure?.by.map(\.name) == ["Hall"] && hit?.pressure?.by.first?.position == .linebacker,
              "a hit as he threw: Hall, from the brackets and the `other` credit")
        check(pro("(Shotgun) P.Mahomes pass incomplete deep right to X.Worthy.")?.pressure == nil
              && pro("(Shotgun) P.Mahomes pass incomplete deep right to X.Worthy.")?.participants.contains { $0.role == "other" } == true,
              "…an `other` with no brackets isn't a hit (its play stats show none)")

        // MARK: NFL flags

        let shift = pro("PENALTY on KC-T.Kelce, Illegal Shift, 5 yards, enforced at SEA 46 - No Play.")?.flags.first
        check(shift?.slug == "illegal-shift" && shift?.player?.name == "Kelce" && shift?.player?.id != nil && shift?.from == 54 && shift?.to == 49
              && shift?.noPlay == true && shift?.side == .top && shift?.timing == .duringPlay,
              "the flag on Kelce: an illegal shift, enforced at SEA 46, walked back to KC's 49, no play", "\(String(describing: shift))")
        let both = pro("Penalty on KC-J.Ezeudu, Offensive Holding, offsetting")?.flags
        check(both?.map(\.status) == [.offsetting, .offsetting] && both?.map(\.side) == [.top, .bottom] && both?.last?.name == "Horse Collar Tackle",
              "offsetting flags: Kansas City's hold, Seattle's horse collar")
        let declined = pro("Penalty on GB-K.Brooks, Defensive Offside, declined.")
        check(declined?.flags.first?.status == .declined && declined?.penalty == nil, "a declined flag is on the play, but walks nothing off")
        check(pro("PENALTY on SEA, Delay of Game")?.flags.first?.timing == .beforeSnap && pro("PENALTY on SEA, Delay of Game")?.flags.first?.player == nil
              && pro("Illegal Formation, 5 yards, enforced between downs")?.flags.first?.timing == .afterPlay,
              "a delay of game before the snap (on the team, no one player); a foul enforced between downs, after the play")

        // MARK: Depth charts

        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("nfl-depthcharts.json")) else {
            return check(false, "depth charts fixture loads")
        }
        let raw = JSON(data: data)["teams"]
        let kc = FootballDepthChart(raw["12"]), sea = FootballDepthChart(raw["26"])
        check(kc?.front == .fourThree && sea?.front == .threeFour && sea?.slots.contains { $0.key == "nt" } == true,
              "Kansas City's base 4-3, Seattle's base 3-4 (a nose tackle)")
        check(sea?.slot(of: "4247808")?.key == "ss" && sea?.slots.first { $0.key == "lde" }?.lane == .right
              && sea?.slots.first { $0.key == "rcb" }?.lane == .left && kc?.slots.first { $0.key == "lt" }?.lane == .left
              && kc?.slots.first { $0.key == "lt" }?.position == .lineman,
              "each man in his slot: the strong safety; the defense's left end on the offense's right, its right corner on the left")
        if let strip, let kc, let sea {
            let placed = strip.slotted(by: [.top: kc, .bottom: sea])
            check(placed.stripper?.slot == "slb" && placed.sackers.first?.slot == "slb" && placed.front == .threeFour,
                  "the strip-sack on the chart: Hall is Seattle's strong-side backer, in a 3-4")
        }
        var october = DateComponents(calendar: Calendar(identifier: .gregorian), timeZone: TimeZone(identifier: "UTC"), year: 2026, month: 10, day: 27, hour: 18)
        let fall = october.date
        october.year = 2027
        october.month = 2
        check(fall.map(FootballFeed.season) == 2026 && october.date.map(FootballFeed.season) == 2026, "the season a game falls in: October's and February's are 2026's")
        footballSequencing(college: college.map { ($0.teams, $0.items) }, nfl: nfl.map { ($0.teams, $0.items) }, kc: kc, sea: sea)
    }
}

// The choreography reading every field, on the same real plays: the hit as
// he throws, the strip and the scramble for the ball, the split sack, the
// blocked kick, each flag at the moment and the place of its foul and its
// walk, college's exact spots, the defense in its own front with each
// credited man in his slot, and the ball in the throwing hand.

extension ScorelineTests {
    static func footballSequencing(college: [(FootballFeed.Teams, [JSON])], nfl: [(FootballFeed.Teams, [JSON])], kc: FootballDepthChart?,
                                   sea: FootballDepthChart?) {
        print("\nFootball theater: every play in the order it happened")
        /// The play whose text says this, parsed with its game's teams (Kansas City at Seattle's on their depth charts).
        func play(_ clue: String, in set: [(FootballFeed.Teams, [JSON])]) -> FootballScene? {
            for (teams, items) in set {
                guard let item = items.first(where: { ($0["text"].string ?? "").contains(clue) }), let s = FootballScene.parse(item, teams: teams)
                else { continue }
                if teams.topID == "12", let kc, let sea { return s.slotted(by: [.top: kc, .bottom: sea]) }
                return s
            }
            return nil
        }
        func pro(_ clue: String) -> FootballScene? { play(clue, in: nfl) }
        func cfb(_ clue: String) -> FootballScene? { play(clue, in: college) }
        func near(_ a: CGPoint?, _ b: CGPoint?, _ tolerance: Double) -> Bool {
            guard let a, let b else { return false }
            return hypot(a.x - b.x, a.y - b.y) <= tolerance
        }
        /// Who has a pose of this kind, and when.
        func acting(_ s: FootballScript, _ kind: FootballScript.Action.Kind) -> [(player: Int, at: Double)] {
            s.players.indices.flatMap { i in s.players[i].actions.filter { $0.kind == kind }.map { (i, $0.at) } }
        }
        func quarterback(_ s: FootballScript) -> Int? { s.players.firstIndex { $0.role == .quarterback } }

        // MARK: The defense, in its own front

        if let sea3 = pro("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]"), let kc4 = pro("S.Darnold pass incomplete short middle to J.Smith-Njigba") {
            let a = FootballScript(sea3), b = FootballScript(kc4)
            let down = a.players.filter { $0.team == .defense && $0.role == .front }
            let keys = Set(a.players.compactMap(\.key))
            check(sea3.front == .threeFour && down.count == 3 && down.contains { $0.key == "nt" && abs($0.at.x) < 1 }
                  && b.players.filter { $0.team == .defense && $0.role == .front }.count == 4
                  && a.players.filter { $0.team == .defense }.count == 11 && a.players.filter { $0.team == .offense }.count == 11,
                  "Seattle in its base 3-4: three down, a nose tackle over the ball; Kansas City's 4-3, four down; eleven a side")
            check(["lde", "rde", "nt", "wlb", "lcb", "rcb", "ss", "fs", "lt", "rt", "c", "qb"].allSatisfy(keys.contains)
                  && a.players.filter { $0.key == "lcb" }.allSatisfy { $0.at.x > 0 } && a.players.filter { $0.key == "lt" }.allSatisfy { $0.at.x < 0 },
                  "every man in a depth-chart slot: the defense's left corner on the offense's right, its left tackle on its left")
        }

        // MARK: Pressure

        if let hit = pro("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]") {
            let s = FootballScript(hit)
            let qb = quarterback(s)!
            let release = s.players[qb].actions.first { $0.kind == .throwBall }?.at ?? 0
            let hitter = acting(s, .tackle).first { $0.at > release - 0.05 && $0.at < release + 0.25 }
            check(hitter.map { near(s.players[$0.player].position(at: $0.at), s.players[qb].position(at: release), 3.5)
                    && s.players[$0.player].role == .backer && s.players[$0.player].position(at: 0).x * (hit.lane == .left ? -1 : 1) != 0 } == true
                  && s.players[qb].holds.contains { $0.kind == .knocked && $0.from > release } && s.flashes.contains { $0.beat == .hit && $0.at > release },
                  "a hit as he threw: Seattle's backer (Hall, credited in brackets) gets to Mahomes as the ball leaves, and puts him on his back after it")
            check(s.flights.contains { $0.start == release && $0.end - $0.start > 0.5 }, "…the throw still goes, deep right")
        }
        if let hurried = cfb("QB hurried by #3 M.Ratcliffe and #10 M.Jones") {
            let s = FootballScript(hurried)
            let qb = quarterback(s)!
            let release = s.players[qb].actions.first { $0.kind == .throwBall }?.at ?? 0
            let closing = s.players.indices.filter { s.players[$0].team == .defense }
                .filter { hypot(s.players[$0].position(at: release).x - s.players[qb].position(at: release).x,
                                s.players[$0].position(at: release).y - s.players[qb].position(at: release).y) < 8 }
            check(closing.count == 2 && !s.players[qb].holds.contains { $0.kind == .knocked },
                  "a hurried throw (college's \"QB hurried by\"): both men close on him as he throws, a stride short, no hit")
        }

        // MARK: The strip and the scramble

        if let strip = pro("B.Young sacked at CAR 31 for -9 yards (A.Muhammad). FUMBLES") {
            let s = FootballScript(strip)
            let qb = quarterback(s)!
            let stripped = acting(s, .strip).first
            let pop = s.flights.first { $0.start > 1 && abs($0.from.z - 3.4) < 0.01 }
            let recovery = acting(s, .scoop).first
            check(stripped.map { pop?.start == $0.at } == true && pop.map { abs($0.to.y - Gridiron.y(31)) < 0.5 } == true
                  && s.players[qb].holds.contains { $0.kind == .down },
                  "a strip-sack: Muhammad's punch as he gets there, the ball out of Young's arms at the spot of the sack, Young down")
            check(recovery.map { r in s.players[r.player].team == .defense && s.players[r.player].role == .front
                    && abs(s.players[r.player].position(at: r.at).y - Gridiron.y(32)) < 1 } == true
                  && acting(s, .scramble).count >= 2 && s.players.contains { $0.team == .offense && $0.actions.contains { $0.kind == .scramble } },
                  "…the scramble for it, a man from each side laid out, and Kancey (a lineman, as credited) scoops it up at the 32")
            check(s.end.map { $0.y < 0 } == true && s.banner?.text == "TOUCHDOWN" && recovery.map { (s.score ?? 0) > $0.at } == true,
                  "…and runs it back into the end zone: TOUCHDOWN once he's across, after the recovery")
        }
        if let kept = pro("P.Mahomes sacked at SEA 32 for -2 yards (D.Hall). FUMBLES") {
            let s = FootballScript(kept)
            let qb = quarterback(s)!
            let stripper = acting(s, .strip).first
            check(stripper.map { s.players[$0.player].key == "slb" || s.players[$0.player].role == .backer } == true
                  && s.legs.last { $0.until.isInfinite }.map { $0.hand == .carry(qb) } == true && s.banner == nil
                  && s.next.gain.map { $0 > (s.next.scrimmage ?? 0) } == true,
                  "a strip-sack he kept: Hall (Seattle's strong-side backer) punches it out, Mahomes falls on it at the 32, the ball still Kansas City's")
        }
        if let run = pro("J.Gibbs up the middle to GB 6 for 6 yards (I.McDuffie). FUMBLES") {
            let s = FootballScript(run)
            let carrier = s.players.indices.first { i in s.legs.contains { $0.hand == .carry(i) } && s.players[i].role == .back }
            let stripped = acting(s, .strip).first
            let recovered = s.legs.last { $0.until.isInfinite }?.from ?? 0
            check(carrier.map { c in stripped.map { abs(s.players[c].position(at: $0.at).y - Gridiron.y(94)) < 1 } == true } == true
                  && s.banner?.text == "FUMBLE" && s.banner.map { abs($0.at - recovered) < 0.1 } == true
                  && s.next.gain.map { $0 < (s.next.scrimmage ?? 0) } == true,
                  "a run fumbled: Gibbs stripped by McDuffie where it came out, Green Bay comes up with it, FUMBLE as he does, the lines turn round")
        }
        if let keptRun = cfb("fumbled by #10 M.Reed at TAM18 forced by #90 L.Simmons") {
            let s = FootballScript(keptRun)
            let takers = s.legs.compactMap { leg -> Int? in if case let .carry(i) = leg.hand, leg.until.isInfinite { return i }; return nil }
            check(acting(s, .strip).count == 1 && takers.allSatisfy { s.players[$0].team == .offense } && s.end.map { abs($0.y - Gridiron.y(22)) < 1 } == true,
                  "a college fumble kept: stripped at the 18, Texas A&M falls on it at the 22")
        }
        if let aborted = pro("J.Goff FUMBLES (Aborted) at DET 41") {
            let s = FootballScript(aborted)
            check(s.flights.filter { $0.end - $0.start > 0.1 }.count >= 2 && acting(s, .scramble).contains { s.players[$0.player].role == .quarterback }
                  && s.banner?.text == "FUMBLE", "a botched snap: on the ground at Goff's feet, he goes down after it, Green Bay recovers")
        }

        // MARK: Sacks and a blocked kick

        if let split = pro("sack split by D.Alexander and A.Reese") {
            let s = FootballScript(split)
            let qb = quarterback(s)!
            let down = s.players[qb].holds.first { $0.kind == .down }?.from ?? 0
            let sackers = acting(s, .tackle).filter { abs($0.at - down) < 0.3 }
            check(sackers.count == 2 && sackers.allSatisfy { near(s.players[$0.player].position(at: $0.at), s.players[qb].position(at: $0.at), 5) },
                  "a split sack: Alexander and Reese both get to Stroud")
        }
        if let blocked = pro("35 yard field goal is BLOCKED (D.Wonnum)") {
            let s = FootballScript(blocked)
            let leap = acting(s, .leap).first
            let off = s.flights.firstIndex { $0.to.z > 7 && $0.end - $0.start < 0.3 }
            check(leap != nil && off.map { i in abs(s.flights[i].end - (leap?.at ?? 0)) < 0.01 && s.flights[i + 1].to.z < 1 } == true
                  && s.score == nil && s.banner?.text == "BLOCKED" && s.flashes.contains { $0.beat == .deflect },
                  "a blocked field goal: Wonnum up at the line, both arms high, the ball off his hands a beat after the kick and away: BLOCKED")
        }

        // MARK: Flags

        if let false0 = pro("PENALTY on SEA-G.Zabel, False Start") {
            let s = FootballScript(false0)
            let official = s.players.firstIndex { $0.team == .official }
            check(!s.flashes.contains { $0.beat == .snap } && !s.legs.contains { if case .carry = $0.hand { return true }; return false }
                  && s.flags.count == 1 && official.map { abs(s.players[$0].at.x) > Gridiron.half } == true
                  && acting(s, .flagThrow).count == 1 && s.march.map { abs($0.to - $0.from - Gridiron.y(-5)) < 0.01 } == true,
                  "a false start: no snap; the flag from the wing official, onto the lineman who moved; five yards walked off")
        }
        if let hold = pro("K.Walker left tackle to SEA 39 for 6 yards (U.Nwosu).PENALTY on KC-K.Suamataia"),
           let played = FootballScript.played(hold) {
            let s = FootballScript(hold)
            let flag = s.flags.first
            let tackle = s.flashes.first { $0.beat == .hit }?.at ?? 0
            let fouler = s.players.indices.first { s.players[$0].key == hold.flags.first?.player?.slot }
            check(played.kind == .rush && played.to == 61 && s.flights.count >= 2 && flag.map { $0.thrown < tackle } == true
                  && fouler.map { f in flag.map { near($0.to, s.players[f].position(at: $0.lands - 0.5), 4) } == true } == true,
                  "holding on a run: the run plays out (the snap, the handoff, Walker to the 39), the flag lands on Suamataia while it goes on",
                  "\(String(describing: played.kind)) \(played.to) \(String(describing: flag))")
            check(s.march.map { abs($0.from - Gridiron.y(55)) < 0.01 && abs($0.to - Gridiron.y(45)) < 0.01 } == true
                  && s.march.map { m in tackle < m.start } == true && FootballStamp(hold).title == "Holding, Offense · No play",
                  "…then walked off from where it was enforced (SEA 45) to KC's 45: the stamp names it as the referee does, \"Holding, Offense\"",
                  FootballStamp(hold).title)
        }
        if let rough = pro("J.Goff pass incomplete short right to S.LaPorta.PENALTY on GB-B.Cox, Roughing the Passer") {
            let s = FootballScript(rough)
            let qb = quarterback(s)!
            let release = s.players[qb].actions.first { $0.kind == .throwBall }?.at ?? 0
            check(s.flags.first.map { $0.lands > release && $0.lands < release + 0.9 && near($0.to, s.players[qb].position(at: release), 6) } == true,
                  "roughing the passer: the flag comes in on Goff just after the throw")
        }
        if let interference = pro("PENALTY on CAR-A.Evans, Defensive Pass Interference") {
            let s = FootballScript(interference)
            let pass = s.flights.first { $0.start > 1 && $0.end - $0.start > 0.3 }
            check(pass.map { p in s.flags.first.map { abs($0.lands - (p.end + 0.45)) < 0.05 && near($0.to, p.to.ground, 6) } == true } == true,
                  "pass interference: the flag where the ball comes down, as it does")
        }
        if let declined = pro("sack split by D.Alexander and A.Reese") {
            let s = FootballScript(declined)
            check(s.flags.count == 1 && s.flags[0].declined && s.march == nil, "a declined hold: the flag, DECLINED beside it, nothing walked off")
        }
        if let offsetting = pro("Penalty on KC-J.Ezeudu, Offensive Holding, offsetting") {
            let s = FootballScript(offsetting)
            check(s.flags.count == 2 && s.march == nil && Set(s.players.filter { $0.team == .official }.map(\.at.x)).count == 2
                  && FootballStamp(offsetting).parts.map(\.text) == ["NO PLAY"] && FootballStamp(offsetting).title == "Offsetting penalties",
                  "offsetting fouls: two flags from two officials, nothing walked off, NO PLAY")
        }
        if let late = pro("PENALTY on GB-D.Wyatt, Unnecessary Roughness") {
            let s = FootballScript(late)
            let tackle = s.flashes.first { $0.beat == .hit }?.at ?? 0
            check(s.flags.first.map { $0.thrown > tackle } == true && s.march != nil, "unnecessary roughness after the whistle: the flag once the play's over, then the walk")
        }

        // MARK: College's spots

        if let caught = cfb("#12 K.Russell pass complete short left to #7 R.Scott caught at TAM24"),
           let thrown = cfb("pass incomplete short middle to #4 D.Hill thrown to TAM22") {
            let a = FootballScript(caught), b = FootballScript(thrown)
            let pass = a.flights.first { $0.start > 1 && $0.end - $0.start > 0.3 }, miss = b.flights.first { $0.start > 1 && $0.end - $0.start > 0.3 }
            check(pass.map { abs($0.to.y - Gridiron.y(caught.from + 17)) < 0.01 } == true && miss.map { abs($0.to.y - Gridiron.y(thrown.from + 7)) < 0.01 } == true,
                  "college's exact spots: caught at the 24, 17 yards downfield; thrown to the 22, 7 yards, where it comes down")
        }

        // MARK: The ball in his hand

        if let s = pro("P.Mahomes pass incomplete deep right to X.Worthy [D.Hall]").map(FootballScript.init), let qb = quarterback(s),
           let release = s.players[qb].actions.first(where: { $0.kind == .throwBall })?.at {
            let player = s.players[qb]
            check(FootballFrame.cocked(player, at: release - 0.6) == 0 && FootballFrame.cocked(player, at: release - 0.15) == 1
                  && FootballFrame.cocked(player, at: release - 0.02) == 1 && FootballFrame.cocked(player, at: release + 0.2) == 0,
                  "the ball in both hands in the pocket, in his throwing hand once he cocks it, until it's away")
        }

        // MARK: Every play

        let all = (college + nfl).flatMap { teams, items in items.compactMap { FootballScene.parse($0, teams: teams) } }
        let scripts = all.map { ($0, FootballScript($0)) }
        let sane = scripts.filter { _, s in
            !(stride(from: 0.0, through: s.duration, by: 0.1).allSatisfy { t in
                s.players.allSatisfy { p in let q = p.position(at: t); return q.x.isFinite && q.y.isFinite }
                    && (s.ball(at: t).map { $0.x.isFinite && $0.y.isFinite && $0.z >= -0.01 } ?? true)
            } && s.duration > 2 && s.duration < 11 && s.stamp < s.settle)
        }
        check(sane.isEmpty, "every play of two college games and the NFL's turnovers, hits and flags: finite, the ball never under the grass, 2–11 s",
              sane.prefix(3).map { "\($0.0.text.prefix(50)) \($0.1.duration)" }.joined(separator: " | "))
        let teams = FootballTeams(offense: Uniform(.blue), defense: Uniform(.orange))
        let broken = scripts.filter { scene, _ in !scene.flags.isEmpty || scene.loose != nil || scene.pressure != nil || scene.blocker != nil }
            .compactMap { scene, s -> String? in
                jointsBreak(s.duration, s.players.count) { i, t in
                    FootballFrame(scene: scene, script: s, t: t, teams: teams, ink: TheaterInk(.dark), size: CGSize(width: 312, height: 156))
                        .pose(s.players[i], i, at: s.players[i].position(at: t), unit: 1.1 / 8.5).0
                }.map { "\(scene.text.prefix(30)): \($0)" }
            }
        check(broken.isEmpty, "the new poses (the strip, the scramble, the hit, the leap, the flag thrown), every blend: knees and elbows bend their own way",
              broken.prefix(3).joined(separator: " | "))
    }
}
