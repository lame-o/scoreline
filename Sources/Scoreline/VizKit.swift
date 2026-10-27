import AppKit
import SwiftUI

/// One visual system for every chart. Neutrals are `primary` opacities, so the
/// same values work in light and dark mode; team colors are for marks only.
enum Viz {
    // Ink
    static let grid = Color.primary.opacity(0.10)        // 0.5pt
    static let markings = Color.primary.opacity(0.16)    // 1pt field lines
    static let reference = Color.primary.opacity(0.35)   // 1pt: HT, TOP, zone, 50
    static let baseline = Color.primary.opacity(0.18)    // 1pt ground
    static let track = Color.primary.opacity(0.06)       // empty slots
    /// 0.55 (was 0.45): measured on the real dark glass, 0.45 gave neutral
    /// marks 2.4:1; 0.55 on the dark plate gives 4.2:1 (light: 2.7 → 3.5:1).
    static let neutral = Color.primary.opacity(0.55)
    /// Followed team / your country, and selected rows.
    static let highlight = Color.accentColor.opacity(0.10)
    /// Chart marks stepping back while a linked mark is in focus. Kept high:
    /// on a glass panel, anything fainter reads as see-through (0.55: receded
    /// neutral marks 2.3:1 on the dark plate, was 1.5:1).
    static let receded = 0.55

    // Type: nothing under 9pt, numbers tabular.
    static let tick = Font.system(size: 9, weight: .medium).monospacedDigit()
    static let value = Font.system(size: 10, weight: .semibold).monospacedDigit()
    static let legend = Font.system(size: 10)
    static let note = Font.system(size: 10.5)
    static let inMark = Font.system(size: 9, weight: .bold).monospacedDigit()

    /// Text or glyph color that stays legible on a filled mark.
    static func ink(on color: Color) -> Color {
        luminance(color) > 0.6 ? .black.opacity(0.8) : .white
    }

    static func luminance(_ color: Color) -> Double {
        guard let c = NSColor(color).usingColorSpace(.sRGB) else { return 0.5 }
        return 0.2126 * c.redComponent + 0.7152 * c.greenComponent + 0.0722 * c.blueComponent
    }

    /// The hero wash's strength for a team color: one value for the match,
    /// team and player pages (`HeroWash`), so a team's page is as rich as its
    /// match. Very light colors (Spurs white, NaVi yellow) are capped so the
    /// text over them stays legible. Tiles take a fraction of it (`TileWash`).
    static func washStrength(_ color: Color, intensity: Double = 1) -> Double {
        (luminance(color) > 0.7 ? 0.40 : 0.60) * intensity
    }
}

extension View {
    /// The quiet surface behind spatial charts (pitch, field, wall, zone).
    func vizWell(padding: CGFloat = 10) -> some View {
        modifier(VizWell(padding: padding))
    }
}

/// Light: a faint primary tint, as before. Dark: a plate, black at 0.45. The
/// dark glass measures a mid-gray (#525762 over the user's desktop, #6E6E6F
/// over mid-gray), so a lightening well put mid-tone team marks at 1.5–2.7:1
/// and tick labels at 3.2:1; on the plate they reach 3.0–5.4:1 and 5.2:1.
/// (Glass rim, solid plate: the chart peek's rule, kept in the page.)
private struct VizWell: ViewModifier {
    let padding: CGFloat
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        content.padding(padding)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(scheme == .dark ? Color.black.opacity(0.45) : Color.primary.opacity(0.045)))
            // Increase Contrast: a rim you can see.
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.primary.opacity(contrast == .increased ? 0.25 : 0.08), lineWidth: 0.5))
    }
}

/// A legend entry whose swatch is a drawn copy of the real mark.
struct LegendItem<Swatch: View>: View {
    let label: String
    @ViewBuilder let swatch: Swatch

