import SwiftUI

// Collapsible modules on the game page: the keys a fold, a hide or an order
// is kept under (shared with the web port), what's folded or hidden by
// default, how hidden modules leave the page before the split page places it,
// the Live View's and Win Probability's places, what each folded module says,
// and how the user's order merges into each state's plan (and survives a
// relaunch). Checked without views.

extension ScorelineTests {
    static func modules() {
        print("\nGame-page modules")
        modulesKeys()
        modulesLayout()
        modulesPage()
        modulesGlances()
        modulesVisibility()
        modulesWinProbability()
        modulesOrder()
        modulesOrderPages()
        modulesOrderPersistence()
    }

    private typealias S = DetailView.Section
    private static let nbaRef = EventRef.espn(path: NBADetail.path, id: "1", sport: .basketball)
    private static let soccerRef = EventRef.espn(path: "soccer/eng.1", id: "1", sport: .soccer)
    private static let mlbRef = EventRef.espn(path: "baseball/mlb", id: "1", sport: .baseball)
    private static let nflRef = EventRef.espn(path: "football/nfl", id: "1", sport: .football)

    // MARK: Keys

    private static func modulesKeys() {
        check(ModuleKeys.key(.nba, .liveView) == "nba.liveView" && ModuleKeys.key(.soccer, .pitch) == "soccer.pitch"
              && ModuleKeys.key(.baseball, .atBat) == "baseball.atBat" && ModuleKeys.key(.nba, .winProbability) == "nba.winProbability",
              "keys: page then module, as the web names them (nba.liveView, soccer.pitch)")
        check(ModuleKeys.folded == "foldedModules" && ModuleKeys.hidden == "hiddenModules" && ModuleKeys.order == "moduleOrder",
              "prefs keys: foldedModules, hiddenModules, moduleOrder")
        let wnba = EventRef.espn(path: "basketball/wnba", id: "1", sport: .basketball)
        let cfb = EventRef.espn(path: "football/college-football", id: "1", sport: .football)
        check(PageKind.of(nbaRef) == .nba && PageKind.of(soccerRef) == .soccer && PageKind.of(mlbRef) == .baseball
              && PageKind.of(nflRef) == .football && PageKind.of(cfb) == .football && PageKind.of(wnba) == .espn
              && PageKind.of(.counterStrike(slug: "a", tournament: nil)) == .counterStrike && PageKind.of(nil) == nil,
              "per sport, as the web's pageKind: the NFL and college share football's; the WNBA has the generic page")
        check(PageKind.nba.name == "NBA" && PageKind.soccer.name == "Soccer", "menus name the sport's pages (NBA, Soccer)")
    }

    // MARK: Fold and hide state

    private static func modulesLayout() {
        var layout = ModuleLayout()
        let everything: [S] = [.liveView, .court, .flow, .winProbability, .plays, .pitch, .atBat]
        check(everything.allSatisfy { !layout.isFolded($0, on: .nba) && !layout.isHidden($0, on: .nba) },
              "by default every module is shown and open")
        layout.fold(.liveView, on: .nba, true)
        check(layout.isFolded(.liveView, on: .nba) && !layout.isFolded(.liveView, on: .baseball) && !layout.isFolded(.court, on: .nba),
              "folding the NBA's Live View leaves baseball's (and the NBA's other modules) open")
        check(layout.folded == ["nba.liveView"], "a fold is one key, with no game or state in it (folded live, folded in a final)")
        layout.fold(.liveView, on: .nba, false)
        check(layout.folded.isEmpty, "unfolding removes the key")
        layout.fold(.court, on: nil, true)
        check(layout.folded.isEmpty && !layout.isFolded(.court, on: nil), "a page with no kind folds nothing")

        layout.hide(.court, on: .nba, true)
        layout.hide(.pitch, on: .soccer, true)
        let page: [S] = [.liveView, .court, .flow, .linescore]
        check(layout.shown(page, on: .nba) == [.liveView, .flow, .linescore], "hidden modules leave the page, the rest keep their order")
        check(layout.hiddenHere(page, on: .nba) == [.court], "the page's end names what it hides")
        check(layout.shown(page, on: .baseball) == page, "hiding is per sport")
        layout.showAll(on: .nba)
        check(layout.hidden == ["soccer.pitch"], "Restore Defaults shows the sport's modules again, and only that sport's")
        check(HiddenModulesLine.text(["Shot Chart", "Live View"], page: "NBA") == "Hidden on NBA pages: Shot Chart, Live View",
              "the end line: what's hidden, by name")
        check(ModuleHeader<EmptyView>.spoken("Shot Chart", folded: true) == "Shot Chart, collapsed"
              && ModuleHeader<EmptyView>.spoken("Shot Chart", folded: false) == "Shot Chart, expanded",
              "VoiceOver: \"Shot Chart, collapsed\"")
    }

