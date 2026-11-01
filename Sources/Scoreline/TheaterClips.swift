import Foundation
import simd

// The game as one broadcast, part 11: clips and the splice (CHOREOGRAPHY §4.5,
// §12 Phase 0; BROADCAST §4's "generalized bridge").
//
// Phase 0 keeps today's per-play scripts (a replay, a beat, the field between
// plays) and changes who owns time. Each script is a clip: its figures' paths
// in the world, its ball, its camera, its decisive moment. The engine places
// each clip so its decisive moment lands on its play's anchor, and every
// hand-off from one clip to the next is a splice: from the world exactly as
// it stands (each man's position, velocity and acceleration, his stride, the
// ball, the camera with its velocity), each man travels to where the next
// clip wants him within his limits, the ball goes with whoever has it (or is
// passed on, inferred), and the camera bends toward the new framing. A replay
// that follows another play no longer cuts to its own set: the men run there.
// If the time isn't there, the clip runs a little later (a declared catch-up,
// quiet up to 1.5 s); nobody outruns his limits and nothing jumps.
//
// Pure values, no SwiftUI: a sport supplies its clips (BasketballClips.swift…).

/// A clip figure as the splice matches him to the world's men.
struct ClipFigure: Equatable, Sendable {
    /// Whose: a team (0 top, 1 bottom) or the officials and staff (2): never matched across.
    var group: Int
    /// What: his role (matched before distance).
    var kind: String = ""
    /// Who: the data's athlete, when it names him (matched before anything).
    var athlete: String? = nil
    /// His motion band (MotionLimits).
    var band: String
    /// The rig's height (field units).
    var height: Double
}

/// The ball in a clip at an instant (world frame).
enum ClipBall: Equatable, Sendable {
    /// In a figure's hands (or on his dribble).
    case held(figure: Int)
    /// Anywhere else: in the air, bouncing, on the floor.
    case free(SIMD3<Double>, flying: Bool)
}

/// One of today's scripts as the engine places it.
protocol TheaterClip: Sendable {
    /// Its length in its own seconds (it holds its last moment after).
    var length: Double { get }
    /// Its still moment: nothing moves before it, so a splice lands everyone by then.
    var still: Double { get }
    /// Its decisive moment, if it has one (a beat's whistle, a replay's make).
    var decisive: Double? { get }
    /// Once begun, it plays at least this far before anything may splice out of it (its decisive moment and what must follow it).
    var essential: Double { get }
    /// Ambient (the field between plays): it may be spliced out of anywhere but mid-flight.
    var ambient: Bool { get }
    var figures: [ClipFigure] { get }
    func position(_ figure: Int, at t: Double) -> SIMD2<Double>
    func heading(_ figure: Int, at t: Double) -> Double
    func opacity(_ figure: Int, at t: Double) -> Double
    func ball(at t: Double) -> ClipBall?
    /// The camera it wants: ground center, log span, yaw (world).
    func camera(at t: Double) -> SIMD4<Double>
    /// Whether anything moves at t (frame tiers).
    func moving(at t: Double) -> Bool
}

extension TheaterClip {
    func velocity(_ figure: Int, at t: Double) -> SIMD2<Double> {
        let h = 1 / 240.0
        return (position(figure, at: t + h) - position(figure, at: t - h)) / (2 * h)
    }

    func acceleration(_ figure: Int, at t: Double) -> SIMD2<Double> {
        let h = 1 / 120.0
        return (position(figure, at: t + h) - 2 * position(figure, at: t) + position(figure, at: t - h)) / (h * h)
    }

    /// Whether the ball is in the air at t (no splice out of it then).
    func flying(at t: Double) -> Bool {
        if case .free(_, let flying)? = ball(at: t) { return flying }
        return false
    }
}

/// A ball passed or tossed between clips (inferred: the inbound, the outlet, the ball to the man who has it next).
struct BallFlight: Equatable, Sendable {
    var t0: PTime
    var t1: PTime
    var from: SIMD3<Double>
    var to: SIMD3<Double>
    /// How far above the straight line it rises at the middle.
    var apex: Double

    func point(at t: PTime) -> SIMD3<Double> {
        let u = min(max((t - t0) / max(t1 - t0, 1e-6), 0), 1)
        var p = from + (to - from) * u
        p.z += 4 * apex * u * (1 - u)
        return p
    }
}

/// One clip on p: where its time starts, who plays whom, and how the world got to it.
struct ClipPlacement<Clip: TheaterClip>: Sendable {
    var clip: Clip
    /// p of the clip's time 0.
    var offset: PTime
    /// When it takes over: the splice (the travel to it begins here).
    var start: PTime
    /// Each clip figure's man.
    var cast: [ActorID]
    /// Each traveling man's path from the splice to his place in the clip, and when he's on it.
    var travel: [ActorID: MotionPath] = [:]
    var join: [ActorID: PTime] = [:]
    /// Men the clip has no part for: they fade where they stand over the travel.
    var leaving: [ActorID] = []
    /// Men the world didn't have at the splice (a referee for his whistle, a sub coming on): they fade in where the clip
    /// has them.
    var entering: [ActorID] = []
    /// The clip's time when the travel lands (its still moment; later when the play came late and the lead-in was cut short).
    var entry: Double = 0
    /// The ball, from the splice until the clip has it.
    var ball: BallFlight?
    /// Who has the ball at the splice and until the flight (or the clip) takes it.
    var holder: ActorID?
    /// The play it tells (nil: the field between plays), its anchor (on p) and how late it was told.
    var play: String?
    var anchor: PTime?
    var slip = 0.0
    /// The theater's time less p when it was placed: its decisive moment is at `anchor + shift + slip` on the chain.
    var shift = 0.0
    /// Every play its telling covers (its own, a miss's rebound, a replay's retold lead-in).
    var covers: [String] = []
    /// Where each play it tells is presented on p, at the shift it was placed with (its decisive moment; the plays it
    /// covers at theirs). On the chain they're at these plus `shift`: as the shift moves (a hold, a skip), so do they.
    var presents: [String: PTime] = [:]

