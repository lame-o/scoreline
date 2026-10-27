import SwiftUI

// The soccer theater: at the top of the Live Pitch, the latest big moment
// replayed on a pitch in perspective as it arrives from the live lane, shot
// like a broadcast from high in the main stand. The camera rides the ball
// through the build-up (each pass from the man who played it to the man it
// found, standing where ESPN placed them), pushes in as the shot is struck,
// and holds on the goal and the scorer wheeling away. The shot goes to the
// exact point in the goal mouth it was heading for: in off the post, into
// the keeper's hands, onto the bar. Marquee moments get a headline (GOAL,
// SAVE, OFF THE POST, PENALTY, OWN GOAL) and a goal its fireworks over the
// net; the stamp names the scorer, the assist, the minute and the distance.
// The moment's own words, under it, are its caption.
//
// Drawn in two Canvases, the pitch and the players, both projected through
// the camera (SoccerScript.swift), so lines stay crisp at any zoom. A
// TimelineView exists only while a replay runs; between moments the last
// one holds as it ended. Moments already on the page when it opened show as
// they ended; a new one mid-replay cuts to itself; with Reduce Motion each
// moment crossfades to how it ended and the camera never moves. Decorative
// for VoiceOver: the caption carries the moment.

/// The broadcast camera's perspective through a framing, filling the view.
struct PitchProjection {
    let size: CGSize
    let camera: CameraFrame
    let basis: PitchCamera.Basis
    /// Points per unit of the view's tangent plane.
    let focal: Double

    init(size: CGSize, camera: CameraFrame = PitchCamera.rest) {
        self.size = size
        self.camera = camera
        basis = PitchCamera.basis(camera)
        let half = max(camera.span, 1) / 2 / basis.distance
        focal = max(min(size.height / 2 / half, size.width / 2 / (half * CameraFrame.aspect)), 1)
    }

    func point(_ p: FieldPoint) -> CGPoint {
        let t = basis.tangent(p)
        return CGPoint(x: size.width / 2 + t.u * focal, y: size.height / 2 - t.v * focal)
    }

    func point(_ p: CGPoint, z: Double = 0) -> CGPoint { point(FieldPoint(p, z: z)) }

    /// Points per metre at a spot's distance from the lens.
    func scale(at p: FieldPoint) -> Double {
        let d = SIMD3(p.x, p.y, p.z) - basis.eye
        return focal / max((d * basis.forward).sum(), 0.5)
    }

    /// A standing figure's height in points: a little larger than life,
    /// smaller further off, never a speck, never a giant.
    func figure(at p: CGPoint) -> CGFloat {
        min(max(2.5 * scale(at: FieldPoint(p)), max(9, size.height * 0.06)), max(size.height * 0.2, 10))
    }

    /// The well's corners: everything is clipped to them.
    var bounds: Path { Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 12, style: .continuous) }
}

// MARK: - Pitch

/// The pitch itself: the grass and its mowing, the lines, the boards and the
/// stands beyond them. Equatable: redrawn for a new size, appearance or
/// camera, never for a player. (The goals stand with the players, who can
/// be in front of them or behind.)
struct PitchLayer: View, Equatable {
    let ink: TheaterInk
    var camera: CameraFrame = PitchCamera.rest

    var body: some View {
        Canvas { context, size in
            let f = PitchProjection(size: size, camera: camera)
            context.clip(to: f.bounds)
            func quad(_ a: FieldPoint, _ b: FieldPoint, _ c: FieldPoint, _ d: FieldPoint) -> Path {
                var path = Path()
                path.addLines([f.point(a), f.point(b), f.point(c), f.point(d)])
                path.closeSubpath()
                return path
            }
            func ground(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) -> Path {
                quad(FieldPoint(x: x0, y: y0), FieldPoint(x: x1, y: y0), FieldPoint(x: x1, y: y1), FieldPoint(x: x0, y: y1))
            }
            let L = Pitch.length, W = Pitch.width
            // Chalk thickens a little as the camera closes in.
            let ppm = f.scale(at: FieldPoint(x: camera.x, y: camera.y))
            let line = min(max(0.75, ppm * 0.09), 1.7)

            // The bowl: the stands behind the boards on the far side and at each end, rising out of sight
            // (one shape, so where they meet isn't darker), their tiers just there.
            var bowl = ground(-70, -60, L + 70, W + 5)
            bowl.addPath(quad(FieldPoint(x: -70, y: W + 5), FieldPoint(x: L + 70, y: W + 5), FieldPoint(x: L + 70, y: W + 60, z: 34),
                              FieldPoint(x: -70, y: W + 60, z: 34)))
            for (x, out) in [(-6.0, -40.0), (L + 6, 40.0)] {
                bowl.addPath(quad(FieldPoint(x: x, y: -60), FieldPoint(x: x, y: W + 5), FieldPoint(x: x + out, y: W + 5, z: 25),
                                  FieldPoint(x: x + out, y: -60, z: 25)))
            }
            context.fill(bowl, with: .color(ink.stands))
            var tiers = Path()
            for k in 1...5 {
                let y = W + 5 + Double(k) * 9, z = Double(k) * 9 * 34 / 55
                tiers.move(to: f.point(FieldPoint(x: -70, y: y, z: z)))
                tiers.addLine(to: f.point(FieldPoint(x: L + 70, y: y, z: z)))
            }
            context.stroke(tiers, with: .color(ink.stands), lineWidth: 0.5)
            // The grass, with its run-off, mowed in bands across the pitch.
            context.fill(ground(-4, -3.5, L + 4, W + 3.5), with: .color(ink.grass))
            var bands = Path()
            let band = L / 18
            for i in stride(from: 0, to: 18, by: 2) {
                bands.addPath(ground(Double(i) * band, -3.5, Double(i + 1) * band, W + 3.5))
            }
            context.fill(bands, with: .color(ink.mow))
            // The boards along the far touchline and behind the goals.
            var boards = Path(), tops = Path()
            for (a, b) in [(CGPoint(x: -4, y: W + 4.2), CGPoint(x: L + 4, y: W + 4.2)), (CGPoint(x: -4.6, y: -2), CGPoint(x: -4.6, y: W + 4.2)),
                           (CGPoint(x: L + 4.6, y: -2), CGPoint(x: L + 4.6, y: W + 4.2))] {
                boards.addPath(quad(FieldPoint(a), FieldPoint(b), FieldPoint(b, z: 0.9), FieldPoint(a, z: 0.9)))
                tops.move(to: f.point(a, z: 0.9))
                tops.addLine(to: f.point(b, z: 0.9))
            }
            context.fill(boards, with: .color(ink.wall))
            context.stroke(tops, with: .color(ink.wallTop), lineWidth: line * 0.7)

            // The lines.
            var lines = Path()
            func segment(_ a: CGPoint, _ b: CGPoint) {
                lines.move(to: f.point(a))
                lines.addLine(to: f.point(b))
            }
            func rect(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) {
                segment(CGPoint(x: x0, y: y0), CGPoint(x: x1, y: y0))
                segment(CGPoint(x: x1, y: y0), CGPoint(x: x1, y: y1))
                segment(CGPoint(x: x1, y: y1), CGPoint(x: x0, y: y1))
                segment(CGPoint(x: x0, y: y1), CGPoint(x: x0, y: y0))
            }
            func arc(_ c: CGPoint, _ r: Double, from a0: Double, to a1: Double, steps: Int) {
                let points = (0...steps).map { i -> CGPoint in
                    let a = a0 + (a1 - a0) * Double(i) / Double(steps)
                    return f.point(CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a)))
                }
                lines.move(to: points[0])
                lines.addLines(points)
            }
            rect(0, 0, L, W)
            segment(CGPoint(x: L / 2, y: 0), CGPoint(x: L / 2, y: W))
            arc(Pitch.center, Pitch.circle, from: 0, to: 2 * .pi, steps: 48)
            for right in [false, true] {
                let x = right ? L : 0, s = right ? -1.0 : 1.0
                rect(x, (W - Pitch.boxWidth) / 2, x + s * Pitch.boxDepth, (W + Pitch.boxWidth) / 2)
                rect(x, (W - Pitch.sixWidth) / 2, x + s * Pitch.sixDepth, (W + Pitch.sixWidth) / 2)
                // The D: the penalty arc outside the box.
                let spot = CGPoint(x: x + s * Pitch.spot, y: W / 2)
                let half = acos((Pitch.boxDepth - Pitch.spot) / Pitch.circle)
                arc(spot, Pitch.circle, from: (right ? .pi : 0) - half, to: (right ? .pi : 0) + half, steps: 16)
                // The corner arcs.
                arc(CGPoint(x: x, y: 0), 1, from: right ? .pi / 2 : 0, to: right ? .pi : .pi / 2, steps: 5)
                arc(CGPoint(x: x, y: W), 1, from: right ? .pi : -.pi / 2, to: right ? 1.5 * .pi : 0, steps: 5)
            }
            context.stroke(lines, with: .color(ink.chalk), style: StrokeStyle(lineWidth: line, lineCap: .round, lineJoin: .round))
            // The spots.
            for p in [Pitch.center, CGPoint(x: Pitch.spot, y: W / 2), CGPoint(x: L - Pitch.spot, y: W / 2)] {
                let c = f.point(p), r = max(0.22 * f.scale(at: FieldPoint(p)), 1.1)
                context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r * 0.5, width: 2 * r, height: r)), with: .color(ink.chalk))
            }
        }
    }
}

