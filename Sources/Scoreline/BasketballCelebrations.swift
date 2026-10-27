import SwiftUI

// The NBA court's live layer: every shot tells its own short story (swish,
// rim-out, stuffed, slam), the possession arrow sweeps over center court, and
// the celebration stage plays its beat at the rim. Each story is a pure
// function of time, so the render harness can draw any frame, and its
// TimelineView exists only while it plays. When it ends it hands over to the
// chart's own marks without a seam: it draws exactly what the chart draws.

// MARK: - Marks shared with the chart

/// The court's marks, drawn the same way by the chart's Canvas and by a shot
/// story, so a story's last frame and the chart's first are the same pixels.
enum CourtInk {
    /// A shot: filled when made, a ring when missed.
    static func shot(made: Bool, at c: CGPoint, color: Color, grow: CGFloat = 1, in context: GraphicsContext) {
        if made {
            let r = 2.75 * grow
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color))
        } else {
            let r = 2.4 * grow
            context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                           with: .color(color), lineWidth: 1.2)
        }
    }

    /// A trail play's way to the rim (a shot's path, in its team's color).
    static func trailLine(from a: CGPoint, to b: CGPoint, color: Color, alpha: Double, in context: GraphicsContext) {
        var path = Path()
        path.move(to: a)
        path.addLine(to: b)
        context.stroke(path, with: .color(color.opacity(0.6 * alpha)), style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
    }

    /// The ball in flight: a team-color disc with a 1 pt edge (the stage's ball, so they hand over cleanly).
    static func ball(at c: CGPoint, radius r: CGFloat = 2.5, color: Color, opacity: Double = 1, in context: GraphicsContext) {
        var g = context
        g.opacity = opacity
        let circle = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2))
        g.fill(circle, with: .color(color))
        g.stroke(circle, with: .color(Color.primary.opacity(0.5)), lineWidth: 1)
    }
}

// MARK: - Flame

extension StreakFlame {
    /// In with the symbol's own appear effect (§2.14), out with `Motion.exit`.
    static var arrival: AnyTransition {
        .asymmetric(insertion: AnyTransition(.symbolEffect(.appear)), removal: AnyTransition.opacity.animation(Motion.exit))
    }
}

// MARK: - Shot story

/// A shot as it happens (spec §3.1.2). The path is a stylized arc between two
/// real points (the spot and the rim), not tracking data; the ball rides it at
/// a constant parametric rate, which on a quadratic curve is a projectile's
/// motion: quick off the hand, slowest at the top, quick into the rim.
///
/// - Swish: the ball reaches the rim at 0.40 s, where the stage takes it (it
///   drops through and the net ripples).
/// - Rim-out: the ball rides to 92%, glances off ±35° and fades.
/// - Stuffed: the path stops at 60%, where a tick in the blocker's color
///   arrives and is knocked; the ball bounces back 10 pt and fades.
/// - Slam: no arc (the stage drops the ball onto the rim); the backboard rattles.
///
/// The spot's mark lands at 0.30 s (0.12 s for a slam). Then the arc relaxes
/// into the trail's straight line (its bow straightens as its ink eases to
/// the trail's), and the story ends on exactly what the chart draws for that
/// shot. Reduce Motion: no flight, the
/// mark and line fade in. Off: the flight stays (it's data), the swish
/// becomes the existing ping, and nothing knocks or rattles.
struct ShotArc: View {
    enum Kind: Equatable { case swish, rimOut, stuffed, slam }

    /// How the chart draws this shot at rest, so the story ends on it.
    struct Rest: Equatable {
        var grow: CGFloat = 1
        /// The trail's fade for this play (its mark and line).
        var alpha: Double = 1
        /// Where the trail's line from the spot ends (the rim; a block's
        /// stopping point), in plot points; nil: the chart draws no line.
        var end: CGPoint? = nil
    }

