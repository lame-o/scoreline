import SwiftUI

// The scoring slide on screen (its rules and words: ScoringSlide.swift): a
// broadcast lower third. The page's `ScoringSlides` keeps the line and plays
// one slide at a time; its hosts put it over the hero card (which steps
// aside while it's up: `SlideCover`) or just under the docked bar, and are
// out of the hierarchy between slides. The bar is drawn from a pose: live, a
// keyframe animator plays the wipe in (its layers land by 0.7 s, the sheen
// done by about 1 s) and out (0.38 s), and nothing animates or ticks during
// the hold; on the harness's frozen clock the same keyframes are sampled at
// t. Reduce Motion crossfades it. Nothing runs between scores: a task exists
// only while a slide waits, shows or leaves.

// MARK: - The line, played

/// The page's scoring slides: the line, the one on screen, and its timing.
@MainActor
@Observable
final class ScoringSlides {
    /// The slide on screen, and whether it's on its way out.
    private(set) var current: ScoringSlide?
    private(set) var leaving = false

    @ObservationIgnored private var line = SlideLine()
    @ObservationIgnored private var entries: [String: Entry] = [:]
    @ObservationIgnored private var driver: Task<Void, Never>?
    @ObservationIgnored private var shownAt: ContinuousClock.Instant?
    @ObservationIgnored private var leftAt: ContinuousClock.Instant?

    /// A waiting slide's moment and page, and when it may show.
    private struct Entry {
        var moment: LiveMoment
        var context: SlideContext
        /// When it may show; nil while it waits for the theater to take its play (until `deadline`).
        var ready: ContinuousClock.Instant?
        var deadline: ContinuousClock.Instant
        var theater: SlideTheater?
        var follow = false
        var batted: (@MainActor () -> Statcast.Batted?)?
        var confetti = false
    }

    /// How long a slide waits for its logo to decode before it goes anyway.
    static let logoWait: Duration = .milliseconds(300)

    /// One update's moments: the scores among them join the line (a catch-up
    /// only its newest). Returns their IDs: each slide makes its own
    /// announcement, so the moment slot stays quiet for them.
    func take(_ batch: [LiveMoment], context: SlideContext) -> Set<String> {
        let catchUp = batch.filter(\.captioned).count > 3
        let joined = line.offer(batch.compactMap { ScoringSlide.make($0, context: context) }, catchUp: catchUp)
        let time = ContinuousClock.now
        for slide in joined {
            entries[slide.id] = Entry(moment: slide.moment, context: context, ready: time, deadline: time)
        }
        return Set(joined.map(\.id))
    }

    /// After the moment slot has had the update: whether each new slide plays
    /// the page's burst (`granted`: the moment the slot gave a burst; `claim`
    /// takes the page's cooldown for a moment it didn't), and when it shows:
    /// now, once the theater has its play, or with the theater's climax.
    func schedule(_ ids: Set<String>, granted: LiveMoment?, claim: () -> Bool, plan: (LiveMoment) -> SlidePlan) {
        let time = ContinuousClock.now
        for id in ids.sorted() {
            guard var entry = entries[id], let slide = line.waiting.first(where: { $0.id == id }) else { continue }
            let p = plan(entry.moment)
            entry.confetti = ScoringSlide.playsConfetti(tier: slide.tier, granted: granted?.id == id && granted?.burst == true,
                                                       pageBursts: Celebration.wantsBurst(entry.moment),
                                                       ownerVisible: p.ownerVisible, claim: claim)
            entry.batted = p.batted
            entry.theater = p.theater
            entry.follow = p.follow
            if let theater = p.theater {
                if theater.playing() == id {
                    entry.ready = time + .seconds(p.follow ? Self.lead(theater) : 0)
                } else if p.patience > 0 {
                    entry.ready = nil
                    entry.deadline = time + .seconds(p.patience)
                }
            }
            entries[id] = entry
            if entry.ready == nil { watch(id) }
            warm(slide)
        }
        pump()
    }

    /// Scores taken back (overturned on review): gone from the line, and off screen.
    func retract(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        line.retract(Set(ids))
        for id in ids { entries[id] = nil }
        if let current, ids.contains(current.id), !leaving {
            leave()
            pump()
        }
    }

    /// The page went away. What was offered stays offered.
    func clear() {
        driver?.cancel()
        driver = nil
        line.drain()
        entries = [:]
        current = nil
        leaving = false
        shownAt = nil
        leftAt = nil
    }

    /// The slide on screen has landed (a host drawing it for the first time mid-hold doesn't wipe it in again).
    var settled: Bool {
        shownAt.map { ContinuousClock.now - $0 > .seconds(SlideMotion.land + 0.2) } ?? false
    }

    /// Whether this moment is (or was) the slides': its slide makes the
    /// announcement and the sheen, and the docked bar's news line yields.
    func carries(_ id: String) -> Bool { line.carries(id) }

    // MARK: Timing

    /// From the theater's replay starting to the wipe starting.
    private static func lead(_ theater: SlideTheater) -> Double {
        max((theater.climax() ?? 0) - ScoringSlide.climaxLead, 0)
    }

    /// Waits for the theater to take the play: an observation of what it
    /// holds (published with each new play), never a timer.
    private func watch(_ id: String) {
        guard let theater = entries[id]?.theater else { return }
        withObservationTracking {
            _ = theater.playing()
        } onChange: { [weak self] in
            Task { @MainActor in self?.theaterMoved(id) }
        }
    }

