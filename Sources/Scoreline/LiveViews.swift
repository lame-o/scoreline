import SwiftUI

// Live visualizations, drawn from event coordinates the feeds provide.
// Moving parts use the shared `travel` spring; arrivals use the badge
// transition; Reduce Motion drops movement.

// MARK: - Soccer pitch

/// The pitch with the ball's latest position and the last few actions trailing
/// behind it, plus every shot of the match. Home (top) attacks right.
struct PitchView: View {
    let trail: [PitchAction]
    let shots: [PitchAction]
    let live: Bool
    let palette: TeamPalette
    let topName: String
    let bottomName: String
    /// Cards at the foul that drew them; drawn only when their key event is pointed at.
    var cards: [String: PitchAction] = [:]
    /// The soccer theater is on the page: the moments it replays (goals,
    /// saves, the woodwork) are its to celebrate and caption
    /// (`GoalCelebration`); the shot's path still draws here.
    var theater = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widthClass) private var widthClass
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    /// In the chart peek: the pitch alone, no footer.
    @Environment(\.chartPeek) private var peek
    /// Differentiate Without Color: the bottom team's marks are rounded
    /// squares and its last-touch ring is dashed, so sides differ by shape too.
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiate
    @Environment(\.spokenTeams) private var teams

    /// Fills the width up to this tall, then centers with its footer.
    static let maxPlotHeight: CGFloat = 260

    /// A mark's outline: a circle, or for the bottom team (Differentiate Without Color) a rounded square.
    private func shape(_ rect: CGRect, _ side: GameDetail.Side) -> Path {
        differentiate && side == .bottom ? Path(roundedRect: rect, cornerRadius: rect.width * 0.22) : Path(ellipseIn: rect)
    }

    /// A goal, shot or card that just happened, while it's news.
    private var moment: LiveMoment? { momentFor(.pitch, in: moments) }
    private var momentAction: PitchAction? {
        moment.flatMap { m in (trail + shots).last { $0.playID == m.id } ?? cards[m.id] }
    }

    /// The shot, card or (live) recent action a focus is on. Read in the small
    /// layers that change with it, so a hover never redraws the pitch.
    private func target(_ focus: Focus?) -> PitchAction? {
        guard let id = focus?.play else { return nil }
        return (live ? trail.last { $0.playID == id } : nil) ?? shots.first { $0.playID == id } ?? cards[id]
    }

    /// What can be pointed at: every shot, and while live the recent actions too.
    private var hoverable: [PitchAction] { live ? trail + shots : shots }

    private var ball: CGPoint? {
        guard let last = trail.last else { return nil }
        return CGPoint(x: last.endX ?? last.x, y: last.endY ?? last.y)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { geo in
                let size = geo.size
                let point = { (x: Double, y: Double) in CGPoint(x: size.width * x / 100, y: size.height * (100 - y) / 100) }
                ZStack(alignment: .topLeading) {
                    layers(size: size, point: point)
                        // The focused mark's room: everything under it stops short of it.
                        .clearing(focused: { focus in
                            target(focus).flatMap { t in Self.room(t).map { Clearance(point(t.x, t.y), radius: $0) } }
                        })
                    FocusReader { focus in
                        if let target = target(focus) {
                            emphasized(target)
                                .position(point(target.x, target.y))
                                .transition(reduceMotion ? .opacity : Motion.badgeTransition)
                        }
                    }
                }
                .compositingGroup()
                // The burst: confetti from where the ball crossed the line, a
                // save's glint at the stop, sparks at the post it rattled.
                .overlay(alignment: .topLeading) {
                    let stage = momentAction.flatMap { stage(for: $0, size: size, point: point) }
                    CelebrationStage(moment: stage == nil || !GoalCelebration.pitchBursts(moment, theaterShown: theater) ? nil : moment,
                                     origin: stage?.origin, size: size,
                                     colors: .team(stage?.color ?? Viz.neutral), direction: stage?.direction ?? .degrees(-90))
                }
                .contentShape(Rectangle())
                // The live trail and goals are drawn as lines: they answer
                // anywhere along them. Other shots are rings, pointed at where they're drawn.
                .linkedMarks(hoverable.map { action in
                    let lined = action.kind == .goal || (live && action.kind != .shot)
                    if lined, let ex = action.endX, let ey = action.endY {
                        return HoverMark(from: point(action.x, action.y), to: point(ex, ey))
                    }
                    return HoverMark(point(action.x, action.y))
                }) { [hoverable] in Focus(play: hoverable[$0].playID) }
                .animation(reduceMotion ? nil : Motion.travel, value: ball.map { [$0.x, $0.y] })
            }
            .aspectRatio(105.0 / 68.0, contentMode: .fit)
            .vizWell()

            if !peek {
                FocusReader { focus in footer(target: target(focus)) }
            }
        }
        .chartUnit(aspect: 105.0 / 68.0, maxHeight: Self.maxPlotHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// The legend, the pointed-at mark in words, or the latest action (live).
    private func footer(target: PitchAction?) -> some View {
        ChartFooter(readout: target.map { ($0.minute, MomentList.shortened($0.text)) },
                    moment: GoalCelebration.pitchBursts(moment, theaterShown: theater) ? moment : nil) {
            VizLegend {
                LegendItem(label: "\(topName) →") { Circle().fill(palette.top).frame(width: 7, height: 7) }
                LegendItem(label: "← \(bottomName)") {
                    if differentiate {
                        RoundedRectangle(cornerRadius: 1.5).fill(palette.bottom).frame(width: 7, height: 7)
                    } else {
                        Circle().fill(palette.bottom).frame(width: 7, height: 7)
                    }
                }
                if live, let last = trail.last {
                    Text("\(last.minute) \(last.text)").font(Viz.legend).foregroundStyle(.secondary).lineLimit(1)
                } else {
                    LegendItem(label: "Shot") { Circle().strokeBorder(Viz.neutral, lineWidth: 1.5).frame(width: 8, height: 8) }
                    LegendItem(label: "Goal and its path") {
                        HStack(spacing: 0) {
                            Circle().fill(Viz.neutral).frame(width: 9, height: 9)
                            Capsule().fill(Viz.neutral.opacity(0.75)).frame(width: 10, height: 1.5)
                        }
                    }
                }
                // With room to spare, the shots in numbers too.
                if widthClass >= .large, !shots.isEmpty {
                    Text(Self.summary(shots, topName: topName, bottomName: bottomName))
                        .font(Viz.legend).foregroundStyle(.secondary).lineLimit(1)
                        .widthDetail(.vertical)
                }
            }
        }
    }

    /// Everything under the focused mark: the pitch and its marks, the ball,
    /// the moment playing, the focused mark's path.
    private func layers(size: CGSize, point: @escaping (Double, Double) -> CGPoint) -> some View {
        ZStack(alignment: .topLeading) {
            ZStack(alignment: .topLeading) {
                PitchMarkings()
                marks(point: point)
                    .recedes { target($0) != nil }
            }
            // The ball's room: the trail and the lines beneath stop short of it, gliding with it.
            .clearing(moving: live ? ball.map { Clearance(point($0.x, $0.y), radius: 5.5) } : nil)
            if live, let ball {
                // The ball glides to each new position.
                // Plain white or black, not `primary`: on the glass panel a
                // primary *fill* is drawn vibrant and reads at about a third
                // of its strength, so the ball looked see-through.
                BallMark(center: point(ball.x, ball.y), radius: 4)
                    .fill(colorScheme == .dark ? Color.white : Color.black)
                // Last touch, not possession (events arrive late and in bursts):
                // a ring in the color of the team that acted last.
                if let last = trail.last {
                    BallMark(center: point(ball.x, ball.y), radius: 6.25)
                        .stroke(style: StrokeStyle(lineWidth: 1.25, dash: differentiate && last.side == .bottom ? [2, 1.5] : []))
                        .animation(Motion.fade) { $0.foregroundStyle(color(last.side)) }
                }
            }
            // What just happened, drawn as it happened, over the ball (which often sits
            // where the shot ended); pointing at the chart takes over.
            if let moment, let action = momentAction {
                Group {
                    switch moment.kind {
                    case .card:
                        emphasized(action)
                            .modifier(CardShown())
                            .position(point(action.x, action.y))
                    default:
                        ShotMoment(start: point(action.x, action.y),
                                   end: action.endX.flatMap { ex in action.endY.map { point(ex, $0) } },
                                   kind: moment.kind, color: color(action.side), pitch: size,
                                   accents: moment.accents, woodwork: Self.woodwork(action).map { point($0.x, $0.y) })
                    }
                }
                .id(moment.id)
                // Pointing at the chart takes over; it stays mounted so it plays once.
                .recedes(to: 0) { _ in true }
                .transition(reduceMotion ? .opacity : Motion.badgeTransition)
                .allowsHitTesting(false)
            }
            // Where it went: a shot's path to the goal line, or a pass to its receiver.
            FocusReader { focus in
                if let target = target(focus), let ex = target.endX, let ey = target.endY {
                    Canvas { context, _ in
                        var path = Path()
                        path.move(to: point(target.x, target.y))
                        path.addLine(to: point(ex, ey))
                        context.stroke(path, with: .color(color(target.side)),
                                       style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: target.kind == .pass ? [4, 3] : []))
                        let end = point(ex, ey)
                        context.fill(Path(ellipseIn: CGRect(x: end.x - 2.5, y: end.y - 2.5, width: 5, height: 5)),
                                     with: .color(color(target.side)))
                    }
                    .transition(.opacity)
                }
            }
        }
    }

    /// Every shot, and while live the last few actions.
    private func marks(point: @escaping (Double, Double) -> CGPoint) -> some View {
        Canvas { context, _ in
            // Shots: hollow rings; goals filled, each with room cleared around
            // it, and each goal's path from where it was struck to the line.
            func mark(_ shot: PitchAction) -> CGRect {
                let center = point(shot.x, shot.y), r: CGFloat = shot.kind == .goal ? 5 : 4
                return CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2)
            }
            let room = { (shot: PitchAction) in shot.kind == .goal ? Clearance(around: mark(shot)) : nil }
            let paths = context.clearing(shots.compactMap(room))
            for shot in shots where shot.kind == .goal {
                guard let ex = shot.endX, let ey = shot.endY else { continue }
                var c = paths
                c.opacity = live ? 0.30 : 0.75
                var path = Path()
                path.move(to: point(shot.x, shot.y))
                path.addLine(to: point(ex, ey))
                c.stroke(path, with: .color(color(shot.side)), style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
            }
            context.draw(shots, clearance: room) { shot, context in
                let rect = mark(shot)
                var c = context
                c.opacity = live ? 0.30 : 1
                if shot.kind == .goal {
                    c.fill(shape(rect, shot.side), with: .color(color(shot.side)))
                } else {
                    c.stroke(shape(rect.insetBy(dx: 0.75, dy: 0.75), shot.side), with: .color(color(shot.side)), lineWidth: 1.5)
                }
            }
            guard live else { return }
            // The last actions, oldest faintest.
            for (index, action) in trail.enumerated() {
                let newest = index == trail.count - 1
                let alpha = 0.15 + 0.85 * Double(index + 1) / Double(max(trail.count, 1))
                let start = point(action.x, action.y)
                var path = Path()
                path.move(to: start)
                if let ex = action.endX, let ey = action.endY {
                    path.addLine(to: point(ex, ey))
                } else if index + 1 < trail.count {
                    path.addLine(to: point(trail[index + 1].x, trail[index + 1].y))
                }
                context.stroke(path, with: .color(color(action.side).opacity(alpha)),
                               style: StrokeStyle(lineWidth: newest ? 2 : 1.5, lineCap: .round))
                context.fill(shape(CGRect(x: start.x - 1.5, y: start.y - 1.5, width: 3, height: 3), action.side),
                             with: .color(color(action.side).opacity(alpha)))
            }
        }
    }

    /// "AVL 12 shots, 2 goals · MCI 9 shots, 1 goal".
    static func summary(_ shots: [PitchAction], topName: String, bottomName: String) -> String {
        func line(_ side: GameDetail.Side, _ name: String) -> String {
            let mine = shots.filter { $0.side == side }
            let goals = mine.filter { $0.kind == .goal }.count
            return "\(name) \(mine.count) \(mine.count == 1 ? "shot" : "shots"), \(goals) \(goals == 1 ? "goal" : "goals")"
        }
        return line(.top, topName) + " · " + line(.bottom, bottomName)
    }

    private func color(_ side: GameDetail.Side) -> Color { side == .top ? palette.top : palette.bottom }

    /// Where a shot off the woodwork struck, on the pitch's 0…100 scale: the
    /// goal line it was heading for, at the post (or bar) it hit.
    static func woodwork(_ a: PitchAction) -> (x: Double, y: Double)? {
        guard let y = a.woodworkY else { return nil }
        return (a.endX ?? (a.side == .top ? 100 : 0), y)
    }

    /// The moment's burst: where, which way, in whose color. A goal's confetti
    /// flies back into the pitch from where the ball crossed the line.
    private func stage(for a: PitchAction, size: CGSize,
                       point: (Double, Double) -> CGPoint) -> (origin: CGPoint, direction: Angle, color: Color)? {
        guard let moment else { return nil }
        let end = a.endX.flatMap { ex in a.endY.map { point(ex, $0) } }
        switch moment.kind {
        case .goal:
            let right = (end?.x ?? (a.side == .top ? size.width : 0)) > size.width / 2
            let origin = end.map { CGPoint(x: right ? size.width : 0, y: min(max($0.y, size.height / 2 - size.height * 3.66 / 68),
                                                                                   size.height / 2 + size.height * 3.66 / 68)) }
                ?? CGPoint(x: right ? size.width : 0, y: size.height / 2)
            return (origin, .degrees(right ? -150 : -30), color(a.side))
        case .shotSaved:
            return end.map { ($0, .degrees(-90), color(a.side)) }
        case .shotWide where moment.accents.contains(.woodwork):
            return Self.woodwork(a).map { (point($0.x, $0.y), .degrees(-90), color(a.side)) }
        default:
            return nil
        }
    }

    /// The room the focused mark keeps clear around it (a card sits on its own).
    static func room(_ a: PitchAction) -> CGFloat? {
        switch a.kind {
        case .yellow, .red: nil
        case .pass, .other: 7
        case .shot, .goal: 10
        }
    }

    /// The focused shot, larger and ringed; a card as the card itself.
    @ViewBuilder
    private func emphasized(_ a: PitchAction) -> some View {
        switch a.kind {
        case .yellow, .red:
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(a.kind == .red ? Color.red : Color.yellow)
                .frame(width: 8, height: 11)
                .overlay(RoundedRectangle(cornerRadius: 1.5, style: .continuous).strokeBorder(Color.black.opacity(0.25), lineWidth: 0.5))
                .rotationEffect(.degrees(8))
        case .pass, .other:
            // A recent action on the live trail.
            ZStack {
                Circle().fill(color(a.side)).frame(width: 7, height: 7)
                Circle().strokeBorder(Color.primary, lineWidth: 1).frame(width: 12, height: 12)
            }
            .frame(width: 14, height: 14)
        default:
            ZStack {
                if a.kind == .goal {
                    Circle().fill(color(a.side)).frame(width: 12, height: 12)
                } else {
                    Circle().strokeBorder(color(a.side), lineWidth: 2).frame(width: 12, height: 12)
                }
                Circle().strokeBorder(Color.primary, lineWidth: 1).frame(width: 17, height: 17)
            }
            .frame(width: 20, height: 20)
        }
    }

    private var accessibilityText: String {
        let top = teams?.top ?? topName, bottom = teams?.bottom ?? bottomName
        if live, let last = trail.last {
            return "Live pitch. Latest: \(Spoken.status(last.minute)), \(last.text), last touch \(last.side == .top ? top : bottom). "
                + "\(plural(shots.count, "shot")) so far."
        }
        func count(_ side: GameDetail.Side) -> String {
            let mine = shots.filter { $0.side == side }
            return "\(plural(mine.count, "shot")), \(plural(mine.filter { $0.kind == .goal }.count, "goal"))"
        }
        return "Shot map. \(top): \(count(.top)). \(bottom): \(count(.bottom))."
    }
}

