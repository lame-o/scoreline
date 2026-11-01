import SwiftUI
import simd

// The football theater on the choreography engine, Phase 0 (CHOREOGRAPHY
// §12): today's scripts (a snap's replay, its try, the field between snaps)
// become clips placed at their plays' anchors, every hand-off a splice from
// the world as it stands.
//
// The world frame is the frame of an offense attacking the screen's right
// (yaw +30°): x across (its right +), y downfield from its own goal line. A
// script for an offense attacking the screen's left (yaw −30°) is the field
// turned half a turn about its center into the world, and the view's yaw
// there is 150°: a change of possession that reverses direction orbits the
// camera 120° (football's only possession orbit, §7.2), never a snap.

enum GridWorld {
    static let center = SIMD2(0.0, 150.0)

    /// Whether a script's frame is the world's (its offense attacks the screen's right).
    static func right(_ yaw: Double) -> Bool { yaw >= 0 }

    static func point(_ p: CGPoint, right: Bool) -> SIMD2<Double> { right ? SIMD2(p.x, p.y) : 2 * center - SIMD2(p.x, p.y) }
    static func local(_ p: SIMD2<Double>, right: Bool) -> CGPoint { let q = right ? p : 2 * center - p; return CGPoint(x: q.x, y: q.y) }
    static func point(_ p: FieldPoint, right: Bool) -> SIMD3<Double> { let g = point(p.ground, right: right); return SIMD3(g.x, g.y, p.z) }
    static func heading(_ h: Double, right: Bool) -> Double { right ? h : h + .pi }

    /// A script's framing at its yaw as the world camera.
    static func camera(_ frame: CameraFrame, yaw: Double, right: Bool) -> SIMD4<Double> {
        let vx = frame.x, vy = 2 * frame.y
        let ground = SIMD2(vx * cos(yaw) - vy * sin(yaw), vx * sin(yaw) + vy * cos(yaw))
        let world = right ? ground : 2 * center - ground
        return SIMD4(world.x, world.y, log(frame.span), right ? yaw : yaw + .pi)
    }

    /// The world camera in a script's frame.
    static func frame(_ camera: SIMD4<Double>, right: Bool) -> (frame: CameraFrame, yaw: Double) {
        let yaw = right ? camera.w : camera.w - .pi
        let c = local(SIMD2(camera.x, camera.y), right: right)
        let view = Gridiron.view(c, yaw: yaw)
        return (CameraFrame(x: view.x, y: view.y / 2, span: exp(camera.z)), yaw)
    }
}

/// One of today's football scripts as the engine places it: a snap's replay (or its try), or the field between snaps.
struct GridClip: TheaterClip, @unchecked Sendable {
    enum Kind: Equatable, Sendable { case replay, idle }

    let script: FootballScript
    let scene: FootballScene?
    let idle: FootballIdle?
    let stoppage: FootballStoppage?
    let kind: Kind
    let right: Bool
    let offense: GameDetail.Side
    let figures: [ClipFigure]
    let length: Double
    let still: Double
    let decisive: Double?
    let essential: Double
    let paths: [MotionPath?]
    private let loopStart: Double?
    private let loopPeriod: Double
    private let endTime: Double

