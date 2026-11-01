import SwiftUI
import simd
import os

// The soccer theater on the choreography engine, Phase 0 (CHOREOGRAPHY §12):
// today's scripts (a moment's replay with its build-up, an event's beat, the
// ball going round between moments) become clips placed at their entries'
// anchors, every hand-off a splice from where everyone is. The world frame
// is the pitch as drawn (metres, home attacking right by the half and the
// viewer's turn): every script is already laid out in it, so nothing turns.
// The camera is the main stand camera's framing; the reverse angle behind a
// goal in a goal's replay is broadcast grammar, kept as a declared device.

struct PitchClip: TheaterClip, @unchecked Sendable {
    enum Kind: Equatable, Sendable { case moment, idle }

    let script: SoccerScript
    let scene: SoccerScene?
    let idle: SoccerIdle?
    let kind: Kind
    let attacking: GameDetail.Side
    let figures: [ClipFigure]
    let length: Double
    let still: Double
    let decisive: Double?
    let essential: Double
    /// Each figure's path re-made through the motion layer (ClipPaths).
    let paths: [MotionPath?]
    /// A moment's own time stretched where it asked too much of anyone (ClipWarp).
    let warp: ClipWarp
    /// Loop bounds in clip time, resolved once rather than per actor per baked sample.
    private let loopTiming: (start: Double, period: Double)?
    private let localEnd: Double
    /// The men who still can't make it, faded through (ClipFades).
    let fades: ClipFades

    init(_ script: SoccerScript, scene: SoccerScene?, idle: SoccerIdle?, attacking: GameDetail.Side) {
        self.script = script
        self.scene = scene
        self.idle = idle
        self.attacking = attacking
        kind = idle == nil ? .moment : .idle
        figures = script.actors.map { a in
            let group = switch a.team {
            case .attacking: attacking == .top ? 0 : 1
            case .defending: attacking == .top ? 1 : 0
            case .official, .staff: 2
            }
            return ClipFigure(group: group, kind: a.role == .keeper ? "keeper" : a.team == .official ? "official" : "", athlete: a.athlete,
                              band: a.team == .official || a.team == .staff ? "official" : a.role == .keeper ? "keeper" : "outfield", height: 2.5)
        }
        let bands = figures.map { MotionLimits.soccer.band($0.band) }
        // The ball going round loops: its paths aren't re-timed (a run would straddle the loop's seam); the warp slows them.
        let paths = script.actors.indices.map { i -> MotionPath? in
            let a = script.actors[i]
            // A keeper's dive is the script's own (his hands go exactly to the ball): his path stays the script's throughout.
            guard a.dive == nil else { return nil }
            let contacts = a.actions.filter { [.kick, .header, .control, .throwIn, .gather, .aerial, .punch, .claim].contains($0.kind) }
            return ClipPaths.resynthesized(a.moves, contacts: contacts.map(\.at), band: bands[i], span: 0...max(script.duration, 0),
                                           retime: idle == nil) { a.position(at: $0) }
        }
        self.paths = paths
        let warp = ClipWarp.make(length: script.duration, need: { u in
            var most = 1.0
            for i in paths.indices {
                guard let path = paths[i], script.actors[i].opacity(at: u) > 0.05, script.actors[i].dive.map({ u < $0.start }) ?? true else { continue }
                let b = bands[i]
                most = max(most, simd_length(path.velocity(at: u)) / (b.sprint * 0.97),
                           (simd_length(path.acceleration(at: u)) / (min(b.accel, b.decel, b.lateral) * 0.97)).squareRoot())
            }
            return most
        }, steady: { u in script.flights.contains { u > $0.start && u < $0.end && $0.end - $0.start < 1.5 } }) ?? .identity
        self.warp = warp
        localEnd = warp.clip(script.duration)
        if let loop = script.loop, loop.period > 0 {
            let start = warp.clip(loop.start)
            loopTiming = (start, warp.clip(loop.start + loop.period) - start)
        } else {
            loopTiming = nil
        }
        length = idle == nil ? (warp.isIdentity ? script.duration : warp.stretched) : .infinity
        // Whoever still can't make a moment's run, even slowed, fades through it (declared, counted).
        fades = idle != nil ? .none : ClipFades.make(figures: paths.count, length: warp.isIdentity ? script.duration : warp.stretched, bands: bands) { i, t in
            guard let path = paths[i], script.actors[i].dive.map({ warp.script(t) < $0.start }) ?? true else { return 0 }
            let rate = (warp.script(t + 0.004) - warp.script(t - 0.004)) / 0.008
            return simd_length(path.velocity(at: warp.script(t))) * rate
        }
        still = idle == nil ? warp.clip(script.leadIn) : 0
        decisive = idle == nil ? warp.clip(script.impacts.first { $0.kind == .net }?.at ?? script.arrive) : nil
        essential = idle == nil ? min(length, (decisive ?? 0) + 1.5) : 0
    }

