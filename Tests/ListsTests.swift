import Foundation

// Lists and pages as the panel widens: what a scores row shows at each width
// class, the keyboard in the two-up grid, grouped tables and the Top 25 in
// two columns, and the conference table's column tiers. Checked without views.

extension ScorelineTests {
    static func lists() {
        print("\nLists and pages")
        rowDetail()
        gridKeyboard()
        columns()
        statusColumn()
        words()
    }

    private static func game(_ state: EventState, liveLine: String? = nil, caption: String? = nil) -> Event {
        Event(id: "g", content: .match(top: comp("a", "Arsenal"), bottom: comp("b", "Chelsea")), state: state, start: .now,
              detail: nil, caption: caption, link: nil, liveLine: liveLine)
    }

    // MARK: Rows

    private static func rowDetail() {
        check(RowDetail.of(.compact) == .base && RowDetail.of(.medium) == .records
              && RowDetail.of(.large) == .lane && RowDetail.of(.xlarge) == .lane,
              "rows: compact as today, records from medium, a detail lane from large")
        check([7, 9, 11, 14] == [WidthClass.compact, .medium, .large, .xlarge].map(CollapsedPreview.maxLogos(for:)),
              "collapsed previews show 7 / 9 / 11 / 14 crests")

        let live = game(.live, liveLine: "2nd & 7 at KC 34", caption: "Week 8")
        check(RowText.contextLine(live).map { $0.text == "2nd & 7 at KC 34" && $0.situation } == true,
              "compact: live, the situation takes the caption's place")
        check(RowText.contextLine(game(.live, caption: "Week 8")).map { $0.text == "Week 8" && !$0.situation } == true,
              "compact: live without a situation keeps the caption")
        check(RowText.contextLine(game(.scheduled, liveLine: "stale", caption: "")) == nil,
              "no context line from an empty caption, nor a situation outside a live game")

        let lane = RowText.lane(live)
        check(lane.primary == "2nd & 7 at KC 34" && lane.secondary == "Week 8", "lane: situation over context, both at once")
        check(RowText.lane(game(.live, liveLine: "End of Q2"), broadcast: "TNT") == ("End of Q2", "TNT"),
              "lane: live with no context names the broadcaster")
        check(RowText.lane(game(.live), broadcast: "TNT") == ("TNT", nil), "lane: live with nothing else to say: where to watch")
        check(RowText.lane(game(.scheduled), broadcast: "Peacock", venue: "Anfield") == ("Peacock", "Anfield"),
              "lane: upcoming, where to watch over the venue")
        check(RowText.lane(game(.scheduled, caption: "World Series · Game 3"), broadcast: "FOX", venue: "Tropicana Field")
              == ("FOX", "World Series · Game 3"), "lane: upcoming, the context outranks the venue")
        check(RowText.lane(game(.final, caption: "Final Four"), broadcast: "CBS", venue: "Arena") == (nil, "Final Four"),
              "lane: a final keeps only its context")
        let field = Event(id: "f", content: .field(title: "Lead Men", summary: "Winner J. Utelli"), state: .final, start: .now,
                          detail: nil, caption: "Santiago 2026", link: nil)
        check(RowText.lane(field) == ("Winner J. Utelli", "Santiago 2026"), "lane: a field event's summary moves into the lane")

        check(RecordFit.fits(name: "Timberwolves", bold: false, rank: nil, marks: 0, record: "2-0", score: "55")
              && RecordFit.fits(name: "Mississippi St", bold: true, rank: 12, marks: 1, record: "6-2", score: "24"),
              "records fit beside typical names in the 230pt team block")
        check(!RecordFit.fits(name: "Sociedade Esportiva Palmeiras", bold: false, rank: nil, marks: 0, record: "10-2-3", score: "1"),
              "a long name keeps its room: the record gives way first")
        check(RecordFit.fits(name: "Wolverhampton", bold: false, rank: nil, marks: 0, record: "10-2-3", score: "1")
              && !RecordFit.fits(name: "Wolverhampton", bold: false, rank: nil, marks: 0, record: "10-2-3", score: "1", block: 160),
              "whether a record fits depends on the block's width")
        check(RowText.spokenRecord("5-1-2", soccer: true) == "5 wins, 1 draw, 2 losses", "soccer records read wins, draws, losses")
        check(RowText.spokenRecord("5-2-1", soccer: false) == "5 wins, 2 losses, 1 tie"
              && RowText.spokenRecord("1-1", soccer: false) == "1 win, 1 loss", "other records read wins, losses (and ties)")
        check(RowText.spokenStreak("W5") == "won 5 in a row" && RowText.spokenStreak("L2") == "lost 2 in a row",
              "streaks are spoken in words")
    }

    // MARK: Keyboard

