import AppKit
import SwiftUI

// MARK: - Team colors

extension Color {
    init?(hex: String?) {
        guard let hex, let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16),
              hex.count >= 6 else { return nil }
        self.init(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }
}

/// Two team colors that read clearly side by side, in light and dark mode.
struct TeamPalette {
    let top: Color
    let bottom: Color

    init(top: String?, bottom: String?, scheme: ColorScheme) {
        /// nil: no color given. `.neutral`: a color with no usable hue here
        /// (pure black on dark, pure white on light) — shown honestly as gray.
        enum Usable { case color(Color, NSColor), neutral }
        func usable(_ hex: String?) -> Usable? {
            guard let color = Color(hex: hex), let ns = NSColor(color).usingColorSpace(.sRGB) else { return nil }
            // Only lightness moves (see TeamTone), so each team keeps its own
            // hue and saturation and bars and markers stay legible.
            guard let toned = TeamTone.adjust(ns, scheme: scheme) else { return .neutral }
            return .color(Color(nsColor: toned), toned)
        }
        func resolve(_ u: Usable?, fallback: Color) -> (Color, NSColor?) {
            switch u {
            case let .color(c, ns)?: (c, ns)
            case .neutral?: (Viz.neutral, nil)
            case nil: (fallback, nil)
            }
        }
        let (topColor, topNS) = resolve(usable(top), fallback: .blue)
        var (bottomColor, bottomNS) = resolve(usable(bottom), fallback: .orange)
        // Two near-identical colors can't be told apart: the second goes neutral.
        if let t = topNS, let b = bottomNS {
            let distance = abs(t.redComponent - b.redComponent) + abs(t.greenComponent - b.greenComponent) + abs(t.blueComponent - b.blueComponent)
            if distance < 0.35 { bottomColor = Viz.neutral; bottomNS = nil }
        }
        self.top = topColor
        self.bottom = bottomColor
    }
}

// MARK: - Clearances

/// Room around a mark: a disk the layers beneath it leave empty, so the mark
/// stands clear of the lines and marks it sits on, in either appearance.
/// Charts clip these out of what's drawn under the mark. (Never erased with a
/// blend mode: an erase punches through the glass panel behind the chart.)
struct Clearance: Equatable {
    var center: CGPoint
    var radius: CGFloat

    init(_ center: CGPoint, radius: CGFloat) {
        self.center = center
        self.radius = radius
    }

    /// Around a mark drawn in `rect`, reaching `by` beyond its edge.
    init(around rect: CGRect, by inset: CGFloat = 1.5) {
        self.init(CGPoint(x: rect.midX, y: rect.midY), radius: rect.width / 2 + inset)
    }

    var rect: CGRect { CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2) }

    static func path(_ clearances: [Clearance]) -> Path {
        var path = Path()
        for c in clearances where c.radius > 0 { path.addEllipse(in: c.rect) }
        return path
    }

    /// Marks drawn in order: the rooms of the marks after `index` (drawn over
    /// it), which that mark leaves empty where it overlaps them.
    static func ahead(of index: Int, in rooms: [Clearance?]) -> [Clearance] {
        index + 1 < rooms.count ? rooms[(index + 1)...].compactMap { $0 }.filter { $0.radius > 0 } : []
    }
}

extension GraphicsContext {
    /// This context, drawing nothing inside the clearances (marks drawn later need the room).
    func clearing(_ clearances: [Clearance]) -> GraphicsContext {
        let holes = clearances.filter { $0.radius > 0 }
        guard !holes.isEmpty else { return self }
        var copy = self
        copy.clip(to: Clearance.path(holes), options: .inverse)
        return copy
    }

    /// Draws marks in order, each one clearing room for itself in the marks
    /// before it that it overlaps: two close marks stay two marks.
    func draw<Mark>(_ marks: [Mark], clearance: (Mark) -> Clearance?, _ draw: (Mark, GraphicsContext) -> Void) {
        let rooms = marks.map(clearance)
        for (index, mark) in marks.enumerated() {
            draw(mark, clearing(Clearance.ahead(of: index, in: rooms)))
        }
    }
}

/// The layer's bounds (generously) with the clearances cut out, even-odd.
private struct ClearanceMask: Shape {
    var clearances: [Clearance]

    func path(in rect: CGRect) -> Path {
        var path = Path(rect.insetBy(dx: -64, dy: -64))
        path.addPath(Clearance.path(clearances))
        return path
    }
}

/// One clearance around a mark that moves. Its center animates with whatever
/// animation moves the mark, so the room travels with it.
struct MovingClearance: Shape {
    var center: CGPoint
    var radius: CGFloat

    init(_ clearance: Clearance?) {
        center = clearance?.center ?? .zero
        radius = clearance?.radius ?? 0
    }

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(center.x, center.y) }
        set { center = CGPoint(x: newValue.first, y: newValue.second) }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path(rect.insetBy(dx: -64, dy: -64))
        if radius > 0 { path.addEllipse(in: Clearance(center, radius: radius).rect) }
        return path
    }
}

extension View {
    /// This layer, leaving the clearances empty for the marks drawn above it.
    func clearing(_ clearances: [Clearance]) -> some View {
        clipShape(ClearanceMask(clearances: clearances), style: FillStyle(eoFill: true))
    }

    /// Room for one mark that moves (the live ball, a climber's dot, a focused
    /// shot): the room glides with the mark, and arrives or goes with it at once.
    func clearing(moving clearance: Clearance?) -> some View {
        mask {
            MovingClearance(clearance)
                .fill(style: FillStyle(eoFill: true))
                .transaction(value: clearance == nil) { $0.animation = nil }
        }
    }
}

// MARK: - Reading the focus small

/// Reads the page's focus in a small subview, so a hover re-runs only what it
/// changes (a highlight, an overlay, a footer), never a whole chart and its
/// Canvas, which redraw only when their data does.
struct FocusReader<Content: View>: View {
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @ViewBuilder let content: (Focus?) -> Content

    var body: some View { content(linked?.focus) }
}

extension View {
    /// Steps back (to `Viz.receded`, or hides at 0) while the focus is on
    /// something `when` says it isn't, reading the focus here, not in the chart.
    func recedes(to opacity: Double = Viz.receded, when receding: @escaping (Focus) -> Bool) -> some View {
        modifier(FocusRecede(opacity: opacity, receding: receding))
    }

    /// Room for a focused mark that moves with it (see `clearing(moving:)`),
    /// reading the focus here.
    func clearing(focused room: @escaping (Focus?) -> Clearance?) -> some View {
        modifier(FocusClearance(room: room))
    }

    /// Rooms that follow the focus without moving (pitches in the strike
    /// zone): a clip read here, so the layer itself never redraws on a hover.
    func clearing(focusedRooms rooms: @escaping (Focus?) -> [Clearance]) -> some View {
        FocusReader { focus in self.clearing(rooms(focus)) }
    }
}

private struct FocusRecede: ViewModifier {
    let opacity: Double
    let receding: (Focus) -> Bool
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    func body(content: Content) -> some View {
        content.opacity(linked?.focus.map(receding) == true ? opacity : 1)
    }
}

private struct FocusClearance: ViewModifier {
    let room: (Focus?) -> Clearance?
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    func body(content: Content) -> some View {
        content.clearing(moving: room(linked?.focus))
    }
}

// MARK: - Spoken team names

/// The two teams' full names, for what VoiceOver says about a chart. Charts
/// draw short names ("ARS", "CHE"), which VoiceOver reads as words ("arse");
/// the match page puts the full names here and every chart's spoken text uses them.
struct SpokenTeams: Equatable {
    var top: String
    var bottom: String
}

private struct SpokenTeamsKey: EnvironmentKey {
    static let defaultValue: SpokenTeams? = nil
}

extension EnvironmentValues {
    var spokenTeams: SpokenTeams? {
        get { self[SpokenTeamsKey.self] }
        set { self[SpokenTeamsKey.self] = newValue }
    }
}

// MARK: - Section chrome

/// A titled block on the match page: title, optional state (Live / Final) and
/// a one-line caption saying what the block shows and where it comes from.
/// The title is a heading (VoiceOver's rotor finds it, "Timeline, Live");
/// `spokenCaption` is the caption in words, when the visible one leans on
/// glyphs or short names ("ARS attacks →" is read "Arsenal attacking left to right").
struct DetailSection<Content: View>: View {
    let title: String
    var caption: String? = nil
    var accessory: SectionAccessory? = nil
    var spokenCaption: String? = nil
    @ViewBuilder let content: Content

    var body: some View {
        // The title block and the content are separate entrance units; content
        // that is itself a StackColumn (tables, lists) cascades row by row.
        StackColumn(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                SectionTitle(title, accessory: accessory)
                if let caption {
                    Text(caption)
                        .font(Viz.note)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        // A spanning section's caption still reads as one comfortable line.
                        .readableWidth()
                        .accessibilityLabel(spokenCaption ?? caption)
                }
            }
            content
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 16)
        .containerValue(\.stacksOwnRows, true)
    }
}

// MARK: - Comparison bars

/// Team stats as split bars: the leader's side in full team color, the other
/// side faded; a zero draws nothing. From xlarge, two columns filled row by
/// row in ESPN's order, so twice as many comparisons fit on screen and each
/// bar stays the length it was designed at.
struct StatBars: View {
    let stats: [GameDetail.Stat]
    let palette: TeamPalette
    @Environment(\.widthClass) private var widthClass
    @Environment(\.spokenTeams) private var teams

    private static let rowSpacing: CGFloat = 10
    private static let columnSpacing: CGFloat = 24