    var body: some View {
        HStack(spacing: 4) {
            swatch.frame(minWidth: 8, minHeight: 8)
            Text(label).font(Viz.legend).foregroundStyle(.secondary).fixedSize()
        }
    }
}

/// Legend row under a chart; wraps onto more lines when it doesn't fit.
struct VizLegend<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        FlowLayout(spacing: 12, lineSpacing: 4) { content }
            .padding(.top, 6)
    }
}

/// Left-to-right layout that wraps to new lines. Each child is measured once
/// per change (the cache), and it has no alignment guides of its own, so a
/// parent asking for one (`ChartFooter`'s ZStack) doesn't place every child.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 4

    struct Cache { var sizes: [CGSize] }

    func makeCache(subviews: Subviews) -> Cache { Cache(sizes: subviews.map { $0.sizeThatFits(.unspecified) }) }

    func updateCache(_ cache: inout Cache, subviews: Subviews) {
        cache.sizes = subviews.map { $0.sizeThatFits(.unspecified) }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) -> CGSize {
        let rows = Self.arrange(width: proposal.width ?? .infinity, sizes: cache.sizes, spacing: spacing)
        let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(rows.count - 1, 0))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Cache) {
        var y = bounds.minY
        for row in Self.arrange(width: bounds.width, sizes: cache.sizes, spacing: spacing) {
            var x = bounds.minX
            for index in row.indices {
                let size = cache.sizes[index]
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    func explicitAlignment(of guide: HorizontalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout Cache) -> CGFloat? { nil }

    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout Cache) -> CGFloat? { nil }

    struct Row: Equatable { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    /// Rows for children of these sizes in `width` (pure; tested).
    static func arrange(width: CGFloat, sizes: [CGSize], spacing: CGFloat) -> [Row] {
        var rows: [Row] = [Row()]
        for (index, size) in sizes.enumerated() {
            let needed = rows[rows.count - 1].indices.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if needed > width, !rows[rows.count - 1].indices.isEmpty {
                rows.append(Row())
            }
            var row = rows.removeLast()
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            rows.append(row)
        }
        return rows.filter { !$0.indices.isEmpty }
    }
}

/// State shown at the trailing edge of a section title.
enum SectionAccessory: Equatable {
    case live
    case final
    case text(String)
}

// MARK: - Linked hover

/// What the pointer is on, shared by every chart on a match page, so the same
/// thing lights up wherever it appears: a key event, its shot on the pitch and
/// its mark on the timeline; an inning's cell and the plays scored in it.
/// A source fills in what it knows; each chart reacts to the parts it shows.
struct Focus: Equatable {
    /// ESPN play ID (key events, shots, scoring plays, batted balls).
    var play: String? = nil
    /// Inning or quarter, 1-based, with the team batting or scoring.
    var period: Int? = nil
    var side: GameDetail.Side? = nil
    /// IFSC athlete ID.
    var athlete: Int? = nil
    /// CS2 round number on the map shown.
    var round: Int? = nil
    /// ESPN athlete ID (NBA: a box score or leader row, and that player's shots).
    var player: String? = nil
    /// A stretch of game time in elapsed seconds (NBA: a scoring run, its first
    /// play to now), with the running team in `side`. CourtView lights the shots
    /// inside it; GameFlowView shades it the way it shades a period.
    var span: ClosedRange<Double>? = nil

    /// A play, or with no play, everything in a period (for one team, if given).
    func matches(play id: String?, period p: Int? = nil, side s: GameDetail.Side? = nil) -> Bool {
        if let play { return play == id }
        guard let period, period == p else { return false }
        return side == nil || side == s
    }
}

/// The page's current focus. Charts read it to emphasize and dim; rows and
/// marks write it on hover. A clicked row pins its focus, which is what
/// charts show whenever nothing is hovered.
@MainActor
@Observable
final class LinkedFocus {
    /// What's pointed at right now.
    private(set) var hovered: Focus?
    /// What a click pinned, until it's clicked again or Esc.
    private(set) var pinned: Focus?
    /// What charts show: the hover, else the pin.
    var focus: Focus? { hovered ?? pinned }
    /// While the pointer rests on the chart peek, the hover it was showing
    /// stays (leaving the row for the peek would otherwise clear it).
    @ObservationIgnored private(set) var held = false
    /// A focus waiting to show (the pointer hasn't rested yet), or a clear
    /// waiting out its grace period (focus nil).
    @ObservationIgnored private var pending: (focus: Focus?, task: Task<Void, Never>)?

    /// The pointer left the page: nothing is hovered, whatever was pending.
    /// A pin stays, and so does a held hover.
    func clear() {
        guard !held else { return }
        pending?.task.cancel()
        pending = nil
        guard hovered != nil else { return }
        withAnimation(Motion.fade) { hovered = nil }
    }

    func pin(_ focus: Focus) {
        guard pinned != focus else { return }
        withAnimation(Motion.fade) { pinned = focus }
    }

    /// Whether there was a pin to drop (Esc unpins before it goes back).
    @discardableResult
    func unpin() -> Bool {
        guard pinned != nil else { return false }
        withAnimation(Motion.fade) { pinned = nil }
        return true
    }

    func togglePin(_ focus: Focus) {
        if pinned == focus { unpin() } else { pin(focus) }
    }

    /// The pointer entered (true) or left (false) the chart peek. Leaving
    /// starts the usual grace before the hover clears; landing on a row in
    /// the meantime simply takes over.
    func hold(_ on: Bool) {
        held = on
        guard !on, hovered != nil else { return }
        pending?.task.cancel()
        let task = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(80))
            guard !Task.isCancelled, let self, !self.held else { return }
            withAnimation(Motion.fade) { self.hovered = nil }
            self.pending = nil
        }
        pending = (nil, task)
    }

    /// Links appear once the pointer settles (80ms), so sweeping across the
    /// page doesn't set charts flickering; once they're showing, they follow
    /// the pointer at once, like tooltips after the first. Moving from mark to
    /// mark while that short wait runs just retargets it (it doesn't start
    /// over), so dense charts respond as quickly as sparse ones.
    func hover(_ next: Focus, _ inside: Bool) {
        if inside {
            if hovered != nil {
                // Warm: follow the pointer at once, with no fade between
                // neighbors (a fade per move smeared every linked chart).
                pending?.task.cancel()
                pending = nil
                guard hovered != next else { return }
                var instant = Transaction()
                instant.disablesAnimations = true
                withTransaction(instant) { hovered = next }
                return
            }
            if let waiting = pending, waiting.focus != nil {
                pending = (next, waiting.task)
                return
            }
            pending?.task.cancel()
            let task = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(80))
                guard !Task.isCancelled, let self, let target = self.pending?.focus else { return }
                withAnimation(Motion.fade) { self.hovered = target }
                self.pending = nil
            }
            pending = (next, task)
        } else {
            if pending?.focus == next {
                // Left before it ever showed.
                pending?.task.cancel()
                pending = nil
                return
            }
            guard hovered == next, !held else { return }
            // A short grace, so crossing the gap to a neighbor doesn't flash everything back.
            let task = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(80))
                guard !Task.isCancelled, let self, !self.held else { return }
                withAnimation(Motion.fade) { self.hovered = nil }
                self.pending = nil
            }
            pending = (nil, task)
        }
    }
}