    init(_ script: FootballScript, scene: FootballScene?, idle: FootballIdle?, offense: GameDetail.Side, stoppage: FootballStoppage? = nil) {
        self.script = script
        self.scene = scene
        self.idle = idle
        self.stoppage = stoppage
        self.offense = offense
        kind = idle == nil ? .replay : .idle
        right = GridWorld.right(script.yaw)
        figures = script.players.indices.map { i in
            let p = script.players[i]
            let group = switch p.team {
            case .offense: offense == .top ? 0 : 1
            case .defense: offense == .top ? 1 : 0
            case .official, .staff: 2
            }
            let line: Set<FootballScript.Role> = [.line, .front]
            return ClipFigure(group: group, kind: p.key ?? "\(p.role)", athlete: script.credits[i].flatMap { $0.id ?? $0.name },
                              band: p.team == .official || p.team == .staff ? "official" : line.contains(p.role) ? "line" : "skill", height: 8.5)
        }
        let bands = script.players.map { p in
            MotionLimits.football.band(p.team == .official || p.team == .staff ? "official" : [.line, .front].contains(p.role) ? "line" : "skill")
        }
        let paths = script.players.indices.map { i -> MotionPath? in
            let p = script.players[i]
            let contacts = p.actions.filter { [.catchHigh, .catchChest, .throwBall, .handoff, .kick, .tackle, .strip, .scoop].contains($0.kind) }
            return ClipPaths.resynthesized(p.moves, contacts: contacts.map(\.at), band: bands[i], span: 0...max(script.duration, 0), retime: idle == nil) {
                p.position(at: $0)
            }
        }
        self.paths = paths
        // A replay runs slower where anyone would outrun his legs, the ball's flights at their own pace (the field
        // between snaps loops: it keeps its own time).
        let warp = ClipWarp.make(length: script.duration, need: { u in
            var most = 1.0
            for i in paths.indices {
                guard let path = paths[i], script.players[i].opacity(at: u) > 0.05 else { continue }
                let b = bands[i]
                most = max(most, simd_length(path.velocity(at: u)) / (b.sprint * 0.97),
                           (simd_length(path.acceleration(at: u)) / (min(b.accel, b.decel, b.lateral) * 0.97)).squareRoot())
            }
            return most
        }, steady: { u in script.flight(at: u).map { $0.end - $0.start < 1.5 } ?? false }) ?? .identity
        self.warp = warp
        endTime = warp.clip(script.duration)
        loopStart = script.loop.map { warp.clip($0.start) }
        loopPeriod = script.loop.map { warp.clip($0.start + $0.period) - warp.clip($0.start) } ?? 0
        length = idle == nil ? (warp.isIdentity ? script.duration : warp.stretched) : .infinity
        // Whoever still can't make a replay's run, even slowed, fades through it (declared, counted).
        fades = idle != nil ? .none : ClipFades.make(figures: paths.count, length: warp.isIdentity ? script.duration : warp.stretched, bands: bands) { i, t in
            guard let path = paths[i] else { return 0 }
            let rate = (warp.script(t + 0.004) - warp.script(t - 0.004)) / 0.008
            return simd_length(path.velocity(at: warp.script(t))) * rate
        }
        still = idle == nil ? warp.clip(script.leadIn) : 0
        decisive = idle == nil ? Self.decisive(script).map(warp.clip) : nil
        essential = idle == nil ? min(length, (decisive ?? 0) + 1.2) : 0
    }

    /// A replay's own time stretched where it asked too much of anyone (ClipWarp).
    let warp: ClipWarp
    /// The men who still can't make it, faded through (ClipFades).
    let fades: ClipFades

    /// The ball dead: the score, else the hit or the catch that ends it, else the incompletion's landing.
    static func decisive(_ s: FootballScript) -> Double? {
        if let score = s.score { return score }
        if let hit = s.flashes.last(where: { $0.beat == .hit })?.at { return hit }
        if let caught = s.flashes.last(where: { $0.beat == .catchBall })?.at { return caught }
        if let f = s.flights.last { return f.end }
        return s.stamp.isFinite ? s.stamp - 0.3 : nil
    }

    /// An idle loops; a replay holds its end.
    func local(_ t: Double) -> Double {
        guard kind == .idle else { return min(max(warp.script(t), 0), script.duration) }
        // The field between snaps loops in its stretched time, then reads the script there.
        guard let start = loopStart, loopPeriod > 0, t > start + loopPeriod else { return warp.script(min(max(t, 0), endTime)) }
        return warp.script(start + (t - start).truncatingRemainder(dividingBy: loopPeriod))
    }

    var ambient: Bool { kind == .idle }

