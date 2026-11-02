import SwiftUI

// One timeline for every sport, and it's soccer's: one track, each team's
// marks in its own lane (labeled), the game's landmarks under it. Only the
// axis differs: match minutes when that's all a provider gives, else the wall
// clock it shares with Win Probability, so a goal sits above the odds it moved.
// Hover and pin read the same moment in both (`OddsPointer`); a key play's row,
// its mark and its column in the odds are one focus (`LinkedFocus`).

// MARK: - Marks

/// A key moment on the timeline, and when it happened.
struct TimelineMark: Identifiable {
    let moment: GameDetail.Moment
    /// On the wall clock; nil when only its match minute is known.
    let t: Date?

    var id: String { moment.id }
}

extension GameDetail {
    /// What the timeline plots, by the same IDs as the rows it links to: the
    /// key moments (soccer's goals and cards, the NBA's Key Plays, the scoring
    /// plays) and football's turnovers. A period's end is a landmark, not a mark.
    var timelineMarks: [TimelineMark] {
        let plotted = moments.filter { $0.kind != .other }
        guard let history, !history.events.isEmpty else {
            return plotted.filter { $0.minute != nil }.map { TimelineMark(moment: $0, t: nil) }
        }
        let times = Dictionary(history.events.map { ($0.id, $0.t) }, uniquingKeysWith: { first, _ in first })
        let clock = history.start.map { SoccerClock(start: $0, periods: history.periods, now: history.end) }
        var marks = plotted.compactMap { moment -> TimelineMark? in
            let byMinute = history.sport == .soccer ? moment.minute.flatMap { clock?.wall($0) } : nil
            return (times[Replays.play(of: moment.id)] ?? byMinute).map { TimelineMark(moment: moment, t: $0) }
        }
        let scoring = Set(plotted.map { Replays.play(of: $0.id) })
        for event in history.events where event.turnover && !scoring.contains(event.id) {
            marks.append(TimelineMark(moment: Moment(id: event.id, kind: .turnover, clock: event.clock, text: event.text,
                                                     side: event.side, period: event.period), t: event.t))
        }
        return marks.sorted { ($0.t ?? .distantPast) < ($1.t ?? .distantPast) }
    }
}

/// Soccer's match clock against the wall. It never stops, so inside a half a
/// minute is a minute: each half's marks are honest measured from its own
/// kickoff, and the breaks keep their real width between them. A half that
/// hasn't started yet is projected, a usual first half and break on. (pure; tested)
struct SoccerClock {
    let start: Date
    let periods: [OddsPeriod]
    /// How far the game has got: a long break pushes the projected kickoff along.
    let now: Date?

    /// A first half with its stoppage, and with its break too.
    private static let firstHalf: TimeInterval = 48 * 60, firstHalfAndBreak: TimeInterval = 63 * 60

    /// When the first half's break began: its last play, once it's over.
    var breakStart: Date {
        guard let first = periods.first, periods.count > 1 || (now ?? start) > start + Self.firstHalf else { return start + Self.firstHalf }
        return first.end
    }

    /// The second half's kickoff, played or projected.
    var secondHalf: Date {
        periods.count > 1 ? periods[1].start : max(start + Self.firstHalfAndBreak, now ?? start)
    }

    func wall(_ minute: Double) -> Date {
        if minute <= 45 { return start + minute * 60 }
        if minute > 105, periods.count > 3 { return periods[3].start + (minute - 105) * 60 }
        if minute > 90, periods.count > 2 { return periods[2].start + (minute - 90) * 60 }
        return secondHalf + (minute - 45) * 60
    }

    func minute(at t: Date) -> Double {
        let bases: [Double] = [0, 45, 90, 105]
        guard let index = periods.prefix(bases.count).lastIndex(where: { $0.start <= t }) else { return t.timeIntervalSince(start) / 60 }
        return bases[index] + t.timeIntervalSince(periods[index].start) / 60
    }
}

// MARK: - Axis

/// Everything the timeline draws along its track, worked out for one size:
/// the track itself, the time played, the tinted stretches (stoppage, breaks),
/// quiet ticks, the landmarks' lines (half-time) and the labels under it all.
struct TimelineAxis {
    struct Label: Equatable {
        var text: String
        var x: CGFloat
        /// Quieter than the landmarks it sits between.
        var quiet = false
    }

    var track: ClosedRange<CGFloat>
    var now: CGFloat? = nil
    var played: [ClosedRange<CGFloat>] = []
    var tinted: [ClosedRange<CGFloat>] = []
    var ticks: [CGFloat] = []
    var landmarks: [CGFloat] = []
    var labels: [Label] = []
    /// The wall-clock scale; nil on match minutes.
    var layout: OddsLayout? = nil
    /// Match minutes: where a minute falls.
    private var minuteScale: (length: Double, width: CGFloat)? = nil

    /// Where a mark goes on the track, if it's on what's shown.
    func x(_ mark: TimelineMark) -> CGFloat? {
        if let layout {
            return mark.t.flatMap { layout.domain.contains($0) ? layout.x($0) : nil }
        }
        return mark.moment.minute.map(x(minute:))
    }

