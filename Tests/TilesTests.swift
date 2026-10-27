import Foundation

// Tiles: live snapshots decoded from recorded scoreboards and IFSC results,
// the board's tiers, the large/small plan, grid placement and keyboard
// navigation, checked without views. Fixtures: Tests/Fixtures/tiles (recorded
// 25 Oct 2026) and the IFSC boulder final already in Tests/Fixtures.

extension ScorelineTests {
    static func tiles() {
        print("\nTiles")
        tileFootball()
        tileSoccer()
        tileClimbing()
        tileCounterStrike()
        tileBoard()
        tilePlan()
        tileGrid()
        tileNavigator()
    }

    private static func fixture(_ name: String) -> Data {
        (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/\(name)"))) ?? Data()
    }

    private static func json(_ name: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: fixture(name)) as? [String: Any]) ?? [:]
    }

    /// A recorded scoreboard through the app's parser, with chosen games edited first.
    private static func scoreboard(_ name: String, path: String, sport: Sport,
                                   edit: (inout [String: Any]) -> Void = { _ in }) -> [Event] {
        var board = json(name)
        var events = board["events"] as? [[String: Any]] ?? []
        for i in events.indices { edit(&events[i]) }
        board["events"] = events
        guard let data = try? JSONSerialization.data(withJSONObject: board) else { return [] }
        return (try? Providers.espnEvents(scoreboard: data, path: path, sport: sport)) ?? []
    }

    private static func setLive(_ e: inout [String: Any], detail: String, clock: Double, period: Int) {
        e["status"] = ["clock": clock, "period": period, "type": ["state": "in", "completed": false, "shortDetail": detail]]
    }

    // MARK: Football: the scoreboard situation as a field position

    private static func tileFootball() {
        let events = scoreboard("tiles/nfl_sb.json", path: "football/nfl", sport: .football)
        func spot(_ id: String) -> FootballSpot? {
            guard case let .football(s)? = events.first(where: { $0.id == "espn-\(id)" })?.snapshot else { return nil }
            return s
        }
        // SF at ATL, yardLine 74, ATL ball: "3rd & 2 at SF 26".
        let sf = spot("401873017")
        check(sf?.ballX == 26 && sf?.possession == .bottom && sf?.attacksLeft == true && sf?.lineToGainX == 24,
              "SF at ATL: ball at 26 from the left goal line, ATL attacking left, line to gain 24", "\(String(describing: sf))")
        // IND at MIN, yardLine 95, MIN ball: "1st & Goal at IND 5".
        let ind = spot("401873014")
        check(ind?.ballX == 5 && ind?.redZone == true && ind?.goalToGo == true && ind?.lineToGainX == nil,
              "IND at MIN: ball at 5, red zone, goal to go (no line to gain)", "\(String(describing: ind))")
        // CLE at TEN, yardLine 25, TEN ball: "3rd & 10 at TEN 25".
        let cle = spot("401873013")
        check(cle?.ballX == 75 && cle?.possession == .bottom && cle?.lineToGainX == 65, "CLE at TEN: ball at 75, line to gain 65",
              "\(String(describing: cle))")
        check(events.filter { $0.state != .live }.allSatisfy { $0.snapshot == nil }, "snapshots only on live games")
        check(events.first { $0.id == "espn-401873017" }?.liveLine == "3rd & 2 at SF 26", "the row's live line is unchanged")

        // The match page's field and the tile agree on the same situation.
        let teams = FootballFeed.Teams(topIsHome: false, topID: "25", bottomID: "1", homeAbbreviation: "ATL", awayAbbreviation: "SF")
        let page = FootballFeed.situation(JSON(["yardLine": 74, "down": 3, "distance": 2, "isRedZone": false]),
                                          possessionTeam: "1", teams: teams, lastPlay: nil)
        let tile = FootballGeometry.spot(yardLine: 74, down: 3, distance: 2, possession: .bottom, topIsHome: false, redZone: false)
        check(page?.ballX == tile.ballX && page?.lineToGainX == tile.lineToGainX && page?.possession == tile.possession,
              "FootballGeometry agrees with the match page's FootballFeed")
        let goalPage = FootballFeed.situation(JSON(["yardLine": 95, "down": 1, "distance": 5, "isRedZone": true]),
                                              possessionTeam: "16",
                                              teams: .init(topIsHome: false, topID: "11", bottomID: "16", homeAbbreviation: "MIN",
                                                           awayAbbreviation: "IND"), lastPlay: nil)
        check(goalPage?.downDistance == "1st & Goal at IND 5" && goalPage?.ballX == 5,
              "goal to go: both read 1st & Goal at the 5 (the tile hides the marker at the goal line)")
    }

    // MARK: Soccer: goals and red cards in lanes

    private static func tileSoccer() {
        check(MatchMark.minute(from: "45'+2'") == 47 && MatchMark.minute(from: "64'") == 64 && MatchMark.minute(from: "90'+3'") == 93,
              "match minutes include stoppage")
        // Real Sociedad 2–1 Levante, recorded live at 75'.
        let esp = scoreboard("tiles/esp_sb.json", path: "soccer/esp.1", sport: .soccer) { e in
            // Athletic 4–0 Getafe (with a red card) replayed as live.
            if e["id"] as? String == "401882835" { setLive(&e, detail: "89'", clock: 5340, period: 2) }
        }
        func marks(_ events: [Event], _ id: String) -> [MatchMark] {
            guard case let .soccer(m)? = events.first(where: { $0.id == "espn-\(id)" })?.snapshot else { return [] }
            return m
        }
        let rso = marks(esp, "401882829")
        check(rso.map(\.minute) == [6, 22, 27] && rso.map(\.side) == [.top, .bottom, .top],
              "RSO–LEV: goals at 6', 22', 27', home (top) lane, away, home", "\(rso.map(\.minute)) \(rso.map(\.side))")
        check(MatchMark.lastGoalLine(rso) == "Turrientes 27'", "detail line: the latest goal by surname")
        let ath = marks(esp, "401882835")
        check(ath.filter { $0.kind == .redCard }.map(\.side) == [.bottom] && ath.filter(\.isGoal).count == 4
              && ath.filter(\.isGoal).allSatisfy { $0.side == .top }, "ATH–GET: four home goals, Getafe's red card in its lane")
        check(esp.first { $0.id == "espn-401882833" }?.snapshot == nil, "a finished match has no snapshot")

        // Liverpool 2–0 Brighton: Gross's own goal is credited to Liverpool's lane.
        let eng = scoreboard("tiles/eng_sb.json", path: "soccer/eng.1", sport: .soccer) { e in
            if e["id"] as? String == "401878765" { setLive(&e, detail: "80'", clock: 4800, period: 2) }
        }
        let liv = marks(eng, "401878765")
        check(liv.first { $0.kind == .ownGoal }?.side == .top && liv.filter(\.isGoal).allSatisfy { $0.side == .top },
              "own goal placed so the lanes match the score (2–0)")
        check(MatchMark.lastGoalLine([MatchMark(minute: 17, side: .top, kind: .ownGoal, player: "P. Gross", clock: "17'")])
              == "Gross 17' (OG)", "own goals say so")
        // Ambiguous: two own goals, one each way, and the source has both on one side.
        let mixed = [MatchMark(minute: 10, side: .top, kind: .ownGoal, player: nil, clock: "10'"),
                     MatchMark(minute: 20, side: .top, kind: .ownGoal, player: nil, clock: "20'")]
        check(MatchMark.reconcile(mixed, topScore: 1, bottomScore: 1).allSatisfy { $0.side == nil },
              "own goals the scores can't place go on the track, not in a guessed lane")
        check(MatchMark.reconcile(mixed, topScore: 0, bottomScore: 2).allSatisfy { $0.side == .bottom },
              "own goals that all belong to one side go there")
    }

    // MARK: Climbing: who's on the wall

    private static func tileClimbing() {
        // Keqiao lead final, recorded live: Hamada on the wall.
        let live = WallState.from(results: JSON(json("tiles/ifsc-11361.json")))
        if case let .lead(climber, leader, route)? = live?.phase {
            check(climber.athlete.name == "R. Hamada" && climber.athlete.country == "JPN" && !climber.top,
                  "lead: the climber on the wall, with country", climber.athlete.name)
            check(leader?.athlete.name == "S. Yoshida" && leader?.label == "41+" && leader?.height == 41.5,
                  "lead: the route's leader and high point (41+ = 41.5)", "\(String(describing: leader))")
            check(route == nil, "one route: no route label")
        } else {
            check(false, "lead: someone on the wall", "\(String(describing: live))")
        }
        check(WallState.domain(height: 7, leader: 41.5) == 50 && WallState.domain(height: 2, leader: nil) == 10,
              "height bar domain: next ten above the higher of the two, at least 10")
        // Nobody on the wall: who climbs next, from the starting order.
        var between = json("tiles/ifsc-11361.json")
        var ranking = between["ranking"] as? [[String: Any]] ?? []
        for i in ranking.indices {
            ranking[i]["active"] = false
            var ascents = ranking[i]["ascents"] as? [[String: Any]] ?? []
            for j in ascents.indices where ascents[j]["status"] as? String == "active" { ascents[j]["status"] = "pending" }
            ranking[i]["ascents"] = ascents
        }
        between["ranking"] = ranking
        if case let .upNext(athlete)? = WallState.from(results: JSON(between))?.phase {
            check(athlete.name == "R. Hamada" && athlete.country == "JPN", "between climbers: up next, with country", athlete.name)
        } else {
            check(false, "between climbers: up next")
        }
        // Bern boulder final (finished): nobody's on a boulder; one set on problem 4.
        var bern = json("1c6e897b5a6c2cf06630b43e.bin")
        check(WallState.from(results: JSON(bern)) == nil, "a finished boulder round: nothing on the wall")
        var athletes = bern["ranking"] as? [[String: Any]] ?? []
        if athletes.count > 2 {
            athletes[2]["active"] = true
            var ascents = athletes[2]["ascents"] as? [[String: Any]] ?? []
            if ascents.count > 3 { ascents[3]["status"] = "active" }
            athletes[2]["ascents"] = ascents
            bern["ranking"] = athletes
        }
        if case let .boulder(_, cells, active)? = WallState.from(results: JSON(bern))?.phase {
            check(cells.count == 4 && active == 3, "boulder: the athlete's four problems, the active one marked", "\(cells) \(String(describing: active))")
        } else {
            check(false, "boulder: the athlete on the wall")
        }
    }

    // MARK: CS2: the race to 13

    private static func tileCounterStrike() {
        func live(_ t: Int, _ b: Int, round: Int? = nil) -> GameDetail.CSLive {
            GameDetail.CSLive(mapName: "Mirage", mapNumber: 1, round: round, topScore: t, bottomScore: b, topSide: nil,
                              bottomSide: nil, mapEnded: false)
        }
        check(RaceStrip.race(live(9, 7, round: 17)) == .init(cells: 13, top: 9, bottom: 7, label: "Round 17"), "regulation: 13 cells a side")
        check(RaceStrip.race(live(13, 11)).cells == 13, "a regulation win stays a race to 13")
        check(RaceStrip.race(live(12, 12)) == .init(cells: 4, top: 0, bottom: 0, label: "Overtime"), "12–12: overtime, race to 4")
        check(RaceStrip.race(live(15, 14)) == .init(cells: 4, top: 3, bottom: 2, label: "Overtime"), "first overtime block")
        check(RaceStrip.race(live(18, 17)) == .init(cells: 4, top: 3, bottom: 2, label: "Overtime 2"), "second overtime block")
    }

    // MARK: Board: tiers and order

    private static func event(_ id: String, _ state: EventState, start: TimeInterval = 0, teams: (String, String) = ("a", "b"),
                              score: Bool = true) -> Event {
        let s = state == .scheduled || !score ? nil : "1"
        return Event(id: id, content: .match(top: comp(teams.0, teams.0, s), bottom: comp(teams.1, teams.1, s)), state: state,
                     start: Date(timeIntervalSince1970: 1_800_000_000 + start), detail: nil, caption: nil, link: nil)
    }

    private static func tileBoard() {
        // Two leagues in the user's order (nfl, then eng.1), plus My Teams.
        let mine = event("m-final", .final, start: -3600, teams: ("me", "x"))
        let sections = [
            ScoreStore.Section(id: "my-teams", title: "My Teams", symbol: "star.fill", events: [event("m-live", .live, teams: ("me", "y")), mine],
                               failed: false),
            ScoreStore.Section(id: "nfl", title: "NFL", symbol: "", events: [
                event("n-live", .live, start: 100), event("n-pinned", .live, start: 200), event("n-next", .scheduled, start: 7200),
                event("n-final", .final, start: -7200)], failed: false),
            ScoreStore.Section(id: "eng.1", title: "Premier League", symbol: "", events: [
                event("e-live", .live, start: 50), event("e-next", .scheduled, start: 3600), event("e-final", .final, start: -100),
                event("n-final", .final, start: -7200)], failed: false),
        ]
        let leagues = ["m-live": "nfl", "m-final": "eng.1", "n-live": "nfl", "n-pinned": "nfl", "n-next": "nfl", "n-final": "nfl",
                       "e-live": "eng.1", "e-next": "eng.1", "e-final": "eng.1"]
        let board = ScoreStore.board(from: sections, leagueOf: { leagues[$0] }, enabledIDs: ["nfl", "eng.1"],
                                     isFollowed: { $0.competitors.contains { $0.id == "me" } }, pinnedID: "n-pinned")
        check(board.tiers.map(\.kind) == [.live, .mine, .next, .final], "tiers in order: live, your teams, up next, final")
        check(board.tiers[0].events.map(\.id) == ["m-live", "n-pinned", "n-live", "e-live"],
              "live: followed, then pinned, then league order, then start", "\(board.tiers[0].events.map(\.id))")
        check(board.tiers[1].events.map(\.id) == ["m-final"], "your teams: a followed team's game that isn't live")
        check(board.tiers[2].events.map(\.id) == ["e-next", "n-next"], "up next: soonest first, across leagues")
        check(board.tiers[3].events.map(\.id) == ["e-final", "n-final"], "final: newest first")
        let listed = Set(sections.flatMap(\.events).map(\.id))
        check(Set(board.events.map(\.id)) == listed && board.events.count == listed.count,
              "parity: exactly the list's games, each once")
        check(board.league["e-next"]?.id == "eng.1" && League.with(id: "eng.1")?.shortName == "EPL"
              && League.with(id: "nfl")?.shortName == "NFL", "league labels from the source, short names for small tiles")
        check(!board.signature.isEmpty && board.signature.first == "m-live|live", "signature: game and tier, width-free")

        var snap = event("x", .live)
        snap.snapshot = .basketball(lastPlay: "Dunk")
        check(snap.with(detail: .some("Q4")).snapshot != nil && snap.with(state: .final).snapshot == nil,
              "a snapshot travels with a live game and is dropped when it ends")
    }

    // MARK: Plan: which tiles are large

    private static func tilePlan() {
        let compact = PanelLayout(), large = PanelLayout.resolve(width: 500, from: PanelLayout())
        let split = PanelLayout.resolve(width: 700, from: PanelLayout())
        check(TileMetrics.smallColumns(compact) == 2 && TileMetrics.smallColumns(large) == 3 && TileMetrics.smallColumns(split) == 4
              && TileMetrics.largeColumns(compact) == 1 && TileMetrics.largeColumns(split) == 2,
              "columns: small 2 / 3 / 4, large 1 / 2 (from the panel layout, not a width)")

        let lives = (0..<7).map { event("l\($0)", .live) }
        let board = ScoreStore.Board(tiers: [.init(kind: .live, events: lives), .init(kind: .final, events: [event("f", .final)])])
        let one = TilePlanner.plan(board, layout: compact)
        check(one[0].tiles.filter { $0.size == .large }.map(\.event.id) == ["l0", "l1", "l2", "l3"] && one[0].tiles.count == 7,
              "one large column: the first 4 live games are large, the rest small in the same tier")
        check(one[1].tiles.allSatisfy { $0.size == .small }, "finals are small")
        let two = TilePlanner.plan(board, layout: split)
        check(two[0].largeCount == 6 && !two[0].heroFirst, "two large columns: 6 large, even (no hero)")
        let five = TilePlanner.plan(ScoreStore.Board(tiers: [.init(kind: .live, events: Array(lives.prefix(5)))]), layout: split)
        check(five[0].largeCount == 5 && five[0].heroFirst, "an odd count in two columns: the first spans the row")

        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let soon = ScoreStore.Board(tiers: [.init(kind: .mine, events: [event("mf", .final, start: -100)]),
                                            .init(kind: .next, events: [event("n1", .scheduled, start: 3600), event("n2", .scheduled, start: 7200)])])
        let nextUp = TilePlanner.plan(soon, layout: compact, now: now)
        check(nextUp[1].tiles.map(\.size) == [.large, .small] && nextUp[0].tiles.map(\.size) == [.small],
              "nothing live: the soonest game within 24h is large")
        let followed = ScoreStore.Board(tiers: [.init(kind: .mine, events: [event("ms", .scheduled, start: 20 * 3600)]),
                                                .init(kind: .next, events: [event("n1", .scheduled, start: 3600)])])
        check(TilePlanner.plan(followed, layout: compact, now: now)[0].tiles.first?.size == .large
              && TilePlanner.plan(followed, layout: compact, now: now)[1].tiles.first?.size == .small,
              "a followed team's next game is preferred")
        let far = ScoreStore.Board(tiers: [.init(kind: .next, events: [event("n1", .scheduled, start: 30 * 3600)])])
        check(TilePlanner.plan(far, layout: compact, now: now)[0].tiles.first?.size == .small, "nothing within 24h: no large tile")
        let withLive = ScoreStore.Board(tiers: [.init(kind: .live, events: [lives[0]]), .init(kind: .next, events: [event("n1", .scheduled, start: 60)])])
        check(TilePlanner.plan(withLive, layout: compact, now: now)[1].tiles.first?.size == .small, "something live: no next-up tile")
    }

    // MARK: Grid placement

    private static func tileGrid() {
        func noOverlap(_ frames: [CGRect]) -> Bool {
            for (i, a) in frames.enumerated() { for b in frames.dropFirst(i + 1) where a.intersects(b) && !a.intersection(b).isEmpty { return false } }
            return true
        }
        let sizes: [TileSize] = [.large, .large, .small, .small, .small]
        // 340 panel: 320 wide, 1 large column, 2 small.
        let compact = TileGrid.frames(sizes: sizes, width: 320, largeColumns: 1, smallColumns: 2)
        check(compact.frames[0] == CGRect(x: 0, y: 0, width: 320, height: 144) && compact.frames[1].minY == 152
              && compact.frames[2] == CGRect(x: 0, y: 304, width: 156, height: 84) && compact.frames[3].minX == 164
              && compact.frames[4].minY == 396 && compact.height == 480,
              "compact: large tiles full width, small tiles two up, last row left-aligned", "\(compact)")
        // 488 panel: 468 wide, 3 small columns of 150.7.
        let large = TileGrid.frames(sizes: [.small, .small, .small, .small], width: 468, largeColumns: 1, smallColumns: 3)
        check(abs(large.frames[0].width - 150.67) < 0.01 && large.frames[3].minY == 92 && large.frames[3].minX == 0,
              "three columns at the narrowest large panel (150.7pt tiles)")
        // Split (700 panel): 680 wide, odd large count → the first spans.
        let split = TileGrid.frames(sizes: [.large, .large, .large, .small, .small, .small, .small, .small], width: 680,
                                    largeColumns: 2, smallColumns: 4)
        check(split.frames[0].width == 680 && split.frames[1].width == 336 && split.frames[2].minX == 344
              && split.frames[1].minY == 152, "split: hero spans, then two large columns")
        check(split.frames[3].minY == 304 && abs(split.frames[3].width - 164) < 0.01 && split.frames[7].minY == 396,
              "split: small band below, four columns")
        check(noOverlap(compact.frames) && noOverlap(large.frames) && noOverlap(split.frames), "no tiles overlap")
        let mixed = TileGrid.frames(sizes: [.small, .large], width: 320, largeColumns: 1, smallColumns: 2)
        check(mixed.frames[1].minY == 0 && mixed.frames[0].minY == 152, "the large band comes first whatever the child order")
    }

    // MARK: Keyboard

    private static func tileNavigator() {
        func tier(_ kind: ScoreStore.Board.Tier.Kind, large: Int, small: Int, prefix: String) -> TierPlan {
            let tiles = (0..<large).map { TierPlan.Tile(event: event("\(prefix)L\($0)", .live), size: .large) }
                + (0..<small).map { TierPlan.Tile(event: event("\(prefix)S\($0)", .final), size: .small) }
            return TierPlan(tier: .init(kind: kind, events: tiles.map(\.event)), tiles: tiles, heroFirst: false)
        }
        let plans = [tier(.live, large: 1, small: 3, prefix: "a"), tier(.final, large: 0, small: 2, prefix: "b")]
        let nav = TileNavigator(plans: plans, collapsed: [], largeColumns: 1, smallColumns: 2)
        check(nav.move(from: "aL0", .down) == "aS0", "↓ from a full-width tile lands on the left tile below")
        check(nav.move(from: "aS1", .up) == "aL0", "↑ from the right small tile goes back to the large one")
        check(nav.move(from: "aS1", .down) == "aS2", "↓ to the nearest tile in the next row (a lone left tile)")
        check(nav.move(from: "aS2", .down) == "bS0", "↓ crosses into the next tier")
        check(nav.move(from: "aS1", .right) == "aS2" && nav.move(from: "aS2", .left) == "aS1", "←/→ wrap across rows")
        check(nav.move(from: nil, .down) == "aL0" && nav.move(from: nil, .up) == "bS1", "no highlight: ↓ first, ↑ last")
        check(nav.move(from: "bS1", .down) == "bS1" && nav.move(from: "bS1", .right) == "bS1", "the ends hold")
        let skipped = TileNavigator(plans: plans, collapsed: ["tiles.live"], largeColumns: 1, smallColumns: 2)
        check(skipped.cells.map(\.id) == ["bS0", "bS1"], "collapsed tiers are skipped")
        let three = TileNavigator(plans: [tier(.live, large: 0, small: 6, prefix: "c")], collapsed: [], largeColumns: 1, smallColumns: 3)
        check(three.move(from: "cS1", .down) == "cS4" && three.move(from: "cS2", .down) == "cS5", "three columns: ↓ keeps the column")
        let four = TileNavigator(plans: [tier(.live, large: 2, small: 4, prefix: "d")], collapsed: [], largeColumns: 2, smallColumns: 4)
        check(four.move(from: "dL1", .down) == "dS2" && four.move(from: "dS1", .up) == "dL0",
              "two large over four small: ↓/↑ by nearest center (ties go left)")
    }
}