    var body: some View {
        let columns = widthClass >= .xlarge ? 2 : 1
        // The grid has one spacing; each cell gives up half the extra column
        // gap, and the grid reaches out by the same amount, so the bars stay
        // flush with the gutters and 24pt apart. The same rows in one column
        // or two, so stepping across xlarge never rebuilds one.
        let inset = columns == 2 ? (Self.columnSpacing - Self.rowSpacing) / 2 : 0
        StackContainer(layout: AnyLayout(RowGrid(columns: columns, spacing: Self.rowSpacing))) {
            ForEach(stats) { stat in
                row(stat).padding(.horizontal, inset)
            }
        }
        .padding(.horizontal, -inset)
    }

    private func row(_ stat: GameDetail.Stat) -> some View {
        let topLeads = stat.topShare > 0.5, bottomLeads = stat.topShare < 0.5
        return VStack(spacing: 4) {
            HStack {
                Text(stat.top)
                    .fontWeight(topLeads ? .semibold : .regular)
                    .foregroundStyle(topLeads ? .primary : .secondary)
                Spacer()
                Text(stat.label).foregroundStyle(.secondary)
                Spacer()
                Text(stat.bottom)
                    .fontWeight(bottomLeads ? .semibold : .regular)
                    .foregroundStyle(bottomLeads ? .primary : .secondary)
            }
            .font(.system(size: 11).monospacedDigit())
            SplitBar(share: stat.topShare, palette: palette,
                     topZero: Double(stat.top.prefix { $0.isNumber || $0 == "." }) == 0,
                     bottomZero: Double(stat.bottom.prefix { $0.isNumber || $0 == "." }) == 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spoken(stat, top: teams?.top ?? "Top", bottom: teams?.bottom ?? "Bottom"))
    }

    /// "Possession: Arsenal 58%, Chelsea 42%. Arsenal leads." (pure; tested)
    static func spoken(_ stat: GameDetail.Stat, top: String, bottom: String) -> String {
        let leader = stat.topShare > 0.5 ? top : stat.topShare < 0.5 ? bottom : nil
        return "\(stat.label): \(top) \(stat.top), \(bottom) \(stat.bottom)." + (leader.map { " \($0) leads." } ?? "")
    }
}

/// Two bars meeting at the share: each a shape, so the share animates without
/// a GeometryReader per stat row (a layout container in every row of a list).
struct SplitBar: View {
    let share: Double
    let palette: TeamPalette
    var height: CGFloat = 4
    var topZero = false
    var bottomZero = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let gap: CGFloat = topZero || bottomZero ? 0 : 2
        let tie = abs(share - 0.5) < 0.001
        ZStack {
            if topZero && bottomZero {
                Capsule().fill(Viz.track)
            } else {
                if !topZero {
                    SplitSegment(share: bottomZero ? 1 : share, leading: true, gap: gap)
                        .fill(palette.top.opacity(tie ? 0.75 : share > 0.5 ? 1 : 0.40))
                }
                if !bottomZero {
                    SplitSegment(share: topZero ? 0 : share, leading: false, gap: gap)
                        .fill(palette.bottom.opacity(tie ? 0.75 : share < 0.5 ? 1 : 0.40))
                }
            }
        }
        .frame(height: height)
        .animation(reduceMotion ? nil : Motion.standard, value: share)
    }
}

/// One side of a split bar: the leading side runs `share` of the width (less
/// the gap), the trailing side the rest; the outer ends are rounded.
private struct SplitSegment: Shape {
    var share: Double
    let leading: Bool
    let gap: CGFloat

    var animatableData: Double {
        get { share }
        set { share = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let room = max(rect.width - gap, 0)
        let width = room * (leading ? share : 1 - share)
        guard width > 0 else { return Path() }
        let r = rect.height / 2
        let frame = CGRect(x: leading ? rect.minX : rect.maxX - width, y: rect.minY, width: width, height: rect.height)
        return UnevenRoundedRectangle(topLeadingRadius: leading ? r : 0, bottomLeadingRadius: leading ? r : 0,
                                      bottomTrailingRadius: leading ? 0 : r, topTrailingRadius: leading ? 0 : r,
                                      style: .continuous).path(in: frame)
    }
}

/// ESPN's win probability: one bar, a 50% tick, and the draw (soccer) as its
/// own neutral segment instead of being folded into either side.
struct WinProbability: View {
    let topShare: Double
    var draw: Double? = nil
    let topName: String
    let bottomName: String
    let palette: TeamPalette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.spokenTeams) private var teams

    private var bottomShare: Double { max(1 - topShare - (draw ?? 0), 0) }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                label(palette.top, "\(topName) \(percent(topShare))")
                Spacer()
                if let draw {
                    label(Viz.neutral, "Draw \(percent(draw))")
                    Spacer()
                }
                label(palette.bottom, "\(percent(bottomShare)) \(bottomName)", trailing: true)
            }
            .font(.system(size: 11, weight: .medium).monospacedDigit())
            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .topLeading) {
                    HStack(spacing: 2) {
                        Capsule().fill(palette.top).frame(width: max((w - 4) * topShare, 0))
                        if let draw { Capsule().fill(Viz.neutral).frame(width: max((w - 4) * draw, 0)) }
                        Capsule().fill(palette.bottom)
                    }
                    .frame(height: 6)
                    .offset(y: 2)
                    Rectangle().fill(Viz.reference).frame(width: 1, height: 10).offset(x: w / 2)
                }
            }
            .frame(height: 10)
            .animation(reduceMotion ? nil : Motion.standard, value: topShare)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Win probability from ESPN: \(teams?.top ?? topName) \(percent(topShare))"
                            + (draw.map { ", draw \(percent($0))" } ?? "") + ", \(teams?.bottom ?? bottomName) \(percent(bottomShare)).")
    }

    private func percent(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }

    private func label(_ color: Color, _ text: String, trailing: Bool = false) -> some View {
        HStack(spacing: 4) {
            if !trailing { Circle().fill(color).frame(width: 6, height: 6) }
            Text(text)
            if trailing { Circle().fill(color).frame(width: 6, height: 6) }
        }
    }
}

// MARK: - Linescore

/// Runs (or points) per period, then the totals. When every period fits, one
/// grid; when they don't (extra innings, college overtimes), the periods
/// scroll between the team names and the totals, which stay put, and the
/// scroll starts at the latest period, where the game is.
struct LinescoreGrid: View {
    let linescore: GameDetail.Linescore
    let topName: String
    let bottomName: String
    /// Columns at the end rendered bold (totals).
    let totals: Int
    let palette: TeamPalette
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(\.spokenTeams) private var teams

    private static let help: [String: String] = ["R": "Runs", "H": "Hits", "E": "Errors", "T": "Total", "OT": "Overtime"]

    /// Where the totals begin.
    private var split: Int { max(linescore.headers.count - totals, 0) }
    /// Whether the periods scroll: decided from the grid's natural width
    /// (measured once per linescore) against the room it has, and written
    /// only when that answer changes. No trial layouts on a hover.
    @State private var scrolls = false