    private func x(minute: Double) -> CGFloat {
        guard let minuteScale else { return track.lowerBound }
        return track.lowerBound + minuteScale.width * min(minute / minuteScale.length, 1)
    }

    /// Match minutes: 0' to 90' (or the last minute there's been), half-time
    /// marked. From large up the track has room for a tick every 15': minutes
    /// read off the axis instead of being estimated between 0', HT and the end.
    static func minutes(width: CGFloat, marks: [TimelineMark], current: Double?, large: Bool) -> TimelineAxis {
        let gutter = MatchTimeline.gutter
        let length = max(90, (marks.compactMap(\.moment.minute).max() ?? 0).rounded(.up), current ?? 0)
        // A little room at the end, so the last mark's ring isn't clipped.
        let w = width - gutter - 6
        var axis = TimelineAxis(track: gutter...(gutter + w))
        axis.minuteScale = (length, w)
        axis.now = current.map(axis.x(minute:))
        axis.played = current.map { [gutter...axis.x(minute: $0)] } ?? []
        if length > 90 { axis.tinted = [axis.x(minute: 90)...axis.x(minute: length)] }
        let quarterHours = large ? stride(from: 15.0, to: length, by: 15).filter { $0 != 45 } : []
        axis.ticks = quarterHours.map(axis.x(minute:))
        axis.landmarks = [axis.x(minute: 45)]
        let end = axis.x(minute: length) - 8
        axis.labels = [Label(text: "0'", x: gutter + 6), Label(text: "HT", x: axis.x(minute: 45)), Label(text: "\(Int(length))'", x: end)]
        // A tick near the end (90' in stoppage time) keeps its line, not its label.
        axis.labels += quarterHours.filter { end - axis.x(minute: $0) >= 22 }
            .map { Label(text: "\(Int($0))'", x: axis.x(minute: $0), quiet: true) }
        return axis
    }

    /// The wall clock, on the plot `OddsLayout` gives Win Probability at the
    /// same width: the same time at the same x, whatever the sport.
    static func wall(_ scale: MatchTimeline.WallScale, size: CGSize, large: Bool) -> TimelineAxis {
        let layout = OddsLayout(size: size, plotHeight: MatchTimeline.plotHeight, domain: scale.domain, labelWidth: scale.labelWidth, now: scale.now)
        var axis = TimelineAxis(track: layout.plot.minX...layout.plot.maxX, layout: layout)
        let periods = scale.history.periods
        func stretch(_ a: Date, _ b: Date) -> ClosedRange<CGFloat>? {
            let from = max(layout.x(a), layout.plot.minX), to = min(layout.x(b), layout.plot.maxX)
            return from < to ? from...to : nil
        }
        if let now = scale.now, scale.domain.contains(now) {
            axis.now = layout.endX
            axis.played = periods.enumerated().compactMap { index, period in
                stretch(period.start, index == periods.count - 1 ? now : period.end)
            }
        }
        for (period, next) in zip(periods, periods.dropFirst()) {
            if let rest = stretch(period.end, next.start) {
                axis.tinted.append(rest)
                axis.landmarks.append((rest.lowerBound + rest.upperBound) / 2)
            }
        }
        if scale.history.sport == .soccer {
            axis.soccerLandmarks(scale, layout: layout, large: large, stretch: stretch)
        } else if let number = scale.window.period {
            axis.zoomedLandmarks(scale, period: number, layout: layout)
        } else {
            axis.labels = OddsPlot.periodLabels(periods, layout: layout).map { Label(text: $0.label, x: $0.x) }
        }
        return axis
    }