    private func theaterMoved(_ id: String) {
        guard var entry = entries[id], entry.ready == nil, let theater = entry.theater else { return }
        let time = ContinuousClock.now
        if theater.playing() == id {
            entry.ready = time + .seconds(entry.follow ? Self.lead(theater) : 0)
            entries[id] = entry
            pump()
        } else if time < entry.deadline {
            watch(id)
        }
    }

    private func pump() {
        driver?.cancel()
        driver = Task { [weak self] in await self?.run() }
    }

    /// The one task: sleeps to the next thing that happens (a slide due, its
    /// hold over, its exit done) and ends when nothing's left.
    private func run() async {
        while !Task.isCancelled {
            let time = ContinuousClock.now
            if let current {
                if !leaving, let shownAt {
                    let end = shownAt + .seconds(SlideMotion.land + current.hold)
                    if time < end { await Self.sleep(until: end); continue }
                    leave()
                } else if let leftAt {
                    let gone = leftAt + .seconds(SlideMotion.exitLength + 0.02)
                    if time < gone { await Self.sleep(until: gone); continue }
                    self.current = nil
                    leaving = false
                }
                continue
            }
            guard let head = line.first, let entry = entries[head.id] else { return }
            if let ready = entry.ready {
                if time < ready { await Self.sleep(until: ready); continue }
                // A moment for its logo to decode, so it never arrives as a placeholder.
                if !logoReady(head), time < ready + Self.logoWait {
                    await Self.sleep(until: time + .milliseconds(30))
                    continue
                }
            } else if time < entry.deadline {
                await Self.sleep(until: entry.deadline)
                continue
            }
            show(head, entry)
        }
    }

    private static func sleep(until instant: ContinuousClock.Instant) async {
        try? await Task.sleep(until: instant, clock: .continuous)
    }

    private func show(_ head: ScoringSlide, _ entry: Entry) {
        _ = line.next()
        entries[head.id] = nil
        // Dressed again now: Statcast may have measured the home run while it waited.
        var slide = ScoringSlide.make(entry.moment, context: entry.context, batted: entry.batted?()) ?? head
        slide.confetti = entry.confetti
        current = slide
        leaving = false
        shownAt = .now
        leftAt = nil
        Announcer.announce(slide.spoken)
    }

    private func leave() {
        leaving = true
        leftAt = .now
    }

    // MARK: Logos

    private func logoReady(_ slide: ScoringSlide) -> Bool {
        guard let team = slide.team, let url = team.logo else { return true }
        let cache = ImageCache.shared, pixels = SlideMetrics.logoPixels
        return cache.cached(url, pixels: pixels) != nil || cache.cached(team.darkLogo, pixels: pixels) != nil
    }

    /// Decodes the slide's logo at its size while it waits (the hero's is smaller).
    private func warm(_ slide: ScoringSlide) {
        guard let team = slide.team else { return }
        let urls = (slide.paint.lightInk ? [team.darkLogo, team.logo] : [team.logo]).compactMap { $0 }
        Task {
            for url in urls { _ = await ImageCache.shared.image(for: url, pixels: SlideMetrics.logoPixels) }
        }
    }
}

// MARK: - Metrics

/// The lower third's sizes by the page's width: the headline reads across a room.
struct SlideMetrics: Equatable {
    /// The three layers' heights: the kicker tab, the slab, the detail strip.
    var kicker: CGFloat
    var slab: CGFloat
    var detail: CGFloat
    /// Type: the headline, the subline, the kicker, the chip and the tally's rows.
    var headline: CGFloat
    var subline: CGFloat
    var kickerType: CGFloat
    var chipType: CGFloat
    var tally: CGFloat
    var logo: CGFloat
    /// From the page's edge: the logo, the end of its zone (at mid-height), and where the headline starts.
    var logoInset: CGFloat
    var zone: CGFloat
    var text: CGFloat
    /// The chip's size.
    var chip: CGSize
    /// How far short of the card's far edge the slab stops.
    var far: CGFloat

    /// The page's inset beside the card: the bar comes in from the page's own edge.
    static let bleed: CGFloat = 10
    /// Every slanted edge leans with the type: SF Pro Italic's 12°.
    static let lean = tan(12 * Double.pi / 180)
    /// Logos are drawn at one size and scaled, so one decode serves every width.
    static let logoBase: CGFloat = 50
    static var logoPixels: Int { Int(logoBase * 2) }

    static func of(_ width: WidthClass) -> SlideMetrics {
        switch width {
        case .compact:
            SlideMetrics(kicker: 18, slab: 48, detail: 19, headline: 36, subline: 10.5, kickerType: 11, chipType: 17, tally: 14, logo: 36,
                         logoInset: 19, zone: 74, text: 84, chip: CGSize(width: 46, height: 22), far: 12)
        case .medium:
            SlideMetrics(kicker: 20, slab: 54, detail: 21, headline: 42, subline: 11.5, kickerType: 12.5, chipType: 20, tally: 16, logo: 42,
                         logoInset: 22, zone: 86, text: 96, chip: CGSize(width: 54, height: 26), far: 16)
        case .large:
            SlideMetrics(kicker: 21, slab: 58, detail: 22, headline: 46, subline: 12, kickerType: 13, chipType: 22, tally: 17, logo: 46,
                         logoInset: 23, zone: 92, text: 103, chip: CGSize(width: 58, height: 28), far: 18)
        case .xlarge:
            SlideMetrics(kicker: 22, slab: 62, detail: 23, headline: 50, subline: 12.5, kickerType: 13.5, chipType: 24, tally: 18, logo: 50,
                         logoInset: 24, zone: 98, text: 110, chip: CGSize(width: 62, height: 30), far: 20)
        }
    }

