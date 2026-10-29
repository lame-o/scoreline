import SwiftUI

// The basketball theater's lighter beats and the court between plays,
// checked on a whole recorded game: SA at UTA in overtime, 2026-10-28
// (Tests/Fixtures/nba-every-play-401909890.json: all 515 core plays ESPN
// sent, substitutions, timeouts, reviews and period ends included, normalized
// as the live lane keeps them, each participant's part and position kept,
// trimmed to the fields the app reads). Every play parsed into
// what the theater tells (the call, the free throw's place in its trip, who
// came in, who jumped), told in order and kept up with the game, the
// choreography's facts (a free throw drops through the rim from the line, a
// miss comes off the rim from ESPN's spot to the man credited with the
// board, the ball changes hands on a defensive board), the ends of the court
// (swapped at halftime, turned by the viewer), the tags, and the court
// between plays resting sparsely.

extension ScorelineTests {
    static func basketballBeats() {
        print("\nBasketball beats")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("nba-every-play-401909890.json")) else {
            return check(false, "the SA at UTA play-by-play fixture loads")
        }
        let game = JSON(data: data)["games"].array[0]
        let items = game["items"].array
        // The Spurs (visitors) on top, as ESPN lists them.
        let teams = BasketballFeed.Teams(topIsHome: false, topID: game["away"]["id"].string, bottomID: game["home"]["id"].string,
                                         topName: "Spurs", bottomName: "Jazz")
        let scenes = items.indices.compactMap { BasketballScene.parse(items, at: $0, teams: teams) }
        func scene(_ id: String) -> BasketballScene? { scenes.first { $0.id == id } }
        func count(_ kind: BasketballScene.Kind) -> Int { scenes.filter { $0.kind == kind }.count }
        func calls(_ call: BasketballScene.Call) -> Int { scenes.filter { $0.call == call }.count }

        // MARK: Every play, parsed

        check(scenes.count == items.count, "every one of the game's 515 plays is something the theater tells", "\(scenes.count) of \(items.count)")
        check(count(.defensiveRebound) == 84 && count(.offensiveRebound) == 33 && count(.substitution) == 70 && count(.timeout) == 13
              && count(.periodEnd) == 6 && count(.challenge) == 3 && count(.jumpBall) == 2 && count(.freeThrow) == 40,
              "rebounds both ways, substitutions, timeouts, the ends of periods, challenges, jump balls, free throws: ESPN's counts",
              "\(count(.defensiveRebound)) \(count(.offensiveRebound)) \(count(.substitution)) \(count(.timeout)) \(count(.periodEnd)) \(count(.challenge)) \(count(.jumpBall)) \(count(.freeThrow))")
        check(calls(.shooting) == 19 && calls(.personal) == 13 && calls(.looseBall) == 1 && calls(.offensive) == 4 && calls(.charge) == 2
              && calls(.kickedBall) == 2 && calls(.goaltending) == 1,
              "each whistle by its call: shooting, personal, loose ball, offensive (the foul and its turnover), charge, kicked ball, goaltending")
        check(count(.steal) == 17 && calls(.badPass) == 10 && calls(.lostBall) == 7 && calls(.outOfBounds) == 6 && calls(.traveling) == 2
              && calls(.offensiveGoaltending) == 1 && scenes.contains { $0.call == .other("DOUBLE DRIBBLE") },
              "each turnover by its kind: picked off, poked loose, out of bounds, a travel, offensive goaltending, a double dribble")
        let fga = scenes.filter { $0.isShot && $0.kind != .freeThrow }
        check(fga.count == 195 && fga.filter(\.made).count == 83 && fga.filter { $0.kind == .block }.count == 10,
              "195 field goal attempts: 83 makes and 10 blocks replay in full, the 102 misses as beats",
              "\(fga.count) \(fga.filter(\.made).count)")

