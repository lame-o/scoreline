import SwiftUI

// The game as one broadcast, part 15: the theater's view (CHOREOGRAPHY §5.6.7,
// §5.7, §10). One shell for every sport.
//
// It draws only what's seen, and only while something moves: at the display's
// own rate (TimelineView's animation schedule, locked to the refresh) whenever
// anything on screen is moving, and not at all when nothing is, or when the
// theater is folded or scrolled away (the clock and the plan carry on). Between
// the two is one wake, at the moment the plan's next tier begins on the
// theater's time, across a hold of the clock as well as any other stretch of it.
// Each frame reads the theater's time from the presentation clock, samples the
// chain into a scratch the view holds and never observes (no allocation, no
// invalidation), and hands it to the sport's painter.
//
// Reduce Motion: the same clock and the same plan, shown as key states (each
// clip's decisive moment and its end), each crossfading into the next over a
// quarter second on the house ease-out: no travel, no camera moves.

/// Whether a directed theater should be drawing, and when that next changes. (pure; tested)
enum TheaterFrameGate {
    /// How far ahead of a tier that moves the frames start, so that the first frame past its start
    /// isn't left to a timer's lateness: two frames of a still field cost nothing to see.
    static let lead = 2.0 / 60
    /// How long frames carry on past a tier that moves, so that its end is drawn where it comes to rest.
    static let tail = 1.0 / 60

    struct State: Equatable {
        var moving: Bool
        /// The wall time this next changes; nil: it doesn't, on this plan.
        var wake: PTime?
    }

    static func tier(_ tiers: [FrameTier], at T: PTime) -> FrameTier? {
        guard !tiers.isEmpty else { return nil }
        var lo = 0, hi = tiers.count - 1
        if T < tiers[0].from { return tiers[0] }
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if tiers[mid].from <= T { lo = mid } else { hi = mid - 1 }
        }
        return tiers[lo]
    }

    static func state(tiers: [FrameTier], time: TheaterTime, clock: PresentationClock, now: PTime) -> State {
        let T = time.at(now, clock: clock)
        guard let here = tier(tiers, at: T) else { return State(moving: false, wake: nil) }
        // A tier that moves is drawn from a little before its start, and a little past its end.
        let moving = here.moves || tier(tiers, at: T + lead)?.moves == true || tier(tiers, at: T - tail)?.moves == true
        // The next moment that answer changes, on the theater's time.
        let target: PTime?
        if moving {
            var until = here.from
            for t in tiers where t.until > T {
                if !t.moves, t.until - t.from > lead + tail + 1e-6 { until = t.from; break }
                until = t.until
            }
            target = until > T || !here.moves ? until + tail : nil
            if let target, target <= T { return State(moving: true, wake: now + 1.0 / 60) }
        } else {
            target = tiers.first { $0.moves && $0.from > T }.map { $0.from - lead }
        }
        guard let target, target.isFinite else { return State(moving: moving, wake: nil) }
        return State(moving: moving, wake: time.wall(reaching: target, clock: clock, after: now))
    }
}

/// The key states Reduce Motion shows: each clip's decisive moment and its end, on the theater's time.
enum TheaterKeyStates {
    static func keys<Clip: TheaterClip>(_ plan: Plan<Clip>) -> [PTime] {
        var keys: [PTime] = [plan.start]
        for p in plan.placements {
            if let d = p.clip.decisive { keys.append(p.offset + d) }
            keys.append(p.offset + p.clip.length)
        }
        return keys.sorted()
    }

    /// The key state shown at T, the one before it, and how far the crossfade between them is (1: done).
    static func shown(_ keys: [PTime], at T: PTime) -> (now: PTime, before: PTime?, fade: Double) {
        guard let k = keys.lastIndex(where: { $0 <= T }) else { return (T, nil, 1) }
        let fade = min(max((T - keys[k]) / 0.25, 0), 1)
        return (keys[k], k > 0 ? keys[k - 1] : nil, TheaterCurve.out(fade))
    }
}

#if DEBUG
/// What a directed theater drew in a frame, for the offscreen check: the theater's time, the clock's p, the play in
/// charge and whether its decisive moment has been reached (the frame the score lands with).
struct TheaterFrameReport: Equatable {
    var wall: PTime
    var T: PTime
    var p: PTime
    var play: String?
    /// The clip's own time (stretched, as its decisive moment is), not its script's.
    var clipTime: Double
    var decisive: Double?
    /// The plays the newest plan has placed (their decisive frames planned).
    var placed: Set<String> = []
    /// The newest play whose decisive moment the court has drawn by T (every play has one: the told order on screen).
    var newest: String?
    /// The director's state, for the check's log (seen, plans, what the newest plan tells).
    var note = ""
    var reached: Bool { decisive.map { clipTime >= $0 - 1e-6 } ?? false }
}

