import SwiftUI
import simd

// The basketball theater on the choreography engine, Phase 0 (CHOREOGRAPHY
// §12): today's scripts (a marquee replay, a beat, the court between plays)
// become clips the engine places at their plays' anchors, and every hand-off
// between them is a splice from the world as it stands.
//
// The world frame is the absolute court (§7.1): x 0–94 along it, y 0–50 from
// the near sideline, the right basket at x = 88.75. A script is laid out in
// its own frame, the offense attacking the basket at x = 88.75, and drawn
// turned half a turn when its play is at the left basket; in the world that
// half turn is the figures' (x → 94 − x, y → 50 − y), and the view's yaw is
// −30° at the right basket and +30° at the left: a camera parameter that
// orbits as the ball changes ends, never a frame that snaps (B4).

enum HoopsWorld {
    /// The court's center: a left-basket script turns about it.
    static let center = SIMD2(Hoops.length / 2, Hoops.width / 2)

    /// The world yaw at each basket.
    static func yaw(right: Bool) -> Double { right ? -Hoops.turn : Hoops.turn }

    /// Whether a script is laid out at the right basket (its yaw is the right's).
    static func right(_ yaw: Double) -> Bool { abs(remainder(yaw - Hoops.yaw(right: true), 2 * .pi)) < 0.1 }

    /// A point of a script's frame in the world.
    static func point(_ p: CGPoint, right: Bool) -> SIMD2<Double> {
        right ? SIMD2(p.x, p.y) : SIMD2(Hoops.length - p.x, Hoops.width - p.y)
    }

    /// A world point in a script's frame.
    static func local(_ p: SIMD2<Double>, right: Bool) -> CGPoint {
        right ? CGPoint(x: p.x, y: p.y) : CGPoint(x: Hoops.length - p.x, y: Hoops.width - p.y)
    }

    static func point(_ p: FieldPoint, right: Bool) -> SIMD3<Double> {
        let g = point(p.ground, right: right)
        return SIMD3(g.x, g.y, p.z)
    }

    /// A heading of a script's frame in the world.
    static func heading(_ h: Double, right: Bool) -> Double { right ? h : h + .pi }

    /// A script's camera framing (in its view, at its yaw) as the world camera:
    /// the ground point at the view's center, the span, the world yaw.
    static func camera(_ frame: CameraFrame, yaw: Double) -> SIMD4<Double> {
        let right = right(yaw)
        // The view's (x, y) back onto the ground: y was halved by the dimetric view.
        let vx = frame.x, vy = 2 * frame.y
        let ground = SIMD2(vx * cos(yaw) - vy * sin(yaw), vx * sin(yaw) + vy * cos(yaw))
        let world = right ? ground : SIMD2(Hoops.length, Hoops.width) - ground
        return SIMD4(world.x, world.y, log(frame.span), Self.yaw(right: right))
    }
}

// MARK: - Clips

/// One of today's basketball scripts as the engine places it: a marquee
/// replay, a lighter beat, or the court between plays.
struct HoopsClip: TheaterClip, @unchecked Sendable {
    enum Kind: Equatable, Sendable { case replay, beat, rest }

    let script: BasketballScript
    let scene: BasketballScene?
    let kind: Kind
    /// Laid out at the right basket (else turned half a turn into the world).
    let right: Bool
    let figures: [ClipFigure]
    let length: Double
    let still: Double
    let decisive: Double?
    let essential: Double
    /// The rest it was built from (the court between plays), for the next one's flow.
    let rest: BasketballScript.Rest?