/// A shot as it happens: its path draws from where it was struck to where it
/// ended, then a goal lights the goal mouth and bellies the net, a save or
/// block stops at a small tick, a shot off the woodwork rattles the post, and
/// a miss fades away. A big chance draws at a goal's weight and lingers before
/// it goes. A ring marks where it was struck.
private struct ShotMoment: View {
    let start: CGPoint
    let end: CGPoint?
    let kind: LiveMoment.Kind
    let color: Color
    let pitch: CGSize
    var accents: LiveMoment.Accents = []
    /// Where a shot off the woodwork struck: a post, or the bar.
    var woodwork: CGPoint? = nil
    @State private var drawn: CGFloat = 0
    @State private var landed = false
    @State private var faded = false
    @State private var rattles = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationClock) private var clock

    /// When the path reaches its end and what happens there happens.
    static let lands = 0.35
    /// The goal mouth (7.32 m of a 68 m pitch), half of it.
    private var mouth: CGFloat { pitch.height * 3.66 / 68 }
    private var bigChance: Bool { accents.contains(.bigChance) }
    /// A miss fades once it's past; a big chance lingers 0.4 s longer.
    private var fadeDelay: Double { 0.45 + (bigChance ? 0.4 : 0) }

    var body: some View {
        let t = clock.frozenTime
        // Under the frozen clock, every part read off t; live, off the state the animations drive.
        let drawn = t.map { reduceMotion ? 1 : Celebrate.travel($0) } ?? drawn
        let landed = t.map { $0 >= (reduceMotion ? 0 : Self.lands) } ?? landed
        let fadeOut: Double = t.map { kind == .shotWide ? Motion.curve.value(at: min(max(($0 - fadeDelay) / 0.6, 0), 1)) : 0 }
            ?? (faded ? 1 : 0)
        ZStack(alignment: .topLeading) {
            if let end {
                let goalSide = end.x > pitch.width / 2
                Path { path in
                    path.move(to: start)
                    path.addLine(to: end)
                }
                .trim(from: 0, to: drawn)
                .stroke(color.opacity(kind == .goal || bigChance ? 1 : 0.8),
                        style: StrokeStyle(lineWidth: kind == .goal || bigChance ? 2 : 1.5, lineCap: .round))
                .opacity(1 - fadeOut)
                if landed {
                    switch kind {
                    case .goal:
                        // The net behind the line bellies out, then the mouth lights in the scorer's color.
                        let x = goalSide ? pitch.width - 1 : 1
                        NetRipple(near: CGPoint(x: x, y: pitch.height / 2 - mouth), far: CGPoint(x: x, y: pitch.height / 2 + mouth),
                                  outward: goalSide ? 1 : -1, color: color, delay: Self.lands)
                        Capsule().fill(color)
                            .frame(width: 3, height: mouth * 2)
                            .position(x: goalSide ? pitch.width - 1.5 : 1.5, y: pitch.height / 2)
                            .transition(.opacity)
                    case .shotSaved, .shotBlocked:
                        Capsule().fill(kind == .shotSaved ? Color.primary : Viz.neutral)
                            .frame(width: 1.5, height: 8)
                            .rotationEffect(.radians(atan2(end.y - start.y, end.x - start.x) + .pi / 2))
                            .position(end)
                            .transition(Motion.badgeTransition)
                    default:
                        if let woodwork {
                            // The post (or bar) it hit, rattling along the goal line. In the
                            // shooter's color with a hairline edge: the ball often rests on it.
                            Capsule().fill(color)
                                .overlay(Capsule().strokeBorder(Color.primary.opacity(0.5), lineWidth: 1).padding(-1))
                                .frame(width: 3, height: 7)
                                .knock(t == nil ? rattles : 1, amplitude: 2,
                                       outward: woodwork.y < pitch.height / 2 ? -1 : 1, axis: .vertical)
                                .modifier(ShiftedClock(by: Self.lands))
                                .position(woodwork)
                                .transition(.opacity)
                        }
                    }
                }
            }
            MomentPing(color: color).position(start)
        }
        .onAppear {
            guard t == nil else { return }
            guard !reduceMotion else {
                self.drawn = 1
                self.landed = true
                return
            }
            withAnimation(Motion.travel) { self.drawn = 1 }
            withAnimation(Motion.reveal.delay(Self.lands)) { self.landed = true }
            // A miss: "it went past", then it's gone.
            if kind == .shotWide { withAnimation(Motion.ping.delay(fadeDelay)) { faded = true } }
        }
        .task {
            // The post rattles as the ball reaches it.
            guard t == nil, woodwork != nil else { return }
            try? await Task.sleep(for: .seconds(Self.lands))
            rattles += 1
        }
    }
}

/// A card being shown: it swings round from edge-on to face the viewer
/// (Motion.pop), ending exactly as the card always looks. Appears plainly
/// with Reduce Motion or with celebrations off.
private struct CardShown: ViewModifier {
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    private static let spring = Spring(duration: 0.4, bounce: 0.2)

    func body(content: Content) -> some View {
        let turns = level != .off && !reduceMotion
        let p = clock.frozenTime.map { $0 < Self.spring.settlingDuration ? Self.spring.value(target: 1.0, time: $0) : 1 } ?? (shown ? 1 : 0)
        content
            .rotation3DEffect(.degrees(turns ? 75 * (1 - p) : 0), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
            .onAppear {
                guard turns, clock == .live else { return }
                withAnimation(Motion.pop) { shown = true }
            }
    }
}

/// A ball put in play, as it happens: its flight draws from home plate (an arc
/// for a home run, a line otherwise), then it lands as its mark. A hit pings
/// where it fell; a home run also lights the fence it cleared; an out's line
/// fades as it's caught.
private struct SprayFlight: View {
    let home: CGPoint
    let landing: CGPoint
    let fence: CGFloat
    let outcome: GameDetail.BattedBall.Outcome
    let color: Color
    @State private var drawn: CGFloat = 0
    @State private var landed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationClock) private var clock

    /// When the ball lands (its fireworks wait for it).
    static let lands = 0.3

    var body: some View {
        let t = clock.frozenTime
        let drawn = t.map { reduceMotion ? 1 : Celebrate.travel($0) } ?? drawn
        let landed = t.map { $0 >= (reduceMotion ? 0 : Self.lands) } ?? landed
        ZStack(alignment: .topLeading) {
            flight
                .trim(from: 0, to: drawn)
                .stroke(color.opacity(0.7), style: StrokeStyle(lineWidth: 1, lineCap: .round))
                .opacity(landed && outcome == .out ? 0 : 1)
            if outcome == .homeRun {
                fenceArc
                    .trim(from: 0, to: landed ? 1 : 0)
                    .stroke(color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            }
            if landed {
                mark
                    .position(landing)
                    .transition(reduceMotion ? .opacity : Motion.badgeTransition)
                if outcome != .out {
                    MomentPing(color: color, reach: outcome == .homeRun ? 2.2 : 1.8).position(landing)
                }
            }
        }
        .onAppear {
            guard t == nil else { return }
            guard !reduceMotion else {
                self.drawn = 1
                self.landed = true
                return
            }
            withAnimation(Motion.travel) { self.drawn = 1 }
            withAnimation(Motion.reveal.delay(Self.lands)) { self.landed = true }
        }
    }

    /// Home runs arc (the control point lifts toward the top by 0.18 × length).
    private var flight: Path {
        Path { path in
            path.move(to: home)
            guard outcome == .homeRun else {
                path.addLine(to: landing)
                return
            }
            let mid = CGPoint(x: (home.x + landing.x) / 2, y: (home.y + landing.y) / 2)
            let length = hypot(landing.x - home.x, landing.y - home.y)
            var normal = CGVector(dx: landing.y - home.y, dy: home.x - landing.x)
            if normal.dy > 0 { normal = CGVector(dx: -normal.dx, dy: -normal.dy) }
            let scale = length == 0 ? 0 : 0.18 * length / hypot(normal.dx, normal.dy)
            path.addQuadCurve(to: landing, control: CGPoint(x: mid.x + normal.dx * scale, y: mid.y + normal.dy * scale))
        }
    }

    /// The stretch of fence within 10° of where it went out.
    private var fenceArc: Path {
        let bearing = atan2(landing.y - home.y, landing.x - home.x)
        return Path { path in
            path.addArc(center: home, radius: fence, startAngle: .radians(bearing - .pi / 18),
                        endAngle: .radians(bearing + .pi / 18), clockwise: false)
        }
    }

    /// The same marks the chart draws: filled for a hit, a ring for an out, a
    /// ringed dot for a home run.
    @ViewBuilder private var mark: some View {
        switch outcome {
        case .out:
            Circle().strokeBorder(color, lineWidth: 1.5).frame(width: 8, height: 8)
        case .homeRun:
            Circle().fill(color).frame(width: 10, height: 10)
                .overlay(Circle().stroke(Color.primary, lineWidth: 1).padding(-1.5))
        case .single, .extraBases:
            Circle().fill(color).frame(width: 8, height: 8)
        }
    }
}

/// A circle at an animatable position, so the ball glides between actions.
private struct BallMark: Shape {
    var center: CGPoint
    var radius: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(center.x, center.y) }
        set { center = CGPoint(x: newValue.first, y: newValue.second) }
    }

    func path(in rect: CGRect) -> Path {
        Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
    }
}

/// Pitch lines to scale (105 × 68 m), in the shared marking ink.
private struct PitchMarkings: View {
    var body: some View {
        Canvas { context, size in
            let sx = size.width / 105, sy = size.height / 68
            func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect {
                CGRect(x: x * sx, y: y * sy, width: w * sx, height: h * sy)
            }
            var lines = Path()
            lines.addRect(rect(0, 0, 105, 68))
            lines.move(to: CGPoint(x: 52.5 * sx, y: 0)); lines.addLine(to: CGPoint(x: 52.5 * sx, y: 68 * sy))
            lines.addEllipse(in: rect(52.5 - 9.15, 34 - 9.15, 18.3, 18.3))
            lines.addRect(rect(0, 34 - 20.16, 16.5, 40.32))           // penalty areas
            lines.addRect(rect(105 - 16.5, 34 - 20.16, 16.5, 40.32))
            lines.addRect(rect(0, 34 - 9.16, 5.5, 18.32))             // goal areas
            lines.addRect(rect(105 - 5.5, 34 - 9.16, 5.5, 18.32))
            context.stroke(lines, with: .color(Viz.markings), lineWidth: 1)
            var goals = Path()                                          // goal mouths
            goals.move(to: CGPoint(x: 1, y: (34 - 3.66) * sy)); goals.addLine(to: CGPoint(x: 1, y: (34 + 3.66) * sy))
            goals.move(to: CGPoint(x: size.width - 1, y: (34 - 3.66) * sy)); goals.addLine(to: CGPoint(x: size.width - 1, y: (34 + 3.66) * sy))
            context.stroke(goals, with: .color(Viz.reference), lineWidth: 2)
            context.fill(Path(ellipseIn: rect(52.5 - 0.4, 34 - 0.4, 0.8, 0.8)), with: .color(Viz.reference))
        }
    }
}

// MARK: - Baseball

