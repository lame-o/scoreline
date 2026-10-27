import AppKit
import SwiftUI

// Celebrations: short, physical beats that grow out of a live moment's own
// mark. Confetti fans out of the end zone, the net ripples at the rim, the
// climber who was passed gets knocked. Intensity follows the moment's tier.
//
// Every stage primitive is a pure function of (seed, t) with closed-form
// physics, so any frame can be drawn on its own (the render harness draws
// t = 0.2 without playing 0...0.2). A TimelineView drives it only while it
// plays; the stage sits over the chart, outside its compositing group, and is
// clipped to the well. When it ends the chart is pixel-identical to a chart
// with no celebration. No blur, blend modes or matched geometry; at most 36
// particles per burst.
//
// A chart uses two things, and both read \.celebrationLevel and Reduce Motion
// themselves:
//   CelebrationStage(moment:origin:size:colors:direction:)    the burst, as an overlay
//   .knock / .scorePop / .scorePill / .fillSweep / .glint     on its own marks

// MARK: - Settings and clock

/// How much a live page celebrates (Settings, Live Games). Information
/// (possession, state chips, deltas, flames) shows at every level.
enum CelebrationLevel: String, CaseIterable, Identifiable {
    /// Everything: confetti, fireworks, swishes, knocks, pops, the wash pulse and glint.
    case full
    /// No particles (sparks stand in), small knocks, no hero pulse or glint.
    case subtle
    /// No celebration primitives. Existing pings, captions and washes stay.
    case off

    var id: Self { self }

    var title: String {
        switch self {
        case .full: "Full"
        case .subtle: "Subtle"
        case .off: "Off"
        }
    }

    /// The UserDefaults key the level is saved under (a raw string).
    static let defaultsKey = "celebrationLevel"

    /// The saved level, for code outside the view tree.
    static var saved: CelebrationLevel {
        UserDefaults.standard.string(forKey: defaultsKey).flatMap(CelebrationLevel.init(rawValue:)) ?? .full
    }
}

/// The celebrations' clock. `.frozen(t)` draws every primitive as it looks
/// t seconds in, without playing it: the render harness's clock.
enum CelebrationClock: Equatable {
    case live
    case frozen(Double)
}

private struct CelebrationLevelKey: EnvironmentKey {
    static let defaultValue = CelebrationLevel.full
}

private struct CelebrationClockKey: EnvironmentKey {
    static let defaultValue = CelebrationClock.live
}

extension EnvironmentValues {
    /// Set once at the root from the user's setting. A replay sets `.off`
    /// while it runs, so a live moment doesn't burst over it.
    var celebrationLevel: CelebrationLevel {
        get { self[CelebrationLevelKey.self] }
        set { self[CelebrationLevelKey.self] = newValue }
    }

    var celebrationClock: CelebrationClock {
        get { self[CelebrationClockKey.self] }
        set { self[CelebrationClockKey.self] = newValue }
    }
}

// MARK: - Tokens

extension Motion {
    /// The one bouncy token: score-tier pops, the flag unfurling, a round slotting in.
    static let pop = Animation.spring(duration: 0.4, bounce: 0.2)
    /// The house ease-out (0.23, 1, 0.32, 1) as a curve, to evaluate inside a Canvas.
    static let curve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.23, y: 1), endControlPoint: UnitPoint(x: 0.32, y: 1))
    /// A band moving across a surface: on-screen movement, so ease-in-out.
    static let sweep = Animation.timingCurve(0.77, 0, 0.175, 1, duration: 0.7)
}

enum Celebrate {
    /// Between particle bursts (confetti, fireworks), per page.
    static let cooldown: Duration = .seconds(10)
    /// Decisive only (and a boulder flash).
    static let gold = Color(nsColor: .systemYellow)
    /// Pressure: on-fire embers, the flame, CLUTCH and other state chips.
    static let ember = Color(nsColor: .systemOrange)
    /// The most particles one burst draws in a frame.
    static let particleCap = 36
    /// `Motion.sweep`'s curve, for keyframes.
    static let sweepCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.77, y: 0), endControlPoint: UnitPoint(x: 0.175, y: 1))

    /// A CS2 round (or a planted flag) slotting in: 0.6 to 1 on `Motion.pop`,
    /// with opacity; a fade with Reduce Motion. It leaves as a plain, faster
    /// fade (`Motion.exit`): the bounce belongs to arriving, not leaving.
    static func slotIn(reduceMotion: Bool) -> AnyTransition {
        .asymmetric(insertion: reduceMotion ? AnyTransition.opacity.animation(Motion.fade)
                        : AnyTransition.scale(scale: 0.6).combined(with: .opacity).animation(Motion.pop),
                    removal: .opacity.animation(Motion.exit))
    }
}

// MARK: - Cue

/// What the stage draws for a moment: pure data, decided once per moment.
struct CelebrationCue: Equatable {
    /// Confetti physics by stage height.
    enum Preset: Equatable {
        case short, medium, tall

        init(height: CGFloat) {
            self = height < 100 ? .short : height >= 200 ? .tall : .medium
        }

        var count: Int {
            switch self { case .short: 18; case .medium: 24; case .tall: 28 }
        }
        // Tuned from the spec's presets (2.0 / 1.6 / 1.4 drag) after frame
        // review: there, pieces fell at up to 262 pt/s, like gravel. Heavy drag
        // and a low terminal velocity (g/k: 40 and 61 pt/s) make short and medium
        // pop out, then float: apex 22–31 pt up at about 0.4 s, as specified.
        // Tall keeps a faster fall (190 pt/s): the summit sprays out, then
        // drops down the wall, about 75 pt by the end, from an apex inside the well.
        /// pt/s.
        var speed: Double {
            switch self { case .short: 150; case .medium: 200; case .tall: 170 }
        }
        /// pt/s².
        var gravity: Double {
            switch self { case .short: 160; case .medium: 220; case .tall: 420 }
        }
        /// 1/s.
        var drag: Double {
            switch self { case .short: 4.0; case .medium: 3.6; case .tall: 2.2 }
        }
    }

    enum Effect: Equatable {
        /// The signature for touchdowns, goals, tops and buzzer-beaters (§2.1).
        case confetti(direction: Angle, spread: Angle, preset: Preset)
        /// Baseball's signature, at the fence (§2.2).
        case fireworks(shells: Int)
        /// The accent for swing moments, and the calm stand-in for a burst (§2.3).
        /// Rays start `base` pt out, just clear of the mark (3 for a dot).
        case sparks(rays: Int, length: CGFloat, base: CGFloat = 3)
        /// The ball drops through and the net ripples, from 0.4 s (when the
        /// shot's flight reaches the rim). With `echo`, an and-one ring after (§2.4).
        case swish(echo: Bool)
        /// The and-one ring alone, when the make's swish already played.
        case echo
        /// The dunk: the ball drops onto the rim and the ring rings (§2.5).
        case rimPulse
        /// On fire: six embers rise from the rim (§2.6).
        case embers
        /// A soft disc, no movement: Reduce Motion's stand-in for any burst (§2.7).
        case bloom(radius: CGFloat)

        /// Confetti and fireworks: the effects the 10 s cooldown governs.
        var isBurst: Bool {
            switch self {
            case .confetti, .fireworks: true
            default: false
            }
        }
    }

    /// Effects listed after a swish or rim pulse start when the ball reaches the rim.
    var effects: [Effect]
    /// Decisive: gold takes 15% of the particles, and confetti grows ×1.5 with a second wave.
    var gold = false
    /// FNV-1a of the moment's ID: the same moment always draws the same burst.
    var seed: UInt64 = 0
    /// When the chart's own data motion lands (the ball reaching the end zone).
    var delay: Double = 0
    /// Rays in `Color.primary` at 0.8 instead of team colors: a save is the keeper's, not the shooter's.
    var glint = false
    /// Subtle's lighter swish (one ring) and rim (no spring).
    var subtle = false

    var bursts: Bool { effects.contains(where: \.isBurst) }

    /// Seconds from mount until the last particle is gone.
    var duration: Double {
        delay + (effects.indices.map { start(of: $0) + length(of: effects[$0]) }.max() ?? 0)
    }

    /// When effect `index` starts, after `delay`: anything following a swish or
    /// rim pulse waits for the ball to reach the rim.
    func start(of index: Int) -> Double {
        for earlier in effects[..<index] {
            switch earlier {
            case .swish:
                if case .sparks = effects[index] { return 0.42 }
                return 0.40
            case .rimPulse:
                return 0.12
            default:
                continue
            }
        }
        return 0
    }

    /// How long one effect plays.
    func length(of effect: Effect) -> Double {
        switch effect {
        case .confetti: 0.06 + 1.24 + (gold ? 0.18 : 0)
        case let .fireworks(shells): 0.22 * Double(min(max(shells, 1), 3) - 1) + 0.95
        case .sparks: 0.38
        case let .swish(echo): subtle ? 0.90 : echo ? 1.30 : 0.99
        case .echo: 0.5
        case .rimPulse: 0.72
        case .embers: 0.76
        case .bloom: 0.95
        }
    }

