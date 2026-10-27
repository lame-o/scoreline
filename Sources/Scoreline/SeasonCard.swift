import SwiftUI

// The season pages' summary (climbing and CS2, Upcoming and Results): a glass
// card at the top with what's on (live, next, done) and the season on one
// axis, the readout of the competition under the pointer beneath it. As the
// page scrolls the card tucks under the header and, at the same offsets, a
// compact bar docks in its place: the summary on one line over a slim strip
// of the season, as the match page's hero gives way to its scorebar. Both are
// driven by the page's quantized dock progress (`DockedBarHost`), never by
// timers, and the bar is an overlay: the panel's auto-height never sees it.
//
// The strip is live: hovering a mark lights its row in the list (and the row
// lights the mark), clicking one opens it and scrolls its row up to just
// under the bar.

// MARK: - What the card and the bar show (pure, tested)

/// The season at a glance, in two lines.
struct SeasonSummary: Equatable {
    /// "Next: 🇯🇵 Tokyo", "Live now · 🇨🇱 Santiago", "2026 season complete".
    var headline: String
    /// "Apr 9–11 · in 165 days", "10 competitions".
    var subline: String?
    /// Something's underway: a live dot leads the headline.
    var live = false
    /// The subline is happening now (a live match): it's red.
    var sublineLive = false
}

/// The season on one axis, as the card's timeline and the bar's strip draw it.
struct SeasonAxis: Equatable {
    var events: [SeasonEvent]
    var lanes: [SeasonTimeline.Lane]
    var today: DayKey
    /// The next competition (accent), when nothing is live.
    var next: String?
    /// The one open beside the list (split panel).
    var selected: String?
    /// Each competition's one line ("Santiago · Oct 23–25 · 🥇 Utelli, Garnbret").
    var readouts: [String: String] = [:]
    /// Whose line shows with nothing under the pointer (what's live or next,
    /// the latest result, the one open beside the list).
    var resting: String?

    /// The readout: the competition under the pointer (in the timeline, the
    /// strip or the list), else the resting one.
    func readout(hovered: String?) -> String? {
        hovered.flatMap { readouts[$0] } ?? resting.flatMap { readouts[$0] }
    }
}

enum SeasonDock {
    /// The docked bar: a line of text over the strip.
    static let barHeight: CGFloat = 50
    /// The top of the viewport the docked bar covers (its 4pt inset, the
    /// bar, a gap): a row scrolled to sits just below it.
    static let reserve: CGFloat = 62
    static let stripHeight: CGFloat = 10
    static let stripMark: CGFloat = 5

    /// The bar's line: the competition under the pointer when there is one
    /// (everything else gives way to it), else the headline and its subline.
    static func line(_ summary: SeasonSummary, hovered: String?, axis: SeasonAxis) -> (lead: String, trail: String?) {
        if let hovered, let readout = axis.readouts[hovered] { return (readout, nil) }
        return (summary.headline, summary.subline)
    }

    /// The strip's marks: every competition on one lane, whatever its
    /// disciplines, at least 4pt wide and 1.5pt clear of the one before.
    static func strip(_ events: [SeasonEvent], domain: (DayKey, DayKey), width: CGFloat) -> [SeasonTimeline.Mark] {
        var marks: [SeasonTimeline.Mark] = []
        var lastMaxX: CGFloat = -.infinity
        for event in events.sorted(by: { $0.startDay < $1.startDay }) {
            let x0 = max(SeasonTimeline.x(event.startDay, domain: domain, width: width), lastMaxX + 1.5)
            let x1 = SeasonTimeline.x(event.endDay.adding(days: 1), domain: domain, width: width)
            let rect = CGRect(x: x0, y: (stripHeight - stripMark) / 2, width: max(x1 - x0, 4), height: stripMark)
            marks.append(SeasonTimeline.Mark(event: event.id, lane: "", rect: rect))
            lastMaxX = rect.maxX
        }
        return marks
    }
}

/// The page's action for a mark clicked in the docked bar, refreshed on
/// every page render. A reference, so the bar (equatable) never re-renders
/// for a new closure and always acts on the page as it is now.
@MainActor
final class SeasonDockActions {
    var reveal: (String) -> Void = { _ in }
}

