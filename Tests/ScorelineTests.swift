import Foundation

// Offline regression suite. Replays recorded API responses (Tests/Fixtures)
// through the app's real fetch + parse code and checks what we verified
// against official results. Run with ./test.sh (--record refreshes fixtures).

@main
@MainActor
struct ScorelineTests {
    nonisolated(unsafe) static var failures = 0
    nonisolated(unsafe) static var passes = 0

    static func check(_ condition: Bool, _ name: String, _ detail: @autoclosure @MainActor () -> String = "") {
        if condition {
            passes += 1
            print("  ✓ \(name)")
        } else {
            failures += 1
            print("  ✗ \(name) \(detail())")
        }
    }

    static func main() async {
        HTTP.stubProtocol = FixtureProtocol.self
        print("Scoreline tests\(FixtureProtocol.recording ? " (recording fixtures)" : "")")

        await counterStrike()
        await soccer()
        await baseball()
        await climbing()
        formatting()
        await matching()
        responsive()
        lists()
        basketball()
        tiles()
        tilesMotion()
        charts()
        nbaReplay()
        celebrations()
        celebrateCharts()
        celebrateNBA()
        nbaPolish()
        dock()
        dockPages()
        peek()
        teamColors()
        await pageGeometry()
        scoreChanges()
        match()
        celebrateMatch()
        panel()
        await platform()
        await rosters()
        await schedules()
        await results()
        resultsPages()
        await seasonResults()
        chartHygiene()
        outline()
        playTheater()
        playBroadcast()
        footballTheater()
        footballFidelity()
        footballIdle()
        soccerTheater()
        soccerFidelity()
        soccerIdle()
        basketballTheater()
        basketballBeats()
        theaterRig()
        statcast()
        playStatcast()
        playCredits()
        playLive()
        playBeats()
        headerSync()
        await scoringSlides()
        odds()

        print("\n\(passes) passed, \(failures) failed")
        exit(failures == 0 ? 0 : 1)
    }

    static func comp(_ id: String, _ name: String, _ score: String? = nil, color: String? = nil) -> Competitor {
        Competitor(id: id, name: name, abbreviation: name, score: score, logo: nil, isWinner: false, color: color)
    }

    // MARK: CS2 — G2 0–2 NAVI, PGL Masters Bucharest (Nuke 11–13, Dust II 19–22)

    static func counterStrike() async {
        print("\nCS2")
        let event = Event(id: "cs", content: .match(top: comp("cs-793", "G2", "0"), bottom: comp("cs-787", "Natus Vincere", "2")),
                          state: .final, start: .now, detail: nil, caption: nil, link: nil,
                          ref: .counterStrike(slug: "g2-vs-natus-vincere-24-10-2026", tournament: "PGL Masters Bucharest 2026"))
        guard let d = try? await DetailProvider.detail(for: event) else { return check(false, "detail loads") }
        check(d.topRoster.players.map(\.nickname) == ["huNter-", "Nertz", "HeavyGod", "r1nkle", "MATYS"], "G2 starting five",
              "\(d.topRoster.players.map(\.nickname))")
        check(d.topRoster.coach?.nickname == "sAw", "G2 coach is sAw")
        check(d.bottomRoster.players.count == 5 && d.bottomRoster.coach?.nickname == "B1ad3", "NAVI five + coach B1ad3")
        let map1 = d.rounds[1] ?? [], map2 = d.rounds[2] ?? []
        check(map1.count == 24 && map1.filter { $0.winner == .top }.count == 11, "Map 1 rounds reproduce 11–13")
        check(map2.count == 41 && map2.filter { $0.winner == .bottom }.count == 22, "Map 2 rounds reproduce 19–22 (OT)")
        check(!map1.contains { $0.winner == nil } && !map2.contains { $0.winner == nil }, "every round attributed")
        check(map2.contains { $0.reason == .defused } && map2.contains { $0.reason == .bombed }, "end reasons parsed")
        check(RoundHistoryView.blocks(map2).map(\.count) == [12, 12, 6, 6, 5], "MR12 halves then OT blocks of 6",
              "\(RoundHistoryView.blocks(map2).map(\.count))")
        check(d.maps.map(\.name) == ["Nuke", "Dust II"], "map names")
    }

    // MARK: Soccer — Aston Villa 2–1 Man City; Premier League table

    static func soccer() async {
        print("\nSoccer")
        let feed = SoccerFeed()
        await feed.update(league: "eng.1", eventID: "401879256", homeTeamID: "362")
        check(feed.shots.count == 23, "23 shots (no tackles, assists or saves)", "got \(feed.shots.count)")
        check(feed.shots.filter { $0.kind == .goal }.count == 3, "3 goals")
        check(feed.trail.count == 10, "trail holds the last 10 actions")
        check(feed.trail.allSatisfy { (0...100).contains($0.x) && (0...100).contains($0.y) }, "positions within the pitch")

        guard let rows = try? await Standings.fetch(league: League.with(id: "eng.1")!), rows.count == 20 else {
            return check(false, "table loads")
        }
        check(rows.map(\.rank) == Array(1...20), "table sorted by rank")
        let bottom = rows[19], third = rows[2]
        let live = Event(id: "l", content: .match(top: comp(bottom.id, bottom.name, "3"), bottom: comp(third.id, third.name, "0")),
                         state: .live, start: .now, detail: "60'", caption: nil, link: nil)
        let projected = Standings.live(rows, liveEvents: [live])
        let climber = projected.first { $0.id == bottom.id }
        check((climber?.movement ?? 0) > 0 && climber?.points == bottom.points + 3, "live win lifts the bottom team")
        check(Standings.live(rows, liveEvents: []).allSatisfy { $0.movement == 0 }, "no live games: official order")

        let scoreboard = try? await Providers.events(for: League.with(id: "eng.1")!)
        let cheTot = scoreboard?.first { $0.id == "espn-401878767" }
        check(cheTot?.competitors.first?.name == "Chelsea", "soccer lists the home side first")
    }

    // MARK: MLB — World Series game, Rays 2–3 Brewers

    static func baseball() async {
        print("\nMLB")
        let event = Event(id: "m", content: .match(top: comp("espn-baseball-30", "Rays", "2"), bottom: comp("espn-baseball-8", "Brewers", "3")),
                          state: .final, start: .now, detail: nil, caption: nil, link: nil,
                          ref: .espn(path: "baseball/mlb", id: "401908043", sport: .baseball))
        guard let d = try? await DetailProvider.detail(for: event) else { return check(false, "detail loads") }
        check(d.atBat.map(\.type) == ["SI", "CH", "CH", "CH", "CU", "CU"], "last at-bat pitch sequence", "\(d.atBat.map(\.type))")
        check(d.atBat.last?.result == .strike, "at-bat ends on strike three")
        check(d.atBat.compactMap(\.strike).count == d.atBat.filter { $0.result == .strike }.count,
              "every strike in the at-bat says how it came (called, swinging, foul)", "\(d.atBat.map(\.strike))")
        check(d.battedBalls.filter { $0.outcome == .homeRun }.count == 2, "two home runs in play")
        let ballIDs = Set(d.battedBalls.map(\.id))
        check(d.moments.filter { $0.text.contains("homered") }.allSatisfy { ballIDs.contains($0.id) },
              "home run scoring plays link to their batted balls")
        check(d.moments.allSatisfy { $0.period != nil }, "scoring plays know their inning")
        check(d.battedBalls.allSatisfy { hypot($0.x - 125, $0.y - 205) < 200 }, "batted balls inside the field model")
        check(d.linescore?.headers.suffix(3) == ["R", "H", "E"], "linescore ends with R H E")
        check(!d.broadcasters.isEmpty, "broadcasters listed")
    }

    // MARK: Climbing — Santiago 2026 lead qualification; Bern 2026 boulder final

