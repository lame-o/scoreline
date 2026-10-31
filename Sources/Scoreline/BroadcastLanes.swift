import Foundation

// The game as one broadcast, part 3: the lanes (BROADCAST.md §1, "Ingest").
//
// Each sport's feeds, read into the timeline's terms: every play's ID, event
// time, period and clock, kind (live-ball or dead-ball, whether it stops the
// clock, whether it ends a period), score after it, and a digest of the
// fields that make a revision; the play itself rides along as the feed's own
// JSON, so the page's real parsers read the presented prefix unchanged. And
// the fast lane (the scoreboard, the core status) read as evidence.
//
// The per-sport numbers live here too (`BroadcastLanes.policy`). Measured ones
// say so; the rest are starting values the recording bench tunes.

/// The sports the broadcast clock runs for (head-to-head ESPN games with a play-by-play).
enum BroadcastSport: String, Hashable, Sendable {
    case basketball, football, soccer, baseball
}

enum BroadcastLanes {
    // MARK: Policy

    /// The numbers for a sport. NBA's are measured (CHOREOGRAPHY §3.1, the
    /// 2026-10-30 recordings); the others start from the fixtures' timing and
    /// the NBA's lags until their recordings are measured (§9.5).
    static func policy(_ sport: BroadcastSport, path: String = "") -> BroadcastPolicy {
        var p = BroadcastPolicy()
        switch sport {
        case .basketball:
            // Live-ball lag p50 31 s, p90 47 s (one 4th quarter); miss and rebound arrive together.
            p.priorLag = 47
            // A shot clock: something live is logged at least every 24 game seconds, ~3× in wall time when it stops.
            p.quietRunning = 45
            // Free throws trail their foul by 22–89 s; the net is for a play that never comes.
            p.safetyGrace = 60
            p.periodLength = path == NBADetail.path ? 720 : 600
            p.overtimeLength = 300
            p.regulationPeriods = 4
            p.priorFastLag = 24
        case .football:
            // Snap to snap p50 42 s, p90 69–90 s inside a drive; the clock often runs between.
            p.priorLag = 50
            p.horizons = BindingHorizons(live: 2.5, byKind: ["snap": 3, "kick": 3])
            p.quietRunning = 100
            p.insertionAllowance = 6
            p.safetyGrace = 60
            p.periodLength = 900
            p.overtimeLength = path.hasSuffix("college-football") ? 0 : 600
            p.regulationPeriods = 4
            p.priorFastLag = 25
        case .soccer:
            // Entries every 2 s (p50); dead balls run to 105 s (goals, subs, injuries).
            p.priorLag = 45
            p.quietRunning = 120
            p.safetyGrace = 45
            p.clockCountsDown = false
            p.periodLength = 2700
            p.overtimeLength = 900
            p.regulationPeriods = 2
            p.priorFastLag = 25
            p.slowPoll = 8
        case .baseball:
            // Pitch to pitch p50 20 s, p90 31 s; mound visits ~73 s, pitching changes ~147 s.
            p.priorLag = 35
            p.quietRunning = 150
            p.safetyGrace = 45
            p.clockCountsDown = nil
            p.periodLength = 0
            p.overtimeLength = 0
            p.regulationPeriods = 18
            p.priorFastLag = 20
        }
        return p
    }

    // MARK: Entries

    /// A lane's plays as timeline entries, in game order. Football's feed isn't
    /// always listed in play order: its sequence numbers are (ties keep the list's order).
    static func entries(_ items: [JSON], sport: BroadcastSport, policy: BroadcastPolicy) -> [TimelineEntry<RawPlay>] {
        switch sport {
        case .basketball: return items.compactMap { basketball($0, policy: policy) }
        case .football:
            let parsed = items.enumerated().compactMap { offset, item in football(item, policy: policy).map { (offset, $0) } }
            return parsed.sorted { ($0.1.progressKey, $0.0) < ($1.1.progressKey, $1.0) }.map(\.1.entry)
        case .soccer: return items.compactMap { soccer($0, policy: policy) }
        case .baseball:
            var entries: [TimelineEntry<RawPlay>] = []
            entries.reserveCapacity(items.count)
            for (offset, item) in items.enumerated() {
                if let e = baseball(item, ordinal: offset, policy: policy) { entries.append(e) }
            }
            return entries
        }
    }

