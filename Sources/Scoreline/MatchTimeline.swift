import SwiftUI

/// Key moments on the same wall-clock axis as Win Probability. Match clocks
/// are labels from reported plays, never an interpolation through stoppages.
/// Hover only updates the small scrub/readout leaves; the tracks and markers
/// stay still, and inspecting history never seeks the broadcast theater.
enum MatchTimelineStyle {
    // Match the original SoccerTimeline's vertical rhythm. Horizontal space
    // still belongs to OddsLayout so market and event timestamps stay aligned.
    static let height: CGFloat = 60
    static let plotHeight: CGFloat = 48
    static let rowY: CGFloat = 54
    static let teamOffset: CGFloat = 14
}

struct MatchTimeline: View {
    let history: MatchHistory
    let domain: ClosedRange<Date>
    let names: (top: String, bottom: String)
    let palette: TeamPalette
    let pointer: OddsPointer
    let labelWidth: CGFloat
    let final: Bool

    private var singleRail: Bool { history.sport == .football }

    var body: some View {
        let events = history.keyEvents.filter { domain.contains($0.t) }
        let topColor = OddsStyle.line(palette.top), bottomColor = OddsStyle.line(palette.bottom)
        GeometryReader { geometry in
            let layout = OddsLayout(size: geometry.size, plotHeight: MatchTimelineStyle.plotHeight,
                                    domain: domain, labelWidth: labelWidth)
            let rail = singleRail ? MatchTimelineRail.marks(events: events, layout: layout) : nil
            ZStack(alignment: .topLeading) {
                MatchTimelineStill(events: events, periods: history.periods, layout: layout, rail: rail,
                                   topColor: topColor, bottomColor: bottomColor, live: !final)
                    .equatable()
                teamLabels(layout).accessibilityHidden(true)
                MatchTimelineScrub(history: history, events: events, names: names, layout: layout, rail: rail,
                                   topColor: topColor, bottomColor: bottomColor, pointer: pointer)
                MatchTimelineAxis(history: history, domain: domain, names: names,
                                  layout: layout, pointer: pointer, final: final)
            }
        }
        .frame(height: MatchTimelineStyle.height)
        // OddsPlot's well contributes the same inset. Keep just that geometry,
        // with no box or vertical padding, to preserve the shared time scale.
        .padding(.horizontal, 8)
    }

    private func teamLabels(_ layout: OddsLayout) -> some View {
        VStack(spacing: 0) {
            teamLabel(names.top, color: OddsStyle.line(palette.top), symbol: "●")
            Spacer(minLength: 0)
            teamLabel(names.bottom, color: OddsStyle.line(palette.bottom), symbol: "◆")
        }
        .frame(width: OddsStyle.gutter - 2, height: 40)
        .position(x: OddsStyle.gutter / 2 - 2, y: layout.plot.midY)
    }

    private func teamLabel(_ name: String, color: Color, symbol: String) -> some View {
        HStack(spacing: 2) {
            if singleRail {
                Text(symbol).font(.system(size: 7)).foregroundStyle(color)
            }
            Text(name).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(height: 12)
    }
}

/// Only this small row observes selection. Like soccer, event detail takes
/// the axis labels' place, never an extra row below the timeline.
private struct MatchTimelineAxis: View {
    let history: MatchHistory
    let domain: ClosedRange<Date>
    let names: (top: String, bottom: String)
    let layout: OddsLayout
    let pointer: OddsPointer
    let final: Bool