    func time(_ p: PTime) -> Double { p - offset }
    func figure(of actor: ActorID) -> Int? { cast.firstIndex(of: actor) }
    /// When the clip has everyone (the last join).
    var joined: PTime { join.values.max() ?? start }
    /// The earliest a following splice may begin: its essential part done, and never mid-flight.
    func essentialEnd(after p: PTime) -> PTime {
        var at = max(offset + clip.essential, joined, p)
        var guardSteps = 0
        while clip.flying(at: at - offset), guardSteps < 600 {
            at += 1 / TheaterTiming.rate
            guardSteps += 1
        }
        return at
    }
}

// MARK: - Who becomes whom

enum CastMatch {
    /// A man (or a clip figure) as the match sees him.
    struct Figure: Equatable, Sendable {
        var group: Int
        var kind: String
        var athlete: String?
        var at: SIMD2<Double>
    }

    /// Clip figure → world man: the same athlete first, then the nearest of
    /// his group and kind, then the nearest of his group; a final pass swaps
    /// any two whose swap shortens their moves (TheaterBridge.match, by value).
    static func match(world: [Figure], clip: [Figure]) -> [Int: Int] {
        func cost(_ r: Int, _ i: Int) -> Double {
            let a = clip[r], b = world[i]
            if let x = a.athlete, let y = b.athlete, x == y { return -1 }
            var c = simd_length(a.at - b.at)
            if a.kind != b.kind { c += 1000 }
            if let x = a.athlete, let y = b.athlete, x != y { c += 500 }
            return c
        }
        var options: [(cost: Double, r: Int, i: Int)] = []
        for r in clip.indices {
            for i in world.indices where world[i].group == clip[r].group { options.append((cost(r, i), r, i)) }
        }
        options.sort { ($0.cost, $0.r, $0.i) < ($1.cost, $1.r, $1.i) }
        var pairs: [Int: Int] = [:], taken = Set<Int>()
        for o in options where pairs[o.r] == nil && !taken.contains(o.i) {
            pairs[o.r] = o.i
            taken.insert(o.i)
        }
        var keys = pairs.keys.sorted()
        for _ in 0..<3 {
            var swapped = false
            for (n, a) in keys.enumerated() {
                for b in keys[(n + 1)...] where clip[a].group == clip[b].group {
                    guard let ia = pairs[a], let ib = pairs[b] else { continue }
                    if cost(a, ib) + cost(b, ia) < cost(a, ia) + cost(b, ib) - 0.01 {
                        pairs[a] = ib
                        pairs[b] = ia
                        swapped = true
                    }
                }
            }
            if !swapped { break }
            keys = pairs.keys.sorted()
        }
        return pairs
    }
}

// MARK: - The splice

enum Splice {
    /// The world's men as the splice needs them: their state at an instant, who they are.
    struct Man: Equatable, Sendable {
        var state: ActorState
        var figure: ClipFigure
    }

    /// How the world meets a clip: who plays whom, when the travel begins,
    /// each man's path and when he's on the clip, and how much later than
    /// asked the clip has to run.
    struct Meeting: Sendable {
        var cast: [ActorID]
        var start: PTime
        var offset: PTime
        /// The clip's time when the travel lands (its still moment, or later when the play came late).
        var entry: Double
        var travel: [ActorID: MotionPath]
        var join: [ActorID: PTime]
        var leaving: [ActorID]
        var slip: Double
        var newcomers: [ActorID]
    }