    // MARK: The Live View's place, and the split page

    private static func modulesPage() {
        for (ref, chart, name) in [(nbaRef, S.court, "NBA"), (soccerRef, .pitch, "soccer"), (mlbRef, .atPlate, "baseball"), (nflRef, .field, "football")] {
            let live = DetailView.order(ref, .live)
            let chartName = DetailView.moduleName(chart, on: PageKind.of(ref))
            check(Array(live.prefix(3)) == [.liveView, .winProbability, chart],
                  "\(name) live: the Live View first, Win Probability under it, then \(chartName)", "\(live)")
            check(!DetailView.order(ref, .final).contains(.liveView) && !DetailView.order(ref, .scheduled).contains(.liveView),
                  "\(name): the Live View is live only")
            let left = DetailView.widePlan(ref, .live).compactMap { part -> [S]? in
                if case let .columns(left, _) = part { return left }
                return nil
            }.first ?? []
            check(left.firstIndex(of: .liveView).map { left.indices.contains($0 + 1) && left[$0 + 1] == chart } == true,
                  "\(name) split page: the Live View above \(chartName), in its column")
        }
        let cs = EventRef.counterStrike(slug: "a", tournament: nil)
        check(!DetailView.order(cs, .live).contains(.liveView), "no theater, no Live View (CS2)")

        let nbaModules = DetailView.modules(for: nbaRef)
        let live = Dictionary(nbaModules.map { ($0.section, $0.liveOnly) }, uniquingKeysWith: { a, _ in a })
        check(nbaModules.first?.section == .liveView && live[.liveView] == true && live[.court] == false && live[.injuries] == false
              && live[.plays] == true, "Customize lists every state's modules once, live order first, marking the live-only ones",
              "\(nbaModules.map(\.section))")
        check(Set(nbaModules.map(\.section)).count == nbaModules.count, "each module listed once")
        check(DetailView.moduleName(.winProbability, on: .nba) == "Win Probability" && DetailView.moduleName(.moments, on: .soccer) == "Key Events"
              && DetailView.moduleName(.table, on: .nba) == "Standings", "a module's name doesn't change with the game's state")

        // Hidden modules come out before the split page places what's left; an emptied column borrows a section.
        var layout = ModuleLayout()
        for s in [S.box, .leaders, .stats, .injuries, .whereToWatch] { layout.hide(s, on: .nba, true) }
        let shown = layout.shown(DetailView.order(nbaRef, .live), on: .nba)
        let placed = DetailView.wideArrangement(shown, plan: DetailView.widePlan(nbaRef, .live))
        let right = placed.filter { $0.slot.column == .right }.map(\.section)
        check(!placed.contains { $0.section == .box } && !right.isEmpty,
              "hiding the whole right column: the left lends it a section", "\(right)")
        layout = ModuleLayout()
        layout.hide(.liveView, on: .nba, true)
        let noTheater = DetailView.wideArrangement(layout.shown(DetailView.order(nbaRef, .live), on: .nba),
                                                   plan: DetailView.widePlan(nbaRef, .live))
        check(noTheater.first?.section == .court && noTheater.first?.slot.column == .left, "Live View hidden: the court leads the page again")
    }