extension View {
    /// A list row that takes part in linked hover: a ghost wash while it's the
    /// focus (never competing with a followed-team highlight). Other rows stay
    /// as they are: text being read doesn't fade.
    ///
    /// `pinnable` rows pin their focus on a click (again, or Esc, unpins) and
    /// wear the selection wash while pinned. Rows with their own click (a
    /// button, the NBA player pick) leave it off.
    func linkedRow(_ focus: Focus, highlighted: Bool, pinnable: Bool = false) -> some View {
        modifier(LinkedRow(focus: focus, lit: .fixed(highlighted), pinnable: pinnable))
    }

    /// The same, with the ghost wash following the page's focus (`lit` says
    /// whether a focus lights this row). Only the wash reads the focus, so
    /// pointing anywhere on the page re-runs the washes it changes, never the
    /// rows (their text, their layout) or the list around them.
    func linkedRow(_ focus: Focus, litBy lit: @escaping (Focus?) -> Bool, pinnable: Bool = false) -> some View {
        modifier(LinkedRow(focus: focus, lit: .focus(lit), pinnable: pinnable))
    }
}

private struct LinkedRow: ViewModifier {
    enum Lit {
        case fixed(Bool)
        case focus((Focus?) -> Bool)
    }

    let focus: Focus
    let lit: Lit
    let pinnable: Bool
    /// How far past its own bounds a row answers the pointer, above and below.
    static let reach: CGFloat = 4.5
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(\.colorSchemeContrast) private var contrast
    /// The pointer is on this row: its own wash shows at once, like a list
    /// row's (the house rule: hover is instant). The linked charts follow on
    /// the page's timing.
    @State private var pointer = false

