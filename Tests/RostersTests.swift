import Foundation

// Team and player pages: the ESPN, bo3.gg and IFSC parsers over samples
// recorded on 25 Oct 2026 (decoded directly, so FixtureProtocol's key rules
// and unrecorded-URL 404s don't apply), roster grouping, display rules, and
// the cache's TTL, ETag, stale-on-failure and coalescing behaviour through a
// stub URLProtocol (FixtureProtocol replays carry no headers).

extension ScorelineTests {
    static func rosters() async {
        print("\nRosters and profiles")
        func fixture(_ name: String) -> Data {
            (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/rosters/\(name).json"))) ?? Data()
        }

        // MARK: ESPN teams

        let lakers = Profile.TeamRef(id: "espn-basketball-13", name: "Lakers", league: "nba")
        check(lakers.source == .espn(sport: .basketball, path: "basketball/nba", team: "13"), "NBA team ID resolves to its ESPN path")
        check(Profile.TeamRef(id: "espn-basketball-14", name: "Sparks", league: "wnba").isSupported == false,
              "WNBA teams get no page (untouched)")
        check(Profile.TeamRef(id: "espn-ncaaf-130", name: "Michigan").source
              == .espn(sport: .football, path: "football/college-football", team: "130"), "college IDs map to college football")
        check(Profile.TeamRef(id: "espn-soccer-359", name: "Arsenal", league: "uefa.champions").source
              == .espn(sport: .soccer, path: nil, team: "359"), "a soccer team seen in the Champions League needs its league looked up")

        let header = ESPNProfiles.header(fixture("espn_nba_team_13"), sport: .basketball, path: "basketball/nba", teamID: "13")
        check(header?.record == "3-0" && header?.standing == "1st in Pacific Division", "Lakers record and standing",
              "\(header?.record ?? "-") \(header?.standing ?? "-")")
        check(header?.venue == "crypto.com Arena" && header?.color == "552583" && header?.alternateColor == "fdb927",
              "venue and colors from the team")
        check(header?.next?.opponent?.abbreviation == "POR" && header?.next?.home == true, "next game: Portland at home",
              "\(header?.next?.opponent?.abbreviation ?? "-")")

        let nbaRoster = ESPNProfiles.roster(fixture("espn_nba_roster_13"), sport: .basketball, path: "basketball/nba", team: lakers)
        check(nbaRoster.players.count == 18 && nbaRoster.coach == "JJ Redick", "18 players, coach JJ Redick")
        check(Set(nbaRoster.players.filter { $0.injury == "Out" }.map(\.ref.name)) == ["Cameron Carr", "Adou Thiero"],
              "injury status from the roster")
        check(nbaRoster.players.first?.ref.photo?.absoluteString.contains("combiner/i?img=/i/headshots/nba/players/full/") == true
              && nbaRoster.players.first?.ref.photo?.absoluteString.contains("w=96&h=70") == true, "photos use the resized 96×70 copy")

        let depth = ESPNProfiles.coreDepth(fixture("espn_nba_depth_13_core"))
        let leaders = ESPNProfiles.leaders(fixture("espn_nba_team_13_leaders_core"))
        let nbaGroups = ESPNProfiles.groups(sport: .basketball, college: false, players: nbaRoster.players, leaders: leaders, depth: depth)
        check(nbaGroups.first?.kind == .starters
              && nbaGroups.first?.players.map(\.ref.id) == ["3945274", "4066457", "4433137", "3907498", "4433136"],
              "starting five from the depth chart, without reusing Reaves at PG", "\(nbaGroups.first?.players.map(\.ref.name) ?? [])")
        check(nbaGroups.last?.kind == .out && nbaGroups.last?.players.count == 2, "Out is its own group")
        let doncic = nbaGroups.first?.players.first
        check(doncic?.stats["PTS"] == "25.5" && doncic?.stats["REB"] == "7.0" && doncic?.stats["AST"] == "7.0",
              "roster columns filled from the team leaders", "\(doncic?.stats ?? [:])")
        let teamLeaders = ESPNProfiles.teamLeaders(sport: .basketball, leaders: leaders, roster: nbaRoster.players)
        check(teamLeaders.map(\.label) == ["PTS", "REB", "AST", "BLK"] && teamLeaders[1].player.name == "Walker Kessler"
              && teamLeaders[2].value == "7.5", "leaders: Kessler 8.5 REB, Reaves 7.5 AST", "\(teamLeaders.map { "\($0.player.name) \($0.value)" })")

        let nbaStats = ESPNProfiles.teamStats(fixture("espn_nba_team_13_stats_core"), sport: .basketball)
        check(nbaStats.first?.value == "57.5" && nbaStats.first?.rank == 1 && nbaStats.first?.rankText == "1st",
              "FG% 57.5 ranks 1st")
        check(nbaStats.first { $0.label == "3-point %" }?.rankText == "T-1st", "Tied-1st becomes T-1st")

        let kc = Profile.TeamRef(id: "espn-football-12", name: "Chiefs", league: "nfl")
        let nflRoster = ESPNProfiles.roster(fixture("espn_nfl_roster_12"), sport: .football, path: "football/nfl", team: kc)
        let nflGroups = ESPNProfiles.groups(sport: .football, college: false, players: nflRoster.players, leaders: [:], depth: [:])
        check(nflGroups.map(\.players.count) == [27, 27, 3, 9, 11] && nflRoster.coach == "Andy Reid",
              "NFL units: offense 27, defense 27, special teams 3, IR 9, practice squad 11", "\(nflGroups.map(\.players.count))")
        check(nflGroups.first?.players.first?.position == "QB", "offense starts with the quarterbacks")
        check(nflRoster.players.contains { $0.injury == "Injured Reserve" }, "IR status comes from injuries, not status.type")

        let chart = ESPNProfiles.depthChart(fixture("espn_nfl_depth_12"))
        check(chart?.units.map(\.name) == ["3WR 1TE", "Base 4-3 D", "Special Teams"], "depth chart units reordered: offense first",
              "\(chart?.units.map(\.name) ?? [])")
        check(chart?.units.first?.slots.first?.players.map(\.name) == ["Patrick Mahomes", "Justin Fields", "Garrett Nussmeier"],
              "QB depth: Mahomes, Fields, Nussmeier")
        let nflIDs = Set(nflRoster.players.map(\.ref.id))
        check(chart?.units.flatMap(\.slots).flatMap(\.players).allSatisfy { nflIDs.contains($0.id) } == true,
              "every depth-chart player resolves in the roster")
        check(ESPNProfiles.depthURL(path: "football/college-football", team: "130") == nil
              && JSON(data: fixture("espn_cfb_depth_130_core_400"))["error"]["code"].int == 400, "college has no depth chart (ESPN: 400)")

        let nflStats = ESPNProfiles.teamStats(fixture("espn_nfl_team_12_stats_core"), sport: .football)
        check(!nflStats.isEmpty && nflStats.allSatisfy { ($0.rank ?? 1) <= 32 }, "NFL ranks past 32 teams are dropped")

        let michigan = Profile.TeamRef(id: "espn-ncaaf-130", name: "Michigan", league: "college-football")
        let cfb = ESPNProfiles.roster(fixture("espn_cfb_roster_130"), sport: .football, path: "football/college-football", team: michigan)
        let cfbGroups = ESPNProfiles.groups(sport: .football, college: true, players: cfb.players, leaders: [:], depth: [:])
        check(cfbGroups.map(\.players.count) == [45, 46, 9], "college units 45 / 46 / 9", "\(cfbGroups.map(\.players.count))")
        check(cfb.players.allSatisfy { $0.age == nil } && cfb.players.contains { $0.detail == "Sophomore" },
              "college: class years, no ages")

        let dodgers = Profile.TeamRef(id: "espn-baseball-19", name: "Dodgers", league: "mlb")
        let mlb = ESPNProfiles.roster(fixture("espn_mlb_roster_19"), sport: .baseball, path: "baseball/mlb", team: dodgers)
        let mlbDepth = ESPNProfiles.coreDepth(fixture("espn_mlb_depth_19_core"))
        let mlbGroups = ESPNProfiles.groups(sport: .baseball, college: false, players: mlb.players, leaders: [:], depth: mlbDepth)
        check(mlbGroups.first?.kind == .rotation && mlbGroups.map(\.kind).contains(.bullpen)
              && mlbGroups.map(\.players.count).reduce(0, +) == 28, "MLB: rotation, bullpen, then position groups (28)",
              "\(mlbGroups.map { "\($0.kind) \($0.players.count)" })")
        let rotationOrder = mlbDepth["p"] ?? []
        let rotation = mlbGroups.first?.players.map(\.ref.id) ?? []
        check(rotation == rotation.sorted { (rotationOrder.firstIndex(of: $0) ?? 99) < (rotationOrder.firstIndex(of: $1) ?? 99) },
              "the rotation follows the depth chart")

        let arsenalHeader = ESPNProfiles.header(fixture("espn_soc_team_all_359"), sport: .soccer, path: nil, teamID: "359")
        check(arsenalHeader?.leagueSlug == "eng.1" && arsenalHeader?.record == "7-0-1"
              && arsenalHeader?.standing == "2nd in Premier League", "Arsenal: league eng.1, 7-0-1, \"2nd in Premier League\" (nationality trimmed)")
        let arsenal = Profile.TeamRef(id: "espn-soccer-359", name: "Arsenal", league: "eng.1")
        let squad = ESPNProfiles.roster(fixture("espn_soc_roster_eng1_359"), sport: .soccer, path: "soccer/eng.1", team: arsenal)
        let squadGroups = ESPNProfiles.groups(sport: .soccer, college: false, players: squad.players, leaders: [:], depth: [:])
        check(squadGroups.map(\.players.count) == [3, 10, 9, 7], "squad: GK 3, DEF 10, MID 9, FWD 7", "\(squadGroups.map(\.players.count))")
        let saka = squad.players.first { $0.ref.name == "Bukayo Saka" }
        check(saka?.stats["appearances"] == "7" && saka?.stats["totalGoals"] == "3", "Saka: 7 apps, 3 goals (inline stats)")
        check(squad.coach == nil, "soccer's roster coach (a list of past managers) is never shown")
        check(squad.players.filter { $0.ref.photo != nil }.count == 2, "only listed soccer headshots are requested (2 of 29)")

        // MARK: ESPN athletes

        func startsTile(_ value: String) -> Profile.StatTile? {
            let json = #"{"athlete":{"id":"1","displayName":"A B","statsSummary":{"statistics":[{"abbreviation":"START (SUB)","displayValue":"\#(value)"}]}}}"#
            return ESPNProfiles.athlete(Data(json.utf8), path: "soccer/eng.1")?.tiles.first
        }
        check(startsTile("7 (0)") == Profile.StatTile(label: "STARTS", value: "7", rank: nil)
              && startsTile("5 (2)") == Profile.StatTile(label: "STARTS", value: "5", rank: "+2 off the bench"),
              "soccer's \"7 (0)\" reads STARTS 7; subs said in words below")

        let mahomes = ESPNProfiles.athlete(fixture("espn_ath_nfl_3139477"), path: "football/nfl")
        check(mahomes?.tiles.map(\.label) == ["YDS", "TD", "INT", "QBR"]
              && mahomes?.tiles.map { $0.rank ?? "-" } == ["17th", "T-13th", "T-13th", "8th"], "Mahomes tiles with league ranks",
              "\(mahomes?.tiles.map { "\($0.label) \($0.value) \($0.rank ?? "-")" } ?? [])")
        check(mahomes?.bio.draft == "2017 · Round 1, Pick 10 · KC" && mahomes?.bio.team?.id == "espn-football-12",
              "draft reformatted; team resolved", mahomes?.bio.draft ?? "-")
        let jones = ESPNProfiles.athlete(fixture("espn_ath_nfl_3044859_dt"), path: "football/nfl")
        check(jones?.tiles.first?.rank == nil, "a 373rd-place rank isn't shown")
        let rice = ESPNProfiles.athlete(fixture("espn_ath_nfl_4428331_injured"), path: "football/nfl")
        check(rice?.injury?.status == "Out" && rice?.injury?.detail == "Hamstring" && rice?.injury?.returnDate != nil,
              "injury note: Out, hamstring, with a return date", "\(rice?.injury.map { "\($0.status) \($0.detail ?? "-")" } ?? "-")")

        let mahomesLog = ESPNProfiles.gamelog(fixture("espn_ath_nfl_3139477_gamelog"), path: "football/nfl", position: "QB")
        check(mahomesLog?.entries.compactMap { $0.stats["passingYards"] } == ["184", "382", "246", "225", "272", "165"],
              "game log in date order (the payload's isn't)", "\(mahomesLog?.entries.compactMap { $0.stats["passingYards"] } ?? [])")
        check(mahomesLog?.stripKey == "passingYards", "QB strip: passing yards")
        if let last = mahomesLog?.entries.last {
            var pacific = Calendar(identifier: .gregorian)
            pacific.timeZone = TimeZone(identifier: "America/Los_Angeles")!
            check(pacific.component(.day, from: last.date) == 25 && last.opponent?.abbreviation == "SEA"
                  && last.result == "L" && last.teamScore == "3" && last.opponentScore == "20",
                  "Sunday's game at SEA: L 3–20, Oct 25 in Pacific time (UTC says the 26th)")
        } else { check(false, "Mahomes game log") }

        let kicker = ESPNProfiles.gamelog(fixture("espn_ath_nfl_3055899_k_gamelog"), path: "football/nfl", position: "PK")
        check(kicker?.columns.first?.label == "1-19" && kicker?.stripKey == "totalKickingPoints", "kicker labels lose their tabs")

        let lebronLog = ESPNProfiles.gamelog(fixture("espn_ath_nba_1966_gamelog"), path: "basketball/nba", position: "F")
        let lebron = ESPNProfiles.athlete(fixture("espn_ath_nba_1966"), path: "basketball/nba")
        check(lebronLog?.entries.count == 3 && lebronLog?.entries.map { $0.stats["points"] ?? "" } == ["14", "17", "18"],
              "LeBron: 3 regular-season games, preseason excluded")
        check(lebron?.tiles.first?.value == "15.5", "averages lag the log (15.5 over 2 games)")
        var bio = lebron?.bio ?? Profile.Bio(name: "")
        ESPNProfiles.coreAthlete(fixture("espn_ath_nba_1966_core"), into: &bio)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        check(bio.birthDate.map { utc.dateComponents([.year, .month, .day], from: $0) }
              == DateComponents(year: 1984, month: 12, day: 30), "birth date from the core athlete (not the day-first display)")
        let overview = ESPNProfiles.overview(fixture("espn_ath_nba_1966_overview"), sport: .basketball)
        check(overview.season?.rows.map(\.title) == ["Regular Season", "Career"] && overview.note?.published != nil
              && overview.awards.contains("4× Finals MVP"), "overview: season and career lines, RotoWire date, awards",
              "\(overview.awards.prefix(3))")
        let career = ESPNProfiles.career(fixture("espn_ath_nba_1966_stats"))
        check(career?.rows.count == 24 && career?.rows.first?.title == "2026-27 · PHI", "career by season, newest first",
              career?.rows.first?.title ?? "-")

        let ohtani = ESPNProfiles.athlete(fixture("espn_ath_mlb_39832"), path: "baseball/mlb")
        check(ohtani?.bio.batsThrows == "Left/Right" && ohtani?.tiles.last?.label == "OPS" && ohtani?.tiles.last?.rank == "6th",
              "Ohtani: bats/throws, OPS 6th")
        let pitching = ESPNProfiles.gamelog(fixture("espn_ath_mlb_39832_gamelog_pitching"), path: "baseball/mlb",
                                            position: "DH", pitching: true)
        check(pitching?.columns.prefix(4).map(\.label) == ["IP", "H", "R", "ER"] && pitching?.category == "pitching",
              "two-way: a pitching log, asked for by category")
        let glasnow = ESPNProfiles.gamelog(fixture("espn_ath_mlb_33190_gamelog"), path: "baseball/mlb", position: "SP")
        check(glasnow?.stripKey == "avgGameScore" && glasnow?.reference == 50, "starters' strip is Game Score against 50")
        let zeros = Profile.GameLog.Entry(eventID: "1", date: .now, home: true, stats: ["atBats": "0", "hits": "0", "avg": ".000"])
        var idle = Profile.GameLog(columns: [], entries: [zeros], stripKey: nil, stripLabel: "")
        check(!idle.hasPlay, "a pitcher's batting log of all-zero appearances isn't a role they play")
        idle.entries.append(.init(eventID: "2", date: .now, home: true, stats: ["atBats": "1", "hits": "0"]))
        check(idle.hasPlay, "one plate appearance is")
        check(glasnow?.category == "pitching", "a pitcher's default log is pitching (the page opens on it)",
              glasnow?.category ?? "-")

        let sakaOverview = ESPNProfiles.overview(fixture("espn_ath_soc_280555_overview"), sport: .soccer)
        let comps = sakaOverview.competitions?.rows.map(\.title) ?? []
        check(comps.first == "Premier League" && comps.last == "FIFA World Cup" && comps.firstIndex(of: "Champions League") == 1,
              "competitions: league first, Europe next, international last", "\(comps)")
        let sakaLog = ESPNProfiles.gamelog(fixture("espn_ath_soc_280555_gamelog"), path: "soccer/eng.1", position: "F")
        let brighton = sakaLog?.entries.first { $0.opponent?.abbreviation == "BHA" }
        check(brighton?.teamScore == "0" && brighton?.opponentScore == "3" && brighton?.result == "L",
              "soccer score from home/away IDs (ESPN's score string is winner-first)")
        check(sakaLog?.matchStrip == true && sakaLog?.markKey == "goalAssists", "soccer draws a match strip")
        let rayaLog = ESPNProfiles.gamelog(fixture("espn_ath_soc_196176_gamelog"), path: "soccer/eng.1", position: "G")
        check(rayaLog?.stripKey == "cleanSheet", "goalkeepers' strip marks clean sheets")

        let ranks = ESPNProfiles.leaders(fixture("espn_nba_leaders_core_limit25")).mapValues { $0.map(\.id) }
        let topScorer = ranks["pointsPerGame"]?.first ?? ""
        let state = PlayerState(ref: Profile.PlayerRef(source: .espn(path: "basketball/nba"), id: topScorer, name: "Leader"))
        state.profile.tiles = [Profile.StatTile(label: "PTS", value: "36.5"), Profile.StatTile(label: "REB", value: "1.0")]
        state.applyLeagueRanks(ranks, path: "basketball/nba")
        check(state.profile.tiles.first?.rank == "1st" && state.profile.tiles.last?.rank == nil,
              "NBA rank context from the league top 25, blank outside it")

        // MARK: bo3.gg

        let vitalityRef = Profile.TeamRef(id: "cs-667", name: "Vitality", league: "cs2")
        check(BO3Profiles.slug(fixture("bo3_team_lookup_by_id_667")) == "vitality", "team ID → slug (bo3 rejects numeric IDs)")
        let vitality = BO3Profiles.team(fixture("bo3_team_vitality"), ref: vitalityRef)
        check(vitality?.header.rank == 3 && vitality?.header.coach == "XTQZZZ", "Vitality: world #3, coach XTQZZZ")
        check(vitality?.players.filter { !$0.isCoach && !$0.benched }.count == 5
              && vitality?.players.first { $0.benched }?.ref.name == "apEX", "active five; apEX benched")
        check(vitality?.players.first { $0.ref.name == "ZywOo" }?.stats["RATING"] == "7.13"
              && { if case .counterStrike(slug: "zywoo") = vitality?.players.first(where: { $0.ref.name == "ZywOo" })?.ref.source { true } else { false } }(),
              "ZywOo: 6-month rating 7.13, linked by slug")
        let career2 = BO3Profiles.teamCareer(fixture("bo3_team_vitality_general_stats"))
        check(career2.first?.value == "71%" && career2.contains { $0.label == "EVENTS" && $0.value == "26" },
              "team career: 71% of matches, 26 events", "\(career2.map { "\($0.label) \($0.value)" })")
        let zywoo = BO3Profiles.player(fixture("bo3_player_zywoo"))
        check(zywoo?.bio.realName == "Mathieu Herbaut" && zywoo?.bio.team?.id == "cs-667" && zywoo?.bio.photo?.host() == "image-proxy.bo3.gg",
              "player: real name, team, resized photo")
        let general = BO3Profiles.general(fixture("bo3_player_zywoo_general_stats"))
        check(general.kd.map { abs($0 - 1.418) < 0.01 } == true && general.adr.map { abs($0 - 85.4) < 0.1 } == true, "career K/D 1.42, ADR 85.4")
        check(BO3Profiles.headshotShare(fixture("bo3_player_zywoo_accuracy")).map { abs($0 - 0.416) < 0.005 } == true, "career HS% 41.6")
        let csLog = BO3Profiles.matches(fixture("bo3_player_zywoo_matches_list_stats_general_10"))
        let latest = csLog?.entries.last
        check(csLog?.entries.count == 10 && latest?.opponent?.name == "The MongolZ" && latest?.stats["rating"] == "8.79"
              && latest?.stats["kd"] == "35–16" && latest?.stats["adr"] == "115", "last match: 8.79 rating, 35–16, ADR 115",
              "\(latest?.stats ?? [:])")
        check(latest?.stats["maps"] == "Inferno, Cache", "maps ordered by game number (they arrive unsorted)")
        let maps = BO3Profiles.maps(fixture("bo3_player_zywoo_map_stats"))
        check(maps.first.map { $0.rating >= maps.last!.rating } == true && !maps.contains { $0.name.hasPrefix("de_") },
              "map pool sorted by rating, readable names")
        check(BO3Profiles.roles(fixture("bo3_player_zywoo_roles")).first == "AWPer", "role: AWPer")

        // MARK: IFSC

        let garnbret = IFSCProfiles.athlete(fixture("ifsc_athlete_1147_garnbret"))
        check(garnbret?.bio.name == "Janja Garnbret" && garnbret?.bio.nationality == "Slovenia", "Janja Garnbret, Slovenia")
        let lead = garnbret?.profile.podiums.first { $0.discipline == "Lead" }
        check(lead.map { ($0.gold, $0.silver, $0.bronze) == (50, 16, 5) } == true, "lead podiums 50 / 16 / 5")
        check(garnbret?.profile.tiles.prefix(2).map { "\($0.label) \($0.value)" } == ["LEAD 2nd", "BOULDER 21st"],
              "2026 World Cup ranks", "\(garnbret?.profile.tiles.map { "\($0.label) \($0.value)" } ?? [])")
        check(garnbret?.profile.results.first?.event == "Santiago 2026" && garnbret?.profile.results.first?.rank == 1,
              "latest result: Santiago, 1st")
        check(garnbret?.profile.speedBest?.hasPrefix("7.81 s") == true, "speed PB 7.81 s")

        // MARK: Display rules

        check(Profile.rank("Tied-13th")?.text == "T-13th" && Profile.rank("Tied-373rd") == nil && Profile.rank("8th")?.rank == 8,
              "ranks: T- prefix, nothing past 25th")
        check(Profile.initials("LeBron James") == "LJ" && Profile.initials("Kenneth Walker III") == "KW"
              && Profile.initials("ZywOo") == "Z", "monogram initials")
        check(Profile.properCase("TRI RAMADANI") == "Tri Ramadani", "IFSC names in proper case")
        check(ESPNProfiles.competitionName("2026-27 English Premier League") == "Premier League", "competition names shortened")
        let october = DateComponents(calendar: Calendar(identifier: .gregorian), year: 2026, month: 10, day: 25).date!
        check(ESPNProfiles.season(for: "basketball/nba", now: october) == (2027, 2)
              && ESPNProfiles.season(for: "soccer/eng.1", now: october) == (2026, 1)
              && ESPNProfiles.season(for: "football/nfl", now: october) == (2026, 2), "core season years without a waterfall")
        check(PhotoURL.bo3(URL(string: "https://files.bo3.gg/uploads/player/1/image/a.webp"), size: .small)?.absoluteString
              == "https://image-proxy.bo3.gg/uploads/player/1/image/a.webp?w=96&h=96", "bo3 photos through the image proxy")
        check(GameLogStrip.layout(values: [10, 0, nil, 20], width: 100, height: 50).map(\.height) == [25, 1, 0, 50]
              && GameLogStrip.layout(values: [10, 0, nil, 20], width: 100, height: 50).map(\.played) == [true, true, false, true],
              "strip: a played zero is 1pt, a game not played is a stub")
        check(GameLogStrip.layout(values: Array(repeating: 1, count: 10), width: 300, height: 10).last.map { $0.x + $0.width } == 118
              && GameLogStrip.layout(values: Array(repeating: 1, count: 10), width: 300, height: 10, spread: true).map { $0.mid } == stride(from: 15, to: 300, by: 30).map { CGFloat($0) }
              && GameLogStrip.layout(values: Array(repeating: 1, count: 10), width: 300, height: 10, spread: true).first?.width == 14,
              "a season's bars stay 10pt and fill in; a fixed last-10 spaces 14pt bars evenly across the chart")
        check(RankTrack.position(rank: 1, of: 30) == 0 && RankTrack.position(rank: 30, of: 30) == 1, "rank track ends")

        fotMob(fixture)
        await rosterLinks()
        await rosterCache()
    }

    // MARK: FotMob (soccer photos, injuries, coach)

    static func fotMob(_ fixture: (String) -> Data) {
        check(FotMob.teamID(fixture("fotmob_search_arsenal"), name: "Arsenal", league: "eng.1") == 9825,
              "FotMob team from search: the league's Arsenal, not the women's or U21")
        check(FotMob.teamID(fixture("fotmob_search_real_madrid"), name: "Real Madrid", league: "esp.1") == 8633
              && FotMob.teamID(fixture("fotmob_search_real_madrid"), name: "Real Madrid", league: nil) == 8633,
              "by league, else by exact name (not Castilla)")
        guard let squad = FotMob.squad(fixture("fotmob_team_9825_arsenal")) else { return check(false, "FotMob squad parses") }
        check(squad.coach == "Mikel Arteta" && squad.members.count == 24, "squad: 24 players, coach Mikel Arteta (ESPN's is junk)")
        func id(_ name: String, _ jersey: String?, in members: [FotMob.Member] = squad.members) -> String? {
            FotMob.match(name: name, jersey: jersey, in: members)?.name
        }
        // Accents and punctuation.
        check(id("Martin Odegaard", "8") == "Martin Ødegaard" && id("Viktor Gyokeres", nil) == "Viktor Gyökeres"
              && id("Jurrien Timber", "12") == "Jurriën Timber", "accents fold (ø, ö, ë)")
        let apostrophes = [FotMob.Member(id: 1, name: "Ceadach O’Neill", shirt: 53, injury: nil)]
        check(id("Ceadach O'Neill", nil, in: apostrophes) == "Ceadach O’Neill", "curly and straight apostrophes compare equal")
        // Name order.
        let son = [FotMob.Member(id: 2, name: "Heung-Min Son", shirt: 7, injury: nil),
                   FotMob.Member(id: 3, name: "Min-jae Kim", shirt: 4, injury: nil)]
        check(id("Son Heung-min", nil, in: son) == "Heung-Min Son", "family name first matches given name first")
        // Missing shirt numbers.
        check(id("Bukayo Saka", nil) == "Bukayo Saka", "no shirt number: the full name still matches")
        let gabriels = [FotMob.Member(id: 4, name: "Gabriel", shirt: 6, injury: nil),
                        FotMob.Member(id: 5, name: "Gabriel Jesus", shirt: 9, injury: nil)]
        check(id("Gabriel Magalhães", "6", in: gabriels) == "Gabriel", "a one-word name confirmed by the shirt number")
        check(id("Gabriel Magalhães", nil, in: gabriels) == nil, "…but without a number it's too weak: no match (monogram)")
        // Two players with the same surname.
        let whites = [FotMob.Member(id: 6, name: "Ben White", shirt: 4, injury: nil),
                      FotMob.Member(id: 7, name: "Kyle White", shirt: 22, injury: nil)]
        check(id("B. White", nil, in: whites) == "Ben White", "same surname: the first initial decides")
        check(id("Josh White", nil, in: whites) == nil, "same surname, neither initial: no match")
        check(id("Kyle White", "2", in: whites) == "Kyle White", "an exact name beats a wrong shirt number")
        // The whole Arsenal squad, against ESPN's roster.
        let arsenal = Profile.TeamRef(id: "espn-soccer-359", name: "Arsenal", league: "eng.1")
        let roster = ESPNProfiles.roster(fixture("espn_soc_roster_eng1_359"), sport: .soccer, path: "soccer/eng.1", team: arsenal)
        let matched = roster.players.compactMap { FotMob.match(name: $0.ref.name, jersey: $0.jersey, in: squad.members) }
        check(matched.count == 24 && Set(matched.map(\.id)).count == 24,
              "every FotMob player matches exactly one ESPN player (the 5 academy players keep monograms)", "\(matched.count)")
        check(FotMob.injury(squad.members.first { $0.name == "Bukayo Saka" }!).map { "\($0.status) \($0.detail ?? "")" }
              == "Out Expected back early December" && FotMob.injury(squad.members.first { $0.name == "Piero Hincapié" }!)?.status == "Doubtful",
              "injuries: Out until early December; Doubtful")
        let state = TeamState(ref: arsenal)
        state.apply(.roster(roster))
        state.applyFotMob(squad)
        let saka = state.allPlayers.first { $0.ref.name == "Bukayo Saka" }
        check(saka?.ref.photo?.host() == "images.fotmob.com" && saka?.injury == "Out" && saka?.injuryReturn == "early December",
              "the roster takes FotMob's photo and injury")
        check(state.allPlayers.first { $0.ref.name == "Marli Salmon" }?.ref.photo == nil, "an unmatched player keeps the monogram")
        check(state.allPlayers.first { $0.ref.name == "Jurriën Timber" }?.ref.photo?.host() == "images.fotmob.com",
              "matched players all take FotMob's face crop, so the squad's photos match (ESPN's few are framed differently)")
    }

    // MARK: Cache

    static func rosterCache() async {
        let session: URLSession = {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [ProfileStub.self]
            return URLSession(configuration: config)
        }()
        let cache = ProfileCache(session: session, directory: nil)
        let url = URL(string: "https://stub.test/a")!
        ProfileStub.reset([url: .init(status: 200, body: Data("one".utf8), etag: "\"v1\"")])
        let first = try? await cache.data(url, ttl: 60)
        let second = try? await cache.data(url, ttl: 60)
        check(first == Data("one".utf8) && second == first && ProfileStub.count(url) == 1, "within the TTL: one request")

        ProfileStub.reset([url: .init(status: 304, body: Data(), etag: "\"v1\"")])
        let revalidated = try? await cache.data(url, ttl: 0)
        check(revalidated == Data("one".utf8) && ProfileStub.lastEtag(url) == "\"v1\"", "after it: If-None-Match, a 304 keeps the body")

        ProfileStub.reset([url: .init(status: 500, body: Data(), etag: nil)])
        let stale = try? await cache.data(url, ttl: 0)
        check(stale == Data("one".utf8), "a failure serves the stale copy")

        let fresh = URL(string: "https://stub.test/b")!
        ProfileStub.reset([fresh: .init(status: 200, body: Data("b".utf8), etag: nil, delay: 0.2)])
        async let x = try? cache.data(fresh, ttl: 60)
        async let y = try? cache.data(fresh, ttl: 60)
        let pair = await (x, y)
        check(pair.0 == Data("b".utf8) && pair.1 == pair.0 && ProfileStub.count(fresh) == 1, "concurrent requests share one fetch")
    }
}

/// Serves canned responses for the cache tests and counts requests.
final class ProfileStub: URLProtocol, @unchecked Sendable {
    struct Response { var status: Int; var body: Data; var etag: String?; var delay: Double = 0 }
    private static let lock = NSLock()
    nonisolated(unsafe) private static var responses: [URL: Response] = [:]
    nonisolated(unsafe) private static var counts: [URL: Int] = [:]
    nonisolated(unsafe) private static var etags: [URL: String] = [:]