    /// The summary's play list, in game order, for sports whose summary has one
    /// (soccer's doesn't: its plays come from the core lane).
    static func summaryPlays(_ summary: JSON, sport: BroadcastSport) -> [JSON]? {
        switch sport {
        case .basketball, .baseball:
            let plays = summary["plays"].array
            return plays.isEmpty && !summary["plays"].exists ? nil : plays
        case .football:
            var plays: [JSON] = []
            for drive in summary["drives"]["previous"].array { plays += drive["plays"].array }
            let current = summary["drives"]["current"]
            if current.exists {
                let known = Set(plays.compactMap { $0["id"].string })
                plays += current["plays"].array.filter { !known.contains($0["id"].string ?? "") }
            }
            // Summaries outside a drive list (a final with only scoring plays) say nothing complete.
            return plays.isEmpty ? nil : plays
        case .soccer:
            return nil
        }
    }

    /// The scores a play carries, home and away.
    static func score(_ play: JSON) -> ScoreLine? {
        guard let home = play["homeScore"].int, let away = play["awayScore"].int else { return nil }
        return ScoreLine(home: home, away: away)
    }

    /// The digest of a play's fields that a revision changes (text, type, scores,
    /// time, place, people). `extra` carries a sport's own fields.
    static func digest(_ play: JSON, extra: (inout Hasher) -> Void = { _ in }) -> Int {
        var h = Hasher()
        h.combine(play["id"].string)
        h.combine(play["text"].string)
        h.combine(play["type"]["id"].string)
        h.combine(play["type"]["text"].string)
        h.combine(play["type"]["type"].string)
        h.combine(play["homeScore"].int)
        h.combine(play["awayScore"].int)
        h.combine(play["scoreValue"].int)
        h.combine(play["scoringPlay"].bool)
        h.combine(play["wallclock"].string)
        h.combine(play["period"]["number"].int)
        h.combine(play["clock"]["displayValue"].string)
        h.combine(play["team"]["id"].string ?? play["team"]["$ref"].string)
        for person in play["participants"].array {
            h.combine(person["athlete"]["id"].string ?? person["athlete"]["$ref"].string)
            h.combine(person["type"].string)
        }
        extra(&h)
        return h.finalize()
    }

    // MARK: Basketball

    /// Clock-stopping turnovers: violations and dead balls. A turnover with a
    /// stealer (a second participant) is a live ball.
    static let stoppingTurnovers: Set<Int> = [64, 65, 67, 68, 69, 70, 71, 72, 73, 78, 84, 86, 87, 90]