    init(_ script: BasketballScript, scene: BasketballScene?, kind: Kind, rest: BasketballScript.Rest? = nil) {
        self.script = script
        self.scene = scene
        self.kind = kind
        self.rest = rest
        right = HoopsWorld.right(script.yaw)
        let offense = script.side ?? .top
        figures = script.players.indices.map { i in
            let p = script.players[i]
            let group = switch p.team {
            case .offense: offense == .top ? 0 : 1
            case .defense: offense == .top ? 1 : 0
            case .official: 2
            }
            return ClipFigure(group: group, kind: p.team == .official ? "official" : "player",
                              athlete: script.credits[i].flatMap { $0.id ?? $0.name }, band: p.team == .official ? "official" : "wing",
                              height: Hoops.ground)
        }
        let bands = script.players.map { MotionLimits.basketball.band($0.team == .official ? "official" : "wing") }
        let paths = script.players.indices.map { Self.resynthesized(script.players[$0], band: bands[$0], span: 0...script.duration) }
        self.paths = paths
        // Slower where anyone would outrun his legs, the ball's flights at their own pace.
        warp = ClipWarp.make(length: script.duration, need: { u in
            var most = 1.0
            for i in paths.indices {
                guard let path = paths[i], script.players[i].opacity(at: u) > 0.05 else { continue }
                let b = bands[i]
                most = max(most, simd_length(path.velocity(at: u)) / (b.sprint * 0.97),
                           (simd_length(path.acceleration(at: u)) / (min(b.accel, b.decel, b.lateral) * 0.97)).squareRoot())
            }
            return most
        }, steady: { u in script.flights.contains { u > $0.start && u < $0.end && $0.end - $0.start < 1.5 } }) ?? .identity
        length = warp.isIdentity ? script.duration : warp.stretched
        still = kind == .replay ? warp.clip(script.leadIn) : 0
        decisive = Self.decisive(script, scene: scene, kind: kind).map(warp.clip)
        essential = kind == .rest ? 0 : min(length, (decisive ?? 0) + (kind == .replay ? 1.6 : 0.8))
    }

    /// The script's own time stretched where it asked too much of anyone (ClipWarp).
    let warp: ClipWarp

    /// The script's time at the clip's time `t`.
    func local(_ t: Double) -> Double { warp.script(t) }

    /// Each figure's path re-made through the motion layer (ClipPaths).
    let paths: [MotionPath?]

    static func resynthesized(_ player: BasketballScript.Player, band: MotionLimits.Band, span: ClosedRange<Double>) -> MotionPath? {
        let contacts = player.actions.filter { [.catchBall, .pass, .lob, .shoot, .layup, .dunk, .hook, .tip, .rebound, .steal, .block].contains($0.kind) }
        return ClipPaths.resynthesized(player.moves, contacts: contacts.map(\.at), band: band, span: span) { player.position(at: $0) }
    }

    /// The instant a clip's play is about (CHOREOGRAPHY §5.1's decisive moment, as today's scripts stage it).
    static func decisive(_ s: BasketballScript, scene: BasketballScene?, kind: Kind) -> Double? {
        guard kind != .rest, let scene else { return nil }
        func flash(_ beat: BasketballScript.Beat) -> Double? { s.flashes.first { $0.beat == beat }?.at }
        switch scene.kind {
        case .jumper, .three, .layup, .dunk, .alleyOop, .putback, .freeThrow:
            return s.score ?? s.rimHit ?? flash(.rim) ?? s.release
        case .block:
            return flash(.block) ?? s.release
        case .offensiveRebound, .defensiveRebound:
            return flash(.catchBall) ?? s.players.lazy.flatMap(\.actions).first { $0.kind == .rebound }?.at ?? 0.5
        case .steal, .turnover:
            return flash(.steal) ?? flash(.whistle) ?? s.tag?.at ?? 0.5
        case .foul, .violation:
            return flash(.whistle) ?? s.tag?.at ?? 0.5
        case .jumpBall:
            return s.players.lazy.flatMap(\.actions).first { $0.kind == .toss }?.at ?? flash(.catchBall) ?? 0.5
        case .substitution, .timeout, .periodEnd, .challenge:
            return flash(.horn) ?? s.tag?.at ?? 0.3
        }
    }

    var ambient: Bool { kind == .rest }

    func position(_ figure: Int, at t: Double) -> SIMD2<Double> {
        let u = local(t)
        if let path = paths[figure] {
            let p = path.position(at: u)
            return HoopsWorld.point(CGPoint(x: p.x, y: p.y), right: right)
        }
        return HoopsWorld.point(script.players[figure].position(at: u), right: right)
    }

    func heading(_ figure: Int, at t: Double) -> Double {
        let h = figure < script.rig.count ? script.rig[figure].motion(at: local(t)).heading : 0
        return HoopsWorld.heading(h, right: right)
    }