    /// The most particles an effect other than confetti or fireworks draws at once.
    fileprivate func reserved(excluding index: Int) -> Int {
        effects.enumerated().reduce(0) { sum, item in
            guard item.offset != index else { return sum }
            switch item.element {
            case let .sparks(rays, _, _): return sum + rays
            case let .swish(echo): return sum + (echo ? 4 : 3)
            case .echo, .bloom: return sum + 1
            case .rimPulse: return sum + 2
            case .embers: return sum + 6
            case .confetti, .fireworks: return sum
            }
        }
    }
}

// MARK: - Mapping and particles

enum Celebration {
    /// One drawn mark at an instant: a confetti piece, a ray, a ring.
    struct Particle: Equatable {
        enum Shape: Equatable {
            /// A confetti piece (rectangle, disc or streamer), drawn rotated by `angle`.
            case piece(CGSize, corner: CGFloat)
            /// A ray or a firework trail, round-capped.
            case streak(from: CGPoint, to: CGPoint, width: CGFloat)
            case ring(radius: CGFloat, width: CGFloat)
            case disc(radius: CGFloat)
            /// The ball: a team-color disc with a 1 pt edge, so it separates
            /// from what's under it without a knockout.
            case ball(radius: CGFloat)
        }

        enum Ink: Hashable {
            case primary, tint, neutral, gold
            /// `Color.primary` at 0.8: a white glint in dark mode.
            case glint
            /// Orange turning gold over an ember's life (0...1).
            case ember(Double)
        }

        var shape: Shape
        var center: CGPoint
        var angle: Double = 0
        var opacity: Double
        var ink: Ink
    }

    /// The cue for a moment (spec §8.4), with §2.17's substitutions applied:
    /// Off draws nothing; Reduce Motion draws one bloom; Subtle and a moment
    /// inside the cooldown (`burst == false`) trade confetti and fireworks for
    /// sparks. `effects` replaces the table's effects for this moment (an
    /// and-one's echo alone, a lane's sparks) and goes through the same filters.
    /// Nil means the stage draws nothing (the chart keeps its own marks and pings).
    static func cue(for m: LiveMoment, level: CelebrationLevel, reduceMotion: Bool,
                    geometry: CelebrationCue.Preset, direction: Angle,
                    effects override: [CelebrationCue.Effect]? = nil) -> CelebrationCue? {
        guard level != .off else { return nil }
        var cue = table(m, geometry: geometry, direction: direction)
        if let override { cue.effects = override }
        guard !cue.effects.isEmpty else { return nil }
        if reduceMotion {
            // Nothing travels, scales or spins: a soft disc where it happened.
            return CelebrationCue(effects: [.bloom(radius: cue.bursts ? 22 : 14)], seed: cue.seed, delay: cue.delay)
        }
        if level == .subtle {
            cue.subtle = true
            cue.effects = cue.effects.compactMap { effect in
                switch effect {
                case .confetti, .fireworks: .sparks(rays: 8, length: 13)
                case let .sparks(_, length, base): .sparks(rays: 4, length: length, base: base)
                case .embers: nil
                default: effect
                }
            }
        } else if !m.burst {
            cue.effects = cue.effects.map { $0.isBurst ? .sparks(rays: 8, length: 13) : $0 }
        }
        return cue
    }

    /// Whether this moment's celebration would be a particle burst at Full, so
    /// `MomentCenter` can hold it to one burst every 10 s.
    static func wantsBurst(_ m: LiveMoment) -> Bool {
        table(m, geometry: .medium, direction: .degrees(-90)).bursts
    }

    /// Spec §8.4 at Full, before substitutions.
    private static func table(_ m: LiveMoment, geometry: CelebrationCue.Preset, direction: Angle) -> CelebrationCue {
        let a = m.accents
        // Decisive is an accent on a score; on anything else it's ignored.
        let decisive = m.decisive && m.tier == .score
        var effects: [CelebrationCue.Effect] = []
        var delay = 0.0
        var glint = false
        func confetti(_ spread: Double) -> CelebrationCue.Effect {
            .confetti(direction: direction, spread: .degrees(spread), preset: geometry)
        }
        switch m.kind {
        // Football: the burst waits for the ball to reach the end zone.
        case .touchdown:
            effects = [confetti(55)]; delay = 0.40
        case .fieldGoal:
            effects = [.sparks(rays: 6, length: 16)]; delay = 0.40
        case .safety:
            effects = [.bloom(radius: 22)]; delay = 0.35
        case .passComplete, .rush:
            if a.contains(.bigPlay) { effects = [.sparks(rays: 4, length: 9)]; delay = 0.30 }
        // Soccer: after the shot's path reaches the goal.
        case .goal:
            effects = [confetti(55)]; delay = 0.40
        case .shotSaved:
            effects = [.sparks(rays: 4, length: 9)]; delay = 0.35; glint = true
        case .shotWide:
            if a.contains(.woodwork) { effects = [.sparks(rays: 4, length: 9)]; delay = 0.35 }
        // Baseball.
        case .homeRun:
            effects = [.fireworks(shells: decisive ? 3 : a.contains(.grandSlam) ? 2 : 1)]; delay = 0.35
        case .runScored:
            effects = [.sparks(rays: 6, length: 13)]
        // Basketball: the stage's swish starts where the shot's flight ends.
        case let .made(value):
            effects = [a.contains(.dunk) ? .rimPulse : .swish(echo: a.contains(.andOne))]
            if value >= 3 {
                effects.append(.sparks(rays: 6, length: 13))
            } else if a.contains(.clutch) {
                effects.append(.sparks(rays: 4, length: 13))
            }
            if a.contains(.onFire) { effects.append(.embers) }
            if a.contains(.buzzer) { effects.append(.confetti(direction: direction, spread: .degrees(60), preset: .medium)) }
        case .run, .leadChange:
            effects = [.sparks(rays: 4, length: 9)]
        // Climbing.
        case .passed:
            if a.contains(.newLeader) { effects = [.sparks(rays: 6, length: 13)]; delay = 0.30 }
        case .top:
            switch m.chart {
            case .ascent:
                // After the summit flag plants.
                effects = [confetti(80)]; delay = 0.25
            case .boulder:
                // Clear of the 14 × 26 cell's corners, at its center.
                effects = [a.contains(.flash) ? .sparks(rays: 8, length: 11, base: 14) : .sparks(rays: 6, length: 9, base: 14)]
            default:
                effects = [.sparks(rays: 6, length: 9)]
            }
        default:
            // Marks only: turnovers, sacks, misses, blocks, steals, rounds, cards.
            break
        }
        var gold = m.kind == .top && a.contains(.flash)
        if decisive {
            gold = true
            // A decisive score always gets the signature, on charts with a well to hold it.
            if !effects.contains(where: \.isBurst), [.field, .pitch, .ascent, .court].contains(m.chart) {
                effects.append(confetti(m.chart == .ascent ? 80 : 55))
            }
        }
        return CelebrationCue(effects: effects, gold: gold, seed: seed(m.id), delay: delay, glint: glint)
    }

    /// FNV-1a 64-bit. Stable across launches, unlike `hashValue`.
    static func seed(_ id: String) -> UInt64 {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in id.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return hash
    }

    /// Every particle of `cue` at `t` seconds after mount, with `origin` in the
    /// drawing's coordinates. Shared by the live stage, the harness and tests.
    @MainActor static func particles(_ cue: CelebrationCue, origin: CGPoint, t: Double) -> [Particle] {
        let local = t - cue.delay
        guard local >= 0 else { return [] }
        var out: [Particle] = []
        out.reserveCapacity(Celebrate.particleCap)
        for (index, effect) in cue.effects.enumerated() {
            let age = local - cue.start(of: index)
            guard age >= 0, age <= cue.length(of: effect) else { continue }
            var random = SplitMix64(seed: cue.seed &+ UInt64(index + 1) &* 0x9E37_79B9_7F4A_7C15)
            let budget = Celebrate.particleCap - cue.reserved(excluding: index)
            switch effect {
            case let .confetti(direction, spread, preset):
                confetti(&out, &random, origin: origin, age: age, direction: direction, spread: spread,
                         preset: preset, gold: cue.gold, budget: budget)
            case let .fireworks(shells):
                fireworks(&out, &random, origin: origin, age: age, shells: shells, gold: cue.gold, budget: budget)
            case let .sparks(rays, length, base):
                sparks(&out, &random, origin: origin, age: age, rays: rays, length: length, base: base, gold: cue.gold, glint: cue.glint)
            case let .swish(echo):
                let drop = (age - 0.40) / 0.12
                if (0...1).contains(drop) {
                    let c = curve(drop)
                    out.append(Particle(shape: .ball(radius: 2.5 * (1 - 0.5 * c)), center: origin, opacity: 1 - c, ink: .primary))
                }
                ripple(&out, origin: origin, age: age - 0.40, reach: 11)
                if !cue.subtle {
                    ripple(&out, origin: origin, age: age - 0.49, reach: 16)
                    if echo { ripple(&out, origin: origin, age: age - 0.80, reach: 9) }
                }
            case .echo:
                ripple(&out, origin: origin, age: age, reach: 9)
            case .rimPulse:
                rimPulse(&out, origin: origin, age: age, subtle: cue.subtle)
            case .embers:
                embers(&out, &random, origin: origin, age: age)
            case let .bloom(radius):
                let o = age < 0.15 ? curve(age / 0.15) : age < 0.35 ? 1 : 1 - curve((age - 0.35) / 0.6)
                out.append(Particle(shape: .disc(radius: radius), center: origin, opacity: 0.20 * o, ink: .primary))
            }
        }
        if out.count > Celebrate.particleCap { out.removeLast(out.count - Celebrate.particleCap) }
        return out
    }