    /// A basketball play (summary or normalized core plays). Live-ball: shots,
    /// rebounds by a player, turnovers, the jump ball. Dead-ball: free throws,
    /// fouls, timeouts, substitutions, reviews, violations, team rebounds, period ends.
    static func basketball(_ play: JSON, policy: BroadcastPolicy) -> TimelineEntry<RawPlay>? {
        guard let id = play["id"].string else { return nil }
        let period = play["period"]["number"].int ?? 0
        let display = play["clock"]["displayValue"].string ?? ""
        let remaining = play["clock"]["value"].double ?? NBADetail.seconds(display)
        let length = policy.length(of: period)
        let elapsed = remaining.map { max(length - $0, 0) }
        let type = play["type"]["id"].int
        let people = play["participants"].array.count
        let kind: PlayKind
        if let end = NBADetail.periodEnd(play) {
            kind = PlayKind(.dead, end.final ? "game end" : "period end", endsPeriod: end.period, endsGame: end.final)
        } else if NBADetail.isFreeThrow(play) {
            kind = PlayKind(.dead, "free throw", stopsClock: true)
        } else if play["shootingPlay"].bool == true {
            // A made basket stops the clock in the last two minutes of the fourth and overtime.
            let late = period >= policy.regulationPeriods && (remaining ?? .infinity) <= 120
            kind = PlayKind(.live, "shot", stopsClock: play["scoringPlay"].bool == true && late)
        } else if type == 155 || type == 156 {
            kind = people > 0 ? PlayKind(.live, "rebound") : PlayKind(.dead, "team rebound", stopsClock: true)
        } else if let type, NBADetail.turnoverTypes.contains(type) {
            kind = PlayKind(.live, "turnover", stopsClock: people < 2 && stoppingTurnovers.contains(type))
        } else if type == 615 {
            kind = PlayKind(.live, "jump ball")
        } else if type == 16 || type == 17 {
            kind = PlayKind(.dead, "timeout", stopsClock: true)
        } else if type == 584 {
            kind = PlayKind(.dead, "substitution", stopsClock: true)
        } else if let type, (213...290).contains(type) {
            kind = PlayKind(.dead, "review", stopsClock: true)
        } else if let type, (20...60).contains(type) {
            kind = PlayKind(.dead, "foul", stopsClock: true)
        } else {
            kind = PlayKind(.dead, "other", stopsClock: true)
        }
        let digest = digest(play) { h in
            h.combine(play["coordinate"]["x"].double)
            h.combine(play["coordinate"]["y"].double)
            h.combine(play["shootingPlay"].bool)
        }
        return TimelineEntry(id: id, wallclock: EventTime.parse(play["wallclock"].string), period: period,
                             progress: elapsed ?? 0,
                             clock: GameClockReading(elapsed: elapsed, resolution: display.contains(":") ? 1 : 0.1, display: display),
                             kind: kind, score: score(play), text: play["text"].string ?? "", digest: digest,
                             payload: RawPlay(json: play, digest: digest))
    }

    // MARK: Football

    /// Entries ESPN logs between snaps: stoppages and admin.
    static let footballAdmin: Set<String> = ["Official Timeout", "Timeout", "End Period", "End of Half", "End of Game",
                                             "Two-minute warning", "Coin Toss", "End of Regulation", "End of Quarter"]

    /// A football entry. Every snap (rush, pass, sack, kick, penalty) is live;
    /// stoppages and admin are dead. The clock stops after an incompletion, a
    /// score, a turnover, a kick, a penalty, a play out of bounds, a timeout,
    /// and a period's end.
    static func football(_ play: JSON, policy: BroadcastPolicy) -> (entry: TimelineEntry<RawPlay>, progressKey: Double)? {
        guard let id = play["id"].string else { return nil }
        let period = play["period"]["number"].int ?? 0
        let typeText = play["type"]["text"].string ?? ""
        let typeID = play["type"]["id"].string ?? ""
        let remaining = play["clock"]["value"].double
        let length = policy.length(of: period)
        let elapsed = remaining.map { length > 0 ? max(length - $0, 0) : $0 }
        let text = (play["text"].string ?? "").lowercased()
        let sequence = Double(play["sequenceNumber"].string ?? "") ?? play["sequenceNumber"].double ?? 0
        let kind: PlayKind
        if footballAdmin.contains(typeText) || typeText.hasPrefix("End ") {
            let ends = typeText.hasPrefix("End")
            let final = typeText == "End of Game"
            kind = PlayKind(.dead, ends ? (final ? "game end" : "period end") : typeText.lowercased(),
                            stopsClock: true, endsPeriod: ends ? period : nil, endsGame: final)
        } else {
            let incomplete = typeID == "3"
            let kick = ["52", "53", "59", "60", "18", "12", "17"].contains(typeID) || typeText.contains("Punt") || typeText.contains("Kickoff")
                || typeText.contains("Field Goal")
            let outOfBounds = text.contains(" ob ") || text.contains("out of bounds") || text.contains("pushed ob") || text.contains("ran ob")
            let stops = incomplete || kick || outOfBounds || play["scoringPlay"].bool == true || play["isTurnover"].bool == true
                || play["isPenalty"].bool == true || typeID == "8" || text.contains("spike")
            kind = PlayKind(.live, play["isPenalty"].bool == true || typeID == "8" ? "penalty" : kick ? "kick" : "snap", stopsClock: stops)
        }
        let digest = digest(play) { h in
            h.combine(play["start"]["yardLine"].double)
            h.combine(play["end"]["yardLine"].double)
            h.combine(play["start"]["down"].int)
            h.combine(play["statYardage"].int)
            h.combine(play["isPenalty"].bool)
            h.combine(play["isTurnover"].bool)
        }
        let entry = TimelineEntry(id: id, wallclock: EventTime.parse(play["wallclock"].string), period: period,
                                  progress: elapsed ?? sequence,
                                  clock: GameClockReading(elapsed: elapsed, display: play["clock"]["displayValue"].string),
                                  kind: kind, score: score(play), text: play["shortText"].string ?? play["text"].string ?? typeText,
                                  digest: digest, payload: RawPlay(json: play, digest: digest))
        return (entry, Double(period) * 1e7 + sequence)
    }

