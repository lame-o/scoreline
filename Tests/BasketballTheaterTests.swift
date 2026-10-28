import SwiftUI

// The basketball theater, checked on tonight's three games (Tests/Fixtures/
// nba-theater-plays.json: BKN at BOS in overtime, DET at NY, SAC at SA, every
// core play ESPN sent but the substitutions and timeouts, trimmed and
// normalized as the live lane keeps them). ESPN's plays parsed into scenes
// (the kind, the move, the spot, who shot, passed, blocked, fouled; the miss
// a putback came off, the steal a break came from), which replay, the
// choreography (a three leaves the shooter's hand where ESPN put him and
// drops through the net, a pass reaches his hands, a block meets the
// blocker's), the broadcast camera, the stamp in the box score's words,
// what's news, the court between plays, and one celebration per moment.

extension ScorelineTests {
    static func basketballTheater() {
        print("\nBasketball theater")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("nba-theater-plays.json")) else {
            return check(false, "tonight's NBA plays fixture loads")
        }
        struct Game {
            let items: [JSON]
            let teams: BasketballFeed.Teams
        }
        // ESPN lists the visitors first: the top team.
        let games = JSON(data: data)["games"].array.map { g in
            Game(items: g["items"].array,
                 teams: BasketballFeed.Teams(topIsHome: false, topID: g["away"]["id"].string, bottomID: g["home"]["id"].string,
                                             topName: g["away"]["abbreviation"].string ?? "", bottomName: g["home"]["abbreviation"].string ?? ""))
        }
        guard games.count == 3 else { return check(false, "three games in the fixture") }
        func scenes(_ g: Game) -> [BasketballScene] { g.items.indices.compactMap { BasketballScene.parse(g.items, at: $0, teams: g.teams) } }
        func scene(_ game: Int, _ id: String) -> BasketballScene? {
            let g = games[game]
            return g.items.firstIndex { $0["id"].string == id }.flatMap { BasketballScene.parse(g.items, at: $0, teams: g.teams) }
        }
        let all = games.map(scenes)
        let replayed = all.map { $0.filter(\.replays) }

        // MARK: Which plays replay

        let madeFG = games.map { g in g.items.filter { $0["shootingPlay"].bool == true && $0["scoringPlay"].bool == true && !NBADetail.isFreeThrow($0) }.count }
        let madeReplayed = replayed.map { $0.filter { $0.made && $0.kind != .freeThrow }.count }
        check(madeFG == [87, 75, 89] && madeReplayed == madeFG, "every made field goal replays: 87, 75 and 89 of them",
              "\(madeReplayed) of \(madeFG)")
        let blocks = games.map { g in g.items.filter { p in p["participants"].array.contains { $0["type"].string == "blocker" } }.count }
        check(replayed.map { $0.filter { $0.kind == .block }.count } == blocks && blocks == [9, 13, 9], "every block replays, as a block",
              "\(blocks)")
        check(all.joined().filter { [.steal, .turnover, .offensiveRebound].contains($0.kind) }.allSatisfy { !$0.replays }
              && all.joined().contains { $0.kind == .steal } && all.joined().contains { $0.kind == .offensiveRebound },
              "a steal or an offensive rebound never replays alone (the basket it led to carries it)")
        let freeThrows = replayed.joined().filter { $0.kind == .freeThrow }
        check(freeThrows.allSatisfy { $0.lastShot && $0.made && ($0.period ?? 0) >= 4 }, "a free throw replays only when it tied it or went ahead in the last 30 seconds",
              "\(freeThrows.count)")
        let late = replayed.joined().filter { !$0.made && $0.kind != .block }
        check(late.allSatisfy(\.lastShot) && late.contains { $0.id == "401909877683" },
              "a miss replays only as a shot to tie or lead in the last 30 seconds: Chaney Johnson's three down three with 19.8 left",
              late.map(\.text).joined(separator: " | "))
        let share = Double(madeReplayed.reduce(0, +)) / Double(madeFG.reduce(0, +))
        let perGame = replayed.map(\.count)
        print("    replays: \(perGame) (\(late.count) late misses, \(freeThrows.count) free throws); made baskets replayed: \(Int(share * 100))%")
        check(perGame.allSatisfy { (80...120).contains($0) }, "about a hundred replays a game: one every half minute of play, not every play",
              "\(perGame) of \(games.map(\.items.count))")

        // MARK: Kinds, moves and who