// MARK: - Teams

/// The two teams on the pitch, always told apart at a glance (dressed by
/// the baseball theater's rule: `TheaterTeams.dress`).
struct SoccerTeams: Equatable {
    var attacking: Uniform
    var defending: Uniform

    func uniform(_ team: SoccerScript.Team) -> Uniform { team == .attacking ? attacking : defending }
}

// MARK: - Poses

extension Pose {
    // A strike: the swing leg drawn back, through the ball, and on; the arms out for balance.
    static let backswing = Pose(lean: -0.12, nearThigh: -0.45, nearShin: -1.45, farThigh: 0.12, farShin: 0.05,
                                nearUpper: -0.95, nearFore: -0.6, farUpper: 0.95, farFore: 1.15)
    static let strike = Pose(lean: 0.05, nearThigh: 0.95, nearShin: 0.55, farThigh: -0.06, farShin: -0.05,
                             nearUpper: -0.7, nearFore: -0.35, farUpper: 1.2, farFore: 1.45)
    static let followThrough = Pose(lean: 0.18, nearThigh: 1.4, nearShin: 1.3, farThigh: -0.18, farShin: -0.1,
                                    nearUpper: -0.45, nearFore: -0.1, farUpper: 1.0, farFore: 1.2)
    /// Up for a header: legs tucked, arms out, the head through it.
    static let header = Pose(lean: 0.4, nearThigh: 0.55, nearShin: -0.7, farThigh: 0.15, farShin: -0.95,
                             nearUpper: -1.5, nearFore: -1.85, farUpper: 1.55, farFore: 1.9, lift: 0.2)
    /// Both hands over his head, then through: a throw-in.
    static let throwBack = Pose(lean: -0.25, nearThigh: 0.35, nearShin: 0.2, farThigh: -0.3, farShin: -0.2,
                                nearUpper: 2.75, nearFore: -2.9, farUpper: 2.65, farFore: -3.0)
    static let throwThrough = Pose(lean: 0.3, nearThigh: 0.4, nearShin: 0.15, farThigh: -0.35, farShin: -0.4,
                                   nearUpper: 1.9, nearFore: 1.55, farUpper: 1.75, farFore: 1.45)
    /// Square to the shot, arms in, a stride wide: a block.
    static let block = Pose(lean: -0.12, nearThigh: 0.5, nearShin: 0.3, farThigh: -0.5, farShin: -0.3,
                            nearUpper: -0.25, nearFore: 0.35, farUpper: 0.25, farFore: -0.35)
    /// The keeper takes it into his chest.
    static let gather = Pose(lean: 0.22, nearThigh: 0.5, nearShin: 0.1, farThigh: -0.35, farShin: -0.15,
                             nearUpper: 1.3, nearFore: 1.75, farUpper: 1.1, farFore: 1.65)
    /// Arms up, chest out.
    static let celebrate = Pose(lean: -0.12, nearThigh: 0.22, nearShin: 0.12, farThigh: -0.22, farShin: -0.12,
                                nearUpper: 2.55, nearFore: 2.75, farUpper: -2.55, farFore: -2.75)
    /// Hands on his head.
    static let dejected = Pose(lean: 0.05, nearThigh: 0.1, nearShin: 0.05, farThigh: -0.1, farShin: -0.05,
                               nearUpper: 2.25, nearFore: -2.2, farUpper: -2.25, farFore: 2.2)
    /// At full stretch, flying: facing the way he dives.
    static let dive = Pose(lean: 1.25, nearThigh: -1.15, nearShin: -1.35, farThigh: -1.4, farShin: -1.6,
                           nearUpper: 1.85, nearFore: 1.95, farUpper: 1.7, farFore: 1.8)
    /// Up high, more upright.
    static let diveHigh = Pose(lean: 0.8, nearThigh: -0.55, nearShin: -1.1, farThigh: -0.85, farShin: -1.3,
                               nearUpper: 2.35, nearFore: 2.45, farUpper: 2.15, farFore: 2.3, lift: 0.18)
    /// Down on the grass after it.
    static let down = Pose(lean: 1.5, nearThigh: -1.45, nearShin: -1.55, farThigh: -1.35, farShin: -1.5,
                           nearUpper: 1.55, nearFore: 1.45, farUpper: 1.05, farFore: 1.3)
}

