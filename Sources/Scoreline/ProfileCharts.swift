import SwiftUI

// The profile pages' charts. Each answers one question and earns its place:
// the game-log strip ("how has he been playing, and was last night normal?"),
// the soccer match strip (results with goals and assists, where counts of 0–2
// make bars meaningless), rank tracks ("where does this team sit in its
// league?") and the CS2 map pool. One series, one color (the team's); state
// is never color alone; hover is instant and reads out in the footer.

// MARK: - Game-log strip

struct GameLogStrip: View {
    let log: Profile.GameLog
    let tint: Color
    /// A game was clicked.
    var onOpen: (@MainActor (Profile.GameLog.Entry) -> Void)? = nil
    @State private var hovered: Int?

    struct Bar: Equatable {
        let x: CGFloat
        let width: CGFloat
        let height: CGFloat
        let played: Bool
        var mid: CGFloat { x + width / 2 }
    }

    static let plotHeight: CGFloat = 56

    /// Bars left to right in date order: up to 10pt wide with 2pt gaps (1pt
    /// past 40 games), heights against the largest value. A played zero is a
    /// 1pt sliver (played, nothing scored); a game not played is a stub.
    /// A season fills in from the left as it's played (bars up to 10pt, packed);
    /// a fixed window ("last 10", `spread`) spaces its bars evenly across the chart, up to 14pt each.
    static func layout(values: [Double?], width: CGFloat, height: CGFloat, ceiling: Double? = nil, spread: Bool = false) -> [Bar] {
        let n = values.count
        guard n > 0, width > 0 else { return [] }
        let gap: CGFloat = n > 40 ? 1 : 2
        let slot = spread ? width / CGFloat(n) : 0
        let barWidth = spread ? max(1, min(14, slot * 0.6)) : max(1, min(10, (width - gap * CGFloat(n - 1)) / CGFloat(n)))
        let top = max(values.compactMap { $0 }.max() ?? 0, ceiling ?? 0, 1)
        return values.enumerated().map { i, value in
            let x = spread ? CGFloat(i) * slot + (slot - barWidth) / 2 : CGFloat(i) * (barWidth + gap)
            guard let value else { return Bar(x: x, width: barWidth, height: 0, played: false) }
            let h = value <= 0 ? 1 : max(1, CGFloat(value / top) * height)
            return Bar(x: x, width: barWidth, height: h, played: true)
        }
    }

    private var key: String? { log.stripKey }
    /// bo3's "last 10 matches" is a fixed window, not a season in progress: its bars span the width.
    private var spread: Bool { key == "rating" }
    private var entries: [Profile.GameLog.Entry] { log.entries }
    private var values: [Double?] { entries.map { $0.played ? ($0.value(key ?? "") ?? 0) : nil } }
    private var mean: Double? {
        let played = values.compactMap { $0 }
        return played.isEmpty ? nil : played.reduce(0, +) / Double(played.count)
    }
    private var reference: Double? { log.reference ?? mean }
    private var label: String { log.columns.first { $0.key == key }?.label ?? log.stripLabel }