    var body: some View {
        let natural = Self.naturalWidth(linescore, totals: totals, names: (topName, bottomName))
        Group {
            if scrolls {
                // Periods scroll; names and totals hold.
                HStack(alignment: .top, spacing: 0) {
                    grid(columns: 0..<0, names: true)
                    PeriodScroller { grid(columns: 0..<split, names: false) }
                    grid(columns: split..<linescore.headers.count, names: false)
                }
            } else {
                // Everything in one grid, spread across the section as it always has been.
                grid(columns: 0..<linescore.headers.count, names: true, fixed: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: Bool.self) { proxy in natural > proxy.size.width } action: { scrolls = $0 }
        .font(.system(size: 11.5).monospacedDigit())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spoken(linescore, totals: totals, top: teams?.top ?? topName, bottom: teams?.bottom ?? bottomName))
    }

    /// The grid for some of the columns, with the team names first if asked.
    /// Every part has the same rows, so their baselines line up side by side.
    private func grid(columns: Range<Int>, names: Bool, fixed: Bool = true) -> some View {
        Grid(alignment: .trailing, horizontalSpacing: 0, verticalSpacing: 5) {
            GridRow {
                if names { Text("").gridColumnAlignment(.leading) }
                ForEach(columns, id: \.self) { index in
                    let header = linescore.headers[index]
                    cell(header, bold: false, totalsStart: index == split && totals > 0)
                        // "OT", "2OT", "3OT" are wider than a number: room between
                        // them, so they never run together ("OT2OT3OT").
                        .padding(.leading, index < split && Int(header) == nil ? 5 : 0)
                        .foregroundStyle(.secondary)
                        .help(Self.help[header] ?? (Int(header).map { "Period \($0)" } ?? header))
                }
            }
            .font(.system(size: 9.5, weight: .medium))
            Divider()
            row(names ? topName : nil, linescore.top, columns: columns, color: palette.top, side: .top)
            row(names ? bottomName : nil, linescore.bottom, columns: columns, color: palette.bottom, side: .bottom)
        }
        // The scrolling layout's parts keep their natural width side by side.
        .fixedSize(horizontal: fixed, vertical: fixed)
    }

    /// Each period's cell is a hover target; it lights up with the scoring
    /// plays (and batted balls) from that period.
    private func row(_ name: String?, _ values: [String], columns: Range<Int>, color: Color, side: GameDetail.Side) -> some View {
        GridRow {
            if let name {
                HStack(spacing: 5) {
                    Circle().fill(color).frame(width: 6, height: 6)
                    Text(name).fontWeight(.medium).lineLimit(1)
                }
                .frame(minWidth: 44, alignment: .leading)
            }
            ForEach(columns, id: \.self) { i in
                let v = values.indices.contains(i) ? values[i] : ""
                let isTotal = i >= split
                // The cell reads the focus itself: a hover re-runs one cell, not the grid.
                FocusReader { focus in
                    let lit = !isTotal && focus?.period == i + 1 && (focus?.side == nil || focus?.side == side)
                    cell(v, bold: isTotal || lit, totalsStart: i == split && totals > 0)
                        .background(RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(Color.primary.opacity(lit ? 0.09 : 0))
                            .padding(.leading, 3).padding(.trailing, -3).padding(.vertical, -2))
                }
                    .contentShape(Rectangle())
                    .onHover { inside in
                        guard !isTotal else { return }
                        linked?.hover(Focus(period: i + 1, side: side), inside)
                    }
            }
        }
    }

    private func cell(_ text: String, bold: Bool, totalsStart: Bool) -> some View {
        HStack(spacing: 0) {
            if totalsStart { Rectangle().fill(Viz.grid).frame(width: 0.5, height: 14).padding(.trailing, 3) }
            Text(text)
                .fontWeight(bold ? .semibold : .regular)
                .lineLimit(1)
                .frame(minWidth: 20, alignment: .trailing)
                .contentTransition(.numericText())
        }
    }

    /// The single grid's natural width, a few points generous: the names
    /// column, then each column as wide as its widest text (20pt at least;
    /// an overtime header with its 5pt lead), and the totals' rule. (pure; tested)
    static func naturalWidth(_ line: GameDetail.Linescore, totals: Int, names: (String, String)) -> CGFloat {
        func width(_ text: String, _ font: NSFont) -> CGFloat { (text as NSString).size(withAttributes: [.font: font]).width }
        let header = NSFont.systemFont(ofSize: 9.5, weight: .medium)
        let value = NSFont.monospacedDigitSystemFont(ofSize: 11.5, weight: .semibold)
        let name = NSFont.systemFont(ofSize: 11.5, weight: .medium)
        let split = max(line.headers.count - totals, 0)
        var total = max(44, 11 + max(width(names.0, name), width(names.1, name)))
        for (index, h) in line.headers.enumerated() {
            // As the cells are built: at least 20pt, then an overtime header's 5pt lead.
            var column = max(20, width(h, header)) + (index < split && Int(h) == nil ? 5 : 0)
            for row in [line.top, line.bottom] where row.indices.contains(index) { column = max(column, max(20, width(row[index], value))) }
            total += column + (index == split && totals > 0 ? 3.5 : 0)
        }
        return total.rounded(.up) + 8
    }

    /// The periods, scrolling sideways from the latest. An edge with more
    /// periods past it fades, so a cut-off column reads as "more this way",
    /// never as a number. The fade changes only as an edge is reached or left.
    private struct PeriodScroller<Content: View>: View {
        @ViewBuilder let content: Content
        @State private var more = More()

        struct More: Equatable {
            var leading = false
            var trailing = false
        }

        var body: some View {
            ScrollView(.horizontal) { content }
                .defaultScrollAnchor(.trailing)
                .fixedSize(horizontal: false, vertical: true)
                .onScrollGeometryChange(for: More.self) { geo in
                    More(leading: geo.contentOffset.x > 1,
                         trailing: geo.contentOffset.x + geo.containerSize.width < geo.contentSize.width - 1)
                } action: { _, now in more = now }
                .mask {
                    HStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing)
                            .frame(width: more.leading ? 18 : 0)
                        Rectangle()
                        LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: more.trailing ? 18 : 0)
                    }
                }
        }
    }

    /// "Yankees: 5 runs, 9 hits, 1 error. By inning: 0, 2, 0, 1." / "Chiefs:
    /// 27 points. By quarter: 7, 3, 10, 7." Totals first: that's the question. (pure; tested)
    static func spoken(_ line: GameDetail.Linescore, totals: Int, top: String, bottom: String) -> String {
        let split = max(line.headers.count - totals, 0)
        let innings = line.headers.contains("R")
        func side(_ name: String, _ values: [String]) -> String {
            let sums = zip(line.headers.suffix(from: split), values.suffix(from: min(split, values.count))).map { header, value -> String in
                let n = Int(value) ?? 0
                switch header {
                case "R": return plural(n, "run")
                case "H": return plural(n, "hit")
                case "E": return plural(n, "error")
                default: return plural(n, "point")
                }
            }
            let periods = zip(line.headers.prefix(split), values.prefix(split)).compactMap { header, value -> String? in
                guard !value.isEmpty else { return nil }
                if Int(header) != nil { return value }
                // "OT", "2OT": named, so the overtimes don't read as more quarters.
                let extra = header == "OT" ? "overtime" : header.hasSuffix("OT") ? "overtime \(header.dropLast(2))" : header
                return "\(extra) \(value)"
            }
            return "\(name): \(sums.joined(separator: ", "))."
                + (periods.isEmpty ? "" : " By \(innings ? "inning" : "period"): \(periods.joined(separator: ", ")).")
        }
        return side(top, line.top) + " " + side(bottom, line.bottom)
    }
}

// MARK: - Football field

/// Top-down field: the top (away) team defends the left end zone. The current
/// drive is drawn snap by snap, each play a bar from where it started to where
/// it ended, newest at the bottom, over the line of scrimmage, line to gain and
/// red zone; the ball travels as the drive moves. Plays link to the drive list.
struct FootballField: View {
    let situation: GameDetail.Football
    let topLabel: String
    let bottomLabel: String
    let palette: TeamPalette
    /// The drive in progress, oldest first.
    var drive: [DrivePlay] = []
    /// Who has the ball now; names the drive (a kickoff is the other team's play).
    var possession: GameDetail.Side? = nil
    /// Late and one score down with the ball: the 2-MIN DRILL chip.
    var twoMinuteDrill = false
    /// False when the play theater above it owns the moment's burst
    /// (`FootballCelebration`); the marks still play.
    var celebrates = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass
    @Environment(\.panelResizing) private var resizing
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    /// Bumped by each pass or kick moment; the ball hops once per bump.
    @State private var hops = 0
    @State private var hopPeak: CGFloat = 8
    /// Each bumped when its mark should play (after the ball's own motion lands).
    @State private var turnoverKnocks = 0
    @State private var sackKnocks = 0
    @State private var bigPlayGlints = 0
    @State private var uprightFlashes = 0
    @State private var redZoneBreaths = 0
    /// The last kick at the uprights: whose, and whether it was good.
    @State private var kick: (side: GameDetail.Side, good: Bool)?
    /// The play whose bar glints (a big play).
    @State private var glintPlay: String?

    private static let rowHeight: CGFloat = 8

    /// What just happened on the field, while it's news.
    private var moment: LiveMoment? { momentFor(.field, in: moments) }
    /// The moment's play, from the drive on the field.
    private var momentPlay: DrivePlay? { moment.flatMap { m in drive.first { $0.id == m.id } } }

    /// Where the ball is drawn: after a score it stays where the score happened
    /// for the moment's hold, then goes back to the spot.
    private var ballX: Double {
        if let moment, let play = momentPlay, moment.kind == .touchdown || moment.kind == .fieldGoal {
            return moment.kind == .fieldGoal ? (play.side == .bottom ? 0 : 100) : play.endX
        }
        return situation.ballX
    }
    private static let maxRows = 6
    /// The team with the ball: the live lane's view, else the situation's.
    private var ballSide: GameDetail.Side? { possession ?? situation.possession }

