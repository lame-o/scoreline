import AppKit
import SwiftUI

// The scores list, standings and polls as the panel widens: what each row
// shows at each width class, how the keyboard moves through the two-up grid,
// and how grouped tables and ranked lists split into columns. Pure functions,
// so the decisions are testable without views.

// MARK: - Row detail

/// How much an event row shows. The compact row is the base; each step adds
/// data that's useful but not essential, and a narrower panel takes it away
/// again in the reverse order.
///
/// From `.records` up the team block keeps its 340pt width, so the score
/// never drifts right as the panel widens: extra width only opens space
/// between the score and the status, and from `.lane` that space carries data.
enum RowDetail: Int, Comparable, Sendable {
    /// Today's row: teams, scores, status, one context line (340pt).
    case base
    /// Team records beside the names; the team block stops stretching.
    case records
    /// A detail lane between score and status: the live situation and the
    /// game's context each get a line (compact shows one or the other), and
    /// the row is a line shorter.
    case lane

    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

    static func of(_ width: WidthClass) -> RowDetail {
        switch width {
        case .compact: .base
        case .medium: .records
        case .large, .xlarge: .lane
        }
    }
}

extension Metrics {
    /// A wide row's team block: today's info column at 340, so the score sits
    /// where it always has and scores form one column down the list.
    static let teamBlockWidth: CGFloat = 230
}

/// Whether a team's record fits beside its name. The team block is a fixed
/// 230pt wherever records show, so the answer never depends on the panel's
/// live width: it's measured once, when the row's data changes, never per
/// layout pass (a `ViewThatFits` per name made a live resize 4× slower).
/// The record gives way before the name would truncate.
enum RecordFit {
    static func fits(name: String, bold: Bool, rank: Int?, marks: Int, record: String, score: String?,
                     block: CGFloat = Metrics.teamBlockWidth) -> Bool {
        func width(_ text: String, _ font: NSFont) -> CGFloat {
            ceil((text as NSString).size(withAttributes: [.font: font]).width)
        }
        // The competitor line: crest 16, then 8pt gaps between its parts.
        var used: CGFloat = 16 + 8
        if let rank { used += width("\(rank)", .monospacedDigitSystemFont(ofSize: 10.5, weight: .semibold)) + 4 }
        used += width(name, .systemFont(ofSize: 13, weight: bold ? .semibold : .regular))
        used += CGFloat(marks) * (8 + 10)                       // possession ball, follow star
        used += 8 + width(record, .monospacedDigitSystemFont(ofSize: 10.5, weight: .regular))
        used += 8                                               // the spacer's minimum
        if let score { used += width(score, .monospacedDigitSystemFont(ofSize: 13, weight: .semibold)) }
        return used <= block - 2
    }
}

/// What a row says besides teams, score and status.
enum RowText {
    /// The line under the teams (rows without a lane): live, the situation
    /// takes the caption's place and changes with each play.
    static func contextLine(_ event: Event) -> (text: String, situation: Bool)? {
        if event.state == .live, let line = nonEmpty(event.liveLine) { return (line, true) }
        return nonEmpty(event.caption).map { ($0, false) }
    }

    /// The detail lane's two lines. The first says what's happening or where
    /// to watch (secondary ink); the second places the game (tertiary ink).
    /// - Live: the situation (or the broadcaster), over the context (or the
    ///   broadcaster). Compact shows only one of situation and context.
    /// - Upcoming: the broadcaster, over the context (or the venue).
    /// - Final: the context.
    /// Field events (climbing) put their summary first and keep only the
    /// title in the team block. `broadcast` and `venue` come from the
    /// scoreboard when it provides them.
    static func lane(_ event: Event, broadcast: String? = nil, venue: String? = nil) -> (primary: String?, secondary: String?) {
        if case let .field(_, summary) = event.content { return (nonEmpty(summary), nonEmpty(event.caption)) }
        let caption = nonEmpty(event.caption), broadcast = nonEmpty(broadcast), venue = nonEmpty(venue)
        switch event.state {
        case .live:
            let situation = nonEmpty(event.liveLine)
            return (situation ?? broadcast, caption ?? (situation != nil ? broadcast : nil))
        case .scheduled:
            return (broadcast, caption ?? venue)
        case .final:
            return (nil, caption)
        }
    }