    /// Soccer's own landmarks on the wall clock: 0', HT and the end, ticks
    /// every 15' with room, the second half's stoppage tinted. Zoomed to a half:
    /// its minutes, labeled every 15', with a tick every 5'.
    private mutating func soccerLandmarks(_ scale: MatchTimeline.WallScale, layout: OddsLayout, large: Bool,
                                          stretch: (Date, Date) -> ClosedRange<CGFloat>?) {
        let periods = scale.history.periods
        let clock = SoccerClock(start: periods.first?.start ?? scale.domain.lowerBound, periods: periods, now: scale.now)
        let range = track
        func placed(_ minutes: [Double]) -> [(minute: Double, x: CGFloat)] {
            minutes.map { (minute: $0, x: layout.x(clock.wall($0))) }.filter { range.contains($0.x) }
        }
        let end = track.upperBound - 8
        if scale.window == .recent {
            // The last 10 minutes, by the minute: no game's ends to mark.
            let now = clock.minute(at: scale.domain.upperBound)
            let minutes = placed(Array(stride(from: (now / 5).rounded(.up) * 5 - 15, through: now, by: 5)))
            ticks = minutes.map { $0.x }
            labels = minutes.map { Label(text: "\(Int($0.minute))'", x: $0.x, quiet: true) }
            return
        }
        if let number = scale.window.period {
            // One half: its own first minute to its last.
            let bases: [Int: Double] = [2: 45, 3: 90, 4: 105], tops: [Int: Double] = [1: 45, 2: 90, 3: 105, 4: 120]
            let base = bases[number] ?? 0, regulation = tops[number] ?? 120
            let last = max(clock.minute(at: scale.domain.upperBound).rounded(), base + 1)
            if let stoppage = stretch(clock.wall(regulation), scale.domain.upperBound) { tinted = [stoppage] }
            let fives = placed(Array(stride(from: base + 5, to: last, by: 5)))
            ticks = fives.map { $0.x }
            labels = [Label(text: "\(Int(base))'", x: track.lowerBound + 6), Label(text: "\(Int(last))'", x: end)]
            labels += fives.filter { $0.minute.truncatingRemainder(dividingBy: 15) == 0 && end - $0.x >= 22 && $0.x - track.lowerBound >= 22 }
                .map { Label(text: "\(Int($0.minute))'", x: $0.x, quiet: true) }
            return
        }
        // Before the second half, its break is only pencilled in.
        if periods.count < 2, let rest = stretch(clock.breakStart, clock.secondHalf) {
            tinted.append(rest)
            landmarks.append((rest.lowerBound + rest.upperBound) / 2)
        }
        let halfTime = landmarks.first ?? layout.x(clock.secondHalf)
        if let stoppage = stretch(clock.wall(90), scale.domain.upperBound) { tinted.append(stoppage) }
        let final = scale.now == nil
        let length = final ? max(90, clock.minute(at: scale.domain.upperBound).rounded()) : 90
        let landmark = final ? end : min(layout.x(clock.wall(90)), end)
        labels = [Label(text: "0'", x: track.lowerBound + 6), Label(text: "HT", x: halfTime), Label(text: "\(Int(length))'", x: landmark)]
        let quarterHours = placed(large ? stride(from: 15.0, to: length, by: 15).filter { $0 != 45 } : [])
        ticks = quarterHours.map { $0.x }
        // A tick near a landmark keeps its line, not its label.
        labels += quarterHours.filter { landmark - $0.x >= 22 && abs(halfTime - $0.x) >= 22 }
            .map { Label(text: "\(Int($0.minute))'", x: $0.x, quiet: true) }
    }

    /// Zoomed to one period: its name, and what the game clock said as it went
    /// by, read from the plays reported (a stopped clock is never interpolated).
    /// A baseball inning has no clock: its two halves.
    private mutating func zoomedLandmarks(_ scale: MatchTimeline.WallScale, period number: Int, layout: OddsLayout) {
        let history = scale.history
        let events = history.events.filter { $0.period == number && layout.domain.contains($0.t) }
        guard let period = history.periods.first(where: { $0.number == number }) else { return }
        if history.sport == .baseball {
            guard let turn = events.first(where: { $0.clock.hasPrefix("Bot") }) else {
                labels = [Label(text: period.label, x: (track.lowerBound + track.upperBound) / 2)]
                return
            }
            let middle = layout.x(turn.t)
            landmarks.append(middle)
            labels = [Label(text: "Top \(period.label)", x: (track.lowerBound + middle) / 2), Label(text: "Bot \(period.label)", x: (middle + track.upperBound) / 2)]
            return
        }
        labels = [Label(text: period.label, x: track.lowerBound + 8)]
        // A marker every quarter of the period, at the first play reported at or under it.
        let clocks = events.compactMap { event -> (seconds: Int, x: CGFloat)? in
            guard let reading = event.clock.split(separator: " ").last.map(String.init), let seconds = Self.seconds(reading) else { return nil }
            return (seconds, layout.x(event.t))
        }
        guard let opening = clocks.map({ $0.seconds }).max(), opening >= 240 else { return }
        let step = opening >= 720 ? 180 : opening >= 600 ? 150 : 60
        var lastLabel = track.lowerBound + 8
        for mark in stride(from: opening - opening % step, to: 0, by: -step) where mark < opening {
            guard let hit = clocks.first(where: { $0.seconds <= mark }) else { continue }
            ticks.append(hit.x)
            if hit.x - lastLabel >= 28, track.upperBound - hit.x >= 14 {
                labels.append(Label(text: "\(mark / 60):\(String(format: "%02d", mark % 60))", x: hit.x, quiet: true))
                lastLabel = hit.x
            }
        }
    }

    /// "9:16" → 556.
    private static func seconds(_ clock: String) -> Int? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : nil
    }
}

// MARK: - The timeline

/// The match on one track: each team's goals and cards in its own lane
/// (labeled), half-time marked, and time played filled while it's live.
/// Pointing at a mark (or at its key event) picks it out.
struct MatchTimeline: View {
    /// The wall clock it shares with Win Probability.
    struct WallScale {
        /// As presented: nothing past p.
        let history: MatchHistory
        let domain: ClosedRange<Date>
        /// Where a live game has got to.
        let now: Date?
        let labelWidth: CGFloat
        let window: OddsWindow
        let pointer: OddsPointer
    }

