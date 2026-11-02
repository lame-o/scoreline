import AppKit
import Foundation
import SwiftUI

/// A real game as the page has it: the same parser, the same marks, its market.
struct TimelineGame {
    let name: String
    let event: Event
    let detail: GameDetail
    let market: OddsMarket
    let series: [OddsMarket.Outcome: [OddsPoint]]
    let names: (top: String, bottom: String)

    var history: MatchHistory { detail.history ?? MatchHistory(sport: .soccer) }

    /// The page at `fraction` of the game: what's been presented, as a live page has it.
    func live(at fraction: Double) -> (game: TimelineGame, now: Date) {
        let start = history.start ?? event.start, end = history.end ?? start
        let now = start + end.timeIntervalSince(start) * fraction
        var d = detail
        d.history = history.shown(until: now)
        let told = Set(d.history?.events.map(\.id) ?? [])
        d.moments = d.moments.filter { told.contains(Replays.play(of: $0.id)) }
        let e = Event(id: event.id, content: event.content, state: .live, start: event.start, detail: nil, caption: nil, link: nil, ref: event.ref)
        return (TimelineGame(name: name, event: e, detail: d, market: market, series: series.mapValues { $0.filter { $0.t <= now } }, names: names), now)
    }
}

@MainActor
func timelineGames() -> [TimelineGame] {
    func json(_ name: String) -> JSON { JSON(data: (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent(name))) ?? Data()) }
    func team(_ id: String, _ code: String, _ color: String, _ sport: String) -> Competitor {
        Competitor(id: "espn-\(sport)-\(id)", name: code, abbreviation: code, score: nil, logo: nil, isWinner: false, color: color)
    }
    func game(_ name: String, id: String, path: String, sport: Sport, top: Competitor, bottom: Competitor, summary: JSON,
              tokens: [(String, OddsMarket.Outcome)], series: [OddsMarket.Outcome: [OddsPoint]]?) -> TimelineGame {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let event = Event(id: "espn-\(id)", content: .match(top: top, bottom: bottom), state: .final, start: start, detail: nil, caption: nil, link: nil,
                          ref: .espn(path: path, id: id, sport: sport))
        let detail = ESPNDetail.parse(summary: summary, board: nil, path: path, id: id, sport: sport, event: event)
        let market = OddsMarket(eventID: id, slug: id, tokens: tokens.map { .init(id: $0.0, outcome: $0.1) }, start: start)
        // A market where there's no recording: a plain line over the game.
        let span = detail.history.flatMap { h in h.start.flatMap { a in h.end.map { a...$0 } } } ?? start...(start + 3600)
        let flat = stride(from: span.lowerBound.timeIntervalSince1970, through: span.upperBound.timeIntervalSince1970, by: 60).map {
            OddsPoint(t: Date(timeIntervalSince1970: $0), p: 0.4 + 0.2 * sin($0 / 900))
        }
        return TimelineGame(name: name, event: event, detail: detail, market: market, series: series ?? [.top: flat], names: (top.abbreviation, bottom.abbreviation))
    }
    let eplHistory = json("odds/pm-epl-mun-bou-history.json")
    let eplTokens = eplHistory.raw.flatMap { ($0 as? [String: Any]).map { Array($0.keys).sorted() } } ?? []
    var eplSeries: [OddsMarket.Outcome: [OddsPoint]] = [:]
    for (key, outcome) in zip(eplTokens, [OddsMarket.Outcome.top, .draw, .bottom]) {
        eplSeries[outcome] = Polymarket.history(JSON(["history": eplHistory[key].raw ?? []]))
    }
    // The NBA's whole game, every field Key Plays reads; its plays a steady 20 seconds apart.
    let nbaFixture = json("nba-plays-401909095.json")
    let nbaHome = nbaFixture["home"].string ?? "", nbaAway = nbaFixture["away"].string ?? ""
    let nbaHeader: [String: Any] = ["competitions": [["competitors": [["team": ["id": nbaAway], "homeAway": "away"], ["team": ["id": nbaHome], "homeAway": "home"]]]]]
    let nbaPlays: [[String: Any]] = nbaFixture["items"].array.enumerated().compactMap { index, play in
        guard var raw = play.raw as? [String: Any] else { return nil }
        raw["wallclock"] = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: 1_800_000_000 + Double(index) * 20))
        return raw
    }
    let mlbHeader: [String: Any] = ["competitions": [["competitors": [["team": ["id": "8"], "homeAway": "away"], ["team": ["id": "30"], "homeAway": "home"]]]]]
    return [
        game("soccer", id: "401879252", path: "soccer/eng.1", sport: .soccer, top: team("360", "MUN", "DA291C", "soccer"), bottom: team("349", "BOU", "000000", "soccer"),
             summary: json("odds/espn-epl-401879252.json"), tokens: zip(eplTokens, [OddsMarket.Outcome.top, .draw, .bottom]).map { ($0, $1) }, series: eplSeries),
        game("NFL", id: "401873029", path: "football/nfl", sport: .football, top: team("13", "LV", "A5ACAF", "football"), bottom: team("20", "NYJ", "115740", "football"),
             summary: json("odds/espn-nfl-401873029.json"), tokens: [("nfl", .top)], series: nil),
        game("NBA", id: "401909095", path: "basketball/nba", sport: .basketball, top: team(nbaAway, "AWAY", "FDB927", "basketball"), bottom: team(nbaHome, "HOME", "236192", "basketball"),
             summary: JSON(["plays": nbaPlays, "header": nbaHeader]), tokens: [("nba", .top)], series: nil),
        game("MLB", id: "401908046", path: "baseball/mlb", sport: .baseball, top: team("8", "MIL", "12284B", "baseball"), bottom: team("30", "TB", "8FBCE6", "baseball"),
             summary: JSON(["plays": json("ws-g5-plays.json")["items"].array.compactMap(\.raw), "header": mlbHeader]), tokens: [("mlb", .top)], series: nil)
    ]
}