    private static func gridKeyboard() {
        // Three sections, two columns:  a b / c    d    e f / g h
        let sections = [["a", "b", "c"], ["d"], ["e", "f", "g", "h"]]
        func go(_ from: String?, _ move: ScoresGrid.Move, columns: Int = 2) -> String? {
            ScoresGrid.next(from: from, move: move, sections: sections, columns: columns)
        }
        check(go(nil, .down) == "a" && go(nil, .right) == "a" && go(nil, .up) == "h", "nothing highlighted: ↓ starts at the top, ↑ at the bottom")
        check(go("a", .right) == "b" && go("b", .right) == "b" && go("b", .left) == "a" && go("a", .left) == "a",
              "←/→ move within a visual row and stop at its ends")
        check(go("c", .right) == "c", "→ from a row's only cell stays put")
        check(go("a", .down) == "c" && go("b", .down) == "c", "↓ moves a visual row; a shorter row below takes its last cell")
        check(go("c", .down) == "d" && go("d", .down) == "e", "↓ crosses into the next section")
        check(go("f", .down) == "h" && go("h", .down) == "h", "↓ keeps the column, and stops at the end")
        check(go("e", .up) == "d" && go("f", .up) == "d", "↑ keeps the column if the section above has it, else column 0")
        check(go("d", .up) == "c" && go("h", .up) == "f" && go("a", .up) == "a", "↑ reaches the last row above, and stops at the top")
        check(go("c", .down, columns: 1) == "d" && go("a", .up, columns: 1) == "a", "one column: ↑/↓ step through every row in order")
        check(go("a", .left, columns: 1) == nil && go("a", .right, columns: 1) == nil, "one column: ←/→ pass on")
        check(ScoresGrid.next(from: "a", move: .down, sections: [["a"], [], ["b"]], columns: 2) == "b", "empty sections are skipped")
        check(ScoresGrid.next(from: "gone", move: .down, sections: sections, columns: 2) == "a", "a row that left the list starts over")
        check(ScoresGrid.next(from: nil, move: .down, sections: [[], []], columns: 2) == nil, "an empty list ignores the keys")

        let delays = (0..<4).map { ScoresGrid.revealDelay(index: $0, columns: 2) }
        check(abs(delays[0] - 0.04) < 1e-9 && abs(delays[1] - 0.06) < 1e-9 && abs(delays[2] - 0.08) < 1e-9 && abs(delays[3] - 0.10) < 1e-9,
              "expand stagger runs by visual row, the right column 20ms behind")
        check(abs(ScoresGrid.revealDelay(index: 3, columns: 1) - 0.16) < 1e-9
              && abs(ScoresGrid.revealDelay(index: 40, columns: 2) - 0.20) < 1e-9, "one column: 40ms a row; capped at 4 rows")
    }

    // MARK: Columns

    private static func columns() {
        let groups = TableGroup.make(["E1", "W1", "E2", "W2", "E3"]) { String($0.prefix(1)) }
        check(groups.map(\.title) == ["E", "W"] && groups[0].rows == ["E1", "E2", "E3"], "groups keep first-appearance order")
        check(GroupPlacement.columns(for: [15, 15]) == [[0], [1]], "two conferences sit side by side")
        check(GroupPlacement.columns(for: [14, 17, 16, 18, 10]) == [[0, 2, 4], [1, 3]],
              "each group goes to the column with fewer rows so far")
        check(GroupPlacement.columns(for: [8, 4, 4]) == [[0], [1, 2]] && GroupPlacement.columns(for: [5]) == [[0], []],
              "ties go left; a group never splits")

        let poll = ColumnFlow.frames(count: 25, width: 680, columns: 2, spacing: 2, gap: 28) { _, _ in 20 }
        check(ColumnFlow.perColumn(count: 25, columns: 2) == 13 && poll.frames[12].minX == 0 && poll.frames[13].minX == 354
              && poll.frames[13].minY == 0 && poll.frames[0].width == 326, "the Top 25 reads down: 1–13 left, 14–25 right")
        check(poll.height == 13 * 20 + 12 * 2, "the two-column poll is as tall as its left column")
        let one = ColumnFlow.frames(count: 3, width: 312, columns: 1, spacing: 2, gap: 28) { _, _ in 20 }
        check(one.frames[2] == CGRect(x: 0, y: 44, width: 312, height: 20) && one.height == 64, "one column is a plain stack")

        func row(_ id: String, streak: String? = "W2", details: [String: String] = [:]) -> StandingsRow {
            StandingsRow(id: id, group: "SEC", name: id, abbreviation: id, logo: nil, rank: 1, played: 0, wins: 0, draws: 0,
                         losses: 0, goalDifference: 0, goalsFor: 0, points: 0, overall: "7-1", conference: "4-1",
                         streak: streak, details: details)
        }
        let plain = [row("a")]
        let full = [row("a", details: ["homerecord": "4-0", "awayrecord": "3-1", "pointsfor": "268", "pointsagainst": "208"])]
        check(ConferenceTable.Columns.of(.compact, rows: full) == .init(), "conference table, compact: Conf and Overall only")
        check(ConferenceTable.Columns.of(.medium, rows: full) == .init(streak: true), "medium adds the streak")
        check(ConferenceTable.Columns.of(.large, rows: full) == .init(streak: true, homeAway: true), "large adds home and away")
        check(ConferenceTable.Columns.of(.xlarge, rows: full) == .init(streak: true, homeAway: true, points: true),
              "xlarge adds points for and against")
        check(ConferenceTable.Columns.of(.xlarge, rows: plain) == .init(streak: true)
              && ConferenceTable.Columns.of(.xlarge, rows: [row("a", streak: nil)]) == .init(),
              "columns without data stay hidden")
    }