    func position(_ figure: Int, at t: Double) -> SIMD2<Double> {
        if let path = paths[figure] {
            let p = path.position(at: local(t))
            return GridWorld.point(CGPoint(x: p.x, y: p.y), right: right)
        }
        return GridWorld.point(script.players[figure].position(at: local(t)), right: right)
    }

    func heading(_ figure: Int, at t: Double) -> Double {
        let h = figure < script.rig.count ? script.rig[figure].motion(at: local(t)).heading : 0
        return GridWorld.heading(h, right: right)
    }

    func opacity(_ figure: Int, at t: Double) -> Double { script.players[figure].opacity(at: local(t)) * fades.opacity(figure, at: t) }

    func ball(at t: Double) -> ClipBall? {
        let lt = local(t)
        if let carrier = script.carrier(at: lt) { return .held(figure: carrier.player) }
        guard let b = script.ball(at: lt) else { return nil }
        return .free(GridWorld.point(b, right: right), flying: script.flight(at: lt) != nil)
    }

    func camera(at t: Double) -> SIMD4<Double> {
        let lt = local(t)
        return GridWorld.camera(script.camera.frame(at: lt), yaw: script.yaw(at: lt), right: right)
    }

    func moving(at t: Double) -> Bool {
        guard t >= 0 else { return false }
        if kind == .replay { return t <= length }
        guard t < endTime || loopStart != nil else { return false }
        return script.moving(at: local(t))
    }
}

// MARK: - The plan (Phase 0)

struct GridFacts: Equatable, Sendable {
    var topIsHome = false
    var flipped = false
    var topID: String?
    var bottomID: String?
    var homeAbbreviation = ""
    var awayAbbreviation = ""
    var homeName = ""
    var awayName = ""

    init(topIsHome: Bool = false, flipped: Bool = false, topID: String? = nil, bottomID: String? = nil, homeAbbreviation: String = "",
         awayAbbreviation: String = "", homeName: String = "", awayName: String = "") {
        self.topIsHome = topIsHome
        self.flipped = flipped
        self.topID = topID
        self.bottomID = bottomID
        self.homeAbbreviation = homeAbbreviation
        self.awayAbbreviation = awayAbbreviation
        self.homeName = homeName
        self.awayName = awayName
    }

    /// The page's teams (FootballFeed's).
    init(_ teams: FootballFeed.Teams) {
        self.init(topIsHome: teams.topIsHome, topID: teams.topID, bottomID: teams.bottomID, homeAbbreviation: teams.homeAbbreviation,
                  awayAbbreviation: teams.awayAbbreviation, homeName: teams.homeName, awayName: teams.awayName)
    }

    var teams: FootballFeed.Teams {
        var t = FootballFeed.Teams(topIsHome: topIsHome, topID: topID, bottomID: bottomID, homeAbbreviation: homeAbbreviation,
                                   awayAbbreviation: awayAbbreviation)
        t.homeName = homeName
        t.awayName = awayName
        return t
    }
}

/// A football entry as the planner reads it: a snap (or kick), or a stoppage.
enum GridPlay: Equatable, Sendable {
    case snap(FootballScene)
    case stoppage(FootballStoppage)

    var id: String {
        switch self {
        case let .snap(s): s.id
        case let .stoppage(s): s.id
        }
    }
}

enum GridPlanner {
    /// The timeline's entries as snaps and stoppages, each snap spotted on its hash from the one before (FootballFeed's rule).
    static func plays(_ snapshot: TimelineSnapshot<RawPlay>, teams: FootballFeed.Teams) -> [TimelinePlay<GridPlay>] {
        var out: [TimelinePlay<GridPlay>] = []
        var last: FootballScene?
        for p in snapshot.plays {
            if let scene = FootballScene.parse(p.play.json, teams: teams) {
                var s = scene
                if let last { s.hash = FootballFeed.spot([s], after: last).first?.hash ?? s.hash }
                last = s
                if let mapped = p.map({ _ in GridPlay.snap(s) }) { out.append(mapped) }
            } else if let stop = FootballStoppage.parse(p.play.json, teams: teams), let mapped = p.map({ _ in GridPlay.stoppage(stop) }) {
                out.append(mapped)
            }
        }
        return out
    }