    // MARK: Soccer

    /// A soccer entry. Located entries and every shot, goal and save are live;
    /// cards, substitutions, VAR and the half's admin are dead. The clock never
    /// stops but at the half.
    static func soccer(_ play: JSON, policy: BroadcastPolicy) -> TimelineEntry<RawPlay>? {
        guard let id = play["id"].string ?? play["id"].int.map(String.init) else { return nil }
        let period = play["period"]["number"].int ?? 0
        let type = play["type"]["type"].string ?? ""
        let value = play["clock"]["value"].double
        let located = (play["fieldPositionX"].double ?? 0) != 0 || (play["fieldPositionY"].double ?? 0) != 0
        let kind: PlayKind
        switch type {
        case "halftime":
            kind = PlayKind(.dead, "period end", endsPeriod: period)
        case "end-regular-time", "end-extra-time", "full-time", "end-of-game":
            kind = PlayKind(.dead, "game end", endsPeriod: period, endsGame: type != "end-regular-time" || policy.regulationPeriods <= period)
        case "substitution", "yellow-card", "red-card", "yellow-red-card", "start-2nd-half", "kickoff", "start-extra-time":
            kind = PlayKind(.dead, type.replacingOccurrences(of: "-", with: " "))
        default:
            if type.hasPrefix("var") || type == "deleted-after-review" {
                kind = PlayKind(.dead, "review")
            } else if located || type.hasPrefix("shot") || type.hasPrefix("goal") || play["scoringPlay"].bool == true || type == "save" {
                kind = PlayKind(.live, type.hasPrefix("shot") || type.hasPrefix("goal") || play["scoringPlay"].bool == true ? "shot" : "entry")
            } else {
                kind = PlayKind(.dead, "other")
            }
        }
        let digest = digest(play) { h in
            h.combine(play["fieldPositionX"].double)
            h.combine(play["fieldPositionY"].double)
            h.combine(play["fieldPosition2X"].double)
            h.combine(play["fieldPosition2Y"].double)
            h.combine(play["addedClock"].double)
        }
        return TimelineEntry(id: id, wallclock: EventTime.parse(play["wallclock"].string), period: period, progress: value ?? 0,
                             clock: GameClockReading(elapsed: value, display: play["clock"]["displayValue"].string),
                             kind: kind, score: score(play), text: play["shortText"].string ?? play["text"].string ?? "",
                             digest: digest, payload: RawPlay(json: play, digest: digest))
    }

    // MARK: Baseball

    /// Entries that are bookkeeping around a plate appearance, not something on the field.
    static let baseballAdmin: Set<String> = ["start-inning", "start-batterpitcher", "end-batterpitcher", "end-inning",
                                             "pitching-change", "mound-visit", "defensive-substitution", "offensive-substitution",
                                             "pinch-hitter", "pinch-runner", "defensive-switch", "umpire-review", "manager-challenge"]