/// The current at-bat: each pitch where it crossed the zone, numbered in order.
/// Balls are rings, strikes and balls in play are filled, so the result never
/// depends on color alone.
struct StrikeZoneView: View {
    let pitches: [GameDetail.Pitch]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.celebrationClock) private var clock
    /// Without a page focus (previews), hover is tracked here.
    @State private var localHover: String?
    /// Strike three: the pitch that ended the at-bat, and one step per strikeout (its pop).
    @State private var strikeThree: String?
    @State private var punchOuts = 0
    /// The room the list has for a pitch's name (whole points, written only
    /// when it changes). Each row names its pitch in the longest form that
    /// fits: the full name ("Four-seam fastball"), the short one
    /// ("Four-seam"), else the code ("KC"); never "Knuckl…", which could be
    /// a knuckle curve or a knuckleball.
    @State private var nameRoom: CGFloat = .infinity

    /// A pitch's names, longest first: full, short, code. (pure; tested)
    nonisolated static func names(_ pitch: GameDetail.Pitch) -> [String] {
        let short = pitch.type.flatMap { GameDetail.Pitch.names[$0] }
        let full = pitch.type.flatMap { GameDetail.Pitch.official[$0] } ?? pitch.typeName ?? short ?? pitch.type ?? "Pitch"
        return [full, short ?? full, pitch.type ?? short ?? full]
    }

    /// The longest of a pitch's names that fits `room`. (pure; tested)
    nonisolated static func name(_ names: [String], room: CGFloat) -> String {
        let font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        return names.first { ($0 as NSString).size(withAttributes: [.font: font]).width <= room } ?? names[names.count - 1]
    }

    /// What a list row needs besides the name: the mark (10), the number
    /// (16), the spacer's minimum (2), the result, the five 6pt gaps,
    /// and the widest speed.
    private func listFixed() -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .regular)
        let speed = pitches.compactMap(\.mph).map { ("\($0)" as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
        return 10 + 16 + 2 + Self.resultWidth + 5 * 6 + speed.rounded(.up)
    }

    /// The result column fits its longest word ("Swinging") from the first
    /// pitch, so nothing moves when one arrives.
    private static let resultWidth: CGFloat = {
        let font = NSFont.systemFont(ofSize: 10)
        return ["Swinging", "Foul tip", "In play"].map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max()!.rounded(.up)
    }()


    private func hover(_ id: String, _ inside: Bool) {
        if let linked {
            linked.hover(Focus(play: id), inside)
        } else if inside {
            // Hover is instant (the house rule).
            localHover = id
        } else if localHover == id {
            localHover = nil
        }
    }

    /// Red for a strikeout, green for a walk, while it's news.
    private var verdict: Color? {
        guard let m = momentFor(.plate, in: moments) else { return nil }
        return m.kind == .strikeout ? .red : m.kind == .walk ? .green : nil
    }

    // ESPN pitch coordinates around the zone (zone: x 91…141, y 148…192).
    private let domainX = 56.0...176.0
    private let domainY = 128.0...226.0
    /// One step up from large: more room between pitches, the same 16pt marks.
    static func plotSize(_ width: WidthClass) -> CGSize {
        width >= .large ? CGSize(width: 150, height: 188) : CGSize(width: 120, height: 150)
    }
    private var plot: CGSize { Self.plotSize(widthClass) }
    static let listMaxWidth: CGFloat = 280

    /// The latest pitch and the focused one keep room clear around them,
    /// drawn above the rest (focused on top).
    private func rooms(focused: String?) -> [(id: String, z: Int, room: Clearance)] {
        pitches.compactMap { pitch in
            let z = pitch.id == focused ? 2 : pitch.id == pitches.last?.id ? 1 : 0
            return z == 0 ? nil : (pitch.id, z, Clearance(map(pitch.x, pitch.y), radius: 10))
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack(alignment: .topLeading) {
                let zoneOrigin = map(91, 148), zoneEnd = map(141, 192)
                ZStack(alignment: .topLeading) {
                    Canvas { context, _ in
                        let zone = CGRect(x: zoneOrigin.x, y: zoneOrigin.y, width: zoneEnd.x - zoneOrigin.x, height: zoneEnd.y - zoneOrigin.y)
                        var thirds = Path()
                        for i in 1...2 {
                            let x = zone.minX + zone.width * Double(i) / 3, y = zone.minY + zone.height * Double(i) / 3
                            thirds.move(to: CGPoint(x: x, y: zone.minY)); thirds.addLine(to: CGPoint(x: x, y: zone.maxY))
                            thirds.move(to: CGPoint(x: zone.minX, y: y)); thirds.addLine(to: CGPoint(x: zone.maxX, y: y))
                        }
                        context.stroke(thirds, with: .color(Viz.grid), lineWidth: 0.5)
                        context.stroke(Path(roundedRect: zone, cornerRadius: 2), with: .color(Viz.reference), lineWidth: 1)
                        // Home plate, catcher's view.
                        let plateTop = zone.maxY + 14, w: CGFloat = 36, mid = zone.midX
                        var plate = Path()
                        plate.move(to: CGPoint(x: mid - w / 2, y: plateTop))
                        plate.addLine(to: CGPoint(x: mid + w / 2, y: plateTop))
                        plate.addLine(to: CGPoint(x: mid + w / 2, y: plateTop + 5))
                        plate.addLine(to: CGPoint(x: mid, y: plateTop + 11))
                        plate.addLine(to: CGPoint(x: mid - w / 2, y: plateTop + 5))
                        plate.closeSubpath()
                        context.stroke(plate, with: .color(Color.primary.opacity(0.25)), lineWidth: 1)
                    }
                    // A strikeout or a walk: the zone's outline flashes red or green.
                    if let verdict {
                        RoundedRectangle(cornerRadius: 2).stroke(verdict, lineWidth: 1.5)
                            .frame(width: zoneEnd.x - zoneOrigin.x, height: zoneEnd.y - zoneOrigin.y)
                            .position(x: (zoneOrigin.x + zoneEnd.x) / 2, y: (zoneOrigin.y + zoneEnd.y) / 2)
                            .transition(.asymmetric(insertion: .opacity.animation(Motion.fade),
                                                    removal: .opacity.animation(Motion.ping)))
                            .allowsHitTesting(false)
                    }
                }
                // The zone's lines stop short of the latest and the focused pitch.
                .clearing(focusedRooms: { focus in rooms(focused: focus?.play ?? localHover).map(\.room) })
                // The marks read the focus; the zone's lines don't redraw on a hover.
                FocusReader { focus in
                    let hovered = focus?.play ?? localHover
                    let rooms = rooms(focused: hovered)
                    ForEach(pitches) { pitch in
                        let latest = pitch.id == pitches.last?.id
                        let focused = hovered == pitch.id
                        let at = map(pitch.x, pitch.y)
                        let z = focused ? 2 : latest ? 1 : 0
                        ZStack {
                            PitchMarker(pitch: pitch, size: 16)
                                // The punch-out: strike three pops 1 → 1.3 → 1.
                                .scorePop(punchOut(pitch), scale: 1.3)
                            if focused {
                                Circle().strokeBorder(Color.primary, lineWidth: 1).frame(width: 21, height: 21)
                            }
                        }
                        .frame(width: 24, height: 24)
                        // Under the latest or focused pitch: room for it (in this mark's own space).
                        .clearing(rooms.filter { $0.id != pitch.id && $0.z > z }.map {
                            Clearance(CGPoint(x: $0.room.center.x - at.x + 12, y: $0.room.center.y - at.y + 12), radius: $0.room.radius)
                        })
                        .contentShape(Circle())
                        .onHover { hover(pitch.id, $0) }
                        .opacity(hovered == nil || focused ? 1 : Viz.receded)
                        .position(at)
                        .zIndex(Double(z))
                        .transition(reduceMotion ? .opacity : Motion.badgeTransition)
                    }
                }
            }
            .frame(width: plot.width, height: plot.height)
            .compositingGroup()
            .vizWell()
            .animation(reduceMotion ? Motion.fade : Motion.quick, value: pitches.map(\.id))

            VStack(alignment: .leading, spacing: 5) {
                ForEach(pitches.reversed()) { pitch in
                    let latest = pitch.id == pitches.last?.id
                    let name = Self.names(pitch)
                    HStack(spacing: 6) {
                        PitchMarker(pitch: pitch, size: 10, numbered: false)
                        // Two digits for a long at-bat (10–21 pitches are real), never stacked.
                        Text("\(pitch.number)").foregroundStyle(.secondary).lineLimit(1)
                            .frame(minWidth: 16, alignment: .trailing)
                        Text(Self.name(name, room: nameRoom))
                            .font(.system(size: 11, weight: latest ? .semibold : .medium))
                            .lineLimit(1)
                            .help(name[0])
                        Spacer(minLength: 2)
                        // Numbers never give way: the pitch name does.
                        Text(pitch.mph.map { "\($0)" } ?? "").foregroundStyle(.secondary).fixedSize()
                        Text(Self.resultWord(pitch)).font(.system(size: 10)).foregroundStyle(.secondary)
                            .lineLimit(1).fixedSize()
                            .frame(width: Self.resultWidth, alignment: .trailing)
                    }
                    .font(.system(size: 11).monospacedDigit())
                    // A click pins the pitch on the zone, like every linked row.
                    .linkedRow(Focus(play: pitch.id), litBy: { [localHover] in ($0?.play ?? localHover) == pitch.id }, pinnable: true)
                    .onHover { inside in if linked == nil { hover(pitch.id, inside) } }
                }
                if pitches.isEmpty {
                    Text("Waiting for the first pitch").font(Viz.note).foregroundStyle(.secondary)
                }
            }
            // A short list: past this, speed and result drift away from the pitch name.
            .frame(maxWidth: Self.listMaxWidth, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { [fixed = listFixed()] proxy in
                (proxy.size.width - fixed).rounded(.down)
            } action: { nameRoom = $0 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .onChange(of: momentFor(.plate, in: moments)?.id) { _, _ in
            guard momentFor(.plate, in: moments)?.kind == .strikeout, let last = pitches.last else { return }
            strikeThree = last.id
            punchOuts += 1
        }
    }

    /// A pitch's pop trigger: it steps for the strikeout's last pitch and holds
    /// after the moment, so nothing pops again when it clears.
    private func punchOut(_ pitch: GameDetail.Pitch) -> Int {
        if clock.frozenTime != nil {
            return momentFor(.plate, in: moments)?.kind == .strikeout && pitch.id == pitches.last?.id ? 1 : 0
        }
        return pitch.id == strikeThree ? punchOuts : 0
    }

    /// ESPN coordinates → plot points, clamped 8pt inside the edge.
    private func map(_ x: Double, _ y: Double) -> CGPoint {
        let px = plot.width * (x - domainX.lowerBound) / (domainX.upperBound - domainX.lowerBound)
        let py = plot.height * (y - domainY.lowerBound) / (domainY.upperBound - domainY.lowerBound)
        return CGPoint(x: min(max(px, 8), plot.width - 8), y: min(max(py, 8), plot.height - 8))
    }

    /// What the pitch did, in the list: how a strike came, not just "Strike". (pure; tested)
    nonisolated static func resultWord(_ pitch: GameDetail.Pitch) -> String {
        switch (pitch.result, pitch.strike) {
        case (.ball, _): "Ball"
        case (.inPlay, _): "In play"
        case (.strike, .called?): "Called"
        case (.strike, .swinging?): "Swinging"
        case (.strike, .foul?): "Foul"
        case (.strike, .foulTip?): "Foul tip"
        case (.strike, nil): "Strike"
        }
    }

    /// The same, read aloud.
    private static func spokenResult(_ pitch: GameDetail.Pitch) -> String {
        switch (pitch.result, pitch.strike) {
        case (.strike, .called?): "called strike"
        case (.strike, .swinging?): "swinging strike"
        case (.strike, .foul?): "foul ball"
        default: resultWord(pitch).lowercased()
        }
    }

    private var accessibilityText: String {
        guard let last = pitches.last else { return "No pitches yet this at-bat." }
        let speed = last.mph.map { ", \($0) miles per hour" } ?? ""
        return "\(pitches.count) pitches this at-bat. Latest: pitch \(last.number), \(last.typeName ?? "pitch")\(speed), \(Self.spokenResult(last))."
    }
}

/// A pitch mark: filled red (strike), filled blue (in play), green ring (ball).
private struct PitchMarker: View {
    let pitch: GameDetail.Pitch
    let size: CGFloat
    var numbered = true

    var body: some View {
        ZStack {
            switch pitch.result {
            case .strike: Circle().fill(Color.red)
            case .inPlay: Circle().fill(Color.blue)
            case .ball: Circle().strokeBorder(Color.green, lineWidth: 1.5)
            }
            if numbered {
                Text("\(pitch.number)")
                    .font(Viz.inMark)
                    .foregroundStyle(pitch.result == .ball ? Color.primary : .white)
            }
        }
        .frame(width: size, height: size)
    }
}

/// Every ball in play on the field, colored by batting team.
struct SprayChartView: View {
    let balls: [GameDetail.BattedBall]
    let palette: TeamPalette
    let topName: String
    let bottomName: String
    /// A home run's fireworks: off when the play theater on the page owns them
    /// (`PlateCelebration`); the ball still flies in.
    var celebrates = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    /// In the chart peek: the field alone, no footer.
    @Environment(\.chartPeek) private var peek
    /// Differentiate Without Color: the bottom team's balls are rounded
    /// squares, so the two teams differ by shape as well as color.
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiate
    @Environment(\.spokenTeams) private var teams

    /// Fills the width up to this tall, then centers with its footer.
    static let maxPlotHeight: CGFloat = 300

    /// A ball's outline: a circle, or for the bottom team (Differentiate Without Color) a rounded square.
    private func shape(_ rect: CGRect, _ side: GameDetail.Side?) -> Path {
        differentiate && side == .bottom ? Path(roundedRect: rect, cornerRadius: rect.width * 0.22) : Path(ellipseIn: rect)
    }

    /// The ball just put in play, while it's news: it flies in instead of
    /// appearing with the others.
    private var flying: GameDetail.BattedBall? {
        guard let m = moment else { return nil }
        return balls.first { $0.id == m.id }
    }

    private var moment: LiveMoment? { momentFor(.plate, in: moments) }

    // ESPN hit coordinates: home plate ≈ (125, 205); fence ≈ 165 units out.
    private let home = CGPoint(x: 125, y: 205)
    private let fence = 165.0
    private let domain = CGRect(x: 0, y: 10, width: 250, height: 210)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { geo in
                let scale = min(geo.size.width / domain.width, geo.size.height / domain.height)
                let inset: CGFloat = 5
                let map = { (x: Double, y: Double) -> CGPoint in
                    CGPoint(x: min(max((x - domain.minX) * scale, inset), geo.size.width - inset),
                            y: min(max((y - domain.minY) * scale, inset), geo.size.height - inset))
                }
                Canvas { context, _ in
                    let h = map(home.x, home.y)
                    let r = fence * scale
                    var field = Path()
                    field.move(to: h)
                    field.addArc(center: h, radius: r, startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
                    field.closeSubpath()
                    context.fill(field, with: .color(Color.primary.opacity(0.035)))
                    context.stroke(field, with: .color(Viz.markings), lineWidth: 1)
                    var infield = Path()
                    infield.addArc(center: h, radius: 62 * scale, startAngle: .degrees(-135), endAngle: .degrees(-45), clockwise: false)
                    context.stroke(infield, with: .color(Color.primary.opacity(0.12)), lineWidth: 0.5)
                    let b = 37 * scale * 0.7071
                    let bases = [CGPoint(x: h.x + b, y: h.y - b), CGPoint(x: h.x, y: h.y - 2 * b), CGPoint(x: h.x - b, y: h.y - b)]
                    var diamond = Path()
                    diamond.move(to: h)
                    bases.forEach { diamond.addLine(to: $0) }
                    diamond.closeSubpath()
                    context.stroke(diamond, with: .color(Color.primary.opacity(0.28)), lineWidth: 1)
                    for base in bases {
                        let square = Path(CGRect(x: -2, y: -2, width: 4, height: 4))
                            .applying(CGAffineTransform(rotationAngle: .pi / 4).concatenating(CGAffineTransform(translationX: base.x, y: base.y)))
                        context.fill(square, with: .color(Color.primary.opacity(0.4)))
                    }
                }
                // Balls picked out from a scoring play, an inning's cell, or the
                // pointer. Read in the small layers that change with the focus: a
                // hover never redraws the field or its balls.
                let lights = { (f: Focus) in balls.contains { f.matches(play: $0.id, period: $0.period, side: $0.side) } }
                Canvas { context, _ in
                    // Each hit clears room in the balls before it.
                    context.draw(balls.filter { $0.id != flying?.id }, clearance: { room($0, at: map($0.x, $0.y)) }) { ball, context in
                        draw(ball, at: map(ball.x, ball.y), in: context)
                    }
                }
                .recedes(when: lights)
                if let ball = flying {
                    SprayFlight(home: map(home.x, home.y), landing: map(ball.x, ball.y), fence: fence * scale,
                                outcome: ball.outcome, color: ball.side == .bottom ? palette.bottom : palette.top)
                        .id(ball.id)
                        // Pointing at the chart takes over; it stays mounted so it plays once.
                        .recedes(to: 0) { _ in true }
                        .transition(.opacity)
                        .allowsHitTesting(false)
                    // …and the ball sits with the others, as drawn.
                    FocusReader { focus in
                        if focus != nil {
                            Canvas { context, _ in draw(ball, at: map(ball.x, ball.y), in: context) }
                                .recedes(when: lights)
                        }
                    }
                }
                FocusReader { focus in
                    ForEach(focus.map { f in balls.filter { f.matches(play: $0.id, period: $0.period, side: $0.side) } } ?? []) { ball in
                        Canvas { context, _ in draw(ball, at: map(ball.x, ball.y), in: context, emphasized: true) }
                            .transition(.opacity)
                    }
                }
                Color.clear
                    .contentShape(Rectangle())
                    .linkedMarks(balls.map { map($0.x, $0.y) }) {
                        Focus(play: balls[$0].id, period: balls[$0].period, side: balls[$0].side)
                    }
                // A home run's fireworks over where it landed: one shell, two for a
                // grand slam, three in gold for a walk-off; unless the play theater
                // is on the page, which bursts them at the wall. Runs scoring spark
                // at the diamond's plate, not here (one stage per moment).
                let homer = flying.flatMap { ball in celebrates && ball.outcome == .homeRun && moment?.kind == .homeRun ? ball : nil }
                CelebrationStage(moment: homer == nil ? nil : moment, origin: homer.map { map($0.x, $0.y) }, size: geo.size,
                                 colors: .team(homer?.side == .bottom ? palette.bottom : palette.top))
            }
            .aspectRatio(domain.width / domain.height, contentMode: .fit)
            .vizWell()

            if !peek {
                FocusReader { focus in footer(focus?.play.flatMap { id in balls.first { $0.id == id } }) }
            }
        }
        .chartUnit(aspect: domain.width / domain.height, maxHeight: Self.maxPlotHeight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// The legend, or the pointed-at ball in words.
    private func footer(_ focused: GameDetail.BattedBall?) -> some View {
        ChartFooter(readout: focused.map { ball in
            (ball.text, [ball.period.map { "\(Ordinal.string($0)) inning" },
                         ball.side.map { $0 == .top ? topName : bottomName }].compactMap { $0 }.joined(separator: " · "))
        }) {
            VizLegend {
                LegendItem(label: topName) { Circle().fill(palette.top).frame(width: 7, height: 7) }
                LegendItem(label: bottomName) {
                    if differentiate {
                        RoundedRectangle(cornerRadius: 1.5).fill(palette.bottom).frame(width: 7, height: 7)
                    } else {
                        Circle().fill(palette.bottom).frame(width: 7, height: 7)
                    }
                }
                LegendItem(label: "Hit") { Circle().fill(Viz.neutral).frame(width: 8, height: 8) }
                LegendItem(label: "Out") { Circle().strokeBorder(Viz.neutral, lineWidth: 1.5).frame(width: 8, height: 8) }
                LegendItem(label: "Home run") {
                    Circle().fill(Viz.neutral).frame(width: 8, height: 8).padding(1.5)
                        .overlay(Circle().stroke(Color.primary, lineWidth: 1))
                }
                // With room to spare, the balls in play in numbers too.
                if widthClass >= .large, !balls.isEmpty {
                    Text(Self.summary(balls, topName: topName, bottomName: bottomName))
                        .font(Viz.legend).foregroundStyle(.secondary).lineLimit(1)
                        .widthDetail(.vertical)
                }
            }
        }
    }

    /// "TB 7 hits, 1 HR · MIL 9 hits" (hits include home runs).
    static func summary(_ balls: [GameDetail.BattedBall], topName: String, bottomName: String) -> String {
        func line(_ side: GameDetail.Side, _ name: String) -> String {
            let mine = balls.filter { ($0.side ?? .top) == side }
            let hits = mine.filter { $0.outcome != .out }.count
            let homers = mine.filter { $0.outcome == .homeRun }.count
            return "\(name) \(hits) \(hits == 1 ? "hit" : "hits")" + (homers > 0 ? ", \(homers) HR" : "")
        }
        return line(.top, topName) + " · " + line(.bottom, bottomName)
    }

    /// The room a hit keeps clear around it, 1.5 pt beyond its edge (an out is a ring and needs none).
    private func room(_ ball: GameDetail.BattedBall, at c: CGPoint) -> Clearance? {
        switch ball.outcome {
        case .out: nil
        case .homeRun: Clearance(c, radius: 6.5)
        case .single, .extraBases: Clearance(c, radius: 5.5)
        }
    }

    private func draw(_ ball: GameDetail.BattedBall, at c: CGPoint, in context: GraphicsContext, emphasized: Bool = false) {
        let color = ball.side == .bottom ? palette.bottom : palette.top
        let grow: CGFloat = emphasized ? 1.4 : 1
        switch ball.outcome {
        case .out:
            let r = 3.25 * grow
            context.stroke(shape(CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2), ball.side), with: .color(color), lineWidth: 1.5)
        case .homeRun:
            let rect = CGRect(x: c.x - 5 * grow, y: c.y - 5 * grow, width: 10 * grow, height: 10 * grow)
            context.fill(shape(rect, ball.side), with: .color(color))
            context.stroke(shape(rect.insetBy(dx: -1.5, dy: -1.5), ball.side), with: .color(Color.primary), lineWidth: 1)
        case .single, .extraBases:
            let rect = CGRect(x: c.x - 4 * grow, y: c.y - 4 * grow, width: 8 * grow, height: 8 * grow)
            context.fill(shape(rect, ball.side), with: .color(color))
        }
        if emphasized, ball.outcome != .homeRun {
            let r = 6.5 * grow
            context.stroke(shape(CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2), ball.side), with: .color(.primary), lineWidth: 1)
        }
    }

    private var accessibilityText: String {
        func count(_ side: GameDetail.Side) -> String {
            let mine = balls.filter { ($0.side ?? .top) == side }
            return "\(plural(mine.filter { $0.outcome != .out }.count, "hit")), \(plural(mine.filter { $0.outcome == .out }.count, "out"))"
        }
        let hr = balls.filter { $0.outcome == .homeRun }.count
        return "Balls in play. \(teams?.top ?? topName): \(count(.top)). \(teams?.bottom ?? bottomName): \(count(.bottom)). "
            + "\(plural(hr, "home run"))."
    }
}

// MARK: - Climbing

/// Lead, live: the climber on the wall rising up one line, with everyone who
/// has already climbed marked where they reached. Passing someone knocks their
/// mark as the climber's dot reaches it (out, a dip, a damped shake), then dims
/// it and drops a ▼1 beside them; the climber's place pops as it changes. A
/// pointer marks the next climber to pass, and the tip says how many holds
/// that takes. A top plants the climber's flag and sprays confetti in its
/// colors down the wall. In a final, the podium places wear medal colors.
/// Between climbers, who's next.
struct LeadAscentView: View {
    typealias Climber = GameDetail.WallRoute.Climber
    let route: GameDetail.WallRoute
    var upNext: GameDetail.UpNext? = nil
    var yours: Set<String> = []
    /// A final: medal colors on the podium places (see `isFinal`).
    var final = false
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.colorScheme) private var scheme
    /// A climber pointed at here, in the results or the starting order: their
    /// mark lights and everyone else's recedes. Pointing at a mark writes it.
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    /// In the chart peek: the wall alone, no footer.
    @Environment(\.chartPeek) private var peek
    /// The pass playing now (live), set as its moment arrives.
    @State private var livePass: Pass?
    /// Knock triggers per climber: they hold after the moment, so a mark never re-knocks.
    @State private var knocks = Beats()
    /// One step per pass (the place pill's pop) and per new lead (its glint).
    @State private var passBeats = 0
    @State private var leadBeats = 0
    /// The pass whose dot has passed its last mark: from then the tip reads the new place.
    @State private var flipped: String?
    /// The summit flag of the latest top.
    @State private var summit: Summit?

    /// One step taller from large: labels spread out, fewer need leader lines.
    static func plotHeight(_ width: WidthClass) -> CGFloat { width >= .large ? 300 : 250 }
    private var height: CGFloat { Self.plotHeight(widthClass) }
    private static let topInset: CGFloat = 18
    private static let bottomInset: CGFloat = 10
    private static let labelGap: CGFloat = 13
    private var usable: CGFloat { height - Self.topInset - Self.bottomInset }

    /// IFSC names the last round "Final" ("Semi-final" isn't one).
    static func isFinal(_ roundName: String?) -> Bool {
        guard let name = roundName?.lowercased() else { return false }
        return name.contains("final") && !name.contains("semi") && !name.contains("quarter")
    }

    private var onWall: Climber? { route.climbers.first(where: \.onWall) }
    /// While their top is the news (and nobody else is on the wall), the climber
    /// who topped keeps the line, so it reaches TOP and the flag plants there.
    private var topper: Climber? {
        guard onWall == nil, let m = moment, m.kind == .top, let id = Self.climberID(m) else { return nil }
        return route.climbers.first { $0.id == id && $0.top }
    }
    private var climbing: Climber? { onWall ?? topper }
    /// Finished climbers, highest first (the route's own order).
    private var done: [Climber] { route.climbers.filter { !$0.onWall && $0.id != topper?.id } }
    private var moment: LiveMoment? { momentFor(.ascent, in: moments) }

    /// Holds shown: at least 45, and a few above the highest anyone has reached.
    private var scale: Double {
        let best = route.climbers.filter { !$0.top }.map(\.height).max() ?? 0
        return max(45, (best + 4).rounded(.up))
    }

    private func heightOf(_ c: Climber) -> Double { c.top ? scale : c.height }

    private func y(_ h: Double) -> CGFloat {
        Self.topInset + (1 - min(max(h, 0), scale) / scale) * usable
    }

    /// Where a climber would place if they finished at this height.
    nonisolated static func place(of height: Double, top: Bool, among done: [Climber]) -> Int {
        1 + done.filter { $0.top || (!top && $0.height > height) }.count
    }

    /// The next finished climber above a height: who the climber passes next
    /// (level counts: a tie isn't a pass). Nil when leading or topped.
    static func nextTarget(above height: Double, top: Bool, among done: [Climber]) -> Climber? {
        guard !top else { return nil }
        return done.filter { $0.top || $0.height >= height }
            .min { ($0.top ? .infinity : $0.height) < ($1.top ? .infinity : $1.height) }
    }

    /// "2 holds to 3rd", "1 hold to lead": what passing the next climber takes.
    /// Heights are hold numbers (+0.5 for "+"), so passing 46+ means holding 47.
    /// Nil when leading, topped, or when only a top would do.
    static func holdsToGo(from height: Double, top: Bool, among done: [Climber]) -> String? {
        guard let target = nextTarget(above: height, top: top, among: done), !target.top else { return nil }
        let need = target.height + 0.5
        let holds = max(Int((need - height).rounded(.up)), 1)
        let place = Self.place(of: need, top: false, among: done)
        return "\(holds) \(holds == 1 ? "hold" : "holds") to \(place == 1 ? "lead" : Ordinal.string(place))"
    }

    /// IFSC's way of writing a height: "47", "47+", "Top".
    static func label(_ height: Double, top: Bool) -> String {
        top ? "Top" : height == height.rounded(.down) ? "\(Int(height))" : "\(Int(height))+"
    }

    /// The climber a moment is about: "pass:<climber>:<passed>", "climb:<climber>:<route>".
    static func climberID(_ m: LiveMoment) -> Int? {
        m.id.split(separator: ":").dropFirst().first.flatMap { Int($0) }
    }

    private func passed(_ c: Climber) -> Bool {
        guard let climbing else { return false }
        return !c.top && (climbing.top || climbing.height > c.height)
    }

    /// Another climber on this route is lit: this one steps back. (Read in
    /// each mark's own modifiers, so a hover never re-runs the wall.)
    private func recedes(_ c: Climber, _ focus: Focus) -> Bool {
        guard let id = focus.athlete, id != c.id else { return false }
        return route.climbers.contains { $0.id == id }
    }

    private func hover(_ c: Climber, _ inside: Bool) { linked?.hover(Focus(athlete: c.id), inside) }

    // MARK: Passing

    /// A climber's move up the wall while its moment plays: where from and to,
    /// and each climber passed (lowest first) with when the dot reaches them.
    struct Pass: Equatable {
        struct Knock: Equatable {
            let id: Int
            /// Seconds after the moment lands.
            let at: Double
        }
        let moment: String
        let climber: Int
        let from: Double
        let to: Double
        let knocks: [Knock]
        /// When the tip flips to the new height and place, and the pill pops.
        let flip: Double

        func at(_ id: Int) -> Double? { knocks.first { $0.id == id }?.at }
    }

    /// Works out a pass. Each passed mark knocks when the travel spring carrying
    /// the dot brings its center across the mark; marks level with each other
    /// ripple 35 ms apart. `targets` from the moment (every climber passed)
    /// win over working it out from heights. With Reduce Motion the dot jumps,
    /// so the marks flash in quick order instead.
    static func pass(for m: LiveMoment, climber: Climber, from: Double, done: [Climber],
                     scale: Double, reduceMotion: Bool) -> Pass {
        let to = climber.top ? scale : climber.height
        let ids = Set(m.targets.compactMap { Int($0) })
        // Lowest first; level marks in the route's order (Swift's sort isn't stable).
        let passed = done.enumerated()
            .filter { _, c in ids.isEmpty ? !c.top && c.height >= from && c.height < to : ids.contains(c.id) }
            .sorted { ($0.element.height, $0.offset) < ($1.element.height, $1.offset) }
            .map(\.element)
        var knocks: [Pass.Knock] = []
        for (index, c) in passed.enumerated() {
            var at: Double
            if reduceMotion {
                at = 0.08 + 0.05 * Double(index)
            } else {
                let f = to > from ? (c.height - from) / (to - from) : 0
                at = min(max(Celebrate.travelTime(reaching: f), 0.04), 0.45)
                if let last = knocks.last, passed[index - 1].height == c.height { at = last.at + 0.035 }
            }
            knocks.append(.init(id: c.id, at: at))
        }
        // A pass flips as the last climber is passed; a top as the dot reaches TOP.
        let arrives = reduceMotion ? 0.1 : Celebrate.travelTime(reaching: 0.85)
        let flip = climber.top ? max(knocks.last?.at ?? 0, arrives) : knocks.last?.at ?? arrives
        return Pass(moment: m.id, climber: climber.id, from: from, to: to, knocks: knocks, flip: flip)
    }

    /// The pass playing now: live, the one set as its moment arrived; under the
    /// frozen clock, worked out from the moment (its span says where from).
    private var pass: Pass? {
        guard let m = moment, m.kind == .passed || m.kind == .top, let c = climbing else { return nil }
        if clock.frozenTime != nil {
            guard let from = m.span?.lowerBound else { return nil }
            return Self.pass(for: m, climber: c, from: from, done: done, scale: scale, reduceMotion: reduceMotion)
        }
        return livePass?.moment == m.id ? livePass : nil
    }

    /// Whether the pass has reached its flip (the dot is past its last mark).
    private func hasFlipped(_ pass: Pass) -> Bool {
        clock.frozenTime.map { $0 >= pass.flip } ?? (flipped == pass.moment)
    }

    /// What the tip, pointer and pill read: where the climber stood until the
    /// dot passes its last mark, where they are after.
    private func standing(_ c: Climber, _ pass: Pass?) -> (height: Double, top: Bool) {
        guard let pass, pass.climber == c.id, !hasFlipped(pass) else { return (c.height, c.top) }
        return (pass.from, false)
    }

    /// The dot's height: under the frozen clock, partway along the travel spring.
    private func dotHeight(_ c: Climber, _ pass: Pass?) -> Double {
        guard let t = clock.frozenTime, let pass, pass.climber == c.id, !reduceMotion else { return heightOf(c) }
        return pass.from + (pass.to - pass.from) * Celebrate.travel(t)
    }

    /// A new leader: first place after the pass, not before.
    private func takesLead(_ pass: Pass) -> Bool {
        guard !done.isEmpty, let c = climbing else { return false }
        return Self.place(of: pass.from, top: false, among: done) > 1 && Self.place(of: c.height, top: c.top, among: done) == 1
    }

    /// Steps the marks' triggers when a pass or top lands (live).
    private func begin(_ m: LiveMoment, previous: Snapshot) {
        guard let c = climbing else { return }
        let from = m.span?.lowerBound ?? (previous.climber == c.id ? previous.height : nil) ?? heightOf(c)
        let pass = Self.pass(for: m, climber: c, from: from, done: done, scale: scale, reduceMotion: reduceMotion)
        livePass = pass
        knocks.fire(pass.knocks.map { "\($0.id)" })
        passBeats += 1
        if takesLead(pass) || m.accents.contains(.newLeader) { leadBeats += 1 }
        if m.kind == .top { summit = Summit(moment: m.id, flag: c.flag) }
    }

    private struct Snapshot: Equatable {
        var moment: String?
        var climber: Int?
        var height: Double?
    }

    private var snapshot: Snapshot {
        Snapshot(moment: moment?.id, climber: climbing?.id, height: climbing.map(heightOf))
    }

    /// The summit flag of a top: planted 0.1 s in, as the line reaches TOP.
    private struct Summit: Equatable {
        let moment: String
        let flag: String?
        var planted = false
    }

    /// The flag to draw, and whether it's planted.
    private var flag: (summit: Summit, planted: Bool)? {
        if clock.frozenTime != nil {
            guard let m = moment, m.kind == .top, let c = topper else { return nil }
            return (Summit(moment: m.id, flag: c.flag), true)
        }
        guard let summit else { return nil }
        return (summit, summit.planted && moment?.id == summit.moment)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { geo in
                let w = geo.size.width
                let trackX = (w * 0.47).rounded()
                let pass = pass
                ZStack(alignment: .topLeading) {
                    ZStack(alignment: .topLeading) {
                        // Every ten holds, faintly, numbered at the right edge.
                        Canvas { context, size in
                            var grid = Path()
                            for hold in stride(from: 10.0, through: scale, by: 10) {
                                grid.move(to: CGPoint(x: 0, y: y(hold)))
                                grid.addLine(to: CGPoint(x: size.width - 16, y: y(hold)))
                            }
                            context.stroke(grid, with: .color(Viz.grid), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                            for hold in stride(from: 10.0, through: scale, by: 10) {
                                context.draw(Text("\(Int(hold))").font(Viz.tick).foregroundStyle(.tertiary),
                                             at: CGPoint(x: size.width, y: y(hold)), anchor: .trailing)
                            }
                        }
                        // The line, bottom to top.
                        Capsule().fill(Viz.track)
                            .frame(width: 4, height: y(0) - y(scale))
                            .position(x: trackX, y: (y(0) + y(scale)) / 2)
                        Text("TOP").font(Viz.tick).foregroundStyle(.secondary)
                            .position(x: trackX, y: y(scale) - 10)
                            // The summit flag stands here while it's planted.
                            .modifier(TopLabelYield(planted: flag?.planted == true && level != .off))
                        marks(trackX: trackX, pass: pass)
                        if let climbing {
                            let h = dotHeight(climbing, pass)
                            // Their line, filling up from the floor.
                            Capsule().fill(Color.accentColor)
                                .frame(width: 4, height: max(y(0) - y(h), 4))
                                .position(x: trackX, y: (y(0) + y(h)) / 2)
                                .recedes { recedes(climbing, $0) }
                        }
                    }
                    // The dot's room: its line, the track and the marks it passes stop
                    // short of it, rising with it.
                    .clearing(moving: climbing.map { Clearance(CGPoint(x: trackX, y: y(dotHeight($0, pass))), radius: 7.5) })
                    if let climbing {
                        let h = dotHeight(climbing, pass)
                        Circle().fill(Color.accentColor).frame(width: 10, height: 10)
                            .frame(width: 15, height: 15)
                            .contentShape(Circle())
                            .onHover { hover(climbing, $0) }
                            .recedes { recedes(climbing, $0) }
                            .position(x: trackX, y: y(h))
                        nextTarget(climbing, pass: pass, trackX: trackX)
                            .recedes { recedes(climbing, $0) }
                        // The lane right of the line (and its pointer), clear of the hold numbers.
                        let lane = w - trackX - 37
                        // Below the summit flag's pennant while it stands at TOP.
                        let clear: CGFloat = flag != nil && climbing.id == topper?.id ? 38 : 24
                        tip(climbing, pass: pass)
                            .frame(width: lane, alignment: .leading)
                            .contentShape(Rectangle())
                            .onHover { hover(climbing, $0) }
                            .recedes { recedes(climbing, $0) }
                            .position(x: trackX + 15 + lane / 2, y: min(max(y(h), clear), height - 24))
                    } else if let upNext {
                        let lane = w - trackX - 34
                        Text("Next: \(upNext.flag.map { "\($0) " } ?? "")\(upNext.name) · \(upNext.position) of \(upNext.total)")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                            .lineLimit(1).minimumScaleFactor(0.8)
                            .frame(width: lane, alignment: .leading)
                            .position(x: trackX + 12 + lane / 2, y: y(0) - 8)
                    }
                    if let flag {
                        SummitFlag(flag: flag.summit.flag, planted: flag.planted)
                            .modifier(ShiftedClock(by: 0.1))
                            .position(x: trackX, y: y(scale))
                    }
                    // With celebrations off, the moment is still marked: "here".
                    if level == .off, let moment, let at = momentPoint(moment, trackX: trackX) {
                        MomentPing(color: .accentColor, diameter: 14).position(at).id(moment.id)
                    }
                }
                .compositingGroup()
                .overlay(alignment: .topLeading) {
                    let stage = stage(trackX: trackX, pass: pass)
                    CelebrationStage(moment: stage?.moment, origin: stage?.origin, size: geo.size,
                                     colors: .flag(stage?.country), direction: .degrees(-90), wellInset: 10)
                }
                .animation(reduceMotion ? Motion.fade : Motion.travel, value: climbing.map(heightOf))
                .animation(reduceMotion ? Motion.fade : Motion.standard, value: done.map(\.id))
                // The wall rescales as someone climbs past the scale; with Reduce Motion it fades.
                .animation(reduceMotion ? Motion.fade : Motion.standard, value: scale)
            }
            .frame(height: height)
            .vizWell()

            if !peek {
                ChartFooter(readout: nil, moment: moment) {
                    VizLegend {
                        LegendItem(label: "Climbing") { Capsule().fill(Color.accentColor).frame(width: 4, height: 10) }
                        LegendItem(label: "High point") { Capsule().fill(Viz.neutral).frame(width: 10, height: 2) }
                        Text("+ = moving to the next hold").font(Viz.legend).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .onChange(of: snapshot) { old, new in
            guard new.moment != old.moment, let m = moment, m.kind == .passed || m.kind == .top else { return }
            begin(m, previous: old)
        }
        .task(id: livePass?.moment) {
            // The tip's place flips as the dot passes its last mark.
            guard let pass = livePass, clock == .live else { return }
            try? await Task.sleep(for: .seconds(pass.flip))
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? Motion.fade : Motion.travel) { flipped = pass.moment }
        }
        .task(id: summit?.moment) {
            // The flag plants as the line reaches TOP.
            guard summit != nil, clock == .live else { return }
            try? await Task.sleep(for: .seconds(0.1))
            guard !Task.isCancelled else { return }
            summit?.planted = true
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// How many labels fit down the wall, `labelGap` apart.
    static func labelCapacity(height: CGFloat) -> Int {
        max(Int((height - 8 - topInset) / labelGap) + 1, 1)
    }

    /// Which finished climbers get a label when not all fit (a qualification
    /// round's 40–80): your countries' climbers, then the best placed, up to
    /// `capacity`. The rest are ticks, named on hover and when lit. (pure; tested)
    static func labeled(_ done: [Climber], yours: Set<String>, capacity: Int) -> Set<Int> {
        guard done.count > capacity else { return Set(done.map(\.id)) }
        let mine = done.filter { $0.country.map(yours.contains) == true }.prefix(capacity)
        var ids = Set(mine.map(\.id))
        for c in done where ids.count < capacity { ids.insert(c.id) }
        return ids
    }

    /// Finished climbers: a tick on the line, the name and score to its left
    /// for as many as fit. Labels never overlap or leave the wall: close
    /// heights stack downward with a leader line, within the plot.
    @ViewBuilder
    private func marks(trackX: CGFloat, pass: Pass?) -> some View {
        let done = done
        let routeIDs = Set(route.climbers.map(\.id))
        let shown = Self.labeled(done, yours: yours, capacity: Self.labelCapacity(height: height))
        let labeledMarks = done.filter { shown.contains($0.id) }
        let positions = Self.labelPositions(labeledMarks.map { y(heightOf($0)) }, gap: Self.labelGap,
                                            floor: height - 8, ceiling: Self.topInset - 6)
        let placed = Dictionary(zip(labeledMarks.map(\.id), positions), uniquingKeysWith: { a, _ in a })
        let t = clock.frozenTime
        ForEach(Array(done.enumerated()), id: \.element.id) { index, c in
            let markY = y(heightOf(c))
            let labelY = placed[c.id]
            let mine = c.country.map(yours.contains) == true
            let knockAt = pass?.at(c.id)
            // Under the frozen clock a passed mark changes as the dot reaches it.
            let isPassed = passed(c) && (t == nil || knockAt.map { t! >= $0 } ?? true)
            let knockBeat = t == nil ? knocks["\(c.id)"] : (knockAt == nil ? 0 : 1)
            // In a final, a place on the podium for now (the climber on the wall counted).
            let place = index + 1 + (isPassed ? 1 : 0)
            let medal = final ? Medal.color(place, scheme: scheme) : nil
            // Passed marks dim once their knock has played; lit, a mark shows in full,
            // and while another climber is lit, it steps back.
            let dim = MarkDim(passed: isPassed, at: knockAt.map { $0 + 0.2 }, climber: c.id, route: routeIDs)
            ZStack(alignment: .topLeading) {
                // An unlabeled climber is a finer tick: a crowded round reads as
                // where the field reached, under the labeled marks.
                Capsule().fill(mine ? Color.accentColor : Viz.neutral)
                    .frame(width: labelY == nil ? 10 : 14, height: labelY == nil ? 1.5 : 2)
                    // Reduce Motion: the knock's ring flashes around the tick itself.
                    .knock(reduceMotion ? knockBeat : 0, after: knockAt ?? 0)
                    .modifier(dim)
                    .frame(width: 28, height: 12)
                    .contentShape(Rectangle())
                    .onHover { hover(c, $0) }
                    // An unlabeled tick says who it is under the pointer.
                    .help(labelY == nil ? "\(c.name) · \(c.label)" : "")
                    .position(x: trackX, y: markY)
                if let labelY {
                    if abs(labelY - markY) > 1.5 {
                        Path { p in
                            p.move(to: CGPoint(x: trackX - 8, y: markY))
                            p.addLine(to: CGPoint(x: trackX - 14, y: labelY))
                        }
                        .stroke(Viz.grid, lineWidth: 0.75)
                        .modifier(dim)
                    }
                    HStack(spacing: 5) {
                        if let medal {
                            Circle().fill(medal).frame(width: 5, height: 5)
                                .help(Medal.name(place).map { "\($0.capitalized) place for now" } ?? "")
                                .transition(.opacity)
                        }
                        Text("\(c.flag.map { "\($0) " } ?? "")\(c.name)")
                            .font(.system(size: 10.5, weight: mine ? .semibold : .regular))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Text(c.label)
                            .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                            .fixedSize()
                            .layoutPriority(1)
                    }
                    .animation(knockAt.map { Motion.fade.delay($0) } ?? Motion.fade, value: medal)
                    .modifier(dim)
                    // Lit from the results (or pointed at here): the row's ghost wash.
                    .background(FocusReader { focus in
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(Color.primary.opacity(focus?.athlete == c.id ? 0.07 : 0))
                            .padding(.horizontal, -6).padding(.vertical, -2)
                    })
                    // Passed just now: ▼1, leading the label (so nothing shifts) and
                    // undimmed: it's the news about this climber.
                    .overlay(alignment: .leading) {
                        if let knockAt {
                            DeltaChip(delta: -1)
                                .fixedSize()
                                .frame(width: 14, alignment: .trailing)
                                .offset(x: -18)
                                .arriving(after: knockAt, reduceMotion: reduceMotion)
                        }
                    }
                    // A long name gives way (truncates) before the wall's left edge;
                    // the height never does.
                    .frame(width: trackX - 16 + (peek ? 4 : 0), alignment: .trailing)
                    .contentShape(Rectangle())
                    .onHover { hover(c, $0) }
                    .position(x: (trackX - 16) / 2 - (peek ? 2 : 0), y: labelY)
                }
            }
            .knock(reduceMotion ? 0 : knockBeat, after: knockAt ?? 0, amplitude: 3, dip: 2, outward: -1)
            .transition(.opacity)
        }
        // A lit climber without a label of their own (lit from the results,
        // or pointed at here) is named beside their tick, on a plate over the
        // labels. It reads the focus here, so a hover never re-runs the wall.
        FocusReader { focus in
            if let id = focus?.athlete, placed[id] == nil, let c = done.first(where: { $0.id == id }) {
                HStack(spacing: 5) {
                    Text("\(c.flag.map { "\($0) " } ?? "")\(c.name)").lineLimit(1).truncationMode(.tail)
                    Text(c.label).fontWeight(.semibold).monospacedDigit().fixedSize()
                }
                .font(.system(size: 10.5))
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Color(nsColor: .windowBackgroundColor)))
                .overlay(RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(Viz.grid, lineWidth: 0.5))
                .frame(width: trackX - 16, alignment: .trailing)
                .position(x: (trackX - 16) / 2, y: y(heightOf(c)))
                .allowsHitTesting(false)
                .transition(.opacity)
            }
        }
    }

    /// The pointer at the next climber to pass, right of the line, gliding up
    /// as each one is passed.
    @ViewBuilder
    private func nextTarget(_ c: Climber, pass: Pass?, trackX: CGFloat) -> some View {
        let standing = standing(c, pass)
        if let target = Self.nextTarget(above: standing.height, top: standing.top, among: done) {
            let targetY: CGFloat = {
                // Under the frozen clock it glides from the old target after the flip.
                guard let t = clock.frozenTime, let pass, pass.climber == c.id, hasFlipped(pass), !reduceMotion,
                      let old = Self.nextTarget(above: pass.from, top: false, among: done), old.id != target.id
                else { return y(heightOf(target)) }
                let p = Celebrate.travel(t - pass.flip)
                return y(heightOf(old)) + (y(heightOf(target)) - y(heightOf(old))) * p
            }()
            Image(systemName: "arrowtriangle.left.fill")
                .font(.system(size: 5, weight: .bold))
                .foregroundStyle(Color.accentColor.opacity(0.6))
                .position(x: trackX + 10.5, y: targetY)
                .animation(reduceMotion ? nil : Motion.travel, value: target.id)
                .accessibilityHidden(true)
        }
    }

    /// The climber's label at the tip of their line: who, how high, what place,
    /// and what the next place takes.
    private func tip(_ c: Climber, pass: Pass?) -> some View {
        let standing = standing(c, pass)
        let place = Self.place(of: standing.height, top: standing.top, among: done)
        let leads = place == 1 && !done.isEmpty
        let medal = final ? Medal.color(place, scheme: scheme) : nil
        let frozen = clock.frozenTime != nil
        let popBeat = frozen ? (pass == nil ? 0 : 1) : passBeats
        let glintBeat = frozen ? (pass.map(takesLead) == true || moment?.accents.contains(.newLeader) == true ? 1 : 0) : leadBeats
        let toGo = Self.holdsToGo(from: standing.height, top: standing.top, among: done)
        return VStack(alignment: .leading, spacing: 1) {
            Text("\(c.flag.map { "\($0) " } ?? "")\(c.name)")
                .font(.system(size: 11.5, weight: .semibold))
                .lineLimit(1).minimumScaleFactor(0.85)
            HStack(spacing: 6) {
                // Until the dot arrives, where they were ("47"), then where they are ("Top").
                Text(standing.height == c.height && standing.top == c.top ? c.label : Self.label(standing.height, top: standing.top))
                    .font(.system(size: 17, weight: .bold).monospacedDigit())
                    .fixedSize()
                    .contentTransition(.numericText(value: standing.height))
                Text(leads ? "Leads" : Ordinal.string(place))
                    .font(.system(size: 10, weight: .semibold))
                    .fixedSize()
                    // A medal place: a light tint of it (on dark) or the primary ink (on light,
                    // where gold text won't read).
                    .foregroundStyle(medal.map { scheme == .dark ? Medal.ink(place) ?? $0 : Color.primary } ?? Color.accentColor)
                    .padding(.horizontal, 6)
                    .frame(height: 16)
                    .background(Capsule().fill(medal.map { $0.opacity(scheme == .dark ? 0.22 : 0.30) } ?? Color.accentColor.opacity(0.14)))
                    .contentTransition(.numericText())
                    .glint(glintBeat, width: 16, in: Capsule())
                    .scorePop(popBeat, scale: 1.1, delay: pass?.flip ?? 0)
                    .help(final ? Medal.name(place).map { "\($0.capitalized) medal place for now" } ?? "" : "")
            }
            if let toGo {
                Text(toGo)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .contentTransition(.numericText())
            }
        }
    }

    /// Label heights that keep marks' labels at least `gap` apart, top down,
    /// as close to their marks as they can be, and between `ceiling` and
    /// `floor` (never over the section title above the wall).
    static func labelPositions(_ marks: [CGFloat], gap: CGFloat, floor: CGFloat, ceiling: CGFloat = -.infinity) -> [CGFloat] {
        var out: [CGFloat] = []
        for (index, y) in marks.enumerated() {
            out.append(index == 0 ? max(y, ceiling) : max(y, out[index - 1] + gap))
        }
        // Pushed past the bottom: shift the stack back up, as far as the ceiling allows.
        if let last = out.last, let first = out.first, last > floor {
            let shift = min(last - floor, max(first - ceiling, 0))
            out = out.map { $0 - shift }
        }
        return out
    }

    /// What the stage plays, from where, in whose colors: a top's confetti from
    /// TOP; a new leader's sparks at their dot; a decided final's burst from
    /// the winner's mark.
    private func stage(trackX: CGFloat, pass: Pass?) -> (moment: LiveMoment, origin: CGPoint, country: String?)? {
        guard var m = moment else { return nil }
        switch m.kind {
        case .top:
            return (m, CGPoint(x: trackX, y: y(scale)), topper?.country)
        case .passed:
            guard let pass, let c = climbing else { return nil }
            if takesLead(pass) { m.accents.insert(.newLeader) }
            return (m, CGPoint(x: trackX, y: y(pass.to)), c.country)
        default:
            // A decided final ("decided:<route>"): from the winner's mark (its first target).
            guard m.decisive, let winner = m.targets.first.flatMap({ id in done.first { "\($0.id)" == id } }) ?? done.first
            else { return nil }
            return (m, CGPoint(x: trackX, y: y(heightOf(winner))), winner.country)
        }
    }

    /// Where a moment happened, for the plain ping with celebrations off.
    private func momentPoint(_ m: LiveMoment, trackX: CGFloat) -> CGPoint? {
        switch m.kind {
        case .passed:
            // "pass:<climber>:<passed>"
            guard let id = m.id.split(separator: ":").last.flatMap({ Int($0) }),
                  let c = done.first(where: { $0.id == id }) else { return nil }
            return CGPoint(x: trackX, y: y(heightOf(c)))
        case .top:
            return CGPoint(x: trackX, y: y(scale))
        default:
            return nil
        }
    }

    private var accessibilityText: String {
        var parts: [String] = []
        if let c = climbing {
            let place = Self.place(of: c.height, top: c.top, among: done)
            var line = "\(c.name) is climbing, at \(c.label), \(Ordinal.string(place)) for now."
            if let toGo = Self.holdsToGo(from: c.height, top: c.top, among: done) { line += " \(toGo)." }
            parts.append(line)
        } else if let upNext {
            parts.append("Next up: \(upNext.name).")
        }
        parts += done.prefix(8).map { "\($0.name) \($0.label)" }
        return parts.joined(separator: " ")
    }
}

/// A passed mark dims once its knock has played; with the frozen clock, over
/// 0.25 s from `at`. Live, a mark with no knock dims at once (as before).
private struct MarkDim: ViewModifier {
    let passed: Bool
    let at: Double?
    /// Linked hover: this mark's climber lit shows it in full (passed or not);
    /// another climber on the route lit steps it back.
    var climber: Int? = nil
    var route: Set<Int> = []
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    func body(content: Content) -> some View {
        let athlete = climber == nil ? nil : linked?.focus?.athlete.flatMap { route.contains($0) ? $0 : nil }
        let lit = athlete != nil && athlete == climber
        // A passed mark has already stepped back; it doesn't step back twice.
        dimmed(content, lit: lit)
            .opacity(athlete != nil && !lit && !passed ? Viz.receded : 1)
    }

    /// Passing dims with its own timing (keyed to the pass); a hover lighting
    /// the mark takes the focus's quick fade.
    @ViewBuilder
    private func dimmed(_ content: Content, lit: Bool) -> some View {
        if let t = clock.frozenTime, passed, !lit, let at {
            let p = Motion.curve.value(at: min(max((t - at) / 0.25, 0), 1))
            content.opacity(1 - (1 - Viz.receded) * p)
        } else {
            // An opacity change: the house ease-out (after the knock), else a plain fade.
            content.opacity(passed && !lit ? Viz.receded : 1)
                .animation(at.map { Motion.reveal.delay($0) } ?? Motion.fade, value: passed)
        }
    }
}

/// The TOP label steps aside while the summit flag stands on it.
private struct TopLabelYield: ViewModifier {
    let planted: Bool
    @Environment(\.celebrationClock) private var clock

    func body(content: Content) -> some View {
        if let t = clock.frozenTime {
            content.opacity(planted ? 1 - Motion.curve.value(at: min(max((t - 0.1) / 0.15, 0), 1)) : 1)
        } else {
            content.opacity(planted ? 0 : 1).animation(Motion.fade, value: planted)
        }
    }
}

/// Starts a child's frozen clock later (the summit flag plants 0.1 s in).
private struct ShiftedClock: ViewModifier {
    let by: Double
    @Environment(\.celebrationClock) private var clock

    func body(content: Content) -> some View {
        if let t = clock.frozenTime {
            content.environment(\.celebrationClock, .frozen(max(t - by, 0)))
        } else {
            content
        }
    }
}

/// Lead "High Points": how high each climber got on each route, as lanes on a
/// hold-number scale. "45+" (held hold 45, reaching for 46) shows as a short
/// nub above the bar; a top runs to the TOP line. During a live round the
/// climber who just moved up is highlighted.
struct ClimbingWallView: View {
    let routes: [GameDetail.WallRoute]
    let live: Bool
    /// IOC codes of the user's countries, drawn in the accent color.
    let yours: Set<String>
    @State private var selected: String?
    @State private var lastHeights: [Int: Double] = [:]
    @State private var movedAt: [Int: Date] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.celebrationLevel) private var level
    /// In the chart peek: the lanes alone (no route picker, legend or status line).
    @Environment(\.chartPeek) private var peek

    /// A climber just topped, while it's news.
    private var moment: LiveMoment? { momentFor(.wall, in: moments) }

    /// More of the field as the wall widens; bars stay 12 wide, lanes gain air.
    static func maxLanes(_ width: WidthClass) -> Int {
        switch width {
        case .compact: 8
        case .medium: 9
        case .large: 10
        case .xlarge: 12
        }
    }
    private var maxLanes: Int { Self.maxLanes(widthClass) }
    // Plot geometry inside the well (points from the inner top).
    private static let gutter: CGFloat = 26
    private static let topLine: CGFloat = 16
    private static let scaleTop: CGFloat = 28
    private static let baseline: CGFloat = 148
    private static let height: CGFloat = 182

    private var route: GameDetail.WallRoute? {
        // A peek has no picker: it shows the route where the linked climber has a lane.
        if peek, let id = linked?.focus?.athlete,
           let lit = routes.first(where: { $0.climbers.prefix(maxLanes).contains { $0.id == id } }) {
            return lit
        }
        return routes.first { $0.name == selected } ?? routes.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if routes.count > 1, !peek {
                Picker("Route", selection: Binding(get: { route?.name ?? "" }, set: { selected = $0 })) {
                    ForEach(routes) { Text("Route \($0.name)").tag($0.name) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
                .fixedSize()
            }
            if let route {
                plot(route).vizWell()
                if !peek {
                    ZStack(alignment: .topLeading) {
                        legend(route).opacity(moment == nil ? 1 : 0)
                        if let moment { MomentCaption(moment: moment) }
                    }
                    Text(status(route)).font(Viz.note).foregroundStyle(.secondary)
                }
            }
        }
        .onAppear { lastHeights = heights }
        .onChange(of: heights) { _, now in
            // The climber whose high point just rose is the one on the wall.
            for (id, height) in now where height > (lastHeights[id] ?? height) { movedAt[id] = .now }
            lastHeights = now
        }
    }

    /// A top that's the news plants the climber's pennant in place of TOP (not with celebrations off).
    private func planted(_ c: GameDetail.WallRoute.Climber, route: GameDetail.WallRoute) -> Bool {
        level != .off && c.top && moment?.kind == .top && moment?.id == Self.momentID(c, route: route)
    }

    /// The moment ID for a climber's top on a route.
    nonisolated static func momentID(_ climber: GameDetail.WallRoute.Climber, route: GameDetail.WallRoute) -> String {
        "climb:\(climber.id):\(route.name)"
    }

    private var heights: [Int: Double] {
        Dictionary(routes.flatMap(\.climbers).map { ($0.id, $0.top ? 999 : $0.height) }, uniquingKeysWith: max)
    }

    // MARK: Plot

    private func scaleMax(_ climbers: [GameDetail.WallRoute.Climber]) -> Double {
        let held = climbers.filter { !$0.top }.map { Double($0.holds) }.max() ?? 0
        return max(10, ((held + 1) / 10).rounded(.up) * 10)
    }

    private func plot(_ route: GameDetail.WallRoute) -> some View {
        let lanes = Array(route.climbers.prefix(maxLanes))
        let scale = scaleMax(lanes)
        let step = scale <= 20 ? 5.0 : 10.0
        let y = { (v: Double) in Self.baseline - CGFloat(v / scale) * (Self.baseline - Self.scaleTop) }
        return GeometryReader { geo in
            let plotWidth = geo.size.width - Self.gutter
            let laneWidth = plotWidth / CGFloat(max(lanes.count, 1))
            ZStack(alignment: .topLeading) {
                // Scale: gridlines every 10 holds, the TOP line, the ground.
                Canvas { context, size in
                    for v in stride(from: step, through: scale, by: step) {
                        var line = Path()
                        line.move(to: CGPoint(x: Self.gutter, y: y(v)))
                        line.addLine(to: CGPoint(x: size.width, y: y(v)))
                        context.stroke(line, with: .color(Viz.grid), lineWidth: 0.5)
                    }
                    var top = Path()
                    top.move(to: CGPoint(x: Self.gutter, y: Self.topLine))
                    top.addLine(to: CGPoint(x: size.width, y: Self.topLine))
                    context.stroke(top, with: .color(Viz.reference), lineWidth: 1)
                    var ground = Path()
                    ground.move(to: CGPoint(x: Self.gutter, y: Self.baseline))
                    ground.addLine(to: CGPoint(x: size.width, y: Self.baseline))
                    context.stroke(ground, with: .color(Viz.baseline), lineWidth: 1)
                }
                Text("TOP").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                    .fixedSize()
                    .frame(width: Self.gutter - 4, alignment: .trailing)
                    .position(x: (Self.gutter - 4) / 2, y: Self.topLine)
                ForEach(Array(stride(from: step, through: scale, by: step)), id: \.self) { v in
                    Text("\(Int(v))").font(Viz.tick).foregroundStyle(.secondary)
                        .frame(width: Self.gutter - 4, alignment: .trailing)
                        .position(x: (Self.gutter - 4) / 2, y: y(v))
                }
                // A climber pointed at here or in the results lights up across the
                // page. Each lane reads the focus itself: a hover re-runs no lanes' drawing.
                let ids = Set(lanes.map(\.id))
                ForEach(Array(lanes.enumerated()), id: \.element.id) { index, climber in
                    lane(climber, route: route, width: laneWidth, scale: scale, y: y)
                        .frame(width: laneWidth, height: Self.height)
                        .background(FocusReader { focus in
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(Color.primary.opacity(focus?.athlete == climber.id ? 0.07 : 0)).padding(.horizontal, 1)
                        })
                        .recedes { focus in focus.athlete.map { ids.contains($0) && $0 != climber.id } ?? false }
                        .contentShape(Rectangle())
                        .onHover { linked?.hover(Focus(athlete: climber.id), $0) }
                        .position(x: Self.gutter + laneWidth * (CGFloat(index) + 0.5), y: Self.height / 2)
                }
                // A climber just topped: sparks at the top of their lane (the
                // pennant takes the lane's TOP label). No confetti: routes run
                // at once, and a burst would compete. The plain ping with celebrations off.
                if let moment, moment.kind == .top,
                   let index = lanes.firstIndex(where: { Self.momentID($0, route: route) == moment.id }) {
                    let at = CGPoint(x: Self.gutter + laneWidth * (CGFloat(index) + 0.5), y: Self.topLine)
                    if level == .off {
                        MomentPing(color: lanes[index].country.map(yours.contains) == true ? .accentColor : Viz.neutral, diameter: 14)
                            .position(at)
                            .id(moment.id)
                    } else {
                        CelebrationStage(moment: moment, origin: at, size: geo.size, colors: .flag(lanes[index].country))
                    }
                }
            }
            // New positions glide (travel); growing bars ease (standard).
            .animation(reduceMotion ? Motion.fade : Motion.travel, value: lanes.map(\.id))
            .animation(reduceMotion ? Motion.fade : Motion.standard, value: lanes.map(\.height))
        }
        .frame(height: Self.height)
    }

    private func lane(_ c: GameDetail.WallRoute.Climber, route: GameDetail.WallRoute, width: CGFloat,
                      scale: Double, y: (Double) -> CGFloat) -> some View {
        let color = c.country.map(yours.contains) == true ? Color.accentColor : Viz.neutral
        let fillTop = c.top ? Self.topLine : y(Double(c.holds))
        let markTop = c.top ? Self.topLine - 1 : (c.moving ? fillTop - 13 : fillTop)
        let current = live && (movedAt[c.id].map { Date().timeIntervalSince($0) < 120 } ?? false)
        return ZStack(alignment: .topLeading) {
            if current {
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Viz.track)
                    .frame(width: width - 4, height: Self.baseline - Self.topLine + 20)
                    .position(x: width / 2, y: (Self.baseline + Self.topLine) / 2)
            }
            // Track: the whole route, ground to top.
            UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3, style: .continuous)
                .fill(Viz.track)
                .frame(width: 12, height: Self.baseline - Self.topLine)
                .position(x: width / 2, y: (Self.baseline + Self.topLine) / 2)
            // Fill: holds held.
            UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3, style: .continuous)
                .fill(color)
                .frame(width: 12, height: max(Self.baseline - fillTop, 0))
                .position(x: width / 2, y: (Self.baseline + fillTop) / 2)
            if c.moving && !c.top {
                // "+": reaching for the next hold.
                UnevenRoundedRectangle(topLeadingRadius: 1.5, topTrailingRadius: 1.5, style: .continuous)
                    .fill(color.opacity(0.35))
                    .frame(width: 4, height: 12)
                    .position(x: width / 2, y: fillTop - 7)
            }
            if c.top {
                Capsule().fill(color).frame(width: 16, height: 2).position(x: width / 2, y: Self.topLine)
            }
            HStack(spacing: 2) {
                if current { Circle().fill(.red).frame(width: 5, height: 5) }
                // Just topped: their flag planted on the top line, while it's news.
                if planted(c, route: route) {
                    Text(c.flag ?? "⚑").font(.system(size: 9)).fixedSize()
                        .slotIn(playing: true)
                        .help("Topped Route \(route.name)")
                } else {
                    Text(c.top ? "TOP" : c.label)
                        .font(c.top ? .system(size: 9, weight: .bold) : Viz.value)
                        .tracking(c.top ? 0.3 : 0)
                        .foregroundStyle(.primary)
                        .fixedSize()
                        .transition(.opacity)
                }
            }
            .animation(Motion.fade, value: planted(c, route: route))
            .position(x: width / 2, y: markTop - 9)
            VStack(spacing: 1) {
                Text(c.flag ?? "").font(.system(size: 12))
                Text(surname(c.name))
                    .font(.system(size: 9, weight: .medium).width(.condensed))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .truncationMode(.tail)
            }
            .padding(.horizontal, 2)
            .frame(width: width)
            .position(x: width / 2, y: (Self.baseline + 6 + Self.height) / 2)
        }
        .contentShape(Rectangle())
        .help(description(c, route: route))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(description(c, route: route))
    }

    // MARK: Text

    private func legend(_ route: GameDetail.WallRoute) -> some View {
        let example = route.climbers.first { $0.moving && !$0.top }?.holds ?? 45
        let hasYours = route.climbers.prefix(maxLanes).contains { $0.country.map(yours.contains) == true }
        return VizLegend {
            LegendItem(label: "\(example)+ held hold \(example), reaching for \(example + 1)") {
                VStack(spacing: 1) {
                    RoundedRectangle(cornerRadius: 0.75).fill(Viz.neutral.opacity(0.35)).frame(width: 2, height: 4)
                    RoundedRectangle(cornerRadius: 1).fill(Viz.neutral).frame(width: 5, height: 8)
                }
            }
            LegendItem(label: "Top reached the final hold") {
                VStack(spacing: 1) {
                    Capsule().fill(Viz.neutral).frame(width: 8, height: 1.5)
                    RoundedRectangle(cornerRadius: 1).fill(Viz.neutral).frame(width: 5, height: 9)
                }
            }
            if hasYours {
                LegendItem(label: "Your athletes") {
                    RoundedRectangle(cornerRadius: 2).fill(Color.accentColor).frame(width: 8, height: 8)
                }
            }
        }
    }

    private func status(_ route: GameDetail.WallRoute) -> String {
        let shown = min(route.climbers.count, maxLanes)
        let remaining = max(route.total - route.climbers.count, 0)
        var parts = ["Top \(shown) of \(route.total)"]
        if live && remaining > 0 { parts.append("\(remaining) still to climb") }
        return parts.joined(separator: " · ")
    }

    private func description(_ c: GameDetail.WallRoute.Climber, route: GameDetail.WallRoute) -> String {
        let country = c.country.map(TeamCatalog.countryName) ?? ""
        let height = c.top ? "topped the route"
            : c.moving ? "hold \(c.holds), reaching for \(c.holds + 1)" : "hold \(c.holds)"
        let place = c.rank.map { ", \(Ordinal.string($0)) on Route \(route.name)" } ?? ""
        return [c.name, country, height].filter { !$0.isEmpty }.joined(separator: ", ") + place
    }

    private func surname(_ name: String) -> String {
        name.split(separator: " ").last.map(String.init) ?? name
    }
}

/// Boulder: how far each athlete got on each problem. From large, the tops
/// and zones are totalled too (IFSC's "2T 4Z"). Live, a top or zone sweeps its
/// half of the cell full; a top adds sparks (gold-rayed for a flash). When
/// places change, rows glide, each one that moved carries ▲2 / ▼1 after the
/// name for a few seconds, and a row that climbed washes once in the accent.
struct BoulderScorecard: View {
    let cards: [GameDetail.BoulderCard]
    let problems: [String]
    var yours: Set<String> = []
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    /// In the chart peek: the rows alone, no legend.
    @Environment(\.chartPeek) private var peek
    /// Places as last seen, to tell who moved.
    @State private var lastRanks: [Int: Int] = [:]
    /// Who moved at the latest change, and by how much (+ is up); cleared after the hold.
    @State private var deltas: [Int: Int] = [:]
    /// One step per climb, per athlete: the moved-up row's wash.
    @State private var washes = Beats()

    private static let spacing: CGFloat = 6
    private static let cellWidth: CGFloat = 14
    private static let countWidth: CGFloat = 18
    /// Room for "99.9": a score keeps one line and every row's column lines up.
    private static let pointsWidth: CGFloat = 44
    /// How long a rank change is shown: a swing moment's hold.
    static let deltaHold: Duration = .seconds(4)

    private var showsTotals: Bool { widthClass >= .large }

    /// Tops, and zones (a top counts as a zone too).
    static func totals(_ card: GameDetail.BoulderCard) -> (tops: Int, zones: Int) {
        (card.problems.filter { $0.reach == .top }.count,
         card.problems.filter { $0.reach == .top || $0.reach == .zone }.count)
    }

    /// Places gained (+) or lost (−) between two readings, by athlete; only
    /// athletes placed in both, and only those who moved.
    static func rankDeltas(from old: [Int: Int], to new: [GameDetail.BoulderCard]) -> [Int: Int] {
        var out: [Int: Int] = [:]
        for card in new {
            guard let now = card.rank, let was = old[card.id], was != now else { continue }
            out[card.id] = was - now
        }
        return out
    }

    private var ranks: [Int: Int] {
        Dictionary(cards.compactMap { c in c.rank.map { (c.id, $0) } }, uniquingKeysWith: { a, _ in a })
    }

    /// A top or zone just reached, while it's news.
    private var moment: LiveMoment? { momentFor(.boulder, in: moments) }

    /// The cell a moment is about: "boulder:<athlete>:<problem>:top|zone".
    private func celebrated(_ card: GameDetail.BoulderCard, _ index: Int) -> LiveMoment? {
        guard let moment, moment.id.hasPrefix("boulder:\(card.id):\(index):") else { return nil }
        return moment
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            StackColumn(spacing: 6) {
                HStack(spacing: Self.spacing) {
                    Spacer()
                    ForEach(problems, id: \.self) { p in
                        Text(p).font(Viz.tick).foregroundStyle(.secondary).frame(width: Self.cellWidth)
                            .help("Boulder \(p)")
                    }
                    if showsTotals {
                        Text("T").font(Viz.tick).foregroundStyle(.secondary).frame(width: Self.countWidth, alignment: .trailing)
                            .help("Tops")
                        Text("Z").font(Viz.tick).foregroundStyle(.secondary).frame(width: Self.countWidth, alignment: .trailing)
                            .help("Zones, including tops")
                    }
                    Text("Pts").font(Viz.tick).foregroundStyle(.secondary).frame(width: Self.pointsWidth, alignment: .trailing)
                }
                ForEach(cards) { card in
                    row(card)
                        // A top's sparks draw over the rows around it.
                        .zIndex(moment?.id.hasPrefix("boulder:\(card.id):") == true ? 1 : 0)
                }
            }
            if !peek {
                ChartFooter(readout: nil, moment: moment) {
                    VizLegend {
                        LegendItem(label: "Top") { BoulderCell(problem: .init(reach: .top, tries: nil), height: 14, showsTries: false) }
                        LegendItem(label: "Zone") { BoulderCell(problem: .init(reach: .zone, tries: nil), height: 14, showsTries: false) }
                        Text("Numbers show attempts").font(Viz.legend).foregroundStyle(.secondary)
                    }
                }
            }
        }
        // Places change as results come in: rows glide to their new order.
        .animation(reduceMotion ? Motion.fade : Motion.travel, value: cards.map(\.id))
        .onAppear { lastRanks = ranks }
        .onChange(of: ranks) { _, now in
            let moved = Self.rankDeltas(from: lastRanks, to: cards)
            lastRanks = now
            guard !moved.isEmpty else { return }
            withAnimation(Motion.reveal) { deltas = moved }
            washes.fire(moved.filter { $0.value > 0 }.map { "\($0.key)" })
        }
        .task(id: deltas) {
            guard !deltas.isEmpty else { return }
            try? await Task.sleep(for: Self.deltaHold)
            guard !Task.isCancelled else { return }
            withAnimation(Motion.exit) { deltas = [:] }
        }
    }

    private func row(_ card: GameDetail.BoulderCard) -> some View {
        let mine = card.country.map(yours.contains) ?? false
        let delta = deltas[card.id]
        let athlete = Profile.PlayerRef(source: .ifsc, id: String(card.id), name: card.name, country: card.country)
        return HStack(spacing: Self.spacing) {
            Text(card.rank.map(String.init) ?? "–")
                .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .foregroundStyle(.secondary).frame(width: 16, alignment: .trailing)
            Text(card.flag ?? "").font(.system(size: 12)).frame(width: 18)
                .help(card.country.map(TeamCatalog.countryName) ?? "")
            // Every name at one size: a long one truncates, it doesn't shrink.
            // A click on it opens the climber's page ("Go to …" shows the full name).
            PlayerNameLink(player: athlete) {
                Text(card.name).font(.system(size: 11.5, weight: mine || card.onWall ? .semibold : .regular)).lineLimit(1)
                    .truncationMode(.tail)
            }
            if card.onWall { LiveDot().help("Climbing now") }
            // A place change, after the name: the spacer gives way, nothing shifts.
            if let delta {
                DeltaChip(delta: delta)
                    .transition(Motion.chip(reduceMotion: reduceMotion))
            }
            Spacer(minLength: 2)
            ForEach(Array(card.problems.enumerated()), id: \.offset) { index, problem in
                BoulderCell(problem: problem, label: problems.indices.contains(index) ? problems[index] : nil,
                            moment: celebrated(card, index))
            }
            if showsTotals {
                let totals = Self.totals(card)
                Group {
                    Text("\(totals.tops)").frame(width: Self.countWidth, alignment: .trailing)
                    Text("\(totals.zones)").frame(width: Self.countWidth, alignment: .trailing)
                }
                .font(.system(size: 10.5).monospacedDigit())
                .foregroundStyle(.secondary)
                .contentTransition(.numericText())
            }
            Text(card.score?.trimmingCharacters(in: .whitespaces) ?? "").font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .lineLimit(1)
                .contentTransition(.numericText())
                .frame(width: Self.pointsWidth, alignment: .trailing)
        }
        .padding(.vertical, 2)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(mine ? Viz.highlight : .clear))
        // Climbed: the row washes once in the accent (EventRow's flash timing).
        .background { RowWash(trigger: washBeat(card, climbed: (delta ?? 0) > 0)) }
        .padding(.horizontal, -6)
        .linkedRow(Focus(athlete: card.id), litBy: { $0?.athlete == card.id }, pinnable: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(card))
        // VoiceOver: "Show on High Points" (or the wall), pinned and scrolled to.
        .showOnChartAction(Focus(athlete: card.id))
        // A double click anywhere (or the menu) opens their page too.
        .playerPageLink(athlete)
    }

    /// The wash's trigger: one step per climb (under the frozen clock, 1 while it shows).
    private func washBeat(_ card: GameDetail.BoulderCard, climbed: Bool) -> Int {
        clock.frozenTime != nil ? (climbed ? 1 : 0) : washes["\(card.id)"]
    }

    private func accessibilityText(_ card: GameDetail.BoulderCard) -> String {
        let reached = zip(problems, card.problems).map { name, p in
            "\(name): \(BoulderCell.reachLabel(p.reach))" + (p.tries.map { " in \($0)" } ?? "")
        }
        let totals = Self.totals(card)
        let moved = deltas[card.id].map { $0 > 0 ? "up \($0)" : "down \(-$0)" }
        return ([card.rank.map { Ordinal.string($0) }, moved, card.name, card.onWall ? "climbing now" : nil,
                 card.score.map { "\($0) points" }, showsTotals ? "\(totals.tops) tops, \(totals.zones) zones" : nil]
                    .compactMap { $0 } + reached).joined(separator: ", ")
    }
}