    /// Meets `clip`, asked to start its time at `offset`, from the world as
    /// `world(t)` has it from `earliest` on (the previous clip's essential
    /// end). Each matched man travels from his state at the splice to his
    /// place in the clip, as slowly as the time allows and no faster than his
    /// limits; the splice begins as late as everyone can still make it (the
    /// field between plays plays on until then). Normally they join at the
    /// clip's still moment. When the play came too late for that (its lead-in
    /// is already under way on p), they join the clip later, moving as it
    /// moves, at the earliest moment they all can (its lead-in compressed to
    /// what's left, §4.6), never inside the play's own action (`latest`) nor
    /// with the ball in the air. Only when not even that fits does the clip
    /// run later by the difference (the slip). `cast`: who plays whom when the
    /// sport knows; else matched.
    static func meet<Clip: TheaterClip>(_ clip: Clip, offset: PTime, earliest: PTime, limits: MotionLimits, cast known: [Int: ActorID]? = nil,
                                        latest: Double? = nil, nextID: inout UInt16, world: (PTime) -> [Man]) -> Meeting {
        // Who plays whom, from the world at the earliest splice.
        let men = world(earliest)
        var cast = [ActorID?](repeating: nil, count: clip.figures.count)
        if let known {
            for (i, id) in known where i < cast.count { cast[i] = id }
        } else {
            let at = max(max(offset + clip.still, earliest) - offset, 0)
            let pairs = CastMatch.match(
                world: men.map { CastMatch.Figure(group: $0.figure.group, kind: $0.figure.kind, athlete: $0.figure.athlete, at: $0.state.position) },
                clip: clip.figures.indices.map { i in
                    CastMatch.Figure(group: clip.figures[i].group, kind: clip.figures[i].kind, athlete: clip.figures[i].athlete, at: clip.position(i, at: at))
                })
            for (r, i) in pairs { cast[r] = men[i].state.id }
        }
        var newcomers: [ActorID] = []
        for i in cast.indices where cast[i] == nil {
            cast[i] = ActorID(nextID)
            newcomers.append(ActorID(nextID))
            nextID &+= 1
        }
        let castIDs = cast.map { $0! }
        func band(_ man: Man, easy: Bool) -> MotionLimits.Band {
            var b = limits.band(man.figure.band)
            if easy {
                b.sprint = b.run
                b.accel *= 0.6
                b.decel *= 0.6
                b.lateral *= 0.6
            }
            return b
        }
        /// The acceleration a travel starts with: his own, inside his limits (a clip's harder push isn't carried
        /// into the travel; position and speed are).
        func inherited(_ man: Man, easy: Bool) -> SIMD2<Double> {
            let b = band(man, easy: easy)
            return TheaterMotion.clamp(man.state.acceleration, min(b.accel, b.decel))
        }
        /// How long the slowest man needs to reach his place at clip time `entry`, moving as the clip moves him there.
        func needs(_ men: [Man], easy: Bool, entry: Double) -> Double {
            var most = 0.0
            for (i, id) in castIDs.enumerated() {
                guard let man = men.first(where: { $0.state.id == id }), clip.opacity(i, at: entry) > 0.01 else { continue }
                let moving = entry > clip.still + 1e-6
                let need = TheaterMotion.shortestTravel(from: man.state.position, man.state.velocity, inherited(man, easy: easy),
                                                        to: clip.position(i, at: entry), moving ? clip.velocity(i, at: entry) : .zero,
                                                        band: band(man, easy: easy), cruiseOver: limits.cruiseOver)
                most = max(most, need)
            }
            return most
        }
        /// The latest splice that still lands everyone by clip time `entry` (from `earliest`, measured again from there).
        func splice(easy: Bool, entry: Double) -> (start: PTime, fits: Bool) {
            var start = max(earliest, offset + entry - needs(men, easy: easy, entry: entry))
            for _ in 0..<2 where start > earliest + 1e-6 {
                start = max(earliest, offset + entry - needs(world(start), easy: easy, entry: entry))
            }
            return (start, start + needs(world(start), easy: easy, entry: entry) <= offset + entry + 1e-6)
        }
        var entry = clip.still, easy = true
        var (start, fits) = splice(easy: true, entry: entry)
        if !fits {
            easy = false
            (start, fits) = splice(easy: false, entry: entry)
        }
        if !fits, let latest, latest > clip.still {
            // Late: into the clip as it moves, at the first moment everyone can make it.
            var t = clip.still + 0.1
            while t <= latest + 1e-9 {
                if !clip.flying(at: t) {
                    let (s, ok) = splice(easy: false, entry: t)
                    if ok {
                        (entry, start, fits) = (t, s, true)
                        break
                    }
                }
                t += 0.1
            }
        }
        var offset = offset
        var slip = 0.0
        let atStart = world(start)
        // A man matched at the earliest splice who's gone by its start (faded out with the clip before) comes back as
        // a newcomer: he enters, rather than reappearing somewhere else.
        var ids = castIDs
        for i in ids.indices where !atStart.contains(where: { $0.state.id == ids[i] }) && !newcomers.contains(ids[i]) {
            ids[i] = ActorID(nextID)
            newcomers.append(ids[i])
            nextID &+= 1
        }
        let present = Set(ids)
        let leaving = atStart.map(\.state.id).filter { !present.contains($0) }
        let need = needs(atStart, easy: easy, entry: entry)
        if start + need > offset + entry + 1e-6 {
            slip = start + need - (offset + entry)
            offset += slip
        }
        let joinAt = offset + entry
        var travel: [ActorID: MotionPath] = [:], join: [ActorID: PTime] = [:]
        for (i, id) in ids.enumerated() {
            guard let man = atStart.first(where: { $0.state.id == id }) else { continue }
            let moving = entry > clip.still + 1e-6
            travel[id] = TheaterMotion.travel(from: man.state.position, man.state.velocity, inherited(man, easy: easy), at: start,
                                              to: clip.position(i, at: entry), moving ? clip.velocity(i, at: entry) : .zero,
                                              moving ? clip.acceleration(i, at: entry) : .zero,
                                              duration: max(joinAt - start, 1e-3), band: band(man, easy: easy), cruiseOver: limits.cruiseOver)
            join[id] = joinAt
        }
        return Meeting(cast: ids, start: start, offset: offset, entry: entry, travel: travel, join: join, leaving: leaving, slip: slip,
                       newcomers: newcomers)
    }
}

// MARK: - The planner (Phase 0, every sport)

/// One thing to tell (Phase 0): a play, and the plays its telling covers.
struct TellUnit<Scene: Sendable>: Sendable {
    var id: String
    var scene: Scene
    var covers: [String] = []
    /// A dead-ball play that changes nothing on the field by itself: arriving after its moment, it attaches to the
    /// stoppage on screen (§4.6) rather than being told out of place.
    var admin = false
    /// Its clip starts from the world as it stands (a beat); else from its own set (a replay), met by the splice.
    var fromWorld = true
    /// Late, the splice may join its clip as it moves up to this long before the decisive moment (the play's own action).
    var lead = 0.9
    /// The play whose anchor it lands on, when that isn't its own ID (a baseball beat derived from its entry).
    var anchor: String? = nil
}

/// A sport's Phase 0 sequencing: today's running order, as clips.
protocol ClipSequencer {
    associatedtype Clip: TheaterClip
    associatedtype Scene: Sendable