        let brown = scene(0, "401909877738")
        check(brown?.kind == .three && brown?.move == .catchAndShoot && brown?.value == 3 && brown?.points == 3
              && brown?.shooter?.name == "Brown Jr." && brown?.assister?.name == "Ellis" && brown?.spot == CGPoint(x: 1, y: 1)
              && brown?.buzzer == true && brown?.decisive == true && brown?.offense == .top,
              "Brown Jr.'s corner three with a second left, off Ellis's pass, ties it at the end of regulation: a buzzer-beater, decisive",
              "\(String(describing: brown))")
        let tatum = scene(0, "401909877843")
        check(tatum?.kind == .jumper && tatum?.move == .turnaround && tatum?.buzzer == true && tatum?.decisive == true
              && tatum?.assister?.name == "White" && tatum?.offense == .bottom && tatum?.period == 5,
              "Tatum's turnaround with no time left in overtime wins it: a decisive buzzer-beater for the home team")
        let white = scene(0, "401909877673")
        check(white?.kind == .dunk && white?.move == .cut && white?.andOne == true && white?.fouler?.name == "Clowney" && white?.posterized == true,
              "White's cutting dunk through Clowney's foul: an and-one the data credits to a defender, so posterized")
        let demin = scene(0, "40190987713")
        check(demin?.kind == .dunk && demin?.steal?.stealer?.name == "Demin" && demin?.steal?.loser?.name == "George" && demin?.steal?.spot != nil
              && demin?.assister?.name == "Porter Jr.",
              "Demin's running dunk three seconds after he stole George's pass: the break carries the steal")
        let tip = scene(2, "401909879338")
        check(tip?.kind == .putback && tip?.move == .tip && tip?.miss?.shooter?.name == "Castle" && tip?.miss?.value == 3 && tip?.buzzer == true,
              "Wembanyama's tip at the half off Castle's missed three: a putback and a buzzer-beater")
        let swat = scene(2, "40190987921")
        check(swat?.kind == .block && swat?.shot == .layup && swat?.blocker?.name == "Wembanyama" && swat?.shooter?.name == "Sabonis"
              && swat?.result == .blocked && swat?.offense == .top,
              "Wembanyama blocking Sabonis's driving layup: the shot it stopped, the blocker and the shooter")
        let oops = replayed.joined().filter { $0.kind == .alleyOop }
        check(oops.count >= 8 && oops.allSatisfy { $0.assister != nil } && oops.contains { $0.dunk },
              "alley-oops replay as alley-oops, each with its passer", "\(oops.count)")
        let putbacks = replayed.joined().filter { $0.kind == .putback }
        check(putbacks.count >= 15 && putbacks.filter { $0.miss != nil }.count >= putbacks.count - 2,
              "putbacks come with the miss they came off", "\(putbacks.filter { $0.miss != nil }.count) of \(putbacks.count)")
        let breaks = replayed.joined().filter { $0.steal != nil }
        check(breaks.count >= 5 && breaks.allSatisfy { $0.made && $0.steal?.stealer != nil }, "baskets off a steal carry it", "\(breaks.count)")
        check(replayed.joined().allSatisfy { !($0.shooter?.name ?? "").isEmpty } && replayed.joined().allSatisfy { $0.offense != nil },
              "every replayed play names its shooter and its team")
        check(BasketballScene.surname("Mikel Brown Jr.") == "Brown Jr." && BasketballScene.surname("Ronald Holland II") == "Holland II"
              && BasketballScene.surname("Karl-Anthony Towns") == "Towns" && BasketballScene.surname("De'Aaron Fox") == "Fox",
              "a stamp's name is the surname, its suffix kept")

        // MARK: The stamp, in the box score's words

        func stamp(_ s: BasketballScene?) -> (String, [String]) {
            s.map { let st = BasketballStamp($0); return (st.parts.map(\.text).joined(separator: " "), st.lines) } ?? ("nil", [])
        }
        check(stamp(brown).0 == "+3 3PT" && stamp(brown).1 == ["BROWN JR. · 23 FT JUMP SHOT", "AST ELLIS"],
              "a three's stamp: +3 3PT, the shot as the play-by-play names it with its distance in feet, the assist", "\(stamp(brown))")
        check(stamp(swat).0 == "BLK" && stamp(swat).1.first == "WEMBANYAMA" && stamp(swat).1.dropFirst().first == "SABONIS · DRIVING LAYUP SHOT",
              "a block's: BLK, the blocker, the shot he stopped", "\(stamp(swat))")
        check(stamp(demin).1.last == "AST PORTER JR. · STL DEMIN" && stamp(white).1.first == "WHITE · CUTTING DUNK SHOT",
              "a break's credits the assist and the steal; a dunk keeps no distance", "\(stamp(demin)) \(stamp(white))")
        check(replayed.joined().allSatisfy { !BasketballStamp($0).parts.isEmpty && BasketballStamp($0).lines.allSatisfy { $0 == $0.uppercased() } },
              "every replay has a stamp, in capitals")