    // MARK: Effects (closed form)

    private static func curve(_ x: Double) -> Double {
        Motion.curve.value(at: min(max(x, 0), 1))
    }

    /// Drag and gravity, closed form (y down): x = x0 + vx(1−e^{−kt})/k,
    /// y = y0 + (g/k)t + (vy − g/k)(1−e^{−kt})/k.
    private static func ballistic(_ p: CGPoint, _ vx: Double, _ vy: Double, g: Double, k: Double, t: Double) -> CGPoint {
        let e = (1 - exp(-k * t)) / k
        return CGPoint(x: p.x + vx * e, y: p.y + (g / k) * t + (vy - g / k) * e)
    }

    /// Holds at 1, then dissolves over the last 45% of life (smoothstep). Not
    /// the house ease-out: on a particle that reads as a blink, not a fade.
    private static func fade(_ age: Double, _ life: Double) -> Double {
        let x = min(max((age / life - 0.55) / 0.45, 0), 1)
        return 1 - x * x * (3 - 2 * x)
    }

    /// Primary 50%, tint 25%, neutral 25%; decisive: gold takes 15 of the
    /// neutral 25. 13 is coprime with 20, so every 20 particles hit each slot once.
    private static func ink(_ i: Int, gold: Bool) -> Particle.Ink {
        switch (i * 13 + 5) % 20 {
        case 0..<10: .primary
        case 10..<15: .tint
        case 15..<18 where gold: .gold
        default: .neutral
        }
    }

    private static func confetti(_ out: inout [Particle], _ random: inout SplitMix64, origin: CGPoint, age: Double,
                                 direction: Angle, spread: Angle, preset: CelebrationCue.Preset, gold: Bool, budget: Int) {
        let first = preset.count
        let count = max(0, min(gold ? first + first / 2 : first, budget))
        for i in 0..<count {
            // Draw every random number before deciding to skip, so a frame
            // never depends on which frames came before it.
            let birth = random.in(0...0.06) + (i >= first ? 0.18 : 0)
            let life = random.in(0.9...1.24)
            let speed = preset.speed * random.in(0.75...1.25)
            let theta = direction.radians + spread.radians * random.in(-1...1)
            let spin0 = random.in(0...(2 * .pi)), spin = random.in(3...9) * random.sign()
            let phase = random.in(0...(2 * .pi)), flutterRate = random.in(8...14)
            let t = age - birth
            guard t >= 0, t <= life else { continue }
            let p = ballistic(origin, speed * cos(theta), speed * sin(theta), g: preset.gravity, k: preset.drag, t: t)
            // Born at 60%, never from nothing.
            let grow = t < 0.08 ? 0.6 + 0.4 * curve(t / 0.08) : 1
            // Width breathing with |cos| fakes a 3D tumble without 3D.
            let flutter = 0.25 + 0.75 * abs(cos(phase + flutterRate * t))
            // 60% rectangles, 25% discs, 15% streamers.
            let (w, h, corner): (Double, Double, Double) = switch (i * 7 + 2) % 20 {
            case 0..<12: (2.5, 5, 0.75)
            case 12..<17: (3, 3, 1.5)
            default: (1.5, 7, 0.75)
            }
            out.append(Particle(shape: .piece(CGSize(width: w * flutter * grow, height: h * grow), corner: corner * grow),
                                center: p, angle: spin0 + spin * t, opacity: fade(t, life), ink: ink(i, gold: gold)))
        }
    }

    private static func fireworks(_ out: inout [Particle], _ random: inout SplitMix64, origin: CGPoint, age: Double,
                                  shells requested: Int, gold: Bool, budget: Int) {
        let shells = min(max(requested, 1), 3)
        let perShell = max(4, min(14, budget / shells - 1))
        for shell in 0..<shells {
            let at = 0.22 * Double(shell)
            let center = shell == 0 ? origin
                : CGPoint(x: origin.x + random.in(-14...14), y: origin.y + random.in(-10...4))
            let turn = random.in(0...(2 * .pi))
            let t = age - at
            if (0...0.18).contains(t) {
                let c = curve(t / 0.18)
                out.append(Particle(shape: .disc(radius: 2 * (0.6 + c)), center: center, opacity: 1 - c, ink: .tint))
            }
            for j in 0..<perShell {
                let theta = turn + 2 * .pi * Double(j) / Double(perShell) + random.in(-8...8) * .pi / 180
                let speed = random.in(60...95), life = random.in(0.75...0.95)
                guard t >= 0, t <= life else { continue }
                let vx = speed * cos(theta), vy = speed * sin(theta)
                let head = ballistic(center, vx, vy, g: 140, k: 2.4, t: t)
                let tail = ballistic(center, vx, vy, g: 140, k: 2.4, t: max(0, t - 0.05))
                out.append(Particle(shape: .streak(from: tail, to: head, width: 1.5 - 0.75 * t / life), center: head,
                                    opacity: fade(t, life), ink: ink(shell * perShell + j, gold: gold)))
            }
        }
    }

    /// Rays shoot out from just outside the mark and vanish tail-first: a ray
    /// grows from its base, it never scales a shape up from nothing. A cubic
    /// ease-out over 0.26 s (the house curve put the head at 85% in four frames:
    /// a pop, not a shot), the tail 0.1 s behind; gone by 0.36 s.
    private static func sparks(_ out: inout [Particle], _ random: inout SplitMix64, origin: CGPoint, age: Double,
                               rays: Int, length: CGFloat, base: CGFloat, gold: Bool, glint: Bool) {
        let turn = random.in(0...1) * 2 * .pi / Double(max(rays, 1))
        func out3(_ x: Double) -> Double { let c = min(max(x, 0), 1); return 1 - pow(1 - c, 3) }
        let head = base + length * out3(age / 0.26)
        let tail = base + length * out3((age - 0.10) / 0.26)
        let span = head - tail
        guard span > 0.05 else { return }
        for r in 0..<rays {
            let theta = turn + 2 * .pi * Double(r) / Double(rays)
            let u = CGPoint(x: cos(theta), y: sin(theta))
            let ink: Particle.Ink = glint ? .glint : r.isMultiple(of: 2) ? .primary : gold ? .gold : .tint
            out.append(Particle(shape: .streak(from: CGPoint(x: origin.x + u.x * tail, y: origin.y + u.y * tail),
                                               to: CGPoint(x: origin.x + u.x * head, y: origin.y + u.y * head), width: 1.25),
                                center: origin, opacity: min(1, span / 2), ink: ink))
        }
    }

    /// One ring from the rim: radius 2.5 to `reach`, stroke 1.5 to 0.5, opacity
    /// 0.9 to 0 over 0.5 s. A cubic ease-out and a linear fade (the house curve
    /// spent 90% of the ring in its first 0.2 s; it read as a blink, not a ripple).
    private static func ripple(_ out: inout [Particle], origin: CGPoint, age: Double, reach: CGFloat) {
        guard (0...0.5).contains(age) else { return }
        let f = age / 0.5, spread = 1 - pow(1 - f, 3)
        out.append(Particle(shape: .ring(radius: 2.5 + (reach - 2.5) * spread, width: 1.5 - f), center: origin,
                            opacity: 0.9 * (1 - f), ink: .primary))
    }

    /// Main-actor timelines: a `KeyframeTimeline` isn't Sendable, and only the
    /// stage's Canvas (on the main actor) samples them.
    @MainActor private static let rimRing = KeyframeTimeline(initialValue: CGFloat(1)) {
        CubicKeyframe(1.7, duration: 0.10)
        SpringKeyframe(1.0, duration: 0.30, spring: Spring(duration: 0.3, bounce: 0.3))
    }

    @MainActor private static let subtleRimRing = KeyframeTimeline(initialValue: CGFloat(1)) {
        CubicKeyframe(1.35, duration: 0.10)
        CubicKeyframe(1.0, duration: 0.30)
    }

    @MainActor private static func rimPulse(_ out: inout [Particle], origin: CGPoint, age: Double, subtle: Bool) {
        if age <= 0.24 {
            // Drops 12 pt onto the rim on Motion.quick (critically damped, 0.2 s), then through it.
            let omega = 2 * Double.pi / 0.2
            let s = 1 - (1 + omega * age) * exp(-omega * age)
            let through = curve((age - 0.12) / 0.12)
            out.append(Particle(shape: .ball(radius: 2.5 * (1 - 0.5 * through)),
                                center: CGPoint(x: origin.x, y: origin.y - 12 * (1 - s)), opacity: 1 - through, ink: .primary))
        }
        let ring = age - 0.12
        guard (0...0.6).contains(ring) else { return }
        let scale = (subtle ? subtleRimRing : rimRing).value(time: ring)
        let opacity = ring < 0.3 ? 1 : 1 - curve((ring - 0.3) / 0.3)
        out.append(Particle(shape: .ring(radius: 3 * scale, width: 2), center: origin, opacity: opacity, ink: .primary))
    }

