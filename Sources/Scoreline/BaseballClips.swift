import SwiftUI
import simd

// The baseball theater on the choreography engine, Phase 0 (CHOREOGRAPHY
// §12): today's scripts (a play's replay, a pitch's beat, the field between
// pitches) become clips placed at their entries' anchors (MLB's own pitch
// times when the timeline has them), every hand-off a splice from where
// everyone is. The ballpark is the world frame (nothing turns); the camera
// is today's framings as targets, without yaw. Today's approved play pace
// is kept (§11.4): the motion limits scale with it.

struct DiamondClip: TheaterClip, @unchecked Sendable {
    enum Kind: Equatable, Sendable { case play, beat, rest }

    let script: PlayScript
    let scene: PlayScene?
    let beat: PlayBeat?
    let kind: Kind
    let batting: GameDetail.Side
    let figures: [ClipFigure]
    let length: Double
    let still: Double
    let decisive: Double?
    let essential: Double
    /// Each figure's path re-made through the motion layer (ClipPaths).
    let paths: [MotionPath?]

    static let limits = MotionLimits.baseball(pace: 2.5)

    init(_ script: PlayScript, scene: PlayScene?, beat: PlayBeat?, kind: Kind, batting: GameDetail.Side) {
        self.script = script
        self.scene = scene
        self.beat = beat
        self.kind = kind
        self.batting = batting
        figures = script.actors.map { a in
            let group = switch a.team {
            case .batting: batting == .top ? 0 : 1
            case .fielding: batting == .top ? 1 : 0
            case .official: 2
            }
            let kind = switch a.role {
            case let .fielder(n): "fielder\(n)"
            case .batter: "batter"
            case .runner: "runner"
            case .coach: "coach"
            case .umpire: "umpire"
            }
            return ClipFigure(group: group, kind: kind, band: a.team == .official ? "official" : a.team == .batting ? "runner" : "fielder", height: 8.5)
        }
        let bands = figures.map { Self.limits.band($0.band) }
        paths = script.actors.indices.map { i -> MotionPath? in
            let a = script.actors[i]
            guard a.dive == nil, a.slide == nil else { return nil }
            return ClipPaths.resynthesized(a.moves, contacts: a.actions.map(\.at), band: bands[i], span: 0...max(script.duration, 0)) { a.position(at: $0) }
        }
        length = kind == .rest ? .infinity : script.duration
        still = 0
        decisive = kind == .rest ? nil : script.fence?.at ?? script.release.map { $0 + 0.45 } ?? script.flashes.first?.at
        essential = kind == .rest ? 0 : min(length, (decisive ?? 0) + 1.0)
    }

    /// The script's time at the clip's time `t`: a play holds its end; the field between pitches holds still.
    func local(_ t: Double) -> Double { kind == .rest ? 0 : min(max(t, 0), script.duration) }

    var ambient: Bool { kind == .rest }

    func position(_ figure: Int, at t: Double) -> SIMD2<Double> {
        let u = local(t)
        if let path = paths[figure] { return path.position(at: u) }
        let p = script.actors[figure].position(at: u)
        return SIMD2(Double(p.x), Double(p.y))
    }

    func heading(_ figure: Int, at t: Double) -> Double { figure < script.rig.count ? script.rig[figure].motion(at: local(t)).heading : 0 }
    func opacity(_ figure: Int, at t: Double) -> Double { script.actors[figure].opacity(at: local(t)) }

    func ball(at t: Double) -> ClipBall? {
        let u = local(t)
        guard script.ballOpacity(at: u) > 0.01, let b = script.ball(at: u) else { return nil }
        return .free(SIMD3(b.x, b.y, b.z), flying: script.flights.contains { u > $0.start && u < $0.end })
    }

    func camera(at t: Double) -> SIMD4<Double> {
        let f = script.camera.frame(at: local(t))
        return SIMD4(f.x, f.y, log(max(f.span, 1e-3)), 0)
    }

    func moving(at t: Double) -> Bool { kind != .rest && t >= 0 && t <= length }
}

// MARK: - The plan (Phase 0)

struct DiamondFacts: Equatable, Sendable {
    var topID: String?
    var bottomID: String?
    var names: [String: String] = [:]

    func side(_ id: String?) -> GameDetail.Side? { id == topID ? .top : id == bottomID ? .bottom : nil }
}