extension ScorelineTests {
    static func matchTimeline() {
        print("\nMatch timeline")
        timelineMarks()
        timelineAxes()
        timelineAlignment()
    }

    // MARK: What's plotted

    private static func timelineMarks() {
        let games = Dictionary(uniqueKeysWithValues: timelineGames().map { ($0.name, $0) })
        guard let soccer = games["soccer"], let nfl = games["NFL"], let nba = games["NBA"], let mlb = games["MLB"] else {
            return check(false, "the recorded games load")
        }
        let goals = soccer.detail.timelineMarks.filter { $0.moment.kind == .goal }
        check(goals.count == 3 && soccer.detail.timelineMarks.count == soccer.detail.moments.count && soccer.detail.timelineMarks.allSatisfy { $0.t != nil },
              "soccer plots its goals and cards, by the same IDs as Key Events, on the wall clock")
        let nbaMarks = nba.detail.timelineMarks
        let scoringPlays = nba.history.events.count
        check(!nbaMarks.isEmpty && nbaMarks.count < 40 && nbaMarks.allSatisfy { $0.moment.kind == .score && $0.t != nil && $0.moment.side != nil },
              "the NBA plots the curated Key Plays, never every basket", "\(nbaMarks.count) of \(scoringPlays) plays")
        let plotted = Set(nbaMarks.map(\.id))
        check(plotted == Set(nba.detail.moments.filter { $0.kind != .other }.map(\.id)),
              "every Key Play but a period's end is a mark; a period's end is a landmark")
        let nflKinds = nfl.detail.timelineMarks.map(\.moment.kind)
        check(nflKinds.filter { $0 == .score }.count == 13 && nflKinds.filter { $0 == .turnover }.count == 1,
              "football plots its scoring plays and turnovers", "\(nflKinds)")
        check(nfl.detail.timelineMarks.first { $0.moment.kind == .turnover }?.moment.side == .bottom,
              "a turnover in the lane of the team that gave the ball away")
        check(mlb.detail.timelineMarks.count == 5 && mlb.detail.timelineMarks.allSatisfy { $0.moment.kind == .score && $0.moment.side != nil },
              "baseball plots its runs, each in the batting team's lane")
        let times = nfl.detail.timelineMarks.compactMap(\.t)
        check(zip(times, times.dropFirst()).allSatisfy { $0 <= $1 }, "marks in time order, what ⌥←/→ walks")

        // A provider with no wall clock: match minutes, and only what has a minute.
        var untimed = soccer.detail
        untimed.history = MatchHistory(sport: .soccer)
        untimed.moments = [GameDetail.Moment(id: "g", kind: .goal, clock: "38'", text: "A Goal", side: .top, minute: 38),
                           GameDetail.Moment(id: "n", kind: .goal, clock: "", text: "No minute", side: .top)]
        check(untimed.timelineMarks.map(\.id) == ["g"] && untimed.timelineMarks[0].t == nil,
              "no timestamps: soccer's marks stay on their minutes")
        // A goal missing only its wall time still lands, by its half's own kickoff.
        var partial = soccer.detail
        partial.moments = [GameDetail.Moment(id: "untimed", kind: .goal, clock: "38'", text: "A Goal", side: .top, minute: 38)]
        check(partial.timelineMarks.first?.t == (soccer.history.start ?? .now) + 38 * 60,
              "a goal without a wall time is placed by its minute, from its half's kickoff")

        let clock = SoccerClock(start: soccer.history.start ?? .now, periods: soccer.history.periods, now: nil)
        let start = soccer.history.start ?? .now, second = soccer.history.periods[1].start
        check(clock.wall(38) == start + 38 * 60 && clock.wall(45) == start + 45 * 60 && clock.wall(70) == second + 25 * 60
              && clock.breakStart == soccer.history.periods[0].end && clock.secondHalf == second,
              "soccer's clock against the wall: each half runs 1:1 from its own kickoff")
        check(abs(clock.minute(at: start + 38 * 60) - 38) < 1e-9 && abs(clock.minute(at: second + 60) - 46) < 1e-9, "and back")
        let early = SoccerClock(start: start, periods: [OddsPeriod(number: 1, label: "1st", start: start, end: start + 600)], now: start + 600)
        check(early.secondHalf == start + 63 * 60 && early.breakStart == start + 48 * 60 && early.wall(90) == start + 108 * 60,
              "in the first half, the break and the second half are projected")
        let longBreak = SoccerClock(start: start, periods: [OddsPeriod(number: 1, label: "1st", start: start, end: start + 49 * 60)], now: start + 70 * 60)
        check(longBreak.secondHalf == start + 70 * 60 && longBreak.breakStart == start + 49 * 60, "a long break pushes the second half along")
    }