    func opacity(_ figure: Int, at t: Double) -> Double { script.players[figure].opacity(at: local(t)) }

    func ball(at t: Double) -> ClipBall? {
        let u = local(t)
        if let carrier = script.carrier(at: u) { return .held(figure: carrier.player) }
        guard let b = script.ball(at: u) else { return nil }
        return .free(HoopsWorld.point(b, right: right), flying: script.flight(at: u) != nil)
    }

    func camera(at t: Double) -> SIMD4<Double> { HoopsWorld.camera(script.camera.frame(at: local(t)), yaw: script.yaw) }

    func moving(at t: Double) -> Bool {
        let u = local(t)
        guard t >= 0, u <= script.duration else { return false }
        return kind == .rest ? script.active.contains { $0.contains(u) } : true
    }

    /// The floor's shape at t (play, the lane, the benches…): a beat that follows starts from it only in play.
    var formation: Lineup.Formation { script.formation }
}

// MARK: - The running order (Phase 0)

extension BasketballQueue {
    /// Every play still to tell after `told`, as the units today's queue would
    /// make (substitutions at one stoppage together, a miss with its rebound,
    /// a replay with the lead-in it retells), none passed over: on p there's
    /// time for all of them. (pure)
    static func units(_ plays: [BasketballScene], told: Set<String>) -> [Unit] {
        let pending = plays.filter { !told.contains($0.id) }
        let ids = Set(pending.map(\.id))
        let retold = Set(pending.filter(\.replays).flatMap(\.leadIn))
        var units: [Unit] = []
        var covered = Set<String>()
        var i = 0
        while i < pending.count {
            let play = pending[i]
            i += 1
            if covered.contains(play.id) || retold.contains(play.id) { continue }
            var unit = Unit(scene: play)
            if play.kind == .substitution {
                unit.group = [play]
                while i < pending.count, pending[i].kind == .substitution {
                    unit.group.append(pending[i])
                    i += 1
                }
            }
            let later = play.follows.filter(ids.contains)
            unit.covers = later + (play.replays ? play.leadIn.filter(ids.contains) : []) + unit.group.dropFirst().map(\.id)
            covered.formUnion(later)
            units.append(unit)
        }
        return units
    }
}

// MARK: - Anchors (§5.1, §7.1)

enum HoopsAnchors {
    /// How long before a play's decisive moment the theater needs its details
    /// (the binding horizon, by the timeline's kind label): a shot's catch or
    /// gather ~2.5 s before its release, the free throw's routine 4 s; dead-ball
    /// admin never (it attaches to the stoppage on screen).
    static let horizons: [String: Double] = ["shot": 3.5, "rebound": 2.5, "turnover": 3.0, "jump ball": 3.0, "free throw": 4.0,
                                             "foul": 0, "timeout": 0, "substitution": 0, "review": 0, "team rebound": 0,
                                             "period end": 0, "game end": 0]

    /// A shot's flight, rim to release (s): a three about 1.2 s.
    static func flight(_ distance: Double) -> Double { 0.55 + 0.027 * distance }

    /// The plays as the anchor solver reads them: each one's believed time and the physics gap to the next.
    static func inputs(_ plays: [TimelinePlay<BasketballScene>]) -> [AnchorInput] {
        plays.indices.map { i in
            let p = plays[i], s = p.play
            let next = i + 1 < plays.count ? plays[i + 1] : nil
            var weight: Double
            switch p.kind.label {
            case "shot", "rebound", "turnover", "jump ball", "free throw": weight = 1
            case "foul": weight = 0.75
            case "team rebound", "period end", "game end": weight = 0.5
            default: weight = 0
            }
            if p.estimated { weight *= 0.25 }
            // The rebound that restarts a stopped clock happens at the restart itself.
            let restarts = p.kind.phase == .live
            return AnchorInput(id: p.id, period: p.period, eventTime: p.eventTime, bounds: p.eventBounds, elapsed: p.clock.elapsed,
                               resolution: p.clock.resolution, live: p.kind.phase == .live, stopsClock: p.kind.stopsClock, weight: weight,
                               gapAfter: next.map { gap(s, $0.play) } ?? AnchorSolver.least, restartAfter: restarts ? 0 : 1)
        }
    }