    var limits: MotionLimits { get }
    var yawRule: YawRule? { get }
    /// The plays as the anchor solver reads them.
    var anchorInputs: [AnchorInput] { get }
    /// The units still to tell after `handled`, in order.
    func units(handled: Set<String>) -> [TellUnit<Scene>]
    /// The field the plays before the page left (the opening: a declared jump).
    mutating func opening(at t: PTime) -> Clip
    /// What carries on (the placements kept from the plan before): the running order picks up from it.
    mutating func resume(_ kept: [ClipPlacement<Clip>])
    /// A unit's clip, from the world as `draft` has it at `t`.
    mutating func clip(for unit: TellUnit<Scene>, at t: PTime, draft: Plan<Clip>) -> Clip
    /// The unit was placed (its running order moves on: who has the ball, the field it leaves).
    mutating func told(_ unit: TellUnit<Scene>)
    /// The field between plays after a unit's clip ends at `t`, and its next round after `clip` ends.
    mutating func rest(after unit: TellUnit<Scene>, at t: PTime, draft: Plan<Clip>) -> Clip
    mutating func next(after clip: Clip, at t: PTime, draft: Plan<Clip>) -> Clip
    /// The cues a unit's telling fires (the score changing at its decisive moment).
    func cues(for unit: TellUnit<Scene>, clip: Clip, at decisive: PTime) -> [Cue]
    /// The ball across the splice into placement `k`.
    func handOff(_ draft: inout Plan<Clip>, _ k: Int)
}