    /// The script's time at the clip's time `t`: a moment holds its end; the ball going round loops (in its stretched time).
    func local(_ t: Double) -> Double {
        guard kind == .idle else { return min(max(warp.script(t), 0), script.duration) }
        guard let (start, period) = loopTiming, period > 0, t > start + period else {
            return warp.script(min(max(t, 0), localEnd))
        }
        return warp.script(start + (t - start).truncatingRemainder(dividingBy: period))
    }

    var ambient: Bool { kind == .idle }

    func position(_ figure: Int, at t: Double) -> SIMD2<Double> {
        let u = local(t)
        if let path = paths[figure], script.actors[figure].dive.map({ u < $0.start }) ?? true { return path.position(at: u) }
        let p = script.actors[figure].position(at: u)
        return SIMD2(Double(p.x), Double(p.y))
    }

    /// Which way he faces: where he's going, else what he watches (the act he's at, his look, the ball), as today's
    /// stride measured it; the director's own stride turns him toward it at a man's rate.
    func heading(_ figure: Int, at t: Double) -> Double {
        let u = local(t)
        if figure < script.rig.count { return script.rig[figure].motion(at: u).heading }
        let a = script.actors[figure]
        if let m = a.motion(at: u) { return atan2(Double(m.heading.y), Double(m.heading.x)) }
        let at = a.position(at: u)
        let held: [SoccerScript.Actor.Action.Kind] = [.gather, .celebrate, .dejected]
        let point = a.actions.last(where: { u > $0.at - 0.45 && (u < $0.at + 0.2 || held.contains($0.kind)) })?.toward
            ?? a.looks.last(where: { u >= $0.from })?.point ?? script.ball(at: u)?.ground
        guard let point, hypot(point.x - at.x, point.y - at.y) > 1e-6 else { return a.team == .attacking ? 0 : .pi }
        return atan2(Double(point.y - at.y), Double(point.x - at.x))
    }
    func opacity(_ figure: Int, at t: Double) -> Double { script.actors[figure].opacity(at: local(t)) * fades.opacity(figure, at: t) }

    func ball(at t: Double) -> ClipBall? {
        let u = local(t)
        guard script.ballOpacity(at: u) > 0.01, let b = script.ball(at: u) else { return nil }
        let flying = script.flights.contains { u > $0.start && u < $0.end }
        return .free(SIMD3(b.x, b.y, b.z), flying: flying)
    }

    func camera(at t: Double) -> SIMD4<Double> {
        let f = script.frame(at: local(t)).camera
        return SIMD4(f.x, f.y, log(max(f.span, 1e-3)), 0)
    }

    func moving(at t: Double) -> Bool {
        guard t >= 0 else { return false }
        return kind == .moment ? t <= length : script.beats.contains { $0.contains(local(t)) } || script.loop != nil
    }
}

// MARK: - The plan (Phase 0)

struct PitchFacts: Equatable, Sendable {
    var homeTeamID: String?
    var flipped = false
    var lineups: [GameDetail.Side: SoccerLineup] = [:]
}

/// A soccer entry as the planner reads it: a moment (a shot, a goal, a
/// save), an event with a beat, or a touch that moves the ball's whereabouts
/// (the field between moments follows it).
enum PitchPlay: Equatable, Sendable {
    case moment(SoccerScene)
    case event(SoccerEvent)
    case touch(SoccerTouch)
}

