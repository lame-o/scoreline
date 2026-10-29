import SwiftUI

// The football theater between snaps, checked on real games: Monday Night
// Football's stoppages (Tests/Fixtures/mnf-dal-phi-plays.json: every
// timeout, TV timeout, two-minute warning, quarter end and the half),
// college's timeouts and automatic reviews (cfb-plays.json), and the NFL's
// challenges, replay reviews and injuries (nfl-stoppages-plays.json, SF at
// ATL whole and four other games' reviewed plays). Each is parsed into what
// the theater shows (who called the timeout, who threw the red flag and what
// came of it, who was hurt), and choreographed: the line of scrimmage at the
// real yard line, the field turning with the quarters, the team that called
// the timeout at its bench, the red flag in from the challenger's, the man
// down with the trainers at him, in sparse beats round a loop; the tag says
// what's happening, and every snap that arrives replays.

extension ScorelineTests {
    static func footballIdle() {
        print("\nFootball between snaps")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("mnf-dal-phi-plays.json")),
              let stopsData = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("nfl-stoppages-plays.json")),
              let collegeData = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("cfb-plays.json")) else {
            return check(false, "football fixtures load")
        }
        let items = JSON(data: data)["items"].array
        // DAL (6) visiting, the top team; PHI (21) at home.
        let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL",
                                       homeName: "Eagles", awayName: "Cowboys")
        func item(_ suffix: String) -> JSON? { items.first { $0["id"].string?.hasSuffix(suffix) == true } }
        func scene(_ suffix: String) -> FootballScene? { item(suffix).flatMap { FootballScene.parse($0, teams: teams) } }
        func near(_ a: CGPoint, _ b: CGPoint, _ tolerance: Double) -> Bool { hypot(a.x - b.x, a.y - b.y) <= tolerance }
        let names = FootballStatus.Names(top: "Cowboys", bottom: "Eagles", topColor: "002a5c", bottomColor: "06424d")

        // MARK: Stoppages, as ESPN posts them

        let stoppages = items.compactMap { FootballStoppage.parse($0, teams: teams) }
        func count(_ kind: FootballStoppage.Kind) -> Int { stoppages.filter { $0.kind == kind }.count }
        check(count(.timeout) == 10 && count(.official) == 15 && count(.twoMinuteWarning) == 2 && count(.endOfPeriod) == 2 && count(.halftime) == 1,
              "every stoppage on Monday night: 10 timeouts, 15 TV timeouts, both two-minute warnings, the 1st and 3rd quarters' ends, the half",
              "\(stoppages.map(\.kind))")
        check(items.allSatisfy { FootballScene.parse($0, teams: teams) == nil || FootballStoppage.parse($0, teams: teams) == nil },
              "…and no snap is one")
        let phiTimeout = item("1100").flatMap { FootballStoppage.parse($0, teams: teams) }
        check(phiTimeout?.kind == .timeout && phiTimeout?.side == .bottom && phiTimeout?.number == 1 && phiTimeout?.period == 2
              && phiTimeout?.clock == "13:55", "\"Timeout #1 by PHI at 13:55.\": PHI's first, in the 2nd (the entry's own team is DAL's, with the ball)")
        let dalTimeout = item("2023").flatMap { FootballStoppage.parse($0, teams: teams) }
        check(dalTimeout?.side == .top && dalTimeout?.number == 1, "\"Timeout #1 by DAL at 01:24.\": DAL's, though PHI had the ball")
        check(item("1850").flatMap { FootballStoppage.parse($0, teams: teams) }?.clock == "2:00"
              && item("2292").flatMap { FootballStoppage.parse($0, teams: teams) }?.kind == .halftime
              && item("1042").flatMap { FootballStoppage.parse($0, teams: teams) }.map { $0.kind == .endOfPeriod && $0.period == 1 } == true,
              "the two-minute warning at 2:00, END QUARTER 1, the half (\"End of Half\")")
        // College: "Timeout Alabama, clock 11:24", "Timeout Texas A&M, clock 07:41".
        let college = JSON(data: collegeData)["games"].array[0]
        let collegeTeams = FootballFeed.Teams(topIsHome: false, topID: college["away"]["id"].string, bottomID: college["home"]["id"].string,
                                              homeAbbreviation: college["home"]["abbreviation"].string ?? "",
                                              awayAbbreviation: college["away"]["abbreviation"].string ?? "",
                                              homeName: college["home"]["name"].string ?? "", awayName: college["away"]["name"].string ?? "")
        let collegeTimeouts = college["items"].array.compactMap { FootballStoppage.parse($0, teams: collegeTeams) }.filter { $0.kind == .timeout }
        let bama = collegeTimeouts.first { $0.text.contains("Alabama") }, aggies = collegeTimeouts.first { $0.text.contains("Texas A&M") }
        check(collegeTimeouts.count == 21 && collegeTimeouts.allSatisfy { $0.side != nil } && bama?.side != aggies?.side
              && bama?.side == collegeTeams.side(named: "Alabama"),
              "college's 21 timeouts, each its team's by name (\"Texas A&M\" too)", "\(collegeTimeouts.map { "\($0.text) \(String(describing: $0.side))" })")

        // MARK: Challenges, reviews, injuries

        let games = JSON(data: stopsData)["games"].array
        func gameTeams(_ g: JSON) -> FootballFeed.Teams {
            FootballFeed.Teams(topIsHome: false, topID: g["away"]["id"].string, bottomID: g["home"]["id"].string,
                               homeAbbreviation: g["home"]["abbreviation"].string ?? "", awayAbbreviation: g["away"]["abbreviation"].string ?? "",
                               homeName: g["home"]["name"].string ?? "", awayName: g["away"]["name"].string ?? "")
        }
        func reviewed(_ clue: String) -> (FootballScene, FootballFeed.Teams)? {
            for g in games {
                if let i = g["items"].array.first(where: { ($0["text"].string ?? "").contains(clue) }),
                   let s = FootballScene.parse(i, teams: gameTeams(g)) { return (s, gameTeams(g)) }
            }
            return nil
        }
        let atl = reviewed("Atlanta challenged")?.0
        check(atl?.review == FootballScene.Review(kind: .challenge, side: .bottom, ruling: "runner was out of bounds", reversed: false),
              "Atlanta's challenge (the home team, by its city): the runner out of bounds, upheld", "\(String(describing: atl?.review))")
        let rams = reviewed("Los Angeles Rams challenged")?.0
        check(rams?.review?.side == .top && rams?.review?.reversed == true && rams?.review?.ruling == "pass completion" && rams?.kind == .incomplete,
              "the Rams' challenge at Las Vegas: the catch reversed, replayed as the incompletion it became")
        let saints = reviewed("New Orleans challenged")?.0
        check(saints?.review?.side == .bottom && saints?.review?.reversed == true && saints?.kind == .pass,
              "New Orleans's (home, at a neutral site): incomplete reversed to a catch")
        let booth = scene("2976")?.review
        check(booth?.kind == .booth && booth?.ruling == "backward pass" && booth?.reversed == true,
              "the replay official's review of a backward pass: reversed")
        let collegeReviews = college["items"].array.compactMap { FootballScene.parse($0, teams: collegeTeams)?.review }
        check(collegeReviews.count == 4 && collegeReviews.contains { $0.ruling == "Targeting" && !$0.reversed }
              && collegeReviews.contains { $0.ruling == "Interception" && $0.reversed },
              "college's automatic reviews: targeting upheld, an interception overturned", "\(collegeReviews)")
        let mitchell = items.first { ($0["text"].string ?? "").contains("Q.Mitchell was injured") }.flatMap { FootballScene.parse($0, teams: teams) }
        check(mitchell?.injuries == [FootballScene.Injury(side: .bottom, name: "Q.Mitchell")],
              "\"PHI-Q.Mitchell was injured during the play.\": PHI's man, by name")
        let ravens = reviewed("CIN-B.Cook was injured")?.0
        check(ravens?.injuries.first?.name == "B.Cook" && ravens?.injuries.first?.side == .top, "…and Cincinnati's B.Cook, hurt on a split sack (\"BLT\" is the gamebook's Baltimore)")
        check(scene("9274")?.period != nil && scene("9274")?.clock?.isEmpty == false, "every snap knows its quarter and clock")

        // MARK: Which way the field faces

        check(FieldFacing.topAttacksRight(period: 1, flipped: false) && !FieldFacing.topAttacksRight(period: 2, flipped: false)
              && FieldFacing.topAttacksRight(period: 3, flipped: false) && !FieldFacing.topAttacksRight(period: 4, flipped: false)
              && FieldFacing.topAttacksRight(period: 5, flipped: false),
              "the top team attacks right in the 1st and 3rd (and overtime), left in the 2nd and 4th: the ends change every quarter")
        check(!FieldFacing.topAttacksRight(period: 1, flipped: true) && FieldFacing.topAttacksRight(period: 2, flipped: true),
              "turned to match the TV: the other way, and still changing ends every quarter")
        check(FieldFacing.yaw(.top, period: 1, flipped: false) > 0 && FieldFacing.yaw(.bottom, period: 1, flipped: false) < 0
              && FieldFacing.yaw(.bottom, period: 2, flipped: false) > 0,
              "attacking the screen's right the field looks up and to the right; the other team, up and to the left")
        if let play = scene("9274") {
            let left = FootballScript(play, yaw: -Gridiron.yaw), right = FootballScript(play, yaw: Gridiron.yaw)
            let downfield = { (s: FootballScript) in Gridiron.view(CGPoint(x: 0, y: 100), yaw: s.yaw).x - Gridiron.view(CGPoint(x: 0, y: 0), yaw: s.yaw).x }
            check(downfield(right) > 0 && downfield(left) < 0 && left.players.count == right.players.count && left.duration > 2,
                  "a snap replays either way round: up the field to the screen's right, or its left")
        }

        // MARK: Between snaps

        let rest = FootballScript.Rest(yard: 37, gain: 47)
        let first = FootballIdle.make(play: scene("9274"), stoppage: nil, rest: rest, offense: .bottom, down: FootballScene.Down(down: 1, distance: 10),
                                      kickoff: false, flipped: false)
        let between = FootballScript(idle: first)
        let center = between.players.indices.first { between.players[$0].key == "c" }
        check(first.phase == .between && between.lines.scrimmage == Gridiron.y(37) && between.lines.gain == Gridiron.y(47)
              && between.ball(at: 0).map { abs($0.y - Gridiron.y(37)) < 0.01 } == true,
              "between snaps: the line of scrimmage at the real yard line (PHI's 37), the line to gain at the 47, the ball on the spot")
        if let center, let loop = between.loop {
            let huddled = between.players[center].position(at: 5), lined = between.players[center].position(at: loop.start)
            check(huddled.y < Gridiron.y(37) - 12 && near(lined, between.players[center].at, 0.5) && abs(lined.y - (Gridiron.y(37) - 2)) < 0.5,
                  "the huddle a few yards behind the ball, then the center over it at the line for the snap", "\(huddled) \(lined)")
            let looped = between.players.indices.allSatisfy { near(between.players[$0].position(at: loop.start), between.players[$0].position(at: loop.start + loop.period), 0.5) }
            check(looped && abs(between.idleTime(loop.start + loop.period * 3 + 2) - (loop.start + 2)) < 1e-6 && between.idleTime(1.5) == 1.5,
                  "the looks before the snap come round: the loop ends where it began, and the idle's clock goes round it")
            let moving = between.beats.filter { $0.lowerBound >= loop.start && $0.lowerBound < loop.start + loop.period }.reduce(0) { $0 + $1.upperBound - $1.lowerBound }
            let still = stride(from: loop.start, to: loop.start + loop.period, by: 0.25).filter { !between.moving(at: $0) }
            let frozen = still.allSatisfy { t in between.players.indices.allSatisfy { near(between.players[$0].position(at: t), between.players[$0].position(at: t + 0.2), 0.01) || between.moving(at: t + 0.2) } }
            check(moving < loop.period * 0.45 && moving > 3 && frozen,
                  "sparse beats: something moves for a few seconds of each loop, and between beats nothing does", "moving \(moving) of \(loop.period)")
            check(between.nextBeat(after: loop.start + loop.period - 0.01).map { $0 > loop.start + loop.period } == true,
                  "…and the next beat after the last comes round the loop")
        }
        // The set: the offense's own last one, else the situation's.
        let gun = FootballIdle.make(play: nil, stoppage: nil, rest: rest, offense: .bottom, down: FootballScene.Down(down: 3, distance: 9), kickoff: false, flipped: false)
        let goalLine = FootballIdle.make(play: nil, stoppage: nil, rest: FootballScript.Rest(yard: 99, gain: nil), offense: .bottom,
                                         down: FootballScene.Down(down: 1, distance: 1), kickoff: false, flipped: false)
        check(gun.shotgun && (gun.formation == .base || gun.formation == .empty) && goalLine.formation == .heavy && !goalLine.shotgun,
              "with no snap of its own to go on: the gun on 3rd & 9, a heavy set under center at the 1")
        if let last = scene("9274") {
            let own = FootballIdle.make(play: last, stoppage: nil, rest: rest, offense: last.offense ?? .bottom, down: nil, kickoff: false, flipped: false)
            check(own.shotgun == last.shotgun && own.formation == last.formation, "…else the set the offense just ran")
        }
        // Never canned: another snap's aftermath plays differently, the same one the same way.
        let other = FootballIdle.make(play: scene("3403"), stoppage: nil, rest: rest, offense: .bottom, down: nil, kickoff: false, flipped: false)
        let again = FootballScript(idle: first)
        check(again == between && other.seed != first.seed && FootballScript(idle: other).players.map { $0.position(at: 5) } != between.players.map { $0.position(at: 5) },
              "seeded by the entry: the same aftermath always plays the same, another differently")

        // A timeout: the team that called it to its bench.
        if let stop = item("1100").flatMap({ FootballStoppage.parse($0, teams: teams) }) {
            let idle = FootballIdle.make(play: scene("1089") ?? scene("9274"), stoppage: stop, rest: FootballScript.Rest(yard: 91, gain: nil), offense: .bottom,
                                         down: FootballScene.Down(down: 3, distance: 7), kickoff: false, flipped: false)
            let s = FootballScript(idle: idle)
            let offense = s.players.indices.filter { s.players[$0].team == .offense }, defense = s.players.indices.filter { s.players[$0].team == .defense }
            let benched = offense.allSatisfy { abs(s.players[$0].position(at: 8.5).x) > Gridiron.half - 25 }
            let onField = defense.allSatisfy { abs(s.players[$0].position(at: 8.5).x) < 40 }
            check(idle.phase == .timeout(.bottom) && benched && onField
                  && offense.allSatisfy { (s.players[$0].position(at: 8.5).x > 0) == (idle.bench > 0) },
                  "PHI's timeout: its men at its own bench (the home team's, across the field), DAL's waiting on the field")
            let status = FootballStatus.idle(idle, stoppage: stop, script: s, t: 12, names: names, situation: "3rd & 7 at DAL 9", timeoutsLeft: (3, 2))
            check(status == TheaterStatus(tag: "Timeout · Eagles · 2 left", tint: "06424d"),
                  "the tag: TIMEOUT · EAGLES · 2 LEFT, in the Eagles' color", "\(String(describing: status.tag))")
            let back = s.loop.map { FootballStatus.idle(idle, stoppage: stop, script: s, t: $0.start + 1, names: names, situation: "3rd & 7 at DAL 9", timeoutsLeft: (3, 2)) }
            check(back?.tag == "Eagles ball · 3rd & 7", "back on the field for the snap: EAGLES BALL · 3RD & 7")
        }
        // A TV timeout and the two-minute warning: both teams to their sidelines.
        if let stop = item("9229").flatMap({ FootballStoppage.parse($0, teams: teams) }), let two = item("1850").flatMap({ FootballStoppage.parse($0, teams: teams) }) {
            let idle = FootballIdle.make(play: nil, stoppage: stop, rest: rest, offense: .top, down: nil, kickoff: false, flipped: false)
            let s = FootballScript(idle: idle)
            let off = s.players.indices.filter { [.offense, .defense].contains(s.players[$0].team) }.allSatisfy { abs(s.players[$0].position(at: 8.5).x) > Gridiron.half - 25 }
            check(idle.phase == .commercial && off, "a TV timeout: the field empties to both sidelines")
            check(FootballStatus.idle(idle, stoppage: stop, script: s, t: 12, names: names, situation: nil, timeoutsLeft: (nil, nil)).tag == "Commercial break"
                  && FootballStatus.idle(idle, stoppage: two, script: s, t: 12, names: names, situation: nil, timeoutsLeft: (nil, nil)).tag == "Two-minute warning",
                  "…tagged COMMERCIAL BREAK; at 2:00, TWO-MINUTE WARNING")
        }
        // The end of a quarter: the field turns as the teams change ends.
        if let stop = item("1042").flatMap({ FootballStoppage.parse($0, teams: teams) }) {
            let idle = FootballIdle.make(play: nil, stoppage: stop, rest: FootballScript.Rest(yard: 88, gain: 98), offense: .bottom, down: nil,
                                         kickoff: false, flipped: false)
            let s = FootballScript(idle: idle)
            let turned = s.turn.map { abs(s.yaw(at: 0) - FieldFacing.yaw(.bottom, period: 1, flipped: false)) < 1e-9
                && abs(s.yaw(at: $0.end + 0.1) - FieldFacing.yaw(.bottom, period: 2, flipped: false)) < 1e-9 } ?? false
            check(turned && s.yaw(at: 0) * s.yaw(at: s.duration) < 0,
                  "END QUARTER 1: the field turns from the 1st quarter's way to the 2nd's as the teams change ends")
            check(FootballStatus.idle(idle, stoppage: stop, script: s, t: 2, names: names, situation: nil, timeoutsLeft: (nil, nil)).tag == "End of 1st",
                  "…tagged END OF 1ST")
            let flipped = FootballIdle.make(play: nil, stoppage: stop, rest: FootballScript.Rest(yard: 88, gain: 98), offense: .bottom, down: nil,
                                            kickoff: false, flipped: true)
            check(flipped.yaw == -idle.yaw && flipped.phase == .quarter(turnTo: -FieldFacing.yaw(.bottom, period: 2, flipped: false)),
                  "turned to match the TV, it still turns at the quarter, the other way")
        }
        // Halftime: off the field.
        if let stop = item("2292").flatMap({ FootballStoppage.parse($0, teams: teams) }) {
            let idle = FootballIdle.make(play: nil, stoppage: stop, rest: rest, offense: .top, down: nil, kickoff: false, flipped: false)
            let s = FootballScript(idle: idle)
            check(idle.phase == .off && s.players.allSatisfy { $0.opacity(at: s.duration) < 0.01 } && s.ball(at: s.duration) == nil
                  && FootballStatus.idle(idle, stoppage: stop, script: s, t: 3, names: names, situation: nil, timeoutsLeft: (nil, nil)).tag == "Halftime",
                  "halftime: both teams and the officials off, the field empty, HALFTIME")
        }
        // A man hurt: down, his teammates round him, two trainers out to him, then off.
        if let mitchell {
            let idle = FootballIdle.make(play: mitchell, stoppage: nil, rest: rest, offense: .top, down: nil, kickoff: false, flipped: false)
            let s = FootballScript(idle: idle)
            let hurt = s.players.indices.first { s.players[$0].holds.contains { $0.kind == .down } }
            let trainers = s.players.indices.filter { s.players[$0].team == .staff }
            let reached = hurt.map { h in trainers.allSatisfy { near(s.players[$0].position(at: 10), s.players[h].position(at: 10), 7) } } ?? false
            check(idle.phase == .injury(FootballScene.Injury(side: .bottom, name: "Q.Mitchell")) && hurt.map { s.players[$0].team == .defense } == true
                  && trainers.count == 2 && reached,
                  "Q.Mitchell hurt: a PHI man (the defense) down, two trainers out to him from the bench")
            check(hurt.map { s.players[$0].opacity(at: 40) < 0.01 } == true && trainers.allSatisfy { s.players[$0].opacity(at: 40) < 0.01 },
                  "…helped off with them before the teams line up again")
            check(FootballStatus.idle(idle, stoppage: nil, script: s, t: 10, names: names, situation: nil, timeoutsLeft: (nil, nil)) == TheaterStatus(tag: "Injury · Q.Mitchell", tint: "06424d"),
                  "…tagged INJURY · Q.MITCHELL in the Eagles' color")
        }
        // A challenge: the red flag in from the challenger's bench, the referee to the monitor, the call.
        if let (play, gt) = reviewed("Atlanta challenged") {
            let idle = FootballIdle.make(play: play, stoppage: nil, rest: FootballScript.Rest(yard: 99, gain: nil), offense: .bottom, down: nil, kickoff: false, flipped: false)
            let s = FootballScript(idle: idle)
            let red = s.flags.first { $0.red }
            check(red.map { ($0.from.x > 0) == (idle.bench > 0) && abs($0.to.x) < Gridiron.half && $0.lands < 2 } == true,
                  "Atlanta's red flag thrown in from its own bench")
            let ref = s.players.indices.first { s.players[$0].team == .official }
            check(ref.map { abs(s.players[$0].position(at: 10).x) > Gridiron.half && s.players[$0].position(at: 10).x * FieldFacing.near(yaw: s.yaw) > 0 } == true,
                  "the referee at the replay monitor on the near sideline")
            let atlNames = FootballStatus.Names(top: "49ers", bottom: "Falcons", topColor: "aa0000", bottomColor: "a71930")
            let tags = [2.0, 10, 18].map { FootballStatus.idle(idle, stoppage: nil, script: s, t: $0, names: atlNames, situation: nil, timeoutsLeft: (nil, nil)).tag ?? "" }
            check(tags == ["Challenge · Falcons", "Under review · runner was out of bounds", "Ruling stands"],
                  "the tags: CHALLENGE · FALCONS, UNDER REVIEW, RULING STANDS", "\(tags)")
            _ = gt
        }
        if let rams = reviewed("Los Angeles Rams challenged")?.0 {
            let idle = FootballIdle.make(play: rams, stoppage: nil, rest: rest, offense: .top, down: nil, kickoff: false, flipped: false)
            check(FootballStatus.idle(idle, stoppage: nil, script: FootballScript(idle: idle), t: 18, names: names, situation: nil, timeoutsLeft: (nil, nil)).tag == "Reversed",
                  "the Rams' challenge won: REVERSED")
        }
        // After a score: the kickoff, from the scorer's 35.
        if let td = scene("1152") {
            let idle = FootballIdle.make(play: td, stoppage: nil, rest: FootballScript.Rest(yard: 65, gain: nil), offense: .top, down: nil, kickoff: true, flipped: false)
            let s = FootballScript(idle: idle)
            check(idle.phase == .kickoff && idle.offense == td.scorer && idle.yard == 35 && s.lines.scrimmage == nil
                  && s.players.contains { $0.role == .kicker } && s.ball(at: 0).map { abs($0.y - Gridiron.y(35)) < 0.01 } == true,
                  "after Pierce's touchdown: PHI lined up to kick off from its 35, no lines on the field")
        }

        // MARK: The tag during a snap

        if var dpi = scene("3335") {
            dpi.hash = .middle
            let s = FootballScript(dpi)
            let flag = s.flags.first
            check(flag.map { FootballStatus.replay(dpi, script: s, t: $0.lands - 0.1, names: names).tag == "Cowboys ball · 3rd & 10" } == true
                  || flag.map { FootballStatus.replay(dpi, script: s, t: $0.lands - 0.1, names: names).tag?.hasPrefix("Cowboys ball · ") } == true,
                  "before the flag: the ball and the down")
            let tag = flag.map { FootballStatus.replay(dpi, script: s, t: $0.lands + 0.1, names: names) }
            check(tag == TheaterStatus(tag: "Flag · Pass Interference, Defense · 17 yds", tint: FootballStatus.flagYellow),
                  "the flag down: FLAG · PASS INTERFERENCE, DEFENSE · 17 YDS, in the flag's yellow", "\(String(describing: tag?.tag))")
        }
        if let hold = scene("3169") {
            check(FootballStatus.flagTag(hold) == "Flag · Holding, Offense · 7 yds", "…a hold: FLAG · HOLDING, OFFENSE · 7 YDS")
        }

        // MARK: Every snap replays

        let snaps = ["9274", "3403", "1477"].compactMap(scene)
        var state = FootballFeed.theater([snaps[0]], stoppage: nil, after: FootballTheaterState(), primed: true, now: .now)
        state = FootballFeed.theater([snaps[0], snaps[1], snaps[2]], stoppage: nil, after: state, primed: true, now: .now)
        check(state.play?.id == snaps[2].id && state.queue.map(\.id) == snaps.map(\.id),
              "two snaps in one look: both queue behind the first, in order")
        check(FootballTheater.shown(state, replaying: nil, rested: nil, played: [snaps[0].id]) == snaps[1]
              && FootballTheater.shown(state, replaying: snaps[1].id, rested: nil, played: [snaps[0].id, snaps[1].id]) == snaps[1]
              && FootballTheater.shown(state, replaying: snaps[2].id, rested: snaps[2].id, played: Set(snaps.map(\.id))) == nil,
              "…each replays in turn, then the field between snaps")
        let history = FootballFeed.theater(snaps, stoppage: nil, after: FootballTheaterState(), primed: false, now: .distantFuture)
        check(!history.news && history.queue.map(\.id) == [snaps[2].id], "history (the page just opened) queues nothing")
        if let stop = item("1100").flatMap({ FootballStoppage.parse($0, teams: teams) }) {
            let stopped = FootballFeed.theater([], stoppage: stop, after: state, primed: true, now: .now)
            check(stopped.stoppage == stop && stopped.play == state.play, "a timeout after the snap: on the theater's state with the snap")
        }
        check(FootballTheater.down("3rd & 7 at PHI 35") == FootballScene.Down(down: 3, distance: 7) && FootballTheater.down("1st & Goal at DAL 4")?.down == 1
              && FootballTheater.down("Kickoff") == nil, "the situation's down: 3rd & 7, 1st & Goal; a kickoff has none")
    }
}