    let kind: Kind
    let made: Bool
    let spot: CGPoint
    let rim: CGPoint
    let color: Color
    /// The blocker's team color (stuffed).
    var blocker: Color = Viz.neutral
    /// The hoop's backboard line, in plot points (slam).
    var backboard: [CGPoint] = []
    var seed: UInt64 = 0
    var rest = Rest()
    /// Lands the spot's mark and line (false when the chart already shows them: an upgrade).
    var lands = true
    /// The court's ball (plot points): held back by the chart while the story
    /// plays, so the story draws it, coming back once the ball is free.
    var ball: CGPoint? = nil
    /// The story is over: the chart draws the shot (and the ball) again.
    var onFinish: () -> Void = {}

    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start: Date?

    static let flight = 0.40
    /// How far along its path a blocked shot gets.
    static let blockReach = 0.6

    /// When the ball is through the net, off the rim or knocked away: the
    /// possession arrow turns then.
    static func throughTime(_ kind: Kind, reduceMotion: Bool) -> Double {
        if reduceMotion { return 0 }
        switch kind {
        case .swish: return 0.52
        case .rimOut: return 0.92 * flight + 0.2
        case .stuffed: return blockReach * flight + 0.26
        case .slam: return 0.26
        }
    }

    /// When the court's own ball shows again: once the net has settled (it
    /// would crowd the ripples), else as soon as the story lets it go.
    static func freeTime(_ kind: Kind, reduceMotion: Bool) -> Double {
        kind == .swish && !reduceMotion ? 0.85 : throughTime(kind, reduceMotion: reduceMotion)
    }

    /// When the story has handed over to the chart.
    static func duration(_ kind: Kind, reduceMotion: Bool) -> Double {
        if reduceMotion { return kind == .stuffed ? 0.85 : 0.2 }
        switch kind {
        case .swish: return 1.0
        case .rimOut: return 0.9
        case .stuffed: return 1.05
        case .slam: return 0.55
        }
    }

    var body: some View {
        switch clock {
        case let .frozen(t):
            canvas(at: t)
        case .live:
            TimelineView(.animation) { context in
                canvas(at: start.map { context.date.timeIntervalSince($0) } ?? 0)
            }
            .onAppear { start = .now }
            .task {
                try? await Task.sleep(for: .seconds(Self.duration(kind, reduceMotion: reduceMotion)))
                guard !Task.isCancelled else { return }
                onFinish()
            }
        }
    }

