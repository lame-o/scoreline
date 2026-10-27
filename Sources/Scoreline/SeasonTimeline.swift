import SwiftUI

/// A season on one time axis: one lane per discipline (climbing) or a single
/// S-Tier lane (CS2), each competition a short capsule from its first day to its last.
/// Position says when, the lane label says what; color only says state
/// (finished, upcoming, next, live). One Canvas, one hover target.
struct SeasonTimeline: View {
    struct Lane: Hashable, Identifiable {
        let id: String
        let label: String
    }

    struct Mark: Hashable {
        let event: String
        let lane: String
        let rect: CGRect
    }

    let events: [SeasonEvent]
    let lanes: [Lane]
    let today: DayKey
    /// The next event (accent), when nothing is live.
    let next: String?
    /// The event open beside the list (split panel), ringed like a hover.
    var selected: String? = nil
    /// Lanes outside the user's interests draw faintly.
    var dimmedLanes: Set<String> = []
    /// Linked with the list below: hovering either highlights both.
    @Binding var hovered: String?
    let onSelect: (String) -> Void
    @Environment(\.colorSchemeContrast) private var contrast

    static let laneHeight: CGFloat = 16
    static let markHeight: CGFloat = 6
    static let labelWidth: CGFloat = 54
    static let axisHeight: CGFloat = 16

    private var height: CGFloat { CGFloat(lanes.count) * Self.laneHeight + Self.axisHeight }

