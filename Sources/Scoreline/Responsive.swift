import SwiftUI

// Responsive panel content. The panel can be resized from 340 to 760pt wide.
// One measurement at the root becomes a coarse `PanelLayout` (it changes only
// when a threshold is crossed), and each block adds detail from its own width
// class. Type never scales; at 340 everything is compact, exactly as designed.

extension Metrics {
    /// The width every view was designed at; one column of a split panel.
    static let compactWidth: CGFloat = 340
    static let minWidth: CGFloat = 340
    static let maxWidth: CGFloat = 760
    /// Two columns of exactly `compactWidth`.
    static let splitWidth: CGFloat = 680
    /// Shortest height the user can set (short content still fits down to `minPanelHeight`).
    static let minCeiling: CGFloat = 300
    /// Longest prose line: about 90 characters at 11.5pt.
    static let readableWidth: CGFloat = 560
    /// Settings pages: one centered column.
    static let formWidth: CGFloat = 480
    /// A class steps down only this far below its threshold.
    static let hysteresis: CGFloat = 12
}

/// How much room a block has: its width less its 14pt gutters. Blocks add
/// detail as it grows; type never scales.
enum WidthClass: Int, Comparable, Sendable {
    case compact, medium, large, xlarge          // < 380, 380, 460, 560
    private static let floors: [CGFloat] = [0, 380, 460, 560]
    static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

    /// Up at a floor; down only `hysteresis` below it, so a drag resting on a
    /// threshold can't flicker.
    static func of(_ content: CGFloat, from old: WidthClass) -> WidthClass {
        var k = old.rawValue
        while k + 1 < floors.count, content >= floors[k + 1] { k += 1 }
        while k > 0, content < floors[k] - Metrics.hysteresis { k -= 1 }
        return WidthClass(rawValue: k) ?? .compact
    }
}

/// The panel's arrangement, derived once from its width at the root.
struct PanelLayout: Equatable, Sendable {
    var columns = 1
    /// A block spanning the panel.
    var page = WidthClass.compact
    /// A block in one column (equals `page` with one column).
    var column = WidthClass.compact
    var split: Bool { columns == 2 }

    static func resolve(width w: CGFloat, from old: PanelLayout) -> PanelLayout {
        let split = w >= Metrics.splitWidth - (old.split ? Metrics.hysteresis : 0)
        let gutters = 2 * Metrics.gutter
        let page = WidthClass.of(w - gutters, from: old.page)
        let column = split ? WidthClass.of(w / 2 - gutters, from: old.column) : page
        return PanelLayout(columns: split ? 2 : 1, page: page, column: column)
    }
}

// MARK: - Environment

private struct PanelLayoutKey: EnvironmentKey {
    static let defaultValue = PanelLayout()
}

private struct WidthClassKey: EnvironmentKey {
    static let defaultValue = WidthClass.compact
}

private struct PanelResizingKey: EnvironmentKey {
    static let defaultValue = false
}

/// Which way the panel last crossed a width threshold.
enum PanelGrowth: Sendable { case wider, narrower }

private struct PanelGrowthKey: EnvironmentKey {
    static let defaultValue = PanelGrowth.wider
}

extension EnvironmentValues {
    /// The panel's columns and width classes (coarse: changes at thresholds only).
    var panelLayout: PanelLayout {
        get { self[PanelLayoutKey.self] }
        set { self[PanelLayoutKey.self] = newValue }
    }

    /// The room the block being laid out has. Page composers override it per column.
    var widthClass: WidthClass {
        get { self[WidthClassKey.self] }
        set { self[WidthClassKey.self] = newValue }
    }

    /// The user is dragging an edge of the panel: no entrances, no height springs.
    var panelResizing: Bool {
        get { self[PanelResizingKey.self] }
        set { self[PanelResizingKey.self] = newValue }
    }

    /// Whether the last threshold crossed made the panel wider or narrower,
    /// so detail arrives from (and leaves toward) the edge that moved.
    var panelGrowth: PanelGrowth {
        get { self[PanelGrowthKey.self] }
        set { self[PanelGrowthKey.self] = newValue }
    }
}

/// Measures the panel's width once, at the root, and publishes the layout
/// only when a threshold is crossed (so bodies re-run a handful of times
/// across a whole drag, never per frame).
///
/// The edge being dragged always tracks the pointer; only a threshold
/// crossing animates. Content that moves glides on the house spring (space
/// opens first), and detail that appears or disappears uses `widthDetail()`.
struct ResponsiveRoot: ViewModifier {
    @State private var layout: PanelLayout
    @State private var growth = PanelGrowth.wider
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(initialWidth: CGFloat) {
        _layout = State(initialValue: .resolve(width: initialWidth, from: PanelLayout()))
    }