    private static func embers(_ out: inout [Particle], _ random: inout SplitMix64, origin: CGPoint, age: Double) {
        for _ in 0..<6 {
            let birth = random.in(0...0.06)
            let vx = random.in(-20...20), vy = random.in(-70...(-40))
            let t = age - birth
            guard (0...0.7).contains(t) else { continue }
            out.append(Particle(shape: .disc(radius: 1), center: ballistic(origin, vx, vy, g: -30, k: 1.5, t: t),
                                opacity: fade(t, 0.7), ink: .ember(t / 0.7)))
        }
    }

    // MARK: Drawing

    /// Draws particles into a Canvas: one fill or stroke each, colors resolved once per frame.
    static func draw(_ particles: [Particle], in context: GraphicsContext, palette: CelebrationPalette) {
        guard !particles.isEmpty else { return }
        let primary = context.resolve(GraphicsContext.Shading.color(palette.primary))
        let tint = context.resolve(GraphicsContext.Shading.color(palette.tint))
        let neutral = context.resolve(GraphicsContext.Shading.color(Color.primary.opacity(0.55)))
        let gold = context.resolve(GraphicsContext.Shading.color(Celebrate.gold))
        let glint = context.resolve(GraphicsContext.Shading.color(Color.primary.opacity(0.8)))
        let edge = context.resolve(GraphicsContext.Shading.color(Color.primary.opacity(0.5)))
        func shading(_ ink: Particle.Ink) -> GraphicsContext.Shading {
            switch ink {
            case .primary: primary
            case .tint: tint
            case .neutral: neutral
            case .gold: gold
            case .glint: glint
            case let .ember(f): .color(Celebrate.ember.mix(with: Celebrate.gold, by: min(max(f, 0), 1)))
            }
        }
        for p in particles {
            var g = context
            g.opacity = p.opacity
            switch p.shape {
            case let .piece(size, corner):
                let rect = CGRect(x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height)
                let transform = CGAffineTransform(translationX: p.center.x, y: p.center.y).rotated(by: p.angle)
                g.fill(Path(roundedRect: rect, cornerRadius: corner).applying(transform), with: shading(p.ink))
            case let .streak(from, to, width):
                var path = Path()
                path.move(to: from)
                path.addLine(to: to)
                g.stroke(path, with: shading(p.ink), style: StrokeStyle(lineWidth: width, lineCap: .round))
            case let .ring(radius, width):
                g.stroke(Path(ellipseIn: CGRect(x: p.center.x - radius, y: p.center.y - radius, width: radius * 2, height: radius * 2)),
                         with: shading(p.ink), lineWidth: width)
            case let .disc(radius):
                g.fill(Path(ellipseIn: CGRect(x: p.center.x - radius, y: p.center.y - radius, width: radius * 2, height: radius * 2)),
                       with: shading(p.ink))
            case let .ball(radius):
                let circle = Path(ellipseIn: CGRect(x: p.center.x - radius, y: p.center.y - radius, width: radius * 2, height: radius * 2))
                g.fill(circle, with: shading(p.ink))
                g.stroke(circle, with: edge, lineWidth: 1)
            }
        }
    }
}

/// SplitMix64: tiny, fast and identical on every run for the same seed.
struct SplitMix64 {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// Uniform in the range.
    mutating func `in`(_ range: ClosedRange<Double>) -> Double {
        range.lowerBound + Double(next() >> 11) / Double(1 << 53) * (range.upperBound - range.lowerBound)
    }

    mutating func sign() -> Double { next() & 1 == 0 ? 1 : -1 }
}

// MARK: - Colors

/// Whose colors a burst wears. Half the particles take the primary color, a
/// quarter its tint, a quarter neutral ink (gold takes most of that when decisive).
enum CelebrationColors: Equatable {
    /// The scorer's `TeamPalette` color (already adjusted for the scheme).
    case team(Color)
    /// A climber's flag, by IOC code: its two colors from `FlagPalette`.
    case flag(String?)
    /// No color to go on.
    case accent

    var palette: CelebrationPalette {
        switch self {
        case let .team(color):
            // A team with no usable color is drawn neutral elsewhere; its celebration takes the accent.
            return .tinted(color == Viz.neutral ? .accentColor : color)
        case let .flag(ioc):
            guard let (a, b) = FlagPalette.colors(ioc: ioc) else { return .tinted(.accentColor) }
            return a == b ? .tinted(a) : CelebrationPalette(primary: a, tint: b)
        case .accent:
            return .tinted(.accentColor)
        }
    }
}

struct CelebrationPalette: Equatable {
    var primary: Color
    var tint: Color

    /// One color and its tint (mixed 40% with white).
    static func tinted(_ color: Color) -> CelebrationPalette {
        CelebrationPalette(primary: color, tint: color.mix(with: .white, by: 0.4))
    }
}

// MARK: - Stage

/// The chart's stage: over the marks, outside the chart's compositing group
/// (so the chart's own Canvas isn't redrawn every frame), spanning and clipped
/// to the well. Plays once per moment, then removes itself. Draws nothing at
/// Off, while the panel is being resized, or when the pointer was on the
/// chart as the moment arrived; it fades out if the pointer arrives mid-burst.
///
///     .compositingGroup()
///     .overlay(alignment: .topLeading) {
///         CelebrationStage(moment: moment, origin: moment.flatMap { point(for: $0) },
///                          size: geo.size, colors: .team(color(moment?.side)), direction: .degrees(-150))
///     }
struct CelebrationStage: View {
    let moment: LiveMoment?
    /// Where it happened, in the chart's coordinates (the end zone's center, the rim).
    let origin: CGPoint?
    /// The chart's size, from its existing GeometryReader.
    let size: CGSize
    let colors: CelebrationColors
    /// Which way confetti flies: into the field from an end zone, up from a rim.
    var direction: Angle = .degrees(-90)
    /// The `vizWell` padding around the chart.
    var wellInset: CGFloat = 10
    /// Replaces the table's effects for this moment (still filtered by level,
    /// Reduce Motion and the cooldown).
    var effects: [CelebrationCue.Effect]? = nil

    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let moment, let origin,
           let cue = Celebration.cue(for: moment, level: level, reduceMotion: reduceMotion,
                                     geometry: CelebrationCue.Preset(height: size.height), direction: direction, effects: effects) {
            CelebrationBurst(cue: cue, origin: origin, size: size, colors: colors, wellInset: wellInset)
                .id(moment.id)
                // The moment arrives inside an animated transaction; a burst
                // starts at full strength, never fading in.
                .transition(.identity)
        }
    }
}

/// One burst. Its TimelineView exists only while it plays.
private struct CelebrationBurst: View {
    let cue: CelebrationCue
    let origin: CGPoint
    let size: CGSize
    let colors: CelebrationColors
    let wellInset: CGFloat