    // MARK: Glances

    private static func modulesGlances() {
        func line(_ g: ModuleGlance?) -> String {
            switch g?.line {
            case let .text(lead, detail)?: "\(lead)|\(detail)"
            case let .parts(parts)?: parts.map { "\($0.name) \($0.value)" }.joined(separator: "|")
            case nil: "nil"
            }
        }
        let names = (top: "GSW", bottom: "MIN")
        check(line(.play("Q4 2:30  Stephen Curry makes 3-foot two point shot")) == "Q4 2:30|Stephen Curry makes 3-foot two point shot"
              && line(.play("Match ends, Brentford 1, Arsenal 2.")) == "|Match ends, Brentford 1, Arsenal 2.",
              "Live View and Latest: the newest play, its time first")
        let gsw = ModuleGlance.Shooting(made: 38, attempts: 82, threesMade: 14, threesAttempted: 33)
        let min = ModuleGlance.Shooting(made: 35, attempts: 81, threesMade: 11, threesAttempted: 31)
        check(line(.shooting(top: gsw, bottom: min, names: names)) == "GSW 46% FG|14 of 33 from three · MIN 43%, 11 of 31",
              "Shot Chart: FG% and threes", line(.shooting(top: gsw, bottom: min, names: names)))
        check(ModuleGlance.Shooting(fg: "38-82", threes: "14-33") == gsw, "shooting from the box score's totals")
        let shots = [GameDetail.Shot(id: "1", x: 0, y: 0, made: true, value: 3, side: .top, player: nil, period: 1, clock: "", text: "", elapsed: nil),
                     GameDetail.Shot(id: "2", x: 0, y: 0, made: false, value: 2, side: .top, player: nil, period: 1, clock: "", text: "", elapsed: nil),
                     GameDetail.Shot(id: "3", x: 0, y: 0, made: true, value: 2, side: .bottom, player: nil, period: 1, clock: "", text: "", elapsed: nil)]
        check(ModuleGlance.Shooting(shots, side: .top) == ModuleGlance.Shooting(made: 1, attempts: 2, threesMade: 1, threesAttempted: 1),
              "shooting counted from the chart's shots, one side's")

        func point(_ t: Int, _ b: Int) -> GameDetail.FlowPoint { GameDetail.FlowPoint(id: "\(t)-\(b)", elapsed: 0, top: t, bottom: b, period: 1, clock: "") }
        let flow = [point(2, 0), point(2, 2), point(2, 4), point(5, 4), point(5, 5), point(7, 5), point(9, 5), point(9, 4)]
        let counts = ModuleGlance.flowCounts(flow)
        check(counts.changes == 2 && counts.ties == 2, "lead changes and ties, as ESPN counts them", "\(counts)")
        check(line(.flow(flow, names: names)) == "GSW +5|2 lead changes · 2 ties", "Game Flow: the margin, then lead changes and ties")
        check(line(.flow([point(0, 3)], names: names)) == "MIN +3|No lead changes", "a lead never lost")

        check(line(.linescore(headers: ["1", "2", "3", "4", "T"], top: ["30", "34", "29", "27", "120"], bottom: ["23", "25", "33", "21", "102"],
                              names: names, baseball: false, live: true)) == "Q4|GSW 27–21 MIN this quarter",
              "Score by Quarter: the latest quarter")
        check(line(.linescore(headers: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "R", "H", "E"],
                              top: ["0", "1", "0", "2", "0", "0", "1", "", "", "4", "9", "0"],
                              bottom: ["1", "0", "0", "0", "2", "0", "0", "", "", "3", "6", "1"],
                              names: (top: "MIL", bottom: "TB"), baseball: true, live: true)) == "7th|MIL 1–0 TB this inning",
              "Score by Inning: the latest inning")
        check(line(.linescore(headers: ["1", "2", "3", "4", "5", "T"], top: ["1", "1", "1", "1", "9", "13"], bottom: ["1", "1", "1", "1", "4", "8"],
                              names: names, baseball: false, live: false)) == "OT|GSW 9–4 MIN", "overtime, final")