    func body(content: Content) -> some View {
        let pinned = pinnable && linked?.pinned == focus
        let strength = contrast == .increased ? 0.12 : 0.07
        content
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background {
                switch lit {
                case let .fixed(on):
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(Color.primary.opacity(on || pointer ? strength : 0))
                case let .focus(lights):
                    FocusWash(lights: lights, pointer: pointer, strength: strength)
                }
            }
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Viz.highlight.opacity(pinned ? 1 : 0)))
            // The pointer is always over exactly one row, as in a native list:
            // each row's hover area reaches halfway across the gap to its
            // neighbors (lists space rows 6–8pt), so there's no dead zone
            // between them. Layout and the wash are unchanged.
            .padding(.vertical, Self.reach - 2)
            .contentShape(Rectangle())
            .onHover { inside in
                pointer = inside
                linked?.hover(focus, inside)
            }
            .padding(.horizontal, -6)
            .padding(.vertical, -Self.reach)
            // Not pinnable: no tap of its own at all, so a row's own click wins.
            .gesture(TapGesture().onEnded { linked?.togglePin(focus) }, including: pinnable ? .all : .subviews)
            .accessibilityAddTraits(pinnable ? (pinned ? [.isButton, .isSelected] : .isButton) : [])
            .accessibilityActions {
                if pinnable {
                    Button(pinned ? "Clear Highlight" : "Highlight on Charts") { linked?.togglePin(focus) }
                }
            }
    }
}

/// A linked row's ghost wash, reading the page's focus itself: the one view
/// a hover re-runs per row.
private struct FocusWash: View {
    let lights: (Focus?) -> Bool
    let pointer: Bool
    let strength: Double
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Color.primary.opacity(pointer || lights(linked?.focus) ? strength : 0))
    }
}

private struct ChartPeekKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True inside the linked-chart peek: charts drop what doesn't belong in a
    /// small live copy (footers, legends, scrubbers, summary lines).
    var chartPeek: Bool {
        get { self[ChartPeekKey.self] }
        set { self[ChartPeekKey.self] = newValue }
    }
}

/// The line under a chart: its legend, or, while a mark is pointed at, that
/// mark in words. Details live here rather than in a label on the chart, so
/// nothing ever covers the data (or the path it's drawing); the legend keeps
/// its space, so nothing shifts.
struct ChartFooter<Legend: View>: View {
    /// The pointed-at mark: its value first, then what it was.
    let readout: (lead: String, detail: String)?
    /// What just happened here, while it's news (a red dot marks it live).
    var moment: LiveMoment? = nil
    @ViewBuilder let legend: Legend