    // MARK: The axes

    private static func timelineAxes() {
        func labels(_ axis: TimelineAxis) -> [String] { axis.labels.map(\.text) }
        func mark(_ minute: Double) -> TimelineMark {
            TimelineMark(moment: GameDetail.Moment(id: "\(minute)", kind: .goal, clock: "", text: "", side: .top, minute: minute), t: nil)
        }
        // Match minutes: soccer as it always was.
        let compact = TimelineAxis.minutes(width: 312, marks: [mark(38)], current: nil, large: false)
        check(labels(compact) == ["0'", "HT", "90'"] && compact.ticks.isEmpty && compact.tinted.isEmpty && compact.now == nil,
              "minutes, compact: 0', HT, 90', no ticks")
        let large = TimelineAxis.minutes(width: 500, marks: [mark(38)], current: 67, large: true)
        check(labels(large) == ["0'", "HT", "90'", "15'", "30'", "60'", "75'"] && large.ticks.count == 4 && large.now != nil && large.played.count == 1,
              "minutes, large: a tick every 15', the now dot and the time played", "\(labels(large))")
        let stoppage = TimelineAxis.minutes(width: 500, marks: [mark(93)], current: nil, large: true)
        check(labels(stoppage).contains("93'") && !labels(stoppage).contains("90'") && stoppage.tinted.count == 1 && stoppage.ticks.count == 5,
              "stoppage: the end is the last minute, tinted past 90', 90' keeps its line and not its label", "\(labels(stoppage))")
        check(large.x(mark(45)) == large.landmarks.first, "half-time at 45'")

        // The wall clock, per sport.
        let games = Dictionary(uniqueKeysWithValues: timelineGames().map { ($0.name, $0) })
        func wall(_ game: TimelineGame, window: OddsWindow = .game, now: Date? = nil, width: CGFloat = 500, large: Bool = true) -> TimelineAxis {
            let state: EventState = now == nil ? .final : .live
            let history = now.map { game.history.shown(until: $0) } ?? game.history
            let domain = history.domain(state: state, window: window, eventStart: game.event.start, latest: now, until: now)
            return .wall(.init(history: history, domain: domain, now: now, labelWidth: 40, window: window, pointer: OddsPointer()),
                         size: CGSize(width: width, height: MatchTimeline.height), large: large)
        }
        guard let soccer = games["soccer"], let nfl = games["NFL"], let nba = games["NBA"], let mlb = games["MLB"] else { return }
        let final = wall(soccer)
        let layout = final.layout
        check(labels(final).prefix(3) == ["0'", "HT", "96'"] && labels(final).contains("15'") && labels(final).contains("75'"),
              "soccer on the wall clock keeps 0', HT and the last minute, and its quarter hours", "\(labels(final))")
        let rest = soccer.history.periods[0].end...soccer.history.periods[1].start
        check(final.landmarks.count == 1 && layout.map { final.landmarks[0] > $0.x(rest.lowerBound) && final.landmarks[0] < $0.x(rest.upperBound) } == true,
              "half-time sits in the break, which keeps its real width")
        check(final.tinted.count == 2 && final.tinted[1].upperBound == final.track.upperBound && final.now == nil && final.played.isEmpty,
              "the break and second-half stoppage tinted; a final has no fill and no now")
        check(wall(soccer, large: false).ticks.isEmpty, "compact: no quarter hours, as ever")
        let start = soccer.history.start ?? .now
        let liveSoccer = wall(soccer, now: start + 30 * 60)
        let laterSoccer = wall(soccer, now: start + 40 * 60)
        check(labels(liveSoccer).prefix(3) == ["0'", "HT", "90'"] && liveSoccer.now != nil && liveSoccer.played.count == 1,
              "a live first half: the second half's landmarks pencilled in, the time played filled", "\(labels(liveSoccer))")
        check(liveSoccer.layout?.domain == laterSoccer.layout?.domain && liveSoccer.now.flatMap { a in laterSoccer.now.map { a < $0 } } == true
              && liveSoccer.labels.first { $0.text == "90'" }?.x == laterSoccer.labels.first { $0.text == "90'" }?.x,
              "ten minutes on: the axis hasn't moved, the now dot has")
        let half = wall(soccer, window: .period(1))
        check(labels(half).contains("15'") && labels(half).contains("30'") && labels(half).first == "0'" && half.ticks.count >= 8,
              "zoomed to a half: its minutes every 15', a tick every 5'", "\(labels(half))")
        let secondHalf = wall(soccer, window: .period(2))
        check(labels(secondHalf).first == "45'" && labels(secondHalf).contains("60'") && secondHalf.tinted.count == 1, "the second half from 45', stoppage tinted", "\(labels(secondHalf))")

        check(labels(wall(nfl)) == ["Q1", "Q2", "Q3", "Q4"] && labels(wall(nba)) == ["Q1", "Q2", "Q3", "Q4"], "quarters, by name")
        check(wall(nba).landmarks.count == 3 && wall(nba).tinted.count == 3, "each break marked at its real width")
        check(labels(wall(mlb)) == (1...9).map(String.init), "innings, by number: baseball has no clock", "\(labels(wall(mlb)))")
        let quarter = wall(nba, window: .period(3))
        check(labels(quarter).first == "Q3" && labels(quarter).contains("9:00") && labels(quarter).contains("6:00") && !quarter.ticks.isEmpty,
              "zoomed to a quarter: what the game clock said, from the plays reported", "\(labels(quarter))")
        let inning = wall(mlb, window: .period(6))
        check(labels(inning) == ["Top 6", "Bot 6"] && inning.landmarks.count == 1, "zoomed to an inning: its two halves", "\(labels(inning))")
        let liveNBA = wall(nba, now: (nba.history.start ?? .now) + 1800)
        check(labels(liveNBA).allSatisfy { $0 == "Q1" || $0 == "Q2" } && liveNBA.now != nil, "live: only the periods reached are named, nothing about the future")
        let spans = TimelinePeriod.spans(nba.history.periods, layout: wall(nba).layout!, runsOn: false)
        check(spans.map(\.label) == ["Q1", "Q2", "Q3", "Q4"] && zip(spans, spans.dropFirst()).allSatisfy { $0.x.upperBound == $1.x.lowerBound },
              "the labels' row: every period clickable, edge to edge")
        check(TimelinePeriod.spans(nba.history.periods, layout: wall(nba, window: .period(2)).layout!, runsOn: false).map(\.number) == [2],
              "zoomed: the one period")
    }

