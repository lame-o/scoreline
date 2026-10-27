import Foundation
import SwiftUI

// The docked scorebar's rules: scroll-linked progress and transforms, which
// surface owns the scoreboard's beats, when the football is tossed, when the
// bar takes the news line, how much fits at each width, and what it shows.

extension ScorelineTests {
    static func dock() {
        print("\nDocked scorebar")

        // Progress (spec §2.2): start = Y + H/4, travel = max(3H/4 − 4, 24), steps of 1/64.
        let p = { (y: CGFloat) in DockRules.progress(offset: y, heroMinY: 6, heroHeight: 128) }
        check(p(0) == 0 && p(6 + 32) == 0, "no docking until a quarter of the hero is under the header")
        check(p(6 + 32 + 92) == 1 && p(3000) == 1, "fully docked three quarters of its height later, and stays")
        check(p(6 + 32 + 46) == 0.5, "halfway through the travel is 0.5")
        let samples = stride(from: CGFloat(0), through: 200, by: 0.7).map(p)
        check(zip(samples, samples.dropFirst()).allSatisfy { $0 <= $1 }, "monotonic as the page scrolls")
        check(samples.allSatisfy { ($0 * 64).rounded() == $0 * 64 }, "quantized to 1/64")
        check(Set(samples).count <= 65, "at most 65 distinct values across the travel", "\(Set(samples).count)")
        let tiny = { (y: CGFloat) in DockRules.progress(offset: y, heroMinY: 0, heroHeight: 20) }
        check(tiny(5 + 12) == 0.5 && tiny(5 + 24) == 1, "a tiny hero still travels at least 24pt")
        check(DockRules.progress(offset: -30, heroMinY: 6, heroHeight: 128) == 0, "an overscroll bounce stays at 0")

        check(DockRules.surface(p: 0.49) == .hero && DockRules.surface(p: 0.5) == .bar && DockRules.surface(p: 0) == .hero,
              "the hero owns the scoreboard below 0.5, the bar from 0.5")

        // The bar's transforms (spec §2.4) and the hero's tuck (§2.3).
        check(DockRules.barOpacity(0) == 0 && DockRules.barOpacity(0.25) == 0 && DockRules.barOpacity(1) == 1
              && DockRules.barOpacity(0.5) > 0.1 && DockRules.barOpacity(0.5) < 0.3 && DockRules.barOpacity(0.75) > 0.7,
              "bar opacity: smoothstep from 0.35 to 0.9, already showing as it takes the scoreboard at 0.5")
        // No stretch of scroll where neither scoreboard is visible.
        let tuckAt = { (p: Double) in DockRules.heroTuck(minY: 6 - (6 + 30 + CGFloat(p) * 86), height: 120).opacity }
        check(stride(from: 0.0, through: 1, by: 1.0 / 64).allSatisfy { max(tuckAt($0), DockRules.barOpacity($0)) > 0.04 },
              "the hero or the bar is always showing as the page scrolls", "\(stride(from: 0.0, through: 1, by: 1.0 / 64).map { max(tuckAt($0), DockRules.barOpacity($0)) }.min() ?? 0)")
        check(DockRules.barScale(0) == 0.96 && DockRules.barScale(1) == 1 && DockRules.barOffset(0) == -6 && DockRules.barOffset(1) == 0,
              "bar settles from 96% and 6pt up, never from nothing")
        let rest = DockRules.heroTuck(minY: 6, height: 120), gone = DockRules.heroTuck(minY: -90, height: 120)
        let mid = DockRules.heroTuck(minY: -45, height: 120)
        check(rest.scale == 1 && rest.opacity == 1, "hero at rest: untouched")
        check(abs(gone.scale - 0.94) < 0.0001 && gone.opacity == 0, "hero three quarters under: 94%, faded out")
        check(mid.scale < 1 && mid.scale > 0.94 && mid.opacity > 0 && mid.opacity < 1, "hero halfway: shrinking and fading")

        // Possession (spec §6.1).
        func toss(_ from: GameDetail.Side?, _ to: GameDetail.Side?, _ kind: LiveMoment.Kind? = .turnover, age: TimeInterval = 0.4,
                  field: PageGeometry.Visibility? = .hidden(.above), level: CelebrationLevel = .full, rm: Bool = false,
                  live: Bool = true, catchUp: Bool = false, resizing: Bool = false) -> DockRules.PossessionMotion {
            DockRules.shouldToss(change: (from, to), moment: kind.map { (kind: $0, age: age) }, fieldVisibility: field, level: level,
                                 reduceMotion: rm, live: live, catchUp: catchUp, resizing: resizing)
        }
        check(toss(.top, .bottom) == .toss(rise: 12, spins: true, knocks: true), "a turnover with the field off screen tosses the ball")
        check(toss(.top, .bottom, field: nil) == .toss(rise: 12, spins: true, knocks: true), "no field section on the page: the bar tosses")
        check(toss(.top, .bottom, field: .visible) == .glide, "a turnover with the field in view glides (the field plays the turnover)")
        check(toss(.top, .bottom, .passComplete) == .glide && toss(.top, .bottom, nil) == .glide, "a punt or kickoff glides")
        check(toss(.top, .bottom, age: 3) == .glide, "a turnover older than two seconds isn't this change")
        check(toss(.top, .bottom, catchUp: true) == .none, "a catch-up batch does nothing")
        check(toss(.top, .bottom, rm: true) == .fade, "Reduce Motion fades the glyph across")
        check(toss(.top, .bottom, level: .subtle) == .toss(rise: 6, spins: false, knocks: false), "Subtle: a lower arc, no spin, no knock")
        check(toss(.top, .bottom, level: .off) == .glide, "Off: a plain glide")
        check(toss(nil, .bottom) == .none && toss(.top, nil) == .none && toss(.top, .top) == .none,
              "first possession, possession ending, or no change: nothing travels")
        check(toss(.top, .bottom, live: false) == .none && toss(.top, .bottom, resizing: true) == .none,
              "never on a game that isn't live, never mid-resize")

        // The toss path: FlightArc flattened to a low arc.
        let a = CGPoint(x: 40, y: 20), b = CGPoint(x: 160, y: 20)
        let apex = PossessionToss.point(0.5, from: a, to: b, rise: 12)
        check(PossessionToss.point(0, from: a, to: b, rise: 12) == a && PossessionToss.point(1, from: a, to: b, rise: 12) == b,
              "the toss starts and lands exactly on the slots")
        check(abs(apex.x - 100) < 0.001 && abs(apex.y - 8) < 0.001, "its apex rises 12pt at the middle", "\(apex)")
        check(PossessionToss.point(0.5, from: a, to: b, rise: 0) == CGPoint(x: 100, y: 20), "a glide stays on the line")
        let full = PossessionToss.timeline(.toss(rise: 12, spins: true, knocks: true))
        let end = full.value(time: 0.5), begin = full.value(time: 0)
        check(begin.progress == 0 && abs(end.progress - 1) < 0.0001 && abs(end.spin - 450) < 0.0001,
              "0.5 s: lands with a turn and a quarter of spin")
        check(abs(full.value(time: 0.25).spin - 225) < 0.01 && full.value(time: 0.1).progress < 0.1,
              "spin on linear time, travel eased in and out")
        let glide = PossessionToss.timeline(.glide)
        check(abs(glide.value(time: 0.45).progress - 1) < 0.0001 && glide.value(time: 0.45).spin == 0, "a glide settles without spinning")

        // News line (spec §6.2): only when the moment's chart can't be seen.
        let charts: [LiveMoment.Chart] = [.field, .pitch, .plate, .spray, .rounds, .wall, .ascent, .boulder, .court]
        let sections: [DetailView.Section] = [.field, .pitch, .atPlate, .battedBalls, .rounds, .wall, .ascent, .scorecard, .court]
        check(charts.map(DockRules.section(for:)) == sections, "each chart's moments belong to its section")
        for chart in charts {
            let m = LiveMoment(id: "m", chart: chart, tier: .swing, kind: .goal, lead: "Lead", detail: "Detail")
            let shows = { (v: PageGeometry.Visibility?) in DockRules.newsLine(moment: m, chartVisibility: v) != nil }
            check(shows(nil) && shows(.hidden(.above)) && shows(.hidden(.below)) && shows(.partial(.below))
                  && !shows(.visible) && !shows(.partial(.above)),
                  "news line for \(chart): only while its caption is out of view")
        }
        let routine = LiveMoment(id: "r", chart: .court, tier: .routine, kind: .missed, lead: "Miss", detail: "")
        check(DockRules.newsLine(moment: routine, chartVisibility: nil) == nil, "routine moments have no caption, so no news line")
        var pass = LiveMoment(id: "p", chart: .ascent, tier: .swing, kind: .passed, lead: "Passes", detail: "")
        pass.targets = ["1", "2"]
        check(DockRules.passBeat(moment: pass, ascentVisibility: .hidden(.above)) == 2
              && DockRules.passBeat(moment: pass, ascentVisibility: .visible) == nil, "a pass off screen: the bar's place pill shows +2")

        // Width tiers (spec §3.3).
        check(DockRules.accessoryTier(widthClass: .compact, topDigits: 3, bottomDigits: 3) == .none,
              "340 with two three-digit scores: the accessory drops before anything truncates")
        check(DockRules.accessoryTier(widthClass: .compact, topDigits: 3, bottomDigits: 2) == .glyph
              && DockRules.accessoryTier(widthClass: .medium, topDigits: 3, bottomDigits: 3) == .text
              && DockRules.accessoryTier(widthClass: .large, topDigits: 2, bottomDigits: 2) == .full
              && DockRules.accessoryTier(widthClass: .xlarge, topDigits: 1, bottomDigits: 1) == .full,
              "one glyph at 340, short text from 380, fuller text from 460")

        check(DockRules.inning("Top 7th") == "▲7" && DockRules.inning("Bot 9th") == "▼9" && DockRules.inning("Mid 3rd") == "Mid 3"
              && DockRules.inning("End 1st") == "End 1" && DockRules.inning("Delayed") == "Delayed", "innings in two characters")
        check(DockRules.downAndSpot("3rd & 7 at SF 25").map { "\($0.down)|\($0.spot ?? "")" } == "3rd & 7|at SF 25"
              && DockRules.downAndSpot("1st & Goal")?.spot == nil && DockRules.downAndSpot(nil) == nil, "down and distance, then the spot")
        check(DockRules.chip(clutch: true, twoMinuteDrill: true, mapPoint: true, run: "10–2 run") == .state("CLUTCH")
              && DockRules.chip(clutch: false, twoMinuteDrill: true, mapPoint: true, run: nil) == .state("2-MIN DRILL")
              && DockRules.chip(clutch: false, twoMinuteDrill: false, mapPoint: true, run: "x") == .state("MAP POINT")
              && DockRules.chip(clutch: false, twoMinuteDrill: false, mapPoint: false, run: "10–2 run") == .run("10–2 run"),
              "one chip at a time, pressure first")

        // What the bar shows.
        func team(_ id: String, _ abbr: String, _ score: String?, winner: Bool = false) -> Competitor {
            Competitor(id: id, name: abbr, abbreviation: abbr, score: score, logo: nil, isWinner: winner)
        }
        let nfl = Event(id: "nfl", content: .match(top: team("a", "KC", "17"), bottom: team("b", "BUF", "21")), state: .live, start: .now,
                        detail: "4:12 - 3rd", caption: nil, link: nil, ref: .espn(path: "football/nfl", id: "1", sport: .football))
        var inputs = DockInputs(event: nfl, detail: GameDetail(), colors: (.red, .blue), scores: ("17", "21"))
        inputs.football = GameDetail.Football(downDistance: "2nd & 6 at BUF 14", ballX: 86, lineToGainX: 92, possession: .top,
                                              redZone: true, topTimeouts: 3, bottomTimeouts: 2, lastPlay: nil)
        inputs.possession = .top
        inputs.clockFallback = "4:12 - 3rd"
        let bar = DockBar.make(inputs)
        check(bar.possession == .top && bar.possessionSymbol == "football.fill", "NFL live: the football by the team with the ball")
        check(bar.detail == .football(down: "2nd & 6", spot: "at BUF 14", redZone: true), "NFL live: down and distance, the spot, red zone")
        check(bar.status == .live(clock: nil, fallback: "4:12 - 3rd") && bar.top?.score == "17", "the hero's clock and numbers")
        inputs.twoMinuteDrill = true
        check(DockBar.make(inputs).chip == .state("2-MIN DRILL"), "the two-minute drill chip")

        let final = Event(id: "f", content: .match(top: team("a", "LAL", "112", winner: true), bottom: team("b", "BKN", "108")),
                          state: .final, start: .now, detail: "Final/OT", caption: nil, link: nil,
                          ref: .espn(path: NBADetail.path, id: "2", sport: .basketball))
        let finalBar = DockBar.make(DockInputs(event: final, detail: nil, colors: (.red, .blue), scores: (nil, nil)))
        check(finalBar.bottom?.dimmed == true && finalBar.top?.dimmed == false && finalBar.status == .final("Final, overtime")
              && finalBar.possessionSymbol == nil && finalBar.chip == nil, "a final: the loser dimmed, no live parts")
        check(DockBar.finalText("FT") == "Full time" && DockBar.finalText(nil) == "Final" && DockBar.finalText("Final/2OT") == "Final/2OT"
              && DockBar.finalText("AET") == "AET" && DockBar.finalText("FT-Pens") == "After penalties",
              "a final's status: words while they're short, the source's compact form when they aren't")
        let draw = Event(id: "d", content: .match(top: team("a", "ARS", "1"), bottom: team("b", "CHE", "1")),
                         state: .final, start: .now, detail: "FT", caption: nil, link: nil, ref: .espn(path: "soccer/eng.1", id: "3", sport: .soccer))
        let drawBar = DockBar.make(DockInputs(event: draw, detail: nil, colors: (.red, .blue), scores: (nil, nil)))
        check(drawBar.top?.dimmed == false && drawBar.bottom?.dimmed == false, "a draw: nobody steps back (the hero's rule)")
        check(finalBar.digits == (3, 3), "digits counted for the 340 tier")

        let start = Date(timeIntervalSince1970: 2_000_000_000)
        let upcoming = Event(id: "u", content: .match(top: team("a", "LAL", nil), bottom: team("b", "BKN", nil)), state: .scheduled,
                             start: start, detail: nil, caption: nil, link: nil)
        check(DockBar.make(DockInputs(event: upcoming, detail: nil, colors: (.red, .blue), scores: (nil, nil))).status
              == .upcoming(start: start, hasTeams: true), "upcoming: the start")
        let postponed = Event(id: "pp", content: upcoming.content, state: .scheduled, start: start, detail: "Postponed", caption: nil, link: nil)
        check(DockBar.make(DockInputs(event: postponed, detail: nil, colors: (.red, .blue), scores: (nil, nil))).status == .note("Postponed"),
              "postponed: the source's words, no countdown")

        var csDetail = GameDetail()
        csDetail.csLive = GameDetail.CSLive(mapName: "Mirage", mapNumber: 2, round: 24, topScore: 12, bottomScore: 11,
                                            topSide: nil, bottomSide: nil, mapEnded: false)
        let cs = Event(id: "cs-1", content: .match(top: team("x", "VIT", "1"), bottom: team("y", "NAVI", "0")), state: .live, start: .now,
                       detail: nil, caption: nil, link: nil, ref: .counterStrike(slug: "s", tournament: nil))
        let csBar = DockBar.make(DockInputs(event: cs, detail: csDetail, colors: (.red, .blue), scores: (nil, nil)))
        check(csBar.status == .liveText("Mirage 12–11") && csBar.detail == .cs(round: 24) && csBar.chip == .state("MAP POINT"),
              "CS2: the map's score in the status, the round, MAP POINT")

        var soccer = GameDetail()
        soccer.moments = [GameDetail.Moment(id: "r1", kind: .red, clock: "33'", text: "Red", side: .bottom),
                          GameDetail.Moment(id: "r2", kind: .red, clock: "71'", text: "Red", side: .bottom),
                          GameDetail.Moment(id: "y", kind: .yellow, clock: "12'", text: "Yellow", side: .top)]
        let match = Event(id: "s", content: .match(top: team("a", "ARS", "1"), bottom: team("b", "CHE", "0")), state: .live, start: .now,
                          detail: "74'", caption: nil, link: nil, ref: .espn(path: "soccer/eng.1", id: "3", sport: .soccer))
        let soccerBar = DockBar.make(DockInputs(event: match, detail: soccer, colors: (.red, .blue), scores: (nil, nil)))
        check(soccerBar.top?.redCards == 0 && soccerBar.bottom?.redCards == 2, "soccer: red cards by team (yellows don't count)")

        var climb = GameDetail()
        climb.roundName = "Final"
        climb.wall = [GameDetail.WallRoute(name: "1", climbers: [
            GameDetail.WallRoute.Climber(id: 1, name: "J. Garnbret", country: "SLO", flag: "🇸🇮", height: 40, top: false, label: "40", rank: 1),
            GameDetail.WallRoute.Climber(id: 2, name: "A. Grossman", country: "USA", flag: "🇺🇸", height: 28.5, top: false, label: "28+",
                                         rank: nil, onWall: true),
            GameDetail.WallRoute.Climber(id: 3, name: "O. Mori", country: "JPN", flag: "🇯🇵", height: 25, top: false, label: "25", rank: 2),
        ], total: 8)]
        let field = Event(id: "c", content: .field(title: "Women's Lead", summary: ""), state: .live, start: .now, detail: nil, caption: nil,
                          link: nil, ref: .climbing(eventID: 1, category: "Lead Women", resultURL: nil, round: "Final", eventName: "", nextURL: nil))
        let climber = DockBar.make(DockInputs(event: field, detail: climb, colors: (.red, .blue), scores: (nil, nil))).climber
        check(climber == DockBar.Climber(flag: "🇺🇸", name: "Grossman", height: "28+", place: 2),
              "climbing: the climber on the wall, their high point and place", "\(String(describing: climber))")
        climb.wall = [GameDetail.WallRoute(name: "1", climbers: climb.wall[0].climbers.map { var c = $0; c.onWall = false; return c }, total: 8)]
        climb.upNext = GameDetail.UpNext(name: "N. Pan", flag: "🇺🇸", position: 4, total: 8)
        check(DockBar.climber(climb, state: .live) == DockBar.Climber(prefix: "Up next", flag: "🇺🇸", name: "Pan"), "between climbers: up next")
        climb.ranking = [GameDetail.Athlete(id: 1, rank: 1, name: "J. Garnbret", country: "SLO", score: "40")]
        check(DockBar.climber(climb, state: .final)?.prefix == "Winner" && DockBar.climber(climb, state: .final)?.name == "Garnbret",
              "after the round: the winner")
    }
}
