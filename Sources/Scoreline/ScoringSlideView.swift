import SwiftUI

// The scoring slide on screen (its rules and words: ScoringSlide.swift). The
// page's `ScoringSlides` keeps the line and plays one slide at a time; its
// hosts put it over the hero card (taking the scoreboard over while it
// holds) or just under the docked bar, and are out of the hierarchy between
// slides. The bar is drawn from a
// pose: live, a keyframe animator plays the wipe in (the slab lands in about
// 0.35 s, its sheen done by 1 s) and out (0.3 s), and nothing animates or
// ticks during the hold; on the harness's frozen clock the same keyframes
// are sampled at t. Reduce Motion crossfades it. Nothing runs between
// scores: a task exists only while a slide waits, shows or leaves.

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

/// The slide's sizes by the page's width: the headline reads across a room.
struct SlideMetrics: Equatable {
    var height: CGFloat
    var logo: CGFloat
    var headline: CGFloat
    var subline: CGFloat
    var chip: CGFloat
    var score: CGFloat
    /// The cut's run across the bar's height, and the stripe beyond the slab.
    var slant: CGFloat
    var stripe: CGFloat

    /// Logos are drawn at one size and scaled, so one decode serves every width.
    static let logoBase: CGFloat = 58
    static var logoPixels: Int { Int(logoBase * 2) }

    static func of(_ width: WidthClass) -> SlideMetrics {
        switch width {
        case .compact: SlideMetrics(height: 70, logo: 44, headline: 30, subline: 11.5, chip: 21, score: 12, slant: 18, stripe: 8)
        case .medium: SlideMetrics(height: 74, logo: 48, headline: 32, subline: 12, chip: 22, score: 12.5, slant: 20, stripe: 9)
        case .large: SlideMetrics(height: 80, logo: 54, headline: 36, subline: 12.5, chip: 24, score: 13, slant: 22, stripe: 10)
        case .xlarge: SlideMetrics(height: 84, logo: 58, headline: 40, subline: 13.5, chip: 26, score: 14, slant: 24, stripe: 11)
        }
    }

    /// The content's inset at the cut end: clear of the slant at mid-height.
    var cutInset: CGFloat { stripe + slant / 2 + 12 }
}

// MARK: - Motion

/// Where the bar's layers are at one instant of the wipe.
struct SlidePose: Equatable {
    /// The slab: 0 home, 1 off past its edge.
    var slab = 1.0
    /// The stripe in the second color: it leads the slab in and trails it out.
    var stripe = 1.0
    /// The type and logo, a few points behind the slab, settling as it lands (and fading in).
    var lag = 1.0
    var logo = 0.85
    var chip = 0.6
    /// Reduce Motion's crossfade.
    var opacity = 1.0
    /// The sheen's way across the slab, drawn between 0 and 1.
    var sheen = 0.0

    static let off = SlidePose()
    static let home = SlidePose(slab: 0, stripe: 0, lag: 0, logo: 1, chip: 1, opacity: 1, sheen: 1)
}

enum SlideMotion {
    /// The slab has landed (the spring's bulk; its last few points settle in the hold).
    static let land = 0.35
    static let exitLength = 0.3
    /// The spark and the confetti fly as it lands.
    static let burstAt = 0.26
    /// The type tucks in this far behind the slab.
    static let lag: CGFloat = 26