// MARK: - The card

/// The glass card at the top of a season page: the summary (with an action
/// beside it while something's live), the timeline and its readout. The
/// timeline and the list's rows light each other through `hover`.
struct SeasonCard<Accessory: View>: View {
    let summary: SeasonSummary
    let axis: SeasonAxis
    let hover: HighlightState
    let onSelect: (String) -> Void
    @ViewBuilder var accessory: Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                SeasonHeadline(summary: summary)
                Spacer(minLength: 0)
                accessory
            }
            // Hovering re-runs this piece, not the card or the page.
            HoverReader(state: hover) { hovered in
                VStack(alignment: .leading, spacing: 6) {
                    SeasonTimeline(events: axis.events, lanes: axis.lanes, today: axis.today, next: axis.next, selected: axis.selected,
                                   hovered: Binding(get: { hover.id }, set: { if hover.id != $0 { hover.id = $0 } }), onSelect: onSelect)
                    if let readout = axis.readout(hovered: hovered) {
                        Text(readout)
                            .font(.system(size: 10.5).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .padding(.leading, SeasonTimeline.labelWidth)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 11)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        // Regular glass: the season pages have no wash for clear glass to refract.
        .floatingGlass(in: RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous), interactive: false)
        .accessibilityElement(children: .contain)
        // Scrolling away, it shrinks toward the header and fades as the bar takes over.
        .heroTuck()
        .pageSection(PageGeometry.hero)
    }
}