// MARK: - Players and ball

/// One frame of a moment through the camera: the move's trail on the grass
/// and the shot's path, the shadows, the goals and the players far to near,
/// the ball, what it hits, the headline and the stamp. Equatable: at rest
/// (t = ∞) an update elsewhere on the page doesn't redraw it.
struct SoccerFrame: View, Equatable {
    let scene: SoccerScene?
    let script: SoccerScript
    let t: Double
    let teams: SoccerTeams
    let ink: TheaterInk
    /// Where it's drawn: the type is sized from it.
    let size: CGSize

    /// The time first: mid-replay it's all that differs.
    static func == (a: SoccerFrame, b: SoccerFrame) -> Bool {
        a.t == b.t && a.size == b.size && a.teams == b.teams && a.ink == b.ink && a.scene == b.scene && a.script == b.script
    }

    /// The type, laid out once as views and drawn into each frame.
    private enum Symbol: Hashable {
        case stamp
        case banner(Int)
    }

    var body: some View {
        Canvas { context, size in
            let f = PitchProjection(size: size, camera: script.frame(at: t))
            context.clip(to: f.bounds)
            drawTrails(&context, f)
            drawShadows(&context, f)
            let hands = drawStage(&context, f)
            drawBall(&context, f, hands: hands)
            drawImpacts(&context, f)
            drawLabels(&context, f)
        } symbols: {
            stamp.tag(Symbol.stamp)
            ForEach(script.banners.indices, id: \.self) { i in
                TheaterHeadline(text: script.banners[i].text, color: color(script.banners[i].tone), height: size.height).tag(Symbol.banner(i))
            }
        }
    }

    // MARK: The move's trail

    /// Each pass draws its line on the grass as the ball travels it, a run
    /// with the ball a dotted one, then settles to a faint record of the
    /// move; the shot's path, in the air, brighter.
    private func drawTrails(_ context: inout GraphicsContext, _ f: PitchProjection) {
        let width = min(max(f.size.height * 0.0065, 0.9), 1.8)
        let accent = teams.attacking.accent
        for (i, flight) in script.flights.enumerated() where t > flight.start {
            let end = min(t, flight.end)
            let after = t - flight.end
            let fade = after <= 0 ? 1 : max(1 - after / 0.6, 0)
            switch flight.kind {
            case .pass, .carry:
                guard flight.from.ground != flight.to.ground else { continue }
                var path = Path()
                path.move(to: f.point(flight.from.ground))
                path.addLine(to: f.point(flight.point(at: end).ground))
                let strength = 0.24 + 0.36 * fade
                context.stroke(path, with: .color(accent.opacity(strength)),
                               style: StrokeStyle(lineWidth: width, lineCap: .round, dash: flight.kind == .carry ? [width * 0.1, width * 2.6] : []))
            case .shot where i == script.shot:
                let samples = 24
                let points = (0...samples).map { f.point(flight.point(at: flight.start + (end - flight.start) * Double($0) / Double(samples))) }
                var path = Path()
                path.addLines(points)
                let strength = 0.45 + 0.4 * fade
                context.stroke(path, with: .color(ink.trace.opacity(strength)),
                               style: StrokeStyle(lineWidth: width * 1.3, lineCap: .round, lineJoin: .round))
            default:
                continue
            }
        }
    }

    // MARK: Shadows