enum TheaterPlanner {
    /// The plan from the splice at `c`: what's on screen carries on, each unit still to tell is placed at its anchor
    /// (on p, plus the theater's `shift`) and met from the world as it will stand, and the field between plays fills
    /// every gap to the horizon. Units at or past `deferFrom` (on p) wait: the clock holds short of them.
    static func plan<S: ClipSequencer>(_ sequencer: inout S, history: Set<String>, chain: PlanChain<S.Clip>, at c: PTime, shift: Double,
                                       deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<S.Clip> {
        let limits = sequencer.limits
        let previous = chain.plan(at: c)
        // What's on screen carries on (and the clip before it, while men still blend out of it).
        var keep: [ClipPlacement<S.Clip>] = []
        var toldBefore = previous?.plan.toldBefore ?? []
        if let previous, let k = previous.plan.placement(at: c) {
            let from = max(k - 1, 0)
            keep = Array(previous.plan.placements[from...k])
            for p in previous.plan.placements[..<from] { toldBefore.formUnion(p.covers) }
        }
        var draft = Plan<S.Clip>(revision: revision, start: c, horizon: c + 60, state: chain.state(at: c), placements: keep,
                                 actors: previous?.plan.actors ?? [:])
        draft.toldBefore = toldBefore
        draft.kept = keep.count
        draft.published = previous?.plan.published ?? [:]
        draft.history = chain.history(before: c)
        draft.yawRule = sequencer.yawRule
        if let previous, !previous.yawTargets.isEmpty {
            draft.yaw = (YawRule.target(previous.yawTargets, at: c), previous.yawTargets.last { $0.at <= c }?.at ?? c - 10)
        }
        if keep.isEmpty {
            // The opening: the field the last play before the page left, everyone in place (a declared jump).
            let clip = sequencer.opening(at: c)
            var cast: [ActorID] = []
            for figure in clip.figures {
                let id = ActorID(nextID)
                nextID &+= 1
                cast.append(id)
                draft.actors[id] = figure
            }
            draft.placements = [ClipPlacement(clip: clip, offset: c, start: c, cast: cast)]
            draft.declared = true
            draft.openingCamera = clip.camera(at: 0)
            draft.yaw = (clip.camera(at: 0).w, c - 10)
        } else {
            sequencer.resume(keep)
        }
        // Everything handled: before the page, told by plans before, or by what carries on.
        var handled = history.union(draft.toldBefore)
        for p in draft.placements { handled.formUnion(p.covers) }
        let units = sequencer.units(handled: handled)
        // Anchors: what carries on keeps its own.
        var frozen: [String: PTime] = [:]
        for p in draft.placements { if let id = p.play, let a = p.anchor { frozen[id] = a } }
        let anchors = AnchorSolver.solve(sequencer.anchorInputs, frozen: frozen)
        var earliest = draft.placements.last.map { $0.essentialEnd(after: c) } ?? c
        // Plays past the receding horizon wait for the plan that reaches them (no earlier than this one's horizon).
        var waiting = Set<String>()
        for (k, unit) in units.enumerated() {
            let data = anchors[unit.anchor ?? unit.id]?.at ?? (earliest - shift)
            if let deferFrom, data >= deferFrom { break }
            let anchor = data + shift
            if max(anchor, earliest) > c + TheaterTiming.planAhead {
                for later in units[k...] { waiting.insert(later.anchor ?? later.id); waiting.insert(later.id); waiting.formUnion(later.covers) }
                break
            }
            if unit.admin, anchor + TheaterTiming.microCatchUp < earliest {
                draft.toldBefore.formUnion([unit.id] + unit.covers)
                draft.notes.append(PlanNote(at: earliest, kind: .catchUp(play: unit.id, late: earliest - anchor)))
                continue
            }
            let guess = max(earliest, anchor - 3)
            var clip = sequencer.clip(for: unit, at: guess, draft: draft)
            var meeting = Splice.meet(clip, offset: anchor - (clip.decisive ?? 0), earliest: earliest, limits: limits,
                                      latest: clip.decisive.map { $0 - unit.lead }, nextID: &nextID) { men(draft, at: $0) }
            if unit.fromWorld, abs(meeting.start - guess) > 0.3 {
                // It starts from the field as it stands when it begins: built from there.
                clip = sequencer.clip(for: unit, at: meeting.start, draft: draft)
                meeting = Splice.meet(clip, offset: anchor - (clip.decisive ?? 0), earliest: earliest, limits: limits,
                                      latest: clip.decisive.map { $0 - unit.lead }, nextID: &nextID) { men(draft, at: $0) }
            }
            // The field between plays the splice cuts before it began never plays.
            draft.placements.removeAll { $0.play == nil && $0.start >= meeting.start - 1e-9 && $0.start > c }
            var placement = ClipPlacement(clip: clip, offset: meeting.offset, start: meeting.start, cast: meeting.cast, travel: meeting.travel,
                                          join: meeting.join, leaving: meeting.leaving, play: unit.id, anchor: data, slip: meeting.slip)
            placement.shift = shift
            placement.entry = meeting.entry
            placement.entering = meeting.newcomers
            placement.covers = [unit.id] + unit.covers
            // One truth on p: where each play it tells is presented (its decisive moment; the plays it covers, at theirs).
            placement.presents[unit.anchor ?? unit.id] = data + meeting.slip
            for id in unit.covers { if let a = anchors[id]?.at { placement.presents[id] = a + meeting.slip } }
            for (i, id) in meeting.cast.enumerated() { identify(&draft, id, as: clip.figures[i]) }
            draft.placements.append(placement)
            sequencer.handOff(&draft, draft.placements.count - 1)
            let decisive = meeting.offset + (clip.decisive ?? 0)
            if meeting.slip > 1e-3 { draft.notes.append(PlanNote(at: decisive, kind: .catchUp(play: unit.id, late: meeting.slip))) }
            draft.cues += sequencer.cues(for: unit, clip: clip, at: decisive)
            sequencer.told(unit)
            earliest = draft.placements[draft.placements.count - 1].essentialEnd(after: c)
            // The field between plays from where the play leaves everyone.
            let end = meeting.offset + clip.length
            if end.isFinite { append(&draft, sequencer.rest(after: unit, at: end, draft: draft), at: end, limits: limits, sequencer: sequencer, nextID: &nextID) }
        }
        // The field between plays round by round to the horizon (then only the men it still has).
        let lastTold = draft.placements.last { $0.play != nil }.map { $0.offset + min($0.clip.length, 60) } ?? c
        draft.horizon = max(c + TheaterTiming.planAhead, lastTold + 5)
        while let last = draft.placements.last, last.offset + last.clip.length < draft.horizon {
            let end = last.offset + last.clip.length
            append(&draft, sequencer.next(after: last.clip, at: end, draft: draft), at: end, limits: limits, sequencer: sequencer, nextID: &nextID)
        }
        // One scheduler: every play still to tell gets its moment here, on the theater's time (the director maps it to
        // p through the clock, and the timeline tells each play then, the court, the score and the lists together).
        // What a clip tells is where its decisive frame will be drawn; the rest (an attached substitution, a touch
        // that changed nothing) at the solver's anchor, held between the told plays around it: in order, always.
        var fixed: [String: PTime] = [:]
        for p in draft.placements {
            for (id, at) in p.presents { fixed[id] = at + p.shift }
        }
        // The past is fixed: a moment the court reached before this plan's splice (told then) keeps its time.
        var past = Set<String>()
        if let previous {
            for (id, at) in previous.plan.decisive where at <= c + 1e-6 {
                fixed[id] = at
                past.insert(id)
            }
        }
        let order = sequencer.anchorInputs.map(\.id).filter { !history.contains($0) }
        var ceilings = [PTime](repeating: .infinity, count: order.count)
        var ceiling = PTime.infinity
        for i in order.indices.reversed() {
            ceilings[i] = ceiling
            if let f = fixed[order[i]] { ceiling = min(ceiling, f) }
        }
        var floor = -PTime.infinity
        let step = 0.01
        for (i, id) in order.enumerated() {
            var at: PTime
            // Past the receding horizon: not before the plan that places it (the next, made before this one runs out).
            if waiting.contains(id), fixed[id] == nil { floor = max(floor, draft.horizon) }
            if let f = fixed[id] {
                at = max(f, floor + step)
            } else if let solved = anchors[id]?.at {
                // Past the hold, it waits (the clock holds short of it): its moment comes from the plan after.
                if let deferFrom, solved >= deferFrom {
                    draft.deferred.insert(id)
                    continue
                }
                at = min(max(solved + shift, floor + step), ceilings[i] - step)
                at = max(at, floor + step)
            } else {
                continue
            }
            draft.decisive[id] = at
            if !past.contains(id) { draft.published[id] = at - shift }
            floor = at
        }
        var present = Set<ActorID>()
        for p in draft.placements { present.formUnion(p.cast); present.formUnion(p.leaving) }
        draft.actors = draft.actors.filter { present.contains($0.key) }
        return draft
    }

    static func append<S: ClipSequencer>(_ draft: inout Plan<S.Clip>, _ clip: S.Clip, at t: PTime, limits: MotionLimits, sequencer: S,
                                         nextID: inout UInt16) {
        let meeting = Splice.meet(clip, offset: t, earliest: t, limits: limits, nextID: &nextID) { men(draft, at: $0) }
        var placement = ClipPlacement(clip: clip, offset: meeting.offset, start: meeting.start, cast: meeting.cast, travel: meeting.travel,
                                      join: meeting.join, leaving: meeting.leaving)
        placement.entry = meeting.entry
        placement.entering = meeting.newcomers
        for (i, id) in meeting.cast.enumerated() { identify(&draft, id, as: clip.figures[i]) }
        draft.placements.append(placement)
        sequencer.handOff(&draft, draft.placements.count - 1)
    }

    /// A man's identity: his team never changes; the athlete a clip credits him as stays with him.
    static func identify<Clip>(_ draft: inout Plan<Clip>, _ id: ActorID, as figure: ClipFigure) {
        if var known = draft.actors[id] {
            if let athlete = figure.athlete { known.athlete = athlete }
            draft.actors[id] = known
        } else {
            draft.actors[id] = figure
        }
    }

    /// The world's men at t as the splice reads them (present ones only).
    static func men<Clip>(_ draft: Plan<Clip>, at t: PTime) -> [Splice.Man] {
        draft.everyone.compactMap { id in
            guard let m = draft.motion(of: id, at: t), m.opacity > 0.05, let figure = draft.actors[id] else { return nil }
            let state = ActorState(id: id, position: m.position, velocity: m.velocity, acceleration: m.acceleration,
                                   rig: .standing(at: CGPoint(x: m.position.x, y: m.position.y), heading: 0), opacity: m.opacity)
            return Splice.Man(state: state, figure: figure)
        }
    }
}

/// The ball across a splice (every sport): it stays with the man who has it when he's the clip's man with it;
/// else it's passed to him (inferred: the inbound, the outlet, the ball back to the pitcher), landing as he's set.
enum TheaterHandOff {
    static func ball<Clip: TheaterClip>(_ draft: inout Plan<Clip>, _ k: Int, speed: Double, height: Double) {
        let p = draft.placements[k]
        guard case let .held(i)? = p.clip.ball(at: p.entry), i < p.cast.count else { return }
        let target = p.cast[i]
        let before = TheaterBake.ballSpans(Plan(revision: draft.revision, start: draft.start, horizon: draft.horizon, state: draft.state,
                                                placements: Array(draft.placements[..<k]), actors: draft.actors))
        var holder: ActorID?
        var from: SIMD3<Double>?
        switch TheaterBake.ballSpan(before, at: p.start) {
        case let .clip(j, _)?:
            let q = draft.placements[j]
            switch q.clip.ball(at: min(max(q.time(p.start), 0), q.clip.length)) {
            case let .held(h)?: holder = q.cast[h]
            case let .free(point, _)?: from = point
            case nil: break
            }
        case let .held(id, _)?: holder = id
        case let .flight(f)?: from = f.to
        case nil: break
        }
        if holder == target {
            draft.placements[k].holder = target
            return
        }
        let join = p.join[target] ?? p.offset + p.entry
        let landing = draft.motion(of: target, at: join)?.position ?? p.clip.position(i, at: p.entry)
        let to = SIMD3(landing.x, landing.y, height)
        var start = from ?? to
        if let holder, let m = draft.motion(of: holder, at: p.start) { start = SIMD3(m.position.x, m.position.y, height) }
        let distance = simd_length(SIMD2(to.x - start.x, to.y - start.y))
        let duration = min(max(distance / speed, 0.35), 1.2)
        let launch = max(p.start, join - duration)
        var origin = start
        if let holder, let m = draft.motion(of: holder, at: launch) { origin = SIMD3(m.position.x, m.position.y, height) }
        draft.placements[k].holder = holder
        draft.placements[k].ball = BallFlight(t0: launch, t1: launch + duration, from: origin, to: to, apex: 1 + distance / 30)
    }
}

// MARK: - Today's paths, re-made (Phase 0)

/// Each figure's path in today's scripts re-made through the motion layer
/// (CHOREOGRAPHY §5.5.3): today's moves are polylines, each its own easing, so
/// a man stops dead between two moves, turns a corner in a frame, or starts at
/// full speed. The same vertices at the same moments become keys (each ball
/// contact a hard key, so every catch, pass and shot meets the ball exactly
/// where it did), and quintics through them carry him C²: he runs through a
/// junction, rounds the corner, eases into a start. Nil: he never moves.
enum ClipPaths {
    /// `retime`: false for a loop (a re-timed run would straddle its seam; the clip's warp slows it instead).
    static func resynthesized(_ moves: [PlayScript.Move], contacts: [Double], band: MotionLimits.Band, span: ClosedRange<Double>,
                              retime: Bool = true, position: (Double) -> CGPoint) -> MotionPath? {
        let moves = moves.sorted { $0.start < $1.start }
        guard !moves.isEmpty else { return nil }
        var keys: [MotionKey] = []
        func add(_ t: Double, _ p: CGPoint, _ kind: MotionKey.Kind, hard: Bool) {
            let at = SIMD2(Double(p.x), Double(p.y))
            if let last = keys.last, t - last.t < 0.06 {
                // Too close to the last key: the harder of the two stands.
                if hard || !last.hard { keys[keys.count - 1] = MotionKey(t: max(t, last.t), at: at, kind: kind, hard: hard || last.hard) }
                return
            }
            keys.append(MotionKey(t: t, at: at, kind: kind, hard: hard))
        }
        for (n, m) in moves.enumerated() {
            let next = n + 1 < moves.count ? moves[n + 1] : nil
            let cut = next.map { $0.start < m.end - 1e-6 } ?? false
            let end = cut ? next!.start : m.end
            // Leaving from rest (nothing before it, or the move before ended a while ago).
            let resting = n == 0 || moves[n - 1].end < m.start - 0.08
            add(m.start, m.point(at: m.start), resting ? .depart : .through, hard: false)
            // Each corner, at the moment today's easing reaches it along the path.
            var along = 0.0
            for k in 0..<max(m.lengths.count - 1, 0) {
                along += m.lengths[k]
                let t = m.start + inverse(m.ease, along / max(m.length, 1e-9)) * (m.end - m.start)
                guard t < end - 0.04, t > m.start + 0.04 else { continue }
                add(t, m.path[k + 1], .through, hard: false)
            }
            let arriving = !cut && (next.map { $0.start > m.end + 0.08 } ?? true)
            add(end, m.point(at: end), arriving ? .arrive : .through, hard: false)
        }
        // Where the ball meets him, exactly where it did.
        for t in contacts {
            guard let first = keys.first, let last = keys.last, t > first.t, t < last.t else { continue }
            let at = position(t)
            keys.removeAll { abs($0.t - t) < 0.06 && !$0.hard }
            let index = keys.firstIndex { $0.t > t } ?? keys.count
            keys.insert(MotionKey(t: t, at: SIMD2(at.x, at.y), kind: .through, hard: true), at: index)
        }
        guard keys.count > 1 else { return nil }
        return TheaterMotion.path(retime ? retimed(keys, band: band, span: span) : keys, band: band)
    }

