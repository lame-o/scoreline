import Foundation
import SwiftUI

// NBA celebrations (spec §3.1, §12.3): possession with the ball in the air,
// shot accents and tiers (dunk, and-one, buzzer-beater, on fire, clutch),
// blocks and steals, freshness gates for ESPN's late edits, ESPN's scoring
// run, and what the court tells for each moment. Real plays come from one
// recorded game (Tests/Fixtures/nba-plays-401909095.json: NY at BOS, core
// plays stripped to the fields the app reads); boundaries use synthetic plays.

extension ScorelineTests {
    static func celebrateNBA() {
        print("\nNBA celebrations")
        let sentinel = (x: -214748340.0, y: -214748365.0)
        func play(_ id: String, _ type: String = "92", home: Int = 0, away: Int = 0, period: Int = 1, clock: String = "10:00",
                  team: String? = nil, scoring: Bool = false, value: Int = 0, attempted: Int = 0, shooting: Bool = false,
                  at spot: (x: Double, y: Double)? = nil, people: [String] = [], run: (team: String, larger: Int, smaller: Int, from: String)? = nil)
            -> JSON {
            var p: [String: Any] = ["id": id, "type": ["id": type, "text": type == "402" ? "End Game" : "Play"], "text": "play \(id)",
                                    "homeScore": home, "awayScore": away, "period": ["number": period],
                                    "clock": ["displayValue": clock], "scoringPlay": scoring, "scoreValue": value,
                                    "pointsAttempted": attempted, "shootingPlay": shooting,
                                    "coordinate": ["x": (spot ?? sentinel).x, "y": (spot ?? sentinel).y],
                                    "participants": people.map { ["athlete": ["id": $0]] }]
            if let team { p["team"] = ["id": team] }
            if let run { p["scoringRun"] = ["team": ["id": run.team], "larger": run.larger, "smaller": run.smaller, "play": ["id": run.from]] }
            return JSON(p)
        }
        // LAL (13) at UTAH (26): the away team is the top team.
        let lakers = BasketballFeed.Teams(topIsHome: false, topID: "13", bottomID: "26", topName: "LAL", bottomName: "UTAH")
        func moment(_ plays: [JSON], at index: Int? = nil, age: Int = 0, was: LiveMoment? = nil) -> LiveMoment? {
            BasketballFeed.moment(at: index ?? plays.count - 1, in: plays, teams: lakers, fromTipOff: true, age: age, was: was)
        }

        // MARK: Clock, clutch, buzzer

        check(NBADetail.clutch(period: 4, secondsLeft: 300, margin: 5) && NBADetail.clutch(period: 4, secondsLeft: 0, margin: -5)
              && !NBADetail.clutch(period: 4, secondsLeft: 300.1, margin: 0) && !NBADetail.clutch(period: 4, secondsLeft: 120, margin: 6)
              && !NBADetail.clutch(period: 3, secondsLeft: 30, margin: 0) && NBADetail.clutch(period: 5, secondsLeft: 299, margin: 2),
              "clutch: the last 5:00 of the 4th or any overtime, within 5")
        check(NBADetail.buzzer(clock: "0.6") && NBADetail.buzzer(clock: "0:01") && NBADetail.buzzer(clock: "0.0")
              && NBADetail.buzzer(clock: "1.0") && !NBADetail.buzzer(clock: "1.1") && !NBADetail.buzzer(clock: "1:00")
              && !NBADetail.buzzer(clock: ""), "buzzer: a second or less, as \"0.6\" or \"0:01\"")
        check(NBADetail.spanLabel(2400...2565) == "Q4 8:00–5:15" && NBADetail.spanLabel(1430...1460) == "Q2 0:10–Q3 11:40",
              "a run's span as the clock showed it", NBADetail.spanLabel(1430...1460))

        // MARK: Tiers and accents (synthetic)

        // A UTAH (bottom) two in Q1: routine; a three: swing.
        let two = moment([play("1", home: 2, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 5), people: ["a"])])
        let three = moment([play("1", home: 3, team: "26", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 5), people: ["a"])])
        check(two?.tier == .routine && two?.lead == "Two" && three?.tier == .swing && three?.lead == "Three", "a two is routine, a three a swing")
        let dunk = moment([play("1", "116", home: 2, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 1), people: ["a"])])
        check(dunk?.accents.contains(.dunk) == true && dunk?.tier == .swing && dunk?.lead == "Dunk", "a dunk (by type) is a swing")
        // A shooting foul by the other team at the same clock: and-one, fired on the foul (the free throw isn't in yet).
        let make = play("1", "116", home: 2, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 1), people: ["a"])
        let foul = play("2", "44", home: 2, team: "13", people: ["f"])
        let andOneDunk = moment([make, foul], at: 0)
        check(andOneDunk?.accents.isSuperset(of: [.dunk, .andOne]) == true && andOneDunk?.tier == .score && andOneDunk?.lead == "And-one",
              "and-one: a same-clock shooting foul by the other team; a dunk and-one rises to a score")
        let ownFoul = play("2", "44", home: 2, team: "26", people: ["f"])
        let later = play("2", "44", home: 2, clock: "9:58", team: "13", people: ["f"])
        check(moment([make, ownFoul], at: 0)?.accents.contains(.andOne) == false && moment([make, later], at: 0)?.accents.contains(.andOne) == false,
              "no and-one for a foul by the shooter's team, or at another clock")
        let fourPoint = moment([play("1", home: 3, team: "26", scoring: true, value: 3, attempted: 3, shooting: true, at: (3, 5), people: ["a"]), foul], at: 0)
        check(fourPoint?.lead == "Four-point play" && fourPoint?.tier == .score, "a three and-one is a four-point play")

        // Clutch: Q4 4:30, UTAH down 2 before the shot: the two rises to a swing, the three to a score.
        let tied = play("0", home: 98, away: 100, period: 4, clock: "4:40", team: "13")
        let clutchTwo = moment([tied, play("1", home: 100, away: 100, period: 4, clock: "4:30", team: "26", scoring: true, value: 2, attempted: 2,
                                            shooting: true, at: (25, 5), people: ["a"])])
        let clutchThree = moment([tied, play("1", home: 101, away: 100, period: 4, clock: "4:30", team: "26", scoring: true, value: 3, attempted: 3,
                                              shooting: true, at: (3, 5), people: ["a"])])
        check(clutchTwo?.accents.contains(.clutch) == true && clutchTwo?.tier == .swing && clutchTwo?.lead == "Two"
              && clutchThree?.tier == .score, "clutch raises a basket one tier (a two is captioned \"Two\")")
        let early = moment([play("0", home: 98, away: 100, period: 4, clock: "5:10", team: "13"),
                            play("1", home: 100, away: 100, period: 4, clock: "5:01", team: "26", scoring: true, value: 2, attempted: 2,
                                 shooting: true, at: (25, 5), people: ["a"])])
        check(early?.accents.contains(.clutch) == false && early?.tier == .routine, "not clutch at 5:01")

        // Buzzer-beaters: a score; decisive only when it ties or wins at the end of the 4th or overtime.
        func buzzer(period: Int, before: (home: Int, away: Int), clock: String = "0.4") -> LiveMoment? {
            moment([play("0", home: before.home, away: before.away, period: period, clock: "0:20", team: "13"),
                    play("1", home: before.home + 3, away: before.away, period: period, clock: clock, team: "26", scoring: true, value: 3,
                         attempted: 3, shooting: true, at: (3, 5), people: ["a"])])
        }
        let winner = buzzer(period: 4, before: (98, 100)), tier = buzzer(period: 5, before: (97, 100)), padding = buzzer(period: 4, before: (110, 100))
        let half = buzzer(period: 2, before: (50, 52))
        check(winner?.tier == .score && winner?.decisive == true && winner?.lead == "Buzzer-beater" && tier?.decisive == true,
              "a buzzer-beater that wins or ties at the end of the 4th or overtime is decisive")
        check(padding?.tier == .score && padding?.decisive == false && half?.tier == .score && half?.decisive == false
              && half?.accents.contains(.buzzer) == true, "one that pads a lead, or ends the 2nd, is a score without gold")
        check(buzzer(period: 4, before: (98, 100), clock: "1.4")?.accents.contains(.buzzer) == false, "1.4 seconds isn't the buzzer")

        // On fire: the shooter's 4th straight make (field goals only; a miss in between resets it).
        let shooting: [JSON] = [
            play("1", home: 2, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 5), people: ["a"]),
            play("2", "98", home: 3, team: "26", scoring: true, value: 1, attempted: 1, shooting: true, people: ["a"]),
            play("3", home: 5, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 5), people: ["a"]),
            play("4", home: 7, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 5), people: ["a"]),
            play("5", home: 9, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 5), people: ["a"]),
        ]
        let hot = moment(shooting)
        check(BasketballFeed.makes(endingAt: 4, in: shooting) == 4 && hot?.accents.contains(.onFire) == true && hot?.streak == 4
              && hot?.tier == .swing && hot?.detail.hasSuffix("· 4 straight") == true,
              "on fire: a 4th straight make (free throws don't count) rises a tier and says so", hot?.detail ?? "nil")
        check(moment(Array(shooting.prefix(4)))?.accents.contains(.onFire) == false, "a 3rd straight make isn't on fire")
        var cold = shooting
        cold.insert(play("1b", home: 2, team: "26", attempted: 2, shooting: true, at: (25, 9), people: ["a"]), at: 1)
        check(moment(cold)?.accents.contains(.onFire) == false, "a miss in between resets the streak")
        let both = moment([play("0", home: 98, away: 100, period: 4, clock: "4:40", team: "13")] + shooting.map { p in
            var raw = p.raw as! [String: Any]
            raw["period"] = ["number": 4]; raw["clock"] = ["displayValue": "4:30"]
            raw["homeScore"] = 98 + (raw["homeScore"] as! Int); raw["awayScore"] = 100
            return JSON(raw)
        })
        check(both?.accents.isSuperset(of: [.clutch, .onFire]) == true && both?.tier == .swing,
              "clutch and on fire raise a two once, not twice")

        // Reattribution: ESPN moves the middle make to another player. The streak recomputes;
        // what was announced keeps its accent (an edit never takes one back).
        var moved = shooting
        var middle = moved[2].raw as! [String: Any]
        middle["participants"] = [["athlete": ["id": "b"]]]
        moved[2] = JSON(middle)
        check(moment(moved)?.accents.contains(.onFire) == false && moment(moved, age: 1, was: hot)?.accents.contains(.onFire) == true,
              "a reattributed make takes the streak below four, but an announced flame isn't taken back")
        let court = NBADetail.courtPlays(moved, side: lakers.side, topIsHome: false)
        check(NBADetail.streaks(court) == ["a": 3, "b": 1] && NBADetail.streaks(NBADetail.courtPlays(shooting, side: lakers.side, topIsHome: false)) == ["a": 4],
              "streaks per shooter from the court plays", "\(NBADetail.streaks(court))")

        // Blocks and steals.
        let block = moment([play("1", team: "26", attempted: 3, shooting: true, at: (3, 20), people: ["a", "z"])])
        check(block?.kind == .block && block?.tier == .swing && block?.targets == ["z"] && block?.side == .top && block?.lead == "Block",
              "a miss with a second participant is a block, the blocker's (and their team's)")
        let steal = moment([play("1", "61", team: "26", at: (30, 20), people: ["a", "s"])])
        check(steal?.kind == .steal && steal?.targets == ["s"] && steal?.side == .top && steal?.tier == .swing,
              "a steal, the live placeholder 61 included: the stealer's")
        check(moment([play("1", "62", team: "26", at: (30, 20), people: ["a"])]) == nil, "a turnover without a stealer is no moment")

        // MARK: Freshness gates (synthetic ages)

        let placeholder = play("1", "91", home: 2, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 1), people: ["a"])
        let refined = play("1", "116", home: 2, team: "26", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 1), people: ["a"])
        let first = moment([placeholder])
        let newer = (2...5).map { play("\($0)", "155", home: 2, team: "13") }
        check(first?.accents.contains(.dunk) == false && moment([refined], age: 1, was: first)?.accents.contains(.dunk) == true
              && moment([refined] + newer, at: 0, age: 3, was: first)?.accents.contains(.dunk) == false,
              "a placeholder refined into a dunk: news while among the newest 3, silent 40 s on")
        let missed = moment([play("1", team: "26", attempted: 3, shooting: true, at: (3, 20), people: ["a"])])
        let blocked = play("1", team: "26", attempted: 3, shooting: true, at: (3, 20), people: ["a", "z"])
        check(moment([blocked], age: 2, was: missed)?.kind == .block && moment([blocked], age: 3, was: missed)?.kind == .missed,
              "a block added within 2 looks is news; later the court just updates")
        check(moment([make, foul], at: 0, age: 1)?.accents.contains(.andOne) == true
              && moment([make, foul], at: 0, age: 2)?.accents.contains(.andOne) == false,
              "an and-one foul logged within a look is news; later it isn't")

        // reconcile: only real upgrades come back; a later re-read doesn't re-show.
        let announcedTwo = moment([placeholder])!
        let edits = BasketballFeed.reconcile([announcedTwo.id: announcedTwo], in: [refined], teams: lakers, fromTipOff: true, ages: ["1": 1])
        check(edits.upgraded.map(\.id) == ["1"] && edits.upgraded.first?.accents.contains(.dunk) == true && edits.retracted.isEmpty,
              "reconcile: the refined dunk is re-announced")
        let again = BasketballFeed.reconcile(edits.announced, in: [refined] + newer, teams: lakers, fromTipOff: true, ages: ["1": 4])
        check(again.upgraded.isEmpty && again.retracted.isEmpty, "and not again on the next looks")

        // MARK: Possession and the ball in the air

        let sequence: [JSON] = [
            play("1", "615", team: "13", people: ["x", "y", "p"]),                                           // LAL win the tip
            play("2", team: "13", attempted: 2, shooting: true, at: (25, 10), people: ["p"]),               // miss: in the air
            play("3", "156", team: "13", at: (25, 10), people: ["q"]),                                       // offensive rebound
            play("4", away: 2, clock: "9:40", team: "13", scoring: true, value: 2, attempted: 2, shooting: true, at: (25, 3), people: ["q"]),
            play("5", "44", away: 2, clock: "9:40", team: "26", at: (25, 3), people: ["u"]),                 // and-one foul
            play("6", "97", away: 3, clock: "9:40", team: "13", scoring: true, value: 1, attempted: 1, shooting: true, people: ["q"]),
            play("7", "412", away: 3, clock: "0.0"),
        ]
        let plays = NBADetail.courtPlays(sequence, side: lakers.side, topIsHome: false)
        let states = plays.indices.map { NBADetail.ball(plays[...$0]) }
        check(states.map(\.side) == [.top, .top, .top, .bottom, .top, .bottom, nil]
              && states.map(\.inAir) == [false, true, false, false, false, false, false],
              "the arrow: tip, a miss in the air (still LAL's), the rebound, the make, the and-one (LAL keep it), the free throw, the break",
              "\(states)")
        let feed = BasketballFeed()
        feed.ingest(Array(sequence.prefix(2)), start: 0, teams: lakers)
        check(feed.possession == .top && feed.ballInAir && feed.playing, "the feed's possession: the shooting team's, in the air")
        feed.ingest(sequence, start: 0, teams: lakers)
        check(feed.possession == nil && !feed.ballInAir, "after a period ends nobody has it")
        let over = BasketballFeed()
        over.ingest(shooting + [play("9", "402", home: 7, clock: "0.0")], start: 0, teams: lakers)
        check(!over.playing && over.streaks.isEmpty && over.runs.isEmpty, "after End of Game nothing live remains (no flames, no run)")
        let blockedPlay = NBADetail.courtPlays([blocked], side: lakers.side, topIsHome: false)[0]
        let spot = CourtView.point(blockedPlay)!, rim = CourtView.rim(for: .bottom), stop = CourtView.ballPoint(blockedPlay)!
        check(abs(stop.x - (spot.x + (rim.x - spot.x) * 0.6)) < 0.001 && abs(stop.y - (spot.y + (rim.y - spot.y) * 0.6)) < 0.001,
              "a blocked shot's ball stops 60% of the way (it never reached the rim)")

        // MARK: ESPN's scoring run

        let running: [JSON] = [
            play("1", away: 2, team: "13", scoring: true, value: 2),
            play("2", away: 5, clock: "9:30", team: "13", scoring: true, value: 3, run: ("13", 8, 0, "1")),
            play("3", away: 5, clock: "9:10", team: "26", run: ("13", 8, 0, "1")),
            play("4", away: 7, clock: "8:50", team: "13", scoring: true, value: 2, run: ("13", 10, 2, "1")),
        ]
        let run = BasketballFeed.activeRun(in: running, teams: lakers)
        check(run?.team == .top && run?.label == "10–2 run" && run?.start == 120 && run?.end == 190,
              "the run: from its first play to its newest, by ESPN's count", "\(String(describing: run))")
        check(BasketballFeed.activeRun(in: running + [play("5", home: 2, away: 7, clock: "8:30", team: "26", scoring: true, value: 2)], teams: lakers) == nil,
              "no band once the newest play doesn't carry it")
        let flowFeed = BasketballFeed()
        flowFeed.ingest(running, start: 0, teams: lakers)
        check(flowFeed.runs.first?.label == "10–2 run", "the feed exposes the run while it's on")

        // MARK: The court's story for each moment

        func shot(_ id: String, made: Bool, type: Int = 92, side: GameDetail.Side = .top) -> GameDetail.Shot {
            GameDetail.Shot(id: id, x: 25, y: 10, made: made, value: 2, side: side, player: "p", period: 1, clock: "", text: "",
                            elapsed: 10, typeID: type)
        }
        func lm(_ id: String, _ kind: LiveMoment.Kind, _ accents: LiveMoment.Accents = []) -> LiveMoment {
            var m = LiveMoment(id: id, chart: .court, tier: .routine, kind: kind, lead: "", detail: "", side: .top)
            m.accents = accents
            return m
        }
        let shots = [shot("m", made: true), shot("d", made: true, type: 116), shot("x", made: false), shot("b", made: false)]
        check(CourtStory.make(lm("m", .made(value: 2)), first: nil, shots: shots)?.kind == .swish
              && CourtStory.make(lm("d", .made(value: 2), .dunk), first: nil, shots: shots)?.kind == .slam
              && CourtStory.make(lm("x", .missed), first: nil, shots: shots)?.kind == .rimOut
              && CourtStory.make(lm("b", .block), first: nil, shots: shots)?.kind == .stuffed,
              "made swishes, a dunk slams, a miss rims out, a block is stuffed")
        check(CourtStory.make(lm("m", .made(value: 2)), first: nil, shots: shots)?.effects == nil
              && CourtStory.make(lm("x", .missed), first: nil, shots: shots)?.effects == []
              && CourtStory.make(lm("m", .run, [.onFire]), first: nil, shots: shots)?.effects == [.swish(echo: false), .embers],
              "a make plays its own cue; a run's basket plays the basket (its sparks are the game flow's)")
        let blockStory = CourtStory.make(lm("x", .block), first: lm("x", .missed), shots: shots)
        let echo = CourtStory.make(lm("m", .made(value: 2), .andOne), first: lm("m", .made(value: 2)), shots: shots)
        let slam = CourtStory.make(lm("m", .made(value: 2), .dunk), first: lm("m", .made(value: 2)), shots: shots)
        check(blockStory?.kind == .stuffed && blockStory?.key == "x-block" && echo?.effects == [.echo] && echo?.kind == nil
              && echo?.holdsShot == false && slam?.effects == [.rimPulse] && slam?.kind == .slam && slam?.lands == false,
              "an upgrade: a block flies again, stuffed; an and-one only echoes; a dunk only slams the rim")
        check(CourtStory.make(lm("m", .made(value: 2)), first: lm("m", .made(value: 2)), shots: shots)?.key == "m"
              && CourtStory.make(lm("s", .steal), first: nil, shots: shots)?.effects == [] && CourtStory.make(lm("e", .periodEnd), first: nil, shots: shots) == nil,
              "the same moment again is the same story; a steal has no flight; a period end isn't the court's")
        check([ShotArc.Kind.swish, .rimOut, .stuffed, .slam].allSatisfy { kind in
            let through = ShotArc.throughTime(kind, reduceMotion: false), free = ShotArc.freeTime(kind, reduceMotion: false)
            let end = ShotArc.duration(kind, reduceMotion: false)
            return through <= free && free < end && end <= 1.3 && ShotArc.duration(kind, reduceMotion: true) <= 1.3
        }, "every shot story hands back within 1.3 s, the ball before the end")

        // Lit by a run on the game flow: the running team's shots inside its span.
        let lit = CourtView.lit([shot("in", made: true), shot("other", made: true, side: .bottom),
                                 GameDetail.Shot(id: "late", x: 1, y: 1, made: false, value: 2, side: .top, player: nil, period: 1, clock: "",
                                                 text: "", elapsed: 400)],
                                by: Focus(side: .top, span: 0...300))
        check(lit.map(\.id) == ["in"], "a run's band lights that run's shots on the court")

        // The stage's cue for court moments (Phase 0's table, fed these accents).
        func effects(_ m: LiveMoment) -> [CelebrationCue.Effect] {
            Celebration.cue(for: m, level: .full, reduceMotion: false, geometry: .medium, direction: .degrees(-110))?.effects ?? []
        }
        check(effects(hot!) == [.swish(echo: false), .embers] && effects(clutchTwo!) == [.swish(echo: false), .sparks(rays: 4, length: 13)]
              && effects(andOneDunk!) == [.rimPulse], "on fire embers, clutch sparks, a dunk's rim")
        var gold = winner!
        gold.burst = true
        let goldCue = Celebration.cue(for: gold, level: .full, reduceMotion: false, geometry: .medium, direction: .degrees(-110))
        check(goldCue?.gold == true && goldCue?.effects.contains { if case .confetti = $0 { true } else { false } } == true,
              "a decisive buzzer-beater: confetti with gold")

        // MARK: A recorded game (NY at BOS), as the page polls it

        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("nba-plays-401909095.json")) else {
            return check(false, "the recorded game loads")
        }
        let game = JSON(data: data)["items"].array
        let celtics = BasketballFeed.Teams(topIsHome: false, topID: "18", bottomID: "2", topName: "NY", bottomName: "BOS")
        /// The page looked through `index - 1`, then through `index + extra`; `edit` changes the play on an earlier look.
        func live(_ index: Int, extra: Int = 0, earlier: ((inout [String: Any]) -> Void)? = nil, looks: Int = 1) -> (LiveMoment?, BasketballFeed) {
            let feed = BasketballFeed()
            func window(_ end: Int, _ edit: ((inout [String: Any]) -> Void)? = nil) -> [JSON] {
                var plays = Array(game[max(0, end - 149)...end])
                if let edit, var raw = game[index].raw as? [String: Any], let i = plays.firstIndex(where: { $0["id"].string == raw["id"] as? String }) {
                    edit(&raw)
                    plays[i] = JSON(raw)
                }
                return plays
            }
            feed.ingest(window(index - 1), start: max(0, index - 150), teams: celtics)
            _ = feed.takeMoments()
            if let earlier {
                for _ in 0..<looks {
                    feed.ingest(window(index, earlier), start: max(0, index - 149), teams: celtics)
                    _ = feed.takeMoments()
                }
            }
            feed.ingest(window(index + extra), start: max(0, index + extra - 149), teams: celtics)
            let id = game[index]["id"].string
            return (feed.takeMoments().first { $0.id == id }, feed)
        }
        let (garza, garzaFeed) = live(140)
        check(garza?.accents.contains(.onFire) == false && garza?.tier == .swing && !garzaFeed.streaks.values.contains(3),
              "Garza's 3rd straight, a three: a swing, not yet on fire", garza?.detail ?? "nil")
        let (towns, townsFeed) = live(148)
        check(towns?.accents.contains(.onFire) == true && towns?.streak == 4 && towns?.tier == .swing
              && towns?.detail == "Karl-Anthony Towns driving layup · 4 straight" && townsFeed.streaks.values.contains(4),
              "Towns' 4th straight, a layup: on fire, a swing", towns?.detail ?? "nil")
        check(live(113).0?.accents.contains(.dunk) == true && live(224).0?.kind == .block && live(17).0?.kind == .steal,
              "a dunk, a block and a steal from ESPN's plays")
        let (andOne, andOneFeed) = live(385, extra: 1)
        check(andOne?.accents.contains(.andOne) == true && andOneFeed.possession == .top,
              "Towns' and-one: the foul lands in the same look; NY keep the ball for the free throw")
        let pg = live(231).0
        check(pg?.lead == "Buzzer-beater" && pg?.tier == .score && pg?.decisive == false, "George at the end of the half: a score, no gold")
        check(live(435).0?.accents.contains(.clutch) == true, "Brunson in the last 5 minutes within 5: clutch")
        let (hart, hartFeed) = live(230)
        check(hart?.kind == .run && hart?.lead == "8–0 run" && hart?.span != nil && hartFeed.runs.first?.label == "8–0 run"
              && hartFeed.runs.first?.team == .top, "Hart's basket makes it an 8–0 NY run: a run moment, and the band")
        // ESPN's late edits, through the feed's own looks.
        let removeBlocker: (inout [String: Any]) -> Void = { p in
            if var people = p["participants"] as? [Any], people.count > 1 { people.removeLast(); p["participants"] = people }
        }
        check(live(224, earlier: removeBlocker).0?.kind == .block && live(224, earlier: removeBlocker, looks: 3).0 == nil,
              "a block ESPN adds a look later is news; three looks later it isn't")
        let placeholderType: (inout [String: Any]) -> Void = { p in p["type"] = ["id": "91"] }
        check(live(113, earlier: placeholderType).0?.accents.contains(.dunk) == true,
              "a placeholder that becomes a dunk a look later plays its dunk")

        // The data spec's possession rule over the whole game: the arrow once a clock instant's
        // plays are all in, against the team of the next shot, free throw or turnover.
        let all = NBADetail.courtPlays(game, side: celtics.side, topIsHome: false)
        var decided = 0, right = 0
        for (i, p) in all.enumerated() {
            if i + 1 < all.count, all[i + 1].period == p.period, all[i + 1].clock == p.clock { continue }
            let state = NBADetail.ball(all[...i])
            guard let side = state.side, !state.inAir else { continue }
            let next = all[(i + 1)...].first { n in
                guard n.period == p.period, n.clock != p.clock else { return false }
                switch n.kind { case .shot, .freeThrow, .turnover: return true; default: return false }
            }
            guard let truth = next?.side else { continue }
            decided += 1
            if truth == side { right += 1 }
        }
        check(decided > 150 && Double(right) / Double(decided) >= 0.97, "the possession rule: ≥ 97% where it decides",
              "\(right)/\(decided)")
    }
}
