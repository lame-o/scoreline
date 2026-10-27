import SwiftUI

// Celebration pieces the live charts in LiveViews share: per-mark triggers
// that never re-fire when a moment clears, a knock timed to when something
// reaches the mark, the travel spring's timing (so a knock lands as the
// climber's dot crosses), medal colors, and the soccer net. Each one also
// draws under the frozen clock, so the render harness can sample any frame.

// MARK: - Clock

extension CelebrationClock {
    /// Seconds into the moment under the harness's frozen clock; nil when live.
    var frozenTime: Double? {
        if case let .frozen(t) = self { return t }
        return nil
    }
}

// MARK: - Triggers

/// Keyframe triggers for a chart's marks, by key. A key's count steps when a
/// moment reaches its mark and holds after the moment leaves, so the mark
/// fires once per moment and never again when the moment clears (a triggered
/// keyframe animator fires on any change, back to zero included).
struct Beats: Equatable {
    private var counts: [String: Int] = [:]

    init() {}

    /// The frozen clock's beats: 1 for each mark playing now.
    init(playing keys: some Sequence<String>) {
        for key in keys { counts[key] = 1 }
    }

    subscript(_ key: String) -> Int { counts[key] ?? 0 }

    mutating func fire(_ keys: some Sequence<String>) {
        for key in keys { counts[key, default: 0] += 1 }
    }
}

// MARK: - Travel timing

extension Celebrate {
    /// `Motion.travel` (critically damped, 0.4 s), as a curve: how far along a
    /// move is `t` seconds in. The same spring SwiftUI runs.
    static func travel(_ t: Double) -> Double {
        guard t > 0 else { return 0 }
        return Spring(duration: 0.4, bounce: 0).value(target: 1.0, time: t)
    }

    /// When a `Motion.travel` move first reaches `fraction` of the way.
    static func travelTime(reaching fraction: Double) -> Double {
        let f = min(max(fraction, 0), 0.999)
        guard f > 0 else { return 0 }
        var low = 0.0, high = 1.5
        for _ in 0..<32 {
            let mid = (low + high) / 2
            if travel(mid) < f { low = mid } else { high = mid }
        }
        return high
    }
}

// MARK: - Delayed knock

extension View {
    /// `.knock`, fired `delay` seconds after `trigger` steps: a climber's mark
    /// knocked as the climber's dot reaches it, not when the data lands.
    func knock(_ trigger: Int, after delay: Double, amplitude: CGFloat = 3, dip: CGFloat = 0,
               outward: CGFloat = -1, axis: Axis = .horizontal) -> some View {
        modifier(DelayedKnock(trigger: trigger, delay: delay, amplitude: amplitude, dip: dip, outward: outward, axis: axis))
    }
}

private struct DelayedKnock: ViewModifier {
    let trigger: Int
    let delay: Double
    let amplitude: CGFloat
    let dip: CGFloat
    let outward: CGFloat
    let axis: Axis
    @Environment(\.celebrationClock) private var clock
    /// The trigger the knock has reached; it catches up with `trigger` after the delay.
    @State private var fired: Int?

    func body(content: Content) -> some View {
        switch clock {
        case let .frozen(t):
            // The harness: the same knock, its clock started `delay` later.
            content.knock(trigger, amplitude: amplitude, dip: dip, outward: outward, axis: axis)
                .environment(\.celebrationClock, .frozen(max(t - delay, 0)))
        case .live:
            content.knock(fired ?? trigger, amplitude: amplitude, dip: dip, outward: outward, axis: axis)
                .onAppear { fired = trigger }
                .onChange(of: trigger) { _, now in
                    let delay = delay
                    Task { @MainActor in
                        try? await Task.sleep(for: .seconds(delay))
                        fired = now
                    }
                }
        }
    }
}

// MARK: - Appearing on cue

extension View {
    /// Shows this view `delay` seconds into a moment (a ▼1 chip as its climber
    /// is passed): live it arrives with the badge transition after the delay;
    /// under the frozen clock it's there from `delay` on, fading in over 0.15 s.
    func arriving(after delay: Double, reduceMotion: Bool) -> some View {
        modifier(Arriving(delay: delay, reduceMotion: reduceMotion))
    }
}

private struct Arriving: ViewModifier {
    let delay: Double
    let reduceMotion: Bool
    @Environment(\.celebrationClock) private var clock

    func body(content: Content) -> some View {
        if let t = clock.frozenTime {
            let p = Motion.curve.value(at: min(max((t - delay) / 0.15, 0), 1))
            content
                .scaleEffect(reduceMotion ? 1 : 0.92 + 0.08 * p)
                .opacity(p)
        } else {
            content.transition(.asymmetric(
                insertion: (reduceMotion ? AnyTransition.opacity : Motion.badgeTransition).animation(Motion.reveal.delay(delay)),
                removal: .opacity.animation(Motion.exit)))
        }
    }
}

// MARK: - Medals