    var body: some View {
        Group {
            if pointer.moment != nil {
                HStack(spacing: 4) {
                    MatchTimelineReadout(history: history, domain: domain, names: names, pointer: pointer)
                    if pointer.pinned {
                        Button { pointer.clear() } label: {
                            Image(systemName: "arrow.uturn.backward")
                                .font(.system(size: 10, weight: .medium))
                                .frame(width: 18, height: 16)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(final ? "Latest" : "Live")
                        .help(final ? "Return to the final values" : "Return to the current broadcast time")
                    }
                }
                .frame(width: layout.bounds.width - OddsStyle.gutter, alignment: .leading)
                .position(x: OddsStyle.gutter + (layout.bounds.width - OddsStyle.gutter) / 2,
                          y: MatchTimelineStyle.rowY)
            } else {
                let labels = history.periods.isEmpty ? OddsPlot.hourLabels(layout) : OddsPlot.periodLabels(history.periods, layout: layout)
                ForEach(labels, id: \.x) { label in
                    Text(label.label).font(Viz.tick).foregroundStyle(.secondary).fixedSize()
                        .position(x: label.x, y: MatchTimelineStyle.rowY)
                }
                .accessibilityHidden(true)
            }
        }
    }
}

/// Geometry stays in timestamp space, including breaks between periods. The
/// nearest mark wins only within a small two-dimensional target; hovering a
/// distant part of the lane must not jump to an unrelated goal or touchdown.
enum MatchTimelineGeometry {
    static func y(_ side: GameDetail.Side?, layout: OddsLayout) -> CGFloat {
        switch side {
        case .top: layout.plot.midY - MatchTimelineStyle.teamOffset
        case .bottom: layout.plot.midY + MatchTimelineStyle.teamOffset
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
        let time = layout.inspectionTime(at: location.x)
        // Both modules must reach their exact endpoints even when a nearby
        // scoring marker is inside the timeline's generous hit target.
        guard location.x > layout.plot.minX, location.x < layout.plot.maxX else { return time }
        return target(at: location, events: events, layout: layout)?.t ?? time
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

/// Football has one scoring rail. Plays within an 8pt column form a counted
/// marker rather than drawing over one another. The small connector preserves
/// the group's actual time extent; hover/navigation still select real event
/// timestamps, and the shared crosshair never moves to a group's visual center.
enum MatchTimelineRail {
    struct Mark: Equatable {
        let events: [MatchHistory.Event]
        let point: CGPoint
        var radius: CGFloat { events.count > 1 ? 7 : 4 }
    }

    static func marks(events: [MatchHistory.Event], layout: OddsLayout) -> [Mark] {
        let buckets = Dictionary(grouping: events) { Int(floor((layout.x($0.t) - layout.plot.minX) / 8)) }
        var ends = Array(repeating: -CGFloat.infinity, count: 3)
        let offsets: [CGFloat] = [0, -12, 12]
        return buckets.keys.sorted().compactMap { key in
            guard let group = buckets[key]?.sorted(by: { $0.t < $1.t }), let first = group.first, let last = group.last else { return nil }
            let x = (layout.x(first.t) + layout.x(last.t)) / 2
            let radius: CGFloat = group.count > 1 ? 7 : 4
            // Offsets resolve local density only, independently of team. An
            // 8pt bin and three 14pt-wide slots guarantee nonoverlap without
            // growing the module or creating separate team tracks.
            let slot = ends.firstIndex(where: { x - radius >= $0 + 1 }) ?? ends.indices.min(by: { ends[$0] < ends[$1] }) ?? 0
            ends[slot] = x + radius
            return Mark(events: group, point: CGPoint(x: x, y: layout.plot.midY + offsets[slot]))
        }
    }

    static func target(at location: CGPoint, marks: [Mark], layout: OddsLayout) -> MatchHistory.Event? {
        guard let mark = marks.min(by: { hypot($0.point.x - location.x, $0.point.y - location.y)
            < hypot($1.point.x - location.x, $1.point.y - location.y) }),
              hypot(mark.point.x - location.x, mark.point.y - location.y) <= 11 else { return nil }
        return mark.events.min(by: { abs(layout.x($0.t) - location.x) < abs(layout.x($1.t) - location.x) })
    }

    static func time(at location: CGPoint, marks: [Mark], layout: OddsLayout) -> Date {
        let time = layout.inspectionTime(at: location.x)
        guard location.x > layout.plot.minX, location.x < layout.plot.maxX else { return time }
        return target(at: location, marks: marks, layout: layout)?.t ?? time
    }

    static func symbol(side: GameDetail.Side?, at point: CGPoint, radius: CGFloat) -> Path {
        if side == .bottom {
            return Path { path in
                path.move(to: CGPoint(x: point.x, y: point.y - radius))
                path.addLine(to: CGPoint(x: point.x + radius, y: point.y))
                path.addLine(to: CGPoint(x: point.x, y: point.y + radius))
                path.addLine(to: CGPoint(x: point.x - radius, y: point.y))
                path.closeSubpath()
            }
        }
        return Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
    }

    static func draw(_ mark: Mark, layout: OddsLayout, in context: GraphicsContext,
                     topColor: Color, bottomColor: Color, emphasized: Bool = false) {
        guard let first = mark.events.first, let last = mark.events.last else { return }
        let point = mark.point
        if point.y != layout.plot.midY || mark.events.count > 1 {
            var stem = Path()
            stem.move(to: CGPoint(x: layout.x(first.t), y: layout.plot.midY))
            stem.addLine(to: CGPoint(x: layout.x(last.t), y: layout.plot.midY))
            stem.move(to: CGPoint(x: point.x, y: layout.plot.midY))
            stem.addLine(to: point)
            context.stroke(stem, with: .color(Viz.reference), lineWidth: 1)
        }
        if mark.events.count == 1 {
            let color = first.side == .top ? topColor : first.side == .bottom ? bottomColor : Viz.neutral
            context.fill(symbol(side: first.side, at: point, radius: 4), with: .color(color))
        } else {
            let top = mark.events.contains(where: { $0.side == .top })
            let bottom = mark.events.contains(where: { $0.side == .bottom })
            let color = top ? topColor : bottom ? bottomColor : Viz.neutral
            let shape = Path(roundedRect: CGRect(x: point.x - 7, y: point.y - 6, width: 14, height: 12), cornerRadius: 3)
            context.fill(shape, with: .color(color))
            if top && bottom {
                var half = context
                half.clip(to: shape)
                half.fill(Path(CGRect(x: point.x, y: point.y - 6, width: 7, height: 12)), with: .color(bottomColor))
            }
            // A small backing makes the count legible even when the two team
            // colors have different luminance. Exact identities are in the
            // readout/VoiceOver, with previous/next exposing every event.
            context.fill(Path(roundedRect: CGRect(x: point.x - 5, y: point.y - 5, width: 10, height: 10), cornerRadius: 2),
                         with: .color(.black.opacity(0.65)))
            let count = mark.events.count > 99 ? "+" : "\(mark.events.count)"
            context.draw(Text(count).font(.system(size: 8, weight: .bold, design: .rounded)).foregroundStyle(.white), at: point)
        }
        if emphasized {
            context.stroke(Path(roundedRect: CGRect(x: point.x - 9, y: point.y - 8, width: 18, height: 16), cornerRadius: 4),
                           with: .color(.primary), lineWidth: 1)
        }
    }
}

private struct MatchTimelineStill: View, Equatable {
    let events: [MatchHistory.Event]
    let periods: [OddsPeriod]
    let layout: OddsLayout
    let rail: [MatchTimelineRail.Mark]?
    let topColor: Color
    let bottomColor: Color
    let live: Bool

    var body: some View {
        Canvas { context, _ in
            let center = layout.plot.midY
            let now = CGPoint(x: layout.plot.maxX, y: center)
            let trackContext = live ? context.clearing([Clearance(now, radius: 4.5)]) : context
            let track = Path(roundedRect: CGRect(x: layout.plot.minX, y: center - 1,
                                                width: layout.plot.width, height: 2), cornerRadius: 1)
            trackContext.fill(track, with: .color(Color.primary.opacity(0.12)))
            // Period boundaries are short ticks on the shared rule, like
            // soccer's half-time mark. Breaks retain their real horizontal span.
            for period in periods.dropFirst() where layout.domain.contains(period.start) {
                var tick = Path()
                let x = layout.x(period.start)
                tick.move(to: CGPoint(x: x, y: center - 5))
                tick.addLine(to: CGPoint(x: x, y: center + 5))
                trackContext.stroke(tick, with: .color(Viz.reference), lineWidth: 1)
            }
            if let rail {
                for mark in rail {
                    MatchTimelineRail.draw(mark, layout: layout, in: context, topColor: topColor, bottomColor: bottomColor)
                }
            } else {
                for event in events {
                    MatchTimelineGeometry.draw(event, at: MatchTimelineGeometry.point(event, layout: layout), in: context,
                                               topColor: topColor, bottomColor: bottomColor)
                }
            }
            if live {
                context.fill(Path(ellipseIn: CGRect(x: now.x - 3, y: now.y - 3, width: 6, height: 6)), with: .color(.red))
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct MatchTimelineScrub: View {
    let history: MatchHistory
    let events: [MatchHistory.Event]
    let names: (top: String, bottom: String)
    let layout: OddsLayout
    let rail: [MatchTimelineRail.Mark]?
    let topColor: Color
    let bottomColor: Color
    let pointer: OddsPointer
    @FocusState private var focused: Bool

    var body: some View {
        Button {
            focused = true
            // Keyboard and accessibility activation keep the selected moment.
            pointer.pin(pointer.moment ?? layout.domain.upperBound)
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
                            if let rail {
                                for mark in rail where mark.events.contains(where: { abs($0.t.timeIntervalSince(moment)) < 0.5 }) {
                                    MatchTimelineRail.draw(mark, layout: layout, in: context, topColor: topColor,
                                                           bottomColor: bottomColor, emphasized: true)
                                }
                            } else {
                                for event in events where abs(event.t.timeIntervalSince(moment)) < 0.5 {
                                    MatchTimelineGeometry.draw(event, at: MatchTimelineGeometry.point(event, layout: layout), in: context,
                                                               topColor: topColor, bottomColor: bottomColor, emphasized: true)
                                }
                            }
                        }
                    }
                }
                // Inspection overlays must never become new hover targets.
                // Inserting/removing the cursor otherwise feeds back into
                // hover, alternately clearing and recreating the selection.
                .allowsHitTesting(false)
            }
            .frame(width: layout.bounds.width, height: MatchTimelineStyle.plotHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .highPriorityGesture(SpatialTapGesture().onEnded { value in
            guard let moment = time(at: value.location) else { return }
            focused = true
            pointer.pin(moment)
        })
        .onContinuousHover { phase in
            switch phase {
            case let .active(location):
                guard let moment = time(at: location) else {
                    if !focused { pointer.hover(nil) }
                    return
                }
                pointer.hover(moment)
            case .ended:
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
        .accessibilityLabel("Match timeline, \(events.count) key events")
        .modifier(MatchTimelineAccessibility(history: history, domain: layout.domain, names: names, pointer: pointer))
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
        .help(rail == nil ? "Hover to inspect. Click to pin. Use arrow keys for previous and next events."
              : "Nearby scoring plays are grouped. Hover or use arrow keys to inspect each event; click to pin. Circles identify the first team, diamonds the second.")
        .onDisappear { pointer.hover(nil) }
    }

    private func time(at location: CGPoint) -> Date? {
        guard location.x >= layout.plot.minX, location.x <= layout.plot.maxX else { return nil }
        return rail.map { MatchTimelineRail.time(at: location, marks: $0, layout: layout) }
            ?? MatchTimelineGeometry.time(at: location, events: events, layout: layout)
    }

    @discardableResult
    private func move(forward: Bool) -> Bool {
        MatchInspectionControls.select(forward: forward, history: history, domain: layout.domain, pointer: pointer)
    }
}

/// Keep high-frequency accessibility readings out of the native hover Button's
/// body. Only this modifier and the small inspection leaves observe the cursor.
private struct MatchTimelineAccessibility: ViewModifier {
    let history: MatchHistory
    let domain: ClosedRange<Date>
    let names: (top: String, bottom: String)
    let pointer: OddsPointer
    @Environment(\.spokenTeams) private var teams

    func body(content: Content) -> some View {
        let at = pointer.moment ?? domain.upperBound
        let matches = history.keyEvents.filter { $0.t <= at && abs($0.t.timeIntervalSince(at)) < 0.5 }
        let events = matches.isEmpty ? history.context(at: at).map { [$0] } ?? [] : matches
        let summary = events.map { event in
            [event.clock, event.side.map { $0 == .top ? teams?.top ?? names.top : teams?.bottom ?? names.bottom } ?? "", event.text]
                .filter { !$0.isEmpty }.joined(separator: ". ")
        }.joined(separator: ". ")
        content.accessibilityValue("\(at.formatted(.dateTime.hour().minute().second())). \(summary.isEmpty ? "No reported play at this time." : summary)")
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
    let names: (top: String, bottom: String)
    let pointer: OddsPointer

    var body: some View {
        OddsMoment(pointer: pointer) { moment in
            let at = moment ?? domain.upperBound
            // Corrected provider times may place several plays at one
            // instant. Name all key events there, rather than letting a
            // substitution at the same timestamp hide the selected score.
            let exact = moment == nil ? [] : history.keyEvents.filter { $0.t <= at && abs($0.t.timeIntervalSince(at)) < 0.5 }
            let event = exact.last ?? history.context(at: at)
            if let event {
                let clock = event.clock.isEmpty ? OddsBaseline.periodLabel(event.period, sport: history.sport) : event.clock
                let text = (exact.isEmpty ? [event] : exact).map { item in
                    if history.sport == .football, let side = item.side {
                        return "\(side == .top ? names.top : names.bottom): \(item.text)"
                    }
                    return item.text
                }.joined(separator: " · ")
                let adjusted = event.timing == .adjusted || exact.contains(where: { $0.timing == .adjusted })
                let status = moment == nil ? "Latest" : abs(event.t.timeIntervalSince(at)) < 0.5 ? "" : "Last play"
                let lead = [status, clock, event.score ?? "", adjusted ? "Adjusted time" : ""]
                    .filter { !$0.isEmpty }.joined(separator: " · ")
                let detail = [status.isEmpty ? "Reported play" : status == "Latest" ? "Latest reported play" : "Last reported play at or before this moment",
                              clock, text, event.score.map { "Score after play: \($0)" } ?? "",
                              "Inspected at \(at.formatted(.dateTime.weekday().month().day().hour().minute().second()))",
                              adjusted ? "Event time adjusted to preserve play order." : ""]
                    .filter { !$0.isEmpty }.joined(separator: ". ")
                // Like the original soccer timeline, the inspector is one
                // concise line. Long plays remain available in the native
                // tooltip and VoiceOver; they do not move the controls below.
                (Text(lead).fontWeight(.semibold).foregroundStyle(.primary)
                    + Text("  \(text)").foregroundStyle(.secondary))
                    .font(Viz.note.monospacedDigit())
                    .lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .help(detail)
                    .accessibilityLabel(detail)
            } else {
                let text = history.events.isEmpty ? "Event timestamps are unavailable for this game." : "No reported play at or before this moment."
                Text(text)
                    .font(Viz.note.monospacedDigit()).foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .help(text)
            }
        }
    }
}
