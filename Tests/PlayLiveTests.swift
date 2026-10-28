import Foundation

// The play theater against what the live feeds really do (World Series Game
// 4, watched live: Tests/Fixtures/ws-g4-plays.json as ESPN finally had it,
// ws-g4-rewrites.json as it first posted what it later rewrote, and MLB's
// feed, statcast-849803.json): MLB names an at-bat's event mid-at-bat ("Mound
// Visit") and posts a ball's hitData seconds after its result; ESPN rewrites
// results behind the tail and replaces a challenged pitch with a new ID; and
// the plays ESPN's text alone got wrong, in scorer's notation.

extension ScorelineTests {
    static func playLive() {
        print("\nPlay theater: live, as the feeds really are")
        let dir = FixtureProtocol.directory
        guard let espn = try? Data(contentsOf: dir.appendingPathComponent("ws-g4-plays.json")),
              let mlb = try? Data(contentsOf: dir.appendingPathComponent("statcast-849803.json")),
              let posted = try? Data(contentsOf: dir.appendingPathComponent("ws-g4-rewrites.json")) else {
            return check(false, "Game 4's plays, rewrites and MLB feed load")
        }
        let g4 = JSON(data: espn)
        let plays = g4["items"].array
        var names: [String: String] = [:]
        for (id, name) in (g4["names"].raw as? [String: String]) ?? [:] { names[id] = name }
        let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        let atBats = Statcast.atBats(JSON(data: mlb))
        let rewrites = JSON(data: posted)["early"].array
        func scene(_ id: String, in plays: [JSON] = plays, measured: Bool = false) -> PlayScene? {
            guard let i = plays.firstIndex(where: { $0["id"].string == id }), var s = PlayScene.parse(plays, at: i, side: side, names: names) else {
                return nil
            }
            if measured { s.measured = s.measurement(in: atBats) ?? s.runnerMeasurement(in: atBats) }
            return s
        }
        func script(_ s: PlayScene?) -> PlayScript? {
            s.map { PlayScript($0, rest: PlayScript.Rest(bases: $0.endsInning ? [false, false, false] : $0.basesAfter, bats: .right,
                                                          swapped: $0.endsInning)) }
        }
        func ends(_ s: PlayScene?) -> String {
            (s?.runners ?? []).map { r in
                let from = r.from == 0 ? "B" : "\(r.from)"
                switch r.end {
                case let .base(b): return "\(from)→\(b)"
                case .scored: return "\(from)→R"
                case let .out(at): return "\(from)×\(at.map(String.init) ?? "c")"
                }
            }.joined(separator: " ")
        }

        // MARK: Statcast: over means over

        check(Statcast.fields.contains("isComplete") && atBats.count == 92 && atBats.allSatisfy(\.complete),
              "the feed's fields ask whether each at-bat is over (all 92 of Game 4's are, now)")
        // Turang's groundout in the 8th, as the live poll caught it: MLB had named it "Mound Visit", not over.
        let turang = scene("4019080451403990057", measured: false)
        if let s = turang, let real = s.atBat(in: atBats) {
            let visit = Statcast.AtBat(index: real.index, inning: real.inning, top: real.top, batter: real.batter, event: "Mound Visit",
                                       pitches: real.pitches, batted: nil, complete: false)
            check(s.measurement(in: [visit]) == nil && !visit.over, "an at-bat MLB has named for a mound visit isn't over: not this result, asked again")
            let noHit = Statcast.AtBat(index: real.index, inning: real.inning, top: real.top, batter: real.batter, event: real.event,
                                       pitches: real.pitches, batted: nil, complete: true, inPlay: true)
            check(s.measurement(in: [noHit]) == nil && !noHit.over && s.measurement(in: atBats)?.batted != nil && real.over,
                  "…nor a groundout before its hitData has posted (it can trail the result by seconds): asked again until it's there")
        } else {
            check(false, "Turang's groundout and its at-bat load")
        }
        let walks = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
            .compactMap { PlayScene.parse(plays, at: $0, side: side, names: names) }.filter { if case .walk = $0.kind { return true }; return false }
        check(!walks.isEmpty && walks.allSatisfy { $0.measurement(in: atBats)?.batted == nil && $0.measurement(in: atBats) != nil },
              "a walk has nothing to wait for: found once it's over")

        // MARK: ESPN's rewrites

        let early = Dictionary(rewrites.compactMap { e in e["id"].string.map { ($0, e) } }, uniquingKeysWith: { a, _ in a })
        func at(_ id: String) -> Int { plays.firstIndex { $0["id"].string == id } ?? 0 }
        // DeLuca's fielder's choice, first posted as a walk ("Official Scorer Ruling Pending") and rewritten two minutes later.
        let fc = at("4019080450703990057")
        var before = Array(plays[...fc])
        before[fc] = early["4019080450703990057"] ?? before[fc]
        if let out = early["4019080450703030072"] { before.insert(out, at: fc) }
        let window = Array(before.suffix(80)), start = before.count - window.count
        if let from = BaseballFeed.rereadStart(window) {
            let previous = window[from]["atBatId"].string
            check(previous == "4019080450702" && window[from...].allSatisfy { ["4019080450702", "4019080450703"].contains($0["atBatId"].string) },
                  "each look reads again from the previous at-bat's first entry", "\(previous ?? "-")")
            let fresh = Array(plays[(start + from)...(fc + 3)])
            let look = BaseballFeed.reread(window, from: from, fresh: fresh)
            check(look.revised.map { $0.new["id"].string } == ["4019080450703990057"] && look.gone == ["4019080450703030072"]
                  && look.new.count == 3 && look.window.count == from + fresh.count,
                  "…and finds the result ESPN rewrote, the entry it dropped, and the new ones", "\(look.revised.count) \(look.gone) \(look.new.count)")
            let was = PlayScene.theater(window, side: side, names: names).play
            let now = PlayScene.theater(Array(look.window.prefix(fc - start + 1)), side: side, names: names).play
            check(was?.kind == .walk(intentional: false) && now?.kind == .fieldersChoice && now?.id == was?.id,
                  "…so the theater's walk becomes the fielder's choice it was (the same play, the scorer's ruling in)")
        } else {
            check(false, "a re-read start in the window")
        }
        // Pratt's steal in the 9th, rewritten three and a half minutes later as caught stealing.
        let cs = at("4019080451604030298")
        var stale = Array(plays[...cs])
        stale[cs] = early["4019080451604030298"] ?? stale[cs]
        let staleScene = PlayScene.theater(Array(stale.suffix(80)), side: side, names: names).play
        let fixed = PlayScene.theater(Array(plays[...cs].suffix(80)), side: side, names: names).play
        check(staleScene?.kind == .stolenBase && fixed?.kind == .caughtStealing && fixed?.notation.code == "CS 2-4",
              "a steal rewritten as caught stealing replays as CS 2-4 once read again")
        // A challenged pitch replaced in place with a new ID (ball, confirmed → strike, overturned).
        let challenged = at("4019080450605030091")
        var pitched = Array(plays[...(challenged + 2)])
        pitched[challenged] = early["4019080450605030090"] ?? pitched[challenged]
        let pitchWindow = Array(pitched.suffix(80))
        if let from = BaseballFeed.rereadStart(pitchWindow) {
            let offset = pitched.count - pitchWindow.count
            let look = BaseballFeed.reread(pitchWindow, from: from, fresh: Array(plays[(offset + from)...(challenged + 2)]))
            check(look.gone == ["4019080450605030090"] && look.new.compactMap { $0["id"].string } == ["4019080450605030091"]
                  && !look.window.contains { $0["id"].string == "4019080450605030090" }
                  && ESPNDetail.currentAtBat(look.window).count == ESPNDetail.currentAtBat(Array(plays[...(challenged + 2)].suffix(80))).count,
                  "a pitch replaced by a new ID: the old one's gone, the new one counts, This At-Bat as ESPN has it now")
        }
        // Moments: a rewrite into something bigger is news again; into something else, the old one's taken back.
        if let scored = early["4019080450703990057"] {
            let rewrite = BaseballFeed.rewritten(scored, plays[fc], side: side)
            check(rewrite.offer?.kind == .runScored && !rewrite.retract, "the run that scored on the pending ruling still scores: its moment stands")
        }
        let single = JSON(["id": "r", "type": ["type": "play-result"], "alternativeType": ["type": "single"], "text": "Díaz singled to left.",
                           "team": ["id": "30"]] as [String: Any])
        let out = JSON(["id": "r", "type": ["type": "play-result"], "alternativeType": ["type": "ground-out"], "text": "Díaz grounded out to third.",
                        "team": ["id": "30"]] as [String: Any])
        let taken = BaseballFeed.rewritten(single, out, side: side), raised = BaseballFeed.rewritten(out, single, side: side)
        check(taken.retract && taken.offer?.kind == .outInPlay && raised.retract && raised.offer?.kind == .hit,
              "a single rewritten as an out is taken back (the out offered instead); an out rewritten as a hit, the hit offered in its place")

        // MARK: What ESPN's text alone got wrong

        let steal = scene("4019080450004040298")
        check(ends(steal) == "1→3" && steal?.notation.code == "SB E2", "a steal and the catcher's throwing error: 1→3 (\"safe at third\"), marked SB E2",
              "\(ends(steal)) \(steal?.notation.code ?? "-")")
        if let s = scene("4019080450705040298"), let sc = script(s) {
            check(s.title == "Picked off" && sc.release == nil && sc.actors[0].actions.contains { $0.kind == .throwBall }
                  && !sc.actors[1].actions.contains { $0.kind == .throwBall },
                  "a pickoff caught stealing: no pitch, the pitcher's throw (not the catcher's), titled \"Picked off\"")
        }
        let lined = scene("4019080451102990057")
        check(ends(lined) == "B×c 1×1" && lined?.notation.code == "L4-3 DP", "a liner into a double play: the batter out on the catch, the runner doubled off first; L4-3 DP",
              ends(lined))
        // "DeLuca grounded out to second", as ESPN and MLB first placed it: at the plate.
        if var s = scene("4019080451302990057") {
            s.spot = CGPoint(x: 126, y: 204)
            if let sc = script(s), let b = sc.batted {
                let to = sc.flights[b].to.ground, second = Ballpark.position(4)
                check(hypot(to.x - second.x, to.y - second.y) < 20 && sc.actors[3].actions.contains { $0.kind == .scoop },
                      "a grounder to second spotted at the plate (an upstream glitch): fielded where the second baseman plays")
            }
        }
        // The walk-off: Williamson's single in the 12th.
        if let s = scene("4019080452305990057", measured: true), let sc = script(s), let run = sc.flashes.first(where: { $0.beat == .run }) {
            check(s.walkOff && sc.banner?.text == "WALK-OFF" && abs((sc.banner?.at ?? 0) - run.at) < 0.001 && s.measured?.movements.isEmpty == false,
                  "the walk-off single in the 12th: WALK-OFF as Fortes crosses")
        }

        // MARK: Scorer's notation

        let marks = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
            .compactMap { PlayScene.parse(plays, at: $0, side: side, names: names) }.map(\.notation.code)
        let pattern = #/^(1B|2B|3B)( E[1-9])?$|^HR$|^K( 2-3)?$|^BB$|^IBB$|^HBP$|^SB( E[1-9])?$|^(CS|PO)( [1-9](-[1-9])*)?$|^WP$|^PB$|^BK$|^DI$|^[1-9](-[1-9])+$|^[1-9]U$|^[FLP][1-9]$|^FC( [1-9](-[1-9])*)?$|^[LFP]?[1-9](-[1-9])* (DP|TP)$|^SF[1-9]$|^SAC( [1-9](-[1-9])*)?$|^E[1-9]$/#
        let odd = marks.filter { $0.wholeMatch(of: pattern) == nil }
        check(!marks.isEmpty && odd.isEmpty, "every Game 4 mark is scorer's notation (6-3, 4-6-3 DP, L4-3 DP, 3U, F8, K, SB, CS 2-4, FC 6-4, HR…)",
              odd.joined(separator: ", "))

        // MARK: At the Plate between halves

        // After the third out (the live check: 0 outs with the old batter for about 25 s, and once no
        // batter at all), on Game 4's own entries: Turang grounds out to end the top of the 1st; then
        // "Middle of the 1st", the bottom's start, and "Dustin May pitches to Yandy Diaz".
        let third = at("4019080450005990057")
        func upTo(_ n: Int) -> [JSON] { Array(plays[...(third + n)]) }
        // ESPN's situation as reported: outs reset to 0, still naming Turang.
        func reported(balls: Int = 0, onFirst: Bool = false, onThird: Bool = false, batter: String? = "B. Turang",
                      batterID: String? = "41179", pitcher: String? = "G. Jax", pitcherID: String? = "42604") -> GameDetail.Baseball {
            GameDetail.Baseball(balls: balls, strikes: 0, outs: 0, onFirst: onFirst, onSecond: false, onThird: onThird, batter: batter,
                                pitcher: pitcher, lastPlay: "Turang grounded out to shortstop.", batterID: batterID, pitcherID: pitcherID)
        }
        // A pinch hitter's ID before the box score has his name.
        var unnamed = names
        unnamed["33481"] = nil
        func settled(_ s: GameDetail.Baseball, _ n: Int, boxScore: [String: String]? = nil) -> GameDetail.Baseball? {
            BaseballFeed.settledSituation(s, window: upTo(n), names: boxScore ?? names)
        }
        // Runners were left on first and third.
        let halves = [0, 1, 2, 3].compactMap { settled(reported(balls: 1, onFirst: true, onThird: true), $0) }
        func asEnded(_ s: GameDetail.Baseball) -> Bool {
            let cleared = s.outs == 3 && s.balls == 0 && s.strikes == 0 && !s.onFirst && !s.onThird
            return cleared && s.batter == "B. Turang" && s.pitcher == "G. Jax"
        }
        check(halves.count == 4 && halves.allSatisfy(asEnded),
              "the half as it ended until the next half's batter: 3 outs, the count and bases cleared, the last matchup",
              "\(halves.map { "\($0.outs) \($0.batter ?? "nil")" })")
        let nobody = settled(reported(batter: nil, batterID: nil, pitcher: nil, pitcherID: nil), 2)
        let nobodyMatchup: [String?] = [nobody?.batter, nobody?.batterID, nobody?.pitcher]
        check(nobody?.outs == 3 && nobodyMatchup == ["B. Turang", "41179", "G. Jax"],
              "…and when it names nobody, the batter's row stays", "\(String(describing: nobody))")
        let nextHalf = reported(batter: "Y. Diaz", batterID: "33481", pitcher: "D. May", pitcherID: "40937")
        check(settled(nextHalf, 2) == nextHalf, "the break as ESPN has it once it names the next half's batter")
        // Bottom of the 1st under way in the plays; ESPN's situation still on Turang.
        let underway = settled(reported(), 4)
        let matchup: [String?] = [underway?.batter, underway?.batterID, underway?.pitcher, underway?.pitcherID]
        check(underway?.outs == 0 && matchup == ["Y. Diaz", "33481", "D. May", "40937"],
              "a situation still naming the batter the plays have retired takes the at-bat under way", "\(String(describing: underway))")
        let pinch = settled(reported(), 4, boxScore: unnamed)
        let pinchNamed = settled(reported(batter: nil, batterID: "33481", pitcher: "D. May", pitcherID: "40937"), 4, boxScore: unnamed)
        let pinchRow: [String?] = [pinch?.batter, pinch?.batterID, pinchNamed?.batter]
        check(pinchRow == ["Yandy Diaz", "33481", "Yandy Diaz"],
              "a name the box score lacks comes from the at-bat's own words (\"Dustin May pitches to Yandy Diaz\")",
              "\(pinch?.batter ?? "nil") \(pinchNamed?.batter ?? "nil")")
        check(settled(nextHalf, 4) == nextHalf, "an at-bat the situation already has: unchanged")
        check(BaseballFeed.matchup("Dustin May pitches to Yandy Diaz.").map { [$0.pitcher, $0.batter] } == ["Dustin May", "Yandy Diaz"]
              && BaseballFeed.matchup("Mid 1st") == nil, "the matchup in an at-bat's words, without the full stop")
    }
}