private struct TheaterFrameProbeKey: EnvironmentKey {
    static let defaultValue: ((TheaterFrameReport) -> Void)? = nil
}

extension EnvironmentValues {
    /// The offscreen check's hook: each directed frame reports what it drew.
    var theaterFrameProbe: ((TheaterFrameReport) -> Void)? {
        get { self[TheaterFrameProbeKey.self] }
        set { self[TheaterFrameProbeKey.self] = newValue }
    }
}
#endif

// MARK: - A directed theater on the page

/// A directed theater's frames: at the display's rate while anything moves and
/// the theater's seen, none while nothing does (one still frame otherwise); on
/// the offscreen check's virtual clock, the frame at its time, drawn again at
/// each of its steps.
struct TheaterFrames<Sport: TheaterSport, Content: View>: View {
    let director: TheaterDirector<Sport>
    let running: Bool
    /// Frames on top of the plan's: a name tag fading in over a still field.
    var awake = false
    @ViewBuilder let frame: (PTime) -> Content
    /// The plan has something moving now.
    @State private var moving = true
    #if DEBUG
    @Environment(\.broadcastHarness) private var harness
    #endif

    init(director: TheaterDirector<Sport>, running: Bool, awake: Bool = false, @ViewBuilder frame: @escaping (PTime) -> Content) {
        self.director = director
        self.running = running
        self.awake = awake
        self.frame = frame
    }

    var body: some View {
        #if DEBUG
        if let harness {
            frame(harness.now)
        } else {
            live
        }
        #else
        live
        #endif
    }

    private struct Watch: Equatable {
        var chain: UInt64
        var clock: UInt64
        var running: Bool
    }

    @ViewBuilder private var live: some View {
        if director.timing != nil {
            TimelineView(.animation(minimumInterval: nil, paused: !running || !(moving || awake))) { context in
                frame(context.date.timeIntervalSince1970)
            }
            // The one wake: a new plan, a new clock or coming back into view looks again; otherwise it sleeps until the tier changes.
            .task(id: Watch(chain: director.chain.revision, clock: director.clockRevision, running: running)) { await watch() }
        }
    }

    private func watch() async {
        guard running else { return }
        while !Task.isCancelled {
            guard let timing = director.timing else { return }
            let now = director.now()
            let state = TheaterFrameGate.state(tiers: director.chain.tiers, time: timing.time, clock: timing.clock, now: now)
            if moving != state.moving { moving = state.moving }
            guard let wake = state.wake else { return }
            try? await Task.sleep(for: .seconds(max(wake - now, 1.0 / 240)))
        }
    }
}

extension View {
    /// A directed theater's conversation with the page's broadcast: it reads
    /// the timeline (re-planning at each revision) and the clock (its events:
    /// a hold, a resume, a skip or a jump re-plans), hands back its binding
    /// horizons and solved anchors (one truth for the score, the lists and
    /// the court), its scoring cues for the slides, and plans only while seen.
    func directed<Sport: TheaterSport>(_ director: TheaterDirector<Sport>, source: Broadcast, facts: Sport.Facts, seen: Bool,
                                       cues: TheaterCues?) -> some View {
        modifier(TheaterDirecting(director: director, source: source, facts: facts, seen: seen, cues: cues))
    }
}

private struct TheaterDirecting<Sport: TheaterSport>: ViewModifier {
    let director: TheaterDirector<Sport>
    let source: Broadcast
    let facts: Sport.Facts
    let seen: Bool
    let cues: TheaterCues?
    /// The last clock event the director has had.
    @State private var lastEvent: PresentationClock.Event?
    #if DEBUG
    @Environment(\.broadcastHarness) private var harness
    #endif