        let foul = scene("40190989028"), charge = scene("401909890252"), kick = scene("401909890318"), travel = scene("401909890374")
        check(foul?.kind == .foul && foul?.call == .shooting && foul?.shooter?.name == "Wembanyama" && foul?.drew?.name == "Peterson" && foul?.trip == 2
              && foul?.ball == .bottom && foul?.spot == CGPoint(x: 25, y: 12),
              "Wembanyama's shooting foul at ESPN's spot: on Peterson, two shots, the Jazz's ball")
        check(charge?.call == .charge && charge?.shooter?.name == "Johnson" && charge?.shooter?.role == .wing && charge?.follows == ["401909890254"]
              && charge?.ball == .top,
              "Keldon Johnson's charge: the Spurs had it, and ESPN's turnover at its clock is the same play")
        check(kick?.kind == .violation && kick?.call == .kickedBall && kick?.shooter?.name == "Hayes" && kick?.shooter?.role == .big && kick?.after == .top,
              "Hayes's kicked ball: a violation the Spurs keep the ball on")
        check(travel?.kind == .turnover && travel?.call == .traveling && travel?.shooter?.name == "Fox" && travel?.after == .bottom,
              "Fox's travel: the Jazz's ball")
        let pick = scene("4019098908"), oob = scene("401909890447")
        check(pick?.kind == .steal && pick?.call == .badPass && pick?.steal?.stealer?.name == "Castle" && pick?.shooter?.name == "Bailey"
              && oob?.kind == .turnover && oob?.call == .outOfBounds && oob?.typeID == 90,
              "Bailey's pass picked off by Castle; Collier's sailed out of bounds")
        let tip = scene("4019098904"), sub = scene("40190989063")
        check(tip?.kind == .jumpBall && tip?.jumpers.map(\.name) == ["Wembanyama", "Hayes"] && tip?.winner?.name == "Harper" && tip?.offense == .top
              && tip?.jumpers.last?.role == .big,
              "the opening tip: Wembanyama and Hayes, Harper came up with it for the Spurs")
        check(sub?.kind == .substitution && sub?.subIn?.name == "Collier" && sub?.subOut?.name == "Peterson" && sub?.offense == .bottom,
              "a substitution: Collier in for Peterson")
        let ft1 = scene("40190989030"), ft3 = scene("401909890531")
        check(ft1?.attempt == 1 && ft1?.attempts == 2 && ft1?.made == true && ft3?.attempt == 1 && ft3?.attempts == 3,
              "free throws know their place in the trip: 1 of 2, 1 of 3")
        let words = scenes.filter { [.timeout, .periodEnd].contains($0.kind) }.map { BasketballScript.Builder.stoppageWords($0) }
        check(words.contains("TIMEOUT · JAZZ") && words.contains("TIMEOUT · SPURS") && words.contains("END OF 1ST") && words.contains("HALFTIME")
              && words.contains("END OF 3RD") && words.contains("END OF REGULATION") && words.contains("END OF OT") && words.contains("FINAL"),
              "the stoppages' words: TIMEOUT · JAZZ, END OF 1ST, HALFTIME, END OF 3RD, END OF REGULATION (tied after four), END OF OT, FINAL",
              words.joined(separator: " | "))
        let overturned = scene("401909890136"), stands = scene("401909890428")
        check(overturned.map { BasketballStatus.reviewWords($0, team: nil) } == "CHALLENGE · JAZZ · OVERTURNED"
              && stands.map { BasketballStatus.reviewWords($0, team: nil) } == "CHALLENGE · JAZZ · CALL STANDS",
              "a coach's challenge and its ruling: overturned, the call stands")
        let miss = scene("40190989035"), board = scene("40190989036")
        check(miss?.rebound?.person?.name == "Wembanyama" && miss?.rebound?.offensive == false && miss?.follows == ["40190989036"]
              && board?.kind == .defensiveRebound && board?.miss?.id == "40190989035" && board?.miss?.distance == 15 && board?.shooter?.role == .wing,
              "a miss knows the board it ended in; the board knows the miss it came off")

        // MARK: Told in order, kept up with the game

