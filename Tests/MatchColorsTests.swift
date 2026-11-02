import SwiftUI

// One game's colors, decided once: real matchups with ESPN's real values. Home
// keeps its kit; away changes on a clash; the chart and the field agree about
// who is who, in both appearances.

extension ScorelineTests {
    static func matchColors() {
        print("\nMatch colors")

        /// A real game: ESPN's team colors (and the match-day kits where the summary has them).
        struct Game {
            let name: String
            let top: TeamKit, bottom: TeamKit
            var topKit: TeamKit?, bottomKit: TeamKit?
            let home: GameDetail.Side
            /// What each side is wearing once it's decided.
            let wears: (top: String, bottom: String)
            var colors: MatchColors { MatchColors(top: top, bottom: bottom, topKit: topKit, bottomKit: bottomKit, home: home) }
        }
        let games = [
            // The NFL lists the visitors first.
            Game(name: "ATL @ TB", top: TeamKit(color: "a71930", alternate: "000000"), bottom: TeamKit(color: "bd1c36", alternate: "3e3a35"),
                 home: .bottom, wears: ("000000", "bd1c36")),
            Game(name: "CLE @ PIT", top: TeamKit(color: "472a08", alternate: "ff3c00"), bottom: TeamKit(color: "000000", alternate: "ffb612"),
                 home: .bottom, wears: ("ff3c00", "000000")),
            Game(name: "CHI @ SEA", top: TeamKit(color: "0b1c3a", alternate: "e64100"), bottom: TeamKit(color: "002a5c", alternate: "69be28"),
                 home: .bottom, wears: ("e64100", "002a5c")),
            Game(name: "BAL @ BUF", top: TeamKit(color: "29126f", alternate: "000000"), bottom: TeamKit(color: "00338d", alternate: "d50a0a"),
                 home: .bottom, wears: ("000000", "00338d")),
            // Soccer lists the home side first. Arsenal's third kit at Anfield, November 1.
            Game(name: "ARS @ LIV, kits posted", top: TeamKit(color: "d11317", alternate: "FFFFFF"), bottom: TeamKit(color: "e20520", alternate: "003399"),
                 topKit: TeamKit(color: "ff0000"), bottomKit: TeamKit(color: "fceec1", alternate: "1b4879"), home: .top, wears: ("ff0000", "fceec1")),
            Game(name: "ARS @ LIV, before the lineups", top: TeamKit(color: "d11317", alternate: "FFFFFF"), bottom: TeamKit(color: "e20520", alternate: "003399"),
                 home: .top, wears: ("d11317", "003399")),
            Game(name: "BOU @ MUN", top: TeamKit(color: "da020e", alternate: "4169E1"), bottom: TeamKit(color: "f42727", alternate: "B57EDC"),
                 home: .top, wears: ("da020e", "B57EDC")),
            // Both in white as ESPN has them: Palace change into their kit's second color.
            Game(name: "CRY @ FUL, kits posted", top: TeamKit(color: "ffffff", alternate: "CC0000"), bottom: TeamKit(color: "0202fb", alternate: "000000"),
                 topKit: TeamKit(color: "ffffff", alternate: "000000"), bottomKit: TeamKit(color: "f8f8ff", alternate: "0a7fcc"), home: .top,
                 wears: ("ffffff", "0a7fcc")),
        ]

        /// A mark and a jersey are the same color family: both without a hue, or the same hue.
        func family(_ mark: Color, _ jersey: Color) -> Bool {
            guard let shirt = OKLab(NSColor(jersey)) else { return false }
            if mark == Viz.neutral { return shirt.chroma < 0.03 }
            guard let drawn = OKLab(NSColor(mark)) else { return false }
            if drawn.chroma < 0.03 || shirt.chroma < 0.03 { return drawn.chroma < 0.03 && shirt.chroma < 0.03 }
            var hues = abs(drawn.hue - shirt.hue)
            if hues > 180 { hues = 360 - hues }
            return hues < 16
        }
        for game in games {
            let colors = game.colors
            check(colors.top.color == game.wears.top && colors.bottom.color == game.wears.bottom,
                  "\(game.name): each side wears what the rule says", "\(colors.top.color ?? "nil") / \(colors.bottom.color ?? "nil")")
            let homeSide = game.home == .top ? colors.top : colors.bottom
            let homeKit = game.home == .top ? game.topKit ?? game.top : game.bottomKit ?? game.bottom
            check(homeSide.wear == .own && homeSide.color == homeKit.color, "\(game.name): home keeps its kit")
            check(colors.top.identity == game.top && colors.bottom.identity == game.bottom, "\(game.name): the clubs' own colors stay for the wash")
            for scheme in [ColorScheme.dark, .light] {
                let chart = colors.palette(scheme), field = TheaterTeams.dress(colors, scheme: scheme)
                check(family(chart.top, field.top.jersey) && family(chart.bottom, field.bottom.jersey),
                      "\(game.name), \(scheme): the chart and the field draw each team in the same color")
                check(!family(chart.top, field.bottom.jersey) || !family(chart.bottom, field.top.jersey),
                      "\(game.name), \(scheme): the chart and the field never name opposite teams")
                if let top = OKLab(NSColor(field.top.jersey)), let bottom = OKLab(NSColor(field.bottom.jersey)) {
                    check(top.distance(to: bottom) >= MatchColors.apart, "\(game.name), \(scheme): the two sides read apart on the field",
                          String(format: "%.3f", top.distance(to: bottom)))
                }
                let tags = TheaterLabels.make(kits: colors, scheme: scheme, teams: ("A", "B"))
                check(tags.top.paint.slab.distance(to: tags.bottom.paint.slab) >= MatchColors.apart, "\(game.name), \(scheme): their tags read apart too")
            }
        }

        // The Steelers are black in both appearances, not gold in one of them.
        let pit = games[1].colors
        for scheme in [ColorScheme.dark, .light] {
            check(OKLab(NSColor(TheaterTeams.dress(pit, scheme: scheme).bottom.jersey))!.l < 0.35, "\(scheme): black stays black with a visible outline")
        }
        // A white club is white on the field, and an honest gray mark on a light chart.
        let fulham = games[7].colors
        check(OKLab(NSColor(TheaterTeams.dress(fulham, scheme: .light).top.jersey))!.l > 0.9 && fulham.palette(.light).top == Viz.neutral,
              "white stays white on the field")
        // Nothing to change into: white, or charcoal against a pale home kit.
        let navies = MatchColors(top: TeamKit(color: "13294b"), bottom: TeamKit(color: "092c5c"))
        check(navies.top.color == MatchColors.white && navies.top.wear == .contrast && navies.bottom.wear == .own,
              "two navies with nothing to change into: the visitors in white, their color at the cap")
        let golds = MatchColors(top: TeamKit(color: "fdb827"), bottom: TeamKit(color: "ffc52f"))
        check(golds.top.color == MatchColors.charcoal, "two golds: the visitors in charcoal")

        // ESPN's match-day kits: in the rosters, or the box score's teams.
        let event = Event(id: "espn-401879246", content: .match(top: comp("espn-soccer-364", "Liverpool", color: "d11317"),
                                                               bottom: comp("espn-soccer-359", "Arsenal", color: "e20520")),
                          state: .live, start: .now, detail: "10'", caption: nil, link: nil, ref: .espn(path: "soccer/eng.1", id: "401879246", sport: .soccer))
        let header: [String: Any] = ["competitions": [["competitors": [
            ["homeAway": "home", "team": ["id": "364", "color": "d11317", "alternateColor": "FFFFFF"]],
            ["homeAway": "away", "team": ["id": "359", "color": "e20520", "alternateColor": "003399"]],
        ]]]]
        let rosters = ESPNDetail.parse(summary: JSON(["header": header, "rosters": [
            ["team": ["id": "364"], "uniform": ["type": "home", "color": "ff0000"]],
            ["team": ["id": "359"], "uniform": ["type": "third", "color": "fceec1", "alternateColor": "1b4879"]],
        ]]), board: nil, path: "soccer/eng.1", id: "401879246", sport: .soccer, event: event)
        check(rosters.matchKits["espn-soccer-364"] == TeamKit(color: "ff0000") && rosters.matchKits["espn-soccer-359"] == TeamKit(color: "fceec1", alternate: "1b4879"),
              "the summary's rosters say what each side wears; `type` names the kit, not the side")
        let box = ESPNDetail.parse(summary: JSON(["header": header, "boxscore": ["teams": [
            ["team": ["id": "359", "uniform": ["type": "third", "color": "fceec1", "alternateColor": "1b4879"]]],
        ]]]), board: nil, path: "soccer/eng.1", id: "401879246", sport: .soccer, event: event)
        check(box.matchKits["espn-soccer-359"]?.color == "fceec1" && box.matchKits["espn-soccer-364"] == nil, "or the box score's teams; a side without one wears its team's color")
        let arsenal = MatchColors(rosters.colored(event), topIsHome: true)
        check(arsenal.bottom.color == "fceec1" && arsenal.bottom.identity.color == "e20520", "the page reads the kit for marks and the club's color for the wash")

        // Lineups post about 40 minutes before kickoff: taken once then; never a change mid-game.
        func state(_ state: EventState) -> Event { Event(id: "espn-kit-test", content: event.content, state: state, start: .now, detail: nil, caption: nil, link: nil, ref: event.ref) }
        var summary = GameDetail()
        let before = TeamColors.shared.note(summary, for: state(.scheduled))
        check(before.matchKits.isEmpty, "before the lineups: team colors")
        summary.matchKits = ["espn-soccer-359": TeamKit(color: "fceec1")]
        check(TeamColors.shared.note(summary, for: state(.scheduled)).matchKits == summary.matchKits, "the lineups post: the real kit, before the game")
        var changed = summary
        changed.matchKits = ["espn-soccer-359": TeamKit(color: "003399")]
        check(TeamColors.shared.note(changed, for: state(.live)).matchKits == summary.matchKits, "kickoff: what's held stands, whatever a later summary says")
        func lateState(_ state: EventState) -> Event { Event(id: "espn-kit-test-late", content: event.content, state: state, start: .now, detail: nil, caption: nil, link: nil, ref: event.ref) }
        check(TeamColors.shared.note(GameDetail(), for: lateState(.live)).matchKits.isEmpty && TeamColors.shared.note(summary, for: lateState(.live)).matchKits.isEmpty,
              "no kit by kickoff: the game keeps its team colors for good")
    }
}