    private func drawShadows(_ context: inout GraphicsContext, _ f: PitchProjection) {
        for actor in script.actors {
            let at = actor.position(at: t)
            let p = f.point(at), w = f.figure(at: at) * 0.3
            context.fill(Path(ellipseIn: CGRect(x: p.x - w, y: p.y - w * 0.3, width: 2 * w, height: w * 0.6)), with: .color(ink.shadow))
        }
        // The ball's: under it on the grass, larger and softer the higher it flies, a hairline up to it once it's well up.
        if script.heldBy == nil || t < script.heldFrom, let ball = script.ball(at: t), ball.z > 0.25 {
            let o = script.ballOpacity(at: t)
            let g = f.point(ball.ground)
            let spread = 1 + min(ball.z / 12, 1.4)
            let r = max(0.25 * f.scale(at: FieldPoint(ball.ground)), 1.5) * spread
            context.fill(Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r / 2, width: 2 * r, height: r)),
                         with: .color(ink.shadow.opacity(min(1.6 / (1 + ball.z / 8), 1) * o)))
            if ball.z > 1.6 {
                var drop = Path()
                drop.move(to: g)
                drop.addLine(to: f.point(ball))
                context.stroke(drop, with: .color(ink.trace.opacity(0.16 * min((ball.z - 1.6) / 2.5, 1) * o)), lineWidth: 0.5)
            }
        }
    }

    // MARK: Goals and players

    /// The goals and the players, far to near (a man in front of the post
    /// covers it). Returns where the keeper holding the ball has his hands.
    private func drawStage(_ context: inout GraphicsContext, _ f: PitchProjection) -> CGPoint? {
        let attacking = FigureInks(teams.attacking, ink: ink, in: context)
        let defending = FigureInks(teams.defending, ink: ink, in: context)
        enum Item {
            case actor(Int)
            case goalBack(right: Bool)
            case nearPost(right: Bool)
        }
        var items: [(depth: Double, item: Item)] = script.actors.indices.map { (script.actors[$0].position(at: t).y, .actor($0)) }
        for right in [false, true] {
            items.append((Pitch.posts.far + 0.01, .goalBack(right: right)))
            items.append((Pitch.posts.near - 0.01, .nearPost(right: right)))
        }
        var hands: CGPoint?
        for (_, item) in items.sorted(by: { $0.depth > $1.depth }) {
            switch item {
            case let .goalBack(right): drawGoal(&context, f, right: right, near: false)
            case let .nearPost(right): drawGoal(&context, f, right: right, near: true)
            case let .actor(i):
                let actor = script.actors[i]
                let figure = place(actor, i, f)
                TheaterDraw.figure(figure.figure, inks: actor.team == .attacking ? attacking : defending, opacity: 1, height: figure.height,
                                   in: &context)
                if script.heldBy == i, t >= script.heldFrom { hands = figure.hands }
            }
        }
        return hands
    }

    /// The goal on one end: the net (its back, roof and sides) with the far
    /// post and the bar, or the near post alone. The net ripples where a goal
    /// went in; the woodwork shivers where a shot struck it.
    private func drawGoal(_ context: inout GraphicsContext, _ f: PitchProjection, right: Bool, near: Bool) {
        let x = right ? Pitch.length : 0, s = right ? 1.0 : -1.0
        let posts = Pitch.posts, H = Pitch.goalHeight
        let depthLow = 2.0, depthHigh = 0.9
        let post = min(max(0.12 * f.scale(at: FieldPoint(x: x, y: Pitch.width / 2)), 1.1), 3.2)
        // The woodwork shivers after a hit.
        var shiver = 0.0
        if let hit = script.impacts.first(where: { $0.kind == .woodwork && ($0.point.x > Pitch.length / 2) == right }), t >= hit.at, t < hit.at + 0.6 {
            let u = t - hit.at
            shiver = 0.05 * exp(-u * 7) * sin(u * 2 * .pi * 16)
        }
        if near {
            var p = Path()
            p.move(to: f.point(FieldPoint(x: x, y: posts.near + shiver, z: 0)))
            p.addLine(to: f.point(FieldPoint(x: x, y: posts.near + shiver, z: H)))
            context.stroke(p, with: .color(ink.halo), style: StrokeStyle(lineWidth: post + 1.4, lineCap: .round))
            context.stroke(p, with: .color(ink.goal), style: StrokeStyle(lineWidth: post, lineCap: .round))
            return
        }
        // The net: bellied out round where the ball hit it, swaying back.
        let hit = script.impacts.first { $0.kind == .net && ($0.point.x > Pitch.length / 2) == right }
        func bulge(_ y: Double, _ z: Double) -> Double {
            guard let hit, t >= hit.at else { return 0 }
            let u = t - hit.at
            guard u < 1.6 else { return 0 }
            let reach = exp(-(pow(y - hit.point.y, 2) + pow(z - hit.point.z, 2)) / 1.8)
            return 0.75 * reach * exp(-u * 3.4) * cos(u * 2 * .pi * 1.4) * min(u / 0.06, 1)
        }
        func back(_ y: Double, _ z: Double) -> FieldPoint {
            let depth = depthLow + (depthHigh - depthLow) * z / H + bulge(y, z)
            return FieldPoint(x: x + s * depth, y: y, z: z)
        }
        var mesh = Path()
        let columns = 12, rows = 5
        for i in 0...columns {
            let y = posts.near + (posts.far - posts.near) * Double(i) / Double(columns)
            mesh.move(to: f.point(back(y, 0)))
            for j in 1...rows { mesh.addLine(to: f.point(back(y, H * Double(j) / Double(rows)))) }
            // On over the roof to the bar.
            mesh.addLine(to: f.point(FieldPoint(x: x, y: y, z: H)))
        }
        for j in 0...rows {
            let z = H * Double(j) / Double(rows)
            mesh.move(to: f.point(back(posts.near, z)))
            for i in 1...columns { mesh.addLine(to: f.point(back(posts.near + (posts.far - posts.near) * Double(i) / Double(columns), z))) }
        }
        // The sides, from the posts back.
        for y in [posts.near, posts.far] {
            for j in 0...3 {
                let z = H * Double(j) / 3
                mesh.move(to: f.point(FieldPoint(x: x, y: y, z: z)))
                mesh.addLine(to: f.point(back(y, z)))
            }
            mesh.move(to: f.point(FieldPoint(x: x, y: y, z: 0)))
            mesh.addLine(to: f.point(back(y, 0)))
        }
        context.stroke(mesh, with: .color(ink.net), lineWidth: 0.5)
        // The far post and the bar.
        var frame = Path()
        frame.move(to: f.point(FieldPoint(x: x, y: posts.far + shiver, z: 0)))
        frame.addLine(to: f.point(FieldPoint(x: x, y: posts.far + shiver, z: H + shiver)))
        frame.addLine(to: f.point(FieldPoint(x: x, y: posts.near + shiver, z: H + shiver)))
        context.stroke(frame, with: .color(ink.halo), style: StrokeStyle(lineWidth: post + 1.4, lineCap: .round, lineJoin: .round))
        context.stroke(frame, with: .color(ink.goal), style: StrokeStyle(lineWidth: post, lineCap: .round, lineJoin: .round))
    }

    /// A player posed and placed at t; and where his hands are (a keeper
    /// holding the ball has it there).
    private func place(_ actor: SoccerScript.Actor, _ index: Int, _ f: PitchProjection) -> (figure: Figure, height: CGFloat, hands: CGPoint) {
        let at = actor.position(at: t)
        let foot = f.point(at)
        let height = f.figure(at: at)
        // The keeper at full stretch: his hands go exactly to the ball.
        if let dive = actor.dive, t >= dive.start {
            let target = f.point(dive.target)
            let set = f.point(actor.position(at: dive.start))
            let facing: Double = target.x >= set.x ? 1 : -1
            let u = min(max((t - dive.start) / max(dive.reach - dive.start, 0.01), 0), 1)
            let fall = min(max((t - dive.reach) / 0.32, 0), 1)
            let flying = dive.target.z > 1.5 ? Pose.diveHigh : Pose.dive
            let pose = Pose.ready.mix(flying, smooth(u * 1.3)).mix(Pose.down, smooth(fall)).facing(facing)
            let figure = Figure(pose, at: foot, height: height)
            let pull = fall > 0 ? 1 - smooth(fall) : smooth(u)
            let reach = CGPoint(x: (target.x - figure.near.hand.x) * pull, y: (target.y - figure.near.hand.y) * pull)
            let placed = Figure(pose, at: CGPoint(x: foot.x + reach.x, y: min(foot.y + reach.y, foot.y)), height: height)
            return (placed, height, placed.near.hand)
        }
        let figure = Figure(pose(actor, index, f), at: foot, height: height)
        let hands = CGPoint(x: (figure.near.hand.x + figure.far.hand.x) / 2, y: (figure.near.hand.y + figure.far.hand.y) / 2)
        return (figure, height, hands)
    }

    private func smooth(_ u: Double) -> Double { let c = min(max(u, 0), 1); return c * c * (3 - 2 * c) }

    /// The pose at t: what he's doing (a strike, a header, a block, arms
    /// up), else how he's moving, else how he stands: watching the ball.
    private func pose(_ actor: SoccerScript.Actor, _ index: Int, _ f: PitchProjection) -> Pose {
        let here = actor.position(at: t)
        let ball = script.ball(at: t)?.ground ?? scene?.goal ?? Pitch.center
        func facing(toward p: CGPoint) -> Double { f.point(p).x - f.point(here).x >= 0 ? 1 : -1 }
        func envelope(_ x: Double, attack: Double, release: Double) -> Double {
            x < 0 ? max(1 + x / attack, 0) : max(1 - x / release, 0)
        }
        var base: Pose
        if let motion = actor.motion(at: t), motion.speed > 1.2 {
            let ahead = CGPoint(x: here.x + motion.heading.x, y: here.y + motion.heading.y)
            let way = facing(toward: ahead)
            base = motion.speed > 4.5 ? Pose.run(2 * .pi * 2.6 * t + Double(index)).facing(way)
                : Pose.walk(2 * .pi * 1.8 * t + Double(index)).facing(way)
        } else {
            base = (actor.role == .keeper ? Pose.ready : Pose.stand).facing(facing(toward: ball))
        }
        for action in actor.actions {
            let x = t - action.at
            let way = facing(toward: action.toward)
            switch action.kind {
            case .kick:
                guard x > -0.24, x < 0.45 else { continue }
                let keys: [(Double, Pose)] = [(-0.24, base), (-0.09, .backswing), (0, .strike), (0.13, .followThrough), (0.45, base)]
                base = keyed(keys, x, facing: way, base: base)
            case .header:
                guard x > -0.32, x < 0.42 else { continue }
                let keys: [(Double, Pose)] = [(-0.32, base), (-0.02, .header), (0.1, .header), (0.42, base)]
                base = keyed(keys, x, facing: way, base: base)
            case .throwIn:
                guard x > -0.5, x < 0.45 else { continue }
                let keys: [(Double, Pose)] = [(-0.5, base), (-0.15, .throwBack), (0.04, .throwThrough), (0.45, base)]
                base = keyed(keys, x, facing: way, base: base)
            case .control:
                base = base.mix(Pose.gather.facing(way), envelope(x, attack: 0.12, release: 0.2) * 0.4)
            case .block:
                base = base.mix(Pose.block.facing(way), envelope(x, attack: 0.18, release: 0.5))
            case .gather:
                // Takes it in and holds it there.
                base = base.mix(Pose.gather.facing(way), x < 0 ? max(1 + x / 0.2, 0) : 1)
            case .celebrate:
                base = base.mix(Pose.celebrate.facing(way), smooth((x + 0.25) / 0.35))
            case .dejected:
                base = base.mix(Pose.dejected.facing(way), smooth(x / 0.35))
            }
        }
        return base
    }

    private func keyed(_ keys: [(Double, Pose)], _ x: Double, facing: Double, base: Pose) -> Pose {
        guard let i = keys.lastIndex(where: { $0.0 <= x }), i + 1 < keys.count else { return base }
        let (a, pa) = keys[i], (b, pb) = keys[i + 1]
        // Poses are written facing right; the base already faces his way.
        let turn = { (p: Pose) in p == base ? p : p.facing(facing) }
        return turn(pa).mix(turn(pb), smooth((x - a) / (b - a)))
    }

    // MARK: Ball

    private func drawBall(_ context: inout GraphicsContext, _ f: PitchProjection, hands: CGPoint?) {
        guard let ball = script.ball(at: t) else { return }
        let o = script.ballOpacity(at: t)
        let p = hands ?? f.point(ball)
        let ppm = f.scale(at: ball)
        let r = min(max(0.3 * ppm, 1.7), max(f.figure(at: ball.ground) * 0.11, 1.7))
        var trail: [CGPoint] = []
        if hands == nil, let flight = script.flights.last(where: { $0.start < t && t <= $0.end }), flight.kind != .carry {
            trail = (1...6).map { f.point(flight.point(at: max(t - Double($0) * 0.014, flight.start))) }
        }
        TheaterDraw.ball(at: p, radius: r, trail: trail, ink: ink, opacity: o, in: &context)
    }

    // MARK: Beats

    /// What the ball hits: a flash in the keeper's hands, the post ringing,
    /// a thud off a body; the net's own ripple is drawn with the goal.
    private func drawImpacts(_ context: inout GraphicsContext, _ f: PitchProjection) {
        for impact in script.impacts {
            let age = t - impact.at
            guard age >= 0 else { continue }
            let c = f.point(impact.point)
            let unit = f.figure(at: impact.point.ground) / 10
            switch impact.kind {
            case .save:
                guard age < 0.34 else { continue }
                let u = age / 0.34
                let r = (1.2 + 3.6 * (1 - pow(1 - u, 3))) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                               with: .color(ink.trace.opacity(0.85 * (1 - u))), lineWidth: max(unit * 0.2, 1))
                if age < 0.1 {
                    let d = (1.8 - age * 6) * unit
                    context.fill(Path(ellipseIn: CGRect(x: c.x - d, y: c.y - d, width: 2 * d, height: d * 2)), with: .color(ink.glow.opacity(0.45)))
                }
            case .woodwork:
                // The post rings: two rings out from where it struck.
                guard age < 0.7 else { continue }
                for k in 0..<2 {
                    let a = age - Double(k) * 0.12
                    guard a >= 0 else { continue }
                    let u = a / 0.58
                    guard u < 1 else { continue }
                    let r = (1.5 + 6 * Motion.curve.value(at: u)) * unit
                    context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                                   with: .color(ink.trace.opacity(0.9 * (1 - u))), lineWidth: max(unit * 0.18, 1))
                }
            case .block:
                guard age < 0.4 else { continue }
                let u = age / 0.4
                let r = (1.4 + 4.5 * Motion.curve.value(at: u)) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r * 0.8, width: 2 * r, height: 1.6 * r)),
                               with: .color(ink.trace.opacity(0.7 * (1 - u))), lineWidth: max(unit * 0.18, 1))
            case .net:
                continue
            }
        }
    }

    // MARK: Type

    private static let land = Spring(duration: 0.32, bounce: 0)

    private func drawLabels(_ context: inout GraphicsContext, _ f: PitchProjection) {
        let inset = max(f.size.height * 0.055, 9)
        for (i, banner) in script.banners.enumerated() where t >= banner.at && t < banner.until + 0.3 {
            if let symbol = context.resolveSymbol(id: Symbol.banner(i)) {
                TheaterHeadline.draw(symbol, in: &context, size: f.size, since: t - banner.at, leaving: banner.until - banner.at)
            }
        }
        // The stamp, as the moment resolves: in from larger on a quick spring that never bounces.
        if t >= script.stamp, let symbol = context.resolveSymbol(id: Symbol.stamp) {
            let x = t - script.stamp
            let v = x >= 1 ? 1 : min(Self.land.value(target: 1.0, time: x), 1)
            let grow = 1.22 - 0.22 * v
            var layer = context
            layer.opacity = min(x / 0.1, 1)
            if script.cornerRight {
                layer.translateBy(x: f.size.width - inset, y: f.size.height - inset * 0.8)
                layer.scaleBy(x: grow, y: grow)
                layer.draw(symbol, at: .zero, anchor: .bottomTrailing)
            } else {
                layer.translateBy(x: inset, y: f.size.height - inset * 0.8)
                layer.scaleBy(x: grow, y: grow)
                layer.draw(symbol, at: .zero, anchor: .bottomLeading)
            }
        }
    }

    private func color(_ tone: SoccerScript.Banner.Tone) -> Color {
        switch tone {
        case .team: teams.attacking.accent
        case .gold: ink.gold
        case .neutral: .primary
        }
    }

    /// Type sizes from the well's height: big where there's room.
    private var typeHeight: CGFloat { max(size.height, 120) }

    /// The stamp, low on the side away from the goal: the scorer's name big
    /// and heavy (in his team's color for a goal, gold for a late winner),
    /// the minute beside it, and under it in small capitals the assist, how
    /// it was struck and from how far.
    @ViewBuilder
    private var stamp: some View {
        if let scene {
            let size = min(max(typeHeight * 0.105, 15), 30)
            let tone: Color = scene.outcome == .goal ? (scene.decisive ? ink.gold : teams.attacking.accent) : .primary
            let detail = Self.detail(scene)
            VStack(alignment: script.cornerRight ? .trailing : .leading, spacing: size * 0.06) {
                HStack(alignment: .firstTextBaseline, spacing: size * 0.28) {
                    Text(SoccerScene.surname(scene.shooter))
                        .font(.system(size: size, weight: .heavy))
                        .tracking(-0.3)
                        .foregroundStyle(tone)
                    Text(scene.minute)
                        .font(.system(size: size * 0.6, weight: .semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if !detail.isEmpty {
                    Text(detail)
                        .font(.system(size: min(min(max(typeHeight * 0.05, 8), 13), self.size.width * 0.44 / (Double(detail.count) * 0.7)),
                                      weight: .bold))
                        .tracking(1)
                        .foregroundStyle(.secondary)
                }
            }
            .fixedSize()
        }
    }

    /// The stamp's second line: "AST ØDEGAARD · HEADER · 9 YD", "SAVED BY
    /// SUZUKI · 18 YD", "BIG CHANCE · 0.61 XG · WIDE".
    static func detail(_ scene: SoccerScene) -> String {
        var parts: [String] = []
        let technique: String? = scene.shot.penalty ? "Penalty" : scene.shot.technique == .header ? "Header"
            : scene.shot.technique == .volley ? "Volley" : nil
        let yards = scene.shot.penalty ? nil : "\(scene.distance) yd"
        switch scene.outcome {
        case .goal:
            parts = [scene.assist.map { "Ast \(SoccerScene.surname($0))" }, technique, yards].compactMap { $0 }
        case .ownGoal:
            parts = ["Own goal"]
        case .saved:
            parts = [scene.keeper.name.map { "Saved by \(SoccerScene.surname($0))" } ?? "Saved", technique, yards].compactMap { $0 }
        case .blocked:
            parts = [scene.blocker?.name.map { "Blocked by \(SoccerScene.surname($0))" } ?? "Blocked", technique, yards].compactMap { $0 }
        case .woodwork:
            parts = [scene.crossbar ? "Off the bar" : "Off the post", technique, yards].compactMap { $0 }
        case .wide:
            let over = (scene.shot.mouth?.z ?? 0) > Pitch.goalHeight && abs((scene.shot.mouth?.y ?? Pitch.width / 2) - Pitch.width / 2) < Pitch.goalWidth / 2
            parts = [(scene.shot.xg ?? 0) >= PitchAction.bigChanceXG ? "Big chance" : nil, scene.shot.xg.map { String(format: "%.2f xG", $0) },
                     technique, over ? "Over" : "Wide"].compactMap { $0 }
        }
        return parts.joined(separator: " · ").uppercased()
    }
}

extension TheaterInk {
    /// The goal frame: white, as it is.
    var goal: Color { dark ? Color.white.opacity(0.9) : Color.white }
    /// The net: a fine mesh, just there.
    var net: Color { dark ? Color.white.opacity(0.22) : Color.black.opacity(0.16) }
}

// MARK: - Theater

/// The soccer theater at the top of the Live Pitch. It reads the live lane
/// itself (and nothing above it does), so a new moment redraws the theater
/// alone; its caption is the moment in ESPN's words.
struct SoccerTheater: View {
    let feed: SoccerFeed?
    /// A moment to show before (or without) the live lane: previews, the harness.
    var preloaded: SoccerTheaterState? = nil
    let palette: TeamPalette
    /// The teams' own and second colors, so the figures always contrast.
    var kits: TheaterKits? = nil

    var body: some View {
        let live = feed?.loaded == true ? feed?.theater : nil
        let state = live.flatMap { $0.scene == nil ? nil : $0 } ?? preloaded ?? live ?? SoccerTheaterState()
        VStack(alignment: .leading, spacing: 6) {
            SoccerStage(state: state, palette: palette, kits: kits)
            caption(state.scene)
        }
    }

    /// ESPN runs a note onto the end of a sentence ("…with a cross.Goal
    /// confirmed following VAR Review."): a space between them.
    static func sentences(_ text: String) -> String {
        text.replacing(#/\.(?=\p{Lu})/#, with: ". ")
    }

    private func caption(_ scene: SoccerScene?) -> some View {
        Group {
            if let scene {
                (Text(scene.minute).fontWeight(.semibold).foregroundStyle(.primary)
                    + Text("  " + Self.sentences(scene.text)).foregroundStyle(.secondary))
            } else {
                Text("Goals, saves and big chances replay here as they happen.").foregroundStyle(.secondary)
            }
        }
        .font(Viz.note.monospacedDigit())
        .lineLimit(3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .id(scene?.id)
        .transition(.opacity.animation(Motion.fade))
    }
}

/// The theater's stage: the pitch and one frame of the moment through the
/// camera (a TimelineView only while it replays), and its celebration.
private struct SoccerStage: View {
    let state: SoccerTheaterState
    let palette: TeamPalette
    let kits: TheaterKits?
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    /// The replay on screen: which moment, when it began, and whether it's over.
    @State private var replay: Replay?
    /// The moment's script, built once (a body run for anything else reuses it).
    @State private var built = ScriptCache()

    struct Replay: Equatable {
        let id: String
        let start: Date
        var done = false
    }

    /// Half as tall as wide, up to this; wider than that, the pitch centers in the well.
    static let maxHeight: CGFloat = 320

    private var teams: SoccerTeams {
        let dressed: (top: Uniform, bottom: Uniform)
        if let kits {
            let d = TheaterTeams.dress(kits, scheme: scheme)
            dressed = (d.top, d.bottom)
        } else {
            dressed = (Uniform(TheaterTeams.solid(palette.top, scheme)), Uniform(TheaterTeams.solid(palette.bottom, scheme)))
        }
        // The moment's attacking team (home is the top team).
        let side = state.scene?.side ?? .top
        return side == .top ? SoccerTeams(attacking: dressed.top, defending: dressed.bottom)
            : SoccerTeams(attacking: dressed.bottom, defending: dressed.top)
    }

    /// Seconds into the moment on screen; infinity once it has ended (or was never replayed).
    private func time(at date: Date) -> Double {
        if case let .frozen(t) = clock { return t }
        guard let scene = state.scene else { return .infinity }
        if let replay, replay.id == scene.id { return replay.done ? .infinity : date.timeIntervalSince(replay.start) }
        // News not yet begun: its first frame (onChange begins it).
        return state.news && !reduceMotion ? 0 : .infinity
    }

    private var playing: Bool {
        guard clock == .live, let scene = state.scene else { return false }
        if let replay, replay.id == scene.id { return !replay.done }
        return state.news && !reduceMotion
    }

    var body: some View {
        let script = built.script(for: state.scene)
        let ink = TheaterInk(scheme)
        let teams = teams
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Group {
                    if playing {
                        TimelineView(.animation) { context in
                            let t = time(at: context.date)
                            PitchLayer(ink: ink, camera: script.frame(at: t)).equatable()
                            SoccerFrame(scene: state.scene, script: script, t: t, teams: teams, ink: ink, size: geo.size).equatable()
                        }
                        .transition(.identity)
                    } else {
                        let t = time(at: .now)
                        ZStack {
                            PitchLayer(ink: ink, camera: script.frame(at: t)).equatable()
                            SoccerFrame(scene: state.scene, script: script, t: t, teams: teams, ink: ink, size: geo.size).equatable()
                        }
                        .transition(.identity)
                    }
                }
                .id(state.scene?.id)
                // A replay cuts in; a moment that isn't replayed crossfades to how it ended.
                .transition(playing ? .identity : .opacity.animation(.easeInOut(duration: 0.35)))
                if let scene = state.scene {
                    SoccerCelebration(scene: scene, script: script, size: geo.size, color: teams.attacking.accent,
                                      start: replay?.id == scene.id ? replay?.start : nil)
                        .id(scene.id)
                }
            }
        }
        .modifier(HalfHeight(cap: Self.maxHeight))
        .vizWell(padding: 0)
        .accessibilityHidden(true)
        .onAppear(perform: begin)
        .onChange(of: state.scene?.id) { _, _ in begin() }
        .task(id: replay) {
            guard let replay, !replay.done else { return }
            try? await Task.sleep(for: .seconds(max(script.duration - Date.now.timeIntervalSince(replay.start), 0) + 0.05))
            guard !Task.isCancelled, self.replay?.id == replay.id else { return }
            self.replay?.done = true
        }
    }

    /// A new moment replays from its first touch; history and Reduce Motion don't.
    private func begin() {
        guard clock == .live, !reduceMotion, state.news, let scene = state.scene, replay?.id != scene.id else { return }
        replay = Replay(id: scene.id, start: .now)
    }
}

/// The last moment's script. A reference, so keeping it isn't a change
/// anything observes: building one (its camera track) is a couple of
/// milliseconds, and a body run that isn't about a new moment shouldn't.
private final class ScriptCache {
    private var scene: SoccerScene?
    private var script = SoccerScript()

    func script(for scene: SoccerScene?) -> SoccerScript {
        guard let scene else { return SoccerScript() }
        if scene != self.scene {
            self.scene = scene
            script = SoccerScript(scene)
        }
        return script
    }
}

/// Full width, half as tall, up to `cap`.
private struct HalfHeight: ViewModifier {
    let cap: CGFloat

    func body(content: Content) -> some View {
        HalfHeightLayout(cap: cap) { content }
    }
}

private struct HalfHeightLayout: Layout {
    let cap: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? Metrics.compactWidth - 2 * Metrics.gutter
        return CGSize(width: width, height: min(width / 2, cap).rounded())
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews { subview.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size)) }
    }
}