        func state(_ ids: ArraySlice<BasketballScene>) -> BasketballTheaterState {
            BasketballTheaterState(plays: Array(ids), news: Set(ids.map(\.id)), heard: .now)
        }
        let i35 = scenes.firstIndex { $0.id == "40190989035" }!
        let pair = BasketballQueue.next(after: nil, told: [], in: state(scenes[i35...(i35 + 1)]))
        check(pair?.scene.id == "40190989035" && pair?.covers == ["40190989036"]
              && BasketballQueue.next(after: "40190989035", told: ["40190989035", "40190989036"], in: state(scenes[i35...(i35 + 1)])) == nil,
              "a miss is told with the board it ended in, and the board isn't told again")
        let i168 = scenes.firstIndex { $0.id == "401909890168" }!
        let subs = BasketballQueue.next(after: nil, told: [], in: state(scenes[i168...(i168 + 3)]))
        check(subs?.group.count == 4 && subs.map { BasketballScript(beat: $0.scene, group: $0.group, ends: HoopsEnds(topRight: true, topOpensRight: true),
                                                                     from: nil).tag?.text } == "SUBS · WEMBANYAMA, BRYANT +2 IN",
              "the substitutions at one stoppage are told together: SUBS · WEMBANYAMA, BRYANT +2 IN")
        let i252 = scenes.firstIndex { $0.id == "401909890252" }!
        check(BasketballQueue.next(after: nil, told: [], in: state(scenes[i252...(i252 + 1)]))?.covers == ["401909890254"],
              "an offensive foul's turnover is the same play, told once")
        // A burst of plays at once (a page that wakes up late): it catches up, never passing over a replay or the newest.
        var told = Set<String>(), cursor: String?, units: [BasketballQueue.Unit] = []
        let burst = state(scenes[120..<150])
        while let unit = BasketballQueue.next(after: cursor, told: told, in: burst) {
            units.append(unit)
            cursor = unit.scene.id
            told.formUnion([unit.scene.id] + unit.covers)
        }
        let marquees = scenes[120..<150].filter(\.replays).map(\.id)
        let first = units.first
        check(first.map { $0.skipped > 0 } == true && marquees.allSatisfy { id in units.contains { $0.scene.id == id } }
              && units.last?.scene.id == scenes[149].id && told.isSuperset(of: scenes[120..<150].map(\.id)),
              "thirty plays at once: the least of them passed over to catch up, every replay and the newest still told, all accounted for",
              "\(units.count) told, \(first?.skipped ?? 0) passed over first")
        let caught = first.map { BasketballStatus.during(unit: $0, script: BasketballScript(rest: .init(offense: .top)), t: 0.5, names: ("Spurs", "Jazz"))?.text }
        check(caught == "CATCHING UP · \(first?.skipped ?? 0) PLAYS", "and the tag says so", "\(String(describing: caught))")

        // MARK: The ends of the court

        func ends(_ period: Int, flipped: Bool = false) -> HoopsEnds { HoopsEnds(period: period, topIsHome: false, flipped: flipped) }
        check(ends(1).right(.top) && ends(2).right(.top) && !ends(3).right(.top) && !ends(4).right(.top) && !ends(5).right(.top)
              && !ends(1).right(.bottom) && ends(3).right(.bottom),
              "the visitors attack the right basket in the first half, the left in the second and in overtime; the home team the other")
        check((1...5).allSatisfy { ends($0, flipped: true).right(.top) == !ends($0).right(.top) }
              && HoopsEnds(period: 1, topIsHome: true, flipped: false).right(.bottom),
              "the viewer's turn turns every period round; with the home team on top, the visitors still open at the right")
        check((1...5).allSatisfy { ends($0).benchRight(.top) == false && ends($0).benchRight(.bottom) == true },
              "each bench stays by the basket its team defends in the first half, all game")
        let dunk = scenes.first { $0.replays && $0.offense == .top }!
        let rightReplay = BasketballScript(dunk, right: true), leftReplay = BasketballScript(dunk, right: false)
        let center = CGPoint(x: Hoops.length / 2, y: Hoops.width / 2)
        func rimRight(_ s: BasketballScript) -> Bool { Gridiron.view(Hoops.rim, yaw: s.yaw).x > Gridiron.view(center, yaw: s.yaw).x }
        check(rimRight(rightReplay) && !rimRight(leftReplay) && rightReplay.score == leftReplay.score,
              "a replay turned round plays at the left basket, the same play")
        check(TheaterOrientation.key("espn-nba-401909890") == "theaterFlip.espn-nba-401909890", "the turn is remembered per game")

        // MARK: Choreography