    /// The least time between two consecutive decisive moments (§5.1 step 3; tune).
    static func gap(_ a: BasketballScene, _ b: BasketballScene) -> Double {
        let shot: Set<BasketballScene.Kind> = [.jumper, .three, .layup, .dunk, .alleyOop, .putback, .block]
        if shot.contains(a.kind) || a.kind == .freeThrow, !a.made, b.kind == .offensiveRebound || b.kind == .defensiveRebound {
            // Off the rim and into two hands: longer off a long miss (§5.1's flight measured from the rim).
            return max(0.8, 0.45 + 0.022 * (a.distance ?? 12))
        }
        if a.kind == .offensiveRebound, shot.contains(b.kind) {
            return (b.distance ?? 0) > 10 ? 1.6 : 0.6
        }
        if a.kind == .freeThrow, b.kind == .freeThrow { return 6.0 }
        if shot.contains(a.kind), a.made, b.offense != nil, b.offense != a.offense, b.kind != .foul, b.kind != .substitution,
           b.kind != .timeout {
            return 2.5
        }
        return AnchorSolver.least
    }
}

// MARK: - The plan (Phase 0)

/// What the basketball planner needs to know about the game.
struct HoopsFacts: Equatable, Sendable {
    var topIsHome = false
    /// The viewer's turn of the court.
    var flipped = false
    /// The teams as ESPN names them (the parser's).
    var topID: String?
    var bottomID: String?
    var topName = ""
    var bottomName = ""

    var teams: BasketballFeed.Teams {
        BasketballFeed.Teams(topIsHome: topIsHome, topID: topID, bottomID: bottomID, topName: topName, bottomName: bottomName)
    }

    func ends(_ period: Int?) -> HoopsEnds { HoopsEnds(period: period ?? 1, topIsHome: topIsHome, flipped: flipped) }
}

enum HoopsPlanner {
    /// The timeline's plays as scenes (ESPN's own entries through today's parser), in order.
    /// Everything known is planned: the plays up to the watermark and those past it (`pending`: they've arrived,
    /// though another may still be inserted before them, and then the plan simply splices again). Without them
    /// the theater would learn of a play only a few seconds before its moment.
    static func plays(_ snapshot: TimelineSnapshot<RawPlay>, teams: BasketballFeed.Teams) -> [TimelinePlay<BasketballScene>] {
        let all = snapshot.plays + snapshot.pending
        let json = all.map(\.play.json)
        return all.indices.compactMap { i in
            BasketballScene.parse(json, at: i, teams: teams).flatMap { scene in all[i].map { _ in scene } }
        }
    }

    /// Plays that change nothing on the floor by themselves (they attach to the stoppage they belong to).
    static func isAdmin(_ scene: BasketballScene) -> Bool {
        [.substitution, .timeout, .challenge].contains(scene.kind)
    }

