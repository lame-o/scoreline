import SwiftUI

/// Key moments on the same wall-clock axis as Win Probability. Match clocks
/// are labels from reported plays, never an interpolation through stoppages.
/// Hover only updates the small scrub/readout leaves; the tracks and markers
/// stay still, and inspecting history never seeks the broadcast theater.
struct MatchTimeline: View {
    let history: MatchHistory
    let domain: ClosedRange<Date>
    let names: (top: String, bottom: String)
    let palette: TeamPalette
    let pointer: OddsPointer
    let labelWidth: CGFloat
    let final: Bool

    private static let plotHeight: CGFloat = 76

    var body: some View {
        let events = history.keyEvents.filter { domain.contains($0.t) }
        let topColor = OddsStyle.line(palette.top), bottomColor = OddsStyle.line(palette.bottom)
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geometry in
                let layout = OddsLayout(size: geometry.size, plotHeight: Self.plotHeight, domain: domain, labelWidth: labelWidth)
                ZStack(alignment: .topLeading) {
                    MatchTimelineStill(events: events, periods: history.periods, layout: layout,
                                       topColor: topColor, bottomColor: bottomColor)
                        .equatable()
                    labels(layout)
                    MatchTimelineScrub(history: history, events: events, layout: layout,
                                       topColor: topColor, bottomColor: bottomColor, pointer: pointer)
                }
            }
            .frame(height: Self.plotHeight + OddsStyle.axis)
            // This padding is deliberately identical to OddsPlot's. Both
            // modules reserve its 30pt left gutter and the odds-label column.
            .vizWell(padding: 8)
            MatchTimelineReadout(history: history, domain: domain, pointer: pointer)
            MatchInspectionControls(history: history, domain: domain, pointer: pointer, final: final)
            if history.hasUntimedEvents || history.missingTimeCount > 0 {
                Text("Some plays have no event timestamp and cannot be aligned with odds.")
                    .font(Viz.note).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func labels(_ layout: OddsLayout) -> some View {
        Text(names.top).font(Viz.tick).foregroundStyle(OddsStyle.line(palette.top))
            .lineLimit(1)
            .frame(width: OddsStyle.gutter - 5, alignment: .trailing)
            .position(x: (OddsStyle.gutter - 5) / 2, y: MatchTimelineGeometry.y(.top, layout: layout))
        Text(names.bottom).font(Viz.tick).foregroundStyle(OddsStyle.line(palette.bottom))
            .lineLimit(1)
            .frame(width: OddsStyle.gutter - 5, alignment: .trailing)
            .position(x: (OddsStyle.gutter - 5) / 2, y: MatchTimelineGeometry.y(.bottom, layout: layout))
        let labels = history.periods.isEmpty ? OddsPlot.hourLabels(layout) : OddsPlot.periodLabels(history.periods, layout: layout)
        ForEach(labels, id: \.x) { label in
            Text(label.label).font(Viz.tick).foregroundStyle(.secondary).fixedSize()
                .position(x: label.x, y: Self.plotHeight + 8)
        }
    }
}

/// Geometry stays in timestamp space, including breaks between periods. The
/// nearest mark wins only within a small two-dimensional target; hovering a
/// distant part of the lane must not jump to an unrelated goal or touchdown.
enum MatchTimelineGeometry {
    static func y(_ side: GameDetail.Side?, layout: OddsLayout) -> CGFloat {
        switch side {
        case .top: layout.plot.minY + layout.plot.height * 0.25
        case .bottom: layout.plot.minY + layout.plot.height * 0.75
        case nil: layout.plot.midY
        }
    }

    static func point(_ event: MatchHistory.Event, layout: OddsLayout) -> CGPoint {
        CGPoint(x: layout.x(event.t), y: y(event.side, layout: layout))
    }

    static func target(at location: CGPoint, events: [MatchHistory.Event], layout: OddsLayout) -> MatchHistory.Event? {
        var best: (event: MatchHistory.Event, distance: CGFloat)?
        for event in events {
            let at = point(event, layout: layout)
            let distance = hypot(at.x - location.x, at.y - location.y)
            if distance <= 11, distance < (best?.distance ?? .infinity) { best = (event, distance) }
        }
        return best?.event
    }

