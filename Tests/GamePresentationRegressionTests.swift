import SwiftUI

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
        check(b.breakLabel == "Halftime" && b.present(event).clock == nil,
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
        check(b.presented.phase == .live && b.presented.period == 3 && b.breakLabel == nil,
              "a third-quarter kickoff clears halftime when its presentation moment arrives",
              "phase \(b.presented.phase), last \(b.presented.lastID ?? "nil"), p \(b.engine?.p(at: now) ?? 0)")
        b.end()

        for kind in [FootballStoppage.Kind.official, .twoMinuteWarning, .halftime] {
            guard let stop = items.compactMap({ FootballStoppage.parse($0, teams: teams) }).first(where: { $0.kind == kind }) else {
                check(false, "recorded break exists: \(kind)"); continue
            }
            let idle = FootballIdle.make(play: nil, stoppage: stop, rest: FootballScript.Rest(yard: 35, gain: 45),
                                         offense: .top, down: nil, kickoff: false, flipped: false)
            let script = FootballScript(idle: idle)
            let clip = GridClip(script, scene: nil, idle: idle, offense: .top, stoppage: stop)
            check(script.loop == nil && !clip.moving(at: 180) && clip.local(180) == clip.local(300),
                  "\(kind): enter the break once, then hold without replaying the departure")
            check(clip.figures.indices.allSatisfy { clip.position($0, at: 180) == clip.position($0, at: 300) },
                  "\(kind): players stay in their settled positions")
        }

        presentationFrameTiers()
    }
}