    var body: some View {
        // Pointing beats news; news beats the legend. The legend keeps its space.
        let caption = moment.flatMap { $0.captioned ? $0 : nil }
        ZStack(alignment: .topLeading) {
            legend
                .opacity(readout == nil && caption == nil ? 1 : 0)
                .accessibilityHidden(readout != nil || caption != nil)
            if let readout {
                line(readout.lead, readout.detail, live: false)
                    .transition(.opacity)
            } else if let caption {
                MomentCaption(moment: caption)
            }
        }
    }

    private func line(_ lead: String, _ detail: String, live: Bool) -> some View {
        HStack(spacing: 5) {
            (Text(lead).fontWeight(.semibold).foregroundStyle(.primary)
                + Text(detail.isEmpty ? "" : "  \(detail)").foregroundStyle(.secondary))
                .font(.system(size: 10.5).monospacedDigit())
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.top, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The index of the point nearest `location`, if it's within `radius`
/// (hit areas are larger than the marks they belong to).
func nearest(_ points: [CGPoint], to location: CGPoint, within radius: CGFloat = 14) -> Int? {
    nearest(points.map { HoverMark($0) }, to: location, within: radius)
}

/// A hover target in a chart: a dot, or a line (a pass, a shot's path) that
/// can be pointed at anywhere along its length.
struct HoverMark {
    let start: CGPoint
    var end: CGPoint? = nil

    init(_ point: CGPoint) { start = point }
    init(from start: CGPoint, to end: CGPoint) {
        self.start = start
        self.end = end
    }

    func distance(to p: CGPoint) -> CGFloat {
        guard let end else { return hypot(start.x - p.x, start.y - p.y) }
        let dx = end.x - start.x, dy = end.y - start.y
        let length = dx * dx + dy * dy
        let t = length == 0 ? 0 : min(max(((p.x - start.x) * dx + (p.y - start.y) * dy) / length, 0), 1)
        return hypot(start.x + t * dx - p.x, start.y + t * dy - p.y)
    }
}

func nearest(_ marks: [HoverMark], to location: CGPoint, within radius: CGFloat = 14) -> Int? {
    var best: (index: Int, distance: CGFloat)?
    for (index, mark) in marks.enumerated() {
        // Lines are thin: they take a tighter reach than dots, so a line
        // crossing the chart doesn't claim everything near it.
        let reach = mark.end == nil ? radius : min(radius, 9)
        let d = mark.distance(to: location)
        if d <= reach, d < (best?.distance ?? .infinity) { best = (index, d) }
    }
    return best?.index
}

extension View {
    /// Marks drawn in a Canvas as hover targets: whichever is nearest the
    /// pointer, within 14pt, becomes the page's focus.
    func linkedMarks(_ points: [CGPoint], focus: @escaping (Int) -> Focus) -> some View {
        modifier(LinkedMarks(marks: points.map { HoverMark($0) }, focus: focus))
    }

    /// Dots and lines as hover targets: lines respond along their length.
    func linkedMarks(_ marks: [HoverMark], focus: @escaping (Int) -> Focus) -> some View {
        modifier(LinkedMarks(marks: marks, focus: focus))
    }
}

private struct LinkedMarks: ViewModifier {
    let marks: [HoverMark]
    let focus: (Int) -> Focus
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @State private var current: Focus?

    func body(content: Content) -> some View {
        content.onContinuousHover { phase in
            guard let linked else { return }
            switch phase {
            case let .active(location):
                if let index = nearest(marks, to: location) {
                    let next = focus(index)
                    // Said on every move, not only on a new mark: a hover
                    // cleared elsewhere while the pointer rested here comes
                    // back without leaving the mark. Unchanged, it's a no-op.
                    linked.hover(next, true)
                    if current != next { current = next }
                } else if let previous = current {
                    linked.hover(previous, false)
                    current = nil
                }
            case .ended:
                if let previous = current {
                    linked.hover(previous, false)
                    current = nil
                }
            }
        }
    }
}