    static func time(at location: CGPoint, events: [MatchHistory.Event], layout: OddsLayout) -> Date {
        if let event = target(at: location, events: events, layout: layout) { return event.t }
        let t = layout.time(at: min(max(location.x, layout.plot.minX), layout.plot.maxX))
        // Whole seconds keep the small readout stable without the old one-
        // minute quantization losing a goal and its immediate price reaction.
        return min(max(Date(timeIntervalSince1970: t.timeIntervalSince1970.rounded()), layout.domain.lowerBound), layout.domain.upperBound)
    }

    static func draw(_ event: MatchHistory.Event, at point: CGPoint, in context: GraphicsContext,
                     topColor: Color, bottomColor: Color, emphasized: Bool = false) {
        let teamColor = event.side == .bottom ? bottomColor : event.side == .top ? topColor : Viz.neutral
        let shape: Path
        let color: Color
        switch event.kind {
        case .yellow, .red:
            shape = Path(roundedRect: CGRect(x: point.x - 2.5, y: point.y - 4, width: 5, height: 8), cornerRadius: 1)
            color = event.kind == .yellow ? .yellow : .red
        case .timeout:
            shape = Path { path in
                path.move(to: CGPoint(x: point.x, y: point.y - 3.5))
                path.addLine(to: CGPoint(x: point.x + 3.5, y: point.y))
                path.addLine(to: CGPoint(x: point.x, y: point.y + 3.5))
                path.addLine(to: CGPoint(x: point.x - 3.5, y: point.y))
                path.closeSubpath()
            }
            color = Viz.neutral
        case .period:
            shape = Path(roundedRect: CGRect(x: point.x - 1.5, y: point.y - 5, width: 3, height: 10), cornerRadius: 1)
            color = Viz.reference
        case .goal, .ownGoal, .score, .play:
            let radius: CGFloat = event.kind == .play ? 2.5 : 4
            shape = Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
            color = teamColor
        }
        context.fill(shape, with: .color(color))
        if event.kind == .ownGoal {
            context.stroke(Path(ellipseIn: CGRect(x: point.x - 1.5, y: point.y - 1.5, width: 3, height: 3)),
                           with: .color(Viz.ink(on: color)), lineWidth: 1)
        }
        if emphasized {
            context.stroke(Path(ellipseIn: CGRect(x: point.x - 7, y: point.y - 7, width: 14, height: 14)),
                           with: .color(.primary), lineWidth: 1)
        }
    }
}

private struct MatchTimelineStill: View, Equatable {
    let events: [MatchHistory.Event]
    let periods: [OddsPeriod]
    let layout: OddsLayout
    let topColor: Color
    let bottomColor: Color