    /// The least time between two snaps' dead balls (a huddle-less snap is ~15 s; 8 s is the physical floor).
    static func inputs(_ plays: [TimelinePlay<GridPlay>]) -> [AnchorInput] {
        plays.indices.map { i in
            let p = plays[i]
            let snap: Bool = if case .snap = p.play { true } else { false }
            var weight = snap ? 1.0 : 0.25
            if p.estimated { weight *= 0.25 }
            return AnchorInput(id: p.id, period: p.period, eventTime: p.eventTime, bounds: p.eventBounds, elapsed: p.clock.elapsed, live: snap,
                               stopsClock: p.kind.stopsClock, weight: weight, gapAfter: snap ? 8 : 1, restartAfter: 1)
        }
    }
}

/// Football's Phase 0 running order: each snap its replay (a touchdown's try after it), the field between snaps
/// from where the snap left it (never the live situation: the field follows the told plays), the stoppages ESPN posts.
struct GridSequencer: ClipSequencer {
    let plays: [TimelinePlay<GridPlay>]
    let history: Set<String>
    let facts: GridFacts
    /// The last snap told, the stoppage after it, and whether a score's kickoff is next.
    var last: FootballScene?
    var stoppage: FootballStoppage?

    var limits: MotionLimits { .football }
    var yawRule: YawRule? { nil }
    var anchorInputs: [AnchorInput] { GridPlanner.inputs(plays) }

    func units(handled: Set<String>) -> [TellUnit<GridPlay>] {
        var out: [TellUnit<GridPlay>] = []
        for p in plays where !handled.contains(p.id) && !history.contains(p.id) {
            switch p.play {
            case let .snap(scene):
                out.append(TellUnit(id: scene.id, scene: p.play, fromWorld: false))
                if let attempt = scene.conversion, !handled.contains(attempt.id) {
                    out.append(TellUnit(id: attempt.id, scene: .snap(attempt), fromWorld: false))
                }
            case .stoppage:
                out.append(TellUnit(id: p.id, scene: p.play, admin: true, fromWorld: true))
            }
        }
        return out
    }

    /// The field the next snap lines up on, in its offense's yards, from where the last one ended.
    func spot(after scene: FootballScene?) -> (rest: FootballScript.Rest, offense: GameDetail.Side) {
        guard let scene, let offense = scene.offense else { return (FootballScript.Rest(yard: 25, gain: 35), .top) }
        let next = scene.flips ? FootballScene.opponent(offense) : offense
        let yard = scene.flips ? 100 - scene.to : scene.to
        let gain = scene.flips ? nil : scene.gainAfter
        return (FootballScript.Rest(yard: min(max(yard, 1), 99), gain: gain), next)
    }

    func idle(at t: PTime) -> GridClip {
        let (rest, offense) = spot(after: last)
        let kickoff = last?.scoring != nil && last?.conversion == nil
        let idle = FootballIdle.make(play: last, stoppage: stoppage, rest: rest, offense: offense, down: last?.after, kickoff: kickoff,
                                     flipped: facts.flipped)
        return GridClip(FootballScript(idle: idle), scene: nil, idle: idle, offense: idle.offense, stoppage: stoppage)
    }

    mutating func opening(at t: PTime) -> GridClip {
        for p in plays where history.contains(p.id) {
            switch p.play {
            case let .snap(s): last = s; stoppage = nil
            case let .stoppage(s): stoppage = s
            }
        }
        return idle(at: t)
    }