    /// Only the story's own patch of the court is redrawn each frame: a
    /// Canvas the size of its bounds, not of the court.
    private func canvas(at t: Double) -> some View {
        let story = self, level = level, reduceMotion = reduceMotion
        let box = bounds
        return Canvas { context, _ in
            var context = context
            context.translateBy(x: -box.minX, y: -box.minY)
            story.draw(at: t, level: level, reduceMotion: reduceMotion, in: context)
        }
        .frame(width: box.width, height: box.height)
        .offset(x: box.minX, y: box.minY)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Everything the story can draw: the spot, the rim, the arc's bow, the
    /// ball's resting place and the backboard, with room for the rim-out's
    /// glance, the ping and the ball's ring.
    var bounds: CGRect {
        var points = [spot, rim, arc.control]
        if let ball { points.append(ball) }
        if let end = rest.end { points.append(end) }
        points += backboard
        let xs = points.map(\.x), ys = points.map(\.y)
        let rect = CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        return rect.insetBy(dx: -16, dy: -16).integral
    }

    // MARK: Drawing (closed form in t)

    private static func ease(_ x: Double) -> Double { Motion.curve.value(at: min(max(x, 0), 1)) }

    /// Rises 0→1 over `start...end`.
    private static func ramp(_ t: Double, _ start: Double, _ end: Double) -> Double {
        min(max((t - start) / (end - start), 0), 1)
    }

    private var arc: FlightArc { FlightArc(from: spot, to: rim) }

    /// The arc's crossfade into the trail's line, and the mark's landing.
    private var fade: (start: Double, end: Double) {
        switch kind {
        case .swish: (0.55, 0.95)
        case .rimOut: (0.45, 0.85)
        case .stuffed: (0.6, 1.0)
        case .slam: (0.2, 0.5)
        }
    }
    private var landing: Double { kind == .slam ? 0.12 : 0.30 }
    /// How far along the arc the shot gets.
    private var reach: Double {
        switch kind {
        case .swish: 1
        case .rimOut: 0.92
        case .stuffed: Self.blockReach
        case .slam: 0
        }
    }

    func draw(at t: Double, level: CelebrationLevel, reduceMotion: Bool, in context: GraphicsContext) {
        guard t >= 0 else { return }
        if reduceMotion {
            let o = Self.ease(t / 0.15)
            if lands, let line = rest.end {
                var g = context
                g.opacity = o
                CourtInk.trailLine(from: spot, to: line, color: color, alpha: rest.alpha, in: g)
            }
            landMark(opacity: o, scale: 1, in: context)
            if kind == .stuffed {
                tick(offset: 0, scale: 1, opacity: o * (1 - Self.ramp(t, 0.5, 0.8)), in: context)
            }
            standIn(at: t, reduceMotion: true, in: context)
            return
        }
        let s = min(t / Self.flight, 1)
        let head = min(s, reach)
        let gone = Self.ramp(t, fade.start, fade.end)
        let line = lands ? rest.end : nil

        if kind == .slam || head <= 0 {
            // No arc: the trail's (short) line just comes up.
            if let line, gone > 0 {
                var g = context
                g.opacity = gone
                CourtInk.trailLine(from: spot, to: line, color: color, alpha: rest.alpha, in: g)
            }
        } else if let line, gone >= 1 {
            // Settled: exactly the chart's line.
            CourtInk.trailLine(from: spot, to: line, color: color, alpha: rest.alpha, in: context)
        } else {
            // The arc, drawn to the ball (the curve's first part is itself a
            // quadratic). Then it relaxes into the trail's line: on-screen
            // movement, so ease-in-out. With no trail line, it fades.
            let a = arc
            let tip = a.point(at: head)
            let bend = CGPoint(x: spot.x + (a.control.x - spot.x) * head, y: spot.y + (a.control.y - spot.y) * head)
            let u = line == nil ? 0 : Celebrate.sweepCurve.value(at: gone)
            let target = line ?? tip
            let end = CGPoint(x: tip.x + (target.x - tip.x) * u, y: tip.y + (target.y - tip.y) * u)
            let mid = CGPoint(x: (spot.x + target.x) / 2, y: (spot.y + target.y) / 2)
            var path = Path()
            path.move(to: spot)
            path.addQuadCurve(to: end, control: CGPoint(x: bend.x + (mid.x - bend.x) * u, y: bend.y + (mid.y - bend.y) * u))
            var g = context
            if line == nil { g.opacity = 1 - gone }
            g.stroke(path, with: .color(color.opacity(0.8 + (0.6 * rest.alpha - 0.8) * u)),
                     style: StrokeStyle(lineWidth: 1.5 - 0.25 * u, lineCap: .round))
        }
        // The spot's mark lands like a badge: 92% to full, fading in (Motion.reveal).
        if lands, t >= landing {
            let p = Self.ease((t - landing) / 0.25)
            landMark(opacity: p, scale: 0.92 + 0.08 * p, in: context)
        }
        switch kind {
        case .swish:
            if t < Self.flight {
                CourtInk.ball(at: arc.point(at: s), color: color, in: context)
            } else if level == .off {
                // No stage at Off: the ball drops through on its own, and the rim pings as it always has.
                let drop = Self.ease((t - Self.flight) / 0.12)
                if drop < 1 { CourtInk.ball(at: rim, radius: 2.5 * (1 - 0.5 * drop), color: color, opacity: 1 - drop, in: context) }
                ping(at: rim, age: t - Self.flight, in: context)
            }
        case .rimOut:
            let hit = reach * Self.flight
            if t < hit {
                CourtInk.ball(at: arc.point(at: s), color: color, in: context)
            } else {
                var random = SplitMix64(seed: seed)
                let turn = (random.next() & 1 == 0 ? 1.0 : -1.0) * 35 * .pi / 180
                let distance = random.in(8...12)
                let u = Self.ease((t - hit) / 0.2)
                let d = rotate(tangent(at: reach), by: turn)
                let from = arc.point(at: reach)
                if u < 1 {
                    CourtInk.ball(at: CGPoint(x: from.x + d.x * distance * u, y: from.y + d.y * distance * u), color: color,
                                  opacity: 1 - Self.ramp(t, hit, hit + 0.2), in: context)
                }
            }
        case .stuffed:
            let hit = reach * Self.flight
            let q = arc.point(at: reach), d = tangent(at: reach)
            if t < hit {
                CourtInk.ball(at: arc.point(at: s), color: color, in: context)
            } else {
                // Knocked back the way it came.
                let u = Self.ease((t - hit) / 0.25)
                if u < 1 {
                    CourtInk.ball(at: CGPoint(x: q.x - d.x * 10 * u, y: q.y - d.y * 10 * u), color: color,
                                  opacity: 1 - Self.ramp(t, hit, hit + 0.25), in: context)
                }
                let p = Self.ease((t - hit) / 0.25)
                let amplitude: CGFloat = level == .off ? 0 : level == .subtle ? 1 : 2
                let push = Self.knock.value(time: t - hit).x * amplitude
                tick(offset: push, scale: 0.92 + 0.08 * p, opacity: p * (1 - gone), in: context)
            }
        case .slam:
            if level == .off {
                ping(at: rim, age: t, in: context)
            } else if backboard.count == 2, t >= 0.12 {
                let o = Self.ramp(t, 0.12, 0.16) * (1 - Self.ramp(t, 0.34, 0.5))
                let shift = Self.rattle.value(time: t - 0.12).x * (level == .subtle ? 0.6 : 1.2)
                var path = Path()
                path.move(to: CGPoint(x: backboard[0].x + shift, y: backboard[0].y))
                path.addLine(to: CGPoint(x: backboard[1].x + shift, y: backboard[1].y))
                var g = context
                g.opacity = o
                g.stroke(path, with: .color(Color.primary.opacity(0.7)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            }
        }
        standIn(at: t, reduceMotion: false, in: context)
    }

    /// The court's ball, as CourtBall draws it (a panel-colored ring around a
    /// primary dot), coming back once the story frees it.
    private func standIn(at t: Double, reduceMotion: Bool, in context: GraphicsContext) {
        guard let ball else { return }
        let free = Self.freeTime(kind, reduceMotion: reduceMotion)
        let o = reduceMotion ? 1 : Self.ease((t - free) / 0.15)
        guard t >= free, o > 0 else { return }
        var g = context
        g.opacity = o
        g.fill(Path(ellipseIn: CGRect(x: ball.x - 5, y: ball.y - 5, width: 10, height: 10)), with: .color(Color(nsColor: .windowBackgroundColor)))
        g.fill(Path(ellipseIn: CGRect(x: ball.x - 3.5, y: ball.y - 3.5, width: 7, height: 7)), with: .color(.primary))
    }

    /// The landed mark, as the chart draws it (at the trail's fade), mid-landing.
    private func landMark(opacity: Double, scale: CGFloat, in context: GraphicsContext) {
        guard lands, opacity > 0 else { return }
        var g = context
        g.opacity = rest.alpha * opacity
        CourtInk.shot(made: made, at: spot, color: color, grow: rest.grow * scale, in: g)
    }

    /// The block: a short bar across the path, in the blocker's color.
    private func tick(offset: CGFloat, scale: CGFloat, opacity: Double, in context: GraphicsContext) {
        guard opacity > 0 else { return }
        let point = arc.point(at: reach), d = tangent(at: reach)
        let c = CGPoint(x: point.x + d.x * offset, y: point.y + d.y * offset)
        let n = CGPoint(x: -d.y, y: d.x), half = 3.25 * scale
        var path = Path()
        path.move(to: CGPoint(x: c.x - n.x * half, y: c.y - n.y * half))
        path.addLine(to: CGPoint(x: c.x + n.x * half, y: c.y + n.y * half))
        var g = context
        g.opacity = opacity
        g.stroke(path, with: .color(blocker), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
    }

    /// The existing make ping (MomentPing's ring), in closed form.
    private func ping(at c: CGPoint, age: Double, in context: GraphicsContext) {
        guard age >= 0, age <= 0.6 else { return }
        let p = Self.ease(age / 0.6)
        let r = 5 * (0.6 + 1.2 * p) - 0.75 * (0.6 + 1.2 * p)
        var g = context
        g.opacity = 0.9 * (1 - p)
        g.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color),
                 lineWidth: 1.5 * (0.6 + 1.2 * p))
    }

    /// The arc's direction at `s`, normalized.
    private func tangent(at s: Double) -> CGPoint {
        let c = arc.control
        let dx = 2 * (1 - s) * (c.x - spot.x) + 2 * s * (rim.x - c.x)
        let dy = 2 * (1 - s) * (c.y - spot.y) + 2 * s * (rim.y - c.y)
        let length = max(hypot(dx, dy), 0.001)
        return CGPoint(x: dx / length, y: dy / length)
    }

    private func rotate(_ v: CGPoint, by angle: Double) -> CGPoint {
        CGPoint(x: v.x * cos(angle) - v.y * sin(angle), y: v.x * sin(angle) + v.y * cos(angle))
    }

    /// The block's knock (§2.8) at amplitude 1, outward along the shot.
    private static let knock = KeyframeTimeline(initialValue: KnockValue()) {
        Celebrate.knock(Celebrate.knockSteps(amplitude: 1, outward: 1), dip: 0)
    }
    /// The backboard's rattle (§2.5) at amplitude 1.
    private static let rattle = KeyframeTimeline(initialValue: KnockValue()) {
        Celebrate.knock(Celebrate.rattleSteps(amplitude: 1), dip: 0)
    }
}

// MARK: - Possession

/// Who has the ball: an arrowhead at center court in their color, pointing
/// at the basket they attack (football's chevron grammar). A change of
/// possession sweeps it around center court; while a shot is in the air it
/// dims, still pointing the shooting team's way. Reduce Motion crossfades.
struct PossessionChevron: View {
    let side: GameDetail.Side
    let color: Color
    /// Mid-sweep, for the render harness (`.frozen` clock); nil: rest at `side`.
    var angle: Angle? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static func angle(_ side: GameDetail.Side) -> Angle { .degrees(side == .top ? 0 : 180) }

    var body: some View {
        if reduceMotion {
            ZStack {
                arrow(pointing: .top).opacity(side == .top ? 1 : 0)
                arrow(pointing: .bottom).opacity(side == .bottom ? 1 : 0)
            }
        } else {
            arrow(pointing: .top).rotationEffect(angle ?? Self.angle(side))
        }
    }

    private func arrow(pointing direction: GameDetail.Side) -> some View {
        HStack {
            Spacer(minLength: 0)
            Image(systemName: "arrowtriangle.right.fill")
                .font(.system(size: 6, weight: .bold))
                .foregroundStyle(color)
        }
        .frame(width: 30, height: 16)
        .rotationEffect(reduceMotion ? Self.angle(direction) : .zero)
    }
}

/// MomentPing's ring, drawn at any instant of the celebration clock: live it
/// is MomentPing; frozen, the frame at t (for the harness).
struct ClockedPing: View {
    let color: Color
    var diameter: CGFloat = 12
    var reach: CGFloat = 1.8
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        switch clock {
        case .live:
            MomentPing(color: color, diameter: diameter, reach: reach)
        case let .frozen(t):
            let p = Motion.curve.value(at: min(max(t / 0.6, 0), 1))
            Circle()
                .strokeBorder(color, lineWidth: 1.5)
                .frame(width: diameter, height: diameter)
                .scaleEffect(0.6 + (reach - 0.6) * p)
                .opacity(reduceMotion ? 0 : 0.9 * (1 - p))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - What the court shows for a moment

/// A moment as the court tells it: which shot story plays (if any), and what
/// the celebration stage adds at the rim.
struct CourtStory: Equatable {
    /// Identity: a new key plays from the start. An upgrade (a block or an
    /// and-one ESPN added later) gets its own.
    let key: String
    let moment: LiveMoment
    /// The shot it's about, when it's a field-goal attempt on the court.
    let shot: GameDetail.Shot?
    /// The story the shot tells; nil when the court plays no flight.
    let kind: ShotArc.Kind?
    /// The story draws the landing (false for an upgrade: the mark is already there).
    var lands = true
    /// Replaces the stage's effects (nil: the moment's own cue; empty: none).
    var effects: [CelebrationCue.Effect]? = nil
    /// Which side's rim, and whose colors.
    let side: GameDetail.Side?

    /// The chart holds this shot back while the story draws it.
    var holdsShot: Bool { kind != nil && lands }

    /// What the court does with `moment`, given the moment first shown for
    /// that play (if any). Steals and lead changes on a free throw have no
    /// shot; period ends and runs belong to the game flow.
    static func make(_ moment: LiveMoment, first: LiveMoment?, shots: [GameDetail.Shot]) -> CourtStory? {
        let shot = shots.last { $0.id == moment.id }
        if let first, first != moment {
            // ESPN added a block to a miss we flew: tell it again, stuffed.
            if moment.kind == .block, first.kind == .missed, let shot {
                return CourtStory(key: "\(moment.id)-block", moment: moment, shot: shot, kind: .stuffed, side: shot.side)
            }
            let effects = upgrade(from: first, to: moment)
            guard !effects.isEmpty else { return nil }
            return CourtStory(key: "\(moment.id)-\(moment.accents.rawValue)", moment: moment, shot: shot,
                              kind: effects.contains(.rimPulse) && shot != nil ? .slam : nil, lands: false, effects: effects,
                              side: shot?.side ?? moment.side)
        }
        switch moment.kind {
        case .made, .missed, .block, .run, .leadChange:
            guard let shot else {
                // A make with no spot on the court still celebrates at its rim; a run on a free throw doesn't.
                if case .made = moment.kind { return CourtStory(key: moment.id, moment: moment, shot: nil, kind: nil, side: moment.side) }
                return nil
            }
            let kind: ShotArc.Kind = shot.made ? (moment.accents.contains(.dunk) || shot.dunk ? .slam : .swish)
                : moment.kind == .block ? .stuffed : .rimOut
            // A run or lead change keeps its accent for the game flow; the court plays the basket.
            var effects: [CelebrationCue.Effect]?
            if moment.kind == .run || moment.kind == .leadChange || moment.kind == .missed || moment.kind == .block {
                effects = shot.made ? basket(moment.accents, dunk: kind == .slam) : []
            }
            return CourtStory(key: moment.id, moment: moment, shot: shot, kind: kind, effects: effects, side: shot.side)
        case .steal:
            return CourtStory(key: moment.id, moment: moment, shot: nil, kind: nil, effects: [], side: moment.side)
        default:
            return nil
        }
    }

    /// A basket's own beat, without the swing accent (sparks) its story adds elsewhere.
    static func basket(_ accents: LiveMoment.Accents, dunk: Bool) -> [CelebrationCue.Effect] {
        [dunk ? .rimPulse : .swish(echo: accents.contains(.andOne))] + (accents.contains(.onFire) ? [.embers] : [])
    }

    /// What a play edited into more plays at the rim, after its first story
    /// already did: the and-one's echo ring, the dunk's rim, a three's sparks.
    static func upgrade(from a: LiveMoment, to b: LiveMoment) -> [CelebrationCue.Effect] {
        let gained = b.accents.subtracting(a.accents)
        var effects: [CelebrationCue.Effect] = []
        if gained.contains(.dunk) { effects.append(.rimPulse) }
        if gained.contains(.andOne) { effects.append(.echo) }
        if case let .made(before) = a.kind, case let .made(after) = b.kind, after > before { effects.append(.sparks(rays: 6, length: 13)) }
        return effects
    }
}