    @Environment(\.celebrationClock) private var clock
    @Environment(\.panelResizing) private var resizing
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @State private var start: Date?
    @State private var done = false
    /// The pointer arrived mid-burst: pointing wins.
    @State private var yielded = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            switch clock {
            case let .frozen(t):
                if t <= cue.duration { surface(at: t) }
            case .live:
                if !done && !resizing {
                    TimelineView(.animation) { context in
                        surface(at: start.map { context.date.timeIntervalSince($0) } ?? 0)
                    }
                    .task {
                        try? await Task.sleep(for: .seconds(cue.duration + 0.05))
                        done = true
                    }
                }
            }
        }
        .opacity(yielded ? 0 : 1)
        .onAppear {
            start = .now
            if linked?.focus != nil { done = true }
        }
        .onChange(of: resizing) { _, now in if now { done = true } }
        .onChange(of: linked?.focus != nil) { _, pointing in
            guard pointing, !done else { return }
            withAnimation(Motion.exit) { yielded = true }
            Task {
                try? await Task.sleep(for: .milliseconds(150))
                done = true
            }
        }
    }

    private func surface(at t: Double) -> some View {
        let palette = colors.palette
        let point = CGPoint(x: origin.x + wellInset, y: origin.y + wellInset)
        return Canvas { context, _ in
            Celebration.draw(Celebration.particles(cue, origin: point, t: t), in: context, palette: palette)
        }
        .frame(width: size.width + 2 * wellInset, height: size.height + 2 * wellInset)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .offset(x: -wellInset, y: -wellInset)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Mark family

/// A mark's knock offset: x along the push, y the dip.
struct KnockValue: Equatable {
    var x: CGFloat = 0
    var y: CGFloat = 0
}

extension Celebrate {
    /// The knock (§2.8): out, back past center, damped (0.34 s), with a dip.
    /// `outward` is the first move's sign: away from whatever caused it.
    static func knockSteps(amplitude a: CGFloat, outward o: CGFloat) -> [(x: CGFloat, duration: Double)] {
        [(o * a, 0.05), (-0.8 * o * a, 0.07), (0.5 * o * a, 0.07), (-0.25 * o * a, 0.07), (0, 0.08)]
    }

    /// The backboard rattle (§2.5): two quick cycles in 0.2 s.
    static func rattleSteps(amplitude a: CGFloat) -> [(x: CGFloat, duration: Double)] {
        [(a, 0.025), (-a, 0.05), (a, 0.05), (-0.5 * a, 0.05), (0, 0.025)]
    }

    @KeyframesBuilder<KnockValue>
    static func knock(_ steps: [(x: CGFloat, duration: Double)], dip: CGFloat) -> some Keyframes<KnockValue> {
        KeyframeTrack(\.x) {
            for step in steps { CubicKeyframe(step.x, duration: step.duration) }
        }
        KeyframeTrack(\.y) {
            CubicKeyframe(dip, duration: 0.08)
            SpringKeyframe(0, duration: 0.22, spring: Spring(duration: 0.26, bounce: 0))
            // A spring keyframe stops wherever the spring is (0.03 pt short here);
            // land exactly, so the mark comes to rest pixel-identical.
            LinearKeyframe(0, duration: 0.04)
        }
    }

    /// A pop (§2.9): up to `peak` in 0.14 s, then a soft spring home (0.5 s total).
    @KeyframesBuilder<CGFloat>
    static func pop(_ peak: CGFloat, delay: Double) -> some Keyframes<CGFloat> {
        KeyframeTrack {
            // A zero-length keyframe makes the timeline NaN: hold only when there's a delay.
            if delay > 0 {
                LinearKeyframe(1, duration: delay)
                CubicKeyframe(peak, duration: 0.14)
            } else {
                CubicKeyframe(peak, duration: 0.14)
            }
            SpringKeyframe(1, duration: 0.32, spring: Spring(duration: 0.36, bounce: 0.25))
            // Land exactly on 1 (the spring alone stops at 0.998).
            LinearKeyframe(1, duration: 0.04)
        }
    }

    /// The score pill (EventRow's flash timings): in quickly, hold 1.6 s, out slowly.
    @KeyframesBuilder<Double>
    static func pill(peak: Double, fadeOut: Double) -> some Keyframes<Double> {
        KeyframeTrack {
            LinearKeyframe(peak, duration: 0.15, timingCurve: Motion.curve)
            LinearKeyframe(peak, duration: 1.6)
            LinearKeyframe(0, duration: fadeOut, timingCurve: .easeOut)
        }
    }

    /// The hero wash pulse (§2.10): rise, hold, a slow 1 s decay (1.55 s at a 0.25 s rise).
    @KeyframesBuilder<Double>
    static func wash(rise: Double) -> some Keyframes<Double> {
        KeyframeTrack {
            LinearKeyframe(1, duration: rise, timingCurve: Motion.curve)
            LinearKeyframe(1, duration: 0.30)
            LinearKeyframe(0, duration: 1.0, timingCurve: Motion.settle)
        }
    }

    /// The glint's progress across its surface: waits 0.3 s for the pop, then sweeps in 0.7 s.
    @KeyframesBuilder<Double>
    static func glint() -> some Keyframes<Double> {
        KeyframeTrack {
            MoveKeyframe(0)
            LinearKeyframe(0, duration: 0.3)
            LinearKeyframe(1, duration: 0.7, timingCurve: sweepCurve)
        }
    }

    /// Reduce Motion's knock: a ring flashes 0 to 1 to 0 over 0.4 s instead.
    @KeyframesBuilder<Double>
    static func ringFlash() -> some Keyframes<Double> {
        KeyframeTrack {
            LinearKeyframe(1, duration: 0.12, timingCurve: Motion.curve)
            LinearKeyframe(0, duration: 0.28, timingCurve: Motion.settle)
        }
    }
}

extension View {
    /// "Bumped": out, back, a damped shake (and a dip when knocked below), on
    /// each change of `trigger`. A ring flash with Reduce Motion; half size and
    /// no dip at Subtle; nothing at Off. Never fires on first render.
    func knock(_ trigger: Int, amplitude: CGFloat = 3, dip: CGFloat = 0, outward: CGFloat = -1,
               axis: Axis = .horizontal) -> some View {
        modifier(Knock(trigger: trigger, steps: { Celebrate.knockSteps(amplitude: $0, outward: outward) },
                       amplitude: amplitude, dip: dip, axis: axis))
    }

    /// The backboard's rattle under a dunk: ±1.2 pt, two cycles in 0.2 s.
    func rattle(_ trigger: Int, amplitude: CGFloat = 1.2) -> some View {
        modifier(Knock(trigger: trigger, steps: { Celebrate.rattleSteps(amplitude: $0) },
                       amplitude: amplitude, dip: 0, axis: .horizontal))
    }

    /// A score-tier pop: 1 to `scale` to 1 (0.5 s), anchored at the center,
    /// after `delay` (a stadium wave staggers 0.02 s per square). Full only.
    func scorePop(_ trigger: Int, scale: CGFloat = 1.12, delay: Double = 0) -> some View {
        modifier(ScorePop(trigger: trigger, scale: scale, delay: delay))
    }

    /// A team-color pill behind the scorer's number: in, hold 1.6 s, out over
    /// 1.2 s. At every level but Off (it's color, not motion).
    func scorePill(_ trigger: Int, color: Color) -> some View {
        modifier(ScorePill(trigger: trigger, color: color))
    }

    /// A filled overlay sweeping up from the bottom (15% to full in 0.22 s,
    /// never from nothing) when `filled` turns true. A fade with Reduce Motion or at Off.
    func fillSweep(_ filled: Bool) -> some View {
        modifier(FillSweep(filled: filled))
    }

    /// One sheen across a surface, 0.3 s after `trigger` changes: the Wallet
    /// pass glint. A gradient, never a blend or blur. Full only.
    ///
    /// `active: false` keeps the band unmounted (the trigger is left alone),
    /// for a scoreboard that isn't the one on screen (hero vs docked bar).
    func glint(_ trigger: Int, width: CGFloat = 44, in shape: some Shape, active: Bool = true) -> some View {
        overlay { if active { GlintBand(trigger: trigger, width: width).clipShape(shape) } }
    }
}

private struct Knock: ViewModifier {
    let trigger: Int
    let steps: (CGFloat) -> [(x: CGFloat, duration: Double)]
    let amplitude: CGFloat
    let dip: CGFloat
    let axis: Axis
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var moves: Bool { level != .off && !reduceMotion }
    private var a: CGFloat { moves ? (level == .subtle ? amplitude / 2 : amplitude) : 0 }
    private var d: CGFloat { moves && level == .full ? dip : 0 }

    @ViewBuilder func body(content: Content) -> some View {
        let steps = steps(a), d = d, axis = axis
        Group {
            switch clock {
            case let .frozen(t):
                let v = trigger > 0 ? KeyframeTimeline(initialValue: KnockValue()) { Celebrate.knock(steps, dip: d) }.value(time: t) : KnockValue()
                content.offset(x: axis == .horizontal ? v.x : 0, y: axis == .horizontal ? v.y : v.x)
            case .live:
                content.keyframeAnimator(initialValue: KnockValue(), trigger: trigger) { content, v in
                    content.offset(x: axis == .horizontal ? v.x : 0, y: axis == .horizontal ? v.y : v.x)
                } keyframes: { _ in
                    Celebrate.knock(steps, dip: d)
                }
            }
        }
        .overlay {
            if reduceMotion && level != .off {
                RingFlash(trigger: trigger)
            }
        }
    }
}

/// Reduce Motion's knock: a 1 pt ring around the mark flashes once.
private struct RingFlash: View {
    let trigger: Int
    @Environment(\.celebrationClock) private var clock

    var body: some View {
        let ring = Capsule().strokeBorder(Color.primary, lineWidth: 1).padding(-2)
        switch clock {
        case let .frozen(t):
            ring.opacity(trigger > 0 ? KeyframeTimeline(initialValue: 0.0) { Celebrate.ringFlash() }.value(time: t) : 0)
        case .live:
            ring.keyframeAnimator(initialValue: 0.0, trigger: trigger) { content, o in
                content.opacity(o)
            } keyframes: { _ in
                Celebrate.ringFlash()
            }
        }
    }
}

private struct ScorePop: ViewModifier {
    let trigger: Int
    let scale: CGFloat
    let delay: Double
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder func body(content: Content) -> some View {
        let peak = level == .full && !reduceMotion ? scale : 1, delay = delay
        switch clock {
        case let .frozen(t):
            content.scaleEffect(trigger > 0 ? KeyframeTimeline(initialValue: CGFloat(1)) { Celebrate.pop(peak, delay: delay) }.value(time: t) : 1)
        case .live:
            content.keyframeAnimator(initialValue: CGFloat(1), trigger: trigger) { content, s in
                content.scaleEffect(s)
            } keyframes: { _ in
                Celebrate.pop(peak, delay: delay)
            }
        }
    }
}

private struct ScorePill: ViewModifier {
    let trigger: Int
    let color: Color
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let peak = level == .off ? 0.0 : 1.0, fadeOut = reduceMotion ? 0.3 : 1.2
        let pill = Capsule()
            .fill(color == Viz.neutral ? Color.primary.opacity(0.10) : color.opacity(0.18))
            .padding(.horizontal, -8)
            .padding(.vertical, -2)
        return content.background {
            switch clock {
            case let .frozen(t):
                pill.opacity(trigger > 0 ? KeyframeTimeline(initialValue: 0.0) { Celebrate.pill(peak: peak, fadeOut: fadeOut) }.value(time: t) : 0)
            case .live:
                pill.keyframeAnimator(initialValue: 0.0, trigger: trigger) { content, o in
                    content.opacity(o)
                } keyframes: { _ in
                    Celebrate.pill(peak: peak, fadeOut: fadeOut)
                }
            }
        }
    }
}