    /// The three layers stacked.
    var height: CGFloat { kicker + slab + detail }
    /// The detail strip stops this far short of the slab.
    var detailShort: CGFloat { slab }
}

// MARK: - Motion

/// Where the bar's layers are at one instant of the wipe.
struct SlidePose: Equatable {
    /// The three layers: 0 home, 1 off past the edge they came in from.
    var kicker = 1.0
    var slab = 1.0
    var detail = 1.0
    /// The logo's pop (its scale; its opacity follows).
    var logo = 0.6
    /// The headline's and the subline's reveal behind a leaning edge, 0 to 1.
    var headline = 0.0
    var subline = 0.0
    /// The tally rising into place, 0 to 1.
    var tally = 0.0
    /// The chip's pop, 0 to 1 (and back to 0 as it leaves).
    var chip = 0.0
    /// Reduce Motion's crossfade.
    var opacity = 1.0
    /// The sheen's way across the slab, drawn between 0 and 1.
    var sheen = 0.0

    static let off = SlidePose()
    static let home = SlidePose(kicker: 0, slab: 0, detail: 0, logo: 1, headline: 1, subline: 1, tally: 1, chip: 1, opacity: 1, sheen: 1)
}

enum SlideMotion {
    /// Everything has landed (the chip's pop is the last; the sheen finishes in the hold).
    static let land = 0.7
    static let exitLength = 0.38
    /// The spark and the confetti fly as the logo pops.
    static let burstAt = 0.3
    /// The page's scoreboard steps aside this fast, and comes back this fast once the bar has gone.
    static let coverOut = 0.18
    static let coverIn = 0.25

    /// In: crisp, the broadcast curve. Out: accelerating off the way it came.
    static let inCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.23, y: 1), endControlPoint: UnitPoint(x: 0.32, y: 1))
    static let exitCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.55, y: 0), endControlPoint: UnitPoint(x: 0.85, y: 0.36))

    /// The wipe in, or out (`leaving`). In: the kicker tab, then the slab,
    /// then the detail strip, each from off its edge; the logo pops, the
    /// headline and the subline are revealed behind an edge on the type's
    /// lean, the tally rises, the chip pops, and the sheen crosses once.
    /// Out: the strip first, the slab, then the tab, 0.38 s. Reduce Motion:
    /// a crossfade.
    @KeyframesBuilder<SlidePose>
    static func keyframes(leaving: Bool, reduceMotion: Bool) -> some Keyframes<SlidePose> {
        KeyframeTrack(\.kicker) { layer(start: 0, length: 0.26, out: 0.08, leaving, reduceMotion) }
        KeyframeTrack(\.slab) { layer(start: 0.05, length: 0.39, out: 0.04, leaving, reduceMotion) }
        KeyframeTrack(\.detail) { layer(start: 0.12, length: 0.38, out: 0, leaving, reduceMotion) }
        KeyframeTrack(\.logo) {
            if reduceMotion || leaving {
                MoveKeyframe(1)
            } else {
                MoveKeyframe(0.6)
                LinearKeyframe(0.6, duration: 0.22)
                SpringKeyframe(1, duration: 0.34, spring: Spring(duration: 0.36, bounce: 0.3))
                LinearKeyframe(1, duration: 0.04)
            }
        }
        KeyframeTrack(\.headline) { reveal(start: 0.24, length: 0.32, leaving, reduceMotion) }
        KeyframeTrack(\.subline) { reveal(start: 0.30, length: 0.34, leaving, reduceMotion) }
        KeyframeTrack(\.tally) { reveal(start: 0.36, length: 0.24, leaving, reduceMotion) }
        KeyframeTrack(\.chip) {
            if reduceMotion {
                MoveKeyframe(1)
            } else if leaving {
                MoveKeyframe(1)
                LinearKeyframe(0, duration: 0.12, timingCurve: exitCurve)
            } else {
                MoveKeyframe(0)
                LinearKeyframe(0, duration: 0.44)
                SpringKeyframe(1, duration: 0.24, spring: Spring(duration: 0.32, bounce: 0.35))
                LinearKeyframe(1, duration: 0.04)
            }
        }
        KeyframeTrack(\.opacity) {
            if reduceMotion && leaving {
                MoveKeyframe(1)
                LinearKeyframe(0, duration: 0.2, timingCurve: Motion.curve)
            } else if reduceMotion {
                MoveKeyframe(0)
                LinearKeyframe(1, duration: 0.25, timingCurve: Motion.curve)
            } else {
                MoveKeyframe(1)
            }
        }
        KeyframeTrack(\.sheen) {
            if reduceMotion || leaving {
                MoveKeyframe(0)
            } else {
                MoveKeyframe(0)
                LinearKeyframe(0, duration: 0.34)
                LinearKeyframe(1, duration: 0.71, timingCurve: Celebrate.sweepCurve)
            }
        }
    }

    /// A layer: in from off its edge after `start`, or (leaving) out again after `out`.
    @KeyframeTrackContentBuilder<Double>
    private static func layer(start: Double, length: Double, out: Double, _ leaving: Bool, _ reduceMotion: Bool) -> some KeyframeTrackContent<Double> {
        if reduceMotion {
            MoveKeyframe(0)
        } else if leaving {
            MoveKeyframe(0)
            LinearKeyframe(0, duration: out)
            LinearKeyframe(1, duration: 0.28, timingCurve: exitCurve)
        } else {
            MoveKeyframe(1)
            LinearKeyframe(1, duration: start)
            LinearKeyframe(0, duration: length, timingCurve: inCurve)
        }
    }

    /// A reveal: 0 to 1 after `start`; it stays revealed as it leaves.
    @KeyframeTrackContentBuilder<Double>
    private static func reveal(start: Double, length: Double, _ leaving: Bool, _ reduceMotion: Bool) -> some KeyframeTrackContent<Double> {
        if reduceMotion || leaving {
            MoveKeyframe(1)
        } else {
            MoveKeyframe(0)
            LinearKeyframe(0, duration: start)
            LinearKeyframe(1, duration: length, timingCurve: inCurve)
        }
    }

    /// The pose `t` seconds after the slide began (the harness's frozen clock):
    /// in, the hold, then out.
    static func pose(at t: Double, hold: Double, reduceMotion: Bool) -> SlidePose {
        let out = land + hold
        if t < out {
            return KeyframeTimeline(initialValue: SlidePose.off) { keyframes(leaving: false, reduceMotion: reduceMotion) }
                .value(time: max(t, 0))
        }
        return KeyframeTimeline(initialValue: SlidePose.home) { keyframes(leaving: true, reduceMotion: reduceMotion) }
            .value(time: t - out)
    }

    /// Seconds from a slide beginning to its exit being done.
    static func length(hold: Double) -> Double { land + hold + exitLength }

    /// The page's scoreboard `t` seconds after a slide on it began (the
    /// harness's frozen clock): stepping aside as the bar comes in, gone
    /// while it holds, back once it has left.
    static func cover(at t: Double, hold: Double) -> Double {
        let back = length(hold: hold)
        if t < 0 || t >= back + coverIn { return 1 }
        if t < coverOut { return 1 - t / coverOut }
        return t < back ? 0 : (t - back) / coverIn
    }
}