    func body(content: Content) -> some View {
        content
            .onAppear {
                #if DEBUG
                if let harness { director.now = { [harness] in harness.now } }
                #endif
                source.setBindingHorizons(BindingHorizons(live: BindingHorizons().live, byKind: Sport.horizons))
                director.factsDidChange(facts)
                director.setVisible(seen)
                clockChanged(source.clock)
                director.timelineDidChange(source.snapshot())
            }
            .onChange(of: source.revision) { _, _ in director.timelineDidChange(source.snapshot()) }
            .onChange(of: source.clock) { _, clock in
                clockChanged(clock)
                // The clock re-planned: where T reaches each decisive frame on p moved with it.
                source.setAnchors(director.anchors, covering: director.covering, leadIns: director.leadIns)
            }
            .onChange(of: director.chain.revision) { _, _ in
                source.setAnchors(director.anchors, covering: director.covering, leadIns: director.leadIns)
                cues?.publish(director)
            }
            // No theater schedules the plays any more: nothing waits for its anchors.
            .onDisappear { source.setAnchors(director.anchors, covering: nil, leadIns: [:]) }
            .onChange(of: facts) { _, now in director.factsDidChange(now) }
            .onChange(of: seen) { _, now in director.setVisible(now) }
    }

    /// Hands the director the clock's events since the last it had.
    private func clockChanged(_ clock: PresentationClock) {
        let events = clock.events
        let fresh: [PresentationClock.Event]
        if let lastEvent, let i = events.lastIndex(of: lastEvent) { fresh = Array(events[(i + 1)...]) } else { fresh = events }
        lastEvent = events.last
        director.clockDidChange(clock, events: fresh)
    }
}

/// A directed theater's scoring moments, for the page's scoring slides
/// (CHOREOGRAPHY §12): each scoring play's `Cue.scored` on the theater's
/// time, and the theater's time at a wall time. The slide lands with the
/// theater's decisive frame because both are the plan's.
@MainActor
@Observable
final class TheaterCues {
    private(set) var scored: [(id: String, at: PTime)] = []
    @ObservationIgnored private var time: (PTime) -> PTime? = { _ in nil }

    func publish<Sport: TheaterSport>(_ director: TheaterDirector<Sport>) {
        var out: [(id: String, at: PTime)] = []
        for plan in director.chain.plans {
            for cue in plan.plan.cues {
                guard case let .scored(id) = cue.kind else { continue }
                out.removeAll { $0.id == id }
                out.append((id, cue.at))
            }
        }
        scored = out.sorted { $0.at < $1.at }
        time = { [weak director] wall in director?.time(at: wall) }
    }

    /// The scoring play the theater is at (its decisive moment come, or the next to come).
    func playing(now wall: PTime) -> String? {
        guard let T = time(wall) else { return nil }
        return (scored.last { $0.at <= T + 0.5 } ?? scored.first { $0.at > T })?.id
    }

    /// Seconds from now to that play's decisive frame.
    func climax(now wall: PTime) -> Double? {
        guard let T = time(wall), let id = playing(now: wall), let cue = scored.first(where: { $0.id == id }) else { return nil }
        return max(cue.at - T, 0)
    }
}

/// A directed theater's frame on screen, for the pointer's tag: each man's
/// spot through the camera, and who he is (the cast of the clip in charge,
/// keyed by the engine's men). Written as each frame is drawn, never observed.
@MainActor
final class DirectedFrame {
    private(set) var figures: [(index: Int, ground: CGPoint, height: CGFloat)] = []
    private(set) var cast = TheaterCast()
    private var castKey = ""

    /// The member under the pointer.
    func member(at point: CGPoint) -> String? { TheaterTags.hit(figures, at: point).flatMap { cast.members[$0]?.id } }

    func update(_ figures: [(index: Int, ground: CGPoint, height: CGFloat)]) { self.figures = figures }

    /// The clip's own cast (a frame that keys its figures by the clip's men), built once per clip in charge.
    func cast(key: String, byFigure: () -> TheaterCast) -> TheaterCast {
        guard key != castKey else { return cast }
        cast = byFigure()
        castKey = key
        return cast
    }

    /// The clip's cast (by its figures) as the engine's men play them, built once per clip in charge.
    func cast(key: String, cast men: [ActorID], byFigure: () -> TheaterCast) -> TheaterCast {
        guard key != castKey else { return cast }
        let mine = byFigure()
        var members: [Int: TheaterCast.Member] = [:]
        for (i, m) in mine.members where i < men.count { members[Int(men[i].raw)] = m }
        let keys = mine.keys.map { TheaterCast.Key(from: $0.from, figure: $0.figure.flatMap { $0 < men.count ? Int(men[$0].raw) : nil }) }
        cast = TheaterCast(members: members, keys: keys, scope: mine.scope)
        castKey = key
        return cast
    }
}