    /// The floor at t as a beat starts from it (`Lineup`, in `side`'s frame): the ten men where each would come to rest
    /// from how he's moving, who has the ball, the floor's shape.
    static func lineup(_ draft: Plan<HoopsClip>, at t: PTime, ends: HoopsEnds, side: GameDetail.Side? = nil) -> Lineup? {
        guard let k = draft.placement(at: t) else { return nil }
        let clip = draft.placements[k].clip
        let offense = side ?? clip.script.side ?? .top
        let men = TheaterPlanner.men(draft, at: t).filter { $0.figure.group < 2 }
        let own = offense == .top ? 0 : 1
        // Five a side: mid-substitution the man coming on and the man going off both show; the five most there play.
        func five(_ side: [Splice.Man]) -> [Splice.Man] {
            Array(side.sorted { ($0.state.opacity, -Int($0.state.id.raw)) > ($1.state.opacity, -Int($1.state.id.raw)) }.prefix(5))
                .sorted { $0.state.id < $1.state.id }
        }
        let off = five(men.filter { $0.figure.group == own }), def = five(men.filter { $0.figure.group != own })
        guard off.count == 5, def.count == 5 else { return nil }
        let right = ends.right(offense)
        let ten = off + def
        let at = ten.map { m -> CGPoint in
            let v = m.state.velocity, speed = simd_length(v)
            let ahead = speed > 0.3 ? v * (speed / (2 * 14)) : .zero
            var p = m.state.position + ahead
            p.x = min(max(p.x, 1), Hoops.length - 1)
            p.y = min(max(p.y, 1), Hoops.width - 1)
            return HoopsWorld.local(p, right: right)
        }
        var holder: Int?
        var ball: CGPoint?
        let spans = TheaterBake.ballSpans(draft)
        switch TheaterBake.ballSpan(spans, at: t) {
        case let .clip(j, _)?:
            let p = draft.placements[j]
            switch p.clip.ball(at: min(max(p.time(t), 0), p.clip.length)) {
            case let .held(i)?: holder = ten.firstIndex { $0.state.id == p.cast[i] }
            case let .free(point, _)?: ball = HoopsWorld.local(SIMD2(point.x, point.y), right: right)
            case nil: break
            }
        case let .held(id, _)?: holder = ten.firstIndex { $0.state.id == id }
        case let .flight(f)?: ball = HoopsWorld.local(SIMD2(f.to.x, f.to.y), right: right)
        case nil: break
        }
        return Lineup(offense: offense, at: at, holder: holder, ball: holder == nil ? ball : nil, formation: clip.formation)
    }

}

// MARK: - Painting

extension HoopsWorld {
    /// The world camera as a framing in a script's frame (right or left basket), and that frame's yaw.
    static func frame(_ camera: SIMD4<Double>, right: Bool) -> (frame: CameraFrame, yaw: Double) {
        let yaw = right ? camera.w : camera.w + .pi
        let center = local(SIMD2(camera.x, camera.y), right: right)
        let view = Gridiron.view(center, yaw: yaw)
        return (CameraFrame(x: view.x, y: view.y / 2, span: exp(camera.z)), yaw)
    }
}

enum HoopsPainter {
    /// Inks for posing only (a frame's pose needs none).
    private static let ink = TheaterInk(.dark)
    private static let teams = BasketballTeams(offense: Uniform(.orange), defense: Uniform(.blue))

    /// The placement in charge at p: the latest clip that has begun (its flashes, nets, stamp and banner show;
    /// the frame is drawn in its frame). Men still traveling to a clip that hasn't begun are drawn in it too.
    static func charge(_ plan: Plan<HoopsClip>, at p: PTime) -> Int? {
        plan.placements.lastIndex { $0.offset <= p && $0.start <= p } ?? plan.placement(at: p)
    }