/// A row that climbed the scorecard: an accent wash, in fast, held 1.6 s, out
/// over 1.2 s. Color, not motion, so it stays with Reduce Motion; none at Off.
private struct RowWash: View {
    let trigger: Int
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let wash = RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color.accentColor.opacity(0.10))
        let peak = level == .off ? 0.0 : 1.0, fadeOut = reduceMotion ? 0.3 : 1.2
        if let t = clock.frozenTime {
            wash.opacity(trigger > 0 ? KeyframeTimeline(initialValue: 0.0) { Celebrate.pill(peak: peak, fadeOut: fadeOut) }.value(time: t) : 0)
        } else {
            wash.keyframeAnimator(initialValue: 0.0, trigger: trigger) { content, o in
                content.opacity(o)
            } keyframes: { _ in
                Celebrate.pill(peak: peak, fadeOut: fadeOut)
            }
        }
    }
}

/// One boulder, the way IFSC draws it: a bar split in two. The lower half
/// fills for the zone, the upper half for the top; attempts underneath. The
/// boulder being climbed right now is outlined. A half just reached sweeps up
/// full; a top just reached sparks.
private struct BoulderCell: View {
    let problem: GameDetail.BoulderCard.Problem
    var label: String? = nil
    var height: CGFloat = 26
    var showsTries = true
    /// The moment this cell is the news of: a top or a zone, just now.
    var moment: LiveMoment? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock

    var body: some View {
        let width = max(height * 0.54, 8)
        let gap: CGFloat = 2
        let half = (height - gap) / 2
        let swept: GameDetail.BoulderCard.Reach? = moment.map { $0.kind == .top ? .top : .zone }
        VStack(spacing: 1) {
            VStack(spacing: gap) {
                segment(filled: problem.reach == .top, width: width, height: half, sweeping: swept == .top)
                ZStack(alignment: .bottom) {
                    segment(filled: problem.reach == .top || problem.reach == .zone, width: width, height: half,
                            sweeping: swept == .zone)
                    // The older low zone: the lower half, half filled.
                    if problem.reach == .lowZone {
                        RoundedRectangle(cornerRadius: 2, style: .continuous).fill(Color.accentColor.opacity(0.55))
                            .frame(width: width, height: half / 2)
                    }
                }
            }
            .overlay {
                if problem.active {
                    RoundedRectangle(cornerRadius: 3.5, style: .continuous)
                        .strokeBorder(Color.accentColor, lineWidth: 1.5)
                        .padding(-2.5)
                }
            }
            .overlay { celebration }
            if showsTries {
                Text(problem.tries.map(String.init) ?? " ")
                    .font(.system(size: 8.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
        }
        .frame(width: max(width, 14))
        .animation(reduceMotion ? Motion.fade : Motion.standard, value: problem)
        .help(help)
    }

    /// A top's sparks around the bar (gold-rayed for a flash), clear of its
    /// corners; with celebrations off, the plain ping for a top or zone.
    @ViewBuilder private var celebration: some View {
        if let moment {
            if level == .off {
                MomentPing(color: .accentColor, diameter: 16).id(moment.id)
            } else {
                let stage = CGSize(width: 64, height: 64)
                CelebrationStage(moment: flashed(moment), origin: CGPoint(x: stage.width / 2, y: stage.height / 2),
                                 size: stage, colors: .accent, wellInset: 0)
                    .frame(width: stage.width, height: stage.height)
            }
        }
    }

    /// A top on the first attempt is a flash, whether or not the moment says so.
    private func flashed(_ m: LiveMoment) -> LiveMoment {
        guard m.kind == .top, problem.reach == .top, problem.tries == 1 else { return m }
        var m = m
        m.accents.insert(.flash)
        return m
    }

    private func segment(filled: Bool, width: CGFloat, height: CGFloat, sweeping: Bool) -> some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(Viz.track)
            .overlay(RoundedRectangle(cornerRadius: 2, style: .continuous).strokeBorder(Viz.grid, lineWidth: filled ? 0 : 0.5))
            .overlay {
                // Filled: an accent overlay that sweeps up when it fills live.
                // Under the frozen clock only the half that's the news sweeps.
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(Color.accentColor)
                    .fillSweep(filled)
                    .environment(\.celebrationClock, sweeping ? clock : .live)
            }
            .frame(width: width, height: height)
    }

    private var help: String {
        let prefix = label.map { "Boulder \($0): " } ?? ""
        let tries = problem.tries.map { " in \($0) \($0 == 1 ? "attempt" : "attempts")" } ?? ""
        return prefix + Self.reachLabel(problem.reach) + tries + (problem.active ? " · climbing now" : "")
    }

    static func reachLabel(_ reach: GameDetail.BoulderCard.Reach) -> String {
        switch reach {
        case .top: "Top"
        case .zone: "Zone"
        case .lowZone: "Low zone"
        case .none: "No zone"
        }
    }
}

// MARK: - CS2 rounds

/// The map round by round. Each half is a block: a square per round in the
/// winner's row, marked with how it ended, and between the rows what each
/// team spent on equipment that round (up for the top team, down for the bottom).
/// Live, a round bo3.gg's score has but its round list doesn't yet slots in as
/// a provisional square; the live block's header carries MAP POINT and a
/// winning streak; a map won sends a wave across the winner's squares.
struct RoundHistoryView: View {
    let rounds: [Int: [GameDetail.CSRound]]
    let maps: [GameDetail.MapResult]
    let palette: TeamPalette
    let topName: String
    let bottomName: String
    /// bo3.gg's live feed for the map being played, if it covers the match.
    var live: GameDetail.CSLive? = nil
    @State private var selectedMap: Int?
    /// The round under the pointer: its economy column lights up and the
    /// readout below says how it ended and what each team spent.
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @State private var localHover: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// A round (or map) just won, from bo3.gg's live feed.
    private var moment: LiveMoment? { momentFor(.rounds, in: moments).flatMap { $0.captioned ? $0 : nil } }

    fileprivate static let gutter: CGFloat = 34
    fileprivate static let cell = CGSize(width: 20, height: 16)
    fileprivate static let gap: CGFloat = 2
    /// Between blocks paired side by side.
    fileprivate static let halfGap: CGFloat = 14
    /// A half's 12 rounds.
    fileprivate static let halfWidth = 12 * cell.width + 11 * gap
    /// Two halves side by side: 34 + 262 + 14 + 262 = 572.
    static let pairedWidth = gutter + 2 * halfWidth + halfGap

    private var mapNumbers: [Int] { rounds.keys.sorted() }
    /// Defaults to the live map, else the latest played.
    private var current: Int? {
        if let selectedMap, rounds[selectedMap] != nil { return selectedMap }
        return maps.first { $0.live && rounds[$0.number] != nil }?.number ?? mapNumbers.last
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if mapNumbers.count > 1 {
                Picker("Map", selection: Binding(get: { current ?? 0 }, set: { selectedMap = $0 })) {
                    ForEach(mapNumbers, id: \.self) { n in
                        Text(maps.first { $0.number == n }?.name ?? "Map \(n)").tag(n)
                    }
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .labelsHidden()
                .fixedSize()
            }
            if let current, let list = rounds[current], list.isEmpty {
                pendingNote(liveMap: maps.first { $0.number == current }?.live ?? false)
                if let moment { MomentCaption(moment: moment) }
            } else if let current, let list = rounds[current] {
                let liveMap = maps.first { $0.number == current }?.live ?? false
                let peak = list.flatMap { [$0.topEquipment ?? 0, $0.bottomEquipment ?? 0] }.max() ?? 0
                // bo3.gg's live score for this map, when it covers it.
                let reading = live.flatMap { $0.mapNumber == current ? $0 : nil }
                let blocks = Self.slots(list, live: liveMap, reading: reading)
                let context = BlockContext(blocks: blocks, map: current, live: liveMap || reading != nil, moment: moment, reading: reading)
                // When two halves fit side by side, regulation reads as one strip
                // and overtimes pair up below it, each right-hand block sharing its
                // neighbour's team names. A geometric fit, so no width class. The
                // paired arrangement always asks for room for two, so the choice
                // doesn't flip (and rebuild the grid) when a second half begins.
                ViewThatFits(in: .horizontal) {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(Array(stride(from: 0, to: blocks.count, by: 2)), id: \.self) { start in
                            HStack(alignment: .top, spacing: Self.halfGap) {
                                block(start, peak: peak, context: context)
                                if start + 1 < blocks.count {
                                    block(start + 1, peak: peak, names: false, context: context)
                                }
                            }
                        }
                    }
                    .frame(minWidth: Self.pairedWidth, alignment: .leading)
                    stacked(peak: peak, context: context)
                }
                // The hovered round in words takes the legend's place: no layout
                // shift, and nothing to read when nothing is pointed at.
                // Reads the focus here, not in the grid: a hover re-runs the readout and the cells' light.
                // The same footer as every chart: values first ("NaVi won as CT"), then the round.
                FocusReader { focus in
                    let hoveredRound = focus?.round ?? localHover
                    ChartFooter(readout: list.first(where: { $0.number == hoveredRound }).map(readout), moment: moment) {
                        legend(hasEconomy: peak > 0)
                    }
                    .padding(.leading, Self.gutter)
                }
            }
        }
        .animation(reduceMotion ? nil : Motion.quick, value: rounds[current ?? 0]?.count)
    }

    /// What every block needs to know about the map and the moment.
    fileprivate struct BlockContext {
        let blocks: [[RoundSlot]]
        let map: Int
        let live: Bool
        let moment: LiveMoment?
        /// bo3.gg's live score: map point reads it (the squares can lag it).
        let reading: GameDetail.CSLive?
    }

    /// Every block under the one before (the compact arrangement).
    private func stacked(peak: Int, context: BlockContext) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(context.blocks.indices), id: \.self) { index in
                block(index, peak: peak, context: context)
            }
        }
    }

    private func block(_ index: Int, peak: Int, names: Bool = true, context: BlockContext) -> some View {
        let slots = context.blocks[index]
        let last = index == context.blocks.count - 1
        let state = last && context.live ? Self.state(context.blocks.flatMap { $0 }) : nil
        // Map point from the live score when bo3.gg covers the map, else from the squares.
        let point: GameDetail.Side? = state == nil ? nil
            : context.reading.map { $0.mapEnded ? nil : Self.mapPoint(top: $0.topScore, bottom: $0.bottomScore) } ?? state?.mapPoint
        let side = context.moment?.side
        return RoundBlock(title: Self.title(index), slots: slots, peak: peak, palette: palette,
                          topName: topName, bottomName: bottomName, localHover: localHover, showsNames: names,
                          celebrating: Self.celebration(context.moment, in: index, of: context.blocks, map: context.map),
                          waveStart: side.map { side in context.blocks[..<index].flatMap { $0 }.filter { $0.winner == side }.count } ?? 0,
                          mapPoint: point.map { $0 == .top ? topName : bottomName },
                          streak: state?.streak.map { (count: $0.count, team: $0.side == .top ? topName : bottomName) }) { number, inside in
            if let linked {
                linked.hover(Focus(round: number), inside)
            } else if inside {
                // Hover is instant (the house rule).
                localHover = number
            } else if localHover == number {
                localHover = nil
            }
        }
    }

    /// The moment a block plays, if any: a round won plays in the block holding
    /// that round; a map won in the map's last block; a series won in every block.
    fileprivate static func celebration(_ m: LiveMoment?, in index: Int, of blocks: [[RoundSlot]], map: Int) -> LiveMoment? {
        guard let m else { return nil }
        let parts = m.id.split(separator: ":")
        guard parts.count == 3, parts[0] == "cs", Int(parts[1]) == map else { return nil }
        switch m.kind {
        case .roundWon:
            guard let round = Int(parts[2]) else { return nil }
            return blocks[index].contains { $0.number == round } ? m : nil
        case .mapWon:
            return m.decisive || index == blocks.count - 1 ? m : nil
        default:
            return nil
        }
    }

    /// The hovered round in words, values first: who won and as which side,
    /// then the round, how it ended and what each team spent.
    private func readout(_ round: GameDetail.CSRound) -> (lead: String, detail: String) {
        let winner = round.winner == .top ? topName : round.winner == .bottom ? bottomName : "Nobody"
        let side = round.winnerSide.map { " as \($0)" } ?? ""
        let money = [round.topEquipment.map { "\(topName) $\($0.formatted())" },
                     round.bottomEquipment.map { "\(bottomName) $\($0.formatted())" }].compactMap { $0 }
        return ("\(winner) won\(side)",
                (["Round \(round.number)", round.reason.label] + money).joined(separator: " · "))
    }

    /// A map with no rounds yet: say why, rather than draw an empty grid.
    private func pendingNote(liveMap: Bool) -> some View {
        let text: String
        if liveMap, let live, !live.mapEnded {
            let round = live.round.map { " after round \($0)" } ?? ""
            text = "\(topName) \(live.topScore)–\(live.bottomScore) \(bottomName)\(round). "
                + "Round-by-round squares appear once bo3.gg processes the map."
        } else if liveMap {
            text = "bo3.gg isn't covering this map live, so the round score isn't available here yet. "
                + "Rounds appear after the map; the streams below are live."
        } else {
            text = "Round details for this map aren't available yet."
        }
        return Text(text)
            .font(Viz.note)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .vizWell(padding: 0)
    }

    private static func title(_ index: Int) -> String {
        switch index {
        case 0: "1st half"
        case 1: "2nd half"
        default: "Overtime \(index - 1)"
        }
    }

    /// MR12: two halves of 12, then overtimes of 6.
    static func blocks(_ rounds: [GameDetail.CSRound]) -> [[GameDetail.CSRound]] {
        chunks(rounds)
    }

    private static func chunks<T>(_ items: [T]) -> [[T]] {
        var blocks: [[T]] = []
        var index = 0
        while index < items.count {
            let size = index < 24 ? 12 : 6
            blocks.append(Array(items[index..<min(index + size, items.count)]))
            index += size
        }
        return blocks
    }

    /// Rounds bo3.gg's live score counts but its round list doesn't have yet.
    /// Their winners are known only when they all went one way (with a split,
    /// the order is unknown, and a square would invent it).
    static func provisional(_ rounds: [GameDetail.CSRound], reading: GameDetail.CSLive?) -> [(number: Int, winner: GameDetail.Side)] {
        guard let reading else { return [] }
        let top = reading.topScore - rounds.filter { $0.winner == .top }.count
        let bottom = reading.bottomScore - rounds.filter { $0.winner == .bottom }.count
        guard top >= 0, bottom >= 0, top + bottom > 0, top + bottom <= 6, top == 0 || bottom == 0 else { return [] }
        let winner: GameDetail.Side = top > 0 ? .top : .bottom
        return (0..<(top + bottom)).map { (rounds.count + 1 + $0, winner) }
    }

    /// Blocks of rounds, the provisional ones after them, plus the round being
    /// played now while the map is live.
    fileprivate static func slots(_ rounds: [GameDetail.CSRound], live: Bool, reading: GameDetail.CSLive? = nil) -> [[RoundSlot]] {
        var all = rounds.map(RoundSlot.played) + provisional(rounds, reading: reading).map { RoundSlot.provisional($0.number, $0.winner) }
        if live && reading?.mapEnded != true { all.append(.next(all.count + 1)) }
        return chunks(all)
    }

    /// The first to this many rounds takes the map: 13, then 16, 19… in overtime
    /// (MR12, OT MR3). One rule for the whole page: `MatchRules`.
    static func target(top: Int, bottom: Int) -> Int { MatchRules.mapTarget(top: top, bottom: bottom) }

    /// Who is a round from the map, if anyone (`MatchRules`, as the hero's chip reads it).
    static func mapPoint(top: Int, bottom: Int) -> GameDetail.Side? { MatchRules.mapPoint(top: top, bottom: bottom) }

    /// The live map's state from its squares: who's on map point, and a run of 4+ straight rounds.
    fileprivate static func state(_ slots: [RoundSlot]) -> (mapPoint: GameDetail.Side?, streak: (count: Int, side: GameDetail.Side)?) {
        let winners = slots.compactMap(\.winner)
        let top = winners.filter { $0 == .top }.count, bottom = winners.count - top
        var streak: (count: Int, side: GameDetail.Side)?
        if let last = winners.last {
            let count = winners.reversed().prefix { $0 == last }.count
            if count >= 4 { streak = (count, last) }
        }
        return (mapPoint(top: top, bottom: bottom), streak)
    }

    private func legend(hasEconomy: Bool) -> some View {
        VizLegend {
            ForEach([GameDetail.CSRound.Reason.elimination, .bombed, .defused, .time], id: \.self) { reason in
                LegendItem(label: reason.label) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 2.5, style: .continuous).fill(Viz.neutral)
                        Image(systemName: reason.symbol).font(.system(size: 6.5, weight: .bold)).foregroundStyle(.white)
                    }
                    .frame(width: 13, height: 11)
                }
            }
            if hasEconomy {
                LegendItem(label: "Equipment value") {
                    VStack(spacing: 1) {
                        UnevenRoundedRectangle(topLeadingRadius: 1, topTrailingRadius: 1).fill(palette.top.opacity(0.65)).frame(width: 4, height: 5)
                        UnevenRoundedRectangle(bottomLeadingRadius: 1, bottomTrailingRadius: 1).fill(palette.bottom.opacity(0.65)).frame(width: 4, height: 4)
                    }
                }
            }
        }
    }
}