    /// A final that wasn't played to a result (postponed, canceled,
    /// suspended): no score, and none is owed. Any other final without one
    /// shows "–", not a blank.
    static func unplayed(_ event: Event) -> Bool {
        let detail = (event.detail ?? "").lowercased()
        return ["postpone", "cancel", "suspend", "abandon", "forfeit", "delay"].contains { detail.contains($0) }
    }

    /// A record in the app's one dash style: "7–1", "5–1–2" (sources send
    /// hyphens; team pages and schedules always showed en dashes).
    static func record(_ record: String) -> String {
        record.replacingOccurrences(of: "-", with: "–")
    }

    /// "5-1-2" (or "5–1–2") as VoiceOver should say it.
    static func spokenRecord(_ record: String, soccer: Bool) -> String {
        let parts = record.split(whereSeparator: { $0 == "-" || $0 == "–" }).map(String.init)
        guard parts.count >= 2, parts.allSatisfy({ Int($0) != nil }) else { return record }
        func count(_ n: String, _ one: String, _ many: String) -> String { "\(n) \(n == "1" ? one : many)" }
        if soccer, parts.count == 3 {
            return [count(parts[0], "win", "wins"), count(parts[1], "draw", "draws"), count(parts[2], "loss", "losses")]
                .joined(separator: ", ")
        }
        var spoken = [count(parts[0], "win", "wins"), count(parts[1], "loss", "losses")]
        if parts.count == 3 { spoken.append(count(parts[2], "tie", "ties")) }
        return spoken.joined(separator: ", ")
    }

    /// "W5" → "won 5 in a row".
    static func spokenStreak(_ streak: String) -> String {
        guard let first = streak.first, let n = Int(streak.dropFirst()) else { return "streak \(streak)" }
        switch first {
        case "W": return "won \(n) in a row"
        case "L": return "lost \(n) in a row"
        case "T": return "tied \(n) in a row"
        default: return "streak \(streak)"
        }
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }
}

// MARK: - Status column

/// What a row's status column needs, measured once per section from the
/// text itself (no preference passes): each line in its own font, plus what
/// sits beside the status (the live dot, a pin, a co-stream, YouTube live).
/// The section hands the widest to its rows through `\.statusColumnWidth`,
/// so every score in a section sits in one column.
enum RowStatus {
    private static let firstLine = NSFont.monospacedDigitSystemFont(ofSize: StatusColumn.fontSize, weight: .semibold)
    private static let secondLine = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .regular)

    static func measure(_ text: String, second: Bool = false) -> CGFloat {
        (text as NSString).size(withAttributes: [.font: second ? secondLine : firstLine]).width
    }

    /// Clamped to `StatusColumn.range`.
    static func clamp(_ width: CGFloat) -> CGFloat {
        min(max(width.rounded(.up), StatusColumn.range.lowerBound), StatusColumn.range.upperBound)
    }

    /// Room for the glyphs beside a status: pin 8.5pt, co-stream 13, YouTube 11 (each plus the 5pt gap).
    static func accessories(pinned: Bool, coStreaming: Bool, streaming: Bool) -> CGFloat {
        (pinned ? 9 + 5 : 0) + (coStreaming ? 13 + 5 : 0) + (streaming ? 14 + 5 : 0)
    }

    /// The scores list's rows (see `StatusView` in EventRow.swift).
    static func width(for events: [Event], now: Date = AppClock.now, accessories: (Event) -> CGFloat = { _ in 0 }) -> CGFloat {
        clamp(events.reduce(0) { widest, event in max(widest, width(of: event, now: now) + accessories(event)) })
    }

    static func width(of event: Event, now: Date = AppClock.now) -> CGFloat {
        switch event.state {
        case .live:
            return measure(event.clock?.display ?? event.detail ?? "Live") + 10
        case .final:
            return measure(event.detail ?? "Final")
        case .scheduled:
            if delayed(event, now: now) { return max(measure("Delayed"), measure(time(event.start), second: true)) }
            if event.start < now { return measure(event.competitors.isEmpty ? "Time TBA" : "Starting soon") }
            let soon = event.start.timeIntervalSince(now) < 3 * 3600
            let first = soon ? Countdown.text(to: event.start, from: now) ?? time(event.start) : time(event.start)
            let second = soon ? time(event.start) : When.day(event.start, now: now) ?? ""
            return max(measure(first), measure(second, second: true))
        }
    }

    /// Past its start and the source says it's delayed (rain, a late game
    /// before it): "Delayed" in orange, never "Starting soon" for hours.
    static func delayed(_ event: Event, now: Date = AppClock.now) -> Bool {
        event.state == .scheduled && event.detail == "Delayed" && event.start < now
    }

    static func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }
}