        // MARK: Choreography

        let scripts = replayed.map { $0.map(BasketballScript.init) }
        let pairs = zip(replayed.joined(), scripts.joined()).map { ($0, $1) }
        let finite = pairs.allSatisfy { _, s in
            stride(from: 0.0, through: s.duration, by: 0.1).allSatisfy { t in
                s.players.allSatisfy { p in let q = p.position(at: t); return q.x.isFinite && q.y.isFinite && q.x > -1 && q.x < 95 && q.y > 0 && q.y < 50 }
                    && (s.ball(at: t).map { $0.x.isFinite && $0.z >= 0.3 } ?? false)
            }
        }
        check(finite && pairs.allSatisfy { $0.1.players.count == 10 }, "every replay: five on five on the floor, the ball never under it")
        let lengths = pairs.map(\.1.duration)
        check(lengths.allSatisfy { $0 > 3 && $0 < 9 } && pairs.allSatisfy { $0.1.stamp.isFinite && $0.1.stamp < $0.1.settle },
              "every replay runs 3–9 s, its stamp landing before the court settles", String(format: "%.2f–%.2f s", lengths.min() ?? 0, lengths.max() ?? 0))
        let rim = FieldPoint(x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight)
        func gap(_ a: FieldPoint?, _ b: FieldPoint) -> Double { a.map { (($0.x - b.x) * ($0.x - b.x) + ($0.y - b.y) * ($0.y - b.y) + ($0.z - b.z) * ($0.z - b.z)).squareRoot() } ?? .infinity }
        let makes = pairs.filter { $0.0.made && $0.0.kind != .freeThrow }
        check(makes.allSatisfy { s in s.1.score.map { gap(s.1.ball(at: $0), rim) < 0.3 } ?? false } && makes.allSatisfy { $0.1.release != nil },
              "every make: released, and through the rim at the moment it scores (a full replay for every one)")
        let jumpers = pairs.filter { [.jumper, .three].contains($0.0.kind) && $0.0.steal == nil }
        let offSpot = jumpers.filter { s, sc in
            guard let release = sc.release, let spot = s.spot else { return true }
            let at = sc.players[0].position(at: release), real = Hoops.court(spot)
            return hypot(at.x - real.x, at.y - real.y) > 2.6
        }
        check(offSpot.isEmpty, "every jump shot leaves his hand where ESPN put him (a fadeaway's drift aside)",
              offSpot.prefix(3).map(\.0.text).joined(separator: " | "))
        let assisted = makes.filter { $0.0.assister != nil && $0.0.steal == nil }
        let unpassed = assisted.filter { _, sc in
            !sc.flights.contains { f in
                f.end <= (sc.release ?? 0) + 0.12 && hypot(f.to.x - sc.players[0].position(at: f.end).x, f.to.y - sc.players[0].position(at: f.end).y) < 1.6
            }
        }
        check(unpassed.isEmpty, "every assisted basket: the pass reaches the shooter's hands where he is", unpassed.prefix(3).map(\.0.text).joined(separator: " | "))
        let lobs = pairs.filter { $0.0.kind == .alleyOop }
        check(lobs.allSatisfy { _, sc in sc.flights.contains { $0.to.z >= Hoops.rimHeight && hypot($0.to.x - Hoops.rim.x, $0.to.y - Hoops.rim.y) < 3.5 }
                                                         && sc.players[0].jumps.contains { $0.height >= 2.5 } },
              "an alley-oop's lob comes down over the rim to a man in the air")
        let blocked = pairs.filter { $0.0.kind == .block }
        let unmet = blocked.filter { _, sc in
            guard let flash = sc.flashes.first(where: { $0.beat == .block }) else { return true }
            return !(5..<10).contains { k in
                let p = sc.players[k].position(at: flash.at)
                return hypot(p.x - flash.point.x, p.y - flash.point.y) < 3.2 && sc.players[k].lift(at: flash.at) > 1.2
            }
        }
        check(unmet.isEmpty, "every block: a defender in the air at the ball as it's swatted", unmet.prefix(3).map(\.0.text).joined(separator: " | "))
        let rebounded = pairs.filter { !$0.0.made && $0.0.rebound?.person != nil && $0.0.kind != .freeThrow }
        check(rebounded.allSatisfy { _, sc in sc.carrier(at: sc.settle) != nil }, "a miss or a block the data gives to a rebounder ends in his hands",
              "\(rebounded.filter { $0.1.carrier(at: $0.1.settle) == nil }.map(\.0.text).prefix(2))")
        check(pairs.filter { $0.0.steal?.spot != nil }.allSatisfy { _, sc in (sc.flashes.first { $0.beat == .steal }?.point.x ?? 99) < Hoops.length / 2 },
              "a break starts with the steal at the other end, where ESPN put it")
        check(pairs.filter { $0.0.kind == .putback }.allSatisfy { _, sc in sc.flashes.contains { $0.beat == .rim } && sc.rimHit.map { $0 <= (sc.score ?? 0) } == true },
              "a putback: the miss off the rim, then back in")
        // The bottom team at the left basket, the top at the right, as the shot chart has them.
        let center = CGPoint(x: Hoops.length / 2, y: Hoops.width / 2)
        let sides = pairs.allSatisfy { s, sc in
            let r = Gridiron.view(Hoops.rim, yaw: sc.yaw).x, c = Gridiron.view(center, yaw: sc.yaw).x
            return s.offense == .bottom ? r < c : r > c
        }
        check(sides, "each team shoots at the basket the shot chart puts it at: the top team →, the bottom ←")
        // Every player, every frame, every replay: the poses and every blend between them.
        let ink = TheaterInk(.dark), teams = BasketballTeams(offense: Uniform(.blue), defense: Uniform(.orange))
        let broken = pairs.compactMap { s, sc -> String? in
            let frame = { (t: Double) in BasketballFrame(scene: s, script: sc, t: t, teams: teams, ink: ink, size: CGSize(width: 340, height: 170)) }
            return jointsBreak(sc.duration, sc.players.count) { i, t in
                frame(t).pose(sc.players[i], i, at: sc.players[i].position(at: t), unit: 1.1 / Hoops.ground).0
            }.map { "\(s.text.prefix(30)): \($0)" }
        }
        check(broken.isEmpty, "in every replay of the three games, knees and elbows bend only their own way, never past folded",
              broken.prefix(3).joined(separator: " | "))