    /// Leaving: accelerating off the way it came.
    static let exitCurve = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.5, y: 0), endControlPoint: UnitPoint(x: 0.9, y: 0.5))

    /// The wipe in, or out (`leaving`). In: the stripe leads, the slab lands
    /// on a spring (0.35 s, a touch of bounce: it's a celebration), the type
    /// settles behind it, the logo and chip pop, and the sheen crosses once.
    /// Out: the slab first, the stripe after it, 0.3 s. Reduce Motion: a
    /// crossfade.
    @KeyframesBuilder<SlidePose>
    static func keyframes(leaving: Bool, reduceMotion: Bool) -> some Keyframes<SlidePose> {
        KeyframeTrack(\.slab) {
            if reduceMotion {
                MoveKeyframe(0)
            } else if leaving {
                MoveKeyframe(0)
                LinearKeyframe(1, duration: exitLength, timingCurve: exitCurve)
            } else {
                MoveKeyframe(1)
                SpringKeyframe(0, duration: 0.55, spring: Spring(duration: 0.35, bounce: 0.12))
                // Land exactly (a spring keyframe stops wherever the spring is).
                LinearKeyframe(0, duration: 0.05)
            }
        }
        KeyframeTrack(\.stripe) {
            if reduceMotion {
                MoveKeyframe(0)
            } else if leaving {
                MoveKeyframe(0)
                LinearKeyframe(0, duration: 0.04)
                LinearKeyframe(1, duration: exitLength - 0.04, timingCurve: exitCurve)
            } else {
                MoveKeyframe(1)
                SpringKeyframe(0, duration: 0.5, spring: Spring(duration: 0.3, bounce: 0.08))
                LinearKeyframe(0, duration: 0.05)
            }
        }
        KeyframeTrack(\.lag) {
            if reduceMotion || leaving {
                MoveKeyframe(0)
            } else {
                MoveKeyframe(1)
                LinearKeyframe(1, duration: 0.06)
                SpringKeyframe(0, duration: 0.5, spring: Spring(duration: 0.4, bounce: 0))
                LinearKeyframe(0, duration: 0.04)
            }
        }
        KeyframeTrack(\.logo) {
            if reduceMotion || leaving {
                MoveKeyframe(1)
            } else {
                MoveKeyframe(0.85)
                LinearKeyframe(0.85, duration: 0.18)
                SpringKeyframe(1, duration: 0.45, spring: Spring(duration: 0.4, bounce: 0.3))
                LinearKeyframe(1, duration: 0.04)
            }
        }
        KeyframeTrack(\.chip) {
            if reduceMotion || leaving {
                MoveKeyframe(1)
            } else {
                MoveKeyframe(0.6)
                LinearKeyframe(0.6, duration: 0.24)
                SpringKeyframe(1, duration: 0.42, spring: Spring(duration: 0.4, bounce: 0.25))
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
                LinearKeyframe(0, duration: 0.3)
                LinearKeyframe(1, duration: 0.7, timingCurve: Celebrate.sweepCurve)
            }
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

// MARK: - Bar

/// One slide: the stripe and the slab wiping in from its edge, the logo
/// large, the headline, the subline, the chip and the score.
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
    @Environment(\.colorScheme) private var scheme
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
        .overlay { if !arrivedLanded { SlideBurst(slide: slide, metrics: metrics, start: start + SlideMotion.burstAt) } }
        .onAppear { if clock == .live, !arrivedLanded { phase = .entering } }
        .onChange(of: leaving) { _, now in if now { phase = .leaving } }
    }

    private func bar(_ pose: SlidePose, _ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        #if DEBUG
        Self.poses += 1
        #endif
        let leading = slide.edge == .leading
        // Off toward the edge it came from.
        let away: CGFloat = leading ? -1 : 1
        let shape = SlabShape(slant: m.slant, cut: m.stripe, enters: slide.edge)
        return ZStack {
            // The stripe: the whole bar in the second color, which the slab covers but for its cut.
            SlabShape(slant: m.slant, cut: 0, enters: slide.edge)
                .fill(paint.stripeColor)
                .shadow(color: .black.opacity(scheme == .dark ? 0.45 : 0.2), radius: 10, y: 4)
                .across(pose.stripe, away)
            ZStack {
                shape.fill(LinearGradient(colors: [Color(nsColor: paint.slab.lifted(0.045).nsColor), paint.slabColor,
                                                   Color(nsColor: paint.slab.lifted(-0.05).nsColor)],
                                          startPoint: .top, endPoint: .bottom))
                // A hairline of light along the top edge.
                shape.stroke(LinearGradient(colors: [.white.opacity(0.28), .white.opacity(0)], startPoint: .top, endPoint: .center),
                             lineWidth: 1)
                    .clipShape(shape)
                if slide.tier >= .big, level == .full, !reduceMotion, pose.sheen > 0, pose.sheen < 1 {
                    SlideSheen(progress: pose.sheen, alpha: paint.lightInk ? 0.30 : 0.45).clipShape(shape)
                }
                content(pose, m, paint)
                    .offset(x: away * SlideMotion.lag * pose.lag)
                    .opacity(1 - pose.lag)
            }
            .across(pose.slab, away)
        }
        .opacity(pose.opacity)
    }

    private func content(_ pose: SlidePose, _ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        let leading = slide.edge == .leading
        let mark = logo(m, paint).scaleEffect(pose.logo)
        let words = VStack(alignment: leading ? .leading : .trailing, spacing: 0) {
            ViewThatFits(in: .horizontal) {
                headline(slide.headline, m, paint)
                if let short = slide.short { headline(short, m, paint) }
            }
            Text(slide.subline)
                .font(.system(size: m.subline, weight: .semibold))
                .foregroundStyle(paint.ink.opacity(0.86))
                .lineLimit(1)
                .minimumScaleFactor(0.88)
                .truncationMode(.tail)
        }
        .layoutPriority(1)
        let tally = VStack(alignment: leading ? .trailing : .leading, spacing: 3) {
            if let chip = slide.chip {
                Text(chip)
                    .font(.system(size: m.chip, weight: .heavy, design: .rounded).monospacedDigit())
                    .foregroundStyle(paint.slabColor)
                    .padding(.horizontal, m.chip * 0.36)
                    .background(Capsule().fill(paint.ink))
                    .fixedSize()
                    .scaleEffect(pose.chip)
            }
            if let score = slide.score {
                Text(score)
                    .font(.system(size: m.score, weight: .bold).monospacedDigit())
                    .foregroundStyle(paint.ink.opacity(0.9))
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        return HStack(spacing: 12) {
            if leading {
                mark
                words
                Spacer(minLength: 6)
                tally
            } else {
                tally
                Spacer(minLength: 6)
                words
                mark
            }
        }
        .padding(.leading, leading ? 14 : m.cutInset)
        .padding(.trailing, leading ? m.cutInset : 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func headline(_ text: String, _ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        Text(text)
            .font(.system(size: m.headline, weight: .heavy).width(.condensed))
            .tracking(m.headline * 0.02)
            .foregroundStyle(paint.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
    }

    /// The team's logo (its dark-background variant on a dark slab) or the
    /// climber's flag, seated on a soft glow of the type's color.
    private func logo(_ m: SlideMetrics, _ paint: SlidePaint) -> some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [paint.ink.opacity(0.24), paint.ink.opacity(0.10), paint.ink.opacity(0)],
                                     center: .center, startRadius: 0, endRadius: m.logo * 0.8))
                .frame(width: m.logo * 1.6, height: m.logo * 1.6)
            if let flag = slide.flag {
                Text(flag).font(.system(size: m.logo * 0.78))
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
    /// Moved off toward an edge by `fraction` of its own width (plus room for the shadow).
    func across(_ fraction: Double, _ direction: CGFloat) -> some View {
        visualEffect { content, proxy in
            content.offset(x: direction * CGFloat(fraction) * (proxy.size.width + 40))
        }
    }
}

/// The bar's shape: rounded at the edge it enters from, cut on a slant at
/// the edge that leads its travel. `cut` stops the shape short of the bar's
/// end (the slab inside the stripe).
struct SlabShape: Shape {
    var slant: CGFloat
    var cut: CGFloat
    var enters: HorizontalEdge
    var radius: CGFloat = 14

    func path(in rect: CGRect) -> Path {
        let r = min(radius, rect.height / 2)
        // Drawn entering from the left; mirrored for the right.
        let top = rect.maxX - cut, bottom = rect.maxX - cut - slant
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.midY))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: top, y: rect.minY), radius: r)
        p.addLine(to: CGPoint(x: top, y: rect.minY))
        p.addLine(to: CGPoint(x: bottom, y: rect.maxY))
        p.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.minY), radius: r)
        p.closeSubpath()
        guard enters == .trailing else { return p }
        return p.applying(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: rect.minX + rect.maxX, ty: 0))
    }
}

/// One sheen across the slab as it lands: a soft band of light at 18°, a
/// gradient (never a blend or a blur), as the Wallet pass glints.
private struct SlideSheen: View {
    let progress: Double
    let alpha: Double

    var body: some View {
        Canvas { context, size in
            let width = max(56, size.height * 0.9)
            var g = context
            g.translateBy(x: -width + (size.width + 2 * width) * progress, y: size.height / 2)
            g.rotate(by: .degrees(18))
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
            let x = leading ? Self.margin + 14 + m.logo / 2 : size.width - Self.margin - 14 - m.logo / 2
            var layer = context
            layer.translateBy(x: x, y: size.height / 2)
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