    var body: some View {
        Canvas { context, _ in
            for (index, period) in periods.enumerated() {
                let start = max(layout.x(period.start), layout.plot.minX)
                let end = min(layout.x(period.end), layout.plot.maxX)
                if end > start, index.isMultiple(of: 2) {
                    context.fill(Path(CGRect(x: start, y: layout.plot.minY, width: end - start, height: layout.plot.height)),
                                 with: .color(Viz.track))
                }
                if layout.domain.contains(period.start) {
                    var boundary = Path()
                    boundary.move(to: CGPoint(x: start, y: layout.plot.minY))
                    boundary.addLine(to: CGPoint(x: start, y: layout.plot.maxY))
                    context.stroke(boundary, with: .color(Viz.grid), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                }
            }
            for side in [GameDetail.Side.top, .bottom] {
                let y = MatchTimelineGeometry.y(side, layout: layout)
                var lane = Path()
                lane.move(to: CGPoint(x: layout.plot.minX, y: y))
                lane.addLine(to: CGPoint(x: layout.plot.maxX, y: y))
                context.stroke(lane, with: .color(Viz.baseline), lineWidth: 1)
            }
            for event in events {
                MatchTimelineGeometry.draw(event, at: MatchTimelineGeometry.point(event, layout: layout), in: context,
                                           topColor: topColor, bottomColor: bottomColor)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct MatchTimelineScrub: View {
    let history: MatchHistory
    let events: [MatchHistory.Event]
    let layout: OddsLayout
    let topColor: Color
    let bottomColor: Color
    let pointer: OddsPointer
    @FocusState private var focused: Bool
    @State private var hovered: Date?

    var body: some View {
        Button {
            focused = true
            pointer.pin(hovered ?? pointer.moment ?? layout.domain.upperBound)
        } label: {
            ZStack(alignment: .topLeading) {
                Color.clear
                OddsMoment(pointer: pointer) { moment in
                    Canvas { context, _ in
                        if let moment, layout.domain.contains(moment) {
                            var rule = Path()
                            rule.move(to: CGPoint(x: layout.x(moment), y: layout.plot.minY - 3))
                            rule.addLine(to: CGPoint(x: layout.x(moment), y: layout.plot.maxY + 3))
                            context.stroke(rule, with: .color(Viz.reference), lineWidth: 1)
                            // Multiple events can share a timestamp; emphasize
                            // them all rather than choosing a different team's.
                            for event in events where abs(event.t.timeIntervalSince(moment)) < 0.5 {
                                MatchTimelineGeometry.draw(event, at: MatchTimelineGeometry.point(event, layout: layout), in: context,
                                                           topColor: topColor, bottomColor: bottomColor, emphasized: true)
                            }
                        }
                    }
                }
            }
            .frame(width: layout.bounds.width, height: layout.bounds.height + OddsStyle.axis)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onContinuousHover { phase in
            switch phase {
            case let .active(location):
                guard location.x >= layout.plot.minX, location.x <= layout.plot.maxX else {
                    hovered = nil
                    if !focused { pointer.hover(nil) }
                    return
                }
                let next = MatchTimelineGeometry.time(at: location, events: events, layout: layout)
                if hovered != next { hovered = next }
                pointer.hover(next)
            case .ended:
                hovered = nil
                if !focused { pointer.hover(nil) }
            }
        }
        // Arrow-key inspection must work even when Keyboard Navigation is off.
        .focusable(interactions: .edit)
        .focusEffectDisabled()
        .focused($focused)
        .onChange(of: focused) { _, on in
            if on, pointer.moment == nil { pointer.hover(layout.domain.upperBound) }
            if !on { pointer.hover(nil) }
        }
        .onKeyPress(.leftArrow) { move(forward: false) ? .handled : .ignored }
        .onKeyPress(.rightArrow) { move(forward: true) ? .handled : .ignored }
        .onKeyPress(.escape) {
            guard pointer.active else { return .ignored }
            pointer.clear()
            return .handled
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Match timeline, \(events.count) key events")
        .accessibilityValue(accessibleReading)
        .accessibilityHint("Use previous and next event actions to inspect history alongside win probability. Inspection does not change live playback.")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: _ = move(forward: true)
            case .decrement: _ = move(forward: false)
            @unknown default: break
            }
        }
        .accessibilityAction(named: "Previous key event") { _ = move(forward: false) }
        .accessibilityAction(named: "Next key event") { _ = move(forward: true) }
        .accessibilityAction(named: "Return to latest") { pointer.clear() }
        .onDisappear { pointer.hover(nil) }
    }

    private var accessibleReading: String {
        let at = pointer.moment ?? layout.domain.upperBound
        let matches = history.keyEvents.filter { abs($0.t.timeIntervalSince(at)) < 0.5 }
        let context = matches.isEmpty ? history.context(at: at).map { [$0] } ?? [] : matches
        let summary = context.map { "\($0.clock). \($0.text)" }.joined(separator: ". ")
        return "\(at.formatted(.dateTime.hour().minute().second())). \(summary.isEmpty ? "No reported play at this time." : summary)"
    }

    @discardableResult
    private func move(forward: Bool) -> Bool {
        MatchInspectionControls.select(forward: forward, history: history, domain: layout.domain, pointer: pointer)
    }
}

/// Both modules use the same event-navigation controls. A pin is persistent;
/// live updates never move it. Navigating outside a recent window switches
/// back to Game so the chosen event remains visible in both modules.
struct MatchInspectionControls: View {
    let history: MatchHistory
    let domain: ClosedRange<Date>
    let pointer: OddsPointer
    let final: Bool

    var body: some View {
        HStack(spacing: 8) {
            Button {
                Self.select(forward: false, history: history, domain: domain, pointer: pointer)
            } label: {
                Label("Previous event", systemImage: "chevron.left").labelStyle(.iconOnly)
            }
            .disabled(Self.destination(forward: false, history: history, domain: domain, moment: pointer.moment) == nil)
            .help("Previous key event")
            Button {
                Self.select(forward: true, history: history, domain: domain, pointer: pointer)
            } label: {
                Label("Next event", systemImage: "chevron.right").labelStyle(.iconOnly)
            }
            .disabled(Self.destination(forward: true, history: history, domain: domain, moment: pointer.moment) == nil)
            .help("Next key event")
            Text(pointer.pinned ? "Pinned" : "Hover to inspect · click to pin")
                .font(Viz.note).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 0)
            if pointer.active {
                Button(final ? "Latest" : "Live", systemImage: "arrow.uturn.backward") { pointer.clear() }
                    .help(final ? "Return to the final values" : "Return to the current broadcast time")
            }
        }
        .controlSize(.small)
    }

    static func destination(forward: Bool, history: MatchHistory, domain: ClosedRange<Date>, moment: Date?) -> MatchHistory.Event? {
        if forward { return history.next(after: moment ?? domain.lowerBound - 0.001) }
        return history.previous(before: moment ?? domain.upperBound + 0.001)
    }

    @MainActor
    @discardableResult
    static func select(forward: Bool, history: MatchHistory, domain: ClosedRange<Date>, pointer: OddsPointer) -> Bool {
        guard let event = destination(forward: forward, history: history, domain: domain, moment: pointer.moment) else { return false }
        if !domain.contains(event.t) { pointer.window = .game }
        pointer.pin(event.t)
        return true
    }
}

private struct MatchTimelineReadout: View {
    let history: MatchHistory
    let domain: ClosedRange<Date>
    let pointer: OddsPointer

    var body: some View {
        OddsMoment(pointer: pointer) { moment in
            let at = moment ?? domain.upperBound
            // Corrected provider times may place several plays at one
            // instant. Name all key events there, rather than letting a
            // substitution at the same timestamp hide the selected score.
            let exact = moment == nil ? [] : history.keyEvents.filter { abs($0.t.timeIntervalSince(at)) < 0.5 }
            let event = exact.last ?? history.context(at: at)
            VStack(alignment: .leading, spacing: 3) {
                if let event {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(event.clock.isEmpty ? OddsBaseline.periodLabel(event.period, sport: history.sport) : event.clock)
                            .font(Viz.value)
                        Text(moment == nil ? "Latest reported play" : abs(event.t.timeIntervalSince(at)) < 0.5 ? "Reported play" : "Last reported play")
                            .font(Viz.note).foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                        Text(at.formatted(.dateTime.hour().minute().second())).font(Viz.tick).foregroundStyle(.secondary)
                    }
                    Text(exact.isEmpty ? event.text : exact.map(\.text).joined(separator: " · "))
                        .font(Viz.note).foregroundStyle(.secondary)
                        .lineLimit(3).fixedSize(horizontal: false, vertical: true)
                    if let score = event.score {
                        Text("Score after play: \(score)").font(Viz.value).foregroundStyle(.secondary)
                    }
                    if event.timing == .adjusted || exact.contains(where: { $0.timing == .adjusted }) {
                        Text("Event time adjusted to preserve play order.")
                            .font(Viz.tick).foregroundStyle(.secondary)
                    }
                } else {
                    Text(history.events.isEmpty ? "Event timestamps are unavailable for this game." : "No reported play at or before this moment.")
                        .font(Viz.note).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if moment != nil {
                        Text(at.formatted(.dateTime.hour().minute().second())).font(Viz.tick).foregroundStyle(.secondary)
                    }
                }
            }
            .frame(minHeight: 104, alignment: .topLeading)
            .accessibilityElement(children: .combine)
        }
    }
}