// MARK: - Host

#if DEBUG
/// Harness only: a slide drawn from `at` seconds on the frozen clock, in
/// place of the page's own.
struct SlideOverride {
    var slide: ScoringSlide
    var at: Double
}

private struct SlideOverrideKey: EnvironmentKey {
    static let defaultValue: SlideOverride? = nil
}

extension EnvironmentValues {
    var slideOverride: SlideOverride? {
        get { self[SlideOverrideKey.self] }
        set { self[SlideOverrideKey.self] = newValue }
    }
}
#endif

/// Where the slide shows: over the hero card, filling it (the bar takes the
/// scoreboard over while it holds), or just under the docked bar once that's
/// the scoreboard on screen. A host on each; the one whose surface is on
/// screen draws, so a slide is only ever in one place. Out of the hierarchy
/// between slides, and it reads which scoreboard shows only while a slide
/// does, so the page around it never re-renders for it.
struct ScoringSlideHost: View {
    let slides: ScoringSlides
    /// The scoreboard it rides: `.hero` overlays the hero card, `.bar` sits under the docked bar.
    let surface: DockRules.Surface
    @Environment(\.scoreboardSurface) private var current
    #if DEBUG
    @Environment(\.dockProgressOverride) private var override
    @Environment(\.slideOverride) private var harness
    #else
    private let override: Double? = nil
    #endif

    var body: some View {
        #if DEBUG
        let shown = harness?.slide ?? slides.current, start = harness?.at ?? 0, harnessed = harness != nil
        #else
        let shown = slides.current, start = 0.0, harnessed = false
        #endif
        if let slide = shown, (override.map(DockRules.surface(p:)) ?? current?.current ?? .hero) == surface {
            ScoringSlideBar(slide: slide, leaving: slides.leaving, start: start, fills: surface == .hero,
                            settled: !harnessed && slides.settled)
                .id(slide.id)
                .modifier(SlidePlacement(surface: surface))
                // Information, never in the way: clicks go to the page, and VoiceOver
                // hears its one announcement (the hero stays the scoreboard).
                .allowsHitTesting(false)
                .accessibilityHidden(true)
                .transition(.identity)
        }
    }
}

/// Under the docked bar: on its 10pt side inset, a gap below it. Over the hero: the card's own frame.
private struct SlidePlacement: ViewModifier {
    let surface: DockRules.Surface

    func body(content: Content) -> some View {
        if surface == .bar {
            content
                .padding(.top, PageGeometry.dockInset + 4)
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, alignment: .top)
        } else {
            content
        }
    }
}

// MARK: - Cover