    enum Scale {
        /// Match minutes: no timestamps to align with anything.
        case minutes(current: Double?)
        case wall(WallScale)
    }

    let marks: [TimelineMark]
    let scale: Scale
    let topColor: Color
    let bottomColor: Color
    let topName: String
    let bottomName: String
    /// Nothing else on the page holds the pin's controls.
    var showsPinControls = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass

    static let gutter: CGFloat = 30
    static let height: CGFloat = 60
    /// Everything above the labels' row.
    static let plotHeight: CGFloat = 48

    private var wall: WallScale? {
        if case let .wall(wall) = scale { return wall }
        return nil
    }

    private func makeAxis(_ size: CGSize) -> TimelineAxis {
        switch scale {
        case let .minutes(current): .minutes(width: size.width, marks: marks, current: current, large: widthClass >= .large)
        case let .wall(wall): .wall(wall, size: size, large: widthClass >= .large)
        }
    }

    private var current: Double? {
        if case let .minutes(current) = scale { return current }
        return nil
    }

    private static func laneY(_ m: GameDetail.Moment) -> CGFloat { m.side == .bottom ? 38 : 10 }

    var body: some View {
        GeometryReader { geo in
            let axis = makeAxis(geo.size)
            let placed = marks.compactMap { mark in axis.x(mark).map { (mark: mark, at: CGPoint(x: $0, y: Self.laneY(mark.moment))) } }
            let points = placed.map { $0.at }
            // The pointed-at mark, read in the small layers that change with it.
            let target = { (focus: Focus?) in focus?.play.flatMap { id in placed.first { $0.mark.id == id } } }
            ZStack(alignment: .topLeading) {
                Text(topName).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                    .position(x: Self.gutter / 2 - 2, y: 10)
                Text(bottomName).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                    .position(x: Self.gutter / 2 - 2, y: 38)
                Canvas { context, _ in
                    // The track stops short of the now dot on both sides.
                    let context = context.clearing(axis.now.map { [Clearance(CGPoint(x: $0, y: 24), radius: 4.5)] } ?? [])
                    var track = Path()
                    track.addRoundedRect(in: CGRect(x: axis.track.lowerBound, y: 23, width: axis.track.upperBound - axis.track.lowerBound, height: 2),
                                         cornerSize: CGSize(width: 1, height: 1))
                    context.fill(track, with: .color(Color.primary.opacity(0.12)))
                    for rest in axis.tinted {
                        context.fill(Path(CGRect(x: rest.lowerBound, y: 23, width: rest.upperBound - rest.lowerBound, height: 2)), with: .color(Viz.track))
                    }
                    for tick in axis.ticks {
                        context.fill(Path(CGRect(x: tick - 0.5, y: 22, width: 1, height: 4)), with: .color(Viz.markings))
                    }
                    for stretch in axis.played {
                        context.fill(Path(CGRect(x: stretch.lowerBound, y: 23, width: stretch.upperBound - stretch.lowerBound, height: 2)),
                                     with: .color(Viz.neutral))
                    }
                    for landmark in axis.landmarks {
                        var line = Path()
                        line.move(to: CGPoint(x: landmark, y: 19)); line.addLine(to: CGPoint(x: landmark, y: 29))
                        context.stroke(line, with: .color(Viz.reference), lineWidth: 1)
                    }
                }
                Canvas { context, _ in
                    // Each goal clears room in the marks before it.
                    context.draw(placed, clearance: { Self.clearance($0.mark.moment, at: $0.at) }) { item, context in
                        draw(item.mark.moment, at: item.at, in: context)
                    }
                }
                .recedes { target($0) != nil }
                if let now = axis.now {
                    Canvas { context, _ in
                        context.fill(Path(ellipseIn: CGRect(x: now - 3, y: 21, width: 6, height: 6)), with: .color(.red))
                    }
                }
                FocusReader { focus in
                    if let target = target(focus) {
                        Canvas { context, _ in draw(target.mark.moment, at: target.at, in: context, emphasized: true) }
                            .transition(.opacity)
                    }
                }
                // Minute labels sit exactly under their ticks; while a mark is
                // pointed at, that row says what it was instead (nothing covers the track).
                Group {
                    ForEach(axis.labels, id: \.text) { label in
                        Text(label.text).font(Viz.tick).foregroundStyle(label.quiet ? .tertiary : .secondary).fixedSize()
                            .position(x: label.x, y: 54)
                    }
                }
                .recedes(to: 0) { target($0) != nil }
                FocusReader { focus in
                    if let target = target(focus) {
                        (Text(target.mark.moment.clock).fontWeight(.semibold).foregroundStyle(.primary)
                            + Text("  \(MomentList.headline(target.mark.moment))").foregroundStyle(.secondary))
                            .font(.system(size: 10.5).monospacedDigit())
                            .lineLimit(1)
                            .frame(width: geo.size.width - Self.gutter, alignment: .leading)
                            .position(x: Self.gutter + (geo.size.width - Self.gutter) / 2, y: 54)
                            .transition(.opacity)
                    }
                }
                if let wall, let layout = axis.layout {
                    TimelineRule(layout: layout, pointer: wall.pointer)
                    PeriodRow(spans: TimelinePeriod.spans(wall.history.periods, layout: layout, runsOn: wall.now != nil),
                              zoomed: wall.window.period != nil, pointer: wall.pointer)
                        .frame(width: geo.size.width, height: Self.height - Self.plotHeight - 1)
                        .offset(y: Self.plotHeight + 1)
                    if showsPinControls {
                        MatchPinControls(marks: marks, range: wall.domain, pointer: wall.pointer, section: .timeline)
                            .frame(width: geo.size.width, alignment: .trailing)
                            .position(x: geo.size.width / 2, y: 54)
                    }
                }
            }
            .contentShape(Rectangle())
            .linkedMarks(points) { Focus(play: placed[$0].mark.id) }
            .modifier(TimelineInput(layout: axis.layout, marks: marks, pointer: wall?.pointer) { location in
                nearest(points, to: location).map { placed[$0].mark }
            })
            .animation(reduceMotion ? nil : Motion.standard, value: current)
        }
        .frame(height: Self.height)
        // Win Probability's well contributes the same inset: the same time at the same x.
        .padding(.horizontal, wall == nil ? 0 : 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .modifier(TimelineAccessibility(wall: wall, marks: marks))
    }

    /// The room a goal keeps clear around it, 1.5 pt (cards sit on their own).
    private static func clearance(_ m: GameDetail.Moment, at p: CGPoint) -> Clearance? {
        switch m.kind {
        case .goal, .ownGoal, .score: Clearance(p, radius: 6)
        case .yellow, .red, .turnover, .other: nil
        }
    }

    private func draw(_ m: GameDetail.Moment, at p: CGPoint, in context: GraphicsContext, emphasized: Bool = false) {
        let grow: CGFloat = emphasized ? 1.35 : 1
        let team = m.side == .bottom ? bottomColor : topColor
        switch m.kind {
        case .goal, .ownGoal, .score:
            let r = 4.5 * grow
            let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
            context.fill(Path(ellipseIn: rect), with: .color(team))
            if emphasized {
                context.stroke(Path(ellipseIn: rect.insetBy(dx: -2, dy: -2)), with: .color(.primary), lineWidth: 1)
            }
        case .yellow, .red, .turnover:
            let rect = CGRect(x: p.x - 2.5 * grow, y: p.y - 3.5 * grow, width: 5 * grow, height: 7 * grow)
            let color: Color = m.kind == .yellow ? .yellow : m.kind == .red ? .red : team
            context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(color))
            if emphasized {
                context.stroke(Path(roundedRect: rect.insetBy(dx: -1.5, dy: -1.5), cornerRadius: 2), with: .color(.primary), lineWidth: 1)
            }
        case .other:
            break
        }
    }