        // MARK: Camera

        let size = CGSize(width: 640, height: 320)
        func inView(_ sc: BasketballScript, _ p: FieldPoint, at t: Double) -> Bool {
            let q = HoopProjection(size: size, camera: sc.camera.frame(at: t), yaw: sc.yaw).point(p)
            return q.x > 0 && q.x < size.width && q.y > 0 && q.y < size.height
        }
        let framed = makes.allSatisfy { _, sc in
            guard let t = sc.score, let shooter = sc.shooter else { return false }
            return inView(sc, rim, at: t) && inView(sc, FieldPoint(sc.players[shooter].position(at: t)), at: t)
        }
        check(framed, "as the ball goes through, the rim and the shooter are in the shot")
        let tight = makes.filter { [.dunk, .layup].contains($0.0.kind) }.allSatisfy { _, sc in sc.score.map { sc.camera.frame(at: $0).span < 40 } ?? false }
        check(tight, "at the rim the camera is close: a man and the rim, tighter than a ballpark's battery")
        // With the stamp up, and at rest, nobody stands in its corner (its measured box, a tenth in from its edges).
        let covered = pairs.filter { _, sc in
            [sc.stamp + 0.6, .infinity].contains { t in
                let h = HoopProjection(size: size, camera: sc.camera.frame(at: t), yaw: sc.yaw)
                return sc.players.contains { p in
                    let q = h.point(p.position(at: t))
                    return q.x < size.width * sc.corner.width * 0.9 && q.y > size.height * (1 - sc.corner.height * 0.9)
                }
            }
        }
        check(covered.isEmpty, "the camera keeps everyone out of the stamp's corner while it's up, and at rest",
              covered.prefix(3).map(\.0.text).joined(separator: " | "))
        let settled = pairs.allSatisfy { $0.1.camera.frame(at: .infinity) == $0.1.camera.rest }
        check(settled, "every replay's camera comes to rest on where it ended")

        // MARK: Banners