    /// Today's key times kept where a man can make them; where he can't (a
    /// move faster than his sprint, a start or stop harder than his legs),
    /// the run between two keys where he's at rest or pinned gets the time it
    /// needs: he leaves earlier (from where he stood) or arrives later (where
    /// he stops), never past a ball contact (those stay exactly when and where
    /// they were) nor the clip's ends; the keys inside it are re-timed by
    /// distance along it, eased out of a stand and into a stop (§5.5.4:
    /// retiming before infeasibility).
    static func retimed(_ keys: [MotionKey], band: MotionLimits.Band, span: ClosedRange<Double>) -> [MotionKey] {
        guard keys.count > 1 else { return keys }
        var keys = keys
        func bound(_ k: MotionKey) -> Bool { k.hard || k.kind == .depart || k.kind == .arrive }
        var edges = keys.indices.filter { bound(keys[$0]) }
        if edges.first != 0 { edges.insert(0, at: 0) }
        if edges.last != keys.count - 1 { edges.append(keys.count - 1) }
        for r in 0..<(edges.count - 1) {
            let a = edges[r], b = edges[r + 1]
            guard b > a else { continue }
            var along = [0.0]
            var fastest = 0.0
            for k in a..<b {
                let d = simd_length(keys[k + 1].at - keys[k].at)
                along.append(along[along.count - 1] + d)
                fastest = max(fastest, d / max(keys[k + 1].t - keys[k].t, 1e-6))
            }
            let length = along[along.count - 1]
            guard length > 0.05 else { continue }
            let restA = keys[a].kind == .depart || keys[a].kind == .arrive
            let restB = keys[b].kind == .arrive || keys[b].kind == .depart
            // The least time the run takes him: rest to rest (a quintic's peak speed and push), half of it, or at a run.
            let push = min(band.accel, band.decel)
            let least: Double
            if restA && restB {
                least = TheaterMotion.shortest(distance: length, band: band)
            } else if restA || restB {
                least = max(1.5 * length / band.sprint, (3.5 * length / push).squareRoot())
            } else {
                least = length / band.sprint
            }
            var t0 = keys[a].t, t1 = keys[b].t
            // Today's own timing when he can make it.
            guard t1 - t0 < least || fastest > band.sprint else { continue }
            if t1 - t0 < least {
                var short = least - (t1 - t0)
                // Later into a stop that isn't pinned (up to the next key, or the clip's end).
                if keys[b].kind == .arrive, !keys[b].hard {
                    let limit = b + 1 < keys.count ? keys[b + 1].t - 0.06 : span.upperBound
                    let more = min(short, max(limit - t1, 0))
                    t1 += more
                    short -= more
                }
                // Earlier out of a standing start that isn't pinned (down to the key before, or the clip's start).
                if short > 1e-6, keys[a].kind == .depart, !keys[a].hard {
                    let limit = a > 0 ? keys[a - 1].t + 0.06 : span.lowerBound
                    t0 -= min(short, max(t0 - limit, 0))
                }
            }
            // The keys inside, by distance along the run, on the run's own shape.
            func share(_ s: Double) -> Double {
                var lo = 0.0, hi = 1.0
                for _ in 0..<30 {
                    let u = (lo + hi) / 2
                    let covered: Double
                    if restA && restB {
                        covered = u * u * u * (10 - 15 * u + 6 * u * u)
                    } else if restA {
                        covered = u * u * (2 - u)
                    } else if restB {
                        let w = 1 - u
                        covered = 1 - w * w * (2 - w)
                    } else {
                        covered = u
                    }
                    if covered < s { lo = u } else { hi = u }
                }
                return (lo + hi) / 2
            }
            keys[a].t = t0
            keys[b].t = t1
            for k in (a + 1)..<b { keys[k].t = t0 + share(along[k - a] / length) * (t1 - t0) }
        }
        return keys
    }