/// The page's scoreboard steps aside while its slide is up, and comes back
/// once the slide has gone: the hero card (its glass and all) under the bar
/// is never seen around it. Only for a slide on the hero; one under the
/// docked bar leaves the bar be. Reads which scoreboard shows only while a
/// slide does, as the host does.
struct SlideCover: ViewModifier {
    let slides: ScoringSlides
    @Environment(\.scoreboardSurface) private var current
    #if DEBUG
    @Environment(\.dockProgressOverride) private var override
    @Environment(\.slideOverride) private var harness
    @Environment(\.celebrationClock) private var clock
    #else
    private let override: Double? = nil
    #endif

    func body(content: Content) -> some View {
        let covered = slides.current != nil && onHero
        content
            .opacity(frozen ?? (covered ? 0 : 1))
            .animation(frozen == nil ? .easeOut(duration: covered ? SlideMotion.coverOut : SlideMotion.coverIn) : nil, value: covered)
    }

    /// The harness's frozen clock: the cover at its instant.
    private var frozen: Double? {
        #if DEBUG
        if let harness, case let .frozen(t) = clock, onHero { return SlideMotion.cover(at: t - harness.at, hold: harness.slide.hold) }
        #endif
        return nil
    }

    private var onHero: Bool { (override.map(DockRules.surface(p:)) ?? current?.current ?? .hero) == .hero }
}

// MARK: - Bar