    var body: some View {
        let values = values
        let reference = reference
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { geo in
                let plotWidth = geo.size.width - 52
                let bars = Self.layout(values: values, width: plotWidth, height: Self.plotHeight - 6,
                                       ceiling: log.reference.map { $0 * 1.15 }, spread: spread)
                let top = max(values.compactMap { $0 }.max() ?? 0, (log.reference ?? 0) * 1.15, 1)
                Canvas { context, size in
                    let base = Self.plotHeight
                    // Baseline.
                    context.fill(Path(CGRect(x: 0, y: base - 0.5, width: plotWidth, height: 1)), with: .color(Viz.baseline))
                    for (i, bar) in bars.enumerated() {
                        let dim = hovered != nil && hovered != i
                        if !bar.played {
                            context.fill(Path(roundedRect: CGRect(x: bar.x, y: base - 3, width: bar.width, height: 3),
                                              cornerRadius: 1), with: .color(Viz.track))
                            continue
                        }
                        let rect = CGRect(x: bar.x, y: base - bar.height, width: bar.width, height: bar.height)
                        let zero = (values[i] ?? 0) <= 0
                        let color = tint.opacity((zero ? 0.45 : 1) * (dim ? Viz.receded : 1))
                        context.fill(Path(roundedRect: rect, cornerRadii: .init(topLeading: 2, topTrailing: 2)), with: .color(color))
                        // MLB: a ring on top for a game with a home run (shape, not color).
                        if let mark = log.markKey, (entries[i].value(mark) ?? 0) > 0 {
                            let r: CGFloat = min(3, bar.width / 2 + 1)
                            let ring = CGRect(x: bar.mid - r, y: rect.minY - 2 * r - 2, width: 2 * r, height: 2 * r)
                            context.stroke(Path(ellipseIn: ring), with: .color(.primary.opacity(dim ? 0.3 : 0.7)), lineWidth: 1.5)
                        }
                    }
                    // Reference: the mean of the bars shown (ESPN's season average lags), or a fixed one.
                    if let reference, reference > 0 {
                        let y = base - CGFloat(reference / top) * (base - 6)
                        var line = Path()
                        line.move(to: CGPoint(x: 0, y: y))
                        line.addLine(to: CGPoint(x: plotWidth, y: y))
                        context.stroke(line, with: .color(Viz.reference), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        let text = context.resolve(Text(log.referenceLabel ?? "avg \(Self.format(reference))")
                            .font(Viz.tick).foregroundStyle(.secondary))
                        context.draw(text, at: CGPoint(x: plotWidth + 6, y: y), anchor: .leading)
                    }
                    _ = size
                }
                .contentShape(Rectangle())
                .onContinuousHover { phase in
                    switch phase {
                    case let .active(location):
                        // Only a change of bar re-renders the strip.
                        let bar = Self.nearest(bars, to: location.x)
                        if bar != hovered { hovered = bar }
                    case .ended: hovered = nil
                    }
                }
                .onTapGesture { location in
                    guard let onOpen, let i = Self.nearest(bars, to: location.x), entries.indices.contains(i) else { return }
                    onOpen(entries[i])
                }
            }
            .frame(height: Self.plotHeight)
            monthTicks
            ChartFooter(readout: hovered.flatMap(readout)) {
                if let last = entries.last { footer(for: last) }
            }
        }
        .help(onOpen == nil ? "" : "Click a game to open it.")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        // A bar's click, for VoiceOver and the keyboard: the last five games.
        .accessibilityActions {
            if let onOpen {
                ForEach(entries.suffix(5).reversed()) { e in
                    Button("Open \(e.opponent?.name ?? "Game"), \(ProfileFormat.short(e.date))") { onOpen(e) }
                }
            }
        }
    }

    static func nearest(_ bars: [Bar], to x: CGFloat) -> Int? {
        guard let i = bars.indices.min(by: { abs(bars[$0].mid - x) < abs(bars[$1].mid - x) }),
              abs(bars[i].mid - x) <= max(6, bars[i].width / 2 + 2) else { return nil }
        return i
    }

    static func format(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
    }

    /// Month labels under the baseline when the strip spans more than one month.
    @ViewBuilder
    private var monthTicks: some View {
        let cal = Calendar.current
        let months = entries.enumerated().filter { i, e in
            i == 0 || cal.component(.month, from: e.date) != cal.component(.month, from: entries[i - 1].date)
        }
        if months.count > 1 {
            GeometryReader { geo in
                let bars = Self.layout(values: values, width: geo.size.width - 52, height: 1, spread: spread)
                // Labels need room: a month that starts within 30pt of the last label is skipped.
                let spaced = months.reduce(into: [(offset: Int, element: Profile.GameLog.Entry)]()) { kept, m in
                    guard bars.indices.contains(m.offset) else { return }
                    if let last = kept.last, bars[m.offset].x - bars[last.offset].x < 30 { return }
                    kept.append(m)
                }
                ForEach(spaced, id: \.element.id) { i, e in
                    if bars.indices.contains(i) {
                        Text(e.date.formatted(.dateTime.month(.abbreviated)))
                            .font(Viz.tick)
                            .foregroundStyle(.tertiary)
                            .fixedSize()
                            .position(x: bars[i].x + 12, y: 6)
                    }
                }
            }
            .frame(height: 13)
            .accessibilityHidden(true)
        }
    }

    private func readout(_ i: Int) -> (lead: String, detail: String)? {
        guard entries.indices.contains(i) else { return nil }
        let e = entries[i]
        let lead = e.played ? "\(e.stats[key ?? ""] ?? "0") \(label)" : "Didn't play"
        return (lead, Self.context(e))
    }

    private func footer(for e: Profile.GameLog.Entry) -> some View {
        (Text("Last: ").foregroundStyle(.tertiary)
            + Text("\(e.stats[key ?? ""] ?? "–") \(label)").fontWeight(.semibold)
            + Text("  \(Self.context(e))").foregroundStyle(.secondary))
            .font(.system(size: 10.5).monospacedDigit())
            .lineLimit(1)
            .padding(.top, 6)
    }