    var body: some View {
        let domain = Self.domain(events)
        GeometryReader { geo in
            let plot = max(geo.size.width - Self.labelWidth, 10)
            let marks = Self.layout(events: events, lanes: lanes, domain: domain, width: plot)
            Canvas { context, size in
                draw(&context, size: size, plot: plot, domain: domain, marks: marks)
            }
            .onContinuousHover { phase in
                switch phase {
                case let .active(point): hovered = Self.hit(marks, at: CGPoint(x: point.x - Self.labelWidth, y: point.y))
                case .ended: hovered = nil
                }
            }
            .gesture(SpatialTapGesture().onEnded { value in
                if let id = Self.hit(marks, at: CGPoint(x: value.location.x - Self.labelWidth, y: value.location.y)) { onSelect(id) }
            })
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
    }

    private var summary: String {
        guard let first = events.first, let last = events.last else { return "No events" }
        var text = "\(events.count) events, \(first.startDay.longLabel) to \(last.endDay.longLabel)"
        if let next = events.first(where: { $0.id == next }) { text += ". Next: \(next.shortName), \(DayKey.range(next.startDay, next.endDay))" }
        return text
    }

    // MARK: Drawing

    private func draw(_ context: inout GraphicsContext, size: CGSize, plot: CGFloat, domain: (DayKey, DayKey), marks: [Mark]) {
        let left = Self.labelWidth
        // Month ticks and labels along the bottom.
        var month = DayKey(year: domain.0.year, month: domain.0.month, day: 1)
        let axisY = CGFloat(lanes.count) * Self.laneHeight
        while month <= domain.1 {
            let x = left + Self.x(month, domain: domain, width: plot)
            var tick = Path()
            tick.move(to: CGPoint(x: x, y: 0))
            tick.addLine(to: CGPoint(x: x, y: axisY))
            context.stroke(tick, with: .color(Color.primary.opacity(0.08)), lineWidth: 0.5)
            let label = Text(month.displayDate.formatted(.dateTime.month(.abbreviated)))
                .font(.system(size: 10)).foregroundStyle(.secondary)
            context.draw(label, at: CGPoint(x: x + 3, y: axisY + 3), anchor: .topLeading)
            month = DayKey(year: month.month == 12 ? month.year + 1 : month.year, month: month.month % 12 + 1, day: 1)
        }
        // Lane labels.
        for (i, lane) in lanes.enumerated() {
            let y = CGFloat(i) * Self.laneHeight + Self.laneHeight / 2
            let label = Text(lane.label).font(.system(size: 10)).foregroundStyle(dimmedLanes.contains(lane.id) ? .tertiary : .secondary)
            context.draw(label, at: CGPoint(x: 0, y: y), anchor: .leading)
        }
        // Today.
        if domain.0 <= today && today <= domain.1 {
            let x = left + Self.x(today, domain: domain, width: plot) + 0.5
            var line = Path()
            line.move(to: CGPoint(x: x, y: 0))
            line.addLine(to: CGPoint(x: x, y: axisY))
            context.stroke(line, with: .color(.accentColor.opacity(0.8)), lineWidth: 1)
        }
        // Marks.
        let byID = Dictionary(events.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for mark in marks {
            guard let event = byID[mark.event] else { continue }
            let rect = mark.rect.offsetBy(dx: left, dy: 0)
            let shape = Path(roundedRect: rect, cornerRadius: Self.markHeight / 2)
            var color = fill(for: event)
            if dimmedLanes.contains(mark.lane) { color = color.opacity(0.35) }
            context.fill(shape, with: .color(color))
            if event.badge == "World Championships" || event.badge == "Major" || event.badge == "Olympic Games" {
                context.stroke(Path(roundedRect: rect.insetBy(dx: -1.5, dy: -1.5), cornerRadius: Self.markHeight / 2 + 1.5),
                               with: .color(Color.primary.opacity(0.35)), lineWidth: 1)
            }
            if mark.event == hovered || mark.event == selected {
                context.stroke(Path(roundedRect: rect.insetBy(dx: -2.5, dy: -2.5), cornerRadius: Self.markHeight / 2 + 2.5),
                               with: .color(Color.primary.opacity(0.75)), lineWidth: 1.5)
            }
        }
    }

    private func fill(for event: SeasonEvent) -> Color {
        switch event.status {
        case .live: return .red
        case .finished: return Color.primary.opacity(0.18)
        case .canceled: return Color.primary.opacity(0.08)
        case .upcoming:
            if event.id == next { return .accentColor }
            return Color.primary.opacity(contrast == .increased ? 0.6 : 0.42)
        }
    }

    // MARK: Geometry (pure)

    /// From the first day of the first event's month to the last day of the last event's month.
    static func domain(_ events: [SeasonEvent]) -> (DayKey, DayKey) {
        guard let first = events.map(\.startDay).min(), let last = events.map(\.endDay).max() else {
            let today = DayKey.today()
            return (today, today.adding(days: 30))
        }
        let start = DayKey(year: first.year, month: first.month, day: 1)
        let nextMonth = DayKey(year: last.month == 12 ? last.year + 1 : last.year, month: last.month % 12 + 1, day: 1)
        return (start, nextMonth.adding(days: -1))
    }

    static func x(_ day: DayKey, domain: (DayKey, DayKey), width: CGFloat) -> CGFloat {
        let total = CGFloat(max(domain.0.days(to: domain.1) + 1, 1))
        return CGFloat(domain.0.days(to: day)) / total * width
    }

    /// Mark rectangles in plot coordinates: at least 6pt wide, and 2pt clear
    /// of the previous mark in the same lane (the surface gap between fills).
    static func layout(events: [SeasonEvent], lanes: [Lane], domain: (DayKey, DayKey), width: CGFloat) -> [Mark] {
        var marks: [Mark] = []
        for (row, lane) in lanes.enumerated() {
            var lastMaxX: CGFloat = -.infinity
            for event in events.filter({ $0.lanes.contains(lane.id) }).sorted(by: { $0.startDay < $1.startDay }) {
                var x0 = x(event.startDay, domain: domain, width: width)
                let x1 = x(event.endDay.adding(days: 1), domain: domain, width: width)
                x0 = max(x0, lastMaxX + 2)
                let w = max(x1 - x0, 6)
                let rect = CGRect(x: x0, y: CGFloat(row) * laneHeight + (laneHeight - markHeight) / 2, width: w, height: markHeight)
                marks.append(Mark(event: event.id, lane: lane.id, rect: rect))
                lastMaxX = rect.maxX
            }
        }
        return marks
    }

    /// The mark under the pointer (with a little slack), else the nearest within 10pt in its lane.
    static func hit(_ marks: [Mark], at point: CGPoint) -> String? {
        if let direct = marks.first(where: { $0.rect.insetBy(dx: -3, dy: -5).contains(point) }) { return direct.event }
        let lane = marks.filter { abs($0.rect.midY - point.y) <= laneHeight / 2 }
        return lane.min { abs($0.rect.midX - point.x) < abs($1.rect.midX - point.x) }
            .flatMap { abs($0.rect.midX - point.x) <= 10 ? $0.event : nil }
    }
}