/// One slide, a broadcast lower third: the kicker tab in the second color,
/// the slab in the team's (the logo in its zone, the headline, the tally),
/// the detail strip, and the chip, wiping in from the scorer's side. Hard
/// edges; every slanted one leans with the italic type, from either side.
struct ScoringSlideBar: View {
    let slide: ScoringSlide
    let leaving: Bool
    /// The harness: when the slide began on the frozen clock.
    var start: Double = 0
    /// Fill the space it's given (the hero card) rather than its own height.
    var fills = false
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.panelLayout) private var layout
    /// Steps once on appear (the wipe in) and once to leave.
    @State private var phase = Phase.waiting
    /// It had already landed when this bar appeared (it moved to the other
    /// scoreboard mid-hold): no second wipe. Kept as it was at first render.
    @State private var arrivedLanded: Bool

    init(slide: ScoringSlide, leaving: Bool, start: Double = 0, fills: Bool = false, settled: Bool = false) {
        self.slide = slide
        self.leaving = leaving
        self.start = start
        self.fills = fills
        _arrivedLanded = State(initialValue: settled)
    }
    #if DEBUG
    /// Harness counter: poses drawn (the hold must add none).
    static var poses = 0
    #endif

    enum Phase: Equatable { case waiting, entering, leaving }

    var body: some View {
        let metrics = SlideMetrics.of(layout.page), paint = slide.paint
        Group {
            switch clock {
            case let .frozen(t):
                bar(SlideMotion.pose(at: t - start, hold: slide.hold, reduceMotion: reduceMotion), metrics, paint)
            case .live:
                KeyframeAnimator(initialValue: arrivedLanded ? SlidePose.home : SlidePose.off, trigger: phase) { pose in
                    bar(pose, metrics, paint)
                } keyframes: { _ in
                    SlideMotion.keyframes(leaving: phase == .leaving, reduceMotion: reduceMotion)
                }
            }
        }
        .frame(minHeight: metrics.height, maxHeight: fills ? .infinity : metrics.height)
        // In from the page's own edge, past the card's inset.
        .padding(slide.edge == .leading ? .leading : .trailing, -SlideMetrics.bleed)
        .overlay { if !arrivedLanded { SlideBurst(slide: slide, metrics: metrics, start: start + SlideMotion.burstAt) } }
        .onAppear { if clock == .live, !arrivedLanded { phase = .entering } }
        .onChange(of: leaving) { _, now in if now { phase = .leaving } }
    }

    private func bar(_ pose: SlidePose, _ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        #if DEBUG
        Self.poses += 1
        #endif
        let leading = slide.edge == .leading, far: Edge.Set = leading ? .trailing : .leading
        // Off toward the edge it came from.
        let away: CGFloat = leading ? -1 : 1
        return VStack(alignment: leading ? .leading : .trailing, spacing: 0) {
            kickerRow(pose, m, paint, away: away)
            slab(pose, m, paint)
                .padding(far, m.far)
                .across(pose.slab, away)
            // Shorter than the slab, or its length when the words need it.
            ViewThatFits(in: .horizontal) {
                strip(pose, m, short: true)
                strip(pose, m, short: false)
            }
            .across(pose.detail, away)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .opacity(pose.opacity)
    }

    /// The detail strip: the subline, revealed on the type's lean.
    private func strip(_ pose: SlidePose, _ m: SlideMetrics, short: Bool) -> some View {
        let leading = slide.edge == .leading, near: Edge.Set = leading ? .leading : .trailing, far: Edge.Set = leading ? .trailing : .leading
        return Text(slide.subline)
            .font(.system(size: m.subline, weight: .bold).width(.condensed))
            .tracking(m.subline * 0.07)
            .textCase(.uppercase)
            .foregroundStyle(.white.opacity(0.9))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 4)
            .mask { RevealShape(progress: pose.subline, enters: slide.edge) }
            .padding(near, m.text - 4)
            .padding(far, m.detail * SlideMetrics.lean + 8)
            .frame(maxWidth: .infinity, alignment: leading ? .leading : .trailing)
            .frame(height: m.detail)
            .background(CutShape(enters: slide.edge).fill(Color(red: 0.043, green: 0.047, blue: 0.059).opacity(0.95)))
            .padding(far, m.far + (short ? m.detailShort : 0))
    }

    /// The kicker tab at the near end and the chip over the tally at the far end.
    private func kickerRow(_ pose: SlidePose, _ m: SlideMetrics, _ paint: SlidePaint, away: CGFloat) -> some View {
        let leading = slide.edge == .leading
        return Color.clear
            .frame(height: m.kicker)
            .overlay(alignment: leading ? .leading : .trailing) {
                if let kicker = slide.kicker {
                    Text(kicker)
                        .font(.system(size: m.kickerType, weight: .black).width(.condensed))
                        .tracking(m.kickerType * 0.06)
                        .textCase(.uppercase)
                        .foregroundStyle(paint.stripeInk)
                        .lineLimit(1)
                        .oblique()
                        .padding(leading ? .leading : .trailing, SlideMetrics.bleed + m.logoInset - 10)
                        .padding(leading ? .trailing : .leading, m.kicker * SlideMetrics.lean + 12)
                        .frame(height: m.kicker)
                        .background(CutShape(enters: slide.edge).fill(paint.stripeColor))
                        .across(pose.kicker, away)
                }
            }
            .overlay(alignment: leading ? .bottomTrailing : .bottomLeading) {
                if let chip = slide.chip {
                    Text(chip)
                        .font(.system(size: m.chipType, weight: .black).width(.condensed).monospacedDigit())
                        .foregroundStyle(paint.stripeInk)
                        .lineLimit(1)
                        .fixedSize()
                        .oblique()
                        .frame(minWidth: m.chip.width, minHeight: m.chip.height)
                        .background(LeanShape().fill(paint.stripeColor))
                        .scaleEffect(0.45 + 0.55 * pose.chip)
                        .opacity(min(max(pose.chip * 1.6, 0), 1))
                        .offset(y: 2)
                        .padding(leading ? .trailing : .leading, m.far + m.slab * SlideMetrics.lean + 14)
                }
            }
            .zIndex(1)
    }

    /// The slab: the logo's zone and its slash, the logo, the headline, the
    /// tally, the hairline of light and the sheen.
    private func slab(_ pose: SlidePose, _ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        let leading = slide.edge == .leading, shape = CutShape(enters: slide.edge)
        return ZStack(alignment: leading ? .leading : .trailing) {
            shape.fill(LinearGradient(colors: [Color(nsColor: paint.slab.lifted(0.06).nsColor), paint.slabColor],
                                      startPoint: .top, endPoint: .bottom))
            ZoneShape(zone: m.zone, slash: 0, enters: slide.edge).fill(.black.opacity(0.26))
            ZoneShape(zone: m.zone, slash: 5, enters: slide.edge).fill(paint.stripeColor)
            // A hairline of light along the top edge.
            Rectangle().fill(.white.opacity(0.22)).frame(height: 1).frame(maxHeight: .infinity, alignment: .top)
            if slide.tier >= .big, level == .full, !reduceMotion, pose.sheen > 0, pose.sheen < 1 {
                SlideSheen(progress: pose.sheen, alpha: paint.lightInk ? 0.26 : 0.4)
            }
            HStack(spacing: 10) {
                if !leading { tally(pose, m, paint) }
                ViewThatFits(in: .horizontal) {
                    headline(slide.headline, m, paint, reveal: pose.headline)
                    if let short = slide.short { headline(short, m, paint, reveal: pose.headline) }
                    headline(slide.headline, m, paint, reveal: pose.headline).minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, alignment: leading ? .leading : .trailing)
                if leading { tally(pose, m, paint) }
            }
            .padding(leading ? .leading : .trailing, m.text - 6)
            .padding(leading ? .trailing : .leading, m.slab * SlideMetrics.lean + 10)
            logo(m, paint)
                .scaleEffect(pose.logo)
                .opacity(min(max((pose.logo - 0.6) / 0.25, 0), 1))
                .padding(leading ? .leading : .trailing, m.logoInset)
        }
        .frame(height: m.slab)
        .clipShape(shape)
    }

    private func headline(_ text: String, _ m: SlideMetrics, _ paint: SlidePaint, reveal: Double) -> some View {
        Text(text)
            .font(.system(size: m.headline, weight: .black).width(.condensed))
            .foregroundStyle(paint.ink)
            .shadow(color: .black.opacity(paint.lightInk ? 0.25 : 0), radius: 0, y: 1)
            .lineLimit(1)
            .oblique()
            // Room for the italic's lean inside the reveal.
            .padding(.horizontal, 6)
            .mask { RevealShape(progress: reveal, enters: slide.edge) }
    }

    /// The new score at the far end: the scorer's row in full ink, the other's
    /// quieter. Without both teams' scores, the slide's own score line.
    @ViewBuilder
    private func tally(_ pose: SlidePose, _ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        let font = Font.system(size: m.tally, weight: .heavy).width(.condensed).monospacedDigit()
        Group {
            if let tally = slide.tally {
                Grid(alignment: .trailing, horizontalSpacing: m.tally * 0.55, verticalSpacing: 0) {
                    GridRow {
                        Text(tally.mine.team)
                        Text("\(tally.mine.score)")
                    }
                    GridRow {
                        Text(tally.theirs.team).opacity(0.55)
                        Text("\(tally.theirs.score)").opacity(0.55)
                    }
                }
            } else if let score = slide.score {
                Text(score)
            }
        }
        .font(font)
        .tracking(m.tally * 0.03)
        .foregroundStyle(paint.ink)
        .lineLimit(1)
        .fixedSize()
        .oblique()
        .padding(.trailing, 2)
        .opacity(pose.tally)
        .offset(y: (1 - pose.tally) * 5)
    }

    /// The team's logo (its dark-background variant on a dark slab) or the climber's flag.
    private func logo(_ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        Group {
            if let flag = slide.flag {
                Text(flag).font(.system(size: m.logo * 0.8))
            } else if let team = slide.team {
                LogoView(url: team.logo, darkURL: team.darkLogo, size: SlideMetrics.logoBase)
                    .scaleEffect(m.logo / SlideMetrics.logoBase)
                    .environment(\.colorScheme, paint.lightInk ? .dark : .light)
            }
        }
        .frame(width: m.logo, height: m.logo)
    }
}