enum PitchPlanner {
    /// The timeline's entries as moments, events and touches, through today's parsers (each with the plays before it).
    static func plays(_ snapshot: TimelineSnapshot<RawPlay>, facts: PitchFacts) -> [TimelinePlay<PitchPlay>] {
        let all = snapshot.plays + snapshot.pending
        let json = all.map(\.play.json)
        let keepers = SoccerScene.keepers(in: json)
        var out: [TimelinePlay<PitchPlay>] = []
        for i in all.indices {
            let item = json[i]
            var play: PitchPlay?
            if SoccerScene.isMoment(item), let scene = SoccerScene.parse(json, at: i, homeTeamID: facts.homeTeamID, keepers: keepers) {
                play = .moment(scene)
            } else if let event = SoccerEvent.parse(json, at: i, homeTeamID: facts.homeTeamID, order: i) {
                play = .event(event)
            } else if let touch = SoccerTouch.parse(item, homeTeamID: facts.homeTeamID, order: i) {
                play = .touch(touch)
            }
            if let play, let mapped = all[i].map({ _ in play }) { out.append(mapped) }
        }
        return out
    }
}

/// The ball going round as clips, kept: the same field (`SoccerIdle`) makes the same clip, and every plan places the
/// field between plays again, so building its script (the men's runs, their strides) once per field, not per plan,
/// is most of a soccer plan's time saved. The newest few, under a lock (plans run off the main actor).
enum PitchIdleClips {
    private static let kept = OSAllocatedUnfairLock(initialState: [(SoccerIdle, PitchClip)]())
    private static let most = 48

    #if BENCH
    nonisolated(unsafe) static var hits = 0, misses = 0
    #endif

    static func clip(for idle: SoccerIdle) -> PitchClip {
        if let hit = kept.withLock({ list in list.firstIndex { $0.0 == idle }.map { list[$0].1 } }) {
            #if BENCH
            hits += 1
            #endif
            return hit
        }
        #if BENCH
        misses += 1
        #endif
        let clip = PitchClip(SoccerScript(idle: idle, bodies: false), scene: nil, idle: idle, attacking: idle.possession)
        kept.withLock { list in
            list.append((idle, clip))
            if list.count > most { list.removeFirst(list.count - most) }
        }
        return clip
    }
}

/// Soccer's Phase 0 running order: each moment its replay, each event with a
/// beat its beat, the ball going round between them shaped by where it is
/// (a change of cell is a splice now, not a crossfade: S1); nothing passed over.
struct PitchSequencer: ClipSequencer {
    let plays: [TimelinePlay<PitchPlay>]
    let history: Set<String>
    let facts: PitchFacts
    var last: SoccerScene?
    var event: SoccerEvent?
    var touch: SoccerTouch?
    var period: Int?

    var limits: MotionLimits { .soccer }
    var yawRule: YawRule? { nil }
    var anchorInputs: [AnchorInput] {
        plays.indices.map { i in
            let p = plays[i]
            let live: Bool = if case .event = p.play { false } else { true }
            return AnchorInput(id: p.id, period: p.period, eventTime: p.eventTime, bounds: p.eventBounds, elapsed: p.clock.elapsed, live: live,
                               stopsClock: false, weight: live ? 1 : 0.5, gapAfter: 0.3, restartAfter: 1)
        }
    }

    func idle(at t: PTime) -> PitchClip {
        let idle = SoccerIdle.make(event: event, touch: touch, scene: last, period: period, lineups: facts.lineups, flipped: facts.flipped)
        return PitchIdleClips.clip(for: idle)
    }

    /// The cell the ball's in (today's idle key: a 15 × 17 m cell, the side on it, the half).
    static func cell(_ t: SoccerTouch) -> String { "\(Int(t.at.x / 15)),\(Int(t.at.y / 17))|\(t.side)|\(t.period ?? 1)" }

