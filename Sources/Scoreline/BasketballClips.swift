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

    /// The world camera as a framing in the view at its yaw (the projection's terms).
    static func frame(_ camera: SIMD4<Double>) -> (frame: CameraFrame, yaw: Double) {
        let yaw = camera.w
        let view = Gridiron.view(CGPoint(x: camera.x, y: camera.y), yaw: yaw)
        return (CameraFrame(x: view.x, y: view.y / 2, span: exp(camera.z)), yaw)
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
        length = script.duration
        still = kind == .replay ? script.leadIn : 0
        decisive = Self.decisive(script, scene: scene, kind: kind)
        essential = kind == .rest ? 0 : min(script.duration, (decisive ?? 0) + (kind == .replay ? 1.6 : 0.8))
        paths = script.players.map { Self.resynthesized($0, band: MotionLimits.basketball.band($0.team == .official ? "official" : "wing")) }
    }

    /// Each figure's path re-made through the motion layer (CHOREOGRAPHY §5.5.3): today's moves are polylines,
    /// each its own easing, so a man stops dead between two moves, turns a corner in a frame, or starts at full
    /// speed. The same vertices at the same moments become keys (each ball action a hard key, so every catch,
    /// pass and shot meets the ball exactly where it did), and quintics through them carry him C²: he runs
    /// through a junction, rounds the corner, eases into a start. Nil: he never moves.
    let paths: [MotionPath?]

    static func resynthesized(_ player: BasketballScript.Player, band: MotionLimits.Band) -> MotionPath? {
        let moves = player.moves.sorted { $0.start < $1.start }
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
        for action in player.actions where [.catchBall, .pass, .lob, .shoot, .layup, .dunk, .hook, .tip, .rebound, .steal, .block].contains(action.kind) {
            let t = action.at
            guard t > keys.first!.t, t < keys.last!.t else { continue }
            let at = player.position(at: t)
            keys.removeAll { abs($0.t - t) < 0.06 && !$0.hard }
            let index = keys.firstIndex { $0.t > t } ?? keys.count
            keys.insert(MotionKey(t: t, at: SIMD2(at.x, at.y), kind: .through, hard: true), at: index)
        }
        guard keys.count > 1 else { return nil }
        return TheaterMotion.path(keys, band: band)
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
        if let path = paths[figure] {
            let p = path.position(at: t)
            return HoopsWorld.point(CGPoint(x: p.x, y: p.y), right: right)
        }
        return HoopsWorld.point(script.players[figure].position(at: t), right: right)
    }

    func heading(_ figure: Int, at t: Double) -> Double {
        let h = figure < script.rig.count ? script.rig[figure].motion(at: t).heading : 0
        return HoopsWorld.heading(h, right: right)
    }

    func opacity(_ figure: Int, at t: Double) -> Double { script.players[figure].opacity(at: t) }

    func ball(at t: Double) -> ClipBall? {
        if let carrier = script.carrier(at: t) { return .held(figure: carrier.player) }
        guard let b = script.ball(at: t) else { return nil }
        return .free(HoopsWorld.point(b, right: right), flying: script.flight(at: t) != nil)
    }

    func camera(at t: Double) -> SIMD4<Double> { HoopsWorld.camera(script.camera.frame(at: t), yaw: script.yaw) }

    func moving(at t: Double) -> Bool {
        guard t >= 0, t <= script.duration else { return false }
        return kind == .rest ? script.active.contains { $0.contains(t) } : true
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
            return AnchorInput(id: p.id, period: p.period, eventTime: p.eventTime, bounds: nil, elapsed: p.clock.elapsed,
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
    static func plays(_ snapshot: TimelineSnapshot<RawPlay>, teams: BasketballFeed.Teams) -> [TimelinePlay<BasketballScene>] {
        let json = snapshot.plays.map(\.play.json)
        return snapshot.plays.indices.compactMap { i in
            BasketballScene.parse(json, at: i, teams: teams).flatMap { scene in snapshot.plays[i].map { _ in scene } }
        }
    }

    /// The plan from the splice at `c`: what's on screen carries on, each
    /// play still to tell is placed at its anchor and met from the world as
    /// it will stand, and the court between plays fills every gap to the
    /// horizon. `history`: plays from before the page opened (never told).
    static func plan(_ plays: [TimelinePlay<BasketballScene>], history: Set<String>, facts: HoopsFacts, chain: PlanChain<HoopsClip>,
                     at c: PTime, shift: Double = 0, deferFrom: PTime? = nil, revision: UInt32, nextID: inout UInt16) -> Plan<HoopsClip> {
        let limits = MotionLimits.basketball
        let previous = chain.plan(at: c)
        let state = chain.state(at: c)
        // What's on screen carries on (and the clip before it, while men still blend out of it).
        var keep: [ClipPlacement<HoopsClip>] = []
        var toldBefore = previous?.plan.toldBefore ?? []
        if let previous, let k = previous.plan.placement(at: c) {
            let from = max(k - 1, 0)
            keep = Array(previous.plan.placements[from...k])
            for p in previous.plan.placements[..<from] { toldBefore.formUnion(p.covers) }
        }
        var draft = Plan<HoopsClip>(revision: revision, start: c, horizon: c + 60, state: state, placements: keep,
                                    actors: previous?.plan.actors ?? [:])
        draft.toldBefore = toldBefore
        draft.history = chain.history(before: c)
        draft.yawRule = .basketball
        if let previous {
            let at = YawRule.target(previous.yawTargets, at: c)
            let since = previous.yawTargets.last { $0.at <= c }?.at ?? c - 10
            draft.yaw = (at, since)
        }
        let scenes = plays.map(\.play)
        let news = scenes.filter { !history.contains($0.id) }
        // The opening: the court the last play before the page left, everyone in place (a declared jump).
        if keep.isEmpty {
            let last = scenes.last { history.contains($0.id) && $0.kind != .substitution }
            let rest = BasketballFlow.rest(after: last, previous: nil, from: nil, ends: facts.ends(last?.period ?? scenes.first?.period),
                                           possession: last?.after ?? last?.offense)
            let clip = HoopsClip(BasketballScript(rest: rest), scene: nil, kind: .rest, rest: rest)
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
        }
        // Everything already handled: before the page, told by plans before, or by what carries on.
        var handled = history.union(draft.toldBefore)
        for p in draft.placements { handled.formUnion(p.covers) }
        let units = BasketballQueue.units(news, told: handled)
        // Anchors: what carries on keeps its own.
        var frozen: [String: PTime] = [:]
        for p in draft.placements { if let id = p.play, let a = p.anchor { frozen[id] = a } }
        let anchors = AnchorSolver.solve(HoopsAnchors.inputs(plays), frozen: frozen)
        var possession = scenes.last { history.contains($0.id) && $0.after != nil }?.after
        var toldRest = draft.placements.last { $0.clip.kind == .rest }?.clip.rest
        let lastScene = draft.placements.last { $0.clip.scene != nil }?.clip.scene
        if let s = lastScene, let after = s.after { possession = after }
        var earliest = draft.placements.last.map { $0.essentialEnd(after: c) } ?? c
        for unit in units {
            let scene = unit.scene
            // On p; the chain runs on the theater's time, `shift` ahead. Past a hold, it waits for the clock.
            let data = anchors[scene.id]?.at ?? (earliest - shift)
            if let deferFrom, data >= deferFrom { break }
            let anchor = data + shift
            // A dead-ball play that arrives after its moment has passed attaches to the stoppage on screen
            // (§4.6): it's never needed on time, and telling it now would be telling it out of place.
            if isAdmin(scene), anchor + TheaterTiming.microCatchUp < earliest {
                draft.toldBefore.insert(scene.id)
                draft.notes.append(PlanNote(at: earliest, kind: .catchUp(play: scene.id, late: earliest - anchor)))
                continue
            }
            let ends = facts.ends(scene.period)
            func build(_ at: PTime) -> HoopsClip {
                if unit.marquee {
                    return HoopsClip(BasketballScript(scene, right: ends.right(scene.offense)), scene: scene, kind: .replay)
                }
                let lineup = Self.lineup(draft, at: at, ends: ends)
                return HoopsClip(BasketballScript(beat: scene, group: unit.group, ends: ends, from: lineup, fallback: possession), scene: scene,
                                 kind: .beat)
            }
            var clip = build(max(earliest, anchor - 3))
            var offset = anchor - (clip.decisive ?? 0)
            var meeting = Splice.meet(clip, offset: offset, earliest: earliest, limits: limits, nextID: &nextID) { men(draft, at: $0) }
            if !unit.marquee, abs(meeting.start - max(earliest, anchor - 3)) > 0.3 {
                // A beat starts from the floor as it stands when it begins: build it from there.
                clip = build(meeting.start)
                offset = anchor - (clip.decisive ?? 0)
                meeting = Splice.meet(clip, offset: offset, earliest: earliest, limits: limits, nextID: &nextID) { men(draft, at: $0) }
            }
            // The court between plays the splice cuts before it began never plays.
            draft.placements.removeAll { $0.clip.kind == .rest && $0.start >= meeting.start - 1e-9 && $0.start > c }
            var placement = ClipPlacement(clip: clip, offset: meeting.offset, start: meeting.start, cast: meeting.cast, travel: meeting.travel,
                                      join: meeting.join, leaving: meeting.leaving, play: scene.id, anchor: data, slip: meeting.slip)
            placement.shift = shift
            placement.covers = [scene.id] + unit.covers
            for (i, id) in meeting.cast.enumerated() { identify(&draft, id, as: clip.figures[i]) }
            draft.placements.append(placement)
            handOff(&draft, draft.placements.count - 1)
            if meeting.slip > 1e-3 { draft.notes.append(PlanNote(at: meeting.offset + (clip.decisive ?? 0), kind: .catchUp(play: scene.id, late: meeting.slip))) }
            if scene.made, scene.points > 0, let d = clip.decisive {
                let at = meeting.offset + d
                draft.cues.append(Cue(at: at, until: at + 3, kind: .scored(scene.id), source: .known(play: scene.id)))
            }
            if let after = scene.after { possession = after }
            earliest = draft.placements[draft.placements.count - 1].essentialEnd(after: c)
            // The court between plays from where the play leaves everyone.
            let end = meeting.offset + clip.length
            let restSide = scene.after ?? possession
            let restEnds = facts.ends(scene.period)
            var rest = BasketballFlow.rest(after: scene, previous: toldRest, from: lineup(draft, at: end, ends: restEnds, side: restSide),
                                           ends: restEnds, possession: possession)
            rest.ends = restEnds
            appendRest(&draft, rest, at: end, limits: limits, nextID: &nextID)
            toldRest = rest
        }
        // The court between plays round by round to the horizon (then only the men it still has).
        let lastEnd = draft.placements.last.map { $0.offset + $0.clip.length } ?? c
        draft.horizon = max(c + 45, lastEnd + 2, (draft.placements.last { $0.play != nil }.map { $0.offset + $0.clip.length } ?? c) + 30)
        while let last = draft.placements.last, last.offset + last.clip.length < draft.horizon {
            let end = last.offset + last.clip.length
            var next = last.clip.rest ?? toldRest ?? BasketballScript.Rest(offense: possession)
            if last.clip.kind == .rest {
                next.round += 1
                if case .inbound = next.phase { next.phase = .live }
            }
            next.from = lineup(draft, at: end, ends: next.ends, side: next.offense)
            appendRest(&draft, next, at: end, limits: limits, nextID: &nextID)
        }
        var present = Set<ActorID>()
        for p in draft.placements { present.formUnion(p.cast); present.formUnion(p.leaving) }
        draft.actors = draft.actors.filter { present.contains($0.key) }
        return draft
    }

    /// Plays that change nothing on the floor by themselves (they attach to the stoppage they belong to).
    static func isAdmin(_ scene: BasketballScene) -> Bool {
        [.substitution, .timeout, .challenge].contains(scene.kind)
    }

    static func appendRest(_ draft: inout Plan<HoopsClip>, _ rest: BasketballScript.Rest, at t: PTime, limits: MotionLimits, nextID: inout UInt16) {
        let clip = HoopsClip(BasketballScript(rest: rest), scene: nil, kind: .rest, rest: rest)
        let meeting = Splice.meet(clip, offset: t, earliest: t, limits: limits, nextID: &nextID) { men(draft, at: $0) }
        let placement = ClipPlacement(clip: clip, offset: meeting.offset, start: meeting.start, cast: meeting.cast, travel: meeting.travel,
                                  join: meeting.join, leaving: meeting.leaving)
        for (i, id) in meeting.cast.enumerated() { identify(&draft, id, as: clip.figures[i]) }
        draft.placements.append(placement)
        handOff(&draft, draft.placements.count - 1)
    }

    /// A man's identity: his team never changes; the athlete a clip credits him as stays with him.
    static func identify(_ draft: inout Plan<HoopsClip>, _ id: ActorID, as figure: ClipFigure) {
        if var known = draft.actors[id] {
            if let athlete = figure.athlete { known.athlete = athlete }
            draft.actors[id] = known
        } else {
            draft.actors[id] = figure
        }
    }

    /// The world's men at t as the splice reads them (present ones only).
    static func men(_ draft: Plan<HoopsClip>, at t: PTime) -> [Splice.Man] {
        draft.everyone.compactMap { id in
            guard let m = draft.motion(of: id, at: t), m.opacity > 0.05, let figure = draft.actors[id] else { return nil }
            let state = ActorState(id: id, position: m.position, velocity: m.velocity, acceleration: m.acceleration,
                                   rig: .standing(at: CGPoint(x: m.position.x, y: m.position.y), heading: 0), opacity: m.opacity)
            return Splice.Man(state: state, figure: figure)
        }
    }

    /// The floor at t as a beat starts from it (`Lineup`, in `side`'s frame): the ten men where each would come to rest
    /// from how he's moving, who has the ball, the floor's shape.
    static func lineup(_ draft: Plan<HoopsClip>, at t: PTime, ends: HoopsEnds, side: GameDetail.Side? = nil) -> Lineup? {
        guard let k = draft.placement(at: t) else { return nil }
        let clip = draft.placements[k].clip
        let offense = side ?? clip.script.side ?? .top
        let men = Self.men(draft, at: t).filter { $0.figure.group < 2 }
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

    /// The ball across a splice: it stays with the man who has it when he's the clip's man with it; else it's passed
    /// to him (inferred: the inbound, the outlet), landing as he's set.
    static func handOff(_ draft: inout Plan<HoopsClip>, _ k: Int) {
        let p = draft.placements[k]
        guard case let .held(i)? = p.clip.ball(at: p.clip.still), i < p.cast.count else { return }
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
        let join = p.join[target] ?? p.offset + p.clip.still
        let landing = draft.motion(of: target, at: join)?.position ?? p.clip.position(i, at: p.clip.still)
        let to = SIMD3(landing.x, landing.y, 4.4)
        let start: SIMD3<Double>
        if let holder, let m = draft.motion(of: holder, at: p.start) { start = SIMD3(m.position.x, m.position.y, 4.4) } else {
            start = from ?? to
        }
        let distance = simd_length(SIMD2(to.x - start.x, to.y - start.y))
        let duration = min(max(distance / 40, 0.35), 1.1)
        let launch = max(p.start, join - duration)
        var origin = start
        if let holder, let m = draft.motion(of: holder, at: launch) { origin = SIMD3(m.position.x, m.position.y, 4.4) }
        draft.placements[k].holder = holder
        draft.placements[k].ball = BallFlight(t0: launch, t1: launch + duration, from: origin, to: to, apex: 1 + distance / 30)
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
        let t = plan.placements[k].time(scratch.p)
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
            let local = q.time(scratch.p)
            let lt = min(max(local, 0), q.clip.length)
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
                let frame = BasketballFrame(scene: c.scene, script: c.script, t: time, teams: teams, ink: ink, size: size)
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
    static func plays(_ snapshot: TimelineSnapshot<RawPlay>, facts: HoopsFacts) -> [TimelinePlay<BasketballScene>] {
        HoopsPlanner.plays(snapshot, teams: facts.teams)
    }

    static func plan(_ plays: [TimelinePlay<BasketballScene>], history: Set<String>, facts: HoopsFacts, chain: PlanChain<HoopsClip>, at c: PTime,
                     shift: Double, deferFrom: PTime?, revision: UInt32, nextID: inout UInt16) -> Plan<HoopsClip> {
        HoopsPlanner.plan(plays, history: history, facts: facts, chain: chain, at: c, shift: shift, deferFrom: deferFrom, revision: revision,
                          nextID: &nextID)
    }

    static var horizons: [String: Double] { HoopsAnchors.horizons }
}