        let flat = HoopsEnds(topRight: true, topOpensRight: true)
        let rim = FieldPoint(x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight)
        func gap(_ a: FieldPoint?, _ b: FieldPoint) -> Double {
            a.map { (($0.x - b.x) * ($0.x - b.x) + ($0.y - b.y) * ($0.y - b.y) + ($0.z - b.z) * ($0.z - b.z)).squareRoot() } ?? .infinity
        }
        // A free throw: from the line, through the rim.
        let ftBeat = BasketballScript(beat: ft1!, ends: flat, from: nil)
        let leaves = ftBeat.release.flatMap { ftBeat.ball(at: $0 + 0.02) }
        check(leaves.map { abs($0.x - (Hoops.freeThrow - 0.15)) < 1.2 && abs($0.y - 25) < 1 && $0.z > 7 } == true
              && ftBeat.score.map { gap(ftBeat.ball(at: $0), rim) < 0.3 } == true && ftBeat.net != nil && ftBeat.tag?.text == "FREE THROW 1 OF 2",
              "a made free throw leaves his hand at the line and drops through the rim, the net swinging: FREE THROW 1 OF 2")
        let ftMiss = scenes.first { $0.id.hasSuffix("0114") }!
        let ftMissBeat = BasketballScript(beat: ftMiss, ends: flat, from: nil)
        check(ftMiss.made == false && ftMissBeat.rimHit.map { gap(ftMissBeat.ball(at: $0), rim) < 1.1 } == true && ftMissBeat.score == nil
              && ftMissBeat.carrier(at: ftMissBeat.settle) != nil,
              "a missed last free throw is off the rim, live, and in someone's hands")
        // Each routine is the shooter's own: the same man, the same routine.
        let peterson = scenes.filter { $0.kind == .freeThrow && $0.shooter?.name == "Peterson" }.map { BasketballScript(beat: $0, ends: flat, from: nil).release }
        let others = scenes.filter { $0.kind == .freeThrow && $0.shooter?.name != "Peterson" }.map { BasketballScript(beat: $0, ends: flat, from: nil).release }
        check(Set(peterson.map { $0.map { ($0 * 100).rounded() } }).count == 1 && Set(others.map { $0.map { ($0 * 100).rounded() } }).count > 2,
              "each shooter's routine is his own: Peterson's the same every trip, the league's not all alike")
        // A miss: from ESPN's spot, off the rim, to the man who rebounded it.
        let missBeat = BasketballScript(beat: miss!, ends: flat, from: nil)
        let shotAt = missBeat.release.map { missBeat.players[0].position(at: $0) }
        let spot = Hoops.court(miss!.spot!)
        check(shotAt.map { hypot($0.x - spot.x, $0.y - spot.y) < 2.6 } == true
              && missBeat.rimHit.map { abs(hypot((missBeat.ball(at: $0)?.x ?? 0) - Hoops.rim.x, (missBeat.ball(at: $0)?.y ?? 0) - Hoops.rim.y) - Hoops.rimRadius) < 0.3 } == true
              && missBeat.score == nil && (missBeat.carrier(at: missBeat.settle)?.player ?? 0) >= 5,
              "a miss leaves his hand at ESPN's spot, comes off the ring, and ends in a defender's hands (Wembanyama's board)")
        // The ball changes hands on a defensive board: the court after it is the other team's, up the floor.
        let after = BasketballFlow.rest(after: miss, previous: nil, from: missBeat.lineup(at: missBeat.duration), ends: flat, possession: .bottom)
        let restAfter = BasketballScript(rest: after)
        let startHolder = restAfter.carrier(at: 0)?.player
        let upFloor = restAfter.players.prefix(5).map { $0.position(at: BasketballScript.Builder.restLength - 0.5).x }.reduce(0, +) / 5
        check(after.offense == .top && after.phase == .live && startHolder.map { $0 < 5 } == true && restAfter.side == .top && upFloor > 55,
              "the ball changes hands on a defensive board: the Spurs bring it up the floor into their set",
              "\(String(describing: after.offense)) \(String(describing: startHolder)) \(upFloor)")
        let outletTo = restAfter.carrier(at: 2.5)?.player
        let guardBoard = scenes.first { $0.kind == .defensiveRebound && $0.shooter?.role == .guardRole }!
        check(after.outlet && outletTo != nil && outletTo != startHolder && restAfter.flights.contains { $0.start < 1.5 }
              && !BasketballFlow.rest(after: guardBoard, previous: nil, from: nil, ends: flat, possession: nil).outlet,
              "a big off the defensive glass outlets it up the wing; a guard brings it up himself")