    /// The moment an easing reaches `share` of its way (bisection: every easing here is monotone).
    static func inverse(_ ease: PlayScript.Ease, _ share: Double) -> Double {
        var lo = 0.0, hi = 1.0
        for _ in 0..<40 {
            let mid = (lo + hi) / 2
            if ease.value(mid) < share { lo = mid } else { hi = mid }
        }
        return (lo + hi) / 2
    }
}

// MARK: - A clip's own time, stretched (Phase 0)

/// A clip's time stretched where today's script asks more of a man than his
/// legs allow (§5.5.4: retime before anything is infeasible). Today's scripts
/// are synthesized: only the decisive contact is the data's, so the moments
/// before it are free to move apart, in order. Where any man would run past
/// his sprint (or push past his limits), the script's time runs slower, so
/// the contacts move later and nobody hurries; the ball's flights keep their
/// own pace where they can (a short one slows at most by `steadyMost`), so
/// the stretch falls on the runs between them. The stretch is eased in and out (no sudden change of pace), and the
/// clip simply starts earlier by what it gained before its decisive moment:
/// the planner places that moment at its anchor all the same.
struct ClipWarp: Equatable, Sendable {
    /// The clip's time at each step of the script's time.
    private var times: [Double]
    let step: Double
    /// The script's own length.
    let length: Double

