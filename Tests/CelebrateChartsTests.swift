import Foundation
import SwiftUI

// Celebrations on the live charts (phase 1B): the detection the feeds add
// (big chance, woodwork, late goals; grand slam, walk-off, double play; big
// play, game-winners), and the logic the charts celebrate with (a pass's knock
// timing, next target and holds to go, boulder rank deltas, CS2 map point and
// provisional rounds, per-mark triggers).

extension ScorelineTests {
    static func celebrateCharts() {
        print("\nCelebrations on the charts")
        soccerDetection()
        baseballDetection()
        footballDetection()
        climbingPasses()
        boulderDeltas()
        counterStrikeState()
        chartTriggers()
    }

    // MARK: Soccer: Aston Villa 2–1 Man City, as recorded (Tests/Fixtures)

    private static func soccerDetection() {
        let pages = ["1bbb58f9c1945678542dc53d", "8e8f4e473432cfae635da5d1", "7a34807f60ddfdf41d6706b9", "920e262536793e928a9ec11b",
                     "ddf21e2893b041d770a3acbb", "45e85bdc16b81df599b6b72f", "9c7910bf49edad739a64d729"]
        var actions: [PitchAction] = []
        var index = 0
        for page in pages {
            let json = JSON(data: (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent(page + ".bin"))) ?? Data())
            for item in json["items"].array {
                if let a = SoccerFeed.action(item, index: index, homeTeamID: "362") { actions.append(a) }
                index += 1
            }
        }
        func play(_ id: String) -> PitchAction? { actions.first { $0.playID == id } }
        let shots = actions.filter { $0.kind == .shot || $0.kind == .goal }
        check(shots.count == 23 && shots.allSatisfy { $0.xg != nil }, "every shot carries Opta's xG", "\(shots.filter { $0.xg == nil }.count) without")
        // 68' Man City, xG 0.394, saved: a big chance.
        let chance = play("54151169")?.moment
        check(chance?.accents.contains(.bigChance) == true && chance?.kind == .shotSaved && chance?.lead == "Big chance"
              && chance?.detail.hasPrefix("0.39 xG · saved") == true, "a 0.39 xG save is a big chance, captioned with its xG",
              "\(chance?.lead ?? "-") \(chance?.detail ?? "-")")
        check(shots.filter { $0.moment?.accents.contains(.bigChance) == true }.map(\.playID) == ["54147163", "54151169"],
              "only the two shots of xG 0.3+ are big chances (goals never)")
        // 28' Man City off the woodwork: goalPositionY 55.4, so the post at 54.8 (45.2 once flipped onto the away attack).
        let post = play("54147619")
        check(post?.moment?.accents.contains(.woodwork) == true && post?.moment?.kind == .shotWide, "the woodwork shot carries .woodwork")
        check(post?.woodworkY == 45.2, "woodwork strikes the nearer post (oriented for the away attack)", "\(post?.woodworkY ?? -1)")
        var bar = post!
        bar.goalY = 50; bar.goalZ = 39
        check(bar.woodworkY == 50, "high and between the posts, it hit the bar where it crossed")
        // Goals: neither of the real ones is late; an equalizer or winner at 85'+ decides the match.
        check(play("54150525")?.moment?.decisive == false && play("54146134")?.moment?.decisive == false, "a 6' and a 60' goal aren't decisive")
        var late = play("54149975")!                  // the 52' header that made it 1–1
        late.clockSeconds = 88 * 60
        check(late.moment?.decisive == true, "a late equalizer is decisive")
        late.topScore = 1; late.bottomScore = 3     // Man City's goal (bottom), now 3–1 up
        check(late.moment?.decisive == false, "a late goal that only extends a lead isn't")
        late.topScore = 1; late.bottomScore = 2
        check(late.moment?.decisive == true, "a late winner from level is")
    }

    // MARK: Baseball

    private static func baseballDetection() {
        func result(_ fields: [String: Any]) -> LiveMoment? {
            var raw: [String: Any] = ["type": ["type": "play-result"], "id": "p", "text": "", "team": ["id": "8"]]
            raw.merge(fields) { _, new in new }
            return BaseballFeed.moment(JSON(raw), side: { $0 == "8" ? .bottom : .top })
        }
        let hr: [String: Any] = ["alternativeType": ["type": "home-run"], "scoringPlay": true]
        check(result(hr.merging(["scoreValue": 1]) { $1 })?.accents == [], "a solo home run: no accents")
        let slam = result(hr.merging(["scoreValue": 4, "period": ["type": "Top", "number": 3], "homeScore": 0, "awayScore": 4]) { $1 })
        check(slam?.accents == .grandSlam && slam?.lead == "Grand slam", "four runs on a homer: a grand slam")
        let walkOff = result(hr.merging(["scoreValue": 2, "period": ["type": "Bottom", "number": 9], "homeScore": 5, "awayScore": 4]) { $1 })
        check(walkOff?.decisive == true && walkOff?.kind == .homeRun, "home team goes ahead in the bottom 9th: walk-off, decisive")
        let extras = result(["scoringPlay": true, "scoreValue": 1, "alternativeType": ["type": "single"],
                             "period": ["type": "Bottom", "number": 11], "homeScore": 3, "awayScore": 2])
        check(extras?.decisive == true && extras?.kind == .runScored && extras?.lead == "Walk-off", "a walk-off single in extras")
        let insurance = result(hr.merging(["scoreValue": 1, "period": ["type": "Bottom", "number": 9], "homeScore": 6, "awayScore": 4]) { $1 })
        check(insurance?.decisive == false, "already ahead in the 9th: not a walk-off")
        let topNinth = result(hr.merging(["scoreValue": 1, "period": ["type": "Top", "number": 9], "homeScore": 4, "awayScore": 5]) { $1 })
        check(topNinth?.decisive == false, "the top of the 9th can't walk off")
        check(result(["alternativeType": ["type": "ground-out"], "doublePlay": true])?.kind == .doublePlay, "a double play is its own kind")
        check(result(["alternativeType": ["type": "strike-swinging"], "doublePlay": true])?.kind == .doublePlay,
              "strikeout + caught stealing: the double play")
        check(result(["alternativeType": ["type": "ground-out"], "doublePlay": true, "scoringPlay": true, "scoreValue": 1])?.kind == .runScored,
              "a run scoring on a double play is the run")
    }

    // MARK: Football

    private static func footballDetection() {
        func play(_ type: String, yards: Int = 0, scoring: String? = nil, period: Int = 1, clock: Double = 600,
                  home: Int? = nil, away: Int? = nil, endX: Double = 50, side: GameDetail.Side = .top) -> DrivePlay {
            DrivePlay(id: "x", side: side, startX: 40, endX: endX, kind: scoring == nil ? .rush : .score, downDistance: nil,
                      yards: yards, clock: "", text: "", driveID: nil, typeID: type, scoring: scoring,
                      homeScore: home, awayScore: away, period: period, clockSeconds: clock)
        }
        let long = FootballFeed.moment(play("5", yards: 34))
        check(long?.accents.contains(.bigPlay) == true && long?.tier == .swing && long?.lead == "Big play +34", "a 34-yard rush is a big play")
        check(FootballFeed.moment(play("24", yards: 20))?.accents.contains(.bigPlay) == true, "a 20-yard completion is a big play")
        check(FootballFeed.moment(play("5", yards: 12))?.accents == [] && FootballFeed.moment(play("5", yards: 12))?.tier == .routine,
              "12 yards is routine")
        // Home is the top team here; a touchdown into x ≥ 50 is the top team's.
        let goAhead = play("67", scoring: "touchdown", period: 4, clock: 88, home: 27, away: 24, endX: 100)
        check(FootballFeed.moment(goAhead, before: (20, 24))?.decisive == true, "a go-ahead TD with 1:28 left is decisive")
        check(FootballFeed.moment(goAhead, before: (21, 14))?.decisive == false, "extending a lead late isn't")
        let early = play("67", scoring: "touchdown", period: 4, clock: 400, home: 27, away: 24, endX: 100)
        check(FootballFeed.moment(early, before: (20, 24))?.decisive == false, "a go-ahead TD with 6:40 left isn't (yet)")
        let overtime = play("59", scoring: "field-goal", period: 5, clock: 300, home: 20, away: 23, side: .bottom)
        check(FootballFeed.moment(overtime, before: (20, 20))?.decisive == true, "an overtime field goal that leads is decisive")
        check(FootballFeed.moment(goAhead)?.decisive == false, "with no score before the play, nothing is decided")
        let order = [play("5", home: 7, away: 3), play("67", scoring: "touchdown", home: 14, away: 3)].enumerated().map { i, p in
            DrivePlay(id: "\(i)", side: p.side, startX: p.startX, endX: p.endX, kind: p.kind, downDistance: nil, yards: p.yards, clock: "",
                      text: "", driveID: nil, homeScore: p.homeScore, awayScore: p.awayScore)
        }
        check(FootballFeed.score(before: order[1], in: order).map { [$0.home, $0.away] } == [7, 3], "the score going in is the play before's")
    }

    // MARK: Climbing: the Women's Lead Final (IFSC round 11362)

    private static func climbingPasses() {
        typealias C = GameDetail.WallRoute.Climber
        func c(_ id: Int, _ h: Double, top: Bool = false) -> C {
            C(id: id, name: "\(id)", country: nil, flag: nil, height: h, top: top, label: LeadAscentView.label(h, top: top), rank: nil)
        }
        // Done before Rogora climbs: Rakovec 46+, Nakagawa 46+, Doumont 44+, Siruckova 38, Fisher 37+.
        let done = [c(1160, 46.5), c(11783, 46.5), c(328, 44.5), c(1447, 38), c(13022, 37.5)]
        check(LeadAscentView.label(46.5, top: false) == "46+" && LeadAscentView.label(47, top: false) == "47"
              && LeadAscentView.label(53, top: true) == "Top", "heights read like IFSC's")
        check(LeadAscentView.place(of: 44, top: false, among: done) == 4 && LeadAscentView.place(of: 47, top: false, among: done) == 1,
              "Rogora at 44 is 4th; at 47 she leads")
        check(LeadAscentView.nextTarget(above: 44, top: false, among: done)?.id == 328, "next to pass from 44: Doumont 44+")
        check(LeadAscentView.nextTarget(above: 46.5, top: false, among: done) != nil, "level with a mark, it's still to pass (a tie isn't a pass)")
        check(LeadAscentView.nextTarget(above: 47, top: false, among: done) == nil, "leading: no target")
        check(LeadAscentView.holdsToGo(from: 44, top: false, among: done) == "1 hold to 3rd", "from 44: 1 hold to 3rd",
              LeadAscentView.holdsToGo(from: 44, top: false, among: done) ?? "nil")
        check(LeadAscentView.holdsToGo(from: 44.5, top: false, among: done) == "1 hold to 3rd", "level at 44+: still 1 hold to 3rd",
              LeadAscentView.holdsToGo(from: 44.5, top: false, among: done) ?? "nil")
        check(LeadAscentView.holdsToGo(from: 45, top: false, among: done) == "2 holds to lead", "from 45: 2 holds to lead (hold 47 passes 46+)",
              LeadAscentView.holdsToGo(from: 45, top: false, among: done) ?? "nil")
        check(LeadAscentView.holdsToGo(from: 47, top: false, among: done) == nil && LeadAscentView.holdsToGo(from: 40, top: true, among: done) == nil,
              "leading or topped: nothing to go")
        check(LeadAscentView.holdsToGo(from: 40, top: false, among: [c(1, 0, top: true)]) == nil, "only a top would pass a topper: no hold count")
        check(LeadAscentView.isFinal("Final") && !LeadAscentView.isFinal("Semi-final") && !LeadAscentView.isFinal("Qualification")
              && !LeadAscentView.isFinal(nil), "a final is the round named Final")

        var m = LiveMoment(id: "pass:928:11783", chart: .ascent, tier: .score, kind: .passed, lead: "", detail: "")
        let rogora = { (h: Double) in var r = c(928, h); r.onWall = true; return r }
        let pass = LeadAscentView.pass(for: m, climber: rogora(47), from: 44, done: done, scale: 51, reduceMotion: false)
        check(pass.knocks.map(\.id) == [328, 1160, 11783], "44 → 47 passes Doumont, then the two at 46+, lowest first", "\(pass.knocks.map(\.id))")
        let times = pass.knocks.map(\.at)
        check(zip(times, times.dropFirst()).allSatisfy { $0 < $1 } && times.allSatisfy { $0 >= 0.04 && $0 <= 0.45 },
              "knocks land in order, within the dot's travel", "\(times)")
        check(abs((times[2] - times[1]) - 0.035) < 0.0001, "marks level with each other ripple 35 ms apart")
        // The dot's center reaches 44.5 (1/6 of the way) and 46.5 (5/6) on the travel spring.
        check(abs(Celebrate.travel(times[0]) - 0.5 / 3) < 0.001 && abs(Celebrate.travel(times[1]) - 2.5 / 3) < 0.001,
              "each knock lands as the travel spring carries the dot across that mark")
        check(pass.flip == times.last, "the place flips as the last climber is passed")
        m.targets = ["11783"]
        check(LeadAscentView.pass(for: m, climber: rogora(47), from: 44, done: done, scale: 51, reduceMotion: false).knocks.map(\.id) == [11783],
              "the moment's targets win over working it out")
        m.targets = []
        let calm = LeadAscentView.pass(for: m, climber: rogora(47), from: 44, done: done, scale: 51, reduceMotion: true)
        check(zip(calm.knocks.map(\.at), [0.08, 0.13, 0.18]).allSatisfy { abs($0 - $1) < 1e-9 },
              "Reduce Motion: the dot jumps, so the marks flash in quick order", "\(calm.knocks.map(\.at))")
        let top = LiveMoment(id: "climb:1147:1", chart: .ascent, tier: .score, kind: .top, lead: "", detail: "")
        let topped = LeadAscentView.pass(for: top, climber: c(1147, 49, top: true), from: 47.5, done: [c(928, 48.5)] + done, scale: 53, reduceMotion: false)
        check(topped.knocks.map(\.id) == [928] && topped.flip > topped.knocks[0].at && abs(Celebrate.travel(topped.flip) - 0.85) < 0.01,
              "a top knocks whoever it passes and flips as the dot reaches TOP")
        check(LeadAscentView.climberID(top) == 1147 && LeadAscentView.climberID(m) == 928, "moments name their climber")
        check(abs(Celebrate.travel(Celebrate.travelTime(reaching: 0.6)) - 0.6) < 0.001 && Celebrate.travel(0) == 0
              && Celebrate.travel(1.2) > 0.999, "travel timing inverts the travel spring")
        check(Medal.color(1, scheme: .light) != nil && Medal.color(3, scheme: .dark) != nil && Medal.color(4, scheme: .dark) == nil,
              "medal colors for the podium only")
    }

    // MARK: Boulder

    private static func boulderDeltas() {
        typealias B = GameDetail.BoulderCard
        func card(_ id: Int, _ rank: Int?) -> B { B(id: id, rank: rank, name: "", country: nil, flag: nil, problems: [], score: nil) }
        let deltas = BoulderScorecard.rankDeltas(from: [12611: 2, 688: 1, 2385: 3], to: [card(12611, 1), card(688, 2), card(2385, 3), card(7, 4)])
        check(deltas == [12611: 1, 688: -1], "Katz up 1, Milne down 1; unchanged and new athletes carry nothing", "\(deltas)")
        check(BoulderScorecard.rankDeltas(from: [1: 2], to: [card(1, nil)]).isEmpty, "unranked: no delta")
    }

    // MARK: CS2

    private static func counterStrikeState() {
        let cases: [(Int, Int, GameDetail.Side?)] = [(12, 11, .top), (11, 12, .bottom), (12, 12, nil), (15, 14, .top), (15, 15, nil), (18, 17, .top), (3, 2, nil)]
        for (top, bottom, expected) in cases {
            check(RoundHistoryView.mapPoint(top: top, bottom: bottom) == expected, "map point at \(top)–\(bottom)",
                  "\(String(describing: RoundHistoryView.mapPoint(top: top, bottom: bottom))) (first to \(RoundHistoryView.target(top: top, bottom: bottom)))")
        }
        func round(_ n: Int, _ w: GameDetail.Side) -> GameDetail.CSRound {
            GameDetail.CSRound(number: n, winner: w, winnerSide: nil, reason: .elimination, topEquipment: nil, bottomEquipment: nil)
        }
        func reading(_ top: Int, _ bottom: Int) -> GameDetail.CSLive {
            GameDetail.CSLive(mapName: nil, mapNumber: 1, round: nil, topScore: top, bottomScore: bottom, topSide: nil, bottomSide: nil, mapEnded: false)
        }
        let rounds = [round(1, .top), round(2, .bottom), round(3, .top)]
        let one = RoundHistoryView.provisional(rounds, reading: reading(3, 1))
        check(one.map(\.number) == [4] && one.first?.winner == .top, "one unprocessed round: its winner from the score")
        check(RoundHistoryView.provisional(rounds, reading: reading(2, 3)).map(\.number) == [4, 5], "two, both one way: both slot in")
        check(RoundHistoryView.provisional(rounds, reading: reading(3, 2)).isEmpty, "a split: the order is unknown, so no squares")
        check(RoundHistoryView.provisional(rounds, reading: reading(2, 1)).isEmpty && RoundHistoryView.provisional(rounds, reading: nil).isEmpty,
              "caught up (or no live feed): nothing provisional")
    }

    // MARK: Triggers

    private static func chartTriggers() {
        var beats = Beats()
        beats.fire(["a", "b"])
        beats.fire(["a"])
        check(beats["a"] == 2 && beats["b"] == 1 && beats["c"] == 0, "per-mark triggers step only for the marks a moment reaches")
        check(Beats(playing: ["x"])["x"] == 1 && Beats(playing: ["x"])["y"] == 0, "the frozen clock's beats: 1 for each mark playing")
        check(CelebrationClock.frozen(0.4).frozenTime == 0.4 && CelebrationClock.live.frozenTime == nil, "frozen time reads off the clock")
    }
}