/// Baseball's Phase 0 running order: today's per-pitch timeline (PlayBeat):
/// each pitch its beat, each play its replay, the field between pitches
/// between them; nothing passed over (`catchUp` is gone).
struct DiamondSequencer: ClipSequencer {
    let plays: [TimelinePlay<RawPlay>]
    let history: Set<String>
    let facts: DiamondFacts
    let beats: [PlayBeat]
    var last: PlayBeat?
    var lastPlay: PlayScene?

    init(plays: [TimelinePlay<RawPlay>], history: Set<String>, facts: DiamondFacts) {
        self.plays = plays
        self.history = history
        self.facts = facts
        beats = PlayBeat.timeline(plays.map(\.play.json), mlb: [], names: facts.names)
    }

    var limits: MotionLimits { DiamondClip.limits }
    var yawRule: YawRule? { nil }
    var anchorInputs: [AnchorInput] {
        plays.indices.map { i in
            let p = plays[i]
            return AnchorInput(id: p.id, period: p.period, eventTime: p.eventTime, bounds: p.eventBounds, elapsed: nil, live: p.kind.phase == .live,
                               stopsClock: false, weight: p.kind.phase == .live ? 1 : 0.5, gapAfter: p.kind.label == "pitch" ? 6 : 1)
        }
    }

    /// A beat's entry: its anchor is that play's (ESPN's ID before any ".change"/".review" suffix).
    static func entry(_ beat: PlayBeat) -> String { String(beat.id.split(separator: ".").first ?? Substring(beat.id)) }

    func units(handled: Set<String>) -> [TellUnit<PlayBeat>] {
        beats.filter { !handled.contains($0.id) && !history.contains(Self.entry($0)) }.map { b in
            TellUnit(id: b.id, scene: b, admin: b.stands, fromWorld: true, lead: b.isPlay ? 0.9 : 0.4, anchor: Self.entry(b))
        }
    }

    /// The batting side for a beat (between halves, the one about to bat; after a third out, the other).
    func batting(_ b: PlayBeat?) -> GameDetail.Side {
        guard let b else { return .top }
        switch b.kind {
        case let .inningBreak(middle, _): return middle ? .bottom : .top
        case .play where b.outs >= 3: return b.top == false ? .top : .bottom
        default: return b.batting ?? .top
        }
    }

    func rest(for b: PlayBeat?) -> PlayScript.Rest {
        guard let b else { return PlayScript.Rest() }
        let side = batting(b)
        let noBatter: Bool = if case .inningBreak = b.kind { true } else { false }
        return PlayScript.Rest(bases: noBatter ? [false, false, false] : b.bases ?? [false, false, false], bats: noBatter ? nil : b.bats,
                               fieldingHome: side == .top)
    }

    func scene(_ b: PlayBeat) -> PlayScene? {
        let items = plays.map(\.play.json)
        guard let i = items.firstIndex(where: { $0["id"].string == Self.entry(b) }) else { return nil }
        return PlayScene.parse(items, at: i, side: facts.side, names: facts.names)
    }

    func field(at t: PTime) -> DiamondClip {
        let rest = lastPlay.map { PlayTheater.rest(after: $0, bases: nil, bats: last?.bats, batting: $0.batting) } ?? rest(for: last)
        return DiamondClip(PlayScript(rest: rest), scene: nil, beat: nil, kind: .rest, batting: batting(last))
    }

    mutating func opening(at t: PTime) -> DiamondClip {
        last = beats.last { history.contains(Self.entry($0)) }
        return field(at: t)
    }

    mutating func resume(_ kept: [ClipPlacement<DiamondClip>]) {
        if let id = kept.last(where: { $0.play != nil })?.play { last = beats.first { $0.id == id } }
    }

    mutating func clip(for unit: TellUnit<PlayBeat>, at t: PTime, draft: Plan<DiamondClip>) -> DiamondClip {
        let b = unit.scene
        if b.isPlay, let scene = scene(b) {
            let rest = PlayScript.Rest(bases: scene.basesBefore, bats: scene.bats, fieldingHome: batting(b) == .top)
            return DiamondClip(PlayScript(scene, rest: rest), scene: scene, beat: b, kind: .play, batting: scene.batting ?? batting(b))
        }
        return DiamondClip(PlayScript(beat: b, rest: rest(for: b)), scene: nil, beat: b, kind: .beat, batting: batting(b))
    }

    mutating func told(_ unit: TellUnit<PlayBeat>) {
        last = unit.scene
        if unit.scene.isPlay { lastPlay = scene(unit.scene) }
    }

    mutating func rest(after unit: TellUnit<PlayBeat>, at t: PTime, draft: Plan<DiamondClip>) -> DiamondClip { field(at: t) }
    mutating func next(after clip: DiamondClip, at t: PTime, draft: Plan<DiamondClip>) -> DiamondClip { field(at: t) }