    func units(handled: Set<String>) -> [TellUnit<PitchPlay>] {
        var out: [TellUnit<PitchPlay>] = []
        var cell = touch.map(Self.cell)
        for p in plays where !handled.contains(p.id) && !history.contains(p.id) {
            switch p.play {
            case .moment:
                out.append(TellUnit(id: p.id, scene: p.play, fromWorld: false, lead: 1.2))
            case let .event(e):
                guard SoccerIdle.beat(e.kind) > 0, e.kind != .resume else { continue }
                out.append(TellUnit(id: p.id, scene: p.play, admin: true, fromWorld: true, lead: 0.3))
            case let .touch(t):
                let next = Self.cell(t)
                guard next != cell else { continue }
                cell = next
                out.append(TellUnit(id: p.id, scene: p.play, fromWorld: true, lead: 0))
            }
        }
        return out
    }

    mutating func absorb(_ play: PitchPlay) {
        switch play {
        case let .moment(s):
            last = s
            event = nil
            period = s.period ?? period
        case let .event(e):
            event = SoccerIdle.holds(e.kind) ? e : nil
            period = e.period ?? period
        case let .touch(t):
            touch = t
            if let e = event, !SoccerIdle.holds(e.kind) { event = nil }
            period = t.period ?? period
        }
    }

    mutating func opening(at t: PTime) -> PitchClip {
        for p in plays where history.contains(p.id) { absorb(p.play) }
        return idle(at: t)
    }

    mutating func resume(_ kept: [ClipPlacement<PitchClip>]) {
        for p in plays where history.contains(p.id) || kept.contains(where: { $0.covers.contains(p.id) }) { absorb(p.play) }
    }

    mutating func clip(for unit: TellUnit<PitchPlay>, at t: PTime, draft: Plan<PitchClip>) -> PitchClip {
        switch unit.scene {
        case let .moment(scene):
            let drawn = PitchFacing.homeAttacksRight(period: scene.period, flipped: facts.flipped) ? scene : scene.turned()
            return PitchClip(SoccerScript(drawn, lineups: facts.lineups, bodies: false), scene: drawn, idle: nil, attacking: drawn.side)
        case .event, .touch:
            var copy = self
            copy.absorb(unit.scene)
            return copy.idle(at: t)
        }
    }

    mutating func told(_ unit: TellUnit<PitchPlay>) { absorb(unit.scene) }
    mutating func rest(after unit: TellUnit<PitchPlay>, at t: PTime, draft: Plan<PitchClip>) -> PitchClip { idle(at: t) }
    mutating func next(after clip: PitchClip, at t: PTime, draft: Plan<PitchClip>) -> PitchClip { idle(at: t) }

    func cues(for unit: TellUnit<PitchPlay>, clip: PitchClip, at decisive: PTime) -> [Cue] {
        guard case let .moment(scene) = unit.scene, scene.scored else { return [] }
        return [Cue(at: decisive, until: decisive + 3, kind: .scored(scene.id), source: .known(play: scene.id))]
    }

    func handOff(_ draft: inout Plan<PitchClip>, _ k: Int) {}
}

// MARK: - Painting

enum PitchPainter {
    private static let ink = TheaterInk(.dark)
    private static let teams = SoccerTeams(attacking: Uniform(.red), defending: Uniform(.blue))

    static func charge(_ plan: Plan<PitchClip>, at p: PTime) -> Int? {
        plan.placements.lastIndex { $0.offset <= p && $0.start <= p } ?? plan.placement(at: p)
    }