    static func climbing() async {
        print("\nClimbing")
        func detail(_ url: String) async -> GameDetail? {
            let e = Event(id: url, content: .field(title: "", summary: ""), state: .final, start: .now, detail: nil, caption: nil,
                          link: nil, ref: .climbing(eventID: 0, category: "", resultURL: url, round: nil, eventName: "", nextURL: nil))
            return try? await DetailProvider.detail(for: e)
        }
        let lead = await detail("/api/v1/category_rounds/10451/results")
        check(lead?.wall.count == 2, "lead qualification has two routes")
        let route1 = lead?.wall.first?.climbers ?? []
        check(route1.first { !$0.top }.map { $0.holds } == 46, "route 1 high point is hold 46",
              "\(route1.first { !$0.top }?.height ?? -1)")
        check(route1.filter(\.top).allSatisfy { $0.height > 46 && $0.height.isFinite }, "tops sit above every high point")
        check(route1.prefix { $0.top }.count == route1.filter(\.top).count, "topped climbers listed first")
        check(lead?.wall.allSatisfy { r in zip(r.climbers, r.climbers.dropFirst()).allSatisfy { $0.height >= $1.height } } == true,
              "climbers ordered by height")
        let boulder = await detail("/api/v1/category_rounds/10667/results")
        check(boulder?.boulderProblems == ["1", "2", "3", "4"], "boulder final has four problems")
        check(boulder?.boulders.first?.problems.allSatisfy { $0.reach == .top } == true, "winner topped every problem")
        check(boulder?.boulders.first?.flag == "🇯🇵", "flags from IOC codes")
        let speed = await detail("/api/v1/category_rounds/10448/results")
        check(speed?.wall.isEmpty == true && speed?.ranking.isEmpty == false, "speed times never draw on the wall")
    }

    // MARK: Pure logic

    static func formatting() {
        print("\nFormatting")
        let cal = Calendar.current
        let now = cal.date(bySettingHour: 21, minute: 0, second: 0, of: Date())!
        func at(_ days: Int, _ hour: Int) -> Date {
            cal.date(bySettingHour: hour, minute: 0, second: 0, of: cal.date(byAdding: .day, value: days, to: now)!)!
        }
        check(When.dayAndTime(at(0, 23), now: now).hasPrefix("Today"), "later today reads Today")
        check(When.dayAndTime(at(1, 7), now: now).hasPrefix("Tomorrow"), "tomorrow reads Tomorrow")
        check(When.dayAndTime(at(9, 13), now: now).contains(","), "beyond a week shows a date")
        check(Countdown.text(to: now + 2 * 3600 + 9 * 60 + 30, from: now) == "in 2h 9m", "countdown hours/minutes")
        check(Countdown.text(to: now + 30, from: now) == "Starting", "under a minute reads Starting")
        check(Countdown.clock(to: now + 3725, from: now) == "1:02:05", "ticking clock")
        check(Flag.emoji(ioc: "SLO") == "🇸🇮" && Flag.emoji(ioc: "GER") == "🇩🇪" && Flag.emoji(iso2: "XK") == "🇽🇰", "flags")
        check(Broadcaster(name: "USA Net", type: "TV").name == "USA Network", "broadcaster names spelled out")
        check(Broadcaster(name: "Paramount+", type: "STREAMING").kind == .streaming, "streaming broadcasters")
        let e = Event(id: "x", content: .match(top: comp("a", "ARS", "2"), bottom: comp("b", "EVE", "1")), state: .live,
                      start: now, detail: "67'", caption: nil, link: nil)
        check(e.scoreLine(abbreviated: true) == "ARS 2–1 EVE", "score line")
    }