    /// Snaps on the field; kickoffs and punts stay in the list only.
    private var rows: [DrivePlay] { Array(drive.filter { $0.kind != .kick }.suffix(Self.maxRows)) }
    /// Room for the drive's rows plus one more: the ball waits on the next snap's row.
    private var fieldHeight: CGFloat { max(56, 12 + CGFloat(rows.count + 1) * Self.rowHeight + 6) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                // Who has the ball, first: the thing a glance is for.
                if let side = ballSide {
                    let team = side == .top ? topLabel : bottomLabel
                    HStack(spacing: 4) {
                        Circle().fill(side == .top ? palette.top : palette.bottom).frame(width: 7, height: 7)
                        // Last to give way: at 340 with both chips, the dot and team say it.
                        ViewThatFits(in: .horizontal) {
                            Text("\(team) ball").fixedSize()
                            Text(team).fixedSize()
                        }
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .layoutPriority(3)
                    .transition(.opacity)
                    .id(side)
                    if situation.downDistance != nil { Text("·").foregroundStyle(.secondary).fixedSize() }
                }
                if let dd = situation.downDistance {
                    // In a crowded row (both chips at 340) the spot goes first: the field shows it.
                    ViewThatFits(in: .horizontal) {
                        Text(dd).fixedSize()
                        Text(dd.components(separatedBy: " at ").first ?? dd).fixedSize()
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .contentTransition(.numericText())
                    // Keeps its spot before the chips keep their long form.
                    .layoutPriority(2)
                }
                if situation.redZone || twoMinuteDrill {
                    // Both chips when they fit; at 340 with a long spot, the drill shortens.
                    ViewThatFits(in: .horizontal) {
                        stateChips(drill: "2-MIN DRILL")
                        stateChips(drill: "2 MIN")
                    }
                    // Offered what the (fixed) texts and timeouts leave, before the spacer.
                    .layoutPriority(1)
                    .transition(Motion.chip(reduceMotion: reduceMotion))
                }
                Spacer(minLength: 4)
                timeouts(situation.topTimeouts, color: palette.top, team: topLabel)
                timeouts(situation.bottomTimeouts, color: palette.bottom, team: bottomLabel)
            }
            .animation(reduceMotion ? nil : Motion.quick, value: situation.redZone)
            .animation(reduceMotion ? nil : Motion.quick, value: twoMinuteDrill)
            VStack(spacing: 4) {
                GeometryReader { geo in
                    let ez = geo.size.width * 0.08
                    let field = geo.size.width - ez * 2
                    let x = { (yard: Double) -> CGFloat in ez + field * yard / 100 }
                    let ballY = rows.isEmpty ? geo.size.height / 2 : 10 + CGFloat(rows.count) * Self.rowHeight
                    ZStack(alignment: .topLeading) {
                        fieldLayers(size: geo.size, x: x, ballY: ballY)
                            // Room around the ball: the line of scrimmage and the drive's bars
                            // stop short of it. It travels and hops with the ball (a knock's
                            // 3 pt shake stays inside it).
                            .mask {
                                MovingClearance(Clearance(CGPoint(x: x(ballX), y: ballY), radius: 8))
                                    .fill(style: FillStyle(eoFill: true))
                                    .modifier(BallHop(hops: hops, peak: hopPeak))
                            }
                        Image(systemName: "football.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(Color.primary)
                            .frame(width: 16, height: 16)
                            // A turnover knocks the ball as possession flips, first along the
                            // new attack direction; a sack drives it into the turf as it lands.
                            .knock(trigger(turnoverKnocks, moment?.kind == .turnover), amplitude: 3, outward: ballSide == .bottom ? -1 : 1)
                            .environment(\.celebrationClock, clock.delayed(by: 0.30))
                            .knock(trigger(sackKnocks, moment?.kind == .sack), amplitude: 1.5, outward: 1, axis: .vertical)
                            .environment(\.celebrationClock, clock.delayed(by: 0.20))
                            // A pass or kick: the ball hops once on its way (in place, if incomplete).
                            .modifier(BallHop(hops: hops, peak: hopPeak))
                            .position(x: x(ballX), y: ballY)
                        // A turnover: "here", in the new team's color.
                        if moment?.kind == .turnover, let side = ballSide {
                            MomentPing(color: side == .top ? palette.top : palette.bottom, diameter: 14)
                                .position(x: x(ballX), y: ballY)
                                .id(moment?.id)
                        }
                    }
                    .compositingGroup()
                    // The burst, over the marks and outside their group (the field isn't
                    // redrawn each frame), reaching down over the yard numbers to the well's edge.
                    .overlay(alignment: .topLeading) {
                        CelebrationStage(moment: celebrates ? moment : nil,
                                         origin: moment.flatMap { stageOrigin($0, size: geo.size, x: x, ballY: ballY) },
                                         size: CGSize(width: geo.size.width, height: geo.size.height + Self.yardRow),
                                         colors: .team(color(moment.flatMap(MatchRules.scorer(of:))) ?? .accentColor),
                                         direction: .degrees(moment.flatMap(MatchRules.scorer(of:)) == .top ? -150 : -30),
                                         wellInset: 8, effects: stageEffects)
                            // Arriving with the moment's own animation would fade its first frames in.
                            .transaction(value: moment?.id) { $0.animation = nil }
                    }
                    // Driven back hard on a sack; otherwise the ball travels.
                    .animation(reduceMotion ? nil : (moment?.kind == .sack ? Motion.quick : Motion.travel), value: ballX)
                    .animation(reduceMotion ? nil : Motion.standard, value: rows.map(\.id))
                    .onChange(of: moment?.id) { _, id in
                        guard id != nil, let m = moment else { return }
                        marks(for: m)
                        guard !reduceMotion else { return }
                        switch m.kind {
                        case .passComplete: hopPeak = 8
                        case .passIncomplete: hopPeak = 5
                        case .fieldGoal, .fieldGoalMissed: hopPeak = 14
                        default: return
                        }
                        hops += 1
                    }
                    .onChange(of: situation.redZone) { _, now in if now { redZoneBreaths += 1 } }
                }
                .frame(height: fieldHeight)
                // Yard numbers.
                GeometryReader { geo in
                    let ez = geo.size.width * 0.08, field = geo.size.width - ez * 2
                    ForEach(1..<10) { i in
                        Text("\(i <= 5 ? i * 10 : 100 - i * 10)")
                            .font(Viz.tick).foregroundStyle(.secondary)
                            .position(x: ez + field * Double(i * 10) / 100, y: 5)
                    }
                }
                .frame(height: 10)
            }
            .vizWell(padding: 8)
            // The readout reads the focus, not the field: a hover leaves the field alone.
            FocusReader { focus in
                ChartFooter(readout: rows.first { $0.id == focus?.play }.map { play in
                    (Self.yards(play.yards) ?? "No gain", [play.downDistance, play.text].compactMap { $0 }.joined(separator: " · "))
                }, moment: moment) {
                    VizLegend {
                        LegendItem(label: "Line of scrimmage") { Rectangle().fill(Color.blue).frame(width: 2, height: 10) }
                        LegendItem(label: "First-down line") { Rectangle().fill(Color.yellow).frame(width: 2, height: 10) }
                        if !rows.isEmpty {
                            LegendItem(label: "Gain") { Capsule().fill(Viz.neutral).frame(width: 12, height: 3.5) }
                            LegendItem(label: "Loss") { Capsule().strokeBorder(Viz.neutral, lineWidth: 1).frame(width: 12, height: 4.5) }
                            if rows.contains(where: { $0.kind == .penalty }) {
                                LegendItem(label: "Penalty") { Capsule().fill(Color.yellow.opacity(0.8)).frame(width: 12, height: 3.5) }
                            }
                        }
                        if situation.redZone {
                            LegendItem(label: "Red zone: inside the 20") { Rectangle().fill(Color.red.opacity(0.25)).frame(width: 8, height: 8) }
                        }
                    }
                }
            }
            if drive.isEmpty, let last = situation.lastPlay {
                Text(last)
                    .font(Viz.note)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !drive.isEmpty { driveList }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel([situation.downDistance, situation.redZone ? "Red zone" : nil,
                             twoMinuteDrill ? "Two-minute drill" : nil, driveSummary]
            .compactMap { $0 }.joined(separator: ". "))
    }

    /// Everything under the ball: the field, its lines and the drive.
    private func fieldLayers(size: CGSize, x: @escaping (Double) -> CGFloat, ballY: CGFloat) -> some View {
        let ez = size.width * 0.08
        let field = size.width - ez * 2
        return ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.primary.opacity(0.03))
            endZone(label: topLabel, color: palette.top, width: ez, height: size.height,
                    wash: scoreWash(intoRight: false), strength: washStrength)
            endZone(label: bottomLabel, color: palette.bottom, width: ez, height: size.height,
                    wash: scoreWash(intoRight: true), strength: washStrength)
                .offset(x: size.width - ez)
            Canvas { context, size in
                for i in 1..<10 {
                    var line = Path()
                    line.move(to: CGPoint(x: x(Double(i * 10)), y: 0))
                    line.addLine(to: CGPoint(x: x(Double(i * 10)), y: size.height))
                    context.stroke(line, with: .color(i == 5 ? Viz.reference : Viz.grid), lineWidth: i == 5 ? 1 : 0.5)
                }
            }
            if let possession = situation.possession {
                // Entering the red zone, the tint breathes once (0 → 0.18 → 0.10)
                // instead of a plain fade; it leaves quickly.
                OneShot(trigger: trigger(redZoneBreaths, situation.redZone && moment?.tier != .score), rest: 1) {
                    Self.breath(level != .off)
                } content: { f in
                    Rectangle().fill(Color.red.opacity(0.10 * f))
                }
                .frame(width: field * 0.2, height: size.height)
                .offset(x: possession == .top ? x(80) : x(0))
                .opacity(situation.redZone ? 1 : 0)
                .animation(situation.redZone || reduceMotion ? nil : Motion.exit, value: situation.redZone)
            }
            // The drive, one snap per row (the bars read the focus, not the field).
            FocusReader { focus in driveBars(x: x, lit: rows.first { $0.id == focus?.play }?.id) }
            // A kick at the uprights: they flash at the back line, in the
            // kicker's color if it's good, neutral if it isn't.
            if let kick = shownKick {
                OneShot(trigger: trigger(uprightFlashes, moment?.kind == .fieldGoal || moment?.kind == .fieldGoalMissed)) {
                    Self.flash()
                } content: { o in
                    Capsule().fill(kick.good ? (kick.side == .top ? palette.top : palette.bottom) : Viz.neutral)
                        .frame(width: 1.5, height: 16)
                        .opacity(level == .off ? 0 : o)
                }
                .position(x: kick.side == .top ? size.width - 0.75 : 0.75, y: size.height / 2)
                .environment(\.celebrationClock, clock.delayed(by: 0.40))
            }
            if let gain = situation.lineToGainX {
                Rectangle().fill(Color.yellow).frame(width: 2, height: size.height)
                    .overlay(Rectangle().stroke(Color.black.opacity(0.25), lineWidth: 0.5))
                    .offset(x: x(gain) - 1)
            }
            Rectangle().fill(Color.blue).frame(width: 2, height: size.height)
                .offset(x: x(situation.ballX) - 1)
            // A flag, thrown in at the line of scrimmage.
            if moment?.kind == .penalty, let play = momentPlay {
                RoundedRectangle(cornerRadius: 1).fill(Color.yellow)
                    .overlay(RoundedRectangle(cornerRadius: 1).strokeBorder(Color.black.opacity(0.25), lineWidth: 0.5))
                    .frame(width: 4, height: 6)
                    .position(x: x(play.startX), y: 4)
                    .transition(reduceMotion ? .opacity
                                : .asymmetric(insertion: AnyTransition.opacity.combined(with: .offset(y: -4)).animation(Motion.reveal),
                                              removal: .opacity.animation(Motion.exit)))
            }
            // Which way they're going: an arrowhead on the ball, in their color.
            // On a change of possession it sweeps around to the other side.
            if let side = ballSide {
                HStack {
                    Spacer(minLength: 0)
                    Image(systemName: "arrowtriangle.right.fill")
                        .font(.system(size: 6, weight: .bold))
                        .foregroundStyle(side == .top ? palette.top : palette.bottom)
                }
                .frame(width: 30, height: 16)
                .rotationEffect(.degrees(side == .top ? 0 : 180))
                .animation(reduceMotion ? nil : Motion.standard, value: side)
                .position(x: x(ballX), y: ballY)
                .transition(.opacity)
            }
        }
    }

    // MARK: Celebrations

    /// The yard numbers' row under the field (4 pt gap + 10): the burst may fall over it.
    private static let yardRow: CGFloat = 14

    /// A mark's trigger: the live count, or (on the harness's frozen clock)
    /// whether this moment plays it.
    private func trigger(_ live: Int, _ plays: Bool) -> Int {
        if case .frozen = clock { return plays ? 1 : 0 }
        return live
    }

    /// Schedules a moment's marks, each when the ball's own motion lands.
    private func marks(for m: LiveMoment) {
        func after(_ seconds: Double, _ bump: @escaping () -> Void) {
            Task {
                try? await Task.sleep(for: .seconds(seconds))
                bump()
            }
        }
        switch m.kind {
        case .turnover:
            // As the chevron flips (Motion.standard), the ball is knocked.
            after(0.30) { turnoverKnocks += 1 }
        case .sack:
            // Motion.quick lands it in about 0.2 s.
            after(0.20) { sackKnocks += 1 }
        case .fieldGoal, .fieldGoalMissed:
            if let side = m.side {
                kick = (side, m.kind == .fieldGoal)
                after(0.40) { uprightFlashes += 1 }
            }
        case .passComplete, .rush:
            guard m.accents.contains(.bigPlay) else { return }
            // Mounted on the new bar now, played once it has grown in.
            glintPlay = m.id
            after(0.30) { bigPlayGlints += 1 }
        default:
            break
        }
    }

    private func color(_ side: GameDetail.Side?) -> Color? {
        side.map { $0 == .top ? palette.top : palette.bottom }
    }

    /// The kick the uprights show (on the frozen clock, the moment's own).
    private var shownKick: (side: GameDetail.Side, good: Bool)? {
        guard case .frozen = clock else { return kick }
        guard let m = moment, m.kind == .fieldGoal || m.kind == .fieldGoalMissed, let side = m.side else { return nil }
        return (side, m.kind == .fieldGoal)
    }

    /// A big play's sparks start clear of the ball's 16 pt ring, not under the glyph.
    private var stageEffects: [CelebrationCue.Effect]? {
        guard let m = moment, m.kind == .passComplete || m.kind == .rush, m.accents.contains(.bigPlay) else { return nil }
        return [.sparks(rays: 4, length: 9, base: 10)]
    }

    /// Where the burst starts: the scored-into end zone (a touchdown, a
    /// safety's), the back line between the uprights, the ball after a big play.
    private func stageOrigin(_ m: LiveMoment, size: CGSize, x: (Double) -> CGFloat, ballY: CGFloat) -> CGPoint? {
        let ez = size.width * 0.08
        // The top team attacks right.
        let right = MatchRules.scorer(of: m) == .top
        switch m.kind {
        case .touchdown, .safety: return CGPoint(x: right ? size.width - ez / 2 : ez / 2, y: size.height / 2)
        case .fieldGoal: return CGPoint(x: right ? size.width - 0.75 : 0.75, y: size.height / 2)
        case .passComplete, .rush: return CGPoint(x: x(situation.ballX), y: ballY)
        default: return nil
        }
    }

    /// RED ZONE stays red; 2-MIN DRILL is pressure, so orange.
    private func stateChips(drill: String) -> some View {
        HStack(spacing: 4) {
            if situation.redZone { StateChip(text: "RED ZONE", color: .red).transition(Motion.chip(reduceMotion: reduceMotion)) }
            if twoMinuteDrill {
                StateChip(text: drill)
                    .help("Two-minute drill: two minutes or less, one score down")
                    .transition(Motion.chip(reduceMotion: reduceMotion))
            }
        }
    }

    /// The red zone's breath: up to 1.8× its tint, then settling at 1 (0.6 s).
    /// At Off, a plain fade in.
    @KeyframesBuilder<Double>
    private static func breath(_ breathes: Bool) -> some Keyframes<Double> {
        KeyframeTrack {
            MoveKeyframe(0)
            if breathes {
                LinearKeyframe(1.8, duration: 0.25, timingCurve: Motion.curve)
                LinearKeyframe(1, duration: 0.35, timingCurve: Motion.settle)
            } else {
                LinearKeyframe(1, duration: 0.15, timingCurve: Motion.curve)
            }
        }
    }

    /// The uprights' flash: 0 → 1 → 0 over 0.5 s.
    @KeyframesBuilder<Double>
    private static func flash() -> some Keyframes<Double> {
        KeyframeTrack {
            LinearKeyframe(1, duration: 0.12, timingCurve: Motion.curve)
            LinearKeyframe(1, duration: 0.10)
            LinearKeyframe(0, duration: 0.28, timingCurve: Motion.settle)
        }
    }

    /// A big play's glint along its bar: a 12 pt band sweeping it once (0.35 s).
    @KeyframesBuilder<Double>
    private static func sweep() -> some Keyframes<Double> {
        KeyframeTrack {
            MoveKeyframe(0)
            LinearKeyframe(1, duration: 0.35, timingCurve: Celebrate.sweepCurve)
        }
    }

    // MARK: Drive

    /// "IND drive · 6 plays · 62 yards".
    private var driveSummary: String? {
        guard let side = possession ?? rows.last?.side ?? drive.last?.side else { return nil }
        let team = side == .bottom ? bottomLabel : topLabel
        guard let first = rows.first, let last = rows.last else { return "\(team) drive · starting" }
        let net = Int((side == .bottom ? first.startX - last.endX : last.endX - first.startX).rounded())
        return "\(team) drive · \(plural(rows.count, "play")) · \(net) yard\(abs(net) == 1 ? "" : "s")"
    }

    /// Snaps listed under the field: the last 4, or from large up the last 6,
    /// as many as the field draws, so every bar has its line.
    private var listedSnaps: Int { widthClass >= .large ? Self.maxRows : 4 }

    /// The drive, newest first: each snap slides in as it happens (not the
    /// ones a wider panel reveals mid-drag).
    private var driveList: some View {
        let recent = Array(drive.reversed().prefix(listedSnaps))
        return VStack(alignment: .leading, spacing: 6) {
            if let driveSummary {
                Text(driveSummary).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(.secondary)
            }
            ForEach(recent) { play in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(play.downDistance ?? play.clock)
                        .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .frame(width: 58, alignment: .leading)
                    Text(play.text).font(.system(size: 11.5)).lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(Self.yards(play.yards) ?? "")
                        .font(.system(size: 11, weight: .semibold).monospacedDigit())
                        .foregroundStyle(play.yards < 0 ? Color.red : .primary)
                }
                .linkedRow(Focus(play: play.id), litBy: { $0?.play == play.id }, pinnable: true)
                // One element per snap: "2nd & 7, Mahomes pass to Kelce for 12 yards, plus 12".
                .accessibilityElement(children: .combine)
                .showOnChartAction(Focus(play: play.id))
                .widthDetail(.vertical, whileResizing: resizing, otherwise: Motion.arrive)
            }
        }
        .readableWidth()
        .padding(.top, 4)
        .animation(reduceMotion ? nil : Motion.standard, value: recent.map(\.id))
    }