        func banner(_ s: BasketballScene?) -> String { s.map { BasketballScript($0).banner?.text ?? "-" } ?? "nil" }
        check(banner(brown) == "BUZZER-BEATER" && BasketballScript(brown!).banner?.tone == .gold && banner(white) == "POSTERIZED"
              && banner(swat) == "REJECTED" && banner(demin) == "DUNK" && banner(scene(1, "401909878474")) == "AND-ONE",
              "the headlines: BUZZER-BEATER (gold when it tied or won it), POSTERIZED, REJECTED, DUNK, AND-ONE",
              "\(banner(brown)) \(banner(white)) \(banner(swat)) \(banner(demin))")
        let banners = pairs.compactMap(\.1.banner)
        check(banners.count < pairs.count / 2, "a headline is for a marquee play: under half the replays get one", "\(banners.count) of \(pairs.count)")

        // MARK: News and the court between plays

        var state = BasketballTheaterState(scene: brown, news: true)
        check(BasketballTheater.shown(state, replaying: nil, rested: nil)?.id == brown?.id
              && BasketballTheater.shown(state, replaying: brown?.id, rested: brown?.id) == nil, "news shows, then rests after its hold")
        state.news = false
        check(BasketballTheater.shown(state, replaying: nil, rested: nil) == nil, "history isn't shown: the court is the live one")
        let kept = BasketballFeed.theater(brown!, after: BasketballTheaterState(scene: brown, news: true), fresh: false, now: .now)
        check(kept.news, "a play already showing keeps being news through its edits")
        let feed = BasketballFeed()
        let g0 = games[0]
        feed.ingest(Array(g0.items[0...40]), start: 0, teams: g0.teams)
        let first = feed.theater
        let next = g0.items.indices.first { $0 > 40 && BasketballScene.parse(g0.items, at: $0, teams: g0.teams)?.replays == true } ?? 41
        feed.ingest(Array(g0.items[0...next]), start: 0, teams: g0.teams)
        check(first.scene != nil && !first.news && feed.theater.news && feed.theater.scene?.id == g0.items[next]["id"].string,
              "the lane's first look is history; the next basket it sees is news")
        let rest = BasketballScript(rest: .init(offense: .bottom)), tipOff = BasketballScript(rest: .init(offense: nil))
        check(rest.players.count == 10 && rest.carrier(at: 0)?.player == 0 && rest.yaw == Hoops.yaw(.bottom)
              && tipOff.ball(at: 0).map { abs($0.x - Hoops.length / 2) < 0.1 } == true,
              "between plays the team with the ball sets up in its half, the point guard with it; nobody's: round the center circle")

        // MARK: One celebration per moment

        check(!BasketballCelebration.courtBursts(theaterShown: true) && BasketballCelebration.courtBursts(theaterShown: false),
              "the shot chart bursts only when there's no theater to")
        var moment = LiveMoment(id: brown!.id, chart: .court, tier: .score, kind: .made(value: 3), lead: "Buzzer-beater", detail: "", side: .top)
        moment.accents = [.buzzer, .decisive]
        moment.burst = true
        let brownScript = BasketballScript(brown!)
        let bursts = BasketballCelebration.theater(moment, play: brown!, script: brownScript, level: .full, reduceMotion: false, height: 320)
        check(bursts.count == 2 && bursts.allSatisfy { $0.cue.gold } && bursts.contains { $0.anchor == .banner }
              && bursts.allSatisfy { $0.at + $0.cue.delay >= (brownScript.score ?? 0) - 0.01 },
              "a decisive buzzer-beater: sparks at the rim as it drops and the banner's confetti, in gold")
        check(BasketballCelebration.theater(moment, play: brown!, script: brownScript, level: .off, reduceMotion: false, height: 320).isEmpty
              && BasketballCelebration.theater(moment, play: tatum!, script: BasketballScript(tatum!), level: .full, reduceMotion: false, height: 320).isEmpty,
              "nothing at Off, nor for another play's moment")
        let two = makes.first { $0.0.value == 2 && !$0.0.buzzer && !$0.0.clutch }
        let routine = two.map { s, sc in
            BasketballCelebration.theater(LiveMoment(id: s.id, chart: .court, tier: .routine, kind: .made(value: 2), lead: "Two", detail: "", side: s.offense),
                                          play: s, script: sc, level: .full, reduceMotion: false, height: 320)
        }
        check(routine?.isEmpty == true, "a routine two gets the net, no particles")
    }
}