/// A round's square (ringed) or economy column, lit while its round is pointed
/// at and stepping back while another is. It reads the focus itself, so a hover
/// re-runs these, not the grid.
private struct RoundLight: ViewModifier {
    let number: Int
    let local: Int?
    var ring = false
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    @ViewBuilder func body(content: Content) -> some View {
        let hovered = linked == nil ? local : linked?.focus?.round
        if ring {
            content
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(Color.primary, lineWidth: hovered == number ? 1 : 0).padding(-2))
                .opacity(hovered == nil || hovered == number ? 1 : Viz.receded)
        } else {
            content.opacity(hovered == nil || hovered == number ? 1 : Viz.receded)
        }
    }
}

fileprivate enum RoundSlot {
    case played(GameDetail.CSRound)
    /// In bo3.gg's live score but not its round list yet: the winner, not how.
    case provisional(Int, GameDetail.Side)
    case next(Int)

    var number: Int {
        switch self {
        case let .played(r): r.number
        case let .provisional(n, _), let .next(n): n
        }
    }

    var winner: GameDetail.Side? {
        switch self {
        case let .played(r): r.winner
        case let .provisional(_, side): side
        case .next: nil
        }
    }
}

extension GameDetail.CSRound.Reason {
    var symbol: String {
        switch self {
        case .elimination: "xmark"
        case .bombed: "flame.fill"
        case .defused: "scissors"
        case .time: "clock"
        }
    }

