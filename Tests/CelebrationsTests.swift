import AppKit
import SwiftUI

// Celebrations: the cue table (every kind × tier × relevant accent), the
// §2.17 substitutions, deterministic closed-form particles within budget,
// the mark keyframes, MomentCenter's decisive tie-break and burst cooldown,
// and an end state that is pixel-identical to no celebration.

extension ScorelineTests {
    static func celebrations() {
        print("\nCelebrations")
        typealias Effect = CelebrationCue.Effect

        func moment(_ id: String, _ chart: LiveMoment.Chart, _ tier: LiveMoment.Tier, _ kind: LiveMoment.Kind,
                    _ accents: LiveMoment.Accents = [], burst: Bool = true) -> LiveMoment {
            var m = LiveMoment(id: id, chart: chart, tier: tier, kind: kind, lead: "", detail: "", side: .top)
            m.accents = accents
            m.burst = burst
            return m
        }
        func cue(_ m: LiveMoment, _ level: CelebrationLevel = .full, reduceMotion: Bool = false,
                 geometry: CelebrationCue.Preset = .medium, direction: Angle = .degrees(-90),
                 effects: [Effect]? = nil) -> CelebrationCue? {
            Celebration.cue(for: m, level: level, reduceMotion: reduceMotion, geometry: geometry, direction: direction, effects: effects)
        }
        func effects(_ m: LiveMoment, _ level: CelebrationLevel = .full, reduceMotion: Bool = false) -> [Effect] {
            cue(m, level, reduceMotion: reduceMotion)?.effects ?? []
        }
        let up = Angle.degrees(-90)

        // MARK: Seeds and presets

        check(Celebration.seed("") == 0xcbf2_9ce4_8422_2325 && Celebration.seed("a") == 0xaf63_dc4c_8601_ec8c
              && Celebration.seed("foobar") == 0x8594_4171_f739_67e8, "seed is FNV-1a 64 (stable across launches)")
        check(CelebrationCue.Preset(height: 99) == .short && CelebrationCue.Preset(height: 100) == .medium
              && CelebrationCue.Preset(height: 199) == .medium && CelebrationCue.Preset(height: 200) == .tall,
              "confetti preset by stage height: < 100 short, ≥ 200 tall")
        check(EnvironmentValues().celebrationLevel == .full && EnvironmentValues().celebrationClock == .live,
              "environment defaults: Full, live clock")

        // MARK: The cue table (§8.4), at Full with a burst allowed

        let confetti55 = Effect.confetti(direction: up, spread: .degrees(55), preset: .medium)
        let table: [(String, LiveMoment, [Effect], Double)] = [
            ("touchdown → confetti ±55° after the ball lands", moment("td", .field, .score, .touchdown), [confetti55], 0.40),
            ("field goal → sparks (6, 16)", moment("fg", .field, .score, .fieldGoal), [.sparks(rays: 6, length: 16)], 0.40),
            ("safety → bloom (score)", moment("sf", .field, .score, .safety), [.bloom(radius: 22)], 0.35),
            ("big play → sparks (4, 9)", moment("bp", .field, .swing, .rush, .bigPlay), [.sparks(rays: 4, length: 9)], 0.30),
            ("goal → confetti ±55°", moment("g", .pitch, .score, .goal), [confetti55], 0.40),
            ("save → sparks (4, 9)", moment("sv", .pitch, .swing, .shotSaved), [.sparks(rays: 4, length: 9)], 0.35),
            ("woodwork → sparks (4, 9)", moment("ww", .pitch, .swing, .shotWide, .woodwork), [.sparks(rays: 4, length: 9)], 0.35),
            ("home run → 1 shell", moment("hr", .plate, .score, .homeRun), [.fireworks(shells: 1)], 0.35),
            ("grand slam → 2 shells", moment("gs", .plate, .score, .homeRun, .grandSlam), [.fireworks(shells: 2)], 0.35),
            ("walk-off → 3 shells", moment("wo", .plate, .score, .homeRun, [.grandSlam, .decisive]), [.fireworks(shells: 3)], 0.35),
            ("run scored → sparks (6, 13)", moment("rs", .plate, .score, .runScored), [.sparks(rays: 6, length: 13)], 0),
            ("made 2 → swish", moment("m2", .court, .routine, .made(value: 2)), [.swish(echo: false)], 0),
            ("made 3 → swish + sparks (6, 13)", moment("m3", .court, .swing, .made(value: 3)),
             [.swish(echo: false), .sparks(rays: 6, length: 13)], 0),
            ("clutch 2 → swish + sparks (4)", moment("c2", .court, .swing, .made(value: 2), .clutch),
             [.swish(echo: false), .sparks(rays: 4, length: 13)], 0),
            ("on fire → swish + embers", moment("of", .court, .swing, .made(value: 2), .onFire), [.swish(echo: false), .embers], 0),
            ("and-one → swish with the echo", moment("a1", .court, .swing, .made(value: 2), .andOne), [.swish(echo: true)], 0),
            ("dunk → rim pulse", moment("dk", .court, .swing, .made(value: 2), .dunk), [.rimPulse], 0),
            ("buzzer → swish + confetti ±60°", moment("bz", .court, .score, .made(value: 2), .buzzer),
             [.swish(echo: false), .confetti(direction: up, spread: .degrees(60), preset: .medium)], 0),
            ("lead change → sparks (4, 9)", moment("lc", .court, .swing, .leadChange), [.sparks(rays: 4, length: 9)], 0),
            ("new leader → sparks (6, 13) at the dot", moment("nl", .ascent, .score, .passed, .newLeader), [.sparks(rays: 6, length: 13)], 0.30),
            ("lead top → confetti ±80° after the flag", moment("tp", .ascent, .score, .top),
             [.confetti(direction: up, spread: .degrees(80), preset: .medium)], 0.25),
            ("wall top → sparks (6, 9), no confetti", moment("wt", .wall, .swing, .top), [.sparks(rays: 6, length: 9)], 0),
            ("boulder top → sparks clear of the cell", moment("bt", .boulder, .swing, .top), [.sparks(rays: 6, length: 9, base: 14)], 0),
            ("boulder flash → sparks (8, 11)", moment("bf", .boulder, .swing, .top, .flash), [.sparks(rays: 8, length: 11, base: 14)], 0),
        ]
        var wrong: [String] = []
        for (name, m, expected, delay) in table {
            let c = cue(m)
            if c?.effects != expected || c?.delay != delay { wrong.append("\(name): \(c.map { "\($0.effects) +\($0.delay)" } ?? "nil")") }
        }
        check(wrong.isEmpty, "cue table: \(table.count) rows map as specified", wrong.joined(separator: "; "))

        let quiet: [(LiveMoment.Chart, LiveMoment.Kind)] = [
            (.field, .turnover), (.field, .fieldGoalMissed), (.field, .sack), (.field, .passComplete), (.field, .rush),
            (.field, .passIncomplete), (.field, .penalty), (.pitch, .shotBlocked), (.pitch, .shotWide), (.pitch, .card(red: true)),
            (.plate, .hit), (.plate, .outInPlay), (.plate, .strikeout), (.plate, .walk), (.plate, .doublePlay),
            (.rounds, .roundWon), (.rounds, .mapWon), (.ascent, .passed), (.ascent, .finished), (.boulder, .zone),
            (.court, .missed), (.court, .block), (.court, .steal), (.court, .periodEnd),
        ]
        check(quiet.allSatisfy { cue(moment("q", $0.0, .swing, $0.1)) == nil },
              "marks-only moments draw no stage (turnover, sack, miss, block, steal, rounds, cards, double play…)")
        check(cue(moment("fg-d", .field, .score, .fieldGoal, .decisive))?.effects == [.sparks(rays: 6, length: 16), confetti55]
              && cue(moment("fg-d", .field, .score, .fieldGoal, .decisive))?.gold == true,
              "decisive score without a burst gains confetti and gold (go-ahead field goal)")
        check(cue(moment("rs-d", .plate, .score, .runScored, .decisive))?.effects == [.sparks(rays: 6, length: 13)]
              && cue(moment("map-d", .rounds, .score, .mapWon, .decisive)) == nil,
              "…but never on a chart without a well (diamond, rounds)")
        check(cue(moment("flash", .boulder, .swing, .top, .flash))?.gold == true && cue(moment("top", .boulder, .swing, .top))?.gold == false,
              "a boulder flash is gold")
        check(cue(moment("sv", .pitch, .swing, .shotSaved))?.glint == true, "a save's rays are a neutral glint, not the shooter's color")
        check(Celebration.wantsBurst(moment("g", .pitch, .score, .goal)) && Celebration.wantsBurst(moment("hr", .plate, .score, .homeRun))
              && !Celebration.wantsBurst(moment("m3", .court, .swing, .made(value: 3))) && Celebration.wantsBurst(moment("fg", .field, .score, .fieldGoal, .decisive)),
              "only confetti and fireworks count as particle bursts")

        // MARK: Substitutions (§2.17)

        let goal = moment("g", .pitch, .score, .goal)
        check(effects(goal, .subtle) == [.sparks(rays: 8, length: 13)], "Subtle: confetti becomes sparks (8)")
        check(effects(moment("hr", .plate, .score, .homeRun), .subtle) == [.sparks(rays: 8, length: 13)], "Subtle: fireworks become sparks (8)")
        let subtleThree = cue(moment("m3", .court, .swing, .made(value: 3)), .subtle)
        check(subtleThree?.effects == [.swish(echo: false), .sparks(rays: 4, length: 13)] && subtleThree?.subtle == true,
              "Subtle: one ripple ring, sparks (4)")
        check(effects(moment("of", .court, .swing, .made(value: 2), .onFire), .subtle) == [.swish(echo: false)], "Subtle: no embers")
        check(effects(goal, reduceMotion: true) == [.bloom(radius: 22)] && cue(goal, reduceMotion: true)?.delay == 0.40,
              "Reduce Motion: a score becomes one bloom (22), when the data lands")
        check(effects(moment("m3", .court, .swing, .made(value: 3)), reduceMotion: true) == [.bloom(radius: 14)]
              && effects(moment("bz", .court, .score, .made(value: 3), .buzzer), reduceMotion: true) == [.bloom(radius: 22)],
              "Reduce Motion: swing accents bloom at 14, bursts at 22")
        check(effects(moment("g", .pitch, .score, .goal, burst: false)) == [.sparks(rays: 8, length: 13)],
              "inside the cooldown, confetti becomes sparks")
        check(cue(goal, .off) == nil && cue(moment("m2", .court, .routine, .made(value: 2)), .off) == nil, "Off: no stage at all")
        check(cue(moment("a1", .court, .swing, .made(value: 2), .andOne), effects: [.echo])?.effects == [.echo]
              && cue(moment("a1", .court, .swing, .made(value: 2), .andOne), reduceMotion: true, effects: [.echo])?.effects == [.bloom(radius: 14)],
              "an override (the and-one echo alone) goes through the same filters")

        // MARK: Every kind × tier × accent: filters, budget, determinism

        let kinds: [(LiveMoment.Chart, LiveMoment.Kind)] = [
            (.field, .touchdown), (.field, .fieldGoal), (.field, .fieldGoalMissed), (.field, .turnover), (.field, .safety),
            (.field, .sack), (.field, .passComplete), (.field, .passIncomplete), (.field, .rush), (.field, .penalty),
            (.pitch, .goal), (.pitch, .shotSaved), (.pitch, .shotBlocked), (.pitch, .shotWide), (.pitch, .card(red: true)),
            (.pitch, .card(red: false)), (.spray, .homeRun), (.plate, .homeRun), (.plate, .runScored), (.plate, .hit),
            (.plate, .outInPlay), (.plate, .strikeout), (.plate, .walk), (.plate, .doublePlay), (.rounds, .mapWon),
            (.rounds, .roundWon), (.ascent, .top), (.wall, .top), (.boulder, .top), (.ascent, .passed), (.ascent, .finished),
            (.boulder, .zone), (.court, .made(value: 2)), (.court, .made(value: 3)), (.court, .missed), (.court, .run),
            (.court, .leadChange), (.court, .periodEnd), (.court, .block), (.court, .steal),
        ]
        let accentSets: [LiveMoment.Accents] = [[], .decisive, .bigPlay, .woodwork, .grandSlam, .dunk, .andOne, .buzzer,
                                                .onFire, .clutch, .flash, .newLeader, [.buzzer, .decisive],
                                                [.dunk, .onFire, .clutch], [.andOne, .onFire, .clutch, .buzzer, .decisive]]
        let presets: [CelebrationCue.Preset] = [.short, .medium, .tall]
        var cues = 0, overCap: [String] = [], lingering: [String] = [], unstable: [String] = [], filters: [String] = []
        var overBudget: [String] = [], fromNothing: [String] = []
        for (chart, kind) in kinds {
            for tier in [LiveMoment.Tier.routine, .swing, .score] {
                for accents in accentSets {
                    let m = moment("\(chart)-\(kind)-\(tier)-\(accents.rawValue)", chart, tier, kind, accents)
                    let label = "\(kind) \(tier) \(accents.rawValue)"
                    if cue(m, .off) != nil { filters.append("off \(label)") }
                    if let rm = cue(m, reduceMotion: true), rm.effects.count != 1 || !rm.effects.allSatisfy({ if case .bloom = $0 { true } else { false } }) {
                        filters.append("rm \(label)")
                    }
                    if let subtle = cue(m, .subtle), subtle.effects.contains(where: { $0.isBurst || $0 == .embers }) { filters.append("subtle \(label)") }
                    var cool = m
                    cool.burst = false
                    if let c = cue(cool), c.bursts { filters.append("cooldown \(label)") }
                    for geometry in presets {
                        guard let c = cue(m, geometry: geometry) else { continue }
                        cues += 1
                        for effect in c.effects where c.length(of: effect) > (c.gold ? 1.5 : 1.3) + 1e-9 {
                            overBudget.append("\(label) \(effect) \(c.length(of: effect))")
                        }
                        let origin = CGPoint(x: 150, y: 90)
                        var t = 0.0
                        while t <= c.duration {
                            let parts = Celebration.particles(c, origin: origin, t: t)
                            if parts.count > Celebrate.particleCap { overCap.append("\(label) \(parts.count) at \(t)") }
                            for p in parts {
                                if case let .piece(size, _) = p.shape, size.height < 1.8 - 1e-9 { fromNothing.append(label) }
                            }
                            t += 0.05
                        }
                        if !Celebration.particles(c, origin: origin, t: c.duration + 0.001).isEmpty { lingering.append(label) }
                        let mid = c.delay + 0.3
                        if Celebration.particles(c, origin: origin, t: mid) != Celebration.particles(c, origin: origin, t: mid) {
                            unstable.append(label)
                        }
                    }
                }
            }
        }
        check(filters.isEmpty, "every kind × tier × accent: Off draws nothing, Reduce Motion one bloom, Subtle and the cooldown no bursts",
              filters.prefix(5).joined(separator: "; "))
        check(overCap.isEmpty, "never more than 36 particles in a frame (\(cues) cues sampled every 50 ms)", overCap.prefix(3).joined(separator: "; "))
        check(overBudget.isEmpty, "every primitive lasts ≤ 1.3 s (≤ 1.5 s decisive)", overBudget.prefix(3).joined(separator: "; "))
        check(lingering.isEmpty, "nothing is drawn after a cue's duration", lingering.prefix(3).joined(separator: "; "))
        check(unstable.isEmpty, "particles are a pure function of (seed, t)", unstable.prefix(3).joined(separator: "; "))
        check(fromNothing.isEmpty, "confetti is born at 60% of its size, never from nothing",
              fromNothing.prefix(3).joined(separator: "; "))

        // MARK: Particles

        let td = cue(moment("td-1", .field, .score, .touchdown), geometry: .short, direction: .degrees(-150))!
        let a = Celebration.particles(td, origin: CGPoint(x: 280, y: 32), t: 0.8)
        var other = td
        other.seed = Celebration.seed("td-2")
        check(!a.isEmpty && a != Celebration.particles(other, origin: CGPoint(x: 280, y: 32), t: 0.8),
              "different moments draw different bursts")
        let decisive = cue(moment("bz-d", .court, .score, .made(value: 3), [.buzzer, .decisive]))!
        let pieces = Celebration.particles(decisive, origin: CGPoint(x: 150, y: 90), t: 0.40 + 0.25)
            .filter { if case .piece = $0.shape { true } else { false } }
        check(pieces.count == 27, "decisive buzzer: confetti ×1.5 within the cap beside the swish and sparks (27)", "\(pieces.count)")
        let walkOff = cue(moment("wo", .spray, .score, .homeRun, .decisive))!
        check(walkOff.duration <= 0.35 + 1.5 && Celebration.particles(walkOff, origin: .zero, t: 0.35 + 0.5).count <= 36,
              "walk-off: three shells within the cap and 1.5 s")
        // Straight up, medium: the apex lands where the spec puts it (25–35 pt at about 0.3 s, retuned).
        let column = CelebrationCue(effects: [.confetti(direction: up, spread: .degrees(0), preset: .medium)], seed: 7)
        var apex = (y: 0.0, t: 0.0)
        for step in 0..<100 {
            let t = Double(step) * 0.01
            for p in Celebration.particles(column, origin: .zero, t: t) where p.center.y < apex.y { apex = (p.center.y, t) }
        }
        check(apex.y < -22 && apex.y > -48 && (0.25...0.6).contains(apex.t), "medium confetti peaks 22–48 pt up (±25% speed) at 0.25–0.6 s",
              "\(apex)")
        let rim = Celebration.particles(cue(moment("dk", .court, .swing, .made(value: 2), .dunk))!, origin: CGPoint(x: 10, y: 10), t: 0.05)
        check(rim.contains { if case .ball = $0.shape { $0.center.y < 10 } else { false } }, "dunk: the ball drops onto the rim from above")

        // MARK: Colors

        check(CelebrationColors.team(Viz.neutral).palette == .tinted(.accentColor), "a team with no usable color celebrates in the accent")
        check(CelebrationColors.flag("SLO").palette == CelebrationPalette(primary: Color(hex: "005DA4")!, tint: Color(hex: "ED1C24")!),
              "a flag gives its two colors")
        check(CelebrationColors.flag("JPN").palette == .tinted(Color(hex: "BC002D")!) && CelebrationColors.flag(nil).palette == .tinted(.accentColor),
              "a one-color flag tints itself; no flag takes the accent")

        // MARK: Mark keyframes

        let knock = KeyframeTimeline(initialValue: KnockValue()) { Celebrate.knock(Celebrate.knockSteps(amplitude: 3, outward: -1), dip: 2) }
        check(abs(knock.value(time: 0.05).x + 3) < 0.01 && knock.value(time: 0.08).y > 1.9 && knock.duration <= 0.35
              && knock.value(time: knock.duration) == KnockValue(), "knock: away first (−3), dips 2, lands exactly home in 0.34 s",
              "\(knock.value(time: knock.duration)) \(knock.duration)")
        let rattle = KeyframeTimeline(initialValue: KnockValue()) { Celebrate.knock(Celebrate.rattleSteps(amplitude: 1.2), dip: 0) }
        check(abs(rattle.value(time: 0.025).x - 1.2) < 0.01 && rattle.value(time: 0.2).x == 0, "rattle: ±1.2 pt, two cycles in 0.2 s")
        let pop = KeyframeTimeline(initialValue: CGFloat(1)) { Celebrate.pop(1.12, delay: 0) }
        let staggered = KeyframeTimeline(initialValue: CGFloat(1)) { Celebrate.pop(1.18, delay: 0.1) }
        check(pop.value(time: 0).isFinite && abs(pop.value(time: 0.14) - 1.12) < 0.01 && pop.value(time: pop.duration) == 1
              && abs(pop.duration - 0.5) < 0.01, "pop: 1 → 1.12 → 1 in 0.5 s, landing exactly (finite at t = 0)",
              "\(pop.value(time: pop.duration)) \(pop.duration)")
        check(staggered.value(time: 0.05) == 1 && abs(staggered.value(time: 0.24) - 1.18) < 0.01, "a wave's pop waits for its delay")
        let pill = KeyframeTimeline(initialValue: 0.0) { Celebrate.pill(peak: 1, fadeOut: 1.2) }
        check(pill.value(time: 1) == 1 && pill.value(time: pill.duration) == 0 && abs(pill.duration - 2.95) < 0.01,
              "pill: in 0.15 s, hold 1.6 s, out 1.2 s")
        let wash = KeyframeTimeline(initialValue: 0.0) { Celebrate.wash(rise: 0.25) }
        check(abs(wash.duration - 1.55) < 0.01 && wash.value(time: 0.4) == 1 && wash.value(time: 1.55) == 0, "wash pulse: 1.55 s, back to 0")
        let glint = KeyframeTimeline(initialValue: 0.0) { Celebrate.glint() }
        check(glint.value(time: 0.3) == 0 && glint.value(time: 1.0) == 1 && abs(glint.duration - 1.0) < 0.01,
              "glint: waits 0.3 s, sweeps in 0.7 s")

        // MARK: Shot arc

        let arc = FlightArc(from: CGPoint(x: 0, y: 100), to: CGPoint(x: 100, y: 100))
        let far = FlightArc(from: CGPoint(x: 0, y: 100), to: CGPoint(x: 300, y: 100))
        check(arc.point(at: 0) == arc.from && arc.point(at: 1) == arc.to && abs(arc.control.y - 78) < 0.01 && abs(far.control.y - 60) < 0.01,
              "shot arc: spot to rim, bowed up 0.22 × length, at most 40 pt")

        // MARK: Moment center

        let center = MomentCenter()
        center.offer([moment("d", .pitch, .score, .goal, .decisive), moment("n", .pitch, .score, .goal)])
        check(center.current?.id == "d", "decisive beats a newer non-decisive score in the same update")
        center.offer([moment("n2", .pitch, .score, .goal)])
        check(center.current?.id == "d", "a non-decisive score doesn't interrupt a decisive one")
        center.offer([moment("d2", .pitch, .score, .goal, .decisive)])
        check(center.current?.id == "d2", "a newer decisive score does")
        center.offer([moment("s", .pitch, .swing, .shotSaved)])
        check(center.current?.id == "d2", "a lesser tier still never interrupts")

        let cooldown = MomentCenter()
        var now = ContinuousClock.now
        cooldown.now = { now }
        cooldown.offer([moment("g1", .pitch, .score, .goal, burst: false)])
        let first = cooldown.current?.burst
        now += .seconds(6)
        cooldown.offer([moment("g2", .pitch, .score, .goal, burst: false)])
        let second = cooldown.current?.burst
        now += .seconds(5)
        cooldown.offer([moment("g3", .pitch, .score, .goal, burst: false)])
        let third = cooldown.current?.burst
        check(first == true && second == false && third == true,
              "burst cooldown: goals 6 s apart → the second gets sparks; the next burst 11 s after the first",
              "\(String(describing: first)) \(String(describing: second)) \(String(describing: third))")
        now += .seconds(2)
        cooldown.offer([moment("m3", .court, .swing, .made(value: 3), burst: false)])
        check(cooldown.current?.id == "g3", "a swing moment doesn't take a score's slot")
        let catchUp = MomentCenter()
        catchUp.offer((1...4).map { moment("c\($0)", .pitch, .score, .goal, burst: false) })
        check(catchUp.current?.id == "c4" && catchUp.current?.burst == false, "a catch-up shows its newest score but never bursts")
        let opened = MomentCenter()
        opened.remember(["old"])
        opened.offer([moment("old", .pitch, .score, .goal)])
        check(opened.current == nil, "what was on screen when the page opened never celebrates")

        // MARK: Sound

        check(CelebrationSound.sound(for: moment("g", .pitch, .score, .goal))?.name == "Pop"
              && CelebrationSound.sound(for: moment("g", .pitch, .score, .goal, .decisive))?.name == "Glass"
              && CelebrationSound.sound(for: moment("s", .pitch, .swing, .shotSaved)) == nil,
              "sound: a pop for a score, glass when decisive, nothing below score")
        check(!CelebrationSound.enabled, "sounds are off by default")

        // MARK: End state is pixel-identical to no celebration

        func render(_ m: LiveMoment?, t: Double, scheme: ColorScheme, level: CelebrationLevel = .full, reduceMotion: Bool = false) -> Data? {
            let size = CGSize(width: 292, height: 160)
            let view = Canvas { context, size in
                context.stroke(Path(CGRect(origin: .zero, size: size)), with: .color(Viz.markings))
                context.fill(Path(ellipseIn: CGRect(x: 200, y: 70, width: 6, height: 6)), with: .color(.red))
            }
            .frame(width: size.width, height: size.height)
            .compositingGroup()
            .overlay(alignment: .topLeading) {
                CelebrationStage(moment: m, origin: CGPoint(x: 250, y: 80), size: size, colors: .team(.red), direction: .degrees(-150))
            }
            .vizWell()
            .padding(14)
            .background(scheme == .dark ? Color(white: 0.16) : Color(white: 0.95))
            .environment(\.celebrationClock, .frozen(t))
            .environment(\.celebrationLevel, level)
            .environment(\._accessibilityReduceMotion, reduceMotion)
            .environment(\.colorScheme, scheme)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            guard let image = renderer.cgImage else { return nil }
            return image.dataProvider?.data as Data?
        }
        var identical = 0, total = 0, differsMidway = 0
        for m in [moment("g", .pitch, .score, .goal), moment("bz", .court, .score, .made(value: 3), [.buzzer, .decisive]),
                  moment("dk", .court, .swing, .made(value: 2), .dunk), moment("hr", .spray, .score, .homeRun, .decisive)] {
            for scheme in [ColorScheme.dark, .light] {
                for (level, rm) in [(CelebrationLevel.full, false), (.subtle, false), (.full, true)] {
                    let longest = [cue(m), cue(m, .subtle), cue(m, reduceMotion: true)].compactMap { $0?.duration }.max() ?? 0
                    let none = render(nil, t: longest + 0.1, scheme: scheme, level: level, reduceMotion: rm)
                    total += 1
                    if none != nil, render(m, t: longest + 0.1, scheme: scheme, level: level, reduceMotion: rm) == none { identical += 1 }
                    if level == .full, !rm, render(m, t: (cue(m)?.delay ?? 0) + 0.45, scheme: scheme) != none { differsMidway += 1 }
                }
            }
        }
        check(identical == total && total == 24, "end state is pixel-identical to no celebration (\(identical)/\(total))")
        check(differsMidway == 8, "…and mid-burst it isn't (the comparison sees the stage)", "\(differsMidway)/8")
    }
}