    /// A baseball entry. Pitches and results are live; admin is dead. No game
    /// clock: progress is the half-inning, then the at-bat and pitch ordinal.
    static func baseball(_ play: JSON, ordinal: Int, policy: BroadcastPolicy) -> TimelineEntry<RawPlay>? {
        guard let id = play["id"].string else { return nil }
        let number = play["period"]["number"].int ?? 0
        let half = play["period"]["type"].string?.lowercased()
        // Half-innings as periods: Top 1 = 1, Bottom 1 = 2, …
        let period = max(number * 2 - (half == "top" ? 1 : 0), 0)
        let type = play["type"]["type"].string ?? ""
        let atBat = play["atBatId"].string.flatMap { Int($0.suffix(4)) } ?? 0
        let kind: PlayKind
        if type == "end-inning" {
            kind = PlayKind(.dead, "half-inning end", endsPeriod: period)
        } else if type == "end-game" || type == "game-end" {
            kind = PlayKind(.dead, "game end", endsPeriod: period, endsGame: true)
        } else if baseballAdmin.contains(type) || type.contains("substitution") || type.contains("visit") {
            kind = PlayKind(.dead, type.replacingOccurrences(of: "-", with: " "))
        } else if type == "play-result" {
            kind = PlayKind(.live, "result")
        } else {
            kind = PlayKind(.live, play["pitchCoordinate"].exists || play["summaryType"].string == "P" ? "pitch" : "event")
        }
        let digest = digest(play) { h in
            h.combine(play["pitchCoordinate"]["x"].double)
            h.combine(play["hitCoordinate"]["x"].double)
            h.combine(play["outs"].int)
            h.combine(play["summaryType"].string)
        }
        return TimelineEntry(id: id, wallclock: EventTime.parse(play["wallclock"].string), period: period,
                             progress: Double(atBat) * 1000 + Double(ordinal % 1000),
                             clock: .none, kind: kind, score: score(play), text: play["text"].string ?? play["type"]["text"].string ?? "",
                             digest: digest, payload: RawPlay(json: play, digest: digest))
    }

    /// MLB's live feed's times for ESPN's plays: each at-bat's pitches by
    /// number (ESPN's at-bat n is statsapi's `atBatIndex` n − 1). statsapi's
    /// `startTime` is the pitch's own moment, to the millisecond; ESPN's
    /// wallclock trails it by p50 1.1 s and by 8–20 s a quarter of the time
    /// (CHOREOGRAPHY §3.4). Returns the entries with those times.
    static func timed(_ entries: [TimelineEntry<RawPlay>], statsapi feed: JSON) -> [TimelineEntry<RawPlay>] {
        var pitchTimes: [Int: [PTime]] = [:]
        var resultTimes: [Int: PTime] = [:]
        for play in feed["liveData"]["plays"]["allPlays"].array {
            guard let index = play["atBatIndex"].int else { continue }
            var pitches: [PTime] = []
            for event in play["playEvents"].array where event["isPitch"].bool == true {
                if let t = EventTime.parse(event["startTime"].string) { pitches.append(t) }
            }
            pitchTimes[index + 1] = pitches
            if let t = EventTime.parse(play["about"]["endTime"].string ?? play["playEndTime"].string) { resultTimes[index + 1] = t }
        }
        guard !pitchTimes.isEmpty else { return entries }
        var pitchNumber: [Int: Int] = [:]
        return entries.map { entry in
            var e = entry
            let atBat = Int(entry.progress / 1000)
            if entry.kind.label == "pitch" {
                let n = pitchNumber[atBat, default: 0]
                pitchNumber[atBat] = n + 1
                if let times = pitchTimes[atBat], n < times.count {
                    e.wallclock = times[n]
                    e.reportedSource = .statsapi
                }
            } else if entry.kind.label == "result", let t = resultTimes[atBat] {
                e.wallclock = t
                e.reportedSource = .statsapi
            }
            return e
        }
    }

    // MARK: The fast lane