// MARK: - Celebration

/// One celebration per moment, and the theater owns the ones it replays
/// when the page shows it: a goal's fireworks burst over the net it went
/// into, with confetti off the headline (the Live Pitch only draws the
/// shot's path); a save's glint in the keeper's hands; sparks off the post.
/// Every burst goes through the page's rules (`Celebration.cue`): the
/// celebration level, Reduce Motion, and one particle burst every 10 s.
/// (pure; tested)
enum GoalCelebration {
    /// The moments the theater replays (and so celebrates): goals, saves,
    /// blocks, the woodwork, big chances. Cards stay the Live Pitch's.
    static func theaterOwns(_ m: LiveMoment) -> Bool {
        guard m.chart == .pitch else { return false }
        switch m.kind {
        case .goal, .shotSaved, .shotBlocked: return true
        case .shotWide: return m.accents.contains(.woodwork) || m.accents.contains(.bigChance)
        default: return false
        }
    }

    /// The Live Pitch bursts over a moment only when there's no theater to.
    static func pitchBursts(_ m: LiveMoment?, theaterShown: Bool) -> Bool {
        guard let m else { return false }
        return !theaterShown || !theaterOwns(m)
    }

    /// A burst on the theater's stage.
    struct Burst: Equatable {
        enum Anchor: Equatable {
            /// A point on the pitch: it moves with the camera.
            case field(FieldPoint)
            /// Under the headline.
            case banner
        }
        var cue: CelebrationCue
        /// Script time it mounts (its cue's own delay comes after).
        var at: Double
        var anchor: Anchor
        /// Larger than the charts' bursts: the theater is the stage.
        var scale: Double