        // Rebounds: from the miss that's there (ESPN logs a board at its miss's own spot), never two alike.
        let three = scene("40190989022")!, floater = scene("40190989058")!
        let longCarom = BasketballScript.Builder.carom(missBeatMiss(three)), shortCarom = BasketballScript.Builder.carom(missBeatMiss(floater))
        func fromRim(_ p: CGPoint) -> Double { hypot(p.x - Hoops.rim.x, p.y - Hoops.rim.y) }
        let longBeat = BasketballScript(beat: three, ends: flat, from: nil), shortBeat = BasketballScript(beat: floater, ends: flat, from: nil)
        func caughtAt(_ s: BasketballScript) -> CGPoint? { s.carrier(at: s.settle).map { s.players[$0.player].position(at: s.settle) } }
        check(fromRim(longCarom.spot) >= 9.5 && fromRim(shortCarom.spot) <= 7 && hypot(longCarom.spot.x - shortCarom.spot.x, longCarom.spot.y - shortCarom.spot.y) > 4
              && caughtAt(longBeat).map { hypot($0.x - longCarom.spot.x, $0.y - longCarom.spot.y) < 3.5 } == true
              && caughtAt(shortBeat).map { hypot($0.x - shortCarom.spot.x, $0.y - shortCarom.spot.y) < 3.5 } == true
              && BasketballScript.Builder.carom(missBeatMiss(three)) == longCarom,
              "Vassell's 25-foot three kicks out long to Green, Bailey's floater comes down at the rim to Wembanyama: each as its miss sends it, the same every time",
              String(format: "%.1f ft, %.1f ft", fromRim(longCarom.spot), fromRim(shortCarom.spot)))
        let misses = fga.filter { !$0.made && $0.kind != .block && $0.spot != nil }
        let caroms = misses.map { BasketballScript.Builder.carom(missBeatMiss($0)) }
        let threes = zip(misses, caroms).filter { $0.0.value == 3 }, close = zip(misses, caroms).filter { ($0.0.distance ?? 99) < 8 }
        let weak = threes.filter { m, c in
            let from = Hoops.court(m.spot!)
            return (from.y - 25) * (c.spot.y - 25) < 0 || abs(from.y - 25) < 4
        }
        func mean(_ x: [Double]) -> Double { x.reduce(0, +) / Double(max(x.count, 1)) }
        let alike = caroms.indices.flatMap { a in caroms.indices.filter { $0 > a && hypot(caroms[a].spot.x - caroms[$0].spot.x, caroms[a].spot.y - caroms[$0].spot.y) < 0.05 } }
        check(alike.isEmpty
              && mean(threes.map { fromRim($0.1.spot) }) > mean(close.map { fromRim($0.1.spot) }) + 5 && Double(weak.count) / Double(threes.count) > 0.5,
              "every miss of the game comes down somewhere of its own: threes long and mostly to the weak side, short misses at the rim",
              String(format: "threes %.1f ft (%d of %d weak side), close %.1f ft", mean(threes.map { fromRim($0.1.spot) }), weak.count, threes.count,
                     mean(close.map { fromRim($0.1.spot) })))

        // Whistles: at ESPN's spot, a referee in to call it.
        let foulBeat = BasketballScript(beat: foul!, ends: flat, from: nil)
        let whistle = foulBeat.flashes.first { $0.beat == .whistle }
        let ref = foulBeat.players.firstIndex { $0.team == .official }
        check(whistle != nil && ref != nil && foulBeat.tag?.text == "SHOOTING FOUL · WEMBANYAMA" && foulBeat.tag?.side == .top
              && whistle.map { abs($0.at - (foulBeat.tag?.at ?? 0)) < 0.01 } == true && foulBeat.stamp == .infinity
              && foulBeat.players[0].jumps.isEmpty == false,
              "a shooting foul: the shooter up into it, the whistle, the referee's call, SHOOTING FOUL · WEMBANYAMA in the Spurs' color")
        let chargeBeat = BasketballScript(beat: charge!, ends: flat, from: nil)
        check(chargeBeat.players.prefix(10).contains { $0.actions.contains { $0.kind == .fall } } && chargeBeat.tag?.text == "CHARGE · JOHNSON",
              "a charge: contact, the defender on the floor, CHARGE · JOHNSON")
        let pickBeat = BasketballScript(beat: pick!, ends: flat, from: nil)
        let stealFlash = pickBeat.flashes.first { $0.beat == .steal }
        check(stealFlash.map { hypot($0.point.x - Hoops.court(pick!.spot!).x, $0.point.y - Hoops.court(pick!.spot!).y) < 1.5 } == true
              && (pickBeat.carrier(at: pickBeat.settle)?.player ?? 0) >= 5 && BasketballStamp(pick!).parts.first?.text == "STL",
              "a bad pass picked off where ESPN put it, the stealer away with it: STL")
        let oobBeat = BasketballScript(beat: oob!, ends: flat, from: nil)
        let lying = oobBeat.ball(at: oobBeat.duration)
        check(lying.map { $0.x < 0 || $0.x > Hoops.length || $0.y < 0 || $0.y > Hoops.width } == true && oobBeat.tag?.text == "OUT OF BOUNDS · COLLIER",
              "a pass out of bounds ends off the floor: OUT OF BOUNDS · COLLIER")
        let tipBeat = BasketballScript(beat: tip!, ends: flat, from: nil)
        check(tipBeat.tag?.text == "TIP-OFF · HARPER" && tipBeat.players[0].jumps.count == 1 && tipBeat.players[5].jumps.count == 1
              && tipBeat.carrier(at: tipBeat.settle).map { $0.player < 5 } == true,
              "the opening tip: both jumpers up, the ball to the Spurs: TIP-OFF · HARPER")