    /// "Sun, Oct 25 at SEA · L 3–20".
    static func context(_ e: Profile.GameLog.Entry) -> String {
        let opponent = e.opponent.map { "\(e.home ? "vs" : "at") \($0.abbreviation ?? $0.name)" }
        let result = [e.result, score(e)].compactMap { $0 }.joined(separator: " ")
        return [ProfileFormat.day(e.date) + (opponent.map { " \($0)" } ?? ""), result.isEmpty ? nil : result]
            .compactMap { $0 }.joined(separator: " · ")
    }

    static func score(_ e: Profile.GameLog.Entry) -> String? {
        guard let a = e.teamScore, let b = e.opponentScore else { return nil }
        return "\(a)–\(b)"
    }

    private var accessibilityText: String {
        let played = values.compactMap { $0 }
        guard let lo = played.min(), let hi = played.max() else { return "Game log: no games yet." }
        var text = "Game log: \(entries.count) games, \(label.lowercased()) from \(Self.format(lo)) to \(Self.format(hi))"
        if let mean { text += ", average \(Self.format(mean))" }
        if let last = entries.last { text += ". Last game: \(last.stats[key ?? ""] ?? "0") \(label.lowercased()), \(Self.context(last))." }
        return text
    }
}

// MARK: - Soccer match strip

/// One cell per match: the result letter, then a dot per goal (filled) and
/// per assist (ring). Goalkeepers: a filled dot for a clean sheet.
struct MatchStrip: View {
    let log: Profile.GameLog
    var onOpen: (@MainActor (Profile.GameLog.Entry) -> Void)? = nil
    @Environment(\.widthClass) private var widthClass
    @State private var hovered: String?