    static let identity = ClipWarp(times: [], step: 1, length: 0)
    /// The most a short flight slows when a runner needs the time: the contacts move apart rather than anyone
    /// outrunning his legs (a pass or a rebound at half its pace at worst; most never slow at all).
    static let steadyMost = 2.0

    var isIdentity: Bool { times.isEmpty }
    /// The clip's length in its own (stretched) time.
    var stretched: Double { times.last ?? length }

    private init(times: [Double], step: Double, length: Double) {
        self.times = times
        self.step = step
        self.length = length
    }

    /// The stretch for a script: `need(u)` how much slower its time must run at script time `u` (≥ 1), `steady(u)`
    /// whether the ball's in flight there (its pace kept). Nil when nothing needs it.
    static func make(length: Double, step: Double = 1.0 / 60, need: (Double) -> Double, steady: (Double) -> Bool) -> ClipWarp? {
        guard length.isFinite, length > step else { return nil }
        let n = Int((length / step).rounded(.up)) + 1
        var raw = (0..<n).map { k -> Double in
            let u = min(Double(k) * step, length)
            return steady(u) ? min(max(need(u), 1), steadyMost) : max(need(u), 1)
        }
        guard raw.contains(where: { $0 > 1.001 }) else { return nil }
        // Spread each slowdown a quarter second either way (the most, then the mean): eased in and out.
        let half = max(Int((0.25 / step).rounded()), 1)
        var widened = raw
        for k in 0..<n { widened[k] = raw[max(k - half, 0)...min(k + half, n - 1)].max() ?? 1 }
        for k in 0..<n {
            let window = widened[max(k - half, 0)...min(k + half, n - 1)]
            let mean = window.reduce(0, +) / Double(window.count)
            raw[k] = steady(min(Double(k) * step, length)) ? min(mean, steadyMost) : mean
        }
        var times = [0.0]
        times.reserveCapacity(n)
        for k in 1..<n { times.append(times[k - 1] + step * (raw[k - 1] + raw[k]) / 2) }
        return ClipWarp(times: times, step: step, length: length)
    }

    /// The script's time at the clip's time `t` (past either end, it runs on at the script's own pace).
    func script(_ t: Double) -> Double {
        guard let last = times.last else { return t }
        if t <= 0 { return t }
        if t >= last { return length + (t - last) }
        var lo = 0, hi = times.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if times[mid] <= t { lo = mid } else { hi = mid }
        }
        let span = times[hi] - times[lo]
        let f = span > 1e-12 ? (t - times[lo]) / span : 0
        return min((Double(lo) + f) * step, length)
    }

    /// The clip's time at the script's time `u`.
    func clip(_ u: Double) -> Double {
        guard let last = times.last else { return u }
        if u <= 0 { return u }
        if u >= length { return last + (u - length) }
        let x = u / step
        let k = min(Int(x), times.count - 2)
        return times[k] + (times[k + 1] - times[k]) * (x - Double(k))
    }
}

/// The last resort (§5.5.4, §6): a man today's script moves faster than his
/// legs even with the clip's time stretched (a far defender it sends into a
/// tackle) fades out before the stretch he can't make and back in after it,
/// rather than gliding at a speed no one runs. Declared: the bench counts them.
struct ClipFades: Equatable, Sendable {
    /// Per figure, the clip-time spans he's hidden through (each with its fade either side).
    let spans: [[ClosedRange<Double>]]

    static let none = ClipFades(spans: [])
    /// The fade either side of a hidden stretch.
    static let fade = 0.25

    var count: Int { spans.reduce(0) { $0 + $1.count } }

    /// `speed(i, t)`: figure i's speed at the clip's time t (its path through the warp).
    static func make(figures: Int, length: Double, bands: [MotionLimits.Band], speed: (Int, Double) -> Double) -> ClipFades {
        guard length.isFinite, length > 0 else { return .none }
        var spans: [[ClosedRange<Double>]] = Array(repeating: [], count: figures)
        for i in 0..<figures {
            let limit = bands[i].sprint * 1.05
            var t = 0.0, from: Double?
            while t <= length {
                let fast = speed(i, t) > limit
                if fast, from == nil { from = t }
                if !fast, let a = from {
                    spans[i].append((a - fade)...(t + fade))
                    from = nil
                }
                t += 1.0 / 60
            }
            if let a = from { spans[i].append((a - fade)...(length + fade)) }
            // Overlapping fades merge.
            spans[i] = spans[i].reduce(into: []) { merged, s in
                if let last = merged.last, s.lowerBound <= last.upperBound + fade { merged[merged.count - 1] = last.lowerBound...max(last.upperBound, s.upperBound) }
                else { merged.append(s) }
            }
        }
        return ClipFades(spans: spans)
    }

    /// How much of figure i shows at t: 1 outside his hidden stretches, out and in over `fade` at their ends.
    func opacity(_ i: Int, at t: Double) -> Double {
        guard i < spans.count else { return 1 }
        var o = 1.0
        for s in spans[i] where t > s.lowerBound && t < s.upperBound {
            // In from either end over the fade, then gone between.
            let depth = min(min(t - s.lowerBound, s.upperBound - t) / ClipFades.fade, 1)
            o = min(o, 1 - TheaterCurve.inOut(depth))
        }
        return o
    }
}