    mutating func resume(_ kept: [ClipPlacement<GridClip>]) {
        // The running order as the kept placements left it: the last snap told and any stoppage after it.
        for p in plays {
            guard kept.contains(where: { $0.covers.contains(p.id) }) || history.contains(p.id) else { continue }
            switch p.play {
            case let .snap(s): last = s; stoppage = nil
            case let .stoppage(s): stoppage = s
            }
        }
    }

    mutating func clip(for unit: TellUnit<GridPlay>, at t: PTime, draft: Plan<GridClip>) -> GridClip {
        switch unit.scene {
        case let .snap(scene):
            let yaw = FieldFacing.yaw(scene.offense, period: scene.period, flipped: facts.flipped)
            return GridClip(FootballScript(scene, yaw: yaw), scene: scene, idle: nil, offense: scene.offense ?? .top)
        case let .stoppage(stop):
            var copy = self
            copy.stoppage = stop
            return copy.idle(at: t)
        }
    }

    mutating func told(_ unit: TellUnit<GridPlay>) {
        switch unit.scene {
        case let .snap(s): last = s; stoppage = nil
        case let .stoppage(s): stoppage = s
        }
    }

    mutating func rest(after unit: TellUnit<GridPlay>, at t: PTime, draft: Plan<GridClip>) -> GridClip { idle(at: t) }

    mutating func next(after clip: GridClip, at t: PTime, draft: Plan<GridClip>) -> GridClip { idle(at: t) }

    func cues(for unit: TellUnit<GridPlay>, clip: GridClip, at decisive: PTime) -> [Cue] {
        guard case let .snap(scene) = unit.scene, scene.scoring != nil else { return [] }
        return [Cue(at: decisive, until: decisive + 3, kind: .scored(scene.id), source: .known(play: scene.id))]
    }

    func handOff(_ draft: inout Plan<GridClip>, _ k: Int) { TheaterHandOff.ball(&draft, k, speed: 50, height: 3.4) }
}

// MARK: - Painting

enum GridPainter {
    private static let ink = TheaterInk(.dark)
    private static let teams = FootballTeams(offense: Uniform(.green), defense: Uniform(.blue))

    static func charge(_ plan: Plan<GridClip>, at p: PTime) -> Int? {
        plan.placements.lastIndex { $0.offset <= p && $0.start <= p } ?? plan.placement(at: p)
    }