    static func matching() async {
        print("\nFootball field")
        // Live NFL situation, Steelers (away, top) at Saints (home): NO ball, 2nd & goal at PIT 1.
        let situation = JSON(["yardLine": 99, "possession": "18", "distance": 1, "isRedZone": true] as [String: Any])
        let away = JSON(["homeAway": "away", "team": ["id": "23"]] as [String: Any])
        let field = ESPNDetail.football(situation, topComp: away) { $0 == "18" ? .bottom : $0 == "23" ? .top : nil }
        check(field?.ballX == 1, "ball sits 1 yard from the top team's goal", "\(field?.ballX ?? -1)")
        check(field?.lineToGainX == 0, "goal line is the line to gain", "\(field?.lineToGainX ?? -1)")
        let own39 = ESPNDetail.football(JSON(["yardLine": 61, "possession": "23", "distance": 10] as [String: Any]), topComp: away) {
            $0 == "18" ? .bottom : $0 == "23" ? .top : nil
        }
        check(own39?.ballX == 39 && own39?.lineToGainX == 49, "away ball at own 39 moves right", "\(own39?.ballX ?? -1)")

        print("\nFootball live lane")
        // Colts (away, top) at Vikings (home): Taylor's 38-yard TD from MIN 38, as ESPN's core feed sends it.
        let teamsIM = FootballFeed.Teams(topIsHome: false, topID: "11", bottomID: "16", homeAbbreviation: "MIN", awayAbbreviation: "IND")
        let base = "http://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
        let td = JSON(["id": "401873014290", "type": ["text": "Rushing Touchdown"], "scoringPlay": true, "statYardage": 38,
                       "shortText": "Jonathan Taylor 38 Yd Rush (Spencer Shrader Kick)", "clock": ["displayValue": "9:13"],
                       "start": ["yardLine": 38, "shortDownDistanceText": "1st & 10", "team": ["$ref": "\(base)/seasons/2026/teams/11?lang=en"]],
                       "end": ["yardLine": 0, "team": ["$ref": "\(base)/seasons/2026/teams/11?lang=en"]],
                       "drive": ["$ref": "\(base)/events/401873014/competitions/401873014/drives/40187301403?lang=en"]] as [String: Any])
        let tdPlay = FootballFeed.play(td, teams: teamsIM)
        check(tdPlay?.startX == 62 && tdPlay?.endX == 100, "away drive runs left to right", "\(String(describing: tdPlay))")
        check(tdPlay?.kind == .score && tdPlay?.side == .top && tdPlay?.driveID == "40187301403", "scoring play, team and drive")
        let timeout = JSON(["id": "1", "type": ["text": "Official Timeout"], "start": ["yardLine": 15], "end": ["yardLine": 15]] as [String: Any])
        check(FootballFeed.play(timeout, teams: teamsIM) == nil, "timeouts aren't snaps")
        let sit = FootballFeed.situation(JSON(["yardLine": 38, "down": 2, "distance": 7, "isRedZone": false,
                                               "homeTimeouts": 3, "awayTimeouts": 2] as [String: Any]),
                                         possessionTeam: "11", teams: teamsIM, lastPlay: nil)
        check(sit?.downDistance == "2nd & 7 at MIN 38" && sit?.ballX == 62 && sit?.lineToGainX == 69,
              "down, distance and spot", "\(String(describing: sit?.downDistance)) \(String(describing: sit?.lineToGainX))")
        check(sit?.topTimeouts == 2 && sit?.bottomTimeouts == 3, "timeouts by side")
        let goal = FootballFeed.situation(JSON(["yardLine": 4, "down": 1, "distance": 4] as [String: Any]),
                                          possessionTeam: "11", teams: teamsIM, lastPlay: nil)
        check(goal?.downDistance == "1st & Goal at MIN 4", "goal to go")
        let kickoff = FootballFeed.situation(JSON(["yardLine": 35, "down": 1, "distance": 10] as [String: Any]),
                                             possessionTeam: "11", teams: teamsIM, lastPlay: nil, afterScore: true)
        check(kickoff?.downDistance == "Kickoff" && kickoff?.lineToGainX == nil, "a kickoff isn't a first down")
        check(FootballFeed.clock(JSON(["displayClock": "9:13", "period": 1, "type": ["state": "in"]] as [String: Any])) == "9:13 - 1st",
              "game clock")

        print("\nBaseball live lane")
        let names = ["33481": "Y. Diaz", "41325": "D. Williams"]
        let core = JSON(["balls": 2, "strikes": 1, "outs": 1, "onThird": ["playerId": 5005912],
                         "batter": ["playerId": 33481], "pitcher": ["playerId": 41325]] as [String: Any])
        let diamond = BaseballFeed.situation(core, names: names, lastPlay: "Pratt singled to right.")
        check(diamond?.balls == 2 && diamond?.strikes == 1 && diamond?.outs == 1, "count and outs")
        check(diamond?.onThird == true && diamond?.onFirst == false, "runners from occupied bases")
        check(diamond?.batter == "Y. Diaz" && diamond?.pitcher == "D. Williams", "batter and pitcher named from the box score")
        check(diamond?.batterID == "33481" && diamond?.pitcherID == "41325", "batter and pitcher carry their IDs (their names open their pages)")
        // ESPN's pitch entry names the pitching team; the at-bat's result names the batting one.
        let spray = ESPNDetail.battedBalls([
            JSON(["id": "p5", "atBatId": "ab1", "summaryType": "P", "type": ["type": "single", "text": "Single"],
                  "team": ["id": "30"], "hitCoordinate": ["x": 100, "y": 120], "period": ["number": 1]] as [String: Any]),
            JSON(["id": "r1", "atBatId": "ab1", "type": ["type": "play-result"], "team": ["id": "8"],
                  "text": "Chourio singled to center."] as [String: Any]),
        ]) { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        check(spray.map(\.side) == [.top] && spray.map(\.id) == ["r1"], "a ball in play is the batting team's, not the pitcher's",
              "\(spray.map(\.side))")
        let runners = GameDetail.Baseball.runners(JSON(["onFirst": ["playerId": 33481], "onThird": ["playerId": 5005912]] as [String: Any]),
                                                  names: names)
        check(runners == ["Y. Diaz", nil, nil], "runners named from the box score; unknown ones stay unnamed", "\(runners)")

        print("\nGame clocks")
        let t0 = Date(timeIntervalSince1970: 1_000_000)
        let first = GameClock(seconds: 200, sampledAt: t0, period: 2, direction: .down, display: "3:20 - 2nd", running: false)
        let moved = GameClock(seconds: 190, sampledAt: t0.addingTimeInterval(10), period: 2, direction: .down,
                              display: "3:10 - 2nd", running: false).reading(after: first)
        check(moved.running, "a clock that moved is running")
        check(moved.text(at: t0.addingTimeInterval(13)) == "3:07 - 2nd", "it ticks between readings",
              moved.text(at: t0.addingTimeInterval(13)))
        check(moved.text(at: t0.addingTimeInterval(10 + 600)) == "1:40 - 2nd", "a stale reading holds after 90 seconds",
              moved.text(at: t0.addingTimeInterval(610)))
        let stopped = GameClock(seconds: 190, sampledAt: t0.addingTimeInterval(20), period: 2, direction: .down,
                                display: "3:10 - 2nd", running: false).reading(after: moved)
        check(!stopped.running && stopped.text(at: t0.addingTimeInterval(40)) == "3:10 - 2nd", "a clock that didn't move holds")
        let soccer = GameClock(seconds: 2220, sampledAt: t0, period: 1, direction: .up, display: "37'", running: true)
        check(soccer.text(at: t0.addingTimeInterval(65)) == "38'", "soccer minute counts up", soccer.text(at: t0.addingTimeInterval(65)))
        let stoppage = GameClock(seconds: 2820, sampledAt: t0, period: 1, direction: .up, display: "45'+2'", running: true)
        check(stoppage.text(at: t0.addingTimeInterval(61)) == "45'+3'", "stoppage time counts on", stoppage.text(at: t0.addingTimeInterval(61)))

        print("\nBrackets")
        func team(_ id: String) -> BracketTeam { BracketTeam(id: id, name: id, abbreviation: id, logo: nil) }
        func game(_ round: String, _ a: String, _ b: String, _ wa: Int, _ wb: Int, done: Bool) -> MLBPostseason.Game {
            MLBPostseason.Game(round: round, teams: [team(a), team(b)], wins: [a: wa, b: wb], summary: nil,
                               completed: done, live: false, date: "20261001")
        }
        let post = MLBPostseason.bracket(from: [
            game("ALWC", "HOU", "CHW", 0, 2, done: true), game("ALWC", "NYY", "BOS", 2, 0, done: true),
            game("ALDS", "CLE", "CHW", 3, 2, done: true), game("ALDS", "NYY", "TB", 0, 3, done: true),
            game("ALCS", "TB", "CLE", 4, 2, done: true),
            game("NLWC", "ATL", "PHI", 2, 1, done: true),
            game("World Series", "TB", "MIL", 0, 2, done: false),
        ])
        let ws = post.flatMap { $0.matches[$0.finalID] }
        check(ws?.top?.id == "TB" && ws?.bottomScore == 2 && ws?.winner == nil, "World Series is the final, in progress")
        let alcs = ws?.feeders.first.flatMap { post?.matches[$0] }
        check(alcs?.winner == .top && alcs?.feeders.count == 2, "ALCS fed by both Division Series")
        let clePath = alcs?.feeders.compactMap { post?.matches[$0] }.first { $0.has(team: "CLE") }
        check(clePath?.feeders.first.flatMap { post?.matches[$0] }?.has(team: "CHW") == true,
              "a Division Series is fed by the Wild Card its newcomer won")
        check(post?.matches["NLCS"]?.top == nil, "rounds not yet set are placeholders")
        check(MLBPostseason.shortSummary("MIL leads series 2-1") == "MIL leads 2–1", "series wording")

        // CS2 playoffs: positions number the tree depth-first (final 1, semis 2 and 5).
        func m(_ id: Int, _ position: Int) -> [String: Any] { ["id": id, "position": position, "status": "upcoming"] }
        let stage = JSON(["rounds": [
            ["name": "Quarterfinal", "round_index": 1, "matches": [m(13, 3), m(14, 4), m(16, 6), m(17, 7)]],
            ["name": "Semifinal", "round_index": 2, "matches": [m(12, 2), m(15, 5)]],
            ["name": "Grand final", "round_index": 3, "matches": [m(11, 1)]],
        ]] as [String: Any])
        let tree = CSTournament.tree(stage, teams: [:], live: [])
        check(tree?.finalID == "11" && tree?.matches["11"]?.feeders == ["12", "15"], "final fed by both semis")
        check(tree?.matches["12"]?.feeders == ["13", "14"] && tree?.matches["15"]?.feeders == ["16", "17"],
              "each semi fed by its quarters")
        let layout = tree.map(BracketLayout.init)
        check(layout?.slots["11"]?.column == 2 && layout?.slots["13"]?.column == 0, "final on the right, quarters on the left")

        print("\nCollege football")
        check(ESPNTeamID.make(path: "football/college-football", sport: .football, team: "26") == "espn-ncaaf-26"
              && ESPNTeamID.make(path: "football/nfl", sport: .football, team: "26") == "espn-football-26",
              "college and NFL teams never share an ID")
        func entry(_ id: String, _ name: String, overall: String, conf: String) -> [String: Any] {
            ["team": ["id": id, "location": name, "abbreviation": name],
             "stats": [["type": "total", "displayValue": overall], ["type": "vsconf", "displayValue": conf]]]
        }
        let table = Standings.college(JSON(["children": [
            ["shortName": "Big Ten", "standings": ["entries": [entry("26", "UCLA", overall: "7-0", conf: "4-0"),
                                                             entry("84", "Indiana", overall: "7-1", conf: "4-1")]]],
            ["shortName": "Sun Belt", "children": [
                ["name": "Sun Belt - East", "standings": ["entries": [entry("2026", "App State", overall: "5-2", conf: "3-1")]]],
            ]],
        ]] as [String: Any]), path: "football/college-football")
        check(table.map(\.group) == ["Big Ten", "Big Ten", "Sun Belt · East"], "conferences and divisions become groups",
              "\(table.map(\.group))")
        check(table.first?.id == "espn-ncaaf-26" && table.first?.conference == "4-0" && table[1].rank == 2,
              "conference record and place")
        let polls = Rankings.parse(JSON(["rankings": [["name": "AP Top 25", "shortHeadline": "AP Poll: Week 9", "ranks": [
            ["current": 2, "previous": 3, "team": ["id": "194", "location": "Ohio State"], "points": 1681.0, "firstPlaceVotes": 10],
            ["current": 25, "previous": 0, "team": ["id": "9", "location": "Arizona State"]],
        ]]]] as [String: Any]), path: "football/college-football")
        check(polls.first?.entries.first?.movement == 1 && polls.first?.entries.first?.points == 1681, "poll movement and points")
        check(polls.first?.entries.last?.previous == nil, "unranked last week is new")

        print("\nLive moments")
        func play(_ id: String, _ text: String = "", scoring: String? = nil) -> DrivePlay {
            DrivePlay(id: id + text, side: .top, startX: 40, endX: 50, kind: .other, downDistance: nil, yards: 10,
                      clock: "", text: text, driveID: "1", typeID: id, scoring: scoring)
        }
        check(play("67", scoring: "touchdown").moment?.kind == .touchdown, "touchdown from the scoring fields")
        check(play("24", scoring: "touchdown").moment?.kind == .touchdown, "a TD typed as a reception is still a touchdown")
        check(play("3").moment?.kind == .passIncomplete && play("3", "spiked the ball").moment == nil, "incomplete, but not a spike")
        check(play("24").moment?.kind == .passComplete && play("5").moment?.kind == .rush, "complete pass and rush")
        check(play("5", "Kneel down by Alabama").moment == nil, "kneels aren't moments")
        check(play("7").moment?.kind == .sack && play("59").moment?.kind == .fieldGoal && play("60").moment?.kind == .fieldGoalMissed,
              "sack and field goals")
        check(play("63").moment?.kind == .turnover && play("29").moment?.kind == .turnover, "interception (college) and fumble lost")
        check(play("5", "J. Smith fumbles, TOUCHDOWN").moment?.kind == .rush, "text claiming a touchdown doesn't make one")
        check(play("53").moment == nil && play("21").moment == nil, "kickoffs and timeouts aren't moments")

        func pitchMoment(_ type: String, scoring: Bool = false) -> LiveMoment? {
            SoccerFeed.action(JSON(["id": "s-" + type, "type": ["type": type], "scoringPlay": scoring, "fieldPositionX": 88.0,
                                    "fieldPositionY": 40.0, "fieldPosition2X": 100.0, "fieldPosition2Y": 50.0,
                                    "team": ["$ref": "http://x/teams/359?lang=en"], "text": "A shot"]),
                              index: 0, homeTeamID: "359")?.moment
        }
        check(pitchMoment("goal---header", scoring: true)?.kind == .goal && pitchMoment("goal---header", scoring: true)?.tier == .score, "header goal")
        check(pitchMoment("shot-on-target")?.kind == .shotSaved && pitchMoment("shot-blocked")?.kind == .shotBlocked
              && pitchMoment("shot-off-target")?.kind == .shotWide, "shots: saved, blocked, wide")
        check(pitchMoment("goal-kick") == nil && pitchMoment("deleted-after-review") == nil, "goal kicks and VAR-disallowed goals aren't goals")

        func atBat(_ result: String, scoring: Bool = false, runs: Int = 0, doublePlay: Bool = false) -> LiveMoment? {
            BaseballFeed.moment(JSON(["id": "r-" + result, "type": ["type": "play-result"], "alternativeType": ["type": result],
                                      "scoringPlay": scoring, "scoreValue": runs, "doublePlay": doublePlay,
                                      "team": ["id": "10"], "text": "Result"])) { $0 == "10" ? .top : .bottom }
        }
        check(atBat("strike-swinging")?.kind == .strikeout && atBat("strike-looking---overturned")?.kind == .strikeout, "strikeouts")
        check(atBat("ball")?.kind == .walk && atBat("ball---confirmed")?.kind == .walk, "walks (there's no walk type)")
        check(atBat("home-run", scoring: true, runs: 2)?.kind == .homeRun && atBat("home-run", scoring: true)?.side == .top,
              "home run, for the batting side")
        check(atBat("single", scoring: true, runs: 2)?.lead == "2 runs score", "an RBI single reads as the runs")
        check(atBat("double")?.kind == .hit && atBat("ground-out", doublePlay: true)?.lead == "Double play"
              && atBat("fly-out")?.tier == .routine, "hits, double plays, outs")
        check(BaseballFeed.moment(JSON(["id": "p", "type": ["type": "strike-swinging"]])) { _ in .top } == nil,
              "pitches aren't at-bat results")

        func moment(_ id: String, _ tier: LiveMoment.Tier) -> LiveMoment {
            LiveMoment(id: id, chart: .field, tier: tier, kind: .rush, lead: id, detail: "")
        }
        let center = MomentCenter()
        center.remember(["old"])
        center.offer([moment("old", .score)])
        check(center.current == nil, "what was already on screen never replays")
        center.offer([moment("a", .routine), moment("b", .swing), moment("c", .routine)])
        check(center.current?.id == "b", "the most important of a batch wins")
        center.offer([moment("d", .routine)])
        check(center.current?.id == "b", "a lesser moment doesn't interrupt")
        center.offer([moment("e", .score)])
        check(center.current?.id == "e", "a score replaces a swing")
        center.offer([moment("f", .swing), moment("g", .swing), moment("h", .swing), moment("i", .swing)])
        check(center.current?.id == "e", "a catch-up burst without a score plays nothing")
        center.offer([moment("e", .score)])
        check(center.current?.id == "e", "each play fires once")
        center.clear()
        let upgrade = MomentCenter()
        upgrade.offer([moment("td", .routine)])
        upgrade.offer([LiveMoment(id: "td", chart: .field, tier: .score, kind: .touchdown, lead: "Touchdown", detail: "")])
        check(upgrade.current?.kind == .touchdown, "a play edited into a score is news again")
        upgrade.retract(["td"])
        check(upgrade.current == nil, "a score taken back on review leaves the slot")

        let late = SoccerFeed.cardMoment(JSON(["id": "c1", "type": ["type": "yellow-card"], "shortText": "Ethan Ampadu Yellow Card",
                                               "team": ["$ref": "http://x/teams/357?lang=en"]]), homeTeamID: "359")
        check(late?.kind == .card(red: false) && late?.side == .bottom, "a card whose foul isn't in is still a moment")
        let pending = ESPNDetail.battedBalls([JSON(["id": "p9", "atBatId": "ab1", "type": ["type": "single"],
                                                    "hitCoordinate": ["x": 90.0, "y": 120.0]])]) { _ in .top }
        check(pending.isEmpty, "a ball in play waits for its at-bat's result (one ID from the start)")

        print("\nHover")
        let pass = HoverMark(from: CGPoint(x: 10, y: 10), to: CGPoint(x: 110, y: 10))
        check(nearest([HoverMark(CGPoint(x: 200, y: 200)), pass], to: CGPoint(x: 60, y: 15)) == 1,
              "a pass answers along its line, not just where it started")
        check(nearest([pass], to: CGPoint(x: 60, y: 30)) == nil, "lines have a tighter reach than dots")
        check(nearest([HoverMark(CGPoint(x: 50, y: 50))], to: CGPoint(x: 60, y: 58)) == 0, "dots keep their 14pt reach")
        let linked = LinkedFocus()
        linked.hover(Focus(play: "a"), true)
        try? await Task.sleep(for: .milliseconds(50))
        linked.hover(Focus(play: "b"), true)
        try? await Task.sleep(for: .milliseconds(60))
        check(linked.focus?.play == "b", "moving between marks retargets the short wait instead of restarting it")
        linked.hover(Focus(play: "c"), true)
        check(linked.focus?.play == "c", "once showing, focus follows the pointer at once")
        linked.clear()

        print("\nStat bars")
        check(ESPNDetail.magnitude("-2") == 0, "negative yards draw as no bar")
        check(ESPNDetail.magnitude("5-45") == 5, "penalties compare by count")
        check(ESPNDetail.magnitude("31:22") == 1882, "possession time in seconds")

        print("\nKey events")
        func moment(_ kind: GameDetail.Moment.Kind, _ text: String) -> GameDetail.Moment {
            GameDetail.Moment(id: text, kind: kind, clock: "10'", text: text, side: .top)
        }
        check(MomentList.headline(moment(.goal, "Germán Valera Goal")) == "Germán Valera", "goal shows the scorer")
        check(MomentList.headline(moment(.goal, "Fer Niño Penalty - Scored")) == "Fer Niño (pen)", "penalty marked")
        check(MomentList.headline(moment(.goal, "Aitor Paredes Goal - Header")) == "Aitor Paredes (header)", "goal detail kept short")
        check(MomentList.headline(moment(.yellow, "Álvaro García Yellow Card")) == "Álvaro García", "card shows the player")
        check(MomentList.headline(moment(.red, "Lewis Hall Second Yellow Card")) == "Lewis Hall (2nd yellow)", "second yellow marked")
        check(MomentList.headline(moment(.score, "Cairo Santos 58 Yd Field Goal")) == "Cairo Santos 58 Yd Field Goal",
              "football plays keep their text")

        print("\nCards on the pitch")
        let foul = PitchAction(id: 1, kind: .other, side: .top, x: 35.8, y: 65.8, endX: nil, endY: nil,
                               minute: "90'+3'", text: "Jaydee Canvot Foul", playID: "1")
        let cardItem = JSON(["id": "54290780", "type": ["type": "yellow-card"], "shortText": "Jaydee Canvot Yellow Card",
                             "clock": ["displayValue": "90'+3'"]] as [String: Any])
        let card = SoccerFeed.card(cardItem, index: 2, recent: [foul])
        check(card?.x == 35.8 && card?.kind == .yellow && card?.playID == "54290780", "card placed at the player's foul")
        let other = PitchAction(id: 1, kind: .other, side: .top, x: 10, y: 10, endX: nil, endY: nil,
                                minute: "90'", text: "Someone Else Foul", playID: "1")
        check(SoccerFeed.card(cardItem, index: 2, recent: [other]) == nil, "no foul by that player, no placement")

        print("\nCS2 live feed")
        // bo3.gg live snapshot shape (team_one/team_two may be in either order).
        let snapshot = JSON(["map_name": "de_mirage", "game_number": 1, "round_number": 14, "game_ended": false,
                             "team_one": ["score": 8, "side": "CT", "name": "Natus Vincere", "fixture": ["team_id": 787]],
                             "team_two": ["score": 5, "side": "TERRORIST", "name": "FURIA", "fixture": ["team_id": 300]]]
                            as [String: Any])
        let csLive = CSDetail.parseLive(snapshot, topTeamID: 300, bottomTeamID: 787)
        check(csLive?.topScore == 5 && csLive?.bottomScore == 8, "feed's team order mapped to ours", "\(String(describing: csLive))")
        check(csLive?.mapName == "Mirage" && csLive?.round == 14, "map and round")
        check(csLive?.topSide == "T" && csLive?.bottomSide == "CT", "sides normalized")
        check(CSDetail.parseLive(JSON(["status": "not_found"] as [String: Any]), topTeamID: 1, bottomTeamID: 2) == nil,
              "no live coverage gives nil")

        print("\nTeam short names")
        let short = ["G2": "G2", "FaZe": "FaZe", "MOUZ": "MOUZ", "Natus Vincere": "NV", "The MongolZ": "MON",
                     "Team Spirit": "SPI", "Vitality": "VIT", "BetBoom Team": "BET", "Virtus.pro": "VP", "DENDELE CS": "DEN"]
        for (name, expected) in short.sorted(by: { $0.key < $1.key }) {
            check(CounterStrike.abbreviate(name) == expected, "\(name) → \(expected)", CounterStrike.abbreviate(name))
        }

        print("\nMatching")
        func m(_ a: String, _ b: String, _ t: String) -> Event {
            Event(id: "\(a)-\(b)", content: .match(top: comp("1", a, "0"), bottom: comp("2", b, "0")), state: .live,
                  start: .now, detail: nil, caption: nil, link: nil, ref: .counterStrike(slug: "x", tournament: t))
        }
        let live = [m("Natus Vincere", "G2", "PGL Masters Bucharest 2026"), m("FaZe", "Spirit", "ESL Pro League Season 22")]
        func match(_ title: String, _ game: String = "Counter-Strike") -> Set<String> {
            CoStream.matches(.init(live: true, title: title, game: game), in: live)
        }
        check(match("NAVI VS G2 MAJOR WATCHPARTY") == ["Natus Vincere-G2"], "team in title")
        check(match("PRO LEAGUE COSTREAM") == ["FaZe-Spirit"], "tournament in title")
        check(match("FAZED and confused").isEmpty, "whole-word matching")
        check(match("GOLD GOLD GOLD", "Just Chatting").isEmpty, "non-CS category ignored")

        let html = """
        <link rel="canonical" href="https://www.youtube.com/watch?v=abc123"><meta name="title" content="Lead semi-finals | Santiago 2026">
        "isLiveNow":false,"startTimestamp":"2026-10-25T13:00:00+00:00"
        """
        let b = ClimbingBroadcast.parse(html)
        check(b?.title == "Lead semi-finals | Santiago 2026" && b?.isLive == false && b?.start != nil, "YouTube live page parse")
        check(b?.covers(category: "Lead Women", round: "Semi-final", eventName: "Santiago 2026") == true, "stream covers its round")
        check(b?.covers(category: "Lead Women", round: "Final", eventName: "Santiago 2026") == false, "semis aren't finals")
        check(ClimbingBroadcast.parse(#"<link rel="canonical" href="https://www.youtube.com/channel/X">"#) == nil, "no stream scheduled")
    }

    // MARK: NBA — parser, key plays, court geometry, standings, live lane (inline JSON)

    static func basketball() {
        print("\nNBA")
        let sentinel = (x: -214748340.0, y: -214748365.0)
        func play(_ id: String, _ text: String, home: Int, away: Int, type: String = "92", period: Int = 1, clock: String = "10:00",
                  team: String? = nil, scoring: Bool = false, value: Int = 0, attempted: Int = 0, shooting: Bool = false,
                  at spot: (x: Double, y: Double)? = nil, people: [String] = []) -> [String: Any] {
            var p: [String: Any] = ["id": id, "sequenceNumber": id, "type": ["id": type, "text": type == "412" ? "End Period" : "Shot"],
                                    "text": text, "homeScore": home, "awayScore": away, "period": ["number": period],
                                    "clock": ["displayValue": clock], "scoringPlay": scoring, "scoreValue": value,
                                    "pointsAttempted": attempted, "shootingPlay": shooting,
                                    "coordinate": ["x": (spot ?? sentinel).x, "y": (spot ?? sentinel).y],
                                    "participants": people.map { ["athlete": ["id": $0]] }]
            if let team { p["team"] = ["id": team] }
            return p
        }
        // LAL (13) at UTAH (26): the away team is listed first (top).
        let side: (String?) -> GameDetail.Side? = { $0 == "13" ? .top : $0 == "26" ? .bottom : nil }

        // Game order is array order; sequence numbers here are deliberately out of order.
        let plays: [[String: Any]] = [
            play("9", "Paul George makes 26-foot three point jumper (Jordan Walsh assists)", home: 0, away: 3, team: "13",
                 scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 14), people: ["4251", "4683689"]),
            play("2", "Ace Bailey blocks Luka Doncic 's 25-foot three point pullup jump shot", home: 0, away: 3, team: "13",
                 attempted: 3, shooting: true, at: (25, 25), people: ["3945274", "5000"]),
            play("7", "Lauri Markkanen makes free throw 1 of 2", home: 1, away: 3, type: "98", team: "26", scoring: true, value: 1,
                 attempted: 1, shooting: true),
            play("4", "Keyonte George misses 25-foot running jump shot", home: 1, away: 3, team: "26", attempted: 3, shooting: true,
                 at: (25, 24)),
            play("5", "End of the 1st Quarter", home: 1, away: 3, type: "412", clock: "0.0"),
        ]
        let nba = NBADetail.parse(JSON(["plays": plays] as [String: Any]), side: side, topIsHome: false)
        check(nba.shots.map(\.id) == ["9", "2", "4"], "shots in game order, free throws left out", "\(nba.shots.map(\.id))")
        check(nba.shots.first { $0.id == "2" }?.player == "3945274", "a blocked shot belongs to the shooter, not the blocker")
        check(nba.shots.first { $0.id == "4" }?.value == 3, "pointsAttempted says three when the text doesn't")
        check(nba.shots.first?.made == true && nba.shots.first?.side == .top && nba.shots.first?.elapsed == 120,
              "made shot, side and game time")
        check(nba.flow.map(\.margin) == [0, 3, 2] && nba.flow.last?.scorer == .bottom, "game flow follows the score",
              "\(nba.flow.map(\.margin))")
        check(nba.newestElapsed == 720, "the summary's newest play is the last in order")
        check(NBADetail.recentPlays(plays.map(JSON.init)).first == "Q1 0.0  End of the 1st Quarter", "latest plays, newest first")
        // winprobability comes in sequence order: "4" was entered late but sits last in the game.
        let wp = JSON(["plays": plays, "winprobability": [["playId": "2", "homeWinPercentage": 0.4], ["playId": "4", "homeWinPercentage": 0.45],
                                                          ["playId": "9", "homeWinPercentage": 0.3]]] as [String: Any])
        check(NBADetail.homeWinProbability(wp) == 0.45, "win probability joined to the latest play by ID, not the list's end")
        check(NBADetail.isNotable(type: 92, scoreValue: 0) && NBADetail.isNotable(type: 98, scoreValue: 1)
              && NBADetail.isNotable(type: 62, scoreValue: 0) && NBADetail.isNotable(type: 44, scoreValue: 0)
              && !NBADetail.isNotable(type: 155, scoreValue: 0) && !NBADetail.isNotable(type: 16, scoreValue: 0)
              && !NBADetail.isNotable(type: 584, scoreValue: 0) && !NBADetail.isNotable(type: 412, scoreValue: 0),
              "the list line keeps shots, free throws, turnovers and fouls; skips rebounds, timeouts, subs, breaks")

        // Key plays: a 10–0 run, the end of Q1, late lead changes (a tie between doesn't hide one), "Final" once.
        let story: [[String: Any]] = [
            play("a", "LAL two", home: 0, away: 2, team: "13", scoring: true, value: 2),
            play("b", "LAL two", home: 0, away: 4, team: "13", scoring: true, value: 2),
            play("c", "LAL three", home: 0, away: 7, team: "13", scoring: true, value: 3),
            play("d", "LAL three", home: 0, away: 10, team: "13", scoring: true, value: 3),
            play("e", "UTAH two", home: 2, away: 10, team: "26", scoring: true, value: 2),
            play("q1", "End of the 1st Quarter", home: 2, away: 10, type: "412", clock: "0.0"),
            play("f", "Lauri Markkanen makes 27-foot three point jumper (Isaiah Collier assists)", home: 12, away: 10, period: 4,
                 team: "26", scoring: true, value: 10),
            play("g", "LAL two", home: 12, away: 12, period: 4, team: "13", scoring: true, value: 2),
            play("h", "Luka Doncic makes 26-foot step back jumpshot", home: 12, away: 14, period: 4, team: "13", scoring: true, value: 2),
            play("q4", "End of the 4th Quarter", home: 12, away: 14, type: "412", period: 4, clock: "0.0"),
            ["id": "end", "type": ["id": "402", "text": "End Game"], "text": "End of Game", "homeScore": 12, "awayScore": 14,
             "period": ["number": 4], "clock": ["displayValue": "0.0"]],
        ]
        let key = NBADetail.keyMoments(JSON(["plays": story] as [String: Any]), side: side, topIsHome: false)
        check(key.map(\.text) == ["10–0 run", "End of Q1", "Lead change · Lauri Markkanen 27-ft three point jumper", "12–0 run",
                                  "Lead change · Luka Doncic 26-ft step back jumpshot", "Final"],
              "runs, the break, late lead changes and the final", "\(key.map(\.text))")
        check(key.first?.score == "10–0" && key.first?.side == .top && key[1].score == "10–2", "scores top–bottom")
        check(Set(key.map(\.id)).count == key.count, "moment IDs stay unique when a run ends on a lead change")

        print("\nNBA court")
        check(NBADetail.isThree(x: 3, y: 1) && NBADetail.isThree(x: 25, y: 25) && !NBADetail.isThree(x: 25, y: 24.5),
              "22 ft in the corner, 23.75 ft around the arc")
        func shot(_ x: Double, _ y: Double, _ side: GameDetail.Side) -> GameDetail.Shot {
            GameDetail.Shot(id: "s", x: x, y: y, made: true, value: 2, side: side, player: nil, period: 1, clock: "", text: "", elapsed: 0)
        }
        check(CourtView.spot(shot(25, 1, .top)) == CourtView.rim(for: .top) && CourtView.rim(for: .top) == CGPoint(x: 89, y: 25),
              "the top team shoots at the right rim")
        check(CourtView.spot(shot(25, 1, .bottom)) == CGPoint(x: 5, y: 25), "the bottom team at the left")
        check(CourtView.spot(shot(0, -4, .top)) == CGPoint(x: 94, y: 0) && CourtView.spot(shot(0, -4, .bottom)) == CGPoint(x: 0, y: 50),
              "the two halves are the same court turned around")
        check(CourtView.shooting((9, 16), threes: (3, 7)) == "9 of 16, 3 of 7 from three", "a player's shooting line")
        let focusShots = [GameDetail.Shot(id: "x", x: 1, y: 1, made: true, value: 3, side: .top, player: "p", period: 2, clock: "",
                                          text: "", elapsed: 0), shot(2, 2, .bottom)]
        check(CourtView.lit(focusShots, by: Focus(player: "p")).map(\.id) == ["x"]
              && CourtView.lit(focusShots, by: Focus(period: 2, side: .top)).map(\.id) == ["x"]
              && !Focus(player: "p").matches(play: "x"), "a player or a quarter lights its shots; other charts ignore a player")

        print("\nNBA box score")
        let keys = ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
                    "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers", "steals", "blocks",
                    "offensiveRebounds", "defensiveRebounds", "fouls", "plusMinus"]
        func athlete(_ id: String, starter: Bool, minutes: String, dnp: String? = nil) -> [String: Any] {
            ["athlete": ["id": id, "shortName": "P. \(id)"], "starter": starter, "active": id == "A", "didNotPlay": dnp != nil,
             "reason": dnp ?? "COACH'S DECISION",
             "stats": dnp != nil ? [] : [minutes, "10", "4-8", "1-3", "1-2", "5", "3", "2", "1", "0", "1", "4", "2", "+6"]]
        }
        let team = JSON(["team": ["id": "13"], "statistics": [["keys": keys, "labels": [],
            "totals": ["", "112", "40-88", "12-33", "20-24", "44", "25", "13", "8", "5", "10", "34", "19", ""],
            "athletes": [athlete("A", starter: true, minutes: "34"), athlete("B", starter: false, minutes: "10"),
                         athlete("C", starter: false, minutes: "20"), athlete("D", starter: false, minutes: "", dnp: "COACH'S DECISION"),
                         athlete("E", starter: false, minutes: "", dnp: "RIGHT CALF")]]]] as [String: Any])
        let box = NBADetail.box(team)
        check(box.map(\.id) == ["A", "C", "B", "D", "E"], "starters, bench by minutes, then who didn't play", "\(box.map(\.id))")
        check(box.first?.stats["STL"] == "1" && box.first?.stats["FT"] == "1-2" && box.first?.fieldGoals == "4-8"
              && box.first?.points == 10 && box.first?.onCourt == true, "full line keyed by label, typed accessors on top")
        check(box[3].didNotPlay == "Coach's decision" && box[4].didNotPlay == "Right calf", "DNP reasons, ESPN's shouting tidied")
        let totals = NBADetail.boxTotals(team)
        check(totals["PTS"] == "112" && totals["FG"] == "40-88" && totals["MIN"] == nil, "team totals keyed the same way")
        check(BoxScoreView.notPlayed([box[3], box[4]], live: false) == "DNP: P. D · Coach's decision; P. E · Right calf",
              "one DNP line")

        let pregame = NBADetail.parse(JSON(["leaders": [["team": ["id": "13"], "leaders": [
            ["name": "pointsPerGame", "leaders": [["displayValue": "24.5", "summary": "69.6 FG%, 70.0 FT%",
                                                   "athlete": ["id": "1", "shortName": "P. Banchero"]]]]]]]] as [String: Any]),
                                      side: side, topIsHome: false)
        check(pregame.seasonLeaders && pregame.leaders.first?.category == "PTS" && pregame.leaders.first?.top?.detail == "69.6 FG%",
              "pregame leaders are season averages")
        let hurt = NBADetail.injury(JSON(["status": "Day-To-Day", "athlete": ["id": "9", "shortName": "J. Nurkic"],
                                          "details": ["type": "Foot", "detail": "Strain", "side": "Right", "returnDate": "2026-11-04"]]
                                         as [String: Any]), side: .bottom)
        check(hurt?.status == "Day-to-day" && hurt?.detail == "Right foot strain" && hurt?.returnDate != nil, "injury line")

        print("\nNBA team stats")
        let statNames = ["fieldGoalPct": "45", "threePointFieldGoalPct": "38", "freeThrowPct": "80", "totalRebounds": "44",
                         "assists": "25", "totalTurnovers": "13", "steals": "8", "blocks": "5", "pointsInPaint": "48",
                         "fastBreakPoints": "12", "largestLead": "15"]
        func teamStats(_ id: String) -> [String: Any] {
            ["team": ["id": id], "statistics": statNames.map { ["name": $0.key, "displayValue": $0.value, "label": $0.key] }]
        }
        let statsSummary = JSON(["boxscore": ["teams": [teamStats("13"), teamStats("26")]]] as [String: Any])
        let nbaStats = ESPNDetail.stats(statsSummary, sport: .basketball, topID: "13", bottomID: "26", path: "basketball/nba")
        let wnbaStats = ESPNDetail.stats(statsSummary, sport: .basketball, topID: "13", bottomID: "26", path: "basketball/wnba")
        check(nbaStats.count == 11 && nbaStats.first?.top == "45%" && nbaStats.last?.label == "Largest Lead",
              "NBA team stats: percentages, paint, fast breaks, largest lead", "\(nbaStats.map(\.label))")
        check(wnbaStats.count == 7 && wnbaStats.first?.top == "45" && !wnbaStats.contains { $0.label == "Largest Lead" }, "the WNBA keeps its stats as they were", "\(wnbaStats.map(\.label))")

        print("\nNBA standings")
        func entry(_ id: String, seed: Int, _ w: Int, _ l: Int) -> [String: Any] {
            ["team": ["id": id, "shortDisplayName": "T\(id)", "abbreviation": "T\(id)"],
             "stats": [["name": "playoffSeed", "value": Double(seed)], ["name": "wins", "value": Double(w)],
                       ["name": "losses", "value": Double(l)], ["name": "gamesBehind", "value": 0.0, "displayValue": seed == 1 ? "-" : "1"],
                       ["name": "Home", "type": "home", "summary": "1-0", "displayValue": "1-0"]]]
        }
        let table = NBAStandings.parse(JSON(["children": [["name": "Eastern Conference", "standings": ["entries": [
            entry("3", seed: 3, 2, 1), entry("1", seed: 1, 3, 0), entry("4", seed: 4, 1, 2), entry("2", seed: 2, 2, 1)]]]]]
            as [String: Any]))
        check(table.map(\.rank) == [1, 2, 3, 4] && table.first?.id == "espn-basketball-1", "sorted by seed, not ESPN's order")
        check(table.first?.details["Home"] == "1-0", "every stat kept for wider tables")
        let quiet = NBAStandings.project(table, liveEvents: [])
        check(quiet.allSatisfy { $0.movement == 0 } && quiet.first?.gamesBehind == "–" && quiet[1].gamesBehind == "1",
              "nothing live: ESPN's seeding and games behind")
        let game = Event(id: "g", content: .match(top: comp("espn-basketball-3", "T3", "50"), bottom: comp("espn-basketball-1", "T1", "40")),
                         state: .live, start: .now, detail: nil, caption: nil, link: nil)
        let projected = NBAStandings.project(table, liveEvents: [game])
        let climber = projected.first { $0.id == "espn-basketball-3" }
        check(climber?.liveRank == 2 && climber?.movement == 1 && climber?.wins == 3 && climber?.liveScore == "50–40",
              "the team ahead gets the win and climbs", "\(projected.map { "\($0.row.abbreviation) \($0.liveRank)" })")
        check(projected.first?.id == "espn-basketball-1" && projected.first?.losses == 1
              && projected.first { $0.id == "espn-basketball-2" }?.gamesBehind == "0.5", "the team behind takes the loss; games behind")
        check(NBAStandings.window(projected, around: ["espn-basketball-4"], reach: 1).map(\.id)
              == ["espn-basketball-2", "espn-basketball-4"], "a window around the game's teams")

        print("\nNBA live lane")
        let teams = BasketballFeed.Teams(topIsHome: false, topID: "13", bottomID: "26", topName: "LAL", bottomName: "UTAH")
        func run(_ team: String, _ larger: Int, _ smaller: Int, from start: String, _ p: [String: Any]) -> [String: Any] {
            var p = p
            p["scoringRun"] = ["team": ["$ref": "http://x/seasons/2027/teams/\(team)?lang=en"], "larger": larger, "smaller": smaller,
                               "play": ["$ref": "http://x/events/1/competitions/1/plays/\(start)?lang=en"]]
            return p
        }
        let lane: [JSON] = [
            play("10", "LAL two", home: 0, away: 2, team: "13", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 5)),
            play("11", "Lauri Markkanen misses 18-foot jumper", home: 0, away: 2, team: "26", attempted: 2, shooting: true, at: (20, 15)),
            play("12", "LAL three", home: 0, away: 5, team: "13", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 3)),
            run("13", 8, 0, from: "10", play("13", "Ziaire Williams makes 25-foot three point jumper (Luka Doncic assists)", home: 0,
                                              away: 8, team: "13", scoring: true, value: 3, attempted: 3, shooting: true, at: (42, 19))),
            run("13", 10, 0, from: "10", play("14", "LAL two", home: 0, away: 10, team: "13", scoring: true, value: 2, attempted: 2,
                                               shooting: true, at: (25, 3))),
            play("15", "End of the 2nd Quarter", home: 0, away: 10, type: "412", period: 2, clock: "0.0"),
            play("16", "UTAH three", home: 3, away: 10, period: 4, team: "26", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 3)),
            play("17", "UTAH three", home: 6, away: 10, period: 4, team: "26", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 3)),
            play("18", "UTAH three", home: 9, away: 10, period: 4, team: "26", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 3)),
            run("26", 11, 0, from: "16", play("19", "Lauri Markkanen makes 27-foot three point jumper", home: 11, away: 10, period: 4,
                                               team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (47, 3))),
        ].map(JSON.init)
        func moment(_ i: Int, in plays: [JSON]? = nil) -> LiveMoment? {
            BasketballFeed.moment(at: i, in: plays ?? lane, teams: teams, fromTipOff: true)
        }
        check(moment(0)?.kind == .made(value: 2) && moment(0)?.tier == .routine
              && moment(1)?.kind == .missed && moment(1)?.tier == .routine, "twos and misses only animate")
        check(moment(2)?.kind == .made(value: 3) && moment(2)?.tier == .swing && moment(2)?.lead == "Three", "a three is captioned")
        check(moment(3)?.kind == .run && moment(3)?.lead == "8–0 run" && moment(3)?.side == .top
              && moment(3)?.detail == "LAL · Ziaire Williams 25-ft three point jumper", "ESPN's scoring run, when it starts",
              moment(3)?.detail ?? "nil")
        check(moment(4)?.kind == .made(value: 2), "a run growing short of the next milestone is just the basket")
        check(moment(5)?.kind == .periodEnd && moment(5)?.lead == "End of Q2" && moment(5)?.detail == "LAL 10–0", "end of a quarter")
        check(moment(9)?.kind == .leadChange && moment(9)?.detail == "Lauri Markkanen 27-ft three point jumper · UTAH 11–10"
              && moment(9)?.side == .bottom, "a fourth-quarter lead change outranks the run it caps", moment(9)?.detail ?? "nil")
        check(lane.indices.compactMap { moment($0) }.allSatisfy { $0.chart == .court }, "every moment belongs to the court")

        // ESPN rewrites and deletes plays: a deleted or overturned basket is taken back; a bigger edit is news again.
        let announced = Dictionary(uniqueKeysWithValues: [0, 2, 3].compactMap { moment($0) }.map { ($0.id, $0) })
        var edited = lane.map { $0.raw as! [String: Any] }
        edited.remove(at: 3)                                     // the 8–0 run's basket deleted
        edited[2]["scoringPlay"] = false                         // the three overturned
        edited[2]["scoreValue"] = 0
        edited[0]["pointsAttempted"] = 3                         // the two was a three after all
        let edits = BasketballFeed.reconcile(announced, in: edited.map(JSON.init), teams: teams, fromTipOff: true)
        check(Set(edits.retracted) == ["12", "13"] && edits.upgraded.map(\.id) == ["10"] && edits.upgraded.first?.tier == .swing,
              "edits: deleted and overturned plays retracted, an upgraded one re-announced",
              "\(edits.retracted) \(edits.upgraded.map(\.id))")
        let normalized = BasketballFeed.normalized(JSON(["team": ["$ref": "http://x/seasons/2027/teams/13?lang=en"],
            "participants": [["athlete": ["$ref": "http://x/athletes/22?lang=en"], "order": 2, "type": "assister"],
                             ["athlete": ["$ref": "http://x/athletes/11?lang=en"], "order": 1, "type": "shooter"]]] as [String: Any]))
        check(normalized["team"]["id"].string == "13" && NBADetail.participants(normalized) == ["11", "22"],
              "core plays read like the summary's, shooter first")

        func laneShot(_ id: String, _ elapsed: Double) -> GameDetail.Shot {
            GameDetail.Shot(id: id, x: 1, y: 1, made: true, value: 2, side: .top, player: nil, period: 1, clock: "", text: "",
                            elapsed: elapsed)
        }
        let merged = NBADetail.shots(summary: [laneShot("a", 10), laneShot("b", 100)], newestElapsed: 100,
                                     lane: [laneShot("b", 100), laneShot("old", 50), laneShot("c", 120)])
        check(merged.map(\.id) == ["a", "b", "c"], "the lane adds only newer shots, without duplicates", "\(merged.map(\.id))")
        func point(_ id: String, _ t: Double, _ top: Int, _ bottom: Int) -> GameDetail.FlowPoint {
            GameDetail.FlowPoint(id: id, elapsed: t, top: top, bottom: bottom, period: 1, clock: "")
        }
        let flow = NBADetail.flow(summary: [point("tip", 0, 0, 0), point("a", 10, 2, 0)],
                                  lane: [point("a", 10, 2, 0), point("x", 10, 2, 0), point("b", 20, 2, 3)])
        check(flow.map(\.id) == ["tip", "a", "b"] && flow.last?.scorer == .bottom, "the game flow continues from the summary")

        check(NBADetail.listLine("Ace Bailey blocks Luka Doncic 's 25-foot three point pullup jump shot",
                                 names: [("Ace Bailey", "A. Bailey"), ("Luka Doncic", "L. Doncic")])
              == "A. Bailey blocks L. Doncic's 25-ft three point pullup jump shot", "scores-list line: short names")
        check(NBADetail.listLine("End of the 2nd Quarter") == "End of Q2" && NBADetail.listLine("End of the 1st  Overtime") == "End of OT",
              "quarter and overtime ends")
        check(NBADetail.listLine("Jalen Williams enters the game for Jaylin Williams", names: [("Jalen Williams", "J. Williams")]) == "J. Williams in for Jaylin Williams", "substitutions, briefly")
        func franchise(_ id: String, _ color: String, _ alternate: String) -> Competitor {
            var c = comp("espn-basketball-\(id)", id, color: color)
            c.alternateColor = alternate
            return c
        }
        let lakersJazz = TeamPalette.nba(top: franchise("13", "552583", "fdb927"), bottom: franchise("26", "4e008e", "79a3dc"), scheme: .dark)
        let netsCavs = TeamPalette.nba(top: franchise("17", "000000", "ffffff"), bottom: franchise("5", "860038", "fdbb30"), scheme: .dark)
        check(lakersJazz.bottom != Viz.neutral && netsCavs.top == Viz.neutral,
              "clashing purples: the Jazz wear their second color; the Nets' black stays an honest gray")
        let pacers = franchise("11", "0c2340", "ffd520"), nets = franchise("17", "000000", "ffffff")
        // Dark: navy lifts to a clear blue (TeamTone), already apart from the Nets' gray.
        // Light: navy beside black looks alike, so the Pacers wear gold.
        let darkPair = TeamPalette.nba(top: pacers, bottom: nets, scheme: .dark)
        check(TeamPalette.difference(darkPair.top, darkPair.bottom) >= 0.45
              && TeamPalette.chroma(TeamPalette.nba(top: pacers, bottom: nets, scheme: .light).top) > 0.5,
              "beside the Nets: a clear blue in dark; gold in light (navy and black look alike)")
        check(NBADetail.shotText("Mario Hezonja makes 25-foot three point jumper (Jaylon Tyson assists)", shooter: "M. Hezonja")
              == "M. Hezonja 25-ft three point jumper", "a shot after its Made/Missed lead")
    }
}