    private var accessibilityText: String {
        let kinds = marks.map(\.moment.kind)
        func count(_ kind: GameDetail.Moment.Kind) -> Int { kinds.filter { $0 == kind }.count }
        let scores = count(.score), turnovers = count(.turnover)
        if scores > 0 || turnovers > 0 {
            return "Timeline: \(plural(scores, "key play"))" + (turnovers > 0 ? ", \(plural(turnovers, "turnover"))." : ".")
        }
        var to = current.map { " to \(Int($0)) minutes" } ?? ""
        if let wall, let now = wall.now, wall.history.sport == .soccer {
            let clock = SoccerClock(start: wall.history.start ?? wall.domain.lowerBound, periods: wall.history.periods, now: now)
            to = " to \(Int(clock.minute(at: now))) minutes"
        }
        return "Timeline\(to): \(count(.goal) + count(.ownGoal)) goals, \(count(.yellow)) yellow cards, \(count(.red)) red cards."
    }
}

/// The reading's line down the track, in the small subtree that observes it.
private struct TimelineRule: View {
    let layout: OddsLayout
    let pointer: OddsPointer

    var body: some View {
        OddsMoment(pointer: pointer) { moment in
            if let moment, layout.domain.contains(moment) {
                Canvas { context, _ in
                    var rule = Path()
                    rule.move(to: CGPoint(x: layout.x(moment), y: 2))
                    rule.addLine(to: CGPoint(x: layout.x(moment), y: MatchTimeline.plotHeight - 2))
                    context.stroke(rule, with: .color(Viz.reference), lineWidth: 1)
                }
            }
        }
        .allowsHitTesting(false)
    }
}

private struct TimelineInput: ViewModifier {
    let layout: OddsLayout?
    let marks: [TimelineMark]
    let pointer: OddsPointer?
    let markAt: (CGPoint) -> TimelineMark?

    func body(content: Content) -> some View {
        if let layout, let pointer {
            content.modifier(MatchInspection(layout: layout, marks: marks, pointer: pointer, markAt: markAt))
        } else {
            content
        }
    }
}