    var label: String {
        switch self {
        case .elimination: "Elimination"
        case .bombed: "Bomb exploded"
        case .defused: "Bomb defused"
        case .time: "Time ran out"
        }
    }
}

/// One half (or overtime): header with the half's score, the two teams' rows,
/// and the economy band between them, aligned column by column.
private struct RoundBlock: View {
    let title: String
    let slots: [RoundSlot]
    let peak: Int
    let palette: TeamPalette
    let topName: String
    let bottomName: String
    /// The hovered round without a page focus (previews); with one, each cell reads the focus.
    let localHover: Int?
    /// False for a half sitting beside the first: its rows share that half's names.
    var showsNames = true
    /// The moment this block plays: a round won in it, or the map won.
    var celebrating: LiveMoment? = nil
    /// A map won's wave: how many of the winner's squares come before this block.
    var waveStart = 0
    /// The team a round from the map (the live block only).
    var mapPoint: String? = nil
    /// A winning run of 4+ (the live block only).
    var streak: (count: Int, team: String)? = nil
    let hover: (Int, Bool) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationClock) private var clock
    @Environment(\.spokenTeams) private var teams
    /// One step per round won here (the header pops), and per map won by each side (its wave).
    @State private var roundBeats = 0
    @State private var waves: [GameDetail.Side: Int] = [:]

    private typealias Layout = RoundHistoryView

    private var gutter: CGFloat { showsNames ? Layout.gutter : 0 }

    private var roundBeat: Int {
        clock.frozenTime != nil ? (celebrating?.kind == .roundWon ? 1 : 0) : roundBeats
    }

    /// A row's wave trigger: it holds after the moment, so nothing pops again when it clears.
    private func waveBeat(_ side: GameDetail.Side) -> Int {
        clock.frozenTime != nil ? (celebrating?.kind == .mapWon && celebrating?.side == side ? 1 : 0) : waves[side] ?? 0
    }

    var body: some View {
        let topWins = slots.filter { $0.winner == .top }.count
        let bottomWins = slots.filter { $0.winner == .bottom }.count
        let width = Layout.halfWidth
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(title).font(Viz.tick).foregroundStyle(.secondary)
                Spacer()
                if let streak {
                    HStack(spacing: 2) {
                        StreakFlame(size: 7, help: "\(streak.team) won the last \(streak.count) rounds")
                        Text("\(streak.count) straight").font(Viz.tick).foregroundStyle(.secondary)
                            .contentTransition(.numericText(value: Double(streak.count)))
                    }
                    .transition(.opacity.animation(Motion.exit))
                }
                if let mapPoint {
                    StateChip(text: "MAP POINT")
                        .help("\(mapPoint) one round from the map")
                        .transition(Motion.chip(reduceMotion: reduceMotion))
                }
                Text("\(topWins) – \(bottomWins)").font(.system(size: 9, weight: .semibold).monospacedDigit())
                    .contentTransition(.numericText())
                    // A round won: the half's score pops.
                    .scorePop(roundBeat, scale: 1.15)
            }
            .frame(width: width)
            .padding(.leading, gutter)
            row(.top, name: topName)
            if peak > 0 { economy }
            row(.bottom, name: bottomName)
        }
        .onChange(of: celebrating?.id) { _, id in
            guard id != nil, let m = celebrating else { return }
            if m.kind == .mapWon, let side = m.side { waves[side, default: 0] += 1 } else if m.kind == .roundWon { roundBeats += 1 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title): \(teams?.top ?? topName) \(topWins), \(teams?.bottom ?? bottomName) \(bottomWins)."
                            + (mapPoint.map { " Map point \($0)." } ?? "")
                            + (streak.map { " \($0.team) \($0.count) straight." } ?? ""))
    }

    private func row(_ side: GameDetail.Side, name: String) -> some View {
        let color = side == .top ? palette.top : palette.bottom
        // The map won's wave: the winner's squares pop left to right, 0.02 s apart.
        let waving = celebrating?.kind == .mapWon && celebrating?.side == side
        let waveOrder = Dictionary(slots.enumerated().filter { $0.element.winner == side }.enumerated().map { ($0.element.offset, $0.offset) },
                                   uniquingKeysWith: { a, _ in a })
        return HStack(spacing: Layout.gap) {
            if showsNames {
                Text(name).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(width: Layout.gutter - 6, alignment: .trailing)
                    .padding(.trailing, 6 - Layout.gap)
            }
            ForEach(Array(slots.enumerated()), id: \.offset) { column, slot in
                let wave = waving ? waveOrder[column].map { 0.02 * Double(waveStart + $0) } : nil
                switch slot {
                case let .played(round):
                    let won = round.winner == side
                    ZStack {
                        RoundedRectangle(cornerRadius: 3, style: .continuous).fill(won ? color : Color.primary.opacity(0.05))
                        if won {
                            Image(systemName: round.reason.symbol)
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(Viz.ink(on: color))
                        }
                    }
                    .frame(width: Layout.cell.width, height: Layout.cell.height)
                    .scorePop(won ? waveBeat(side) : 0, scale: 1.18, delay: wave ?? 0)
                    .modifier(RoundLight(number: round.number, local: localHover, ring: true))
                    .contentShape(Rectangle())
                    .onHover { hover(round.number, $0) }
                    .transition(reduceMotion ? .opacity : Motion.badgeTransition)
                case let .provisional(number, winner):
                    // Won, how not known yet: the winner's color, receded, no symbol.
                    let won = winner == side
                    let fresh = celebrating?.kind == .roundWon && celebrating?.id.hasSuffix(":\(number)") == true
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(won ? color.opacity(Viz.receded) : Color.primary.opacity(0.05))
                        .frame(width: Layout.cell.width, height: Layout.cell.height)
                        .scorePop(won ? waveBeat(side) : 0, scale: 1.18, delay: wave ?? 0)
                        .overlay {
                            if won && fresh { MomentPing(color: color, diameter: 20, reach: 1.6).id(celebrating?.id) }
                        }
                        .help("Round \(number): \(winner == .top ? topName : bottomName) won (details to come)")
                        .slotIn(playing: won && fresh)
                case let .next(number):
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .strokeBorder(Color.red.opacity(0.8), lineWidth: 1)
                        .frame(width: Layout.cell.width, height: Layout.cell.height)
                        .help("Round \(number), being played now")
                }
            }
        }
    }

    /// Top team's spend rises from the hairline, bottom team's hangs below it.
    private var economy: some View {
        HStack(spacing: Layout.gap) {
            if showsNames { Color.clear.frame(width: Layout.gutter - Layout.gap) }
            ForEach(Array(slots.enumerated()), id: \.offset) { _, slot in
                if case let .played(r) = slot {
                    VStack(spacing: 1) {
                        bar(r.topEquipment, color: palette.top, up: true)
                        bar(r.bottomEquipment, color: palette.bottom, up: false)
                    }
                    .frame(width: Layout.cell.width, height: 18)
                    .modifier(RoundLight(number: r.number, local: localHover))
                    .contentShape(Rectangle())
                    .onHover { hover(r.number, $0) }
                } else {
                    Color.clear.frame(width: Layout.cell.width, height: 18)
                }
            }
        }
        .background(alignment: .leading) {
            Rectangle().fill(Viz.grid).frame(height: 0.5)
                .padding(.leading, gutter)
        }
    }

    private func bar(_ value: Int?, color: Color, up: Bool) -> some View {
        let height = peak > 0 ? 8 * CGFloat(value ?? 0) / CGFloat(peak) : 0
        // Rounded at the data end only; square on the hairline.
        let shape = up ? UnevenRoundedRectangle(topLeadingRadius: 1.5, topTrailingRadius: 1.5)
                       : UnevenRoundedRectangle(bottomLeadingRadius: 1.5, bottomTrailingRadius: 1.5)
        return shape.fill(color.opacity(0.65))
            .frame(width: 4, height: height)
            .frame(height: 8.5, alignment: up ? .bottom : .top)
    }
}