    // MARK: Pixel alignment

    /// The reading's line, drawn by each module, measured in the pixels each
    /// drew: same column, per sport and width class, at both ends of the axis.
    private static func timelineAlignment() {
        for game in timelineGames() {
            for (cls, width) in [(WidthClass.compact, 312.0), (.medium, 380), (.large, 470), (.xlarge, 620)] {
                let history = game.history
                let domain = history.domain(state: .final, window: .game, eventStart: game.event.start)
                let span = domain.upperBound.timeIntervalSince(domain.lowerBound)
                var worst = 0.0, measured = 0
                for fraction in [0.0, 0.37, 1.0] {
                    if let gap = ruleGap(game, width: width, cls: cls, at: domain.lowerBound + span * fraction) {
                        worst = max(worst, gap)
                        measured += 1
                    }
                }
                // Where a rule meets other changes at a narrow width it can't be told apart; never none.
                check(measured >= 1 && worst < 0.25, "\(game.name) \(Int(width))pt: timeline and odds draw the same moment in the same column",
                      "\(measured) measured, worst \(worst) px")
            }
            // A live game, and a zoom.
            let (live, now) = game.live(at: 0.6)
            check(ruleGap(live, width: 470, cls: .large, at: now - 600).map { $0 < 0.25 } == true, "\(game.name) live: aligned on the stable axis")
            if let period = game.history.periods.dropFirst().first {
                check(ruleGap(game, width: 470, cls: .large, at: period.start + period.end.timeIntervalSince(period.start) / 2, window: .period(period.number)).map { $0 < 0.25 } == true,
                      "\(game.name) zoomed to \(period.label): aligned")
            }
        }
    }