// MARK: - Keyboard in the scores grid

/// Arrow keys over the scores list. One column: ↑/↓ step through every row
/// in reading order. Two columns (split): ↑/↓ move a whole visual row within
/// a section, keeping the column where the next section has it; ←/→ move
/// within a visual row.
enum ScoresGrid {
    enum Move: Sendable { case up, down, left, right }

    /// The row to highlight next, or nil when the key does nothing here
    /// (←/→ in one column, an empty list) so it can pass on.
    static func next(from current: String?, move: Move, sections: [[String]], columns: Int) -> String? {
        let sections = sections.filter { !$0.isEmpty }
        guard let firstSection = sections.first, let lastSection = sections.last else { return nil }
        let columns = max(columns, 1)
        if columns == 1, move == .left || move == .right { return nil }
        guard let current, let s = sections.firstIndex(where: { $0.contains(current) }),
              let i = sections[s].firstIndex(of: current) else {
            // Nothing highlighted yet: forward keys start at the top, back keys at the bottom.
            return move == .down || move == .right ? firstSection.first : lastSection.last
        }
        if columns == 1 {
            let flat = sections.flatMap { $0 }
            let index = flat.firstIndex(of: current) ?? 0
            return flat[min(max(index + (move == .down ? 1 : -1), 0), flat.count - 1)]
        }
        let row = sections[s]
        let column = i % columns
        switch move {
        case .left:
            return column > 0 ? row[i - 1] : current
        case .right:
            return column < columns - 1 && i + 1 < row.count ? row[i + 1] : current
        case .down:
            if i + columns < row.count { return row[i + columns] }
            // The visual row below is in this section but shorter: its last cell.
            let nextRowStart = (i / columns + 1) * columns
            if nextRowStart < row.count { return row[row.count - 1] }
            guard s + 1 < sections.count else { return current }
            let below = sections[s + 1]
            return below[column < below.count ? column : 0]
        case .up:
            if i - columns >= 0 { return row[i - columns] }
            guard s > 0 else { return current }
            let above = sections[s - 1]
            let lastRowStart = (above.count - 1) / columns * columns
            let target = lastRowStart + column
            return above[target < above.count ? target : lastRowStart]
        }
    }

    /// When a section's rows reveal after an expand: crests lead, text follows
    /// 40ms later, a visual row at a time (`Motion.stagger` apart, capped at 4
    /// rows, so an expand settles in about 0.45s), the right column 20ms behind
    /// the left, so the cascade reads top to bottom.
    static func revealDelay(index: Int, columns: Int) -> Double {
        let columns = max(columns, 1)
        return 0.04 + Double(min(index / columns, 4)) * Motion.stagger + (index % columns > 0 ? 0.02 : 0)
    }
}