    func cues(for unit: TellUnit<PlayBeat>, clip: DiamondClip, at decisive: PTime) -> [Cue] {
        guard let scene = clip.scene, scene.runs > 0 else { return [] }
        return [Cue(at: decisive, until: decisive + 3, kind: .scored(scene.id), source: .known(play: scene.id))]
    }

    func handOff(_ draft: inout Plan<DiamondClip>, _ k: Int) {}
}

// MARK: - Painting

enum DiamondPainter {
    private static let ink = TheaterInk(.dark)
    private static let teams = TheaterTeams(batting: .red, fielding: .blue)

    static func charge(_ plan: Plan<DiamondClip>, at p: PTime) -> Int? {
        plan.placements.lastIndex { $0.offset <= p && $0.start <= p } ?? plan.placement(at: p)
    }

    /// One frame of the engine's world through today's baseball frame: the clip in charge and its time; each of its
    /// figures where the engine has his man, posed by it; everyone else in his own kit; the ball.
    static func frame(_ chain: PlanChain<DiamondClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: DiamondClip, t: Double, world: PlayFrame.World)? {
        guard scratch.plan >= 0, scratch.plan < chain.plans.count else { return nil }
        let baked = chain.plans[scratch.plan]
        let plan = baked.plan
        guard let k = charge(plan, at: scratch.p) else { return nil }
        let placement = plan.placements[k]
        let clip = placement.clip
        let t = clip.local(placement.time(scratch.p))
        let camera = CameraFrame(x: scratch.camera.x, y: scratch.camera.y, span: exp(scratch.camera.z))
        let f = FieldProjection(size: size, camera: camera)
        var figures: [Int: PlayFrame.World.Figure] = [:]
        var extras: [PlayFrame.World.Extra] = []
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            let here = CGPoint(x: actor.position.x, y: actor.position.y)
            let unit = RigLens(f, at: here).unit
            func posed(_ k: Int, _ figure: Int, _ time: Double) -> (RigPose, Double)? {
                let c = plan.placements[k].clip
                guard figure < c.script.actors.count else { return nil }
                let frame = PlayFrame(scene: c.scene, script: c.script, t: c.local(time), teams: teams, ink: ink, size: size)
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
                // His kit as the clip in charge dresses its teams: the same side, batting or fielding now.
                let side: GameDetail.Side? = switch team {
                case .batting: own.batting
                case .fielding: own.batting == .top ? .bottom : .top
                case .official: nil
                }
                let drawn: PlayScript.Team = side.map { $0 == clip.batting ? .batting : .fielding } ?? team
                extras.append(.init(index: Int(actor.id.raw), team: drawn, at: here, body: body, heading: now.1, opacity: actor.opacity))
            }
        }
        var ball: FieldPoint?
        switch scratch.ball {
        case let .clip(j):
            let q = plan.placements[j]
            if case let .free(point, _)? = q.clip.ball(at: q.time(scratch.p)) { ball = FieldPoint(x: point.x, y: point.y, z: point.z) }
        case let .free(point):
            ball = FieldPoint(x: point.x, y: point.y, z: point.z)
        case .held, .none:
            break
        }
        return (clip, t, PlayFrame.World(camera: camera, figures: figures, extras: extras, ball: ball))
    }
}

/// Baseball on the director (Phase 0): today's scripts as clips.
enum DiamondSport: TheaterSport {
    /// Baseball's director reads the feed's plays as they are.
    static func scene(_ raw: [RawPlay], _ json: [JSON], at i: Int, pending: Bool, facts: DiamondFacts, context: Int,
                      prior: [RawPlay?]) -> RawPlay? {
        raw[i]
    }

    static var sceneReach: Int { 0 }

    static func plan(_ plays: [TimelinePlay<RawPlay>], history: Set<String>, facts: DiamondFacts, chain: PlanChain<DiamondClip>, at c: PTime,
                     shift: Double, deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<DiamondClip> {
        var sequencer = DiamondSequencer(plays: plays, history: history, facts: facts)
        return TheaterPlanner.plan(&sequencer, history: history, chain: chain, at: c, shift: shift, deferFrom: deferFrom, revision: revision,
                                   nextID: &nextID)
    }

    /// A pitch's horizon: the windup and the stretch before its release; a play's result as its pitch.
    static var horizons: [String: Double] { ["pitch": 4.0, "result": 4.0, "event": 0] }
}