        let leaders = [GameDetail.LeaderLine(category: "Points",
                                             top: GameDetail.Leader(name: "Stephen Curry", value: "31", headshot: nil, player: nil),
                                             bottom: GameDetail.Leader(name: "Anthony Edwards", value: "34", headshot: nil, player: nil))]
        check(line(.leaders(leaders)) == "Edwards 34|Curry 31", "Leaders: the top scorer first")
        check(ModuleGlance.surname("Jaime Jaquez Jr.") == "Jaquez" && ModuleGlance.surname("Nikola Jokić") == "Jokić", "surnames, without suffixes")

        let injuries = [GameDetail.Injury(id: "1", name: "Jonathan Kuminga", status: "Out", detail: nil, side: .top),
                        GameDetail.Injury(id: "2", name: "Moses Moody", status: "Day-To-Day", detail: nil, side: .top),
                        GameDetail.Injury(id: "3", name: "Cam Reddish", status: "Out For Season", detail: nil, side: .bottom)]
        check(line(.injuries(injuries)) == "2 out|Kuminga, Reddish", "Injury Report: who's out")
        check(line(.broadcasters(["ESPN", "Prime Video"])) == "ESPN|and Prime Video" && line(.broadcasters(["Peacock", "USA", "Telemundo"])) == "Peacock|and 2 more",
              "Where to Watch: the first, then the rest")
        check(line(.stats([GameDetail.Stat(label: "Rebounds", top: "41", bottom: "38", topShare: 0.5),
                           GameDetail.Stat(label: "Assists", top: "27", bottom: "22", topShare: 0.5),
                           GameDetail.Stat(label: "Turnovers", top: "11", bottom: "14", topShare: 0.5),
                           GameDetail.Stat(label: "Steals", top: "8", bottom: "6", topShare: 0.5)]))
              == "Rebounds 41–38|Assists 27–22 · Turnovers 11–14", "Team Stats: the first three")
        check(line(.standings([(name: "MIN", rank: 7), (name: "GSW", rank: 3)])) == "GSW 3rd|MIN 7th", "a table: the higher team first")

        let pitches = [GameDetail.Pitch(id: "1", number: 1, x: 0, y: 0, result: .ball, type: "SL", typeName: "Slider", mph: 88),
                       GameDetail.Pitch(id: "3", number: 3, x: 0, y: 0, result: .strike, type: "FF", typeName: "Four-seam fastball", mph: 97,
                                        strike: .foul),
                       GameDetail.Pitch(id: "2", number: 2, x: 0, y: 0, result: .strike, type: "CH", typeName: "Changeup", mph: 86, strike: .called)]
        check(line(.atBat(pitches)) == "Pitch 3|97 mph four-seam, foul", "This At-Bat: the newest pitch", line(.atBat(pitches)))
        check(line(.atBat([])) == "|Waiting for the first pitch", "between batters")
        check(line(.atPlate(outs: 1, bases: [true, false, true], batter: "Christian Yelich", pitcher: "Pete Fairbanks"))
              == "1 out|Runners on 1st and 3rd · Yelich vs. Fairbanks", "At the Plate: outs, runners, the matchup")
        check(line(.atPlate(outs: 2, bases: [true, true, true], batter: nil, pitcher: nil)) == "2 outs|Bases loaded", "bases loaded")
        check(line(.field(possession: "KC", downDistance: "2nd & 7 at SEA 34", plays: 6)) == "KC ball|2nd & 7 at SEA 34 · 6 plays this drive",
              "Field: the ball, the down, the drive")