/// VoiceOver on the wall clock: the reading as its value, the key plays and
/// the periods as actions. Only this modifier and the small inspection leaves
/// observe the moment.
private struct TimelineAccessibility: ViewModifier {
    let wall: MatchTimeline.WallScale?
    let marks: [TimelineMark]

    func body(content: Content) -> some View {
        if let wall {
            content
                .modifier(TimelineReadingValue(pointer: wall.pointer, marks: marks))
                .accessibilityHint("Adjust to move through the game.")
                .modifier(MatchInspectionActions(marks: marks, range: wall.domain.lowerBound...min(wall.domain.upperBound, wall.now ?? wall.domain.upperBound),
                                                 pointer: wall.pointer))
                .accessibilityActions {
                    ForEach(wall.history.periods, id: \.number) { period in
                        Button("Show \(period.label)") { wall.pointer.zoom(to: period.number, span: period.start...max(period.end, period.start)) }
                    }
                    if wall.window.period != nil { Button("Show the whole game") { wall.pointer.zoom(to: nil, span: nil) } }
                }
        } else {
            content
        }
    }
}

private struct TimelineReadingValue: ViewModifier {
    let pointer: OddsPointer
    let marks: [TimelineMark]

    func body(content: Content) -> some View {
        let at = pointer.moment
        let mark = at.flatMap { t in marks.last { $0.t.map { $0 <= t } == true } }
        let value = mark.map { "\(MomentList.shortClock($0.moment.clock)), \($0.moment.text)" } ?? (at == nil ? "Latest" : "Before the first key play")
        content.accessibilityValue(value)
    }
}

// MARK: - Time scale

/// A period along the axis, for its label's click.
struct TimelinePeriod: Equatable, Identifiable {
    let number: Int
    let label: String
    let x: ClosedRange<CGFloat>
    let time: ClosedRange<Date>

    var id: Int { number }

    /// Each period on show, from its start to the next one's. A period still
    /// going has the rest of the axis.
    static func spans(_ periods: [OddsPeriod], layout: OddsLayout, runsOn: Bool) -> [TimelinePeriod] {
        periods.enumerated().compactMap { index, period in
            let last = index == periods.count - 1
            let from = max(layout.x(period.start), layout.plot.minX)
            let to = last && runsOn ? layout.plot.maxX : min(layout.x(last ? period.end : periods[index + 1].start), layout.plot.maxX)
            guard from < to else { return nil }
            return TimelinePeriod(number: period.number, label: period.label, x: from...to, time: period.start...max(period.end, period.start))
        }
    }
}

/// The labels' row, as buttons: a period's zooms both modules to it; zoomed,
/// the row returns to the whole game. A wash says what a click takes in.
struct PeriodRow: View {
    let spans: [TimelinePeriod]
    let zoomed: Bool
    let pointer: OddsPointer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering: Int?

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(spans) { span in
                Button {
                    withAnimation(reduceMotion ? nil : Motion.standard) {
                        pointer.zoom(to: zoomed ? nil : span.number, span: zoomed ? nil : span.time)
                    }
                } label: {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(Color.primary.opacity(hovering == span.number ? 0.08 : zoomed ? 0.04 : 0))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .focusable(false)
                .frame(width: max(span.x.upperBound - span.x.lowerBound - 2, 1))
                .frame(maxHeight: .infinity)
                .offset(x: span.x.lowerBound + 1)
                .onHover { inside in
                    if inside { hovering = span.number } else if hovering == span.number { hovering = nil }
                }
                .pointerStyle(.link)
                .accessibilityLabel(zoomed ? "Show the whole game" : "Show \(span.label)")
            }
        }
    }
}

/// While zoomed, the way back: the window's place in Win Probability's header.
struct WholeGameLink: View {
    let pointer: OddsPointer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        PinButton(title: "Whole Game", symbol: "arrow.up.left.and.arrow.down.right", spoken: "Show the whole game") {
            withAnimation(reduceMotion ? nil : Motion.standard) { pointer.zoom(to: nil, span: nil) }
        }
    }
}

/// Everything inside draws at a domain that springs from one zoom level to the
/// next, the same spring in both modules, so they stay aligned on the way.
/// Interpolated here (a Canvas can't be): each frame of a zoom redraws the
/// lines, and only a zoom does. Keyboard and data changes carry no animation.
struct ZoomingDomain<Content: View>: View, Animatable {
    var lower: Double
    var upper: Double
    @ViewBuilder let content: (ClosedRange<Date>) -> Content

    init(_ domain: ClosedRange<Date>, @ViewBuilder content: @escaping (ClosedRange<Date>) -> Content) {
        lower = domain.lowerBound.timeIntervalSince1970
        upper = domain.upperBound.timeIntervalSince1970
        self.content = content
    }

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(lower, upper) }
        set {
            lower = newValue.first
            upper = newValue.second
        }
    }

    var body: some View {
        content(Date(timeIntervalSince1970: lower)...Date(timeIntervalSince1970: max(upper, lower)))
    }
}