    func body(content: Content) -> some View {
        content
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
                let next = PanelLayout.resolve(width: width, from: layout)
                guard next != layout else { return }
                let wider = next.columns > layout.columns || next.page > layout.page || next.column > layout.column
                var instant = Transaction()
                instant.disablesAnimations = true
                withTransaction(instant) { growth = wider ? .wider : .narrower }
                withAnimation(reduceMotion ? Motion.fade : Motion.standard) { layout = next }
            }
            .environment(\.panelLayout, layout)
            .environment(\.widthClass, layout.page)
            .environment(\.panelGrowth, growth)
    }
}

/// Detail that a width change reveals or hides: columns, lanes, summary lines.
///
/// - Wider: it arrives from the edge being pulled (a fade and a short slide),
///   a beat after the layout has opened room for it.
/// - Narrower: it leaves quickly toward that edge, faster than it came.
/// - Vertical detail (a new line under a row) rises 4pt into place, like the
///   app's other arriving text.
/// - Reduce Motion: a fade.
private struct WidthDetail: ViewModifier {
    let axis: Axis
    /// Used instead while `active` is false (rows that otherwise arrive as data).
    var otherwise: AnyTransition? = nil
    var active = true
    @Environment(\.panelGrowth) private var growth
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        // One modifier either way (a value, not a branch), so switching never
        // rebuilds the view.
        content.transition(active ? transition : (otherwise ?? transition))
    }

    private var transition: AnyTransition {
        guard !reduceMotion else { return Self.fade }
        switch axis {
        case .vertical: return Self.rise
        case .horizontal: return growth == .wider ? Self.slideWider : Self.slideNarrower
        }
    }

    // Built once, not per cell per render (an NBA box score has about a hundred).
    private static let fade = AnyTransition.opacity.animation(Motion.fade)
    /// A new line under a row needs the row to open room first, whichever way
    /// the panel moved (narrowing brings context lines back).
    private static let rise = make(arrive: CGSize(width: 0, height: 4), leave: .zero, delay: 0.2)
    private static let slideWider = make(arrive: CGSize(width: 10, height: 0), leave: CGSize(width: 8, height: 0), delay: 0.14)
    private static let slideNarrower = make(arrive: CGSize(width: 10, height: 0), leave: CGSize(width: 8, height: 0), delay: 0)

    private static func make(arrive: CGSize, leave: CGSize, delay: Double) -> AnyTransition {
        .asymmetric(insertion: AnyTransition.opacity.combined(with: .offset(arrive)).animation(Motion.reveal.delay(delay)),
                    removal: AnyTransition.opacity.combined(with: .offset(leave)).animation(Motion.exit))
    }
}

// MARK: - Match columns

enum MatchColumn: Sendable { case left, right, span }

/// A section's place in the split match page: its column, and its order
/// within that column.
struct MatchSlot: Sendable, Equatable {
    var column: MatchColumn = .span
    var rank = 0
}

private struct MatchSlotLayoutKey: LayoutValueKey {
    static let defaultValue = MatchSlot()
}

private struct MatchSlotContainerKey: ContainerValueKey {
    static let defaultValue = MatchSlot()
}

extension ContainerValues {
    var matchSlot: MatchSlot {
        get { self[MatchSlotContainerKey.self] }
        set { self[MatchSlotContainerKey.self] = newValue }
    }
}

/// The match page's sections: one column in child order, or two columns with
/// full-width sections between blocks. The same children either way, so
/// crossing the breakpoint never rebuilds a section (a picker keeps its choice).
struct MatchColumnsLayout: Layout {
    var columns: Int
    var spacing: CGFloat = 0

    /// Where each child goes. One column: stacked in order at full width. Two:
    /// runs of left/right children form a block, each column stacked by rank at
    /// half width, the block as tall as its taller column; a span child closes
    /// the block and sits full width below it.
    static func frames(slots: [MatchSlot], width: CGFloat, columns: Int, spacing: CGFloat,
                       height: (Int, CGFloat) -> CGFloat) -> (frames: [CGRect], height: CGFloat) {
        var frames = Array(repeating: CGRect.zero, count: slots.count)
        var y: CGFloat = 0
        func place(_ i: Int, x: CGFloat, w: CGFloat, at top: CGFloat) -> CGFloat {
            let h = height(i, w)
            frames[i] = CGRect(x: x, y: top, width: w, height: h)
            return top + h + spacing
        }
        guard columns >= 2 else {
            for i in slots.indices { y = place(i, x: 0, w: width, at: y) }
            return (frames, max(0, y - (slots.isEmpty ? 0 : spacing)))
        }
        let half = width / 2
        var block: [Int] = []
        func closeBlock() {
            guard !block.isEmpty else { return }
            var bottoms = [y, y]
            for i in block.sorted(by: { (slots[$0].rank, $0) < (slots[$1].rank, $1) }) {
                let c = slots[i].column == .left ? 0 : 1
                bottoms[c] = place(i, x: CGFloat(c) * half, w: half, at: bottoms[c])
            }
            y = max(bottoms[0], bottoms[1])
            block = []
        }
        for i in slots.indices {
            if slots[i].column == .span {
                closeBlock()
                y = place(i, x: 0, w: width, at: y)
            } else {
                block.append(i)
            }
        }
        closeBlock()
        return (frames, max(0, y - (slots.isEmpty ? 0 : spacing)))
    }

