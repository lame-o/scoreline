import SwiftUI

// The scoring slide, checked on real games: World Series Games 2 and 3 (ESPN's
// plays: Tests/Fixtures/ws-g3-plays.json and the Game 2 summary), Statcast's
// at-bats (statcast-849804.json), Monday Night Football (mnf-dal-phi-plays.json),
// the Premier League goals the soccer theater replays (soccer-theater-plays.json),
// NY at BOS (nba-plays-401909095.json), the recorded CS2 series (G2 0–2 NAVI)
// and a recorded lead route: which moments slide (and which never do), the
// headline and subline per sport, the side it comes in from, the tier, the
// paint, the theater's climax, who plays the burst, the motion and the line.

extension ScorelineTests {
    static func scoringSlides() async {
        print("\nScoring slides")
        let dir = FixtureProtocol.directory
        func say(_ s: ScoringSlide?) -> String {
            s.map { "\($0.headline) | \($0.chip ?? "-") | \($0.subline) | \($0.score ?? "-") | \($0.spoken)" } ?? "nil"
        }
        let brewers = SlideTeam(name: "Brewers", abbreviation: "MIL", color: "12284b", alternate: "ffc52f")
        // A run of names ahead of "scored" is one list, not three clauses.
        let listedSlam = BaseballPlay("Rice homered to right (408 feet), McMahon, Jones, and Goldschmidt scored.")
        check(listedSlam.scorers == ["McMahon", "Jones", "Goldschmidt"] && BaseballPlay.scored(listedSlam.scorers) == "McMahon, Jones and Goldschmidt score"
              && listedSlam.feet == 408, "a grand slam's runners, listed: McMahon, Jones and Goldschmidt score", "\(listedSlam.scorers)")
        let movedUp = BaseballPlay("Pratt doubled to left, Frelick scored, Yelich to third.")
        check(movedUp.scorers == ["Frelick"], "a runner who moved up isn't a scorer", "\(movedUp.scorers)")
        let joined = BaseballPlay("Chourio singled to center, Turang and Yelich scored.")
        check(joined.scorers == ["Turang", "Yelich"], "two scorers joined by and", "\(joined.scorers)")

        let rays = SlideTeam(name: "Rays", abbreviation: "TB", color: "092c5c", alternate: "8fbce6")

        // MARK: Baseball, Game 3 (MIL at TB: the Brewers bat first, on the left)

        guard let g3Data = try? Data(contentsOf: dir.appendingPathComponent("ws-g3-plays.json")),
              let g2Data = try? Data(contentsOf: dir.appendingPathComponent("3bd207fad0c0e7da8976ca99.bin")),
              let statcastData = try? Data(contentsOf: dir.appendingPathComponent("statcast-849804.json")) else {
            return check(false, "Game 2 and 3 plays and Statcast fixtures load")
        }
        // The fixture is trimmed to what the theater reads; the live feed's
        // scoring flag and running score go back on from each play's runs.
        var away = 0, home = 0
        let g3 = JSON(data: g3Data)["items"].array.map { item -> JSON in
            guard var raw = item.raw as? [String: Any], item["type"]["type"].string == "play-result",
                  let runs = item["scoreValue"].int, runs > 0 else { return item }
            if item["period"]["type"].string == "Top" { away += runs } else { home += runs }
            raw["scoringPlay"] = true
            raw["homeScore"] = home
            raw["awayScore"] = away
            return JSON(raw)
        }
        let g3Side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        let g3Context = SlideContext(top: brewers, bottom: rays)
        let g3Moments = g3.compactMap { BaseballFeed.moment($0, side: g3Side) }
        let g3Slides = g3Moments.compactMap { ScoringSlide.make($0, context: g3Context) }
        let runPlays = g3.filter { $0["scoringPlay"].bool == true }
        check(g3Slides.count == runPlays.count && runPlays.count == 9,
              "every run-scoring play in Game 3 slides (9), and nothing else: no strikeouts, outs or hits without a run",
              "\(g3Slides.count) slides of \(runPlays.count) runs")
        let yelich = g3Slides.first { $0.id == "4019080440404990057" }
        check(yelich?.headline == "RBI SINGLE" && yelich?.chip == "+1" && yelich?.subline == "Yelich singles to left · Chourio scores"
              && yelich?.score == "MIL 1–0" && yelich?.side == .top && yelich?.edge == .leading && yelich?.tier == .normal,
              "Yelich's RBI single: the Brewers' bar from the left, “Yelich singles to left · Chourio scores”, MIL 1–0", say(yelich))
        check(yelich?.spoken == "Brewers RBI single, Yelich, 1 run, Brewers lead 1 to 0",
              "…said once: “Brewers RBI single, Yelich, 1 run, Brewers lead 1 to 0”", yelich?.spoken ?? "nil")
        let turang = g3Slides.first { $0.id == "4019080440806990057" }
        check(turang?.headline == "2-RUN SINGLE" && turang?.chip == "+2"
              && turang?.subline == "Turang reaches on infield single to shortstop · Chourio and Yelich score",
              "two runs on an infield single: 2-RUN SINGLE, +2, both runners named", say(turang))
        let pratt = g3Slides.first { $0.id == "4019080440808990057" }
        check(pratt?.headline == "2-RUN DOUBLE" && pratt?.subline == "Pratt doubles to left · Mitchell and Turang score",
              "Pratt's 2-run double", say(pratt))
        let diaz = g3Slides.first { $0.id == "4019080441704990057" }
        check(diaz?.headline == "RBI DOUBLE" && diaz?.side == .bottom && diaz?.edge == .trailing && diaz?.score == "TB 1–10"
              && diaz?.spoken.hasSuffix("Brewers lead 10 to 1") == true,
              "a Rays run comes in from the right, their number first (TB 1–10), and says who leads", say(diaz))

        // A run that isn't a hit: an error, and two on one play.
        let error = JSON(["id": "e1", "type": ["type": "play-result"], "alternativeType": ["type": "reached-on-error"],
                          "text": "Pratt scored on error, Hamilton safe at first on fielding error by first baseman Aranda, Frelick to second.",
                          "scoringPlay": true, "scoreValue": 1, "team": ["id": "8"], "period": ["type": "Top", "number": 7],
                          "homeScore": 4, "awayScore": 3] as [String: Any])
        let errorSlide = BaseballFeed.moment(error, side: g3Side).flatMap { ScoringSlide.make($0, context: g3Context) }
        check(errorSlide?.headline == "RUN SCORES" && errorSlide?.subline.hasSuffix("Pratt scores") == true
              && errorSlide?.subline.hasPrefix("Hamilton safe at first") == true,
              "a run on an error: RUN SCORES, the batter's clause, who scored", say(errorSlide))
        var twoOnError = error.raw as! [String: Any]
        twoOnError["scoreValue"] = 2
        twoOnError["text"] = "Pratt scored and Turang scored on error, Hamilton safe at first."
        let two = BaseballFeed.moment(JSON(twoOnError), side: g3Side).flatMap { ScoringSlide.make($0, context: g3Context) }
        check(two?.headline == "2 RUNS SCORE" && two?.chip == "+2", "two runs that aren't a hit: 2 RUNS SCORE", say(two))

        // MARK: Baseball, Game 2 (TB at MIL): home runs, with Statcast

        let g2 = JSON(data: g2Data)["plays"].array
        let g2Side: (String?) -> GameDetail.Side? = { $0 == "30" ? .top : $0 == "8" ? .bottom : nil }
        let g2Context = SlideContext(top: rays, bottom: brewers)
        func g2Item(_ id: String) -> JSON? { g2.first { $0["id"].string == id } }
        let hicksMoment = g2Item("4019080430005990057").flatMap { BaseballFeed.moment($0, side: g2Side) }
        let hicks = hicksMoment.flatMap { ScoringSlide.make($0, context: g2Context) }
        check(hicks?.headline == "2-RUN HOMER" && hicks?.short == nil && hicks?.chip == "+2"
              && hicks?.subline == "Hicks · 411 ft · Caminero scores" && hicks?.score == "TB 4–0" && hicks?.tier == .big
              && hicks?.side == .top,
              "Hicks' two-run homer: baseball's own headline (2-RUN HOMER), +2, ESPN's 411 ft, a big slide", say(hicks))
        check(hicks?.spoken == "Rays 2-run homer, Hicks, 2 runs, Rays lead 4 to 0", "…said: “Rays 2-run homer, Hicks, 2 runs, Rays lead 4 to 0”",
              hicks?.spoken ?? "nil")
        // Statcast's measurement (here the game's 413-ft drive, as parsed from the real feed) replaces ESPN's distance.
        let batted = Statcast.atBats(JSON(data: statcastData)).compactMap(\.batted).max { ($0.distance ?? 0) < ($1.distance ?? 0) }
        let measured = hicksMoment.flatMap { ScoringSlide.make($0, context: g2Context, batted: batted) }
        check(batted?.distance == 413 && measured?.subline == "Hicks · 413 ft · EV 111.4 mph · Caminero scores",
              "with Statcast: its distance and exit velocity (EV, as Statcast labels it) in the subline", say(measured))
        let frelick = g2Item("4019080431101990057").flatMap { BaseballFeed.moment($0, side: g2Side) }
            .flatMap { ScoringSlide.make($0, context: g2Context) }
        check(frelick?.headline == "HOME RUN" && frelick?.chip == "+1" && frelick?.subline == "Frelick · 408 ft" && frelick?.side == .bottom
              && frelick?.edge == .trailing && frelick?.score == "MIL 4–4" && frelick?.spoken.hasSuffix("tied 4 to 4") == true,
              "Frelick's solo shot (the Brewers at home: from the right) ties it", say(frelick))
        var slam = g2Item("4019080430005990057")?.raw as? [String: Any] ?? [:]
        slam["scoreValue"] = 4
        slam["awayScore"] = 6
        slam["text"] = "Hicks homered to right center (411 feet), Caminero scored, Díaz scored and Simpson scored."
        let grand = BaseballFeed.moment(JSON(slam), side: g2Side).flatMap { ScoringSlide.make($0, context: g2Context) }
        check(grand?.headline == "GRAND SLAM" && grand?.chip == "+4" && grand?.tier == .top && grand?.hold == 6
              && grand?.subline == "Hicks · 411 ft · Caminero, Díaz and Simpson score",
              "a grand slam: the top tier (confetti, a longer hold), every runner named", say(grand))
        var walkOff = g2Item("4019080431101990057")?.raw as? [String: Any] ?? [:]
        walkOff["period"] = ["type": "Bottom", "number": 11]
        walkOff["homeScore"] = 5
        let walk = BaseballFeed.moment(JSON(walkOff), side: g2Side).flatMap { ScoringSlide.make($0, context: g2Context) }
        check(walk?.headline == "WALK-OFF HOME RUN" && walk?.short == "WALK-OFF HR" && walk?.tier == .top,
              "a walk-off home run: the top tier", say(walk))

        // MARK: Football: Monday Night Football (DAL at PHI: Dallas on the left)

        guard let mnfData = try? Data(contentsOf: dir.appendingPathComponent("mnf-dal-phi-plays.json")) else {
            return check(false, "MNF plays fixture loads")
        }
        let items = JSON(data: mnfData)["items"].array
        let teams = FootballFeed.Teams(topIsHome: false, topID: "6", bottomID: "21", homeAbbreviation: "PHI", awayAbbreviation: "DAL")
        let plays = items.compactMap { FootballFeed.play($0, teams: teams) }.sorted { $0.sequence < $1.sequence }
        let fbContext = SlideContext(top: SlideTeam(name: "Cowboys", abbreviation: "DAL", color: "002a5c", alternate: "b0b7bc"),
                                     bottom: SlideTeam(name: "Eagles", abbreviation: "PHI", color: "06424d", alternate: "000000"))
        let fbMoments = plays.compactMap { FootballFeed.moment($0, before: FootballFeed.score(before: $0, in: plays), topIsHome: false) }
        let fbSlides = fbMoments.compactMap { ScoringSlide.make($0, context: fbContext) }
        let scores = items.filter { $0["scoringPlay"].bool == true }
        check(fbSlides.count == scores.count && scores.count == 10 && fbMoments.count > 60,
              "every score in the game slides (7 touchdowns, 3 field goals), and no other play does (big plays, sacks, turnovers)",
              "\(fbSlides.count) slides, \(scores.count) scores, \(fbMoments.count) moments")
        func fb(_ suffix: String) -> ScoringSlide? { fbSlides.first { $0.id.hasSuffix(suffix) } }
        let pierce = fb("1152")
        check(pierce?.headline == "TOUCHDOWN" && pierce?.chip == "+7" && pierce?.subline == "D. Pierce 5-yd run · PAT good"
              && pierce?.score == "PHI 14–10" && pierce?.side == .bottom && pierce?.tier == .big,
              "Pierce's touchdown: the Eagles' bar from the right, +7 with the kick, “D. Pierce 5-yd run · PAT good”", say(pierce))
        check(pierce?.spoken == "Eagles touchdown, D. Pierce 5-yard run, extra point good, Eagles lead 14 to 10",
              "…said: “Eagles touchdown, D. Pierce 5-yard run, extra point good, Eagles lead 14 to 10”", pierce?.spoken ?? "nil")
        let lamb = fb("3048")
        check(lamb?.chip == "+8" && lamb?.subline == "C. Lamb 16-yd pass from D. Prescott · 2-pt conversion good" && lamb?.score == "DAL 28–21"
              && lamb?.side == .top,
              "a passing touchdown names the passer; the two-point run makes it +8", say(lamb))
        let aubrey = fb("9213")
        check(aubrey?.headline == "FIELD GOAL" && aubrey?.chip == "+3" && aubrey?.subline == "B. Aubrey from 55 yards" && aubrey?.tier == .normal,
              "a 55-yard field goal: a normal slide", say(aubrey))
        let pick = LiveMoment(id: "pick", chart: .field, tier: .score, kind: .touchdown, lead: "Touchdown",
                              detail: "Quinyon Mitchell 38 Yd Interception Return (Jake Elliott Kick)", side: .bottom)
        let pickSlide = ScoringSlide.make(pick, context: fbContext)
        check(pickSlide?.headline == "PICK SIX" && pickSlide?.tier == .top && pickSlide?.chip == "+7"
              && pickSlide?.subline == "Q. Mitchell 38-yd interception return · PAT good",
              "a pick six: the top tier", say(pickSlide))
        var late = LiveMoment(id: "late", chart: .field, tier: .score, kind: .touchdown, lead: "Touchdown",
                              detail: "Saquon Barkley 8 Yd Rush (Kick Failed)", side: .bottom)
        late.accents = .decisive
        let lateSlide = ScoringSlide.make(late, context: fbContext)
        check(lateSlide?.headline == "GO-AHEAD TOUCHDOWN" && lateSlide?.short == "GO-AHEAD TD" && lateSlide?.tier == .top
              && lateSlide?.chip == "+6" && lateSlide?.subline.hasSuffix("PAT no good") == true,
              "a late go-ahead touchdown (missed kick: +6)", say(lateSlide))
        let safety = ScoringSlide.make(LiveMoment(id: "s", chart: .field, tier: .score, kind: .safety, lead: "Safety",
                                                  detail: "Team Safety", side: .top), context: fbContext)
        check(safety?.headline == "SAFETY" && safety?.chip == "+2" && safety?.side == .bottom,
              "a safety is the defense's: it comes in from their side", say(safety))
        check(FootballPlay.attempt("Two-Point Pass Conversion Failed") == .twoPoint(good: false, pass: true)
              && FootballPlay.attempt("Jake Elliott Kick") == .kick(good: true) && FootballPlay.attempt("Kick Failed") == .kick(good: false),
              "the try: a kick, good or not; two points by pass or run, good or not")

        // MARK: Soccer: the theater's goals

        guard let soccerData = try? Data(contentsOf: dir.appendingPathComponent("soccer-theater-plays.json")) else {
            return check(false, "soccer theater fixture loads")
        }
        var goals: [String: (PitchAction, SlideContext, [JSON], String?)] = [:]
        for match in JSON(data: soccerData)["matches"].array {
            func team(_ t: JSON) -> SlideTeam {
                SlideTeam(name: t["name"].string ?? "", abbreviation: t["abbreviation"].string ?? "", color: t["color"].string,
                          alternate: t["alternateColor"].string)
            }
            let context = SlideContext(top: team(match["home"]), bottom: team(match["away"]))
            let homeID = match["home"]["id"].string
            for clip in match["clips"].array {
                let clipPlays = clip.array
                for (i, item) in clipPlays.enumerated() {
                    if let action = SoccerFeed.action(item, index: i, homeTeamID: homeID), action.kind == .goal {
                        goals[action.playID] = (action, context, clipPlays, homeID)
                    }
                }
            }
        }
        func goal(_ id: String) -> ScoringSlide? {
            goals[id].flatMap { action, context, _, _ in action.moment.flatMap { ScoringSlide.make($0, context: context) } }
        }
        check(goals.count == 15 && goals.values.allSatisfy { a, c, _, _ in a.moment.flatMap { ScoringSlide.make($0, context: c) } != nil },
              "every goal slides", "\(goals.count) goals")
        let haaland = goal("54149975")
        check(haaland?.headline == "GOAL" && haaland?.chip == "+1" && haaland?.subline == "Erling Haaland · header · assisted by Iliman Ndiaye · 52'"
              && haaland?.score == "MNC 1–1" && haaland?.side == .bottom && haaland?.tier == .big,
              "Haaland's header: scorer, how, the assist and the minute; the away side from the right", say(haaland))
        check(haaland?.spoken == "Manchester City goal, Erling Haaland, header, assisted by Iliman Ndiaye, 52nd minute, tied 1 to 1",
              "…said with the minute and the score", haaland?.spoken ?? "nil")
        let own = goal("54194895")
        check(own?.headline == "OWN GOAL" && own?.side == .bottom && own?.subline == "Mike Penders, Chelsea · 77'" && own?.score == "TOT 1–0",
              "an own goal: Tottenham's, by Chelsea's Penders (the line says whose it is)", say(own))
        let pen = goal("54275717")
        check(pen?.headline == "PENALTY" && pen?.subline == "Oliver McBurnie · penalty · 24'" && pen?.side == .top,
              "a penalty", say(pen))
        check(SlideWords.minuteMark("90'+3'") == "90+3'" && SlideWords.minuteMark("37'") == "37'" && SlideWords.minute("90'+3'") == "93rd minute",
              "minutes as soccer writes them: 37', 90+3' (said: the 93rd minute)")
        let jackson = goal("54146134")
        check(jackson?.subline == "Nicolas Jackson · right foot · assisted by John McGinn · 6'", "the foot, when the line says", say(jackson))
        if let header = goals["54149975"] {
            var action = header.0
            action.clockSeconds = 88 * 60
            let equalizer = action.moment.flatMap { ScoringSlide.make($0, context: header.1) }
            check(equalizer?.headline == "LATE EQUALIZER" && equalizer?.short == "EQUALIZER" && equalizer?.tier == .top,
                  "the same header at 88': a late equalizer, the top tier", say(equalizer))
        }

        // MARK: NBA: NY at BOS, look by look as the page polls it

        guard let nbaData = try? Data(contentsOf: dir.appendingPathComponent("nba-plays-401909095.json")) else {
            return check(false, "the recorded NBA game loads")
        }
        let game = JSON(data: nbaData)["items"].array
        let celtics = BasketballFeed.Teams(topIsHome: false, topID: "18", bottomID: "2", topName: "NY", bottomName: "BOS")
        let nbaContext = SlideContext(top: SlideTeam(name: "Knicks", abbreviation: "NY"), bottom: SlideTeam(name: "Celtics", abbreviation: "BOS"))
        let feed = BasketballFeed()
        func window(_ end: Int) -> [JSON] { Array(game[max(0, end - 149)...end]) }
        feed.ingest(window(10), start: 0, teams: celtics)
        _ = feed.takeMoments()
        var nbaMoments: [LiveMoment] = []
        for end in stride(from: 12, to: game.count, by: 2) {
            feed.ingest(window(end), start: max(0, end - 149), teams: celtics)
            nbaMoments += feed.takeMoments()
        }
        let nbaSlides = nbaMoments.compactMap { ScoringSlide.make($0, context: nbaContext) }
        let makes = nbaMoments.filter { if case .made = $0.kind { return true }; return false }
        let decisive = nbaSlides.allSatisfy { s in s.headline == "BUZZER-BEATER" || s.headline.hasPrefix("GO-AHEAD") || s.headline.hasSuffix(" RUN") }
        check(makes.count > 60 && nbaSlides.count <= 6 && decisive,
              "never every basket: only buzzer-beaters, clutch go-aheads and big runs slide",
              "\(makes.count) makes, \(nbaSlides.count) slides: \(nbaSlides.map(\.headline))")
        let george = nbaSlides.first { $0.id == game[231]["id"].string }
        check(george?.headline == "BUZZER-BEATER" && george?.chip == "+3" && george?.tier == .top && george?.side == .bottom
              && george?.subline.hasSuffix("end of Q2") == true && george?.score == "BOS 50–49",
              "George's three at the end of the half: a buzzer-beater, the top tier, the Celtics' from the right", say(george))
        // Timed to the court's theater: George's three drops through the net this far into its replay.
        let georgeScene = BasketballScene.parse(game, at: 231, teams: celtics)
        let swish = georgeScene.flatMap { ScoringSlide.climax(BasketballScript($0)) }
        check(georgeScene?.id == george?.id && swish.map { $0 > 0.3 } == true,
              String(format: "NBA: the slide lands as the ball drops through the net (%.2f s into the theater's replay)", swish ?? -1))
        let hart = nbaMoments.first { $0.kind == .run }
        check(hart?.lead == "8–0 run" && hart.flatMap { ScoringSlide.make($0, context: nbaContext) } == nil,
              "an 8–0 run doesn't slide (12 or more do)", hart?.lead ?? "nil")
        var run = LiveMoment(id: "run", chart: .court, tier: .swing, kind: .run, lead: "14–2 run", detail: "NY · Josh Hart 10-ft two point shot", side: .top)
        run.facts = ScoringFacts(top: 61, bottom: 52)
        let runSlide = ScoringSlide.make(run, context: nbaContext)
        check(runSlide?.headline == "14–2 RUN" && runSlide?.chip == nil && runSlide?.subline == "Josh Hart 10-ft two point shot"
              && runSlide?.score == "NY 61–52" && runSlide?.tier == .normal,
              "a 14–2 run: a normal slide, no chip", say(runSlide))
        var goAhead = LiveMoment(id: "ga", chart: .court, tier: .swing, kind: .leadChange, lead: "Lead change",
                                 detail: "Jalen Brunson 15-ft pullup jump shot · NY 96–95", side: .top)
        goAhead.accents = .clutch
        goAhead.facts = ScoringFacts(top: 96, bottom: 95, value: 2, clock: "1:12", period: 4)
        let goAheadSlide = ScoringSlide.make(goAhead, context: nbaContext)
        check(goAheadSlide?.headline == "GO-AHEAD BASKET" && goAheadSlide?.subline == "Jalen Brunson 15-ft pullup jump shot · Q4 1:12"
              && goAheadSlide?.tier == .big,
              "a clutch go-ahead", say(goAheadSlide))

        // MARK: CS2: G2 0–2 NAVI (Nuke 11–13, Dust II 19–22)

        func live(_ t: Int, _ b: Int, map: Int, name: String, ended: Bool = false) -> GameDetail.CSLive {
            GameDetail.CSLive(mapName: name, mapNumber: map, round: t + b, topScore: t, bottomScore: b, topSide: "CT", bottomSide: "T",
                              mapEnded: ended)
        }
        let series = [GameDetail.MapResult(number: 1, name: "Nuke", topScore: 11, bottomScore: 13, winner: .bottom, live: false),
                      GameDetail.MapResult(number: 2, name: "Dust II", topScore: nil, bottomScore: nil, winner: nil, live: true),
                      GameDetail.MapResult(number: 3, name: "Mirage", topScore: nil, bottomScore: nil, winner: nil, live: false)]
        let csContext = SlideContext(top: SlideTeam(name: "G2", abbreviation: "G2"),
                                     bottom: SlideTeam(name: "Natus Vincere", abbreviation: "NAVI", color: "fff200", alternate: "000000"),
                                     maps: series)
        let names = (top: "G2", bottom: "Natus Vincere")
        let won = MatchRules.csMoments(from: live(19, 21, map: 2, name: "Dust II"), to: live(19, 22, map: 2, name: "Dust II", ended: true),
                                       names: names, maps: series).first.flatMap { ScoringSlide.make($0, context: csContext) }
        check(won?.headline == "MATCH WON" && won?.subline == "Dust II 22–19 · maps 2–0" && won?.score == "NAVI 2–0" && won?.tier == .top
              && won?.edge == .trailing,
              "NAVI take Dust II and the series: MATCH WON, the map's score winner first, the maps", say(won))
        check(won?.paint.lightInk == false, "NAVI's yellow takes black type")
        var firstMap = series
        firstMap[0] = GameDetail.MapResult(number: 1, name: "Nuke", topScore: nil, bottomScore: nil, winner: nil, live: true)
        let nuke = MatchRules.csMoments(from: live(11, 12, map: 1, name: "Nuke"), to: live(11, 13, map: 1, name: "Nuke", ended: true),
                                        names: names, maps: firstMap).first
            .flatMap { ScoringSlide.make($0, context: SlideContext(top: csContext.top, bottom: csContext.bottom, maps: firstMap)) }
        check(nuke?.headline == "MAP WON" && nuke?.tier == .big && nuke?.subline == "Nuke 13–11 · maps 1–0", "a map won", say(nuke))
        let round = MatchRules.csMoments(from: live(5, 4, map: 2, name: "Dust II"), to: live(6, 4, map: 2, name: "Dust II"), names: names, maps: series)
        check(round.count == 1 && ScoringSlide.make(round[0], context: csContext) == nil, "a round never slides")

        // MARK: Climbing: a recorded route's climbers, in a final

        let qual = Event(id: "q", content: .field(title: "", summary: ""), state: .final, start: .now, detail: nil, caption: nil, link: nil,
                         ref: .climbing(eventID: 0, category: "", resultURL: "/api/v1/category_rounds/10451/results", round: nil,
                                        eventName: "", nextURL: nil))
        let real = (try? await DetailProvider.detail(for: qual))?.wall.first?.climbers.filter { !$0.top } ?? []
        if real.count >= 6 {
            typealias Climber = GameDetail.WallRoute.Climber
            func at(_ c: Climber, _ height: Double, top: Bool = false, onWall: Bool = false) -> Climber {
                Climber(id: c.id, name: c.name, country: c.country, flag: c.flag, height: height, top: top,
                        label: top ? "TOP" : "\(Int(height))", rank: nil, onWall: onWall)
            }
            let done = real.prefix(5).map { at($0, $0.height) }
            let climber = real[5]
            func round(_ climbers: [Climber], name: String = "Final") -> GameDetail {
                var d = GameDetail()
                d.wall = [GameDetail.WallRoute(name: "1", climbers: climbers, total: 8)]
                d.roundName = name
                return d
            }
            let before = round(done + [at(climber, climber.height, onWall: true)])
            let ahead = round(done + [at(climber, real[0].height + 1, onWall: true)])
            let context = SlideContext(final: true, climbers: Dictionary(uniqueKeysWithValues: (done + [climber]).map { ($0.id, $0) }))
            let lead = MatchRules.climbingMoments(from: before, to: ahead).compactMap { ScoringSlide.make($0, context: context) }.first
            check(lead?.headline == "NEW LEADER" && lead?.chip == "1ST" && lead?.subline.hasPrefix("\(climber.name) · passes ") == true
                  && lead?.spoken.hasPrefix("New leader, \(climber.name), passes ") == true
                  // The highest climber passed (the route's leaders tie on height).
                  && done.filter { $0.height == real[0].height }.contains { lead?.subline.hasSuffix(MatchMark.surname($0.name)) == true }
                  && lead.map { $0.side == nil && $0.flag == "🇺🇸" } == true && lead?.edge == .leading,
                  "a new leader in a final: from the leading edge, in the climber's flag",
                  "\(say(lead)) | flag \(lead?.flag ?? "nil") \(lead?.country ?? "nil") side \(String(describing: lead?.side))")
            let topped = MatchRules.climbingMoments(from: before, to: round(done + [at(climber, 60, top: true, onWall: true)]))
                .compactMap { ScoringSlide.make($0, context: context) }.first
            check(topped?.headline == "TOP" && topped?.subline == "\(climber.name) · new leader" && topped?.tier == .big,
                  "a top in a final", say(topped))
            var semiContext = context
            semiContext.final = false
            check(MatchRules.climbingMoments(from: before, to: ahead).allSatisfy { ScoringSlide.make($0, context: semiContext) == nil },
                  "nothing slides outside a final")
        } else {
            check(false, "the recorded lead route loads")
        }

        // MARK: Paint

        func contrast(_ p: SlidePaint) -> Double {
            func luminance(_ lab: OKLab) -> Double {
                let c = lab.rgb
                func linear(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
                return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b)
            }
            let slab = luminance(p.slab), ink = p.lightInk ? 1.0 : luminance(OKLab(l: 0.08, a: 0, b: 0))
            return (max(slab, ink) + 0.05) / (min(slab, ink) + 0.05)
        }
        let mil = SlidePaint.team("12284b", alternate: "ffc52f"), tb = SlidePaint.team("092c5c", alternate: "8fbce6")
        check(mil.lightInk && mil.stripe.distance(to: OKLab(hex: "ffc52f")!) < 0.02 && tb.lightInk && contrast(mil) >= 7,
              "the Brewers' navy takes white type and a gold stripe; the Rays' navy too",
              String(format: "%.1f:1", contrast(mil)))
        let newcastle = SlidePaint.team("000000", alternate: "0B1B3D"), spurs = SlidePaint.team("ffffff", alternate: "0B1426")
        let hull = SlidePaint.team("f28800", alternate: "ffffff"), red = SlidePaint.team("e20520", alternate: "003399")
        check(!hull.lightInk && red.lightInk && [mil, tb, newcastle, spurs, hull, red].allSatisfy { contrast($0) >= 4 },
              "white or black type, whichever reads (4:1 or better): orange takes black, red takes white",
              [mil, tb, newcastle, spurs, hull, red].map { String(format: "%.1f", contrast($0)) }.joined(separator: " "))
        check(newcastle.slab.l >= 0.25 && spurs.slab.l > 0.9 && !spurs.lightInk,
              "black lifts to charcoal (or its second color); white stays white with dark type",
              "\(newcastle.slab.l) \(spurs.slab.l)")
        check(SlidePaint.team("002a5c", alternate: nil).stripe.l > 0.9, "no second color: a white stripe on a dark slab")

        // MARK: The theater's climax (read from its script)

        let pierceScene = items.first { $0["id"].string?.hasSuffix("1152") == true }.flatMap { FootballScene.parse($0, teams: teams) }
        let touchdownAt = pierceScene.flatMap { ScoringSlide.climax(FootballScript($0)) }
        check(touchdownAt.map { $0 > 0.5 && $0 < (pierceScene.map { FootballScript($0).duration } ?? 0) } == true,
              String(format: "football: the slide lands as the ball crosses the goal line (%.2f s into the replay)", touchdownAt ?? -1))
        if let header = goals["54149975"], let i = header.2.firstIndex(where: { $0["id"].string == "54149975" }),
           let scene = SoccerScene.parse(header.2, at: i, homeTeamID: header.3, keepers: SoccerScene.keepers(in: header.2)) {
            let net = ScoringSlide.climax(SoccerScript(scene))
            check(net.map { $0 > 0.5 } == true, String(format: "soccer: as the ball hits the net (%.2f s)", net ?? -1))
        } else {
            check(false, "the header's scene parses")
        }
        if let i = g2.firstIndex(where: { $0["id"].string == "4019080430005990057" }),
           let scene = PlayScene.parse(g2, at: i, side: g2Side) {
            let fence = ScoringSlide.climax(PlayScript(scene, rest: PlayScript.Rest(bases: scene.basesAfter, bats: .left)))
            check(fence.map { $0 > 0.5 } == true, String(format: "baseball: as the home run clears the fence (%.2f s)", fence ?? -1))
        } else {
            check(false, "Hicks' home run parses")
        }
        let g3Names = (JSON(data: g3Data)["names"].raw as? [String: String]) ?? [:]
        if let i = g3.firstIndex(where: { $0["id"].string == "4019080440404990057" }),
           let scene = PlayScene.parse(g3, at: i, side: g3Side, names: g3Names) {
            let home = ScoringSlide.climax(PlayScript(scene, rest: PlayScript.Rest(bases: scene.basesAfter, bats: .left)))
            check(home.map { $0 > 0.5 } == true, String(format: "…and a run as it crosses the plate (%.2f s)", home ?? -1))
        } else {
            check(false, "Yelich's single parses")
        }

        // MARK: One celebration per moment

        check(!ScoringSlide.playsConfetti(tier: .top, granted: true, pageBursts: true, ownerVisible: true, claim: { true })
              && ScoringSlide.playsConfetti(tier: .top, granted: true, pageBursts: true, ownerVisible: false, claim: { false })
              && !ScoringSlide.playsConfetti(tier: .big, granted: true, pageBursts: true, ownerVisible: false, claim: { true }),
              "the page's burst plays where it's seen: in the theater or chart when it's on screen, else on the slide; never below the top tier")
        check(ScoringSlide.playsConfetti(tier: .top, granted: false, pageBursts: false, ownerVisible: true, claim: { true })
              && !ScoringSlide.playsConfetti(tier: .top, granted: false, pageBursts: false, ownerVisible: false, claim: { false })
              && !ScoringSlide.playsConfetti(tier: .top, granted: false, pageBursts: true, ownerVisible: false, claim: { true }),
              "a moment no chart bursts for (a match won) claims the cooldown; inside the cooldown, nobody bursts")
        let center = MomentCenter()
        var clock = ContinuousClock.now
        center.now = { clock }
        let firstClaim = center.claimBurst(), secondClaim = center.claimBurst()
        clock += .seconds(10)
        check(firstClaim && !secondClaim && center.claimBurst(), "a claimed burst counts against the page's one every 10 s")
        var beats = HeroBeats()
        beats.score(.top, decisive: true, glint: false, at: .now)
        check(beats.glints == 0 && !beats.final(winner: .top, bothSides: false, trophy: false, at: .now),
              "a decisive score the slide carries: no hero glint under it, and the final whistle still knows it was celebrated")

        // MARK: Motion

        let hold = 4.5
        let start = SlideMotion.pose(at: 0, hold: hold, reduceMotion: false), landed = SlideMotion.pose(at: 1.05, hold: hold, reduceMotion: false)
        let midSheen = SlideMotion.pose(at: 0.6, hold: hold, reduceMotion: false)
        let gone = SlideMotion.pose(at: SlideMotion.length(hold: hold), hold: hold, reduceMotion: false)
        check(start.slab == 1 && start.stripe == 1 && landed == SlidePose.home && midSheen.sheen > 0 && midSheen.sheen < 1 && gone.slab == 1,
              "the wipe: off at its edge, home (exactly) once landed, the sheen crossing after it lands, off the same way at the end",
              "\(landed)")
        let early = SlideMotion.pose(at: 0.15, hold: hold, reduceMotion: false)
        check(early.stripe < early.slab, "the stripe leads the slab in")
        let fadeIn = SlideMotion.pose(at: 0, hold: hold, reduceMotion: true), held = SlideMotion.pose(at: 2, hold: hold, reduceMotion: true)
        let fadeOut = SlideMotion.pose(at: SlideMotion.land + hold + 0.25, hold: hold, reduceMotion: true)
        check(fadeIn.opacity == 0 && fadeIn.slab == 0 && held.opacity == 1 && fadeOut.opacity == 0 && fadeOut.slab == 0,
              "Reduce Motion: a crossfade in place")

        // MARK: The line

        func slide(_ id: String, _ tier: ScoringSlide.Tier = .normal) -> ScoringSlide {
            ScoringSlide(id: id, side: .top, tier: tier, headline: "", subline: "", spoken: "",
                         moment: LiveMoment(id: id, chart: .plate, tier: .score, kind: .runScored, lead: "", detail: ""))
        }
        var line = SlideLine()
        line.offer([slide("a"), slide("b")], catchUp: false)
        line.offer([slide("a")], catchUp: false)
        check(line.waiting.map(\.id) == ["a", "b"] && line.next()?.id == "a" && line.next()?.id == "b" && line.next() == nil,
              "scores arriving together play in order, one at a time; the same play never twice")
        var catchUp = SlideLine()
        catchUp.offer([slide("1", .top), slide("2"), slide("3"), slide("4")], catchUp: true)
        var catchUpNormal = SlideLine()
        catchUpNormal.offer([slide("1"), slide("2"), slide("3"), slide("4")], catchUp: true)
        check(catchUp.waiting.map(\.id) == ["1"] && catchUpNormal.waiting.map(\.id) == ["4"] && catchUp.carries("3"),
              "a catch-up plays only its newest (its top tier first); the rest never slide later")
        var full = SlideLine()
        full.offer([slide("1"), slide("2", .top), slide("3"), slide("4"), slide("5")], catchUp: false)
        check(full.waiting.map(\.id) == ["2", "4", "5"], "at most three wait: the oldest normal slides give way", "\(full.waiting.map(\.id))")
        full.retract(["4"])
        check(full.waiting.map(\.id) == ["2", "5"], "a score taken back leaves the line")
    }
}