private struct SeasonHeadline: View {
    let summary: SeasonSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                if summary.live { LiveDot() }
                Text(summary.headline).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            }
            if let subline = summary.subline {
                Text(subline)
                    .font(.system(size: 11.5).monospacedDigit())
                    .foregroundStyle(summary.sublineLive ? AnyShapeStyle(Color.red) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - The docked bar

/// The card, docked: the summary on one line (the readout of whatever's
/// under the pointer, when something is) over a slim strip of the whole
/// season. Clicking the line goes back to the top; the strip's marks hover
/// and click as the timeline's do. Equatable on what it shows: its host
/// re-renders every dock step, and this body doesn't run again.
struct SeasonDockBar: View {
    let summary: SeasonSummary
    let axis: SeasonAxis
    let hover: HighlightState
    let actions: SeasonDockActions
    @Environment(\.pageGeometry) private var geometry
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if DEBUG
    /// Harness counter: body runs (a dock step must add none).
    static var bodyRuns = 0
    #endif

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 14, style: .continuous) }

    var body: some View {
        #if DEBUG
        let _ = Self.bodyRuns += 1
        #endif
        VStack(alignment: .leading, spacing: 4) {
            // Back to the top: the card again (animated; instant with Reduce Motion).
            Button { geometry?.scroll(toY: 0, animated: !reduceMotion) } label: {
                HoverReader(state: hover) { hovered in
                    SeasonDockLine(summary: summary, line: SeasonDock.line(summary, hovered: hovered, axis: axis))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Back to top")
            HoverReader(state: hover) { hovered in
                SeasonStrip(axis: axis, hovered: hovered,
                            onHover: { id in if hover.id != id { hover.id = id } },
                            onSelect: { actions.reveal($0) })
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 7)
        .frame(height: SeasonDock.barHeight)
        .dockedBarGlass(in: shape)
        // The card stays the canonical element: no duplicate reading.
        .accessibilityHidden(true)
    }
}

/// Isolated to the main actor, like the view.
extension SeasonDockBar: @MainActor Equatable {
    static func == (a: Self, b: Self) -> Bool {
        a.summary == b.summary && a.axis == b.axis && a.hover === b.hover && a.actions === b.actions
    }
}

private struct SeasonDockLine: View {
    let summary: SeasonSummary
    let line: (lead: String, trail: String?)

    var body: some View {
        HStack(spacing: 6) {
            if summary.live, line.trail != nil { LiveDot() }
            Text(line.lead)
                .font(.system(size: 12, weight: line.trail == nil ? .medium : .semibold).monospacedDigit())
                .lineLimit(1)
                .layoutPriority(1)
            if let trail = line.trail {
                Text(trail)
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(summary.sublineLive ? AnyShapeStyle(Color.red) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
            }
        }
        .frame(height: 16)
    }
}

/// The season on one slim lane: every competition a mark, today a hairline,
/// colored by state as the timeline is. One Canvas, one hover target.
private struct SeasonStrip: View {
    let axis: SeasonAxis
    let hovered: String?
    let onHover: (String?) -> Void
    let onSelect: (String) -> Void
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let domain = SeasonTimeline.domain(axis.events)
        GeometryReader { geo in
            let marks = SeasonDock.strip(axis.events, domain: domain, width: geo.size.width)
            Canvas { context, size in
                draw(&context, size: size, domain: domain, marks: marks)
            }
            .onContinuousHover { phase in
                switch phase {
                case let .active(point): onHover(SeasonTimeline.hit(marks, at: point))
                case .ended: onHover(nil)
                }
            }
            .gesture(SpatialTapGesture().onEnded { value in
                if let id = SeasonTimeline.hit(marks, at: value.location) { onSelect(id) }
            })
        }
        .frame(height: SeasonDock.stripHeight)
    }

    private func draw(_ context: inout GraphicsContext, size: CGSize, domain: (DayKey, DayKey), marks: [SeasonTimeline.Mark]) {
        // Month boundaries, faint.
        var month = DayKey(year: domain.0.year, month: domain.0.month, day: 1)
        while month <= domain.1 {
            let x = SeasonTimeline.x(month, domain: domain, width: size.width)
            if x > 0 {
                var tick = Path()
                tick.move(to: CGPoint(x: x, y: 1))
                tick.addLine(to: CGPoint(x: x, y: size.height - 1))
                context.stroke(tick, with: .color(Color.primary.opacity(0.1)), lineWidth: 0.5)
            }
            month = DayKey(year: month.month == 12 ? month.year + 1 : month.year, month: month.month % 12 + 1, day: 1)
        }
        if domain.0 <= axis.today && axis.today <= domain.1 {
            let x = SeasonTimeline.x(axis.today, domain: domain, width: size.width) + 0.5
            var line = Path()
            line.move(to: CGPoint(x: x, y: 0))
            line.addLine(to: CGPoint(x: x, y: size.height))
            context.stroke(line, with: .color(.accentColor.opacity(0.8)), lineWidth: 1)
        }
        let byID = Dictionary(axis.events.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for mark in marks {
            guard let event = byID[mark.event] else { continue }
            let radius = SeasonDock.stripMark / 2
            context.fill(Path(roundedRect: mark.rect, cornerRadius: radius), with: .color(fill(for: event)))
            if mark.event == hovered || mark.event == axis.selected {
                context.stroke(Path(roundedRect: mark.rect.insetBy(dx: -2, dy: -2), cornerRadius: radius + 2),
                               with: .color(Color.primary.opacity(0.75)), lineWidth: 1.25)
            }
        }
    }

    /// The timeline's colors: only state.
    private func fill(for event: SeasonEvent) -> Color {
        switch event.status {
        case .live: return .red
        case .finished: return Color.primary.opacity(0.22)
        case .canceled: return Color.primary.opacity(0.08)
        case .upcoming:
            if event.id == axis.next { return .accentColor }
            return Color.primary.opacity(contrast == .increased ? 0.6 : 0.42)
        }
    }
}

// MARK: - Keys

/// The arrow keys keep the highlighted row in view, clear of the docked bar
/// (hovering doesn't scroll). Keyboard actions never animate.
struct DockedHighlightScroll: ViewModifier {
    let state: HighlightState
    let geometry: PageGeometry
    let keyboardDriven: () -> Bool

    func body(content: Content) -> some View {
        content.onChange(of: state.id) { _, id in
            guard let id, keyboardDriven() else { return }
            geometry.reveal(anchor: id, topInset: SeasonDock.reserve, animated: false)
        }
    }
}