        var end: Double { at + cue.duration }
    }

    /// The theater's bursts for this moment, in script time: fireworks over
    /// the net as a goal goes in (three, in gold, for a late winner or
    /// equalizer) and the headline's confetti; a save's glint; the post's
    /// sparks. Nothing for another moment, or when the level is Off.
    static func theater(_ moment: LiveMoment?, scene: SoccerScene, script: SoccerScript, level: CelebrationLevel,
                        reduceMotion: Bool, height: CGFloat) -> [Burst] {
        guard let moment, moment.id == scene.id, moment.chart == .pitch else { return [] }
        let gold = scene.decisive || moment.decisive
        func cue(_ effects: [CelebrationCue.Effect]) -> CelebrationCue? {
            var cue = Celebration.cue(for: moment, level: level, reduceMotion: reduceMotion, geometry: .init(height: height),
                                      direction: .degrees(90), effects: effects)
            if gold, scene.scored { cue?.gold = true }
            return cue
        }
        let scale = max(2.2, height / 95)
        var bursts: [Burst] = []
        let side = scene.attacksRight ? 1.0 : -1.0
        if scene.scored, let net = script.impacts.first(where: { $0.kind == .net }) {
            if let fireworks = cue([.fireworks(shells: gold ? 3 : 2)]) {
                // Just over the net it went into.
                let over = FieldPoint(x: scene.goal.x + side * 1.5, y: Pitch.width / 2, z: 5.5)
                bursts.append(Burst(cue: fireworks, at: net.at - fireworks.delay, anchor: .field(over), scale: scale))
            }
            if let banner = script.banners.first(where: \.confetti),
               let confetti = cue([.confetti(direction: .degrees(90), spread: .degrees(150), preset: .medium)]),
               confetti.effects.contains(where: { if case .confetti = $0 { return true }; return false }) {
                bursts.append(Burst(cue: confetti, at: banner.at + 0.1 - confetti.delay, anchor: .banner, scale: scale * 0.7))
            }
        } else if let hit = script.impacts.first(where: { $0.kind == .save || $0.kind == .woodwork }),
                  scene.outcome == .saved || scene.outcome == .woodwork,
                  let sparks = cue([.sparks(rays: 6, length: 11)]) {
            bursts.append(Burst(cue: sparks, at: hit.at - sparks.delay, anchor: .field(hit.point), scale: scale * 0.6))
        }
        return bursts
    }
}