// MARK: - Standings

/// A league table that re-ranks live: rows glide to their projected positions
/// as goals go in, with movement arrows against the official table. Wider
/// tables add columns rather than stretch: W-D-L at medium, goals for and
/// against at large, and at xlarge the zones the places earn, as labeled
/// hairlines where each begins (the NBA table's play-in lines).
struct StandingsTable: View {
    let rows: [LiveStandingsRow]
    var highlight: Set<String> = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.widthClass) private var widthClass

    /// The numeric columns, in the order ESPN and the league print them.
    enum Column: CaseIterable {
        case played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference, points

        var title: String {
            switch self {
            case .played: "P"
            case .won: "W"
            case .drawn: "D"
            case .lost: "L"
            case .goalsFor: "GF"
            case .goalsAgainst: "GA"
            case .goalDifference: "GD"
            case .points: "Pts"
            }
        }

        var help: String {
            switch self {
            case .played: "Played"
            case .won: "Won"
            case .drawn: "Drawn"
            case .lost: "Lost"
            case .goalsFor: "Goals for"
            case .goalsAgainst: "Goals against"
            case .goalDifference: "Goal difference"
            case .points: "Points"
            }
        }

        var width: CGFloat {
            switch self {
            case .played: 22
            case .won, .drawn, .lost: 20
            case .goalsFor, .goalsAgainst: 24
            // Room for "+101" and "103": a big season stays on one line.
            case .goalDifference, .points: 32
            }
        }

        /// Compact keeps today's table; each step adds the next most useful pair.
        static func shown(at width: WidthClass) -> [Column] {
            switch width {
            case .compact: [.played, .goalDifference, .points]
            case .medium: [.played, .won, .drawn, .lost, .goalDifference, .points]
            case .large, .xlarge: allCases
            }
        }
    }

    private var columns: [Column] { Column.shown(at: widthClass) }
    /// Zones only at xlarge, and only when ESPN marks them.
    private var showsZones: Bool { widthClass >= .xlarge && rows.contains { $0.zone != nil } }

    var body: some View {
        let grouped = Set(rows.compactMap(\.row.group)).count > 1
        let columns = columns
        let zones = showsZones
        StackColumn {
            header(columns)
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, r in
                if grouped, r.row.group != (index > 0 ? rows[index - 1].row.group : nil), let group = r.row.group {
                    Text(group)
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6)
                        .padding(.top, index == 0 ? 2 : 12)
                        .padding(.bottom, 3)
                        .accessibilityAddTraits(.isHeader)
                } else if index > 0, rows[index - 1].position + 1 < r.position {
                    // Rows skipped (a window around two teams): mark the gap.
                    Image(systemName: "ellipsis")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 10)
                        .help("Teams in between hidden")
                        .accessibilityHidden(true)
                }
                if zones, let boundary = Self.zoneBoundary(at: index, in: rows) {
                    zoneLine(boundary.label)
                }
                row(r, columns: columns, zones: zones)
            }
        }
        // Rows glide to their new positions when live results change the order.
        .animation(reduceMotion ? nil : Motion.travel, value: rows.map(\.id))
        .animation(reduceMotion ? nil : Motion.quick, value: rows.map(\.points))
    }

    private func header(_ columns: [Column]) -> some View {
        HStack(spacing: 6) {
            Text("#").frame(width: 30, alignment: .leading).help("Position")
            Text("Team")
            Spacer()
            ForEach(columns, id: \.self) { c in
                Text(c.title).frame(width: c.width, alignment: .trailing).help(c.help).widthDetail()
            }
        }
        .font(.system(size: 9.5, weight: .semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
        .accessibilityHidden(true)
    }

    /// A hairline where a zone begins, labeled with what its places earn
    /// (unlabeled where mid-table resumes).
    private func zoneLine(_ label: String?) -> some View {
        HStack(spacing: 6) {
            if let label {
                Text(label).font(Viz.tick).foregroundStyle(.tertiary).lineLimit(1)
            }
            Rectangle().fill(Viz.markings).frame(height: 0.5)
        }
        .frame(height: label == nil ? 7 : 13)
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .help(label ?? "")
        .accessibilityHidden(true)
    }

    private func row(_ r: LiveStandingsRow, columns: [Column], zones: Bool) -> some View {
        let mine = highlight.contains(r.id)
        return HStack(spacing: 6) {
            HStack(spacing: 2) {
                Text("\(r.liveRank)").font(.system(size: 11, weight: .semibold).monospacedDigit())
                if r.movement != 0 {
                    Image(systemName: r.movement > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                        .font(.system(size: 6))
                        .foregroundStyle(r.movement > 0 ? .green : .red)
                        .help(r.movement > 0 ? "Up \(r.movement) from the official table" : "Down \(-r.movement) from the official table")
                }
            }
            .frame(width: 30, alignment: .leading)
            LogoView(url: r.row.logo, size: 15)
            Text(r.row.name).font(.system(size: 12, weight: mine ? .semibold : .regular)).lineLimit(1)
            if let score = r.liveScore {
                HStack(spacing: 3) {
                    LiveDot()
                    Text(score).font(.system(size: 9.5, weight: .semibold).monospacedDigit()).foregroundStyle(.red)
                }
                .help("Playing now")
            }
            Spacer(minLength: 4)
            ForEach(columns, id: \.self) { c in
                cell(c, r).widthDetail()
            }
        }
        .font(.system(size: 11.5).monospacedDigit())
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(mine ? Viz.highlight : .clear))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(r, columns: columns, zones: zones))
        // The row opens the team's page (hover fill, click, "Go to …").
        .teamRowLink(id: r.id, name: r.row.name, logo: r.row.logo, abbreviation: r.row.abbreviation)
    }

    @ViewBuilder
    private func cell(_ c: Column, _ r: LiveStandingsRow) -> some View {
        switch c {
        case .points:
            Text("\(r.points)").fontWeight(.semibold).lineLimit(1).frame(width: c.width, alignment: .trailing)
                .contentTransition(.numericText(value: Double(r.points)))
        default:
            Text(Self.value(c, r)).lineLimit(1).frame(width: c.width, alignment: .trailing).foregroundStyle(.secondary)
        }
    }

    static func value(_ c: Column, _ r: LiveStandingsRow) -> String {
        switch c {
        case .played: "\(r.played)"
        case .won: "\(r.wins)"
        case .drawn: "\(r.draws)"
        case .lost: "\(r.losses)"
        case .goalsFor: "\(r.goalsFor)"
        case .goalsAgainst: "\(r.goalsAgainst)"
        case .goalDifference: r.goalDifference > 0 ? "+\(r.goalDifference)" : "\(r.goalDifference)"
        case .points: "\(r.points)"
        }
    }

    /// Whether a zone begins at this row, and its name (nil: mid-table
    /// resumes). Compared with the row shown above it in the same group (across
    /// a "…" gap too); the first row of a table starts its zone if it has one.
    struct ZoneBoundary: Equatable { let label: String? }

    static func zoneBoundary(at index: Int, in rows: [LiveStandingsRow]) -> ZoneBoundary? {
        let here = rows[index]
        let above = index > 0 && rows[index - 1].row.group == here.row.group ? rows[index - 1].zone : nil
        guard above?.lowercased() != here.zone?.lowercased() else { return nil }
        return ZoneBoundary(label: here.zone)
    }

    private func accessibilityText(_ r: LiveStandingsRow, columns: [Column], zones: Bool) -> String {
        var parts = ["\(Ordinal.string(r.liveRank)), \(r.row.name)", "\(r.points) points",
                     "\(r.played) played"]
        if columns.contains(.won) { parts.append("\(r.wins) won, \(r.draws) drawn, \(r.losses) lost") }
        if columns.contains(.goalsFor) { parts.append("\(r.goalsFor) goals for, \(r.goalsAgainst) against") }
        parts.append("goal difference \(r.goalDifference)")
        if let score = r.liveScore { parts.append("playing now, \(score)") }
        if r.movement != 0 { parts.append(r.movement > 0 ? "up \(r.movement)" : "down \(-r.movement)") }
        if zones, let zone = r.zone { parts.append(zone) }
        // The highlight says it on screen; VoiceOver says it too.
        if highlight.contains(r.id) { parts.append("your team") }
        return parts.joined(separator: ", ")
    }
}