    /// A scoreboard event as a fast-lane reading (`previous`: the lane's last
    /// one, to tell a running clock from a stopped one).
    static func reading(_ event: Event, topIsHome: Bool, policy: BroadcastPolicy, previous: FastReading?, at now: PTime,
                        source: String = "scoreboard") -> FastReading? {
        guard case let .match(top, bottom) = event.content else { return nil }
        let state: FastReading.State
        switch event.state {
        case .scheduled: return nil
        case .final: state = .final
        case .live: state = isInterval(event.detail) ? .interval : .live
        }
        var score: ScoreLine?
        if let t = top.score.flatMap({ Int($0) }), let b = bottom.score.flatMap({ Int($0) }) {
            score = topIsHome ? ScoreLine(home: t, away: b) : ScoreLine(home: b, away: t)
        }
        let period = event.clock?.period
        let elapsed = event.clock.map { elapsedFromClock(seconds: $0.seconds, period: $0.period, policy: policy) }
        return FastReading(arrived: now, state: state, period: period, elapsed: elapsed,
                           running: running(elapsed: elapsed, period: period, previous: previous), score: score, source: source)
    }

    /// The core status endpoint as a reading (clock only: it has no score).
    static func reading(status: JSON, policy: BroadcastPolicy, previous: FastReading?, at now: PTime) -> FastReading? {
        let stateName = status["type"]["state"].string
        let detail = status["type"]["shortDetail"].string
        let state: FastReading.State
        switch stateName {
        case "post"?: state = .final
        case "in"?: state = isInterval(detail) ? .interval : .live
        default: return nil
        }
        let period = status["period"].int
        let elapsed = status["clock"].double.flatMap { seconds in period.map { elapsedFromClock(seconds: seconds, period: $0, policy: policy) } }
        return FastReading(arrived: now, state: state, period: period, elapsed: elapsed,
                           running: running(elapsed: elapsed, period: period, previous: previous), score: nil, source: "status")
    }

    /// A row of the recorder's `scores.jsonl` as a reading (the bench's fast lane).
    static func reading(row: JSON, policy: BroadcastPolicy, previous: FastReading?, at now: PTime) -> FastReading? {
        let state: FastReading.State
        switch row["state"].string {
        case "post"?: state = .final
        case "in"?: state = isInterval(row["clock"].string) ? .interval : .live
        default: return nil
        }
        var score: ScoreLine?
        if let home = row["score"]["home"].int, let away = row["score"]["away"].int { score = ScoreLine(home: home, away: away) }
        let period = row["period"].int
        let display = row["clock"].string ?? ""
        var elapsed: Double?
        if let period {
            if policy.clockCountsDown == true, let seconds = NBADetail.seconds(display) {
                elapsed = elapsedFromClock(seconds: seconds, period: period, policy: policy)
            } else if policy.clockCountsDown == false, let minute = Double(display.prefix { $0.isNumber }) {
                elapsed = minute * 60
            }
        }
        return FastReading(arrived: now, state: state, period: period, elapsed: elapsed,
                           running: running(elapsed: elapsed, period: period, previous: previous), score: score, source: "scoreboard")
    }

    /// "Halftime", "End of 3rd", "Mid 7th", "End 7th", "HT": between periods.
    static func isInterval(_ detail: String?) -> Bool {
        guard let d = detail?.lowercased() else { return false }
        return d.contains("halftime") || d.hasPrefix("end of") || d.hasPrefix("mid ") || d.hasPrefix("end ") || d == "ht"
            || d.contains("half-time")
    }

    static func elapsedFromClock(seconds: Double, period: Int, policy: BroadcastPolicy) -> Double {
        switch policy.clockCountsDown {
        case true?: let length = policy.length(of: period); return length > 0 ? max(length - seconds, 0) : seconds
        default: return seconds
        }
    }

    private static func running(elapsed: Double?, period: Int?, previous: FastReading?) -> Bool? {
        guard let elapsed, let previous, let was = previous.elapsed, previous.period == period else { return nil }
        return elapsed - was >= 0.5
    }
}