// MARK: - Grouped tables in two columns

/// A table's rows under one group title ("Eastern Conference", "SEC").
struct TableGroup<Row>: Identifiable {
    let title: String
    let rows: [Row]
    var id: String { title }

    /// Rows split by group, in first-appearance order; rows keep their order.
    static func make(_ rows: [Row], group: (Row) -> String?) -> [TableGroup<Row>] {
        var order: [String] = []
        var byGroup: [String: [Row]] = [:]
        for row in rows {
            let key = group(row) ?? ""
            if byGroup[key] == nil { order.append(key) }
            byGroup[key, default: []].append(row)
        }
        return order.map { TableGroup(title: $0, rows: byGroup[$0] ?? []) }
    }
}

enum GroupPlacement {
    /// Each group goes into whichever column has fewer rows so far (the left
    /// on a tie). Decided from row counts alone, never measured, so live
    /// re-ranking never moves a group; a group never splits; each column keeps
    /// the source's order.
    static func columns(for sizes: [Int], columns: Int = 2) -> [[Int]] {
        var placed = Array(repeating: [Int](), count: max(columns, 1))
        var rows = Array(repeating: 0, count: placed.count)
        for (index, size) in sizes.enumerated() {
            let target = rows.indices.min { rows[$0] != rows[$1] ? rows[$0] < rows[$1] : $0 < $1 } ?? 0
            placed[target].append(index)
            rows[target] += size
        }
        return placed
    }
}

// MARK: - Ranked lists down the columns

/// A ranked list read down each column, as in print: 1–13 on the left,
/// 14–25 on the right. One column is a plain stack, so crossing the split
/// keeps every row's identity.
struct ColumnFlow: Layout {
    var columns: Int
    /// Between rows.
    var spacing: CGFloat = 0
    /// Between columns.
    var gap: CGFloat = 0

    /// Rows per column: the left columns take the extra row.
    static func perColumn(count: Int, columns: Int) -> Int {
        let columns = max(columns, 1)
        return (count + columns - 1) / columns
    }

    static func frames(count: Int, width: CGFloat, columns: Int, spacing: CGFloat, gap: CGFloat,
                       height: (Int, CGFloat) -> CGFloat) -> (frames: [CGRect], height: CGFloat) {
        let columns = max(columns, 1)
        let per = max(perColumn(count: count, columns: columns), 1)
        let cell = (width - gap * CGFloat(columns - 1)) / CGFloat(columns)
        var frames = Array(repeating: CGRect.zero, count: count)
        var bottoms: [CGFloat?] = Array(repeating: nil, count: columns)
        for i in 0..<count {
            let c = min(i / per, columns - 1)
            let top = bottoms[c].map { $0 + spacing } ?? 0
            let h = height(i, cell)
            frames[i] = CGRect(x: CGFloat(c) * (cell + gap), y: top, width: cell, height: h)
            bottoms[c] = top + h
        }
        return (frames, bottoms.compactMap { $0 }.max() ?? 0)
    }

    private func layout(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], height: CGFloat) {
        Self.frames(count: subviews.count, width: width, columns: columns, spacing: spacing, gap: gap) { i, w in
            subviews[i].sizeThatFits(ProposedViewSize(width: w, height: nil)).height
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? Metrics.compactWidth
        return CGSize(width: width, height: layout(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (i, frame) in layout(width: bounds.width, subviews: subviews).frames.enumerated() {
            subviews[i].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), anchor: .topLeading,
                              proposal: ProposedViewSize(width: frame.width, height: frame.height))
        }
    }

    // No alignment guides of its own. Without these, a parent stack asking for
    // the layout's leading edge (any VStack does) makes SwiftUI place every
    // child and ask each one, all the way down (`TileGrid` measured it at a
    // quarter of building the board). Nothing aligns to a guide inside, so
    // the answer is the same: none.
    func explicitAlignment(of guide: HorizontalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }

    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }
}