extension OKLab {
    /// The same color, lighter (or darker, negative), its hue and chroma kept.
    func lifted(_ by: Double) -> OKLab { OKLab(l: min(max(l + by, 0), 1), a: a, b: b) }
}

private extension View {
    /// Slanted to SF Pro Italic's 12° about its middle: SF has no condensed
    /// italic (its italic has no width axis, so `.italic()` on a condensed
    /// font draws upright), and the lean matches every edge and reveal in the bar.
    func oblique() -> some View {
        visualEffect { content, proxy in
            content.transformEffect(CGAffineTransform(a: 1, b: 0, c: -SlideMetrics.lean, d: 1,
                                                      tx: SlideMetrics.lean * proxy.size.height / 2, ty: 0))
        }
    }

    /// Moved off toward an edge by `fraction` of its own width (plus a little room).
    func across(_ fraction: Double, _ direction: CGFloat) -> some View {
        visualEffect { content, proxy in
            content.offset(x: direction * CGFloat(fraction) * (proxy.size.width + 24))
        }
    }
}

/// A layer's shape: square at the edge it enters from, its far end cut on
/// the type's lean (the top further right, from either side).
struct CutShape: Shape {
    var enters: HorizontalEdge

    func path(in rect: CGRect) -> Path {
        let d = rect.height * SlideMetrics.lean
        var p = Path()
        if enters == .leading {
            p.addLines([CGPoint(x: rect.minX, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
                        CGPoint(x: rect.maxX - d, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY)])
        } else {
            p.addLines([CGPoint(x: rect.minX + d, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
                        CGPoint(x: rect.maxX, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY)])
        }
        p.closeSubpath()
        return p
    }
}

/// The chip's tag: a parallelogram on the type's lean.
struct LeanShape: Shape {
    func path(in rect: CGRect) -> Path {
        let d = rect.height * SlideMetrics.lean
        var p = Path()
        p.addLines([CGPoint(x: rect.minX + d, y: rect.minY), CGPoint(x: rect.maxX, y: rect.minY),
                    CGPoint(x: rect.maxX - d, y: rect.maxY), CGPoint(x: rect.minX, y: rect.maxY)])
        p.closeSubpath()
        return p
    }
}

/// The logo's zone at the slab's near end (`slash` 0), or its slash in the
/// second color just past it (`slash`: its width), the edge on the type's
/// lean. `zone` is the edge's distance from the near end at mid-height.
struct ZoneShape: Shape {
    var zone: CGFloat
    var slash: CGFloat
    var enters: HorizontalEdge

    func path(in rect: CGRect) -> Path {
        let d = rect.height * SlideMetrics.lean
        // The edge at the bottom, and the band from it (the zone runs to the near end).
        let leading = enters == .leading
        let edge = leading ? rect.minX + zone - d / 2 : rect.maxX - zone - d / 2
        let (a, b): (CGFloat, CGFloat) = slash == 0
            ? (leading ? (rect.minX - d - 1, edge) : (edge, rect.maxX + 1))
            : (leading ? (edge, edge + slash) : (edge - slash, edge))
        var p = Path()
        p.addLines([CGPoint(x: a + d, y: rect.minY), CGPoint(x: b + d, y: rect.minY),
                    CGPoint(x: b, y: rect.maxY), CGPoint(x: a, y: rect.maxY)])
        p.closeSubpath()
        return p
    }
}

/// What's shown of type being revealed: everything behind an edge on the
/// type's lean, travelling away from the edge the bar came in from.
struct RevealShape: Shape {
    var progress: Double
    var enters: HorizontalEdge

    func path(in rect: CGRect) -> Path {
        let d = rect.height * SlideMetrics.lean, pad: CGFloat = 2
        var p = Path()
        if enters == .leading {
            // The edge's foot runs from just before the type to just past it.
            let x = rect.minX - d - pad + CGFloat(progress) * (rect.width + d + 2 * pad)
            p.addLines([CGPoint(x: rect.minX - pad, y: rect.minY), CGPoint(x: x + d, y: rect.minY),
                        CGPoint(x: x, y: rect.maxY), CGPoint(x: rect.minX - pad, y: rect.maxY)])
        } else {
            let x = rect.maxX + pad - CGFloat(progress) * (rect.width + d + 2 * pad)
            p.addLines([CGPoint(x: x + d, y: rect.minY), CGPoint(x: rect.maxX + pad, y: rect.minY),
                        CGPoint(x: rect.maxX + pad, y: rect.maxY), CGPoint(x: x, y: rect.maxY)])
        }
        p.closeSubpath()
        return p
    }
}

/// One sheen across the slab as it lands: a soft band of light on the
/// type's lean, a gradient (never a blend or a blur), as the Wallet pass glints.
private struct SlideSheen: View {
    let progress: Double
    let alpha: Double

    var body: some View {
        Canvas { context, size in
            let width = max(56, size.height * 0.9)
            var g = context
            g.translateBy(x: -width + (size.width + 2 * width) * progress, y: size.height / 2)
            g.rotate(by: .degrees(12))
            let reach = size.height * 1.6 + width
            g.fill(Path(CGRect(x: -width / 2, y: -reach / 2, width: width, height: reach)),
                   with: .linearGradient(Gradient(colors: [.white.opacity(0), .white.opacity(alpha), .white.opacity(0)]),
                                         startPoint: CGPoint(x: -width / 2, y: 0), endPoint: CGPoint(x: width / 2, y: 0)))
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Burst

/// The slide's celebration at its logo, as the slab lands: a spark for a big
/// score (in the type's color and the stripe's), and for the top tier the
/// confetti in the team's two colors, when the page's one burst is the
/// slide's. Through the page's rules (`Celebration.cue`): the celebration
/// level, Reduce Motion (a soft bloom) and the cooldown. Drawn larger than a
/// chart's (the bar is the stage). A TimelineView only while it plays; on
/// the frozen clock, the frame at t.
struct SlideBurst: View {
    let slide: ScoringSlide
    let metrics: SlideMetrics
    /// When it starts: seconds after the slide began on the frozen clock (live, after it appears).
    var start: Double = SlideMotion.burstAt
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.panelResizing) private var resizing
    @State private var began: Date?
    @State private var done = false

    /// Room around the bar for the confetti to fly into.
    static let margin: CGFloat = 130
    static let scale = 1.7

    private var toward: Angle { slide.edge == .leading ? .degrees(-60) : .degrees(-120) }

    private var spark: CelebrationCue? {
        guard slide.tier >= .big else { return nil }
        // The rays start just clear of the logo and stop short of the headline.
        let base = (metrics.logo / 2 + 2) / Self.scale
        var cue = Celebration.cue(for: slide.moment, level: level, reduceMotion: reduceMotion, geometry: .medium, direction: toward,
                                  effects: [.sparks(rays: 10, length: 8, base: base)])
        cue?.delay = 0
        return cue
    }

    private var confetti: CelebrationCue? {
        guard slide.confetti, !reduceMotion else { return nil }
        var moment = slide.moment
        moment.burst = true
        var cue = Celebration.cue(for: moment, level: level, reduceMotion: false, geometry: .medium, direction: toward,
                                  effects: [.confetti(direction: toward, spread: .degrees(85), preset: .medium)])
        cue?.delay = 0
        // A grand slam's is gold too, with its second wave, as the theater's banner has it.
        if moment.accents.contains(.grandSlam), cue?.bursts == true { cue?.gold = true }
        return cue
    }

    var body: some View {
        let cues = (spark: spark, confetti: confetti)
        let length = [cues.spark?.duration, cues.confetti?.duration].compactMap { $0 }.max()
        if let length {
            Group {
                switch clock {
                case let .frozen(t):
                    if t >= start, t - start <= length { surface(cues, at: t - start) }
                case .live:
                    if let began, !done, !resizing {
                        TimelineView(.animation) { context in surface(cues, at: context.date.timeIntervalSince(began)) }
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task {
                guard clock == .live else { return }
                try? await Task.sleep(for: .seconds(start))
                guard !Task.isCancelled else { return }
                began = .now
                try? await Task.sleep(for: .seconds(length + 0.05))
                done = true
            }
        }
    }

    private func surface(_ cues: (spark: CelebrationCue?, confetti: CelebrationCue?), at t: Double) -> some View {
        let paint = slide.paint, m = metrics, leading = slide.edge == .leading
        let sparks = CelebrationPalette(primary: paint.ink, tint: paint.stripeColor)
        // The team's two colors, as they read over the slab and the page: the
        // second color, and the first lifted (a navy piece on a navy slab is gone).
        let team = CelebrationPalette(primary: paint.stripeColor,
                                      tint: Color(nsColor: paint.slab.lifted(max(0.62 - paint.slab.l, 0.18)).nsColor))
        return Canvas { context, size in
            // At the logo: in from the page's edge, on the slab (the layers centered as one).
            let x = leading ? Self.margin + m.logoInset + m.logo / 2 : size.width - Self.margin - m.logoInset - m.logo / 2
            var layer = context
            layer.translateBy(x: x, y: size.height / 2 + (m.kicker - m.detail) / 2)
            layer.scaleBy(x: Self.scale, y: Self.scale)
            if let confetti = cues.confetti {
                Celebration.draw(Celebration.particles(confetti, origin: .zero, t: t), in: layer, palette: team)
            }
            if let spark = cues.spark {
                Celebration.draw(Celebration.particles(spark, origin: .zero, t: t), in: layer, palette: sparks)
            }
        }
        .padding(-Self.margin)
    }
}