        let moments = [GameDetail.Moment(id: "a", kind: .goal, clock: "38'", text: "Antoine Semenyo Goal", side: .bottom, score: "0-1"),
                       GameDetail.Moment(id: "b", kind: .yellow, clock: "61'", text: "Casemiro Yellow Card", side: .top)]
        check(line(.newest(moments, soccer: true)) == "38'|Goal! Antoine Semenyo, 0-1", "Key Events: the newest goal, not a later card",
              line(.newest(moments, soccer: true)))
        check(line(.timeline(moments, score: "0–1")) == "0–1|38' Antoine Semenyo", "Timeline: the score, then each goal")

        let split = OddsSplit(top: 0.962, draw: nil, bottom: 0.038)
        let chances = ModuleGlance.chances(split, final: false, top: (.yellow, "GSW"), draw: .gray, bottom: (.blue, "MIN"))
        check(line(chances) == "GSW 96%|MIN 4%",
              "Win Probability: each side's chance, color-keyed (no draw in a two-way market)", line(chances))
        check(chances.spoken == "GSW 96%, MIN 4%", "VoiceOver reads the chances as the header's value")
        let three = ModuleGlance.chances(OddsSplit(top: 0.04, draw: 0.11, bottom: 0.85), final: false, top: (.red, "MUN"), draw: .gray, bottom: (.red, "BOU"))
        check(line(three) == "MUN 4%|Draw 11%|BOU 85%", "three-way: the draw between", line(three))
        check(ModuleGlance.text("GSW +5", "9 lead changes").spoken == "GSW +5, 9 lead changes", "a text glance reads value, then what")
    }

    // MARK: What's seen while folded

    private static func modulesVisibility() {
        typealias V = PageGeometry.Visibility
        check(PageGeometry.contentVisibility(.visible, folded: true) == .hidden(.below)
              && PageGeometry.contentVisibility(.partial(.above), folded: true) == .hidden(.above)
              && PageGeometry.contentVisibility(nil, folded: true) == .hidden(.below),
              "folded: the content is out of view wherever its header is (the theater draws no frames)")
        check(PageGeometry.contentVisibility(.visible, folded: false) == .visible && PageGeometry.contentVisibility(nil, folded: false) == nil,
              "open: as before")
        let charts: [LiveMoment.Chart] = [.field, .pitch, .plate, .spray, .rounds, .wall, .ascent, .boulder, .court]
        check(charts.allSatisfy { DockRules.chart(for: DockRules.section(for: $0)) == $0 } && DockRules.chart(for: .liveView) == nil,
              "each chart's section carries its moments when folded")
        // One moment, one place: a folded chart whose header is in view carries it in its glance; scrolled away, the bar does.
        let m = LiveMoment(id: "m", chart: .court, tier: .swing, kind: .made(value: 3), lead: "3-pointer", detail: "Curry")
        check(DockRules.newsLine(moment: m, chartVisibility: V.visible) == nil && DockRules.newsLine(moment: m, chartVisibility: .hidden(.above)) == m,
              "docked bar: the folded header in view has the moment; off screen, the bar's news line")
    }

    // MARK: Win Probability's default place

    private static func modulesWinProbability() {
        let gens = EventRef.espn(path: "basketball/wnba", id: "1", sport: .basketball)
        for (ref, name) in [(nbaRef, "NBA"), (soccerRef, "soccer"), (mlbRef, "baseball"), (nflRef, "football"), (gens, "basketball")] {
            let live = DetailView.order(ref, .live), final = DetailView.order(ref, .final), pre = DetailView.order(ref, .scheduled)
            check(live.firstIndex(of: .winProbability) == 1 && live.first == .liveView && final.first == .winProbability
                  && pre.first == .winProbability,
                  "\(name): Win Probability right under the Live View live, first before the game and in the final",
                  "\(live.prefix(3)) | \(final.prefix(2)) | \(pre.prefix(2))")
        }
        // A live page without a theater (the WNBA's generic page): Win Probability leads it.
        var layout = ModuleLayout()
        layout.hide(.liveView, on: .espn, true)
        check(layout.shown(DetailView.order(gens, .live), on: .espn).first == .winProbability,
              "no Live View on the page: Win Probability is the first module, under the score")
        // Split page: at or near the top of its column, the designed pairs kept.
        func column(_ ref: EventRef, _ state: EventState) -> [S] {
            for case let .columns(left, right) in DetailView.widePlan(ref, state) {
                if left.contains(.winProbability) { return left }
                if right.contains(.winProbability) { return right }
            }
            return []
        }
        for (ref, name) in [(nbaRef, "NBA"), (soccerRef, "soccer"), (mlbRef, "baseball"), (nflRef, "football")] {
            for state in [EventState.live, .final, .scheduled] {
                // The NBA final keeps the flow, then the court beside the box score: Win Probability is third.
                let col = column(ref, state).filter { $0 != .liveView }
                check((col.firstIndex(of: .winProbability) ?? 99) <= (PageKind.of(ref) == .nba && state == .final ? 2 : 1),
                      "\(name) \(state) split page: Win Probability at or near the top of its column", "\(col)")
            }
        }
        let nbaLive = column(nbaRef, .live), nbaFinal = column(nbaRef, .final)
        check(Array(nbaLive.prefix(3)) == [.liveView, .court, .winProbability] && nbaFinal.prefix(3).contains(.court),
              "NBA split page: the court stays beside the box score, Win Probability just under it", "\(nbaLive) | \(nbaFinal)")
        check(column(soccerRef, .final).first == .timeline && column(soccerRef, .live).first == .winProbability,
              "soccer split page: a final's timeline stays beside the shot map; live, Win Probability tops the column")
    }

    // MARK: The user's order

    private static func modulesOrder() {
        typealias O = ModuleOrder
        check(O.merge(["a", "b", "c"], ranking: []) == ["a", "b", "c"], "no ranking: the plan's order")
        check(O.merge(["a", "b", "c"], ranking: ["c", "a", "b"]) == ["c", "a", "b"], "everything ranked: the user's order")
        check(O.merge(["a", "b", "c", "d"], ranking: ["d", "b"]) == ["d", "a", "b", "c"],
              "never ranked: a module follows the ranked one above it in the plan, or leads the first one", "\(O.merge(["a", "b", "c", "d"], ranking: ["d", "b"]))")
        check(O.merge(["a", "b"], ranking: ["x", "b", "b", "a"]) == ["b", "a"], "IDs not on the page, and repeats, are ignored")

        // A final's ranking carries to the live page; a live one to the final.
        let finalRanking = ["box", "flow", "court", "winProbability", "linescore", "leaders", "moments", "stats", "table"]
        let live = O.arrange(DetailView.order(nbaRef, .live), by: finalRanking).map(sectionID)
        check(live == ["box", "flow", "court", "liveView", "winProbability", "linescore", "leaders", "moments", "stats", "plays", "table",
                       "injuries", "whereToWatch"],
              "ranked on a final, live: the Live View still leads Win Probability; Latest, injuries and where to watch follow their plan neighbors",
              "\(live)")
        let liveRanking = ["box"] + DetailView.order(nbaRef, .live).map(sectionID).filter { $0 != "box" }
        let final = O.arrange(DetailView.order(nbaRef, .final), by: liveRanking).map(sectionID)
        check(final == ["box", "winProbability", "court", "flow", "linescore", "leaders", "moments", "stats", "table"],
              "ranked live, the final keeps that order without what only a live page has", "\(final)")

        // A page's new order folds into the ranking without dropping what isn't on it.
        let previous = ["liveView", "court", "flow", "plays", "box"]
        let ranked = O.ranked(page: ["flow", "court", "box"], previous: previous)
        check(ranked == ["flow", "plays", "liveView", "court", "box"],
              "reordered on a final: live-only modules stay ranked beside their neighbors (Latest follows the flow, the Live View leads the court)",
              "\(ranked)")
        check(Set(O.ranked(page: ["a"], previous: ["x", "y"])) == ["a", "x", "y"], "nothing already ranked falls out")
        check(O.ranked(page: ["flow", "court", "box"], previous: []) == ["flow", "court", "box"], "a first ranking is the page's order")

        // Columns: a run's new order takes the run's places; the other column keeps its own.
        check(O.permute(["a", "X", "b", "Y", "c"], run: ["c", "a", "b"]) == ["c", "X", "a", "Y", "b"],
              "a column reordered: the other column's modules keep their places")
        check(O.move("c", to: 0, in: ["a", "b", "c"]) == ["c", "a", "b"] && O.move("a", to: 9, in: ["a", "b", "c"]) == ["b", "c", "a"],
              "move: to a slot among the others, clamped")
        check(O.slot(top: 0, runTop: 0, heights: [40, 40]) == 0 && O.slot(top: 21, runTop: 0, heights: [40, 40]) == 1
              && O.slot(top: 19, runTop: 0, heights: [40, 40]) == 0 && O.slot(top: 500, runTop: 0, heights: [40, 40]) == 2
              && O.slot(top: -90, runTop: 0, heights: [40, 40]) == 0,
              "the gap: the slot nearest the dragged module's top (past half a module, it moves on)")

        // Move Up and Move Down (VoiceOver): one place along the run, nothing at its ends.
        let page = ["liveView", "court", "flow", "box"]
        check(O.step("liveView", by: -1, run: page, page: page, previous: []) == nil
              && O.step("box", by: 1, run: page, page: page, previous: []) == nil, "Move Up at the top, Move Down at the bottom: none")
        check(O.step("flow", by: -1, run: page, page: page, previous: []) == ["liveView", "flow", "court", "box"]
              && O.step("court", by: 1, run: page, page: page, previous: []) == ["liveView", "flow", "court", "box"],
              "Move Up and Move Down swap a module with its neighbor")
        let left = ["court", "flow"], split = ["court", "box", "flow", "leaders"]
        check(O.step("flow", by: -1, run: left, page: split, previous: []) == ["flow", "box", "court", "leaders"],
              "split page: Move Up stays in the module's column")
        check(ModuleDrag.autoscrollSpeed(pointer: 300, height: 600, topInset: 0) == 0
              && ModuleDrag.autoscrollSpeed(pointer: 0, height: 600, topInset: 0) == -12
              && ModuleDrag.autoscrollSpeed(pointer: 578, height: 600, topInset: 0) == 6
              && ModuleDrag.autoscrollSpeed(pointer: 60, height: 600, topInset: 48) < 0,
              "autoscroll: within 44pt of an edge (below the docked bar), faster nearer it")
        check(ModuleDrag.springProgress(0) == 0 && ModuleDrag.springProgress(0.3) > 0.98 && ModuleDrag.springProgress(0.6) == 1
              && ModuleDrag.springProgress(0.1) < ModuleDrag.springProgress(0.15),
              "the settle's scroll glides on standard's curve: from 0, nearly there at 0.3 s, done by 0.6 s, never back")
    }

    private static func modulesOrderPages() {
        // Hidden modules still leave the page; the rest take the user's order.
        var layout = ModuleLayout()
        layout.rank(["box", "court", "flow"], on: .nba)
        layout.hide(.court, on: .nba, true)
        let shown = layout.shown(DetailView.order(nbaRef, .final), on: .nba)
        check(!shown.contains(.court) && shown.firstIndex(of: .box)! < shown.firstIndex(of: .flow)!,
              "hidden modules are filtered out; the rest follow the ranking", "\(shown)")
        check(layout.ranking(on: .nba).contains("court") && layout.shown(DetailView.order(nbaRef, .final), on: .soccer).first == .winProbability,
              "hiding keeps a module's rank; another sport's pages keep their plan")

        // Split page: each column keeps its modules (the designed pairs) in the ranking's relative order.
        layout = ModuleLayout()
        let wanted = ["box", "table", "moments", "stats", "leaders", "court", "liveView", "winProbability", "flow", "linescore", "plays"]
        layout.rank(wanted, on: .nba)
        let order = layout.shown(DetailView.order(nbaRef, .live), on: .nba)
        let placed = DetailView.wideArrangement(order, plan: DetailView.widePlan(nbaRef, .live), ranking: layout.ranking(on: .nba))
        let left = placed.filter { $0.slot.column == .left }.map(\.section), right = placed.filter { $0.slot.column == .right }.map(\.section)
        check(Set(left) == [.liveView, .court, .winProbability, .flow, .linescore, .moments, .plays, .table]
              && Set(right) == [.box, .leaders, .stats, .injuries, .whereToWatch],
              "split page: a module never changes column, however it's ranked")
        check(left == [.table, .moments, .court, .liveView, .winProbability, .flow, .linescore, .plays]
              && right == [.box, .stats, .injuries, .whereToWatch, .leaders],
              "split page: within each column, the ranking's relative order", "\(left) | \(right)")
        check(DetailView.wideArrangement(order, plan: DetailView.widePlan(nbaRef, .live)).map(\.section)
              == DetailView.wideArrangement(DetailView.order(nbaRef, .live), plan: DetailView.widePlan(nbaRef, .live)).map(\.section),
              "split page with no ranking: the plan's columns, as designed")

        // Restore Defaults: the sport's order goes with its hidden modules; folds and other sports stay.
        layout.rank(["pitch", "timeline"], on: .soccer)
        layout.fold(.box, on: .nba, true)
        layout.hide(.box, on: .nba, true)
        layout.restoreDefaults(on: .nba)
        check(layout.ranking(on: .nba).isEmpty && layout.hidden.isEmpty && layout.isFolded(.box, on: .nba)
              && layout.ranking(on: .soccer) == ["pitch", "timeline"],
              "Restore Defaults: the sport's order and hidden modules reset; folds and other sports stay")
        check(layout.shown(DetailView.order(nbaRef, .final), on: .nba) == DetailView.order(nbaRef, .final),
              "restored, a page is in its plan's order again")
    }

    private static func modulesOrderPersistence() {
        let suite = "scoreline-tests-module-order"
        guard let defaults = UserDefaults(suiteName: suite) else { return check(false, "a defaults suite for the order") }
        defaults.removePersistentDomain(forName: suite)
        defer { defaults.removePersistentDomain(forName: suite) }
        // Dragged live: Box Score to the top of the page.
        let livePage = DetailView.order(nbaRef, .live).map(sectionID)
        let dragged = ModuleOrder.move("box", to: 0, in: livePage)
        do {
            let store = ScoreStore(defaults: defaults)
            store.modules.rank(dragged, on: .nba)
            store.modules.fold(.court, on: .nba, true)
        }
        // Quit and relaunch (or close and reopen the panel): a new store from the same defaults.
        let relaunched = ScoreStore(defaults: defaults)
        check(relaunched.modules.ranking(on: .nba) == dragged && relaunched.modules.isFolded(.court, on: .nba),
              "the order survives a relaunch: a new store reads the same order back", "\(relaunched.modules.ranking(on: .nba))")
        let final = relaunched.modules.shown(DetailView.order(nbaRef, .final), on: .nba)
        check(final.first == .box, "live → final: the dragged order carries to the final", "\(final)")
        // Hiding, folding and showing never reset it; only Restore Defaults does.
        relaunched.modules.hide(.box, on: .nba, true)
        relaunched.modules.hide(.box, on: .nba, false)
        relaunched.modules.fold(.court, on: .nba, false)
        check(ScoreStore(defaults: defaults).modules.ranking(on: .nba) == dragged, "hiding, showing and folding keep the order")
        relaunched.modules.restoreDefaults(on: .nba)
        check(ScoreStore(defaults: defaults).modules.ranking(on: .nba).isEmpty
              && (defaults.dictionary(forKey: ModuleKeys.order) as? [String: [String]])?["nba"] == nil,
              "Restore Defaults clears the saved order")
    }
}