private struct FillSweep: ViewModifier {
    let filled: Bool
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @ViewBuilder func body(content: Content) -> some View {
        let sweeps = level != .off && !reduceMotion
        switch clock {
        case let .frozen(t):
            let rise = Motion.curve.value(at: min(max(t / (sweeps ? 0.22 : 0.15), 0), 1))
            content
                .scaleEffect(x: 1, y: !sweeps ? 1 : filled ? 0.15 + 0.85 * rise : 0.15, anchor: .bottom)
                .opacity(filled ? (sweeps ? 1 : rise) : 0)
        case .live:
            content
                .scaleEffect(x: 1, y: filled || !sweeps ? 1 : 0.15, anchor: .bottom)
                .opacity(filled ? 1 : 0)
                .animation(sweeps ? Motion.sweepIn : Motion.fade, value: filled)
        }
    }
}

private struct GlintBand: View {
    let trigger: Int
    let width: CGFloat
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let shows = level == .full && !reduceMotion
        let alpha = scheme == .dark ? 0.22 : 0.40, width = width
        switch clock {
        case let .frozen(t):
            Self.band(trigger > 0 && shows ? KeyframeTimeline(initialValue: 0.0) { Celebrate.glint() }.value(time: t) : 0,
                      width: width, alpha: alpha)
        case .live:
            Color.clear
                .keyframeAnimator(initialValue: 0.0, trigger: trigger) { content, p in
                    content.overlay { Self.band(shows ? p : 0, width: width, alpha: alpha) }
                } keyframes: { _ in
                    Celebrate.glint()
                }
                .allowsHitTesting(false)
        }
    }

    /// The band at progress `p`, its center traveling from −width to the
    /// surface's width + width. Mounted only mid-sweep.
    @ViewBuilder
    nonisolated private static func band(_ p: Double, width: CGFloat, alpha: Double) -> some View {
        if p > 0, p < 1 {
            Canvas { context, size in
                var g = context
                g.translateBy(x: -width + (size.width + 2 * width) * p, y: size.height / 2)
                g.rotate(by: .degrees(18))
                let reach = size.height * 1.6 + width
                g.fill(Path(CGRect(x: -width / 2, y: -reach / 2, width: width, height: reach)),
                       with: .linearGradient(Gradient(colors: [.white.opacity(0), .white.opacity(alpha), .white.opacity(0)]),
                                             startPoint: CGPoint(x: -width / 2, y: 0), endPoint: CGPoint(x: width / 2, y: 0)))
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}

/// The hero wash pulse (§2.10): hands its content `b`, 0 at rest and up to 1
/// during a pulse, so the scorer's stop can go to `strength × (1 + 0.35·b)`.
/// Halved with Reduce Transparency, a slower rise with Reduce Motion, flat at
/// Subtle and Off.
struct WashPulse<Content: View>: View {
    let trigger: Int
    let content: (Double) -> Content
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    init(trigger: Int, @ViewBuilder content: @escaping (Double) -> Content) {
        self.trigger = trigger
        self.content = content
    }

    var body: some View {
        let amplitude = level == .full ? (reduceTransparency ? 0.5 : 1) : 0
        let rise = reduceMotion ? 0.4 : 0.25
        switch clock {
        case let .frozen(t):
            content(trigger > 0 ? KeyframeTimeline(initialValue: 0.0) { Celebrate.wash(rise: rise) }.value(time: t) * amplitude : 0)
        case .live:
            KeyframeAnimator(initialValue: 0.0, trigger: trigger) { b in
                content(b * amplitude)
            } keyframes: { _ in
                Celebrate.wash(rise: rise)
            }
        }
    }
}

/// A top's summit flag (§2.13): a pole rises, then the climber's flag unfurls.
/// The pole's foot is at the view's center, so `.position(x: trackX, y: top)`
/// plants it. Plays when it appears planted or when `planted` turns true;
/// leaves with `Motion.exit`. Fades in whole with Reduce Motion; nothing at Off.
struct SummitFlag: View {
    let flag: String?
    let planted: Bool
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pole: CGFloat = 0
    @State private var unfurl: CGFloat = 0.2
    @State private var pennant: Double = 0
    @State private var shown: Double = 0

    private static let poleHeight: CGFloat = 12
    private static let unfurlTimeline = KeyframeTimeline(initialValue: CGFloat(0.2)) {
        SpringKeyframe(1, duration: 0.36, spring: Spring(duration: 0.4, bounce: 0.2))
        LinearKeyframe(1, duration: 0.04)
    }

    var body: some View {
        let s = state
        // A 44 × 24 box with the pole's foot at its center.
        ZStack(alignment: .topLeading) {
            Path { path in
                path.move(to: CGPoint(x: 22, y: Self.poleHeight))
                path.addLine(to: CGPoint(x: 22, y: 0))
            }
            .trim(from: 0, to: s.pole)
            .stroke(Color.primary.opacity(0.7), lineWidth: 1)
            mark
                .scaleEffect(x: s.unfurl, y: 1, anchor: .leading)
                .opacity(s.pennant)
                .offset(x: 22.5, y: -2)
        }
        .frame(width: 44, height: Self.poleHeight * 2, alignment: .topLeading)
        .opacity(s.shown)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { if planted { plant() } }
        .onChange(of: planted) { _, now in now ? plant() : leave() }
    }

    @ViewBuilder private var mark: some View {
        if let flag {
            Text(flag).font(.system(size: 11)).fixedSize()
        } else {
            Image(systemName: "flag.fill").font(.system(size: 9)).foregroundStyle(Color.accentColor)
        }
    }

    private var state: (pole: CGFloat, unfurl: CGFloat, pennant: Double, shown: Double) {
        guard case let .frozen(t) = clock else { return (pole, unfurl, pennant, shown) }
        guard planted, level != .off else { return (0, 0.2, 0, 0) }
        if reduceMotion { return (1, 1, 1, Motion.curve.value(at: min(t / 0.15, 1))) }
        return (Motion.curve.value(at: min(t / 0.15, 1)), Self.unfurlTimeline.value(time: max(t - 0.12, 0)),
                Motion.curve.value(at: min(max((t - 0.12) / 0.1, 0), 1)), 1)
    }

    private func plant() {
        guard level != .off, clock == .live else { return }
        if reduceMotion {
            pole = 1; unfurl = 1; pennant = 1
            withAnimation(Motion.fade) { shown = 1 }
            return
        }
        shown = 1
        withAnimation(Motion.fade) { pole = 1 }
        withAnimation(Motion.pop.delay(0.12)) { unfurl = 1 }
        withAnimation(Motion.fade.delay(0.12)) { pennant = 1 }
    }

    private func leave() {
        withAnimation(Motion.exit) {
            shown = 0
        } completion: {
            // Furled again, so the next plant plays from the start.
            pole = 0; unfurl = 0.2; pennant = 0
        }
    }
}

/// A rank change (§2.12): ▲2 in green, ▼1 in red. Bring it in with
/// `Motion.badgeTransition`; take it out with `Motion.exit`.
struct DeltaChip: View {
    let delta: Int

    var body: some View {
        HStack(spacing: 1) {
            Image(systemName: delta > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                .font(.system(size: 6, weight: .bold))
            Text("\(abs(delta))").font(Viz.tick)
        }
        .foregroundStyle(delta > 0 ? Color.green : Color.red)
        .help(label)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var label: String { delta > 0 ? "Up \(delta)" : "Down \(-delta)" }
}

/// On fire (§2.14). Static: a looping flame would be the one continuous
/// animation on the page. In with `.transition(.symbolEffect(.appear))`.
struct StreakFlame: View {
    var size: CGFloat = 8
    var help = "3 straight makes"

    var body: some View {
        Image(systemName: "flame.fill")
            .font(.system(size: size))
            .foregroundStyle(Celebrate.ember)
            .help(help)
            .accessibilityLabel(help)
    }
}

/// A heightened state (§2.16): CLUTCH, 2-MIN DRILL, MAP POINT, BASES LOADED.
/// Orange means pressure (RED ZONE stays red). Information, so it shows at
/// every level. In with `Motion.badgeTransition`, out with `Motion.exit`.
struct StateChip: View {
    let text: String
    var color: Color = Celebrate.ember

    var body: some View {
        Text(text)
            .font(.system(size: 9, weight: .bold)).tracking(0.4)
            .foregroundStyle(.white)
            .padding(.horizontal, 5).padding(.vertical, 1.5)
            .background(Capsule().fill(color))
            .fixedSize()
    }
}

/// A stylized shot arc between two real points (not tracking data): a quad
/// curve from the spot to the rim, bowed toward screen-up by 0.22 × its length
/// (at most 40 pt). The ball rides `point(at:)` with the path's trim.
struct FlightArc {
    let from: CGPoint
    let to: CGPoint

    var control: CGPoint {
        let bow = min(0.22 * hypot(to.x - from.x, to.y - from.y), 40)
        return CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - bow)
    }

    func point(at s: Double) -> CGPoint {
        let c = control, u = 1 - s
        return CGPoint(x: u * u * from.x + 2 * u * s * c.x + s * s * to.x,
                       y: u * u * from.y + 2 * u * s * c.y + s * s * to.y)
    }

    var path: Path {
        Path { path in
            path.move(to: from)
            path.addQuadCurve(to: to, control: control)
        }
    }
}

// MARK: - Sound

/// Opt-in sounds for the open match page (§5.2): off by default, never with
/// Celebrations off, at most one every 8 s.
@MainActor
enum CelebrationSound {
    /// The UserDefaults key for Settings' "Sounds" toggle (default off).
    nonisolated static let defaultsKey = "celebrationSounds"
    private static var last: ContinuousClock.Instant?

    /// What would play: a soft pop for a score, glass for a decisive one,
    /// nothing below score tier.
    static func sound(for m: LiveMoment) -> (name: String, volume: Float)? {
        guard m.tier == .score else { return nil }
        return m.decisive ? ("Glass", 0.30) : ("Pop", 0.25)
    }

    static var enabled: Bool {
        UserDefaults.standard.bool(forKey: defaultsKey) && CelebrationLevel.saved != .off
    }

    static func play(for m: LiveMoment) {
        guard enabled, let choice = sound(for: m) else { return }
        let now = ContinuousClock.now
        if let last, now - last < .seconds(8) { return }
        guard let sound = NSSound(named: choice.name) else { return }
        sound.volume = choice.volume
        sound.play()
        last = now
    }
}

// MARK: - Settings row

/// Settings, Live Games: "Celebrations  [Full | Subtle | Off]", laid out like `ToggleRow`.
struct CelebrationLevelRow: View {
    @Binding var level: CelebrationLevel

    var body: some View {
        // The picker takes the trailing edge of the title line; the subtitle
        // runs full width under it (beside a three-way picker it wrapped to three lines).
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 8) {
                Text("Celebrations").font(.system(size: 13))
                Spacer(minLength: 8)
                Picker("Celebrations", selection: $level) {
                    ForEach(CelebrationLevel.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
                .fixedSize()
            }
            Text("Confetti, swishes and knocks when big plays happen")
                .font(.system(size: 11)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }
}

// MARK: - Gallery

#if DEBUG
/// Every primitive on a dummy well, for the render harness (scratchpad/celebrate).
/// The harness sets `\.celebrationClock` to `.frozen(t)`, and the level and
/// Reduce Motion, per cell.
struct CelebrationGallery: View {
    enum Scene: String, CaseIterable {
        case touchdown, touchdownDecisive, fieldGoal, goal, goalPale, save, summit, homeRun, grandSlam, walkOff,
             swish, three, onFire, andOne, dunk, buzzer, flash, safety
        case knock, pop, wash, flag, glint, sweep, chips

        var isStage: Bool { Self.marks.firstIndex(of: self) == nil }
        static let marks: [Scene] = [.knock, .pop, .wash, .flag, .glint, .sweep, .chips]
    }

    let scene: Scene
    /// The same chart with no moment and no triggers: what "no celebration" looks like.
    var bare = false
    @Environment(\.colorScheme) private var scheme

    private var trigger: Int { bare ? 0 : 1 }
    private var palette: TeamPalette { TeamPalette(top: "c8102e", bottom: "132257", scheme: scheme) }

    /// When this scene has fully settled at every level and with Reduce
    /// Motion (the harness's "end" frame).
    var end: Double {
        if let stage { return stage.longest + 0.1 }
        switch scene {
        case .knock: return 0.44
        case .pop: return 3.1
        case .wash: return 1.8
        case .glint: return 1.1
        case .sweep: return 0.32
        default: return 1.5
        }
    }

    var body: some View {
        if let stage {
            Self.well(stage, bare: bare)
        } else {
            mark.frame(width: 312, height: 92).vizWell(padding: 0)
        }
    }

    // MARK: Stage scenes

    struct Stage {
        var size: CGSize
        var origin: CGPoint
        var moment: LiveMoment
        var colors: CelebrationColors
        var direction: Angle = .degrees(-90)
        var effects: [CelebrationCue.Effect]? = nil
        var backdrop: Backdrop
        var inset: CGFloat = 10
        var cue: CelebrationCue? { cue(.full, reduceMotion: false) }
        /// The longest this scene plays, across levels and Reduce Motion.
        var longest: Double {
            [cue(.full, reduceMotion: false), cue(.subtle, reduceMotion: false), cue(.full, reduceMotion: true)]
                .compactMap { $0?.duration }.max() ?? 0
        }
        func cue(_ level: CelebrationLevel, reduceMotion: Bool) -> CelebrationCue? {
            Celebration.cue(for: moment, level: level, reduceMotion: reduceMotion, geometry: .init(height: size.height),
                            direction: direction, effects: effects)
        }
    }

    enum Backdrop { case field, pitch, spray, court, wall, cell }

    private func moment(_ id: String, _ chart: LiveMoment.Chart, _ tier: LiveMoment.Tier, _ kind: LiveMoment.Kind,
                        _ accents: LiveMoment.Accents = []) -> LiveMoment {
        var m = LiveMoment(id: id, chart: chart, tier: tier, kind: kind, lead: "", detail: "", side: .top)
        m.accents = accents
        m.burst = true
        return m
    }

    var stage: Stage? {
        let field = CGSize(width: 296, height: 64), pitch = CGSize(width: 292, height: 189)
        let court = CGSize(width: 292, height: 155), spray = CGSize(width: 292, height: 196)
        let ascent = CGSize(width: 292, height: 250)
        let red = CelebrationColors.team(palette.top)
        let rim = CGPoint(x: court.width - court.width * 5.25 / 94, y: court.height / 2)
        switch scene {
        case .touchdown:
            return Stage(size: field, origin: CGPoint(x: field.width * 0.96, y: field.height / 2),
                         moment: moment("td", .field, .score, .touchdown), colors: red, direction: .degrees(-150), backdrop: .field, inset: 8)
        case .touchdownDecisive:
            return Stage(size: field, origin: CGPoint(x: field.width * 0.96, y: field.height / 2),
                         moment: moment("td-ot", .field, .score, .touchdown, .decisive), colors: red, direction: .degrees(-150),
                         backdrop: .field, inset: 8)
        case .fieldGoal:
            return Stage(size: field, origin: CGPoint(x: field.width, y: field.height / 2),
                         moment: moment("fg", .field, .score, .fieldGoal), colors: red, backdrop: .field, inset: 8)
        case .goal:
            return Stage(size: pitch, origin: CGPoint(x: pitch.width - 2, y: pitch.height / 2),
                         moment: moment("goal", .pitch, .score, .goal), colors: red, direction: .degrees(-150), backdrop: .pitch)
        case .goalPale:
            let pale = TeamPalette(top: "fff200", bottom: "000000", scheme: scheme)
            return Stage(size: pitch, origin: CGPoint(x: 2, y: pitch.height / 2),
                         moment: moment("goal-navi", .pitch, .score, .goal), colors: .team(pale.top), direction: .degrees(-30), backdrop: .pitch)
        case .save:
            return Stage(size: pitch, origin: CGPoint(x: pitch.width - 4, y: pitch.height * 0.46),
                         moment: moment("save", .pitch, .swing, .shotSaved), colors: red, backdrop: .pitch)
        case .summit:
            return Stage(size: ascent, origin: CGPoint(x: ascent.width * 0.42, y: 16),
                         moment: moment("top", .ascent, .score, .top), colors: .flag("SLO"), backdrop: .wall)
        case .homeRun:
            return Stage(size: spray, origin: CGPoint(x: spray.width * 0.80, y: spray.height * 0.30),
                         moment: moment("hr", .plate, .score, .homeRun), colors: red, backdrop: .spray)
        case .grandSlam:
            return Stage(size: spray, origin: CGPoint(x: spray.width * 0.80, y: spray.height * 0.30),
                         moment: moment("slam", .plate, .score, .homeRun, .grandSlam), colors: red, backdrop: .spray)
        case .walkOff:
            return Stage(size: spray, origin: CGPoint(x: spray.width * 0.22, y: spray.height * 0.28),
                         moment: moment("walkoff", .plate, .score, .homeRun, .decisive), colors: red, backdrop: .spray)
        case .swish:
            return Stage(size: court, origin: rim, moment: moment("two", .court, .routine, .made(value: 2)), colors: red, backdrop: .court)
        case .three:
            return Stage(size: court, origin: rim, moment: moment("three", .court, .swing, .made(value: 3)), colors: red, backdrop: .court)
        case .onFire:
            return Stage(size: court, origin: rim, moment: moment("fire", .court, .swing, .made(value: 2), .onFire), colors: red, backdrop: .court)
        case .andOne:
            return Stage(size: court, origin: rim, moment: moment("and1", .court, .swing, .made(value: 2), .andOne), colors: red, backdrop: .court)
        case .dunk:
            return Stage(size: court, origin: rim, moment: moment("dunk", .court, .swing, .made(value: 2), .dunk), colors: red, backdrop: .court)
        case .buzzer:
            return Stage(size: court, origin: rim, moment: moment("buzzer", .court, .score, .made(value: 3), [.buzzer, .decisive]),
                         colors: red, backdrop: .court)
        case .flash:
            return Stage(size: CGSize(width: 120, height: 60), origin: CGPoint(x: 60, y: 30),
                         moment: moment("flash", .boulder, .swing, .top, .flash), colors: .accent, backdrop: .cell)
        case .safety:
            return Stage(size: field, origin: CGPoint(x: field.width * 0.04, y: field.height / 2),
                         moment: moment("safety", .field, .score, .safety), colors: .team(palette.bottom), backdrop: .field, inset: 8)
        default:
            return nil
        }
    }

    private static func well(_ s: Stage, bare: Bool) -> some View {
        Canvas { context, size in backdrop(s.backdrop, context, size) }
            .frame(width: s.size.width, height: s.size.height)
            .compositingGroup()
            .overlay(alignment: .topLeading) {
                CelebrationStage(moment: bare ? nil : s.moment, origin: s.origin, size: s.size, colors: s.colors,
                                 direction: s.direction, wellInset: s.inset, effects: s.effects)
            }
            .vizWell(padding: s.inset)
    }

    /// Faint stand-ins for each chart's markings, for judging contrast.
    private static func backdrop(_ kind: Backdrop, _ context: GraphicsContext, _ size: CGSize) {
        let w = size.width, h = size.height
        func line(_ a: CGPoint, _ b: CGPoint, _ color: Color = Viz.markings, _ width: CGFloat = 1) {
            var p = Path(); p.move(to: a); p.addLine(to: b)
            context.stroke(p, with: .color(color), lineWidth: width)
        }
        switch kind {
        case .field:
            let ez = w * 0.08
            context.fill(Path(CGRect(x: 0, y: 0, width: ez, height: h)), with: .color(.blue.opacity(0.12)))
            context.fill(Path(CGRect(x: w - ez, y: 0, width: ez, height: h)), with: .color(.red.opacity(0.18)))
            for i in 0...10 { let x = ez + (w - 2 * ez) * Double(i) / 10; line(CGPoint(x: x, y: 0), CGPoint(x: x, y: h)) }
            context.fill(Path(roundedRect: CGRect(x: ez + 30, y: h / 2 - 3, width: w * 0.6, height: 6), cornerRadius: 3), with: .color(.red.opacity(0.7)))
        case .pitch:
            context.stroke(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(Viz.markings))
            line(CGPoint(x: w / 2, y: 0), CGPoint(x: w / 2, y: h))
            context.stroke(Path(ellipseIn: CGRect(x: w / 2 - 25, y: h / 2 - 25, width: 50, height: 50)), with: .color(Viz.markings))
            context.stroke(Path(CGRect(x: w - 45, y: h * 0.2, width: 45, height: h * 0.6)), with: .color(Viz.markings))
            context.stroke(Path(CGRect(x: 0, y: h * 0.2, width: 45, height: h * 0.6)), with: .color(Viz.markings))
            for (x, y) in [(0.62, 0.3), (0.7, 0.55), (0.8, 0.42), (0.9, 0.5)] {
                context.fill(Path(ellipseIn: CGRect(x: w * x - 2.5, y: h * y - 2.5, width: 5, height: 5)), with: .color(.red.opacity(0.8)))
            }
            var path = Path(); path.move(to: CGPoint(x: w * 0.82, y: h * 0.6)); path.addLine(to: CGPoint(x: w, y: h / 2))
            context.stroke(path, with: .color(.red), lineWidth: 2)
        case .spray:
            var fence = Path()
            fence.addArc(center: CGPoint(x: w / 2, y: h * 0.95), radius: h * 0.78, startAngle: .degrees(-150), endAngle: .degrees(-30), clockwise: false)
            context.stroke(fence, with: .color(Viz.reference), lineWidth: 1)
            line(CGPoint(x: w / 2, y: h * 0.95), CGPoint(x: w / 2 - h * 0.68, y: h * 0.56))
            line(CGPoint(x: w / 2, y: h * 0.95), CGPoint(x: w / 2 + h * 0.68, y: h * 0.56))
            for (x, y) in [(0.4, 0.6), (0.55, 0.7), (0.62, 0.5), (0.35, 0.75)] {
                context.fill(Path(ellipseIn: CGRect(x: w * x - 2.5, y: h * y - 2.5, width: 5, height: 5)), with: .color(Viz.neutral))
            }
        case .court:
            context.stroke(Path(CGRect(x: 0, y: 0, width: w, height: h)), with: .color(Viz.markings))
            line(CGPoint(x: w / 2, y: 0), CGPoint(x: w / 2, y: h))
            context.stroke(Path(ellipseIn: CGRect(x: w / 2 - 19, y: h / 2 - 19, width: 38, height: 38)), with: .color(Viz.markings))
            var arc = Path()
            arc.addArc(center: CGPoint(x: w - w * 5.25 / 94, y: h / 2), radius: w * 23.75 / 94, startAngle: .degrees(90), endAngle: .degrees(270), clockwise: false)
            context.stroke(arc, with: .color(Viz.markings))
            context.stroke(Path(CGRect(x: w - w * 19 / 94, y: h / 2 - h * 8 / 50, width: w * 19 / 94, height: h * 16 / 50)), with: .color(Viz.markings))
            for (x, y) in [(0.7, 0.3), (0.76, 0.62), (0.84, 0.4), (0.66, 0.55), (0.9, 0.7)] {
                context.fill(Path(ellipseIn: CGRect(x: w * x - 2.75, y: h * y - 2.75, width: 5.5, height: 5.5)), with: .color(.red.opacity(0.85)))
            }
            var flight = Path(); flight.move(to: CGPoint(x: w * 0.72, y: h * 0.25))
            flight.addQuadCurve(to: CGPoint(x: w - w * 5.25 / 94, y: h / 2), control: CGPoint(x: w * 0.84, y: h * 0.12))
            context.stroke(flight, with: .color(.red.opacity(0.45)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
        case .wall:
            line(CGPoint(x: 0, y: 16), CGPoint(x: w, y: 16), Viz.reference)
            context.fill(Path(roundedRect: CGRect(x: w * 0.42 - 2, y: 16, width: 4, height: h - 16), cornerRadius: 2), with: .color(Viz.track))
            context.fill(Path(roundedRect: CGRect(x: w * 0.42 - 2, y: 16, width: 4, height: h - 16), cornerRadius: 2), with: .color(.blue.opacity(0.6)))
            for i in 0..<5 {
                let y = 40 + Double(i) * 38
                context.fill(Path(roundedRect: CGRect(x: w * 0.42 + 8, y: y - 6, width: 70, height: 12), cornerRadius: 6), with: .color(Color.primary.opacity(0.08)))
            }
        case .cell:
            context.fill(Path(roundedRect: CGRect(x: w / 2 - 7, y: h / 2 - 13, width: 14, height: 12), cornerRadius: 2), with: .color(Color.accentColor))
            context.fill(Path(roundedRect: CGRect(x: w / 2 - 7, y: h / 2 + 1, width: 14, height: 12), cornerRadius: 2), with: .color(Color.accentColor))
        }
    }

    // MARK: Mark scenes

    @ViewBuilder private var mark: some View {
        switch scene {
        case .knock:
            HStack(spacing: 24) {
                climber("Mori 38+").knock(trigger, amplitude: 3, dip: 2)
                climber("Garnbret 39").opacity(1)
            }
        case .pop:
            HStack(spacing: 10) {
                Text("88").font(.system(size: 28, weight: .semibold).monospacedDigit())
                    .scorePop(trigger).scorePill(trigger, color: palette.top)
                Text("–").font(.system(size: 20)).foregroundStyle(.secondary)
                Text("84").font(.system(size: 28, weight: .semibold).monospacedDigit())
            }
        case .wash:
            WashPulse(trigger: trigger) { b in
                LinearGradient(colors: [palette.top.opacity(0.45 * (1 + 0.35 * b)), palette.top.opacity(0.12),
                                        palette.bottom.opacity(0.12), palette.bottom.opacity(0.45)],
                               startPoint: .leading, endPoint: .trailing)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        case .flag:
            ZStack {
                Rectangle().fill(Viz.reference).frame(height: 1).offset(y: 14)
                SummitFlag(flag: "🇸🇮", planted: !bare).offset(y: 14)
            }
        case .glint:
            Text("NAVI win the series")
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 260, height: 64)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.primary.opacity(0.07)))
                .glint(trigger, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        case .sweep:
            HStack(spacing: 4) {
                ForEach(0..<4) { i in
                    VStack(spacing: 2) {
                        RoundedRectangle(cornerRadius: 2).fill(Viz.track).frame(width: 18, height: 11)
                            .overlay {
                                // Only the boulder just topped sweeps; the others were already filled.
                                if i < 2 || (i == 2 && bare) {
                                    RoundedRectangle(cornerRadius: 2).fill(Color.accentColor)
                                } else {
                                    RoundedRectangle(cornerRadius: 2).fill(Color.accentColor).fillSweep(i == 2)
                                }
                            }
                        RoundedRectangle(cornerRadius: 2).fill(Color.accentColor).frame(width: 18, height: 11)
                    }
                }
            }
        default:
            HStack(spacing: 14) {
                DeltaChip(delta: 2)
                DeltaChip(delta: -1)
                StreakFlame()
                StateChip(text: "CLUTCH")
                StateChip(text: "RED ZONE", color: .red)
            }
        }
    }

    private func climber(_ label: String) -> some View {
        HStack(spacing: 4) {
            Capsule().fill(Color.primary.opacity(0.8)).frame(width: 14, height: 3)
            Text(label).font(Viz.value)
        }
    }
}
#endif