    /// One frame of the engine's world through today's soccer frame: the clip in charge and its time; each of its
    /// figures where the engine has his man, posed by it; everyone else (on the way to another clip, or leaving) in
    /// his own kit, posed by his own clip; the ball.
    static func frame(_ chain: PlanChain<PitchClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: PitchClip, t: Double, world: SoccerFrame.World)? {
        guard scratch.plan >= 0, scratch.plan < chain.plans.count else { return nil }
        let baked = chain.plans[scratch.plan]
        let plan = baked.plan
        guard let k = charge(plan, at: scratch.p) else { return nil }
        let placement = plan.placements[k]
        let clip = placement.clip
        let t = clip.local(placement.time(scratch.p))
        let camera = CameraFrame(x: scratch.camera.x, y: scratch.camera.y, span: exp(scratch.camera.z))
        let f = PitchProjection(size: size, camera: PitchFrame(camera: camera))
        var figures: [Int: SoccerFrame.World.Figure] = [:]
        var extras: [SoccerFrame.World.Extra] = []
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            let here = CGPoint(x: actor.position.x, y: actor.position.y)
            let unit = RigLens(f, at: here).unit
            func posed(_ k: Int, _ figure: Int, _ time: Double) -> (RigPose, Double)? {
                let c = plan.placements[k].clip
                guard figure < c.script.actors.count else { return nil }
                let lt = c.local(time)
                let frame = SoccerFrame(scene: c.scene, script: c.script, t: lt, teams: teams, ink: ink, size: size)
                return frame.pose(c.script.actors[figure], figure, at: here, unit: unit, stride: (track.rig, scratch.p, here))
            }
            guard let now = posed(actor.placement, actor.figure, actor.clipTime) else { continue }
            var body = now.0
            if actor.previousPlacement >= 0, actor.blend < 1, let (from, _) = posed(actor.previousPlacement, actor.previousFigure, actor.previousTime) {
                body = from.mix(body, actor.blend)
            }
            if actor.placement == k {
                figures[actor.figure] = .init(at: here, body: body, heading: now.1, opacity: actor.opacity)
            } else {
                let own = plan.placements[actor.placement].clip
                let team = own.script.actors[actor.figure].team
                // His kit as the clip in charge dresses its teams: the same side, whichever is attacking now.
                let side: GameDetail.Side? = switch team {
                case .attacking: own.attacking
                case .defending: own.attacking == .top ? .bottom : .top
                case .official, .staff: nil
                }
                let drawn: SoccerScript.Team = side.map { $0 == clip.attacking ? .attacking : .defending } ?? team
                extras.append(.init(index: Int(actor.id.raw), team: drawn, at: here, body: body, heading: now.1, opacity: actor.opacity))
            }
        }
        var ball: SoccerFrame.World.Ball?
        switch scratch.ball {
        case let .clip(j):
            let q = plan.placements[j]
            if case let .free(point, flying)? = q.clip.ball(at: q.time(scratch.p)) { ball = .free(FieldPoint(x: point.x, y: point.y, z: point.z), flying: flying) }
        case let .free(point):
            ball = .free(FieldPoint(x: point.x, y: point.y, z: point.z), flying: true)
        case .held, .none:
            break
        }
        return (clip, t, SoccerFrame.World(camera: camera, figures: figures, extras: extras, ball: ball))
    }
}

/// Soccer on the director (Phase 0): today's scripts as clips.
enum PitchSport: TheaterSport {
    /// The keepers every moment's scene names (read from the whole timeline).
    static func sceneContext(_ json: [JSON], facts: PitchFacts) -> [String: SoccerScene.Person] { SoccerScene.keepers(in: json) }

    /// A moment reads the 30 plays before it and the 6 after (`PitchPlanner.plays`).
    static var sceneReach: Int { 32 }

    static func scene(_ raw: [RawPlay], _ json: [JSON], at i: Int, pending: Bool, facts: PitchFacts, context: [String: SoccerScene.Person],
                      prior: [PitchPlay?]) -> PitchPlay? {
        let item = json[i]
        if SoccerScene.isMoment(item), let scene = SoccerScene.parse(json, at: i, homeTeamID: facts.homeTeamID, keepers: context) {
            return .moment(scene)
        }
        if let event = SoccerEvent.parse(json, at: i, homeTeamID: facts.homeTeamID, order: i) { return .event(event) }
        return SoccerTouch.parse(item, homeTeamID: facts.homeTeamID, order: i).map { .touch($0) }
    }

    static func plan(_ plays: [TimelinePlay<PitchPlay>], history: Set<String>, facts: PitchFacts, chain: PlanChain<PitchClip>, at c: PTime,
                     shift: Double, deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<PitchClip> {
        var sequencer = PitchSequencer(plays: plays, history: history, facts: facts)
        return TheaterPlanner.plan(&sequencer, history: history, chain: chain, at: c, shift: shift, deferFrom: deferFrom, revision: revision,
                                   nextID: &nextID)
    }

    /// A shot or a goal's horizon (its build-up before the strike); the ball going round and the events none.
    static var horizons: [String: Double] { ["shot": 4.0, "entry": 1.0] }
}