    // MARK: Status column

    private static func statusColumn() {
        func at(_ state: EventState, start: Date = .now, detail: String? = nil, home: String? = nil, away: String? = nil) -> Event {
            Event(id: "s", content: .match(top: Competitor(id: "a", name: "A", abbreviation: "A", score: home, logo: nil, isWinner: false),
                                           bottom: Competitor(id: "b", name: "B", abbreviation: "B", score: away, logo: nil, isWinner: false)),
                  state: state, start: start, detail: detail, caption: nil, link: nil)
        }
        let short = [at(.final, detail: "FT"), at(.final, detail: "Final")]
        check(RowStatus.width(for: short) == StatusColumn.range.lowerBound, "short statuses keep the 70pt column")
        let ot = at(.live, detail: "Weather Delay")
        let wide = RowStatus.width(for: short + [ot])
        check(wide > StatusColumn.range.lowerBound && wide <= StatusColumn.range.upperBound,
              "one wide status widens the whole section's column (every score in one column)")
        check(RowStatus.width(for: [ot], accessories: { _ in RowStatus.accessories(pinned: true, coStreaming: false, streaming: false) }) > wide,
              "a pinned row's pin counts toward the column")
        check(RowStatus.width(for: [at(.live, detail: String(repeating: "Rain Delay ", count: 6))]) == StatusColumn.range.upperBound,
              "never wider than the cap: the names need the room")

        let late = at(.scheduled, start: Date.now.addingTimeInterval(-9000), detail: "Delayed")
        check(RowStatus.delayed(late) && !RowStatus.delayed(at(.scheduled, start: Date.now.addingTimeInterval(3600), detail: "Delayed"))
              && !RowStatus.delayed(at(.scheduled, start: Date.now.addingTimeInterval(-60))),
              "a delayed game says Delayed once it's past its start, never Starting soon for hours")

        check(RowText.unplayed(at(.final, detail: "Postponed")) && RowText.unplayed(at(.final, detail: "Suspended"))
              && !RowText.unplayed(at(.final, detail: "FT")), "a final without a score shows a dash unless it wasn't played")
    }

    // MARK: Words

    private static func words() {
        check(RowText.record("7-1") == "7–1" && RowText.record("5–1–2") == "5–1–2", "records use one dash style")
        check(RowText.spokenRecord("5–1–2", soccer: true) == "5 wins, 1 draw, 2 losses", "en-dash records still read in words")

        let cal = Calendar.current
        let noon = cal.date(bySettingHour: 12, minute: 0, second: 0, of: .now)!
        let yesterday = cal.date(byAdding: .day, value: -1, to: noon)!
        let lastWeek = cal.date(byAdding: .day, value: -9, to: noon)!
        check(When.day(yesterday, now: noon) == "Yesterday" && When.dayAndTime(yesterday, now: noon).hasPrefix("Yesterday ")
              && !When.dayAndTime(yesterday, now: noon).contains(","), "yesterday reads Yesterday 4:00 PM")
        check(When.dayAndTime(lastWeek, now: noon).contains(","), "an older date takes a comma before the time")

        check(PlayerPage.spokenHeight("6' 2\"") == "6 feet 2 inches" && PlayerPage.spokenHeight("6' 0\"") == "6 feet"
              && PlayerPage.spokenHeight("164 cm") == "164 cm", "heights read in feet and inches, not primes")
        check(StatSpeech.word("PTS") == "points" && StatSpeech.word("3PT") == "three-pointers" && StatSpeech.word("XYZ") == "xyz",
              "stat columns read as words")
        check(RosterRow.spoken("REB") == "rebounds" && RosterRow.spokenLine("1,474 yds · 9 TD") == "1,474 yards, 9 touchdowns",
              "roster columns and stat lines read as words")

        check(TileScore.Style.forSmall("112", "98") == .smallTight && TileScore.Style.forSmall("21", "17") == .small
              && TileScore.Style.forLarge("148", "150") == .largeTight && TileScore.Style.forLarge("2", "1") == .large,
              "three-digit scores tighten by digit count, whatever the sport")
        let blazers = Competitor(id: "por", name: "Trail Blazers", abbreviation: "POR", score: "148", logo: nil, isWinner: false)
        check(LargeName.fits(blazers, ball: false, followed: [], in: 120) && !LargeName.fits(blazers, ball: false, followed: ["por"], in: 76),
              "a large tile's name falls back to its abbreviation when it can't fit")
    }
}
