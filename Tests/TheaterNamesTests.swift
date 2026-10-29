import SwiftUI

// The names on the isometric views (TheaterNames.swift and each sport's
// cast), checked on real games: who each figure is and who the moment is
// about, per sport and play type, from the fixtures the theaters replay and
// the summaries that name their men (trimmed, Tests/Fixtures/names-*:
// SA at UTAH's box score, KC at SEA's, Aston Villa v Man City's rosters with
// their changes, MLB's numbers for World Series Game 2); and the pure parts
// every theater shares: the hit test, where a tag goes against the well and
// its furniture, how the pointer's tag comes and goes, and who crosses a tag
// lying under the play (ringed over it alone).

extension ScorelineTests {
    static func theaterNames() {
        print("\nTheater names")
        let dir = FixtureProtocol.directory
        func json(_ name: String) -> JSON? { (try? Data(contentsOf: dir.appendingPathComponent(name))).map { JSON(data: $0) } }
        func person(_ cast: TheaterCast, _ i: Int?) -> TheaterPerson? { i.flatMap { cast.members[$0]?.who.person } }
        func tag(_ p: TheaterPerson?) -> String { p.map { "\($0.number ?? "-") \($0.last) \($0.position ?? "-")" } ?? "none" }

        // MARK: Surnames

        check(TheaterPerson.surname("Mikel Brown Jr.") == "Brown Jr." && TheaterPerson.surname("Kenneth Walker III") == "Walker III"
              && TheaterPerson.surname("Alysson") == "Alysson" && TheaterPerson.afterInitials("D. Jones Garcia") == "Jones Garcia"
              && TheaterPerson.afterInitials("S.Barkley") == "Barkley" && TheaterPerson.afterInitials("V. Mesa Jr.") == "Mesa Jr.",
              "a tag's surname: Brown Jr., Walker III, Alysson; a short name past its initials: Jones Garcia, Barkley, Mesa Jr.")

        // MARK: Basketball

        if let game = json("nba-every-play-401909890.json")?["games"].array.first, let box = json("names-nba-401909890-boxscore.json") {
            let items = game["items"].array
            let teams = BasketballFeed.Teams(topIsHome: false, topID: "24", bottomID: "26", topName: "SA", bottomName: "UTAH")
            func scene(_ id: String) -> BasketballScene? { items.firstIndex { $0["id"].string == id }.flatMap { BasketballScene.parse(items, at: $0, teams: teams) } }
            let people = TheaterPeople.boxscore(box)
            check(people["5104157"].map(tag) == "1 Wembanyama F" && people["5037871"].map(tag) == "2 Harper G" && people.count == 26,
                  "the box score's men by athlete ID, with their numbers and positions: 1 WEMBANYAMA F, 2 HARPER G (26 of them)")
            if let three = scene("40190989026") {
                let script = BasketballScript(three)
                let cast = script.cast(three, people: people, scope: three.id)
                let named = cast.members.filter { $0.value.who.person != nil }
                check(tag(person(cast, script.shooter)) == "1 Wembanyama F" && named.count == 2
                      && named.values.compactMap(\.who.person).contains { $0.last == "Castle" && $0.number == "5" },
                      "Wembanyama's three: the shooter #1 and Castle (#5, the assist) named, nobody else",
                      named.values.compactMap(\.who.person).map(tag).joined(separator: ", "))
                check(cast.members.filter { $0.value.who == .team }.count == 8 && cast.key(at: 1.2) == script.shooter
                      && cast.members.values.filter { $0.side == .top }.count == 5,
                      "…the other eight his team's, no more; the key man the shooter; five a side")
            } else { check(false, "Wembanyama's three parses") }
            if let block = scene("40190989032") {
                let script = BasketballScript(block)
                let cast = script.cast(block, people: people, scope: block.id)
                check(tag(person(cast, cast.key(at: 2))) == "19 Bailey G" && tag(person(cast, script.shooter)) == "5 Castle G",
                      "a block is about the blocker: Bailey (#19) over Castle's layup", tag(person(cast, cast.key(at: 2))))
            }
            if let foul = scene("40190989028") {
                let script = BasketballScript(beat: foul, ends: HoopsEnds(topRight: true, topOpensRight: true), from: nil)
                let cast = script.cast(foul, people: people, scope: foul.id)
                check(tag(person(cast, cast.key(at: 1))) == "1 Wembanyama F" && script.players[cast.key(at: 1) ?? 0].team == .defense,
                      "a shooting foul is about the man whistled: Wembanyama, the defender in on it", tag(person(cast, cast.key(at: 1))))
            }
            if let steal = scene("4019098908") {
                let script = BasketballScript(beat: steal, ends: HoopsEnds(topRight: true, topOpensRight: true), from: nil)
                let cast = script.cast(steal, people: people, scope: steal.id)
                check(tag(person(cast, cast.key(at: 1))) == "19 Bailey G" && cast.members.values.contains { $0.who.person?.last == "Castle" },
                      "a bad pass stolen: the man who lost it is the key man (the text leads with him), the stealer named too")
            }
            if let three = scene("40190989026"), let sub = scene("40190989063") {
                let before = BasketballScript(three)
                let script = BasketballScript(beat: sub, group: [sub], ends: HoopsEnds(topRight: true, topOpensRight: true),
                                              from: before.lineup(at: before.duration))
                let cast = script.cast(sub, people: people, scope: sub.id)
                check(tag(person(cast, cast.key(at: 1))) == "8 Collier G" && cast.members.values.contains { $0.who.person?.last == "Peterson" },
                      "a substitution: the man coming in (Collier, #8) is the key man, the man going off named",
                      tag(person(cast, cast.key(at: 1))))
            }
            let timeout = items.firstIndex { $0["id"].string == "40190989074" }.flatMap { BasketballScene.parse(items, at: $0, teams: teams) }
            check(BasketballScript.key(timeout) == nil && BasketballScript.key(nil) == nil, "a timeout, and the court between plays, are about nobody")
        } else { check(false, "the NBA fixtures load") }

        // MARK: Football

        if let raw = json("nfl-turnovers-plays.json"), let game = raw["games"].array.first, let box = json("names-nfl-401873022-boxscore.json"),
           let charts = json("nfl-depthcharts.json")?["teams"] {
            let teams = FootballFeed.Teams(topIsHome: false, topID: "12", bottomID: "26", homeAbbreviation: "SEA", awayAbbreviation: "KC",
                                           homeName: "Seahawks", awayName: "Chiefs")
            var depth: [GameDetail.Side: FootballDepthChart] = [:]
            if let kc = FootballDepthChart(charts["12"]) { depth[.top] = kc }
            if let sea = FootballDepthChart(charts["26"]) { depth[.bottom] = sea }
            let people = TheaterPeople.boxscore(box)
            func scene(_ clue: String) -> FootballScene? {
                game["items"].array.first { ($0["text"].string ?? "").contains(clue) }.flatMap { FootballScene.parse($0, teams: teams)?.slotted(by: depth) }
            }
            if let pass = scene("pass short middle to E.Johnson") {
                let script = FootballScript(pass)
                let cast = script.cast(pass, offense: .top, people: people, scope: pass.id)
                let named = cast.members.compactMap { $0.value.who.person }.map(tag).sorted()
                let qb = script.players.indices.first { script.players[$0].role == .quarterback }
                check(named == ["10 Johnson RB", "15 Mahomes QB", "91 Murphy II NT"] && tag(person(cast, qb)) == "15 Mahomes QB",
                      "Mahomes to E. Johnson: only the credited men named, each on his own figure (the passer, the back he threw to, Murphy the tackler at his slot)",
                      named.joined(separator: ", "))
                let assumed = cast.members.values.compactMap { m -> String? in if case let .assumed(p) = m.who { return p }; return nil }
                check(assumed.count == 19 && assumed.contains("DE") && assumed.contains("LT") && assumed.contains("FS"),
                      "…the other nineteen only their team and place (SEAHAWKS · DE), never the depth chart's names", assumed.sorted().joined(separator: " "))
                let receiver = cast.keys.last?.figure
                let caught = script.legs.first { if case let .carry(p) = $0.hand { return p == receiver }; return false }?.from ?? 99
                check(cast.key(at: 0) == qb && cast.key(at: caught - 0.05) == qb && cast.key(at: caught + 0.01) == receiver
                      && cast.key(at: .infinity) == receiver && receiver != qb,
                      "the key man has the ball: the quarterback from the start and through the throw's flight, the receiver from the catch to the end",
                      "\(cast.keys)")
                check(script.players.indices.filter { script.players[$0].team == .official || script.players[$0].team == .staff }
                        .allSatisfy { cast.members[$0] == nil }, "officials and trainers get no tag")
            } else { check(false, "the Mahomes to Johnson play parses") }
            var kickoff: FootballScene?
            for g in raw["games"].array {
                let t = FootballFeed.Teams(topIsHome: false, topID: g["away"]["id"].string, bottomID: g["home"]["id"].string,
                                           homeAbbreviation: g["home"]["abbreviation"].string ?? "", awayAbbreviation: g["away"]["abbreviation"].string ?? "",
                                           homeName: g["home"]["name"].string ?? "", awayName: g["away"]["name"].string ?? "")
                kickoff = kickoff ?? g["items"].array.lazy.compactMap { FootballScene.parse($0, teams: t) }.first { $0.kind == .kickoff && $0.kick == .returned }
            }
            if let kick = kickoff {
                let script = FootballScript(kick)
                let cast = script.cast(kick, offense: kick.offense ?? .top, people: people, scope: kick.id)
                let kicker = cast.key(at: 0)
                check(kicker != nil && script.players[kicker ?? 0].role == .kicker && cast.key(at: .infinity).map { script.players[$0].role } == .returner,
                      "a kickoff is about the kicker until it's caught, then the returner", kick.text)
            } else { check(false, "a returned kickoff in the fixtures") }
        } else { check(false, "the NFL fixtures load") }
        if let raw = json("cfb-plays.json"), let game = raw["games"].array.first {
            let teams = FootballFeed.Teams(topIsHome: false, topID: game["away"]["id"].string, bottomID: game["home"]["id"].string,
                                           homeAbbreviation: game["home"]["abbreviation"].string ?? "", awayAbbreviation: game["away"]["abbreviation"].string ?? "",
                                           homeName: game["home"]["name"].string ?? "", awayName: game["away"]["name"].string ?? "")
            if let item = game["items"].array.first(where: { $0["id"].string == "40185672712" }), let pass = FootballScene.parse(item, teams: teams) {
                let script = FootballScript(pass)
                let cast = script.cast(pass, offense: pass.offense ?? .top, people: [:], scope: pass.id)
                let named = cast.members.compactMap { $0.value.who.person }.map(tag).sorted()
                check(named == ["12 Russell QB", "40 Ford TE", "7 Brooks LB"] || (named.count == 3 && named.contains("12 Russell QB")),
                      "college (no depth chart): the credited men by role, named and numbered from the text (#12 K.Russell)",
                      named.joined(separator: ", "))
            }
        }

        // MARK: Soccer

        if let match = json("soccer-theater-plays.json")?["matches"].array.first, let rosters = json("names-soccer-401879256-rosters.json") {
            let home = match["home"]["id"].string
            let lineups = SoccerLineup.lineups(rosters["rosters"]) { $0 == home ? .top : .bottom }
            let city = lineups[.bottom]
            check(city?.subs.count == 3 && city?.subs.first.map { $0.athlete == "250787" || $0.athlete == "325564" } == true
                  && city?.subs.last?.at == 69 * 60,
                  "Man City's changes from the rosters: Foden and Lewis at the half, McAidoo at 69'", "\(city?.subs ?? [])")
            func at(_ clock: Double?, _ athlete: String) -> Bool { city?.on(at: clock).players.contains { $0.athlete == athlete } == true }
            check(at(30 * 60, "265907") && !at(30 * 60, "325564") && at(52 * 60, "325564") && !at(52 * 60, "265907") && at(52 * 60, "268641")
                  && at(nil, "395463") && !at(nil, "268641"),
                  "the eleven on at a minute: Guéhi at 30', Lewis in his place at 52' (Ndiaye still on); now, McAidoo for Ndiaye")
            check(city?.on(at: 52 * 60).players.first { $0.athlete == "325564" }?.place == city?.players.first { $0.athlete == "265907" }?.place,
                  "a substitute takes the place in the shape of the man he came on for")
            var haaland: SoccerScene?
            for clip in match["clips"].array.map(\.array) {
                if let i = clip.firstIndex(where: { SoccerScene.isMoment($0) && ($0["text"].string ?? "").contains("Erling Haaland (Manchester City) header") }) {
                    haaland = SoccerScene.parse(clip, at: i, homeTeamID: home, keepers: SoccerScene.keepers(in: clip))
                }
            }
            if let scene = haaland {
                let script = SoccerScript(scene, lineups: lineups)
                let people = TheaterPeople.rosters(rosters)
                let cast = script.cast(attacking: scene.side, lineups: lineups.mapValues { $0.on(at: scene.clock) }, people: people,
                                       key: scene.shooterCredit?.athlete, scope: scene.id)
                let named = cast.members.compactMap { $0.value.who.person }
                check(tag(person(cast, cast.key(at: 4.6))) == "9 Haaland ST", "Haaland's header is about the scorer: 9 HAALAND ST",
                      tag(person(cast, cast.key(at: 4.6))))
                check(named.count == 22 && named.contains { tag($0) == "1 Suzuki GK" } && named.contains { tag($0) == "82 Lewis CB" }
                      && named.contains { tag($0) == "47 Foden AM" } && !named.contains { $0.last == "Guéhi" || $0.last == "Cherki" },
                      "all twenty-two named, the half-time changes made: Lewis at centre-back for Guéhi, Foden behind the striker for Cherki",
                      named.map(tag).sorted().joined(separator: ", "))
                check(script.actors.indices.filter { script.actors[$0].team == .official }.allSatisfy { cast.members[$0] == nil },
                      "the referee gets no tag")
            } else { check(false, "Haaland's header parses") }
            let booked = SoccerEvent(id: "x", kind: .card(red: false, second: false), side: .bottom, player: "Rúben Dias", athlete: "234878")
            let idle = SoccerIdle.make(event: booked, touch: nil, scene: nil, period: 2, lineups: lineups, flipped: false)
            let rest = SoccerScript(idle: idle)
            let restCast = rest.cast(attacking: idle.possession, lineups: idle.lineups, people: TheaterPeople.rosters(rosters), key: SoccerScript.key(idle),
                                     scope: "idle")
            check(tag(person(restCast, restCast.key(at: 1))) == "3 Dias CB" && SoccerScript.key(SoccerIdle.make(event: nil, touch: nil, scene: nil, period: 1,
                                                                                                                 lineups: lineups, flipped: false)) == nil,
                  "between moments: a booking is about the man booked (3 DIAS CB); the ball going round, nobody",
                  tag(person(restCast, restCast.key(at: 1))))
        } else { check(false, "the soccer fixtures load") }

        // MARK: Baseball

        if let summary = json("3bd207fad0c0e7da8976ca99.bin"), let mlb = json("names-mlb-849802-numbers.json") {
            let side: (String?) -> GameDetail.Side? = { $0 == "30" ? .top : $0 == "8" ? .bottom : nil }
            let fielders = BaseballFielders(summary, side: side)
            check(fielders.positions[.top]?[2] == "41674" && fielders.positions[.top]?[6] == nil && fielders.positions[.bottom]?[6] == "5149101"
                  && fielders.pitching[.top] == "33106" && fielders.pitchers[.top]?.first == "42584",
                  "who's in the field now, from the lineups: Fortes catching for Tampa Bay (in for Hicks); nobody at short once Walls was hit for; Pratt at short for Milwaukee; Matz pitching, Rasmussen first")
            let numbers = Statcast.numbers(mlb)
            check(numbers[Statcast.folded("Drew Rasmussen")] == "57" && numbers.count == 52,
                  "MLB's numbers by name, the pitchers' too: Rasmussen #57", "\(numbers[Statcast.folded("Drew Rasmussen")] ?? "-") of \(numbers.count)")
            var names: [String: String] = [:]
            for team in summary["boxscore"]["players"].array {
                for g in team["statistics"].array { for e in g["athletes"].array { if let id = e["athlete"]["id"].string { names[id] = e["athlete"]["shortName"].string } } }
            }
            let people = TheaterPeople.boxscore(summary).merging(TheaterPeople.rosters(summary)) { _, r in r }
            let plays = summary["plays"].array
            func scene(_ id: String) -> PlayScene? { plays.firstIndex { $0["id"].string == id }.flatMap { PlayScene.parse(plays, at: $0, side: side, names: names) } }
            let now = BaseballNow(side: .bottom, batter: "31283", pitcher: "42584", runners: ["39895", nil, "35013"])
            if let single = scene("4019080430104990057") {
                let rest = PlayScript.Rest(bases: single.basesAfter, bats: .right, fieldingHome: false)
                let script = PlayScript(single, rest: rest)
                let cast = script.cast(single, beat: nil, batting: .bottom, fielders: fielders, people: people, numbers: numbers, now: now, scope: single.id)
                let byRole = { (role: PlayScript.Actor.Role) in script.actors.indices.first { script.actors[$0].role == role } }
                check(tag(person(cast, cast.key(at: 1))) == "24 Contreras C" && script.actors[cast.key(at: 1) ?? 0].role == .batter,
                      "Contreras's single is about the batter: 24 CONTRERAS", tag(person(cast, cast.key(at: 1))))
                check(tag(person(cast, byRole(.fielder(1)))) == "57 Rasmussen P" && tag(person(cast, byRole(.fielder(2)))) == "40 Fortes C"
                      && cast.members[byRole(.fielder(6)) ?? 0]?.who == .assumed("SS"),
                      "the play's own pitcher with MLB's number (57 RASMUSSEN P), the catcher in now (FORTES); short, unknown, only his place (RAYS · SS)")
                let runners = script.actors.indices.filter { script.actors[$0].role == .runner }.compactMap { person(cast, $0)?.last }
                check(Set(runners) == ["Chourio", "Bauers"], "the runners the play names, by ID: Chourio and Bauers", runners.joined(separator: ", "))
                check(script.actors.indices.filter { [.umpire, .coach].contains(script.actors[$0].role) }.allSatisfy { cast.members[$0] == nil },
                      "the umpire gets no tag")
                let bare = script.cast(single, beat: nil, batting: .bottom, fielders: fielders, people: people, numbers: [:], now: now, scope: single.id)
                check(tag(person(bare, byRole(.fielder(1)))) == "- Rasmussen P", "without MLB's numbers the pitcher's tag has no number")
            } else { check(false, "Contreras's single parses") }
            if let steals = scene("4019080431504060398") {
                let script = PlayScript(steals, rest: PlayScript.Rest(bases: steals.basesAfter, bats: .right, fieldingHome: false))
                let cast = script.cast(steals, beat: nil, batting: .bottom, fielders: fielders, people: people, numbers: numbers, now: now, scope: steals.id)
                check(person(cast, cast.key(at: 1))?.last == "Yelich" && script.actors[cast.key(at: 1) ?? 0].role == .runner,
                      "a runner's play is about the runner its text leads with: Yelich stole second, Chourio third")
            }
            let field = PlayScript.Rest(bases: [true, false, true], bats: .right, fieldingHome: false)
            let still = PlayScript(rest: field)
            let restCast = still.cast(nil, beat: nil, batting: .bottom, fielders: fielders, people: people, numbers: numbers, now: now, scope: "field")
            check(person(restCast, restCast.key(at: 0))?.last == "Yelich"
                  && Set(still.actors.indices.filter { still.actors[$0].role == .runner }.compactMap { person(restCast, $0)?.last }) == ["Contreras", "Bauers"],
                  "between plays: the batter at the plate the key man (Yelich), the runners on from the live situation")
            let change = PlayBeat(id: "change", kind: .pitchingChange(reliever: "Booser"), inning: 3, top: false)
            let beat = PlayScript(beat: change, rest: field)
            let beatCast = beat.cast(nil, beat: change, batting: .bottom, fielders: fielders, people: people, numbers: numbers,
                                     now: BaseballNow(side: .bottom, batter: "31283", pitcher: "42584"), scope: change.id)
            let pitchers = beat.actors.indices.filter { beat.actors[$0].role == .fielder(1) }
            check(pitchers.count == 2 && person(beatCast, pitchers.first)?.last == "Rasmussen" && person(beatCast, pitchers.last)?.last == "Booser",
                  "a pitching change: the man going off the one before the reliever (Rasmussen), the reliever by the name the beat gives (Booser)",
                  pitchers.map { tag(person(beatCast, $0)) }.joined(separator: " → "))
        } else { check(false, "the World Series Game 2 fixtures load") }

        // MARK: The hit test

        let figures: [(index: Int, ground: CGPoint, height: CGFloat)] = [(0, CGPoint(x: 100, y: 80), 24), (1, CGPoint(x: 106, y: 90), 26),
                                                                         (2, CGPoint(x: 200, y: 60), 6)]
        check(TheaterTags.hit(figures, at: CGPoint(x: 103, y: 70)) == 1 && TheaterTags.hit(figures, at: CGPoint(x: 99, y: 60)) == 0
              && TheaterTags.hit(figures, at: CGPoint(x: 160, y: 70)) == nil,
              "the hit test: the nearer of two boxes that hold the pointer wins; between figures, nobody")
        check(TheaterTags.hit(figures, at: CGPoint(x: 204, y: 52)) == 2 && TheaterTags.hit(figures, at: CGPoint(x: 95, y: 81)) == 0,
              "a figure far off is never narrower than a fingertip; the box reaches his feet")

        // MARK: Placement

        let well = CGSize(width: 312, height: 156)
        let tag = CGSize(width: 70, height: 14.4)
        let furniture = TheaterTagLayout.furniture(well, status: CGSize(width: 110, height: 16), flip: true, heartbeat: .trailing)
        func ask(_ x: CGFloat, _ top: CGFloat, feet: CGFloat, pointer: Bool) -> TheaterTagLayout.Ask {
            TheaterTagLayout.Ask(size: tag, head: CGPoint(x: x, y: top), feet: feet, pointer: pointer)
        }
        let open = TheaterTagLayout.place([ask(160, 80, feet: 104, pointer: true)], in: well, clear: furniture)[0]
        check(open == CGRect(x: 125, y: 80 - 3 - 14.4, width: 70, height: 14.4), "a tag over his head, centred, 3 pt clear of it", "\(String(describing: open))")
        let left = TheaterTagLayout.place([ask(8, 90, feet: 120, pointer: true)], in: well, clear: [])[0]
        check(left?.minX == 4, "…kept 4 pt inside the well at its edge", "\(String(describing: left))")
        let status = TheaterTagLayout.place([ask(40, 40, feet: 66, pointer: false)], in: well, clear: furniture)[0]
        check(status.map { r in !furniture.contains { $0.intersects(r) } && r.minY > 66 } == true,
              "a tag that would cover the status tag steps under his feet", "\(String(describing: status))")
        let flip = TheaterTagLayout.place([ask(300, 36, feet: 60, pointer: true)], in: well, clear: furniture)[0]
        check(flip.map { r in !furniture.contains { $0.intersects(r) } } == true, "clear of the turn control in the top corner", "\(String(describing: flip))")
        let beat = TheaterTagLayout.place([ask(290, 130, feet: 150, pointer: true)], in: well, clear: furniture)[0]
        check(beat.map { r in !furniture.contains { $0.intersects(r) } } == true, "clear of the heartbeat in the bottom corner", "\(String(describing: beat))")
        let pair = TheaterTagLayout.place([ask(160, 80, feet: 104, pointer: true), ask(170, 82, feet: 106, pointer: false)], in: well, clear: furniture)
        check(pair[0]?.maxY ?? 99 <= 77 && (pair[1]?.minY ?? 0) >= 106, "the pointer's tag wins; the key man's steps under his feet",
              "\(pair.map { String(describing: $0) })")
        let crowd = TheaterTagLayout.place([ask(160, 80, feet: 104, pointer: true), ask(170, 82, feet: 150, pointer: false)], in: well, clear: furniture)
        check(crowd[1] == nil, "…and waits when there's no room under him either")
        let off = TheaterTagLayout.place([ask(400, 60, feet: 90, pointer: false)], in: well, clear: [])
        check(off[0] == nil, "a man out of the well gets no tag")
        var nudged = ask(160, 80, feet: 104, pointer: false), below = nudged
        nudged.spot = TheaterTagSpot(nudge: 0.25)
        below.spot = TheaterTagSpot(under: true)
        let spotted = TheaterTagLayout.place([nudged], in: well, clear: furniture)[0], under = TheaterTagLayout.place([below], in: well, clear: furniture)[0]
        check(spotted == CGRect(x: 142.5, y: 80 - 3 - 14.4, width: 70, height: 14.4) && under == CGRect(x: 125, y: 107, width: 70, height: 14.4),
              "a tag goes where its stretch's spot puts it: nudged a quarter of its width, or under his feet",
              "\(String(describing: spotted)) \(String(describing: under))")
        let stamp = TheaterTagLayout.stamp(CGSize(width: 90, height: 40), in: well, inset: 9)
        check(stamp == CGRect(x: 9, y: 156 - 7.2 - 40, width: 90, height: 40), "the stamp's room, low at the left as it's drawn")

        // MARK: Where round him, through the replay

        // He stands at (160, 100), 24 pt tall; his tag over him spans x 125–195, y 58.6–73.
        func replay(_ others: @escaping (Double) -> [(index: Int, ground: CGPoint, height: CGFloat)]) -> TheaterReplay {
            TheaterReplay(length: 5) { t in TheaterSpots(figures: [(0, CGPoint(x: 160, y: 100), 24)] + others(t), ball: nil) }
        }
        let huddle = replay { _ in [(1, CGPoint(x: 140, y: 88), 24), (2, CGPoint(x: 160, y: 87), 24), (3, CGPoint(x: 180, y: 88), 24)] }
        let alone = replay { _ in [(1, CGPoint(x: 40, y: 120), 24)] }
        let passing = replay { t in [(1, CGPoint(x: t >= 1 && t <= 1.3 ? 160 : 20, y: 88), 24)] }
        let early = replay { t in t < 2 ? [(1, CGPoint(x: 140, y: 88), 24), (2, CGPoint(x: 160, y: 87), 24), (3, CGPoint(x: 180, y: 88), 24)] : [] }
        let all = -Double.infinity..<Double.infinity
        check(TheaterTagPlan.choose(0, tag: tag, pointer: false, over: all, in: well, clear: [], replay: alone) == TheaterTagSpot(),
              "nobody near him: his tag over his head as it always was")
        check(TheaterTagPlan.choose(0, tag: tag, pointer: false, over: all, in: well, clear: [], replay: huddle) == TheaterTagSpot(under: true),
              "a crowd standing over him the whole replay: his tag goes under his feet, where nobody is")
        check(TheaterTagPlan.choose(0, tag: tag, pointer: false, over: all, in: well, clear: [], replay: passing) == TheaterTagSpot(),
              "a man passing through for a moment doesn't move it (the ring takes him)")
        check(TheaterTagPlan.choose(0, tag: tag, pointer: false, over: 2..<5, in: well, clear: [], replay: early) == TheaterTagSpot()
              && TheaterTagPlan.choose(0, tag: tag, pointer: false, over: 0..<2, in: well, clear: [], replay: early) == TheaterTagSpot(under: true),
              "only his own stretch counts: the crowd gone by the time he's key leaves it over his head")
        let corner = replay { _ in [(1, CGPoint(x: 118, y: 88), 24), (2, CGPoint(x: 133, y: 87), 24)] }
        let side = TheaterTagPlan.choose(0, tag: tag, pointer: false, over: all, in: well, clear: [], replay: corner)
        check(side == TheaterTagSpot(nudge: 0.25), "two men at its left end: nudged right a quarter of its width, still over his head", "\(side)")
        check(TheaterTagPlan.spot(0, tag: tag, pointer: false, over: all, in: well, heartbeat: nil, replay: corner, scope: "test|corner") == side
              && TheaterTagPlan.spot(0, tag: tag, pointer: false, over: all, in: well, heartbeat: nil, replay: huddle, scope: "test|corner") == side,
              "chosen once per stretch and kept: asked again for the same replay, the same spot without looking")
        // Off his head, a hairline to him from the tag's nearest edge: down to his head, or up to his feet.
        let him0 = ask(160, 76, feet: 102.4, pointer: false)
        let up = TheaterTags.leader(from: CGRect(x: 142.5, y: 58.6, width: 70, height: 14.4), to: him0, ground: 100).boundingRect
        let down = TheaterTags.leader(from: CGRect(x: 125, y: 105.4, width: 70, height: 14.4), to: him0, ground: 100).boundingRect
        check(abs(up.minX - 160) < 0.01 && up.width < 0.01 && abs(up.minY - 73) < 0.01 && abs(up.maxY - 77) < 0.01
              && abs(down.minX - 160) < 0.01 && abs(down.minY - 100) < 0.01 && abs(down.maxY - 105.4) < 0.01,
              "a tag moved off his head keeps a hairline to him: from its edge to his head, or to his feet", "\(up) \(down)")
        func named(_ i: Int) -> TheaterCast.Member { TheaterCast.Member(who: .known(TheaterPerson(name: "Man \(i)")), side: .top, id: "a:\(i)") }
        let switched = TheaterCast(members: [3: named(3), 7: named(7)], keys: [TheaterCast.Key(from: -.infinity, figure: 3), TheaterCast.Key(from: 2.4, figure: 7)])
        check(switched.stretch(at: 1) == -.infinity..<2.4 && switched.stretch(at: 3) == 2.4..<Double.infinity,
              "a key man's stretch runs until the next one's (the passer's until the catch, then the receiver's)")
        let glides = stride(from: 2.4, to: 2.6, by: 0.02).compactMap { switched.handoff(at: $0)?.u }
        check(switched.handoff(at: 2.39) == nil && switched.handoff(at: 2.5)?.from == 3 && switched.handoff(at: 2.5)?.stretch == -.infinity..<2.4
              && switched.handoff(at: 2.61) == nil && glides.count == 10 && glides.first == 0 && zip(glides, glides.dropFirst()).allSatisfy { $0 < $1 }
              && (switched.handoff(at: 2.45)?.u ?? 1) < 0.2 && (switched.handoff(at: 2.55)?.u ?? 0) > 0.8,
              "at the change the key tag glides over from the last man in 200 ms, a strong ease-in-out (a function of t alone): never a jump",
              glides.map { String(format: "%.2f", $0) }.joined(separator: " "))

        // MARK: The pointer's tag, coming and going

        var pointer = TheaterPointer()
        let t0 = Date(timeIntervalSinceReferenceDate: 1000)
        pointer.move(to: "a:1", at: t0)
        check(pointer.fades && pointer.appear(at: t0) == 0 && pointer.appear(at: t0 + 0.06) > 0.6 && pointer.appear(at: t0 + 0.12) == 1
              && pointer.fading(at: t0 + 0.1) && !pointer.fading(at: t0 + 0.13),
              "a tag fades in over 120 ms, eased out (past 60% at half time)")
        check(!pointer.move(to: "a:1", at: t0 + 1), "the same man again changes nothing (no state per move)")
        pointer.move(to: "a:2", at: t0 + 1)
        check(!pointer.fades && pointer.appear(at: t0 + 1) == 1 && pointer.leaving == nil, "straight to the next man it swaps at once")
        pointer.move(to: nil, at: t0 + 2)
        check(pointer.leaving == "a:2" && pointer.remaining(at: t0 + 2) == 1 && pointer.remaining(at: t0 + 2.1) == 0 && pointer.fading(at: t0 + 2.05)
              && !pointer.fading(at: t0 + 2.11), "off every man it leaves faster, over 100 ms")
        pointer.move(to: "a:3", at: t0 + 2.05)
        check(!pointer.fades && pointer.leaving == nil, "back onto a man while the last tag's still going: at once")
        var tags = TheaterTags(cast: TheaterCast(members: [4: TheaterCast.Member(who: .team, side: .top, id: "s#4")], key: nil),
                               labels: TheaterLabels.make(kits: nil, scheme: .dark, teams: ("Jazz", "Spurs")), pointer: pointer, at: t0 + 2.05,
                               reduceMotion: true, status: nil, flip: false)
        tags.over = "s#4"
        check(!tags.rise && tags.shown(at: 0).pointer == 4, "Reduce Motion: a fade, no rise")

        // MARK: Under the play

        // A man standing in a compact panel's well, his tag over his head as placement puts it.
        let field = FieldProjection(size: well, camera: CameraFrame(x: 0, y: 60, span: 60))
        let lens = RigLens(field, at: CGPoint(x: 0, y: 60))
        let him = RigFigure(.stand, heading: 0, lens: lens)
        let spot = TheaterTagLayout.place([ask(him.head.x, TheaterTags.top(him), feet: him.ground.y + 3, pointer: true)], in: well, clear: [])[0] ?? .zero
        func man(_ index: Int, _ dx: CGFloat, _ dy: CGFloat, opacity: Double = 1) -> TheaterTags.Figure {
            var figure = him
            figure.shift(by: CGVector(dx: dx, dy: dy))
            return TheaterTags.Figure(index: index, figure: figure, height: lens.height, opacity: opacity)
        }
        // Another man walking across it (his chest on it), one faded out there, one far off.
        let men = [man(0, 0, 0), man(1, 24, spot.midY - him.neck.y), man(2, 24, spot.midY - him.neck.y, opacity: 0), man(3, 140, 0)]
        func ball(_ x: CGFloat, opacity: Double = 1) -> TheaterTags.Ball {
            TheaterTags.Ball(shape: Path(ellipseIn: CGRect(x: x - 2.5, y: spot.midY - 2.5, width: 5, height: 5)), height: lens.height, opacity: opacity)
        }
        let crossed = TheaterTags.crossing(men, ball: ball(spot.maxX + 3.5), tag: spot, own: 0)
        check(lens.height > 14 && lens.height < 40 && crossed.figures == [1] && crossed.ball,
              "a man crossing a tag is ringed, not its own man under it, one faded out or one far off; the ball within its ring's width of it too",
              "\(lens.height) pt, \(crossed)")
        // A wide well's big figure (56 pt): his ring's margin reaches past the 3 pt over his head, but his own tag isn't bitten by it.
        let tall = [TheaterTags.Figure(index: 5, figure: him, height: 56)]
        check(TheaterTags.crossing(tall, ball: nil, tag: spot).figures == [0] && TheaterTags.crossing(tall, ball: nil, tag: spot, own: 5).figures.isEmpty,
              "a big man's ring would reach his own tag (3 pt over his head): it counts for anyone else, never for him",
              "\(spot) \(TheaterTags.box(tall[0]))")
        check(!TheaterTags.crossing(men, ball: ball(spot.maxX + 8), tag: spot).ball && !TheaterTags.crossing([], ball: ball(spot.midX, opacity: 0), tag: spot).ball,
              "…not the ball clear of it, nor one faded out")
        var batter = men[0]
        var bat = Path()
        bat.move(to: him.grip)
        bat.addLine(to: CGPoint(x: him.grip.x + 6, y: spot.maxY - 1))
        batter.held = (bat, 2.5)
        check(TheaterTags.crossing([batter], ball: nil, tag: spot).figures == [0], "the batter's bat reaching into his own tag rings him (bat and all)")
        let ringed = TheaterDraw.outline(men[1].figure, grown: TheaterDraw.halo(lens.height) + TheaterTags.ring(lens.height)).boundingRect
        check(TheaterTags.box(men[1]).insetBy(dx: -0.01, dy: -0.01).contains(ringed), "a man's box holds his whole ring",
              "\(TheaterTags.box(men[1])) \(ringed)")
        check((19...31).allSatisfy { (1.1...1.9).contains(TheaterTags.ring(CGFloat($0))) } && TheaterTags.ring(60) > TheaterTags.ring(30),
              "the ring about 1.5 pt round the compact panel's figures (19–31 pt tall), wider with them in a wider well")
        let slab = TheaterTags.shape(spot), lean = spot.height * SlideMetrics.lean
        check(slab.contains(CGPoint(x: spot.midX, y: spot.midY)) && slab.contains(CGPoint(x: spot.minX + 0.5, y: spot.maxY - 0.5))
              && slab.contains(CGPoint(x: spot.maxX - 0.5, y: spot.minY + 0.5)) && !slab.contains(CGPoint(x: spot.minX + lean / 2, y: spot.minY + 0.5))
              && !slab.contains(CGPoint(x: spot.maxX - lean / 2, y: spot.maxY - 0.5)),
              "the ring's clip: the tag's slab, cut on the lean at its top leading and bottom trailing corners")
        // The full tag, drawn: its number's stripe and its name's slab meet on the lean, one shape, the clip's.
        let black = TheaterLabels.make(kits: TheaterKits(top: TeamKit(color: "000000", alternate: "c4ced4"), bottom: TeamKit(color: "4e008e", alternate: "79a3dc")),
                                       scheme: .dark, teams: ("Spurs", "Jazz")).top
        let renderer = ImageRenderer(content: TheaterNameTag(who: .known(TheaterPerson(name: "Victor Wembanyama", number: "1", position: "F")), label: black,
                                                            full: true, size: 9))
        renderer.scale = 2
        if let image = renderer.cgImage {
            let w = image.width, h = image.height
            var bytes = [UInt8](repeating: 0, count: w * h * 4)
            bytes.withUnsafeMutableBytes { buffer in
                CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)?.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            }
            func alpha(_ x: CGFloat, _ y: CGFloat) -> Double { Double(bytes[(min(Int(y * 2), h - 1) * w + min(Int(x * 2), w - 1)) * 4 + 3]) / 255 }
            let W = CGFloat(w) / 2, H = CGFloat(h) / 2, d = H * SlideMetrics.lean
            // (Where the stripe meets the slab their edges' smoothing leaves a hairline a touch lighter, never a gap.)
            let across = stride(from: d / 2 + 1, through: W - d / 2 - 1, by: 0.5).allSatisfy { alpha($0, H / 2) > 0.6 }
            // (Its width rounds up to the pixel: the corners' tests stand a little in.)
            check(across && alpha(0.5, 0.5) < 0.05 && alpha(W - 0.5, H - 0.5) < 0.05 && alpha(W - 2, 1) > 0.95 && alpha(1, H - 1) > 0.95,
                  "the full tag drawn is solid across, number to name, cut on the lean at its corners: the clip's shape",
                  String(format: "%.1f×%.1f pt: %@ %.2f %.2f %.2f %.2f", W, H, across ? "solid" : "gap", alpha(0.5, 0.5), alpha(W - 0.5, H - 0.5),
                         alpha(W - 2, 1), alpha(1, H - 1)))
        } else { check(false, "the full tag renders") }
        check(TheaterInk(.light).tagRing == .paint(.white) && TheaterInk(.dark).tagRing == .cutout,
              "the ring white in the light; in the dark the slab cut away round him, the surface showing")