        // Every beat of the game builds, on the floor (or by the benches), the ball never under it.
        let beats = scenes.filter { !$0.replays }
        var built: [(BasketballScene, BasketballScript)] = []
        var from: Lineup?
        var side: GameDetail.Side? = .top
        for s in beats {
            let script = BasketballScript(beat: s, ends: HoopsEnds(period: s.period, topIsHome: false, flipped: false), from: from, fallback: side)
            built.append((s, script))
            from = script.lineup(at: script.duration)
            side = s.after ?? side
        }
        // The first thing off the floor in each beat (nil: none).
        func astray(_ sc: BasketballScript) -> String? {
            for t in stride(from: 0.0, through: sc.duration, by: 0.1) {
                for (i, p) in sc.players.enumerated() {
                    let q = p.position(at: t)
                    if !(q.x.isFinite && q.x > -4 && q.x < 98 && q.y > -12 && q.y < 62) { return String(format: "player %d at (%.1f, %.1f), t %.1f", i, q.x, q.y, t) }
                }
                if let b = sc.ball(at: t), b.z < 0.3 { return String(format: "ball at z %.2f, t %.1f", b.z, t) }
            }
            return nil
        }
        let strays = built.compactMap { s, sc in astray(sc).map { "\(s.text.prefix(36)): \($0)" } }
        let sane = strays.isEmpty
        let lengths = built.map(\.1.duration)
        check(built.count == beats.count && sane && lengths.allSatisfy { $0 > 0.9 && $0 < 6 },
              "all \(beats.count) beats of the game, one after another from where the last left off: on the floor, 1–6 s each",
              String(format: "%.2f–%.2f s ", lengths.min() ?? 0, lengths.max() ?? 0)
                + built.filter { $0.1.duration >= 6 }.prefix(6).map { "\($0.0.text.prefix(40)) \(String(format: "%.1f", $0.1.duration))" }.joined(separator: " | ")
                + strays.prefix(4).joined(separator: " | "))
        let inks = TheaterInk(.dark), uniforms = BasketballTeams(offense: Uniform(.blue), defense: Uniform(.orange))
        let sample = Dictionary(grouping: built, by: { "\($0.0.kind)\($0.0.call.map { "\($0)" } ?? "")" }).values.map { $0[0] }
        let broken = sample.compactMap { s, sc -> String? in
            jointsBreak(sc.duration, sc.players.count) { i, t in
                BasketballFrame(scene: s, script: sc, t: t, teams: uniforms, ink: inks, size: CGSize(width: 340, height: 170))
                    .pose(sc.players[i], i, at: sc.players[i].position(at: t), unit: 1.1 / Hoops.ground).0
            }.map { "\(s.text.prefix(30)): \($0)" }
        }
        check(broken.isEmpty, "in a beat of every kind, knees and elbows bend only their own way (the referee's signals, a man on the floor too)",
              broken.prefix(3).joined(separator: " | "))

        // MARK: Between plays