/// The timed timeline in its place on the page: what's been presented, on the
/// domain Win Probability works out from the same inputs. The two stay
/// independent, movable modules; they share only inspection state, chronology,
/// domain and plot insets.
struct MatchTimelineSection: View {
    let history: MatchHistory
    let marks: [TimelineMark]
    let feed: OddsFeed
    let event: Event
    let names: (top: String, bottom: String)
    let palette: TeamPalette
    let pointer: OddsPointer
    var presentation: PresentationClock? = nil
    /// Win Probability isn't on the page to hold the pin's controls.
    var standsAlone = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let clock = presentation {
                TimelineView(.explicit(OddsSection.schedule(feed: feed, clock: clock, now: Date()))) { context in
                    content(until: Date(timeIntervalSince1970: clock.p(at: context.date.timeIntervalSince1970)))
                }
            } else {
                content(until: nil)
            }
            if standsAlone { SectionReplay(section: .timeline) }
        }
    }

    private func content(until: Date?) -> some View {
        let shown = history.shown(until: until)
        let window = pointer.window.effective(in: event.state)
        let latest = feed.latestTick(until: until)
        let domain = shown.domain(state: event.state, window: window, eventStart: event.start, latest: latest, until: until)
        let now = event.state == .live ? shown.now(eventStart: event.start, latest: latest, until: until) : nil
        let labelWidth = OddsStyle.labelWidth([names.top, names.bottom] + (feed.market?.threeWay == true ? ["Draw"] : []))
        return ZoomingDomain(domain) { domain in
            MatchTimeline(marks: marks,
                          scale: .wall(.init(history: shown, domain: domain, now: now, labelWidth: labelWidth, window: window, pointer: pointer)),
                          topColor: OddsStyle.line(palette.top), bottomColor: OddsStyle.line(palette.bottom),
                          topName: names.top, bottomName: names.bottom, showsPinControls: standsAlone)
        }
    }
}

// MARK: - Inspection

/// Hover, click and keys over a plot, the same in both modules. The pointer
/// reads (and its reading ends as it leaves, whatever has focus); a click holds
/// the moment, or the key play it's on, and again lets go. ←/→ step through
/// what's shown, ⌥←/→ between key plays. Instant: nothing here animates.
struct MatchInspection: ViewModifier {
    let layout: OddsLayout
    let marks: [TimelineMark]
    let pointer: OddsPointer
    /// The key play under a location, if any.
    let markAt: (CGPoint) -> TimelineMark?
    @FocusState private var focused: Bool
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    func body(content: Content) -> some View {
        content
            .onContinuousHover { phase in
                switch phase {
                case let .active(location): pointer.hover(moment(at: location))
                case .ended: pointer.hover(nil)
                }
            }
            .onTapGesture(coordinateSpace: .local) { location in
                guard let t = moment(at: location) else { return }
                let mark = markAt(location)
                pointer.toggle(mark?.t ?? t, play: mark?.id, within: layout.domain, linked: linked)
            }
            // Arrow-key inspection must work even when Keyboard Navigation is off: this takes focus on a click.
            .focusable(interactions: .edit)
            .focusEffectDisabled()
            .focused($focused)
            .onChange(of: focused) { _, on in
                // Tabbing in reads the latest, so the focus shows; a click is already a reading.
                if on, NSApp.currentEvent?.type == .keyDown { pointer.key(layout.readable.upperBound) }
                if !on { pointer.key(nil) }
            }
            .onKeyPress(keys: [.leftArrow, .rightArrow], phases: [.down, .repeat]) { press in
                let forward = press.key == .rightArrow
                if press.modifiers.contains(.option) {
                    MatchInspectionActions.select(forward: forward, marks: marks, range: layout.domain, pointer: pointer, linked: linked)
                } else {
                    pointer.step(forward ? 0.01 : -0.01, within: layout.readable, linked: linked)
                }
                return .handled
            }
            .onKeyPress(keys: [.return, .space], phases: .down) { _ in
                let t = pointer.moment ?? layout.readable.upperBound
                pointer.toggle(t, play: marks.first { $0.t == t }?.id, within: layout.domain, linked: linked)
                return .handled
            }
            .onKeyPress(.escape) { pointer.back(linked: linked) ? .handled : .ignored }
    }

    /// The moment under a location, on the plot; nothing can be read past now.
    private func moment(at location: CGPoint) -> Date? {
        guard location.y >= layout.bounds.minY, location.y <= layout.bounds.maxY,
              location.x >= layout.plot.minX, location.x <= layout.plot.maxX else { return nil }
        return layout.inspectionTime(at: location.x)
    }
}

