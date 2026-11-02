import SwiftUI
import simd

extension ScorelineTests {
    static func gamePresentationRegressions() {
        print("\nGame presentation regressions")
        let fixture = broadcastFixture("nfl-cle-pit-halftime.json")
        let items = fixture["items"].array
        let policy = BroadcastLanes.policy(.football, path: "football/nfl")
        let entries = BroadcastLanes.entries(items, sport: .football, policy: policy)
        check(entries.count == 95, "Steelers–Browns halftime capture loads", "\(entries.count)")
        var now = EventTime.parse("2026-11-01T19:43:00Z")!
        let b = Broadcast()
        b.automatic = false
        b.time = BroadcastTime(now: { now })
        var event = Event(id: "espn-401873027", content: .match(top: comp("espn-football-5", "Browns", "6"),
                                                               bottom: comp("espn-football-23", "Steelers", "20")),
                          state: .live, start: Date(timeIntervalSince1970: now - 7200), detail: "Halftime", caption: nil, link: nil,
                          ref: .espn(path: "football/nfl", id: "401873027", sport: .football))
        event.clock = GameClock(seconds: 0, sampledAt: Date(timeIntervalSince1970: now), period: 2, direction: .down,
                                display: "Halftime", running: false)
        var detail = GameDetail()
        detail.topIsHome = false
        detail.broadcastPlays = entries
        b.begin(event, topIsHome: false)
        b.ingest(summary: detail)
        check(b.present(event).detail == "Halftime" && b.presented.phase == .interval(period: 2),
              "opening at halftime immediately presents halftime, not the first-quarter timeout",
              "\(b.present(event).detail ?? "nil"), told \(b.presented.told), last \(b.presented.lastID ?? "nil")")
        let later = b.engine?.timeline.records.filter { $0.presentAt > now } ?? []
        check(later.isEmpty, "historical stopped-clock plays are not rescheduled after the page opens", "\(later.map(\.id))")
        b.observe(status: fixture["status"])
        b.ingest(core: items)
        check(b.present(event).detail == "Halftime", "core and status refresh keep the same halftime state")
        check(b.presented.isInterval && b.presented.note == nil && b.present(event).clock == nil,
              "the break has one status and no running game clock")
        let teams = FootballFeed.Teams(topIsHome: false, topID: "5", bottomID: "23", homeAbbreviation: "PIT", awayAbbreviation: "CLE",
                                       homeName: "Steelers", awayName: "Browns")
        check(b.footballPossession(teams) == nil, "halftime does not claim anyone has possession")
        let stale = GameDetail.Football(downDistance: "1st & 10", ballX: 34, lineToGainX: 44, possession: .top, redZone: false,
                                        topTimeouts: 0, bottomTimeouts: 0, lastPlay: "END QUARTER 2")
        let paused = b.footballSituation(teams, fallback: stale)
        check(paused != nil && paused?.possession == nil && paused?.downDistance == nil && paused?.lineToGainX == nil,
              "the halftime field clears stale possession and down-and-distance")
        let parsed = ESPNDetail.parse(summary: fixture, board: nil, path: "football/nfl", id: "401873027", sport: .football, event: event)
        let colored = parsed.colored(event)
        check(colored.competitors.map(\.color) == ["472a08", "000000"]
              && colored.competitors.map(\.alternateColor) == ["ff3c00", "ffb612"],
              "a colorless historical event gets the summary's primary and alternate colors, by team ID")
        check(colored.competitors.map(\.score) == event.competitors.map(\.score) && colored.ref == event.ref,
              "color enrichment preserves score and competition routing")
        now += 180
        var resumed = items.last!.raw as! [String: Any]
        resumed["id"] = "test-second-half-kickoff"
        resumed["sequenceNumber"] = "230000"
        resumed["period"] = ["number": 3]
        resumed["clock"] = ["displayValue": "15:00"]
        resumed["type"] = ["id": "53", "text": "Kickoff"]
        resumed["text"] = "Second-half kickoff returned to the 30-yard line."
        resumed["wallclock"] = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: now - 90))
        b.ingest(core: items + [JSON(resumed)])
        // An arriving play retains the broadcast's normal presentation delay.
        // Continue successful polls until its scheduled moment is reached.
        for _ in 0..<6 { now += 5; b.noteRead() }
        check(b.presented.phase == .live && b.presented.period == 3 && b.presented.note == nil,
              "a third-quarter kickoff clears halftime when its presentation moment arrives",
              "phase \(b.presented.phase), last \(b.presented.lastID ?? "nil"), p \(b.engine?.p(at: now) ?? 0)")
        b.end()

        // Every break the feed logs: into it once, then its quiet, the tag standing until the next play.
        for (kind, words) in [(FootballStoppage.Kind.official, "Official timeout"), (.twoMinuteWarning, "Two-minute warning"), (.halftime, "Halftime"),
                              (.endOfPeriod, "End of 1st"), (.timeout, "Timeout")] {
            guard let stop = items.compactMap({ FootballStoppage.parse($0, teams: teams) }).first(where: { $0.kind == kind }) else {
                check(false, "recorded break exists: \(kind)"); continue
            }
            let idle = FootballIdle.make(play: nil, stoppage: stop, rest: FootballScript.Rest(yard: 35, gain: 45),
                                         offense: .top, down: nil, kickoff: false, flipped: false)
            let script = FootballScript(idle: idle)
            let clip = GridClip(script, scene: nil, idle: idle, offense: .top, stoppage: stop)
            guard let loop = script.loop else { check(false, "\(kind): a break holds a quiet loop"); continue }
            check(loop.start >= FootballScript.Builder.settled && loop.period >= 30 && clip.local(loop.start + loop.period * 3.5) >= loop.start,
                  "\(kind): the way in plays once; only the quiet goes round")
            let start = loop.start, end = loop.start + loop.period
            let settled = clip.figures.indices.map { clip.position($0, at: start + 0.01) }
            let ranged = stride(from: start, through: end + (end - start) * 3, by: 0.5).allSatisfy { t in
                clip.figures.indices.allSatisfy { simd_length(clip.position($0, at: t) - settled[$0]) < 13 }
            }
            check(ranged, "\(kind): nobody walks off again: a few steps from where he settled, at most, however long it lasts")
            check(clip.figures.indices.allSatisfy { simd_length(clip.position($0, at: end - 0.01) - settled[$0]) < 0.5 },
                  "\(kind): the loop comes back to where it began")
            check(longestStill(script.beats, from: loop.start, period: loop.period) <= 8.2, "\(kind): never still past about 8 s",
                  "\(longestStill(script.beats, from: loop.start, period: loop.period))")
            let names = FootballStatus.Names(top: "Browns", bottom: "Steelers")
            let tags = [0.5, 9, 40, 300, 1000].map {
                FootballStatus.idle(idle, stoppage: stop, script: script, t: script.idleTime($0), names: names, situation: "3rd & 7 at CLE 40", timeoutsLeft: (nil, nil)).tag ?? ""
            }
            check(Set(tags).count == 1 && tags[0].hasPrefix(words) && !tags[0].contains("ball") && !tags[0].contains("3rd & 7"),
                  "\(kind): the tag stands until the next play, with no stale possession or down", "\(tags)")
            check(FootballStatus.changes(idle, script: script).isEmpty, "\(kind): the tag never changes on its own")
        }
        stoppagePhases()
        soccerHalfTime(root: URL(fileURLWithPath: "Tests/Fixtures/broadcast"))
        breakScenes()
        presentationFrameTiers()
    }

    /// The longest stretch with no beat, within a loop (its seam included).
    static func longestStill(_ beats: [ClosedRange<Double>], from start: Double, period: Double) -> Double {
        let inside = beats.filter { $0.upperBound > start }.map { max($0.lowerBound, start)...min($0.upperBound, start + period) }.sorted { $0.lowerBound < $1.lowerBound }
        guard let first = inside.first, let last = inside.last else { return period }
        var longest = first.lowerBound - start + (start + period - last.upperBound)
        var end = first.upperBound
        for beat in inside.dropFirst() {
            longest = max(longest, beat.lowerBound - end)
            end = max(end, beat.upperBound)
        }
        return longest
    }

    /// What every surface reads: the told plays' stoppage, through a page's real lanes, in each sport.
    static func stoppagePhases() {
        print("\nStoppages")
        let base = EventTime.parse("2026-11-01T19:00:00Z")!
        func stamp(_ t: Double) -> String { ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: base + t)) }
        /// A page opened on these plays (ESPN's shapes), with the status coming in for a while.
        func page(_ sport: Sport, _ path: String, _ plays: [[String: Any]], status: [String: Any]? = nil) -> (shown: Event, game: PresentedGame) {
            var now = base + 200
            let b = Broadcast()
            b.automatic = false
            b.time = BroadcastTime(now: { now })
            let event = Event(id: "espn-1", content: .match(top: comp("espn-\(sport.rawValue)-1", "A", "1"), bottom: comp("espn-\(sport.rawValue)-2", "B", "2")),
                              state: .live, start: Date(timeIntervalSince1970: base - 3600), detail: nil, caption: nil, link: nil,
                              ref: .espn(path: path, id: "1", sport: sport))
            b.begin(event, topIsHome: sport == .soccer)
            b.ingest(core: plays.map { JSON($0) })
            for _ in 0..<40 {
                now += 5
                if let status { b.observe(status: JSON(status)) }
                b.noteRead()
            }
            let shown = b.present(event), game = b.presented
            b.end()
            return (shown, game)
        }
        func nba(_ id: String, _ type: Int, _ text: String, _ t: Double, clock: String = "5:23", shot: Bool = false, people: Int = 0) -> [String: Any] {
            ["id": id, "type": ["id": "\(type)", "text": text], "period": ["number": 2], "clock": ["displayValue": clock], "wallclock": stamp(t), "text": text,
             "shootingPlay": shot, "participants": Array(repeating: ["athlete": ["id": "1"]], count: people)]
        }
        let path = "basketball/nba"
        let shot = nba("1", 92, "Jumper", 0, clock: "5:40", shot: true, people: 1)
        var game = page(.basketball, path, [shot, nba("2", 16, "Full Timeout", 10)]).game
        check(game.stoppage == .timeout && game.note == "Timeout", "NBA: a full timeout", "\(game.phase)")
        game = page(.basketball, path, [shot, nba("2", 16, "Full Timeout", 10), nba("3", 584, "Substitution", 12)]).game
        check(game.stoppage == .timeout, "NBA: a substitution in a timeout doesn't end it")
        game = page(.basketball, path, [shot, nba("2", 16, "Full Timeout", 10), nba("3", 92, "Jumper", 30, clock: "5:10", shot: true, people: 1)]).game
        check(game.phase == .live, "NBA: the next shot ends it")
        game = page(.basketball, path, [shot, nba("2", 215, "Coach's Challenge (Stands)", 10)]).game
        check(game.note == "Under review", "NBA: a challenge")

        func soccer(_ id: String, _ type: String, _ text: String, _ t: Double, located: Bool = false) -> [String: Any] {
            var play: [String: Any] = ["id": id, "type": ["type": type], "period": ["number": 1], "clock": ["value": 1800 + t, "displayValue": "31'"],
                                       "wallclock": stamp(t), "text": text]
            if located { play["fieldPositionX"] = 0.5; play["fieldPositionY"] = 0.5 }
            return play
        }
        let pass = soccer("1", "pass", "", 0, located: true)
        game = page(.soccer, "soccer/eng.1", [pass, soccer("2", "start-delay", "", 10), soccer("3", "start-delay", "Delay in match because of an injury to A (B).", 10)]).game
        check(game.note == "Delay in match", "soccer: a delay for a man down (ESPN logs it twice; one says why)", "\(game.phase)")
        game = page(.soccer, "soccer/eng.1", [pass, soccer("2", "start-delay", "Delay in match for a VAR check.", 10), soccer("3", "substitution", "", 12)]).game
        check(game.note == "VAR check", "soccer: VAR, through a substitution")
        game = page(.soccer, "soccer/eng.1", [pass, soccer("2", "start-delay", "Delay in match.", 10), soccer("3", "end-delay", "Delay over.", 30)]).game
        check(game.phase == .live, "soccer: the delay's over")

        func mlb(_ id: String, _ type: String, _ text: String, _ t: Double, half: String = "top") -> [String: Any] {
            ["id": id, "type": ["type": type], "period": ["number": 5, "type": half], "wallclock": stamp(t), "text": text, "atBatId": "400000\(id)"]
        }
        let pitch = mlb("1", "ball", "Ball 1", 0)
        game = page(.baseball, "baseball/mlb", [pitch, mlb("2", "play-result", "Rodriguez relieved Vásquez", 10), mlb("3", "start-batterpitcher", "", 12)]).game
        check(game.note == "Pitching change", "MLB: a pitching change, as ESPN logs it", "\(game.phase)")
        game = page(.baseball, "baseball/mlb", [pitch, mlb("2", "play-result", "Rodriguez relieved Vásquez", 10), mlb("3", "strike-looking", "Strike 1", 40)]).game
        check(game.phase == .live, "MLB: the next pitch ends it")
        let middle = page(.baseball, "baseball/mlb", [pitch, mlb("2", "end-inning", "", 10)])
        check(middle.game.phase == .interval(period: 9) && middle.shown.detail == "Mid 5th" && middle.game.note == nil, "MLB: between innings", "\(middle.shown.detail ?? "nil")")

        // ESPN's status when a game's held up: its words survive, over the clock and the tag.
        let held = broadcastFixture("espn-status-held-up.json").array
        check(held.count == 5, "the held-up statuses load")
        for status in held {
            let words = status["type"]["shortDetail"].string ?? ""
            check(BroadcastLanes.liveState(words) == .stopped(words), "\(words): held up, in ESPN's words")
            let sport: Sport = status["sport"].string == "football" ? .football : .baseball
            let plays = sport == .baseball ? [pitch] : [["id": "1", "type": ["id": "24", "text": "Pass Reception"], "period": ["number": 2], "sequenceNumber": "1",
                                                         "clock": ["displayValue": "7:18"], "wallclock": stamp(0), "text": "Pass"] as [String: Any]]
            let delayed = page(sport, sport == .baseball ? "baseball/mlb" : "football/nfl", plays, status: status.raw as? [String: Any])
            check(delayed.shown.detail == words && delayed.shown.clock == nil && delayed.game.note == nil, "\(words): the status says so, with no clock under it",
                  "\(delayed.shown.detail ?? "nil") \(delayed.game.phase)")
            check(TheaterStatus(tag: "A ball", tint: "ff0000").holding(delayed.game).tag == words, "\(words): the theater's tag too")
        }
        check(!BroadcastLanes.isHeldUp("4:12 - 3rd") && !BroadcastLanes.isHeldUp("Half-time") && !BroadcastLanes.isHeldUp("67'"), "a game in play isn't held up")

        // The docked bar reads the same word.
        let event = Event(id: "1", content: .match(top: comp("a", "A", "1"), bottom: comp("b", "B", "2")), state: .live, start: .now, detail: "7:18 - 4th",
                          caption: nil, link: nil, ref: .espn(path: "football/nfl", id: "1", sport: .football))
        var inputs = DockInputs(event: event, detail: nil, colors: (.red, .blue), scores: ("1", "2"))
        inputs.football = GameDetail.Football(downDistance: "3rd & 7 at CLE 40", ballX: 40, lineToGainX: 50, possession: .top, redZone: false,
                                              topTimeouts: 3, bottomTimeouts: 3, lastPlay: nil)
        inputs.stoppage = Stoppage.officialTimeout.words
        check(DockBar.make(inputs).detail == .stoppage("Official timeout"), "the docked bar says what the hero says, not a stale down")
        check(BroadcastLanes.stoppage(type: "Official Timeout") == .officialTimeout && BroadcastLanes.stoppage(type: "Full Timeout") == .timeout
              && BroadcastLanes.stoppage(type: "Two-minute warning") == .twoMinuteWarning && BroadcastLanes.stoppage(type: "Rush") == nil, "one table, every sport")
    }

    /// Soccer's half-time on a real recording where ESPN posted the entry 17 minutes after its status said HT.
    static func soccerHalfTime(root: URL) {
        print("\nHalf-time before its entry")
        let recording = Recording.load(root: root, sport: "soccer_usa.1", event: "761921", settle: 0)
        guard var replay = RecordingReplay(recording) else { return check(false, "the half-time window replays") }
        let rows = recording.status.map(\.json)
        guard let ht = rows.first(where: { $0["detail"].string == "HT" })?["at"].double,
              let back = rows.first(where: { ($0["at"].double ?? 0) > ht && $0["detail"].string != "HT" })?["at"].double else {
            return check(false, "the recording has its break")
        }
        check(back - ht > 900, "ESPN's status says HT for a quarter of an hour")
        var seen: [(p: PTime, status: String, interval: Bool)] = []
        replay.run(.app(replay.policy)) { replay, t, _, _ in
            let game = replay.engine.presented(at: t)
            seen.append((replay.engine.p(at: t), game.status(.soccer, regulationPeriods: 2), game.isInterval))
        }
        let lag = replay.engine.timeline.fastLag
        // The break on p: from the status's first word, its lag taken off, until the second half's first play is told.
        let from = seen.drop { $0.p < ht - lag + 6 }
        let during = from.prefix { $0.interval && $0.status == "Half-time" }
        let held = (during.last?.p ?? 0) - (during.first?.p ?? 0)
        check(!from.isEmpty && from.first?.interval == true && held > back - ht - 60, "through the whole break the hero says Half-time",
              "\(Int(held)) s of \(Int(back - ht)) s, then \(from.dropFirst(during.count).first?.status ?? "nil")")
        let minutes = seen.compactMap { s -> Int? in
            guard s.status.hasPrefix("45'+") else { return nil }
            return Int(s.status.dropFirst(4).prefix { $0.isNumber })
        }
        check((minutes.max() ?? 0) <= 12, "the clock never climbs through it", "45'+\(minutes.max() ?? 0)'")
        check(seen.last?.interval == false && seen.last?.status.hasSuffix("'") == true && from.dropFirst(during.count).allSatisfy { !$0.interval },
              "and the second half takes over, for good", "\(seen.last?.status ?? "nil")")
    }

    /// Every sport's break, once set: nothing still past about 8 s, nothing repeated.
    static func breakScenes() {
        print("\nBreak scenes")
        let ball = SoccerTouch(side: .top, at: CGPoint(x: 50, y: 34), order: 1)
        for (name, kind, text) in [("a man down", SoccerEvent.Kind.injury, "Delay in match because of an injury to A."), ("a delay", .delay, "Delay in match."),
                                   ("a VAR check", .varCheck, "Delay in match for a VAR check."), ("half-time", .halftime, "")] {
            var event = SoccerEvent(id: "e-\(name)", kind: kind, text: text, order: 1)
            event.period = 1
            let idle = SoccerIdle.make(event: event, touch: ball, scene: nil, period: 1, lineups: [:], flipped: false)
            let script = SoccerScript(idle: idle, bodies: false)
            let clip = PitchClip(script, scene: nil, idle: idle, attacking: .top)
            guard let loop = script.loop else { check(false, "soccer, \(name): holds a quiet loop"); continue }
            check(longestStill(script.beats, from: loop.start, period: loop.period) <= 8.2, "soccer, \(name): never still past about 8 s",
                  "\(longestStill(script.beats, from: loop.start, period: loop.period))")
            let start = loop.start, end = loop.start + loop.period
            check(clip.figures.indices.allSatisfy { simd_length(clip.position($0, at: end - 0.01) - clip.position($0, at: start + 0.01)) < 0.3 },
                  "soccer, \(name): the loop comes back to where it began")
        }
        var halfTime = SoccerEvent(id: "ht", kind: .halftime, text: "", order: 1)
        halfTime.period = 1
        check(SoccerStatus.idle(SoccerIdle.make(event: halfTime, touch: ball, scene: nil, period: 1, lineups: [:], flipped: false), t: 300,
                                names: SoccerStatus.Names(top: "A", bottom: "B"), added: nil).tag == "Half-time", "soccer: one spelling")

        for (name, phase) in [("a timeout", BasketballScript.Rest.Phase.benches), ("the half", .offCourt)] {
            let script = BasketballScript(rest: BasketballScript.Rest(offense: .top, phase: phase, seed: "rest-\(name)"))
            check(script.duration == BasketballScript.Builder.restLength, "NBA, \(name): a court that goes on")
            check(longestStill(script.active, from: 0, period: script.duration) <= 8.2, "NBA, \(name): never still past about 8 s",
                  "\(longestStill(script.active, from: 0, period: script.duration))")
        }

        for rest in [PlayScript.Rest(bases: [true, false, false], bats: .right), PlayScript.Rest(), PlayScript.Rest(standing: .tarp)] {
            let script = PlayScript(quiet: rest, seed: Celebration.seed("field"))
            let moves = script.actors.flatMap { $0.moves.map { $0.start...($0.end + 0.2) } }
            let what = rest.standing == .tarp ? "the tarp" : rest.bats == nil ? "between innings" : "between pitches"
            check(longestStill(moves, from: 0, period: script.duration) <= 8.2, "MLB, \(what): never still past about 8 s",
                  "\(longestStill(moves, from: 0, period: script.duration))")
            check(script.actors.allSatisfy { hypot($0.position(at: script.duration).x - $0.position(at: 0).x, $0.position(at: script.duration).y - $0.position(at: 0).y) < 0.01 },
                  "MLB, \(what): the loop comes back to where it began")
            check(script.actors.allSatisfy { a in
                switch a.role {
                case .fielder(1), .fielder(2), .batter, .umpire: a.moves.isEmpty
                default: true
                }
            }, "MLB, \(what): the battery, the batter and the umpire wait on each other")
        }
        check(PlayScript(rest: PlayScript.Rest()).duration == 0, "a replay's field is still as it was")
    }
}