    static func reset(_ r: [URL: Response]) {
        lock.lock(); defer { lock.unlock() }
        responses = r
        counts = [:]
    }
    static func count(_ url: URL) -> Int { lock.lock(); defer { lock.unlock() }; return counts[url] ?? 0 }
    static func lastEtag(_ url: URL) -> String? { lock.lock(); defer { lock.unlock() }; return etags[url] }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        guard let url = request.url else { return }
        Self.lock.lock()
        Self.counts[url, default: 0] += 1
        if let tag = request.value(forHTTPHeaderField: "If-None-Match") { Self.etags[url] = tag }
        let r = Self.responses[url] ?? Response(status: 404, body: Data(), etag: nil)
        Self.lock.unlock()
        DispatchQueue.global().asyncAfter(deadline: .now() + r.delay) {
            var headers: [String: String] = [:]
            if let etag = r.etag { headers["ETag"] = etag }
            let response = HTTPURLResponse(url: url, statusCode: r.status, httpVersion: "HTTP/1.1", headerFields: headers)!
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: r.body)
            self.client?.urlProtocolDidFinishLoading(self)
        }
    }
}

extension ScorelineTests {
    /// R3: the pages on the back stack, and the refs entry points build.
    @MainActor
    static func rosterLinks() async {
        let lakers = Profile.TeamRef(id: "espn-basketball-13", name: "Lakers", league: "nba")
        let lebron = Profile.PlayerRef(source: .espn(path: "basketball/nba"), id: "1966", name: "LeBron James")
        check(RootView.Page.team(lakers).backTitle == "Lakers" && RootView.Page.player(lebron).backTitle == "LeBron James",
              "Back on a page opened from a team or player says its name")
        check(RootView.Page.team(lakers).parent == .scores && RootView.Page.player(lebron).parent == .scores,
              "with nothing to return to, team and player pages go back to Scores")
        check(RootView.Page.team(lakers).memoryKey == "team:espn-basketball-13"
              && RootView.Page.player(lebron).memoryKey != RootView.Page.team(lakers).memoryKey,
              "each page keeps its own scroll place")
        check(Profile.PlayerRef.espn(path: "basketball/nba", id: "1966", name: "LeBron James") != nil
              && Profile.PlayerRef.espn(path: "basketball/wnba", id: "1", name: "A") == nil
              && Profile.PlayerRef.espn(path: "basketball/nba", id: nil, name: "A") == nil,
              "NBA box score rows link; the WNBA's don't (untouched)")
        check(ESPNProfiles.standing("1st in Western Conference Division") == "1st in Western Conference",
              "ESPN's \"Western Conference Division\" reads as the conference")
        check(Profile.TeamRef.league(forPath: "soccer/eng.1") == "eng.1" && Profile.TeamRef.league(forPath: nil) == nil,
              "a match's ESPN path gives its league for team links")
        let row = Profile.TeamRef(id: "espn-basketball-13", name: "Los Angeles Lakers", league: "nba")
        check(row == lakers && RootView.Page.team(row) == RootView.Page.team(lakers),
              "a team opened from its own standings row is the page already shown (no new step)")
        check(!Profile.TeamRef(id: "espn-basketball-wnba-1", name: "Aces", league: "wnba").isSupported,
              "WNBA teams stay plain")

        // The navigator RootView wires: links to sports without pages do nothing.
        let navigator = ProfileNavigator()
        var opened: [String] = []
        navigator.openTeam = { opened.append($0.id) }
        navigator.open(lakers)
        navigator.open(Profile.TeamRef(id: "espn-basketball-wnba-1", name: "Aces", league: "wnba"))
        check(opened == ["espn-basketball-13"], "the navigator opens only teams that have pages")
    }
}