    private var shown: [Profile.GameLog.Entry] {
        let n = [WidthClass.compact: 12, .medium: 15, .large: 18, .xlarge: 22][widthClass] ?? 12
        return Array(log.entries.suffix(n))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 4) {
                ForEach(shown) { e in cell(e) }
            }
            ChartFooter(readout: hovered.flatMap { id in shown.first { $0.id == id } }.map(readout)) {
                HStack(spacing: 10) {
                    if log.stripKey == "cleanSheet" {
                        legend(filled: true, "Clean sheet")
                    } else {
                        legend(filled: true, "Goal")
                        legend(filled: false, "Assist")
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityActions {
            if let onOpen {
                ForEach(shown.suffix(5).reversed()) { e in
                    Button("Open \(e.opponent?.name ?? "Match"), \(ProfileFormat.short(e.date))") { onOpen(e) }
                }
            }
        }
    }

    private func cell(_ e: Profile.GameLog.Entry) -> some View {
        let primary = Int(e.value(log.stripKey ?? "") ?? 0)
        let secondary = Int(e.value(log.markKey ?? "") ?? 0)
        let dim = hovered != nil && hovered != e.id
        return Button { onOpen?(e) } label: {
            VStack(spacing: 4) {
                Text(e.result ?? "–")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(e.result == "D" ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                    .frame(width: 18, height: 18)
                    .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(Viz.track))
                VStack(spacing: 2) {
                    ForEach(0..<min(primary, 3), id: \.self) { _ in Circle().fill(Color.primary.opacity(0.75)).frame(width: 4, height: 4) }
                    ForEach(0..<min(secondary, 3 - min(primary, 3)), id: \.self) { _ in
                        Circle().strokeBorder(Color.primary.opacity(0.6), lineWidth: 1).frame(width: 4, height: 4)
                    }
                }
                .frame(height: 16, alignment: .top)
            }
            .opacity(dim ? Viz.receded : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 ? e.id : (hovered == e.id ? nil : hovered) }
    }

    private func legend(filled: Bool, _ text: String) -> some View {
        HStack(spacing: 4) {
            Group {
                if filled { Circle().fill(Color.primary.opacity(0.75)) } else { Circle().strokeBorder(Color.primary.opacity(0.6), lineWidth: 1) }
            }
            .frame(width: 5, height: 5)
            Text(text).font(Viz.legend).foregroundStyle(.secondary)
        }
        .padding(.top, 2)
    }

    private func readout(_ e: Profile.GameLog.Entry) -> (lead: String, detail: String) {
        let g = Int(e.value("totalGoals") ?? 0), a = Int(e.value("goalAssists") ?? 0)
        let lead = log.stripKey == "cleanSheet" ? ((e.value("cleanSheet") ?? 0) > 0 ? "Clean sheet" : "\(e.stats["goalsConceded"] ?? "0") conceded")
            : [g > 0 ? "\(g) \(g == 1 ? "goal" : "goals")" : nil, a > 0 ? "\(a) \(a == 1 ? "assist" : "assists")" : nil]
                .compactMap { $0 }.joined(separator: ", ").nilIfEmpty ?? "No goal involvement"
        return (lead, GameLogStrip.context(e))
    }

    private var accessibilityText: String {
        let results = shown.compactMap(\.result).joined(separator: " ")
        return "Last \(shown.count) matches: \(results)."
    }
}

// MARK: - Rank track

/// Where a team sits among the league on one stat: a dot on a 1…N track,
/// best on the left, with the value and the rank as text (never color alone).
struct RankTrack: View {
    let stat: Profile.TeamStat
    let field: Int
    let tint: Color

    static func position(rank: Int, of field: Int) -> CGFloat {
        guard field > 1 else { return 0 }
        return CGFloat(min(max(rank, 1), field) - 1) / CGFloat(field - 1)
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(stat.label)
                .font(.system(size: 11.5))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(stat.value)
                .font(.system(size: 11.5, weight: .medium).monospacedDigit())
                .frame(width: 44, alignment: .trailing)
            // One drawn leaf per row, not a layout container (a list of these
            // lays out once, never per track).
            Canvas { context, size in
                context.fill(Path(roundedRect: CGRect(x: 0, y: size.height / 2 - 2, width: size.width, height: 4), cornerRadius: 2),
                             with: .color(Viz.track))
                guard stat.rank != nil else { return }
                let x = Self.position(rank: stat.rank ?? field, of: field) * (size.width - 7)
                context.fill(Path(ellipseIn: CGRect(x: x, y: size.height / 2 - 3.5, width: 7, height: 7)), with: .color(tint))
            }
            .frame(width: 84, height: 12)
            Text(stat.rankText ?? "–")
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 38, alignment: .trailing)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(stat.label), \(stat.value)" + (stat.rank.map { ", \(Ordinal.string($0)) of \(field)" } ?? ""))
    }
}

// MARK: - CS2 map pool

/// Average bo3 rating per map, best first, as dots on a shared scale: the
/// ratings sit close together (6.8–7.7), so bars from zero would hide the
/// differences. The dashed line is his overall rating; the number of maps is
/// a label, never a second mark; small samples step back.
struct MapPoolBars: View {
    let maps: [Profile.MapStat]
    let tint: Color

    static func domain(_ maps: [Profile.MapStat]) -> ClosedRange<Double> {
        let lo = maps.map(\.rating).min() ?? 0, hi = maps.map(\.rating).max() ?? 1
        let pad = max(0.15, (hi - lo) * 0.15)
        return (lo - pad)...(hi + pad)
    }

    var body: some View {
        let domain = Self.domain(maps)
        let span = max(domain.upperBound - domain.lowerBound, 0.01)
        let overall = maps.isEmpty ? 0 : maps.reduce(0) { $0 + $1.rating * Double($1.maps) } / Double(max(1, maps.reduce(0) { $0 + $1.maps }))
        StackColumn(spacing: 5) {
            ForEach(maps) { m in
                HStack(spacing: 8) {
                    Text(m.name).font(.system(size: 11.5)).frame(width: 62, alignment: .leading).lineLimit(1)
                    // One drawn leaf per row (no GeometryReader per map).
                    Canvas { context, size in
                        let w = size.width - 7, mid = size.height / 2
                        context.fill(Path(roundedRect: CGRect(x: 0, y: mid - 1, width: size.width, height: 2), cornerRadius: 1),
                                     with: .color(Viz.track))
                        let line = CGFloat((overall - domain.lowerBound) / span) * w + 3
                        context.fill(Path(CGRect(x: line, y: mid - 6, width: 1, height: 12)), with: .color(Viz.reference))
                        let x = CGFloat((m.rating - domain.lowerBound) / span) * w
                        context.fill(Path(ellipseIn: CGRect(x: x, y: mid - 3.5, width: 7, height: 7)),
                                     with: .color(tint.opacity(m.maps < 10 ? 0.45 : 1)))
                    }
                    .frame(height: 14)
                    Text(String(format: "%.2f", m.rating))
                        .font(.system(size: 11, weight: .medium).monospacedDigit())
                        .frame(width: 32, alignment: .trailing)
                    Text("\(m.maps) maps")
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 56, alignment: .trailing)
                }
                .opacity(m.maps < 10 ? 0.6 : 1)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(m.name): rating \(String(format: "%.2f", m.rating)) over \(m.maps) maps")
            }
        }
    }
}