    private func driveBars(x: @escaping (Double) -> CGFloat, lit: String?) -> some View {
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, play in
            let isLit = lit == play.id
            let y: CGFloat = 10 + CGFloat(index) * Self.rowHeight
            let frozenGlint = moment?.id == play.id && moment?.accents.contains(.bigPlay) == true
            bar(play, x: x, y: y, focused: isLit,
                glint: glintPlay == play.id || frozenGlint ? trigger(bigPlayGlints, frozenGlint) : nil)
                .opacity(lit == nil || isLit ? 1 : Viz.receded)
        }
    }

    private static func yards(_ yards: Int) -> String? {
        yards == 0 ? nil : yards > 0 ? "+\(yards)" : "−\(-yards)"
    }

    /// A snap as a bar from its start to its end: a gain filled in the team's
    /// color, a loss outlined in it (never red alone: a team's color may be
    /// red), a penalty flag-yellow, a turnover neutral.
    private func bar(_ play: DrivePlay, x: (Double) -> CGFloat, y: CGFloat, focused: Bool, glint: Int? = nil) -> some View {
        let a = x(play.startX), b = x(play.endX)
        let forward = play.side == .bottom ? b < a : b > a
        let team = play.side == .bottom ? palette.bottom : palette.top
        let color: Color = switch play.kind {
        case .penalty: .yellow
        case .turnover: Viz.neutral
        default: b == a ? Viz.neutral : team
        }
        let loss = play.kind == .sack || (b != a && !forward && play.kind != .penalty && play.kind != .turnover)
        let width = max(abs(b - a), 4)
        let height: CGFloat = focused ? 5 : 3.5
        return Capsule()
            .fill(loss ? Color.clear : color.opacity(play.kind == .penalty ? 0.8 : 1))
            .overlay(Capsule().strokeBorder(loss ? color : .clear, lineWidth: 1))
            .frame(width: width, height: loss ? height + 1 : height)
            .overlay {
                // A big play: one white sheen runs along its bar, the way it went.
                if let glint, level == .full, !reduceMotion {
                    OneShot(trigger: glint) { Self.sweep() } content: { p in
                        if p > 0, p < 1 {
                            let band: CGFloat = 12, travel = width + band * 2
                            let at = b >= a ? -band + travel * p : width + band - travel * p
                            LinearGradient(colors: [.white.opacity(0), .white.opacity(0.5), .white.opacity(0)],
                                           startPoint: .leading, endPoint: .trailing)
                                .frame(width: band)
                                .offset(x: at - band / 2)
                                .frame(width: width, alignment: .leading)
                        }
                    }
                    .clipShape(Capsule())
                    .environment(\.celebrationClock, clock.delayed(by: 0.30))
                    .allowsHitTesting(false)
                }
            }
            .overlay(alignment: b >= a ? .trailing : .leading) {
                if play.kind == .score {
                    Circle().fill(color).frame(width: 6, height: 6)
                }
            }
            .overlay(Capsule().strokeBorder(Color.primary, lineWidth: focused ? 1 : 0).padding(-1.5))
            .frame(width: width + 6, height: Self.rowHeight)
            .contentShape(Rectangle())
            .onHover { linked?.hover(Focus(play: play.id), $0) }
            .position(x: min(a, b) + width / 2, y: y)
            .transition(reduceMotion ? .opacity
                        : .opacity.combined(with: .scale(scale: 0.4, anchor: b >= a ? .leading : .trailing)))
    }

    /// A score lights the end zone it went into, in the scorer's color (a
    /// safety's: the end zone the offense was tackled in, in the defense's).
    private func scoreWash(intoRight: Bool) -> Color? {
        guard let moment, [.touchdown, .fieldGoal, .safety].contains(moment.kind),
              let side = MatchRules.scorer(of: moment) else { return nil }
        // The top team attacks right.
        guard (side == .top) == intoRight else { return nil }
        return side == .top ? palette.top : palette.bottom
    }

    /// A touchdown lights its end zone at 0.35; a field goal or safety, worth less, at 0.18.
    private var washStrength: Double { moment?.kind == .touchdown ? 0.35 : 0.18 }

    private func endZone(label: String, color: Color, width: CGFloat, height: CGFloat, wash: Color? = nil,
                         strength: Double = 0.35) -> some View {
        ZStack {
            Rectangle().fill(color.opacity(0.25))
            Rectangle().fill(wash ?? .clear).opacity(wash == nil ? 0 : strength)
                .animation(wash == nil ? Motion.ping : Motion.reveal.delay(reduceMotion ? 0 : 0.35), value: wash == nil)
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.primary)
                .fixedSize()
                .rotationEffect(.degrees(-90))
        }
        .frame(width: width, height: height)
    }

    private func timeouts(_ count: Int?, color: Color, team: String) -> some View {
        HStack(spacing: 2) {
            ForEach(0..<3) { i in
                Capsule().fill(i < (count ?? 0) ? color : Viz.track).frame(width: 7, height: 3)
            }
        }
        .help("\(team): \(count ?? 0) timeout\(count == 1 ? "" : "s") left")
    }
}