/// Podium colors for a climbing final: gold, silver, bronze. Darker in light
/// mode, so a 5 pt dot keeps 3:1 against the well (WCAG 1.4.11: 3.5, 3.0, 3.7
/// light; 5.6, 5.8, 3.7 dark).
enum Medal {
    static func color(_ place: Int, scheme: ColorScheme) -> Color? {
        let dark = scheme == .dark
        switch place {
        case 1: return dark ? Color(red: 0.83, green: 0.66, blue: 0.22) : Color(red: 0.62, green: 0.45, blue: 0.04)
        case 2: return dark ? Color(white: 0.70) : Color(white: 0.52)
        case 3: return dark ? Color(red: 0.76, green: 0.49, blue: 0.28) : Color(red: 0.66, green: 0.40, blue: 0.20)
        default: return nil
        }
    }

    /// Text on a medal-tinted pill in dark mode: a lighter tint of the medal,
    /// 4.7:1 or better on its pill. (Light mode uses the primary ink.)
    static func ink(_ place: Int) -> Color? {
        switch place {
        case 1: Color(red: 0.96, green: 0.80, blue: 0.36)
        case 2: Color(white: 0.86)
        case 3: Color(red: 0.95, green: 0.66, blue: 0.45)
        default: nil
        }
    }

    static func name(_ place: Int) -> String? {
        switch place {
        case 1: "gold"
        case 2: "silver"
        case 3: "bronze"
        default: nil
        }
    }
}

// MARK: - Soccer net

/// The net behind a goal mouth bellying out as the ball hits it, then
/// settling and fading (about 0.8 s). Drawn only while a goal plays; nothing
/// is left behind. A fade with Reduce Motion; half the belly at Subtle.
struct NetRipple: View {
    /// The goal mouth's posts, in the chart's coordinates (on the goal line).
    let near: CGPoint
    let far: CGPoint
    /// +1 when the net hangs to the right of the goal line (the right-hand goal), −1 to the left.
    let outward: CGFloat
    let color: Color
    /// When the ball reaches the line, from the moment's start.
    var delay: Double = 0.35
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var done = false

    /// The belly's depth (0…1): out fast as the ball hits, a damped spring back to a sag.
    static let belly = KeyframeTimeline(initialValue: CGFloat(0)) {
        CubicKeyframe(1, duration: 0.10)
        SpringKeyframe(0.35, duration: 0.40, spring: Spring(duration: 0.4, bounce: 0.35))
        LinearKeyframe(0.35, duration: 0.30)
    }
    static let length = 0.80

    var body: some View {
        if level != .off {
            Group {
                if let t = clock.frozenTime {
                    net(at: t - delay)
                } else if !done {
                    // Mounted only while it plays, like every celebration timeline.
                    TimelineView(.animation) { context in
                        net(at: context.date.timeIntervalSince(start) - delay)
                    }
                    .task {
                        try? await Task.sleep(for: .seconds(delay + Self.length + 0.05))
                        done = true
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func net(at t: Double) -> some View {
        if t >= 0, t <= Self.length {
            let depth: CGFloat = level == .subtle ? 4.5 : 9
            // Reduce Motion: a still net that fades in and out.
            let d = reduceMotion ? depth * 0.5 : depth * Self.belly.value(time: t)
            // In over 0.08 s, held, then gone over the last 0.3 s.
            let fadeStart = Self.length - 0.3
            let opacity = min(t / 0.08, 1) * (t < fadeStart ? 1 : 1 - Motion.curve.value(at: (t - fadeStart) / 0.3))
            Canvas { context, _ in
                // A quad curve whose control sits 2d out peaks d out at its middle.
                let control = CGPoint(x: (near.x + far.x) / 2 + outward * 2 * d, y: (near.y + far.y) / 2)
                var outline = Path()
                outline.move(to: near)
                outline.addQuadCurve(to: far, control: control)
                context.stroke(outline, with: .color(color), style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
                // Two strands of mesh from the line to the belly.
                var mesh = Path()
                for f in [1.0 / 3, 2.0 / 3] {
                    let y = near.y + (far.y - near.y) * f
                    mesh.move(to: CGPoint(x: near.x, y: y))
                    mesh.addLine(to: CGPoint(x: near.x + outward * 4 * f * (1 - f) * d, y: y))
                }
                context.stroke(mesh, with: .color(color.opacity(0.6)), lineWidth: 0.75)
            }
            .opacity(opacity)
        }
    }
}

// MARK: - Slot-in

extension View {
    /// Arrives by slotting in: 0.6 to 1 on `Motion.pop`, with opacity (a CS2
    /// round square, a lane's pennant). A fade with Reduce Motion; the plain
    /// badge transition with celebrations off. Under the frozen clock it plays
    /// from t = 0 when `playing`.
    func slotIn(playing: Bool) -> some View {
        modifier(SlotIn(playing: playing))
    }
}

private struct SlotIn: ViewModifier {
    let playing: Bool
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let spring = Spring(duration: 0.4, bounce: 0.2)

    func body(content: Content) -> some View {
        if let t = clock.frozenTime, playing {
            let pops = level != .off && !reduceMotion
            content
                // Settled means exactly 1 (a spring alone only approaches it).
                .scaleEffect(pops && t < Self.spring.settlingDuration ? 0.6 + 0.4 * Self.spring.value(target: 1.0, time: t) : 1)
                .opacity(Motion.curve.value(at: min(t / 0.15, 1)))
        } else {
            content.transition(level == .off ? Motion.chip(reduceMotion: reduceMotion) : Celebrate.slotIn(reduceMotion: reduceMotion))
        }
    }
}