    private func layout(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], height: CGFloat) {
        Self.frames(slots: subviews.map { $0[MatchSlotLayoutKey.self] }, width: width, columns: columns,
                    spacing: spacing) { i, w in
            subviews[i].sizeThatFits(ProposedViewSize(width: w, height: nil)).height
        }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? Metrics.compactWidth
        return CGSize(width: width, height: layout(width: width, subviews: subviews).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for (i, frame) in layout(width: bounds.width, subviews: subviews).frames.enumerated() {
            // The same proposal each section was measured with (width, any
            // height), so its own size cache hits instead of measuring twice.
            subviews[i].place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), anchor: .topLeading,
                              proposal: ProposedViewSize(width: frame.width, height: nil))
        }
    }

    // No alignment guides of its own. Without these, a parent stack asking for
    // this layout's leading edge (any VStack does) makes SwiftUI place every
    // child and ask each one, all the way down. Nothing aligns to a guide
    // inside, so the answer is the same: none.
    func explicitAlignment(of guide: HorizontalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }

    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }
}

/// A row-major grid with equal-height rows: each cell is offered its row's
/// height, so highlights line up. One column is a plain stack.
struct RowGrid: Layout {
    var columns: Int
    var spacing: CGFloat = 0

    static func frames(count: Int, width: CGFloat, columns: Int, spacing: CGFloat,
                       height: (Int, CGFloat) -> CGFloat) -> (frames: [CGRect], height: CGFloat) {
        let columns = max(columns, 1)
        let cell = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
        var frames = Array(repeating: CGRect.zero, count: count)
        var y: CGFloat = 0
        for start in stride(from: 0, to: count, by: columns) {
            let row = start..<min(start + columns, count)
            let rowHeight = row.map { height($0, cell) }.max() ?? 0
            for (offset, i) in row.enumerated() {
                frames[i] = CGRect(x: CGFloat(offset) * (cell + spacing), y: y, width: cell, height: rowHeight)
            }
            y += rowHeight + spacing
        }
        return (frames, max(0, y - (count == 0 ? 0 : spacing)))
    }

    private func layout(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], height: CGFloat) {
        Self.frames(count: subviews.count, width: width, columns: columns, spacing: spacing) { i, w in
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
    // this layout's leading edge (any VStack does) makes SwiftUI place every
    // child and ask each one, all the way down. Nothing aligns to a guide
    // inside, so the answer is the same: none.
    func explicitAlignment(of guide: HorizontalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }

    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }
}

/// `StackColumn` over any layout: each direct child joins the page's
/// entrance; children that stack their own rows pass through. A child's
/// match slot (a container value) is re-applied as a layout value, which is
/// what the layout reads.
struct StackContainer<Content: View>: View {
    var layout: AnyLayout
    @ViewBuilder var content: Content

    var body: some View {
        layout {
            ForEach(subviews: content) { subview in
                let slot = subview.containerValues.matchSlot
                Group {
                    if subview.containerValues.stacksOwnRows { subview } else { subview.stackIn() }
                }
                .layoutValue(key: MatchSlotLayoutKey.self, value: slot)
            }
        }
        .containerValue(\.stacksOwnRows, true)
    }
}

// MARK: - Modifiers

extension View {
    /// A fixed-aspect chart and its footer: fills the width until the plot is
    /// `maxHeight` tall, then keeps that size and centers, footer with it.
    func chartUnit(aspect: CGFloat, maxHeight: CGFloat, chrome: CGFloat = 20) -> some View {
        frame(maxWidth: maxHeight * aspect + chrome).frame(maxWidth: .infinity)
    }

    /// Prose never runs longer than a comfortable line.
    func readableWidth() -> some View { frame(maxWidth: Metrics.readableWidth, alignment: .leading) }

    /// Settings: one centered column.
    func formColumn() -> some View { frame(maxWidth: Metrics.formWidth).frame(maxWidth: .infinity) }

    /// Detail a width change reveals or hides (see `WidthDetail`): columns and
    /// lanes slide from the edge being pulled; lines under a row rise.
    func widthDetail(_ axis: Axis = .horizontal) -> some View { modifier(WidthDetail(axis: axis)) }

    /// A row that normally arrives as data (`otherwise`), but rises into place
    /// like other width detail while the panel is being resized.
    func widthDetail(_ axis: Axis, whileResizing resizing: Bool, otherwise: AnyTransition) -> some View {
        modifier(WidthDetail(axis: axis, otherwise: otherwise, active: resizing))
    }

    /// The section's place in the split match page.
    func matchSlot(_ column: MatchColumn, rank: Int) -> some View {
        containerValue(\.matchSlot, MatchSlot(column: column, rank: rank))
    }
}