/// A pass or kick: the ball hops once (up `peak`, 0.4 s). Shared by the ball
/// and the room cleared around it, so the two move as one.
private struct BallHop: ViewModifier {
    let hops: Int
    let peak: CGFloat

    func body(content: Content) -> some View {
        content.keyframeAnimator(initialValue: CGFloat(0), trigger: hops) { content, lift in
            content.offset(y: lift)
        } keyframes: { _ in
            KeyframeTrack {
                CubicKeyframe(-peak, duration: 0.18)
                CubicKeyframe(0, duration: 0.22)
            }
        }
    }
}

// MARK: - Baseball diamond

struct BaseballDiamond<Theater: View>: View {
    let situation: GameDetail.Baseball
    /// The team at bat: its color fills the occupied bases and lights the plate.
    var batting: GameDetail.Side? = nil
    var palette: TeamPalette? = nil
    /// Under the diamond, over the footer: the play theater, whose caption the footer is.
    @ViewBuilder var theater: Theater
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    /// Bumped by a double play: the "turn two" swipe from second to first.
    @State private var turnTwos = 0
    /// Per base (first, second, third): bumped when that base loads them.
    @State private var loadPops: [Int: Int] = [:]
    /// The base under the pointer (0 first, 1 second, 2 third): the footer names its runner.
    @State private var pointedBase: Int?

    private var moment: LiveMoment? { momentFor(.plate, in: moments) }

    /// A run just scored: home plate lights for the moment.
    private var scored: Bool { moment?.kind == .runScored || moment?.kind == .homeRun }
    private var loaded: Bool { situation.onFirst && situation.onSecond && situation.onThird }

    private func color(_ side: GameDetail.Side?) -> Color? {
        guard let side, let palette else { return nil }
        return side == .top ? palette.top : palette.bottom
    }
    /// A team with no usable color fills bases in ink, as before, not in gray.
    private func ink(_ side: GameDetail.Side?) -> Color? { color(side).flatMap { $0 == Viz.neutral ? nil : $0 } }
    private var battingColor: Color { ink(batting) ?? .primary }
    /// The scoring team's color (the moment says who batted), else the batting team's.
    private var plateColor: Color { ink(moment?.side) ?? battingColor }

    /// Home plate and the bases, in the diamond's 52 × 48 frame. (Computed:
    /// the diamond is generic over its theater slot.)
    private static var plate: CGPoint { CGPoint(x: 26, y: 39) }
    private static var first: CGPoint { CGPoint(x: 41, y: 24) }
    private static var second: CGPoint { CGPoint(x: 26, y: 9) }

    private func occupied(_ order: Int) -> Bool {
        [situation.onFirst, situation.onSecond, situation.onThird][order]
    }