    /// How far apart the two modules draw `t`, in pixels at 2x.
    private static func ruleGap(_ game: TimelineGame, width: CGFloat, cls: WidthClass, at t: Date, window: OddsWindow = .game) -> Double? {
        func render(pinned: Date?) -> (bytes: [UInt8], width: Int, height: Int, row: Int)? {
            let feed = OddsFeed()
            feed.adopt(game.market)
            feed.preview(market: game.market, series: game.series)
            let pointer = OddsPointer()
            pointer.window = window
            pointer.pin(pinned)
            let content = VStack(alignment: .leading, spacing: 0) {
                TimelinePageModules(game: game, feed: feed, pointer: pointer)
            }
            .frame(width: width)
            .fixedSize(horizontal: false, vertical: true)
            .background(Color.white)
            .environment(LinkedFocus())
            .environment(\.widthClass, cls)
            .environment(\.pageLive, false)
            .environment(\.colorScheme, .light)
            let renderer = ImageRenderer(content: content)
            renderer.scale = 2
            guard let image = renderer.cgImage, let data = image.dataProvider?.data as Data? else { return nil }
            return ([UInt8](data), image.width, image.height, image.bytesPerRow)
        }
        guard let a = render(pinned: nil), let b = render(pinned: t), a.width == b.width, a.height == b.height else { return nil }
        // Long vertical runs of changed pixels: the two rules, one above the
        // other. Two renders differ by a rounding step anyway; a rule by far more.
        let threshold = 30
        var runs: [(top: Int, bottom: Int)] = []
        func changed(_ x: Int, _ y: Int) -> Int {
            let at = y * a.row + x * 4
            return abs(Int(a.bytes[at]) - Int(b.bytes[at])) + abs(Int(a.bytes[at + 1]) - Int(b.bytes[at + 1])) + abs(Int(a.bytes[at + 2]) - Int(b.bytes[at + 2]))
        }
        // A crosshair dot over its own line changes nothing there: a gap that small doesn't end a run.
        for x in 0..<a.width {
            var start: Int?, last = 0
            for y in 0...a.height {
                if y < a.height, changed(x, y) > threshold {
                    if start == nil { start = y }
                    last = y
                } else if let top = start, y == a.height || y - last > 16 {
                    if last - top >= 60, !runs.contains(where: { $0.top <= last && $0.bottom >= top }) { runs.append((top, last + 1)) }
                    start = nil
                }
            }
        }
        guard runs.count == 2 else { return nil }
        // The rule's own columns: anything else on its rows (a dot, a mark) is short.
        func center(_ run: (top: Int, bottom: Int)) -> Double {
            var sum = 0.0, weight = 0.0
            for x in 0..<a.width {
                let hits = (run.top..<run.bottom).filter { changed(x, $0) > threshold }
                guard hits.count > (run.bottom - run.top) / 2 else { continue }
                let c = hits.reduce(0) { $0 + changed(x, $1) }
                sum += Double(c * x)
                weight += Double(c)
            }
            return weight > 0 ? sum / weight : -1
        }
        return abs(center(runs[0]) - center(runs[1]))
    }
}

/// The page's two modules, as it stacks them.
struct TimelinePageModules: View {
    let game: TimelineGame
    let feed: OddsFeed
    let pointer: OddsPointer

    var body: some View {
        let e = game.event, d = game.detail
        let palette = MatchColors(e).palette(.light)
        DetailSection(title: "Timeline") {
            MatchTimelineSection(history: game.history, marks: d.timelineMarks, feed: feed, event: e, names: game.names, palette: palette, pointer: pointer)
        }
        OddsSection(feed: feed, baseline: d.odds ?? OddsBaseline(), event: e, names: game.names, spoken: SpokenTeams(top: game.names.top, bottom: game.names.bottom),
                    palette: palette, history: game.history, marks: d.timelineMarks, pointer: pointer)
    }
}