        // MARK: Paint

        let kits = TheaterKits(top: TeamKit(color: "13294b", alternate: "ffc72c"), bottom: TeamKit(color: "092c5c", alternate: "8fbce6"))
        let labels = TheaterLabels.make(kits: kits, scheme: .dark, teams: ("Brewers", "Rays"))
        var second: (label: TheaterLabels.Label, color: String)?
        if case let .second(side) = TheaterTeams.dress(kits, scheme: .dark).rule {
            second = (labels[side], side == .top ? "ffc72c" : "8fbce6")
        }
        let spurs = TheaterKits(top: TeamKit(color: "000000", alternate: "c4ced4"), bottom: TeamKit(color: "4e008e", alternate: "79a3dc"))
        let onDark = TheaterLabels.make(kits: spurs, scheme: .dark, teams: ("Spurs", "Jazz")).top.paint
        let onLight = TheaterLabels.make(kits: spurs, scheme: .light, teams: ("Spurs", "Jazz")).top.paint
        check(second.map { OKLab(hex: $0.color)!.distance(to: $0.label.paint.slab) < 0.2 } == true && onDark.slab.l > 0.5 && onLight.slab.l < 0.35,
              "the slab in the color he's drawn in: two navies, the team in its second color labeled in it; the Spurs' black gray on a dark panel, as the figures are")
    }
}