    var body: some View {
        // The section's spacing, as when the footer was its own row.
        VStack(alignment: .leading, spacing: 8) {
            diamond
            theater
            // A pointed-at runner by name; else what just happened at the plate, else the last play.
            ChartFooter(readout: runnerReadout, moment: moment) {
                if let last = situation.lastPlay {
                    Text(last).font(Viz.note).foregroundStyle(.secondary).lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var runnerReadout: (lead: String, detail: String)? {
        guard let order = pointedBase, occupied(order), let name = situation.runners[order] else { return nil }
        return (name, "Runner on \(Ordinal.string(order + 1))")
    }

    private var diamond: some View {
        HStack(spacing: 18) {
            ZStack {
                base(occupied: situation.onSecond, order: 1).offset(y: -15)
                base(occupied: situation.onFirst, order: 0).offset(x: 15)
                base(occupied: situation.onThird, order: 2).offset(x: -15)
                turnTwo
                Image(systemName: "pentagon.fill")
                    .font(.system(size: 8))
                    .rotationEffect(.degrees(180))
                    .foregroundStyle(scored ? plateColor : .secondary)
                    .animation(Motion.fade, value: scored)
                    .offset(y: 15)
                if scored {
                    MomentPing(color: plateColor, diameter: 12).offset(y: 15).id(moments?.current?.id)
                }
            }
            .frame(width: 52, height: 48)
            // Runs score: sparks at the plate in the batting color. (A home run's
            // fireworks are the spray chart's; one stage per moment.) The 10 pt
            // margin holds the rays: the diamond has no well to clip them.
            .overlay(alignment: .topLeading) {
                CelebrationStage(moment: moment?.kind == .runScored ? moment : nil, origin: Self.plate,
                                 size: CGSize(width: 52, height: 48), colors: .team(color(moment?.side ?? batting) ?? Viz.neutral), wellInset: 10,
                                 // Rays start clear of the 8 pt plate.
                                 effects: [.sparks(rays: 6, length: 12, base: 6)])
                    .transaction(value: moment?.id) { $0.animation = nil }
            }

            VStack(alignment: .leading, spacing: 4) {
                count("B", situation.balls, of: 3, color: .green, help: "Balls")
                count("S", situation.strikes, of: 2, color: .orange, help: "Strikes")
                // A double play's outs land one after the other.
                count("O", situation.outs, of: 2, color: .red, help: "Outs", stagger: moment?.kind == .doublePlay ? 0.12 : 0)
            }
            VStack(alignment: .leading, spacing: 3) {
                if let batter = situation.batter { matchup("At bat", batter, id: situation.batterID, team: color(batting), chip: loaded) }
                if let pitcher = situation.pitcher {
                    matchup("Pitching", pitcher, id: situation.pitcherID, team: color(batting.map(MatchRules.opposite)))
                }
            }
            .animation(reduceMotion ? nil : Motion.quick, value: loaded)
            Spacer(minLength: 0)
        }
        .onChange(of: moment?.id) { _, _ in
            if moment?.kind == .doublePlay { turnTwos += 1 }
        }
        .onChange(of: [situation.onFirst, situation.onSecond, situation.onThird]) { old, new in
            // The base that loads them pops.
            guard !old.allSatisfy({ $0 }), new.allSatisfy({ $0 }) else { return }
            for order in 0..<3 where !old[order] { loadPops[order, default: 0] += 1 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// A mark's trigger: the live count, or (on the harness's frozen clock)
    /// whether this moment plays it.
    private func trigger(_ live: Int, _ plays: Bool) -> Int {
        if case .frozen = clock { return plays ? 1 : 0 }
        return live
    }

    /// "Turn two": a line drawn from second toward first (0.25 s), then fading (0.3 s).
    private var turnTwo: some View {
        OneShot(trigger: trigger(turnTwos, moment?.kind == .doublePlay)) {
            KeyframeTrack {
                MoveKeyframe(0)
                LinearKeyframe(1, duration: 0.55)
            }
        } content: { u in
            if u > 0, u < 1, level != .off {
                let t = u * 0.55
                Path { p in
                    p.move(to: Self.second)
                    p.addLine(to: Self.first)
                }
                .trim(from: 0, to: reduceMotion ? 1 : Motion.curve.value(at: min(t / 0.25, 1)))
                .stroke(Color.primary.opacity(0.8), style: StrokeStyle(lineWidth: 1, lineCap: .round))
                .opacity(t < 0.25 ? (reduceMotion ? Motion.curve.value(at: t / 0.25) : 1) : 1 - Motion.curve.value(at: (t - 0.25) / 0.3))
            }
        }
        .frame(width: 52, height: 48)
        .allowsHitTesting(false)
    }

    /// Bases fill in order (first, second, third), so runners moving up read
    /// as a sweep around the diamond; in the batting team's color.
    private func base(occupied: Bool, order: Int) -> some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(occupied ? battingColor : Color.primary.opacity(0.08))
            .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Color.primary.opacity(occupied ? 0 : 0.25), lineWidth: 1))
            .frame(width: 13, height: 13)
            .rotationEffect(.degrees(45))
            .animation(reduceMotion ? Motion.fade : Motion.quick.delay(Double(order) * Motion.stagger), value: occupied)
            // The runner being read out below.
            .scaleEffect(occupied && pointedBase == order && situation.runners[order] != nil ? 1.15 : 1)
            .animation(reduceMotion ? nil : Motion.quick, value: pointedBase == order)
            // Bases loaded: the one that completes the set pops.
            .scorePop(trigger(loadPops[order] ?? 0, loaded && order == 0 && moment == nil), scale: 1.25,
                      delay: Double(order) * Motion.stagger)
            // A target a little larger than the base (neighbors stay clear: their centers are 21 pt apart).
            .frame(width: 20, height: 20)
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { pointedBase = order } else if pointedBase == order { pointedBase = nil }
            }
    }

    private func count(_ label: String, _ value: Int, of total: Int, color: Color, help: String, stagger: Double = 0) -> some View {
        HStack(spacing: 4) {
            Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).frame(width: 10)
            ForEach(0..<total, id: \.self) { i in
                Circle().fill(i < value ? color : Viz.track).frame(width: 8, height: 8)
                    .animation(reduceMotion ? Motion.fade : Motion.quick.delay(Double(i) * stagger), value: value)
            }
        }
        .help("\(help): \(value)")
    }

    /// "At bat" with the batting team's dot (and BASES LOADED beside it, on the
    /// label's line, so nothing moves when it comes and goes); "Pitching" with the fielding team's.
    private func matchup(_ role: String, _ name: String, id: String?, team: Color?, chip: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                if let team { Circle().fill(team).frame(width: 6, height: 6) }
                Text(role).font(.system(size: 9.5)).foregroundStyle(.secondary)
                if chip {
                    StateChip(text: "BASES LOADED")
                        .transition(Motion.chip(reduceMotion: reduceMotion))
                }
            }
            .frame(height: 12)
            // A click on the name opens the player's page.
            PlayerNameLink(espn: (id, name, nil)) {
                Text(name).font(.system(size: 11.5, weight: .medium)).lineLimit(1)
            }
        }
    }

    private var accessibilityText: String {
        let names = ["first", "second", "third"]
        let bases = (0..<3).filter(occupied).map { order in
            situation.runners[order].map { "\(names[order]) (\($0))" } ?? names[order]
        }
        let runners = bases.isEmpty ? "Bases empty" : bases.count == 3 && situation.runners.allSatisfy({ $0 == nil }) ? "Bases loaded"
            : (bases.count == 3 ? "Bases loaded: " : "Runners on ") + bases.joined(separator: " and ")
        let matchup = [situation.batter.map { "\($0) batting" }, situation.pitcher.map { "\($0) pitching" }].compactMap { $0 }
        return "\(situation.balls) balls, \(situation.strikes) strikes, \(situation.outs) outs. \(runners). "
            + matchup.joined(separator: ", ")
    }
}

extension BaseballDiamond where Theater == EmptyView {
    init(situation: GameDetail.Baseball, batting: GameDetail.Side? = nil, palette: TeamPalette? = nil) {
        self.init(situation: situation, batting: batting, palette: palette) { EmptyView() }
    }
}

// MARK: - Soccer timeline

/// The match on one track: each team's goals and cards in its own lane
/// (labeled), half-time marked, and time played filled while it's live.
/// Pointing at a mark (or at its key event) picks it out.
struct SoccerTimeline: View {
    let moments: [GameDetail.Moment]
    let currentMinute: Double?
    let palette: TeamPalette
    let topName: String
    let bottomName: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass
    /// In the chart peek: the minute labels stay; the pointed-at mark isn't spelled out.
    @Environment(\.chartPeek) private var peek

    private static let gutter: CGFloat = 30
    /// From large up the track has room for a tick every 15': minutes read
    /// off the axis instead of being estimated between 0', HT and the end.
    private var quarterHours: [Double] {
        guard widthClass >= .large else { return [] }
        return stride(from: 15.0, to: length, by: 15).filter { $0 != 45 }
    }
    private var length: Double {
        max(90, (moments.compactMap(\.minute).max() ?? 0).rounded(.up), currentMinute ?? 0)
    }
    private var marked: [GameDetail.Moment] {
        moments.filter { $0.minute != nil && $0.kind != .other && $0.kind != .score }
    }

    private static func laneY(_ m: GameDetail.Moment) -> CGFloat { m.side == .bottom ? 38 : 10 }

    var body: some View {
        GeometryReader { geo in
            // A little room at the end, so the last mark's ring isn't clipped.
            let w = geo.size.width - Self.gutter - 6
            let x = { (m: Double) in Self.gutter + w * min(m / length, 1) }
            let marks = marked
            // The pointed-at mark, read in the small layers that change with it.
            let target = { (focus: Focus?) in focus?.play.flatMap { id in marks.first { $0.id == id } } }
            let ticks = quarterHours
            // A tick near the end (90' in stoppage time) keeps its line, not its label.
            let labeled = ticks.filter { x(length) - 8 - x($0) >= 22 }
            ZStack(alignment: .topLeading) {
                Text(topName).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                    .position(x: Self.gutter / 2 - 2, y: 10)
                Text(bottomName).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                    .position(x: Self.gutter / 2 - 2, y: 38)
                Canvas { context, _ in
                    // The track stops short of the now dot on both sides.
                    let context = context.clearing(currentMinute.map { [Clearance(CGPoint(x: x($0), y: 24), radius: 4.5)] } ?? [])
                    var track = Path()
                    track.addRoundedRect(in: CGRect(x: Self.gutter, y: 23, width: w, height: 2), cornerSize: CGSize(width: 1, height: 1))
                    context.fill(track, with: .color(Color.primary.opacity(0.12)))
                    if length > 90 {
                        context.fill(Path(CGRect(x: x(90), y: 23, width: x(length) - x(90), height: 2)), with: .color(Viz.track))
                    }
                    for minute in ticks {
                        context.fill(Path(CGRect(x: x(minute) - 0.5, y: 22, width: 1, height: 4)), with: .color(Viz.markings))
                    }
                    if let currentMinute {
                        context.fill(Path(CGRect(x: Self.gutter, y: 23, width: x(currentMinute) - Self.gutter, height: 2)),
                                     with: .color(Viz.neutral))
                    }
                    var ht = Path()
                    ht.move(to: CGPoint(x: x(45), y: 19)); ht.addLine(to: CGPoint(x: x(45), y: 29))
                    context.stroke(ht, with: .color(Viz.reference), lineWidth: 1)
                }
                Canvas { context, _ in
                    // Each goal clears room in the marks before it.
                    let placed = marks.compactMap { m in m.minute.map { (mark: m, at: CGPoint(x: x($0), y: Self.laneY(m))) } }
                    context.draw(placed, clearance: { Self.clearance($0.mark, at: $0.at) }) { item, context in
                        draw(item.mark, at: item.at, in: context)
                    }
                }
                .recedes { target($0) != nil }
                if let currentMinute {
                    Canvas { context, _ in
                        context.fill(Path(ellipseIn: CGRect(x: x(currentMinute) - 3, y: 21, width: 6, height: 6)), with: .color(.red))
                    }
                }
                FocusReader { focus in
                    if let target = target(focus), let minute = target.minute {
                        let p = CGPoint(x: x(minute), y: Self.laneY(target))
                        Canvas { context, _ in draw(target, at: p, in: context, emphasized: true) }
                            .transition(.opacity)
                    }
                }
                // Minute labels sit exactly under their ticks; while a mark is
                // pointed at, that row says what it was instead (nothing covers the track).
                Group {
                    Text("0'").font(Viz.tick).foregroundStyle(.secondary).fixedSize()
                        .position(x: Self.gutter + 6, y: 54)
                    Text("HT").font(Viz.tick).foregroundStyle(.secondary).fixedSize()
                        .position(x: x(45), y: 54)
                    Text("\(Int(length))'").font(Viz.tick).foregroundStyle(.secondary).fixedSize()
                        .position(x: x(length) - 8, y: 54)
                    // Quieter than the landmarks (0', HT, the end) they sit between.
                    ForEach(labeled, id: \.self) { minute in
                        Text("\(Int(minute))'").font(Viz.tick).foregroundStyle(.tertiary).fixedSize()
                            .position(x: x(minute), y: 54)
                    }
                }
                .recedes(to: 0) { !peek && target($0) != nil }
                FocusReader { focus in
                    if let target = target(focus), !peek {
                        (Text(target.clock).fontWeight(.semibold).foregroundStyle(.primary)
                            + Text("  \(MomentList.headline(target))").foregroundStyle(.secondary))
                            .font(.system(size: 10.5).monospacedDigit())
                            .lineLimit(1)
                            .frame(width: geo.size.width - Self.gutter, alignment: .leading)
                            .position(x: Self.gutter + (geo.size.width - Self.gutter) / 2, y: 54)
                            .transition(.opacity)
                    }
                }
            }
            .contentShape(Rectangle())
            .linkedMarks(marks.map { CGPoint(x: x($0.minute ?? 0), y: Self.laneY($0)) }) { Focus(play: marks[$0].id) }
            .animation(reduceMotion ? nil : Motion.standard, value: currentMinute)
        }
        .frame(height: 60)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// The room a goal keeps clear around it, 1.5 pt (cards sit on their own).
    private static func clearance(_ m: GameDetail.Moment, at p: CGPoint) -> Clearance? {
        switch m.kind {
        case .goal, .ownGoal, .score: Clearance(p, radius: 6)
        case .yellow, .red, .other: nil
        }
    }

    private func draw(_ m: GameDetail.Moment, at p: CGPoint, in context: GraphicsContext, emphasized: Bool = false) {
        let grow: CGFloat = emphasized ? 1.35 : 1
        switch m.kind {
        case .goal, .ownGoal, .score:
            let r = 4.5 * grow
            let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            context.fill(Path(ellipseIn: rect), with: .color(m.side == .bottom ? palette.bottom : palette.top))
            if emphasized {
                context.stroke(Path(ellipseIn: rect.insetBy(dx: -2, dy: -2)), with: .color(.primary), lineWidth: 1)
            }
        case .yellow, .red:
            let rect = CGRect(x: p.x - 2.5 * grow, y: p.y - 3.5 * grow, width: 5 * grow, height: 7 * grow)
            context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(m.kind == .yellow ? .yellow : .red))
            if emphasized {
                context.stroke(Path(roundedRect: rect.insetBy(dx: -1.5, dy: -1.5), cornerRadius: 2), with: .color(.primary), lineWidth: 1)
            }
        case .other:
            break
        }
    }