    /// One frame of the engine's world through today's basketball frame: the clip in charge, its time, the world in its frame.
    static func frame(_ chain: PlanChain<HoopsClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: HoopsClip, t: Double, world: BasketballFrame.World)? {
        guard scratch.plan >= 0, scratch.plan < chain.plans.count else { return nil }
        let baked = chain.plans[scratch.plan]
        let plan = baked.plan
        guard let k = charge(plan, at: scratch.p) else { return nil }
        let clip = plan.placements[k].clip
        let t = clip.local(plan.placements[k].time(scratch.p))
        let right = clip.right
        let (camera, yaw) = HoopsWorld.frame(scratch.camera, right: right)
        let h = HoopProjection(size: size, camera: camera, yaw: yaw)
        let offenseGroup = (clip.script.side ?? .top) == .top ? 0 : 1
        // Who has the ball, and how.
        var holder: ActorID?
        var hold: BasketballFrame.World.Hold?
        var ball: BasketballFrame.World.Ball?
        switch scratch.ball {
        case let .clip(j):
            let q = plan.placements[j]
            let lt = q.clip.local(min(max(q.time(scratch.p), 0), q.clip.length))
            if let carrier = q.clip.script.carrier(at: lt), carrier.player < q.cast.count {
                holder = q.cast[carrier.player]
                if carrier.dribbling {
                    let leg = q.clip.script.legs.last { lt >= $0.from }
                    hold = .dribble(up: BasketballScript.bounce(lt - (leg?.from ?? 0)))
                } else {
                    let player = q.clip.script.players[carrier.player]
                    let one = player.actions.contains { ($0.kind == .layup || $0.kind == .hook) && abs(lt - $0.at) < 0.4 }
                    hold = .hands(oneHanded: one)
                }
                ball = .held
            } else if case let .free(point, flying)? = q.clip.ball(at: lt) {
                ball = .free(FieldPoint(HoopsWorld.local(SIMD2(point.x, point.y), right: right), z: point.z), flying: flying)
            }
        case let .held(id):
            holder = id
            hold = .hands(oneHanded: false)
            ball = .held
        case let .free(point):
            ball = .free(FieldPoint(HoopsWorld.local(SIMD2(point.x, point.y), right: right), z: point.z), flying: true)
        case .none:
            break
        }
        var figures: [BasketballFrame.World.Figure] = []
        figures.reserveCapacity(scratch.actors.count)
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            let here = HoopsWorld.local(actor.position, right: right)
            let worldHere = CGPoint(x: actor.position.x, y: actor.position.y)
            let unit = RigLens(h, at: here).unit
            func posed(_ placement: Int, _ figure: Int, _ time: Double) -> (RigPose, Double)? {
                let c = plan.placements[placement].clip
                guard figure < c.script.players.count else { return nil }
                let frame = BasketballFrame(scene: c.scene, script: c.script, t: c.local(time), teams: teams, ink: ink, size: size)
                return frame.pose(c.script.players[figure], figure, at: here, unit: unit, stride: (track.rig, scratch.p, worldHere))
            }
            guard let now = posed(actor.placement, actor.figure, actor.clipTime) else { continue }
            var body = now.0
            let heading = now.1
            if actor.previousPlacement >= 0, actor.blend < 1, let (from, _) = posed(actor.previousPlacement, actor.previousFigure, actor.previousTime) {
                body = from.mix(body, actor.blend)
            }
            let mine = holder == actor.id
            if mine, case .held = scratch.ball {
                // Carried across the hand-off: in both hands at the chest.
                body = body.over(HoopPose.hold, 1, moving: 1)
            }
            let group = track.figure.group
            let team: BasketballScript.Team = group == 2 ? .official : group == offenseGroup ? .offense : .defense
            figures.append(.init(index: Int(actor.id.raw), team: team, at: here, body: body, heading: right ? heading : heading - .pi,
                                 opacity: actor.opacity, holds: mine ? hold : nil))
        }
        return (clip, t, BasketballFrame.World(camera: camera, yaw: yaw, figures: figures, ball: ball))
    }
}

/// Basketball on the director (Phase 0): today's scripts as clips.
enum HoopsSport: TheaterSport {
    /// A play's scene reads the plays around it (the shot before a rebound, the free throws after a foul).
    static func scene(_ raw: [RawPlay], _ json: [JSON], at i: Int, pending: Bool, facts: HoopsFacts, context: Int,
                      prior: [BasketballScene?]) -> BasketballScene? {
        BasketballScene.parse(json, at: i, teams: facts.teams)
    }

    /// The furthest a scene reads ahead: twelve plays at the same clock for a foul's free throws, four court plays
    /// (past any substitutions and timeouts) for a miss's rebound.
    static var sceneReach: Int { 20 }

    static func plan(_ plays: [TimelinePlay<BasketballScene>], history: Set<String>, facts: HoopsFacts, chain: PlanChain<HoopsClip>, at c: PTime,
                     shift: Double, deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<HoopsClip> {
        var sequencer = HoopsSequencer(plays: plays, history: history, facts: facts)
        return TheaterPlanner.plan(&sequencer, history: history, chain: chain, at: c, shift: shift, deferFrom: deferFrom, revision: revision,
                                   nextID: &nextID)
    }

    static var horizons: [String: Double] { HoopsAnchors.horizons }
}

/// Basketball's Phase 0 running order (today's queue, nothing passed over), as clips.
struct HoopsSequencer: ClipSequencer {
    let plays: [TimelinePlay<BasketballScene>]
    let history: Set<String>
    let facts: HoopsFacts
    /// Who has the ball, and the court between plays the last telling left.
    var possession: GameDetail.Side?
    var toldRest: BasketballScript.Rest?