/// The theater's bursts, drawn through the camera so a firework stays over
/// the net as the camera moves. A TimelineView only while one plays; on the
/// harness's frozen clock, the frame at t. The bursts are taken when the
/// moment arrives, so a goal at the end of a long move still has them after
/// the page's moment has moved on. With Reduce Motion there's no replay: a
/// goal blooms over the net, as the moment's end state shows.
private struct SoccerCelebration: View {
    let scene: SoccerScene
    let script: SoccerScript
    let size: CGSize
    let color: Color
    /// When the replay began.
    let start: Date?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// This moment's bursts, kept once it has had them.
    @State private var armed: [GoalCelebration.Burst]?
    @State private var live: Date?
    @State private var over: Date?

    var body: some View {
        let moment = momentFor(.pitch, in: moments)
        let current = GoalCelebration.theater(moment, scene: scene, script: script, level: level, reduceMotion: reduceMotion,
                                              height: size.height)
        let bursts = current.isEmpty ? armed ?? [] : current
        Group {
            switch clock {
            case let .frozen(t):
                if bursts.contains(where: { t >= $0.at && t <= $0.end }) { surface(bursts, at: t) }
            case .live:
                if reduceMotion {
                    // The end state: a bloom over the net it went into.
                    if moment?.id == scene.id, scene.scored {
                        let f = PitchProjection(size: size, camera: script.frame(at: .infinity))
                        CelebrationStage(moment: moment, origin: f.point(FieldPoint(scene.goal, z: 1.2)), size: size,
                                         colors: .team(color), wellInset: 0)
                    }
                } else if let start, live == start, over != start {
                    TimelineView(.animation) { context in surface(bursts, at: context.date.timeIntervalSince(start)) }
                }
            }
        }
        .onChange(of: current) { _, now in if !now.isEmpty { armed = now } }
        .onAppear { if !current.isEmpty { armed = current } }
        // Armed again if the moment lands a beat after the replay begins.
        .task(id: Arm(start: start, bursts: bursts.count)) {
            guard let start, clock == .live, let first = bursts.map(\.at).min(), let last = bursts.map(\.end).max() else { return }
            let wait = start.addingTimeInterval(first).timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard !Task.isCancelled else { return }
            live = start
            try? await Task.sleep(for: .seconds(max(start.addingTimeInterval(last).timeIntervalSinceNow, 0) + 0.05))
            guard !Task.isCancelled else { return }
            over = start
        }
        .allowsHitTesting(false)
    }

    private struct Arm: Hashable {
        let start: Date?
        let bursts: Int
    }

    private func surface(_ bursts: [GoalCelebration.Burst], at t: Double) -> some View {
        let palette = CelebrationColors.team(color).palette
        return Canvas { context, size in
            let f = PitchProjection(size: size, camera: script.frame(at: t))
            context.clip(to: f.bounds)
            for burst in bursts where t >= burst.at && t <= burst.end {
                let origin = switch burst.anchor {
                case let .field(p): f.point(p)
                case .banner: TheaterHeadline.confettiOrigin(in: size)
                }
                var layer = context
                layer.translateBy(x: origin.x, y: origin.y)
                layer.scaleBy(x: burst.scale, y: burst.scale)
                Celebration.draw(Celebration.particles(burst.cue, origin: .zero, t: t - burst.at), in: layer, palette: palette)
            }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }
}