    private var accessibilityText: String {
        let goals = moments.filter { $0.kind == .goal || $0.kind == .ownGoal }.count
        let yellows = moments.filter { $0.kind == .yellow }.count, reds = moments.filter { $0.kind == .red }.count
        let to = currentMinute.map { " to \(Int($0)) minutes" } ?? ""
        return "Timeline\(to): \(goals) goals, \(yellows) yellow cards, \(reds) red cards."
    }
}

// MARK: - Moments list

/// Key events or scoring plays, newest first, one row each: time, what
/// happened, and the team's crest at the end, where the eye looks for it.
struct MomentList: View {
    let moments: [GameDetail.Moment]
    let topName: String
    let bottomName: String
    let palette: TeamPalette
    var topTeam: Competitor? = nil
    var bottomTeam: Competitor? = nil

    /// Soccer goals don't come with the score; count it up so each goal shows
    /// it. Skipped when there's an own goal, whose credited side ESPN leaves ambiguous.
    private var runningScores: [String: String] {
        guard !moments.contains(where: { $0.kind == .ownGoal }) else { return [:] }
        var top = 0, bottom = 0, scores: [String: String] = [:]
        for m in moments where m.kind == .goal && m.score == nil {
            if m.side == .top { top += 1 } else if m.side == .bottom { bottom += 1 } else { continue }
            scores[m.id] = "\(top)–\(bottom)"
        }
        return scores
    }

    /// Soccer events carry a type icon; scoring plays elsewhere don't need one.
    private var showsIcons: Bool { moments.contains { $0.kind != .score && $0.kind != .other } }
    /// Soccer minutes are short; football and baseball clocks need more room.
    private var clockWidth: CGFloat { moments.allSatisfy { Self.shortClock($0.clock).count <= 6 } ? 38 : 52 }

    @Environment(\.panelResizing) private var resizing

    var body: some View {
        let running = runningScores
        StackColumn(spacing: 8) {
            ForEach(moments.reversed()) { m in
                let score = m.score ?? running[m.id]
                HStack(alignment: .center, spacing: 8) {
                    Text(Self.shortClock(m.clock))
                        .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .frame(width: clockWidth, alignment: .leading)
                        .help(m.clock)
                    if showsIcons { icon(m.kind).frame(width: 12) }
                    Text(Self.headline(m))
                        .font(.system(size: 11.5))
                        // Never clamped: a play's end is its outcome ("…Two-Point
                        // Pass Conversion Failed", "…Josh Naylor scored").
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let side = m.side { team(side) }
                    if let score {
                        Text(score)
                            .font(.system(size: 11, weight: .semibold).monospacedDigit())
                            .lineLimit(1)
                            // Room for "27–28" and "148–150": the crests stay in one column.
                            .frame(minWidth: 44, alignment: .trailing)
                    } else if !running.isEmpty {
                        // Keep crests in one column when some rows have a score.
                        Color.clear.frame(width: 44, height: 1)
                    }
                    // A play that can replay in the isometric view: its glyph on hover (its place kept on every row).
                    ReplayGlyph(play: Replays.play(of: m.id))
                }
                .linkedRow(Focus(play: m.id, period: m.period, side: m.side),
                           litBy: { $0?.matches(play: m.id, period: m.period, side: m.side) ?? false }, pinnable: true)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(spoken(m, score: score))
                // VoiceOver: "Show on Shot Chart" (or the pitch, linescore…), pinned and scrolled to.
                .showOnChartAction(Focus(play: m.id, period: m.period, side: m.side))
                // A click opens its replay under it (and pins it on the charts).
                .replayRow(ReplayRow(section: .moments, play: Replays.play(of: m.id)))
                .widthDetail(.vertical, whileResizing: resizing, otherwise: Motion.arrive)
            }
        }
    }

    /// "Bottom of the 7th, Naylor singled to right, Guardians, Diamondbacks 3, Guardians 4".
    private func spoken(_ m: GameDetail.Moment, score: String?) -> String {
        let top = topTeam?.name ?? topName, bottom = bottomTeam?.name ?? bottomName
        let points = score.map { $0.components(separatedBy: "–") }.flatMap { $0.count == 2 ? "\(top) \($0[0]), \(bottom) \($0[1])" : nil }
        return [Spoken.status(Self.shortClock(m.clock)), m.text, m.side.map { $0 == .top ? top : bottom }, points]
            .compactMap { $0 }.joined(separator: ", ")
    }

    /// The team's crest; its short name when there's no crest.
    @ViewBuilder
    private func team(_ side: GameDetail.Side) -> some View {
        let competitor = side == .top ? topTeam : bottomTeam
        let name = side == .top ? topName : bottomName
        Group {
            if let competitor, competitor.logo != nil {
                LogoView(url: competitor.logo, darkURL: competitor.darkLogo, size: 14)
            } else {
                Text(name).font(.system(size: 9.5, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .frame(minWidth: 18, alignment: .trailing)
        .help(competitor?.name ?? name)
    }

    /// "7th Inning" → "7th"; soccer minutes and football clocks pass through.
    nonisolated static func shortClock(_ clock: String) -> String {
        clock.replacingOccurrences(of: " Inning", with: "")
    }

    /// Soccer: the icon already says goal or card, so the row is the player
    /// ("Fer Niño Penalty - Scored" → "Fer Niño (pen)"). Other text passes through.
    nonisolated static func headline(_ m: GameDetail.Moment) -> String {
        [.goal, .ownGoal, .yellow, .red].contains(m.kind) ? shortened(m.text) : m.text
    }

    /// ESPN's goal and card wording without the type ("Harvey Barnes Goal" →
    /// "Harvey Barnes"); anything else unchanged. Shared with the pitch's labels.
    nonisolated static func shortened(_ text: String) -> String {
        // "Aitor Paredes Goal - Header" → "Aitor Paredes (header)".
        if let range = text.range(of: " Goal - ") {
            let detail = text[range.upperBound...].lowercased()
            return text[..<range.lowerBound] + (detail.isEmpty ? "" : " (\(detail))")
        }
        let endings = [(" Penalty - Scored", " (pen)"), (" Own Goal", " (OG)"), (" Second Yellow Card", " (2nd yellow)"),
                       (" Goal", ""), (" Yellow Card", ""), (" Red Card", "")]
        for (ending, replacement) in endings where text.hasSuffix(ending) {
            let name = text.dropLast(ending.count)
            return name.isEmpty ? text : name + replacement
        }
        return text
    }

    @ViewBuilder
    private func icon(_ kind: GameDetail.Moment.Kind) -> some View {
        switch kind {
        case .goal: Image(systemName: "soccerball").font(.system(size: 10))
        case .ownGoal: Image(systemName: "soccerball").font(.system(size: 10)).foregroundStyle(.red)
        case .yellow: RoundedRectangle(cornerRadius: 1).fill(.yellow).frame(width: 7, height: 10)
        case .red: RoundedRectangle(cornerRadius: 1).fill(.red).frame(width: 7, height: 10)
        case .score, .other: Color.clear
        }
    }
}