    /// One frame of the engine's world through today's football frame: the clip in charge, its time, the world in its frame.
    static func frame(_ chain: PlanChain<GridClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: GridClip, t: Double, world: FootballFrame.World)? {
        guard scratch.plan >= 0, scratch.plan < chain.plans.count else { return nil }
        let baked = chain.plans[scratch.plan]
        let plan = baked.plan
        guard let k = charge(plan, at: scratch.p) else { return nil }
        let clip = plan.placements[k].clip
        let t = clip.local(plan.placements[k].time(scratch.p))
        let turned = !clip.right
        let (camera, yaw) = GridWorld.frame(scratch.camera, right: clip.right)
        let f = GridProjection(size: size, camera: camera, yaw: yaw)
        let offenseGroup = clip.offense == .top ? 0 : 1
        var holder: ActorID?
        var tucked = 0.0, cocked = 0.0
        var ball: FootballFrame.World.Ball?
        switch scratch.ball {
        case let .clip(j):
            let q = plan.placements[j]
            let lt = q.clip.local(q.time(scratch.p))
            if let carrier = q.clip.script.carrier(at: lt), carrier.player < q.cast.count {
                holder = q.cast[carrier.player]
                let player = q.clip.script.players[carrier.player]
                cocked = FootballFrame.cocked(player, at: lt, pace: q.clip.script.pace)
                tucked = player.role == .quarterback ? Rig.smooth((Double(scratch.actors.first { $0.id == holder }?.motion.speed ?? 0) - 1.5) / 1) : 1
                ball = .held
            } else if case let .free(point, flying)? = q.clip.ball(at: lt) {
                ball = .free(FieldPoint(GridWorld.local(SIMD2(point.x, point.y), right: clip.right), z: point.z), flying: flying)
            }
        case let .held(id):
            holder = id
            ball = .held
        case let .free(point):
            ball = .free(FieldPoint(GridWorld.local(SIMD2(point.x, point.y), right: clip.right), z: point.z), flying: true)
        case .none:
            break
        }
        var figures: [FootballFrame.World.Figure] = []
        figures.reserveCapacity(scratch.actors.count)
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            let here = GridWorld.local(actor.position, right: clip.right)
            let worldHere = CGPoint(x: actor.position.x, y: actor.position.y)
            let unit = RigLens(f, at: here).unit
            func posed(_ placement: Int, _ figure: Int, _ time: Double) -> (RigPose, Double, Bool)? {
                let c = plan.placements[placement].clip
                guard figure < c.script.players.count else { return nil }
                let lt = c.local(time)
                let frame = FootballFrame(scene: c.scene, script: c.script, t: lt, teams: teams, ink: ink, size: size)
                let (body, heading) = frame.pose(c.script.players[figure], figure, at: here, unit: unit, stride: (track.rig, scratch.p, worldHere))
                let down = [.down, .knocked].contains(c.script.players[figure].hold(at: lt)?.kind)
                return (body, heading, down)
            }
            guard let now = posed(actor.placement, actor.figure, actor.clipTime) else { continue }
            var body = now.0
            if actor.previousPlacement >= 0, actor.blend < 1, let (from, _, _) = posed(actor.previousPlacement, actor.previousFigure, actor.previousTime) {
                body = from.mix(body, actor.blend)
            }
            let group = track.figure.group
            let placement = plan.placements[actor.placement]
            let team: FootballScript.Team = group == 2 ? (placement.clip.script.players[actor.figure].team) : group == offenseGroup ? .offense : .defense
            let mine = holder == actor.id
            figures.append(.init(index: Int(actor.id.raw), team: team, at: here, body: body, heading: turned ? now.1 - .pi : now.1, opacity: actor.opacity,
                                 holds: mine, tucked: mine ? tucked : 0, cocked: mine ? cocked : 0, down: now.2))
        }
        return (clip, t, FootballFrame.World(camera: camera, yaw: yaw, figures: figures, ball: ball))
    }
}

/// Football on the director (Phase 0): today's scripts as clips.
enum GridSport: TheaterSport {
    /// The snaps up to the watermark, each spotted after the one before (`GridPlanner.plays`), and the stoppages.
    static func scene(_ raw: [RawPlay], _ json: [JSON], at i: Int, pending: Bool, facts: GridFacts, context: Int, prior: [GridPlay?]) -> GridPlay? {
        guard !pending else { return nil }
        if var scene = FootballScene.parse(json[i], teams: facts.teams) {
            if let last = prior.lazy.reversed().compactMap({ p -> FootballScene? in if case .snap(let s)? = p { s } else { nil } }).first {
                scene.hash = FootballFeed.spot([scene], after: last).first?.hash ?? scene.hash
            }
            return .snap(scene)
        }
        return FootballStoppage.parse(json[i], teams: facts.teams).map { .stoppage($0) }
    }

    static var sceneReach: Int { 1 }

    static func plan(_ plays: [TimelinePlay<GridPlay>], history: Set<String>, facts: GridFacts, chain: PlanChain<GridClip>, at c: PTime,
                     shift: Double, deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<GridClip> {
        var sequencer = GridSequencer(plays: plays, history: history, facts: facts)
        return TheaterPlanner.plan(&sequencer, history: history, chain: chain, at: c, shift: shift, deferFrom: deferFrom, revision: revision,
                                   nextID: &nextID)
    }

    /// The snap's dead ball ~6 s (a line-up and the play); a kick's longer; the stoppages none (they attach late).
    static var horizons: [String: Double] { ["snap": 6, "kick": 8, "penalty": 6] }
}