/// The same moves for VoiceOver.
struct MatchInspectionActions: ViewModifier {
    let marks: [TimelineMark]
    let range: ClosedRange<Date>
    let pointer: OddsPointer
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    func body(content: Content) -> some View {
        content
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: pointer.step(0.01, within: range, linked: linked)
                case .decrement: pointer.step(-0.01, within: range, linked: linked)
                @unknown default: break
                }
            }
            .accessibilityAction(named: "Previous key play") {
                Self.select(forward: false, marks: marks, range: range, pointer: pointer, linked: linked)
            }
            .accessibilityAction(named: "Next key play") {
                Self.select(forward: true, marks: marks, range: range, pointer: pointer, linked: linked)
            }
            .accessibilityAction(named: "Return to latest") { pointer.clear(linked: linked) }
    }

    /// The next or previous key play from the reading (or the game's ends).
    static func destination(forward: Bool, marks: [TimelineMark], from moment: Date?) -> TimelineMark? {
        if forward { return marks.first { $0.t.map { $0 > (moment ?? .distantPast) } == true } }
        return marks.last { $0.t.map { $0 < (moment ?? .distantFuture) } == true }
    }

    /// Holds it, the whole game back in view if it's outside what's shown.
    @MainActor
    static func select(forward: Bool, marks: [TimelineMark], range: ClosedRange<Date>, pointer: OddsPointer, linked: LinkedFocus?) {
        guard let mark = destination(forward: forward, marks: marks, from: pointer.moment), let t = mark.t else { return }
        if !range.contains(t), pointer.window.period != nil { pointer.window = .game }
        pointer.hold(t, play: mark.id, linked: linked)
    }
}

/// What a pin offers, only while there is one: the play's replay, the way
/// through the key plays, and back to the latest.
struct MatchPinControls: View {
    let marks: [TimelineMark]
    let range: ClosedRange<Date>?
    let pointer: OddsPointer
    /// The module it's in: a replay opens under it.
    let section: DetailView.Section
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(PageReplays.self) private var replays: PageReplays?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let held = pointer.held {
                HStack(spacing: 10) {
                    if let id = pointer.heldPlay, let replays, replays.plays[Replays.play(of: id)] != nil {
                        replayButton(ReplayRow(section: section, play: Replays.play(of: id)), replays)
                    }
                    chevron(forward: false, from: held)
                    chevron(forward: true, from: held)
                    PinButton(title: "Latest", symbol: "arrow.uturn.backward", spoken: "Return to latest") { pointer.clear(linked: linked) }
                }
                .fixedSize()
            }
        }
        // Letting go of the play closes the replay it opened here.
        .onChange(of: pointer.heldPlay) { _, _ in
            if replays?.open?.section == section { replays?.close() }
        }
    }

    private func replayButton(_ row: ReplayRow, _ replays: PageReplays) -> some View {
        Button {
            withAnimation(reduceMotion ? Motion.fade : replays.open == row ? Motion.standard : Motion.travel) { replays.toggle(row) }
        } label: {
            Group {
                if replays.open == row {
                    Image(systemName: "xmark").font(.system(size: 8, weight: .semibold)).foregroundStyle(.secondary).frame(width: 10)
                } else {
                    ReplayGlyph(play: row.play).environment(\.rowHovered, true)
                }
            }
            .frame(height: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(replays.open == row ? "Close Replay" : "Watch Replay")
    }

    private func chevron(forward: Bool, from held: Date) -> some View {
        let target = MatchInspectionActions.destination(forward: forward, marks: marks, from: held)
        return PinButton(symbol: forward ? "chevron.right" : "chevron.left", spoken: forward ? "Next key play" : "Previous key play", enabled: target != nil) {
            MatchInspectionActions.select(forward: forward, marks: marks, range: range ?? held...held, pointer: pointer, linked: linked)
        }
    }
}

/// A small control in a chart's row: as tall as the text it sits beside, so
/// nothing moves when it appears. No tooltip: its glyph or word is the label.
struct PinButton: View {
    var title: String? = nil
    let symbol: String
    let spoken: String
    var enabled = true
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 3) {
                Image(systemName: symbol).font(Glyph.link).accessibilityHidden(true)
                if let title { Text(title) }
            }
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(hovering && enabled ? .primary : .secondary)
            .opacity(enabled ? 1 : 0.35)
            .frame(height: 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .onHover { hovering = $0 }
        .accessibilityLabel(spoken)
    }
}

/// Key plays' focus into the shared moment: a row hovered moves both charts'
/// line, a row pinned holds them there. Observation is confined to this
/// noninteractive leaf; `LinkedFocus` keeps its hover delay and grace.
struct MatchFocusLink: View {
    let history: MatchHistory?
    let linked: LinkedFocus
    let pointer: OddsPointer

    private struct Pin: Equatable {
        let play: String?
        let t: Date?
    }

    var body: some View {
        let hovered = time(linked.hovered)
        let pin = Pin(play: linked.pinned?.play, t: time(linked.pinned))
        Color.clear.frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: hovered, initial: true) { _, t in pointer.link(t) }
            .onChange(of: pin, initial: true) { _, pin in
                if let t = pin.t {
                    pointer.pin(t, play: pin.play)
                } else if pointer.heldPlay != nil {
                    pointer.pin(nil)
                }
            }
            .onDisappear { pointer.link(nil) }
    }

    private func time(_ focus: Focus?) -> Date? {
        focus?.play.flatMap { history?.time(of: $0) }
    }
}