    init(plays: [TimelinePlay<BasketballScene>], history: Set<String>, facts: HoopsFacts) {
        self.plays = plays
        self.history = history
        self.facts = facts
        possession = plays.map(\.play).last { history.contains($0.id) && $0.after != nil }?.after
    }

    var limits: MotionLimits { .basketball }
    var yawRule: YawRule? { .basketball }
    var anchorInputs: [AnchorInput] { HoopsAnchors.inputs(plays) }

    func units(handled: Set<String>) -> [TellUnit<BasketballQueue.Unit>] {
        let news = plays.map(\.play).filter { !history.contains($0.id) }
        return BasketballQueue.units(news, told: handled).map { u in
            TellUnit(id: u.scene.id, scene: u, covers: u.covers, admin: HoopsPlanner.isAdmin(u.scene), fromWorld: !u.marquee, lead: u.marquee ? 0.9 : 0.5)
        }
    }

    mutating func opening(at t: PTime) -> HoopsClip {
        let scenes = plays.map(\.play)
        let last = scenes.last { history.contains($0.id) && $0.kind != .substitution }
        let rest = BasketballFlow.rest(after: last, previous: nil, from: nil, ends: facts.ends(last?.period ?? scenes.first?.period),
                                       possession: last?.after ?? last?.offense)
        toldRest = rest
        return HoopsClip(BasketballScript(rest: rest), scene: nil, kind: .rest, rest: rest)
    }

    mutating func resume(_ kept: [ClipPlacement<HoopsClip>]) {
        if let rest = kept.last(where: { $0.clip.kind == .rest })?.clip.rest { toldRest = rest }
        if let after = kept.last(where: { $0.clip.scene != nil })?.clip.scene?.after { possession = after }
    }

    mutating func clip(for unit: TellUnit<BasketballQueue.Unit>, at t: PTime, draft: Plan<HoopsClip>) -> HoopsClip {
        let scene = unit.scene.scene, ends = facts.ends(scene.period)
        if unit.scene.marquee { return HoopsClip(BasketballScript(scene, right: ends.right(scene.offense)), scene: scene, kind: .replay) }
        let lineup = HoopsPlanner.lineup(draft, at: t, ends: ends)
        return HoopsClip(BasketballScript(beat: scene, group: unit.scene.group, ends: ends, from: lineup, fallback: possession), scene: scene, kind: .beat)
    }

    mutating func told(_ unit: TellUnit<BasketballQueue.Unit>) {
        if let after = unit.scene.scene.after { possession = after }
    }

    mutating func rest(after unit: TellUnit<BasketballQueue.Unit>, at t: PTime, draft: Plan<HoopsClip>) -> HoopsClip {
        let scene = unit.scene.scene, ends = facts.ends(scene.period)
        var rest = BasketballFlow.rest(after: scene, previous: toldRest, from: HoopsPlanner.lineup(draft, at: t, ends: ends, side: scene.after ?? possession),
                                       ends: ends, possession: possession)
        rest.ends = ends
        toldRest = rest
        return HoopsClip(BasketballScript(rest: rest), scene: nil, kind: .rest, rest: rest)
    }

    mutating func next(after clip: HoopsClip, at t: PTime, draft: Plan<HoopsClip>) -> HoopsClip {
        var next = clip.rest ?? toldRest ?? BasketballScript.Rest(offense: possession)
        if clip.kind == .rest {
            next.round += 1
            if case .inbound = next.phase { next.phase = .live }
        }
        next.from = HoopsPlanner.lineup(draft, at: t, ends: next.ends, side: next.offense)
        toldRest = next
        return HoopsClip(BasketballScript(rest: next), scene: nil, kind: .rest, rest: next)
    }

    func cues(for unit: TellUnit<BasketballQueue.Unit>, clip: HoopsClip, at decisive: PTime) -> [Cue] {
        let scene = unit.scene.scene
        guard scene.made, scene.points > 0 else { return [] }
        return [Cue(at: decisive, until: decisive + 3, kind: .scored(scene.id), source: .known(play: scene.id))]
    }

    func handOff(_ draft: inout Plan<HoopsClip>, _ k: Int) { TheaterHandOff.ball(&draft, k, speed: 40, height: 4.4) }
}