        let live = BasketballScript(rest: .init(offense: .top, ends: flat, phase: .live, from: missBeat.lineup(at: missBeat.duration).seen(by: .top), seed: "a"))
        let opening = live.active.first?.upperBound ?? 0
        let later = live.active.dropFirst()
        let moving = later.map { $0.upperBound - $0.lowerBound }.reduce(0, +)
        let gaps = zip(later.dropLast(), later.dropFirst()).map { $1.lowerBound - $0.upperBound }
        let still = zip(later.dropLast(), later.dropFirst()).allSatisfy { a, b in
            let t1 = a.upperBound + 0.2, t2 = b.lowerBound - 0.1
            return live.players.allSatisfy { $0.position(at: t1) == $0.position(at: t2) } && live.ball(at: t1) == live.ball(at: t2)
        }
        check(!later.isEmpty && moving / (BasketballScript.Builder.restLength - opening) < 0.4 && gaps.allSatisfy { $0 >= 3 } && still,
              "between plays something small happens every few seconds, briefly, and nothing moves in between (no redraw)",
              String(format: "%d beats, %.0f%% of the time", later.count, 100 * moving / (BasketballScript.Builder.restLength - opening)))
        let timeout = scenes.first { $0.kind == .timeout }!
        let toBeat = BasketballScript(beat: timeout, ends: flat, from: missBeat.lineup(at: missBeat.duration))
        let benches = BasketballScript(rest: BasketballFlow.rest(after: timeout, previous: nil, from: toBeat.lineup(at: toBeat.duration), ends: flat,
                                                                 possession: .bottom))
        // Off the near sideline, as drawn (the frame is turned half round when the play's at the left basket).
        let benchRight = flat.right(benches.side)
        let atBench = benches.players.prefix(10).allSatisfy { p in
            let y = p.position(at: BasketballScript.Builder.restLength).y
            return (benchRight ? y : Hoops.width - y) < 0
        }
        let stays = benches.players.prefix(10).allSatisfy { p in
            let a = p.position(at: (benches.active.first?.upperBound ?? 0) + 0.1), b = p.position(at: BasketballScript.Builder.restLength)
            return hypot(a.x - b.x, a.y - b.y) < 2
        }
        check(toBeat.tag?.text == "TIMEOUT · JAZZ" && benches.formation == .benches && atBench && stays,
              "a timeout: the whistle, TIMEOUT · JAZZ, both teams to their benches and there till play resumes")
        let half = scenes.first { $0.kind == .periodEnd && $0.period == 2 }!
        let empty = BasketballScript(rest: BasketballFlow.rest(after: half, previous: nil, from: missBeat.lineup(at: missBeat.duration), ends: flat,
                                                               possession: nil))
        check(empty.formation == .offCourt && empty.players.allSatisfy { $0.opacity(at: empty.duration) == 0 },
              "at the half the floor empties")
        let names = (top: "Spurs", bottom: "Jazz")
        check(BasketballStatus.between(context: timeout, rest: nil, names: names)?.text == "TIMEOUT · JAZZ"
              && BasketballStatus.between(context: half, rest: nil, names: names)?.text == "HALFTIME"
              && BasketballStatus.between(context: miss, rest: after, names: names).map { "\($0.text) \($0.side == .top)" } == "SPURS BALL true"
              && BasketballStatus.between(context: foul, rest: BasketballFlow.rest(after: foul, previous: nil, from: nil, ends: flat, possession: nil),
                                          names: names)?.text == "FREE THROWS · JAZZ",
              "the tag between plays: TIMEOUT · JAZZ, HALFTIME, SPURS BALL in the Spurs' color, FREE THROWS · JAZZ")
        let lane = BasketballScript(rest: BasketballFlow.rest(after: foul, previous: nil, from: foulBeat.lineup(at: foulBeat.duration), ends: flat,
                                                              possession: nil))
        let ftFromLane = BasketballScript(beat: ft1!, ends: flat, from: lane.lineup(at: BasketballScript.Builder.restLength))
        check(lane.formation == .lane && lane.carrier(at: BasketballScript.Builder.restLength)?.player == 0
              && zip(lane.lineup(at: BasketballScript.Builder.restLength).at, ftFromLane.players.prefix(10).map(\.at)).allSatisfy { $0 == $1 },
              "a shooting foul leads to the lane, the man fouled at the line with the ball, and the free throw starts where they stand")
    }

    /// A scene's shot as the miss its board comes off.
    private static func missBeatMiss(_ s: BasketballScene) -> BasketballScene.Miss {
        BasketballScene.Miss(spot: s.spot ?? CGPoint(x: 25, y: 15), shooter: s.shooter, value: s.value,
                             close: [.layup, .dunk, .alleyOop, .putback].contains(s.shot ?? s.kind), id: s.id, blocked: s.result == .blocked,
                             freeThrow: s.kind == .freeThrow, distance: s.kind == .freeThrow ? 14 : s.distance)
    }
}
