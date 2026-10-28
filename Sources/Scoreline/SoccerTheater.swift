import SwiftUI

// The soccer theater: at the top of the Live Pitch, the latest big moment
// replayed on a pitch in perspective as it arrives from the live lane, shot
// like a broadcast from high in the main stand. The camera rides the ball
// through the build-up (each pass from the man who played it to the man it
// found, standing where ESPN placed them), pushes in as the shot is struck,
// cuts behind the net for a shot on target so the finish reads, and holds on
// the goal and the scorer wheeling away. The shot goes to the
// exact point in the goal mouth it was heading for: in off the post, into
// the keeper's hands, onto the bar. Marquee moments get a headline (GOAL,
// SAVE, OFF THE POST, PENALTY, OWN GOAL) and a goal its fireworks over the
// net; the stamp names the scorer, the assist, the minute and the distance.
// The moment's own words, under it, are its caption.
//
// Drawn in one Canvas, the pitch and the players together, projected
// through the camera (SoccerScript.swift), so lines stay crisp at any zoom
// and the two never disagree on it. A TimelineView exists only while a
// replay runs; between moments the last one holds as it ended. Moments already on the page when it opened show as
// they ended; a new one mid-replay cuts to itself; with Reduce Motion each
// moment crossfades to how it ended and the camera never moves. Decorative
// for VoiceOver: the caption carries the moment.

/// The broadcast camera's perspective through a framing, filling the view.
struct PitchProjection {
    let size: CGSize
    let camera: PitchFrame
    let basis: PitchCamera.Basis
    /// Points per unit of the view's tangent plane.
    let focal: Double

    init(size: CGSize, camera: PitchFrame = .rest) {
        self.size = size
        self.camera = camera
        basis = PitchCamera.basis(camera.camera, camera.angle)
        let half = max(camera.span, 1) / 2 / basis.distance
        focal = max(min(size.height / 2 / half, size.width / 2 / (half * CameraFrame.aspect)), 1)
    }

    /// Behind which goal the camera is (nil: the main camera, in the stand).
    var behind: Bool? {
        if case let .behind(right) = camera.angle { return right }
        return nil
    }

    /// How far a point is from the lens, along its axis: what's further is drawn first.
    func depth(_ p: FieldPoint) -> Double { ((SIMD3(p.x, p.y, p.z) - basis.eye) * basis.forward).sum() }

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
/// stands beyond them. Drawn first in the frame's own pass, through the same
/// projection as the players, so the two can never disagree on the camera.
/// (The goals stand with the players, who can be in front of them or behind.)
enum PitchLayer {
    static func draw(_ context: inout GraphicsContext, _ f: PitchProjection, ink: TheaterInk) {
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
        let ppm = f.scale(at: FieldPoint(x: f.camera.x, y: f.camera.y))
        let line = min(max(0.75, ppm * 0.09), 1.7)

        // The bowl: the stands behind the boards on the far side and at each end, rising out of sight
        // (one shape, so where they meet isn't darker), their tiers just there. From behind a goal,
        // the stand at the camera's back is out of view and the near side's stand comes into it;
        // nothing is drawn behind the lens.
        let behind = f.behind
        let x0 = behind == false ? -8.0 : -70, x1 = behind == true ? L + 8 : L + 70
        var bowl = behind == nil ? ground(-70, -60, L + 70, W + 5) : Path(CGRect(origin: .zero, size: f.size))
        bowl.addPath(quad(FieldPoint(x: x0, y: W + 5), FieldPoint(x: x1, y: W + 5), FieldPoint(x: x1, y: W + 60, z: 34),
                          FieldPoint(x: x0, y: W + 60, z: 34)))
        if behind != nil {
            bowl.addPath(quad(FieldPoint(x: x0, y: -5), FieldPoint(x: x1, y: -5), FieldPoint(x: x1, y: -60, z: 34),
                              FieldPoint(x: x0, y: -60, z: 34)))
        }
        for (x, out, right) in [(-6.0, -40.0, false), (L + 6, 40.0, true)] where behind != right {
            bowl.addPath(quad(FieldPoint(x: x, y: -60), FieldPoint(x: x, y: W + 5), FieldPoint(x: x + out, y: W + 5, z: 25),
                              FieldPoint(x: x + out, y: -60, z: 25)))
        }
        context.fill(bowl, with: .color(ink.stands))
        var tiers = Path()
        for k in 1...5 {
            let y = W + 5 + Double(k) * 9, z = Double(k) * 9 * 34 / 55
            tiers.move(to: f.point(FieldPoint(x: x0, y: y, z: z)))
            tiers.addLine(to: f.point(FieldPoint(x: x1, y: y, z: z)))
            if behind != nil {
                tiers.move(to: f.point(FieldPoint(x: x0, y: -y + W, z: z)))
                tiers.addLine(to: f.point(FieldPoint(x: x1, y: -y + W, z: z)))
            }
        }
        context.stroke(tiers, with: .color(ink.stands), lineWidth: 0.5)
        // The grass, with its run-off, mowed in bands across the pitch.
        context.fill(ground(-4, -3.5, L + 4, W + 3.5), with: .color(ink.turf))
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
        if let edge = ink.chalkEdge {
            // On pale grass, each line sits in a soft edge of its own.
            context.stroke(lines, with: .color(edge), style: StrokeStyle(lineWidth: line + 1.2, lineCap: .round, lineJoin: .round))
        }
        context.stroke(lines, with: .color(ink.chalk), style: StrokeStyle(lineWidth: line, lineCap: .round, lineJoin: .round))
        // The spots.
        for p in [Pitch.center, CGPoint(x: Pitch.spot, y: W / 2), CGPoint(x: L - Pitch.spot, y: W / 2)] {
            let c = f.point(p), r = max(0.22 * f.scale(at: FieldPoint(p)), 1.1)
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r * 0.5, width: 2 * r, height: r)), with: .color(ink.chalk))
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

/// Soccer's poses beyond the shared ones, for a right-footer, relative to
/// his heading (at the ball, or where he's playing it).
extension RigPose {
    // A strike: the plant foot beside the ball, the swing leg drawn back, through the ball, and on; the arms out for balance.
    static let backswing = RigPose(hip: RigVector(-0.02, 0, 0.46), lean: -0.1, twist: -0.25, left: RigVector(0.06, 0.11, 0),
                                   right: RigVector(-0.3, -0.07, 0.22), leftArm: RigArm(swing: 0.75, spread: 0.95, turn: 0.1, bend: 0.3),
                                   rightArm: RigArm(swing: -0.45, spread: 0.6, bend: 0.35))
    static let strike = RigPose(hip: RigVector(0.02, 0, 0.45), lean: 0.08, twist: 0.1, left: RigVector(0.06, 0.12, 0),
                                right: RigVector(0.2, -0.04, 0.05), leftArm: RigArm(swing: 0.9, spread: 0.9, turn: 0.1, bend: 0.25),
                                rightArm: RigArm(swing: -0.65, spread: 0.6, bend: 0.3))
    static let followThrough = RigPose(hip: RigVector(0.05, 0, 0.47), lean: 0.2, twist: 0.3, left: RigVector(0.06, 0.12, 0),
                                       right: RigVector(0.4, -0.02, 0.3), leftArm: RigArm(swing: 0.6, spread: 0.85, turn: 0.2, bend: 0.3),
                                       rightArm: RigArm(swing: -0.3, spread: 0.5, bend: 0.35))
    /// Up for a header: off the ground, legs tucked, arms out, the head cocked back; then snapped through it.
    static let rise = RigPose(hip: RigVector(0, 0, 0.6), lean: -0.05, nod: -0.4, left: RigVector(-0.05, 0.07, 0.18), right: RigVector(-0.12, -0.07, 0.13),
                              leftArm: RigArm(swing: 0.9, spread: 1.0, bend: 0.6), rightArm: RigArm(swing: 0.9, spread: 1.0, bend: 0.6))
    static let header = RigPose(hip: RigVector(0.02, 0, 0.62), lean: 0.42, nod: 0.55, left: RigVector(-0.06, 0.07, 0.2),
                                right: RigVector(-0.12, -0.07, 0.15), leftArm: RigArm(swing: 0.4, spread: 1.15, bend: 0.5),
                                rightArm: RigArm(swing: 0.4, spread: 1.15, bend: 0.5))
    /// Both hands over his head, then through: a throw-in.
    static let throwBack = RigPose(hip: RigVector(-0.03, 0, 0.47), lean: -0.28, nod: -0.15, left: RigVector(0.14, 0.07, 0), right: RigVector(-0.14, -0.08, 0),
                                   leftArm: RigArm(swing: 2.85, spread: 0.12, bend: 1.45), rightArm: RigArm(swing: 2.85, spread: 0.12, bend: 1.45))
    static let throwThrough = RigPose(hip: RigVector(0.03, 0, 0.46), lean: 0.3, left: RigVector(0.14, 0.07, 0), right: RigVector(-0.14, -0.08, 0.02),
                                      leftArm: RigArm(swing: 1.85, spread: 0.1, bend: 0.25), rightArm: RigArm(swing: 1.85, spread: 0.1, bend: 0.25))
    /// Square to the shot, arms in, a stride wide: a block.
    static let block = RigPose(hip: RigVector(0, 0, 0.42), lean: -0.12, left: RigVector(0, 0.17, 0), right: RigVector(0, -0.17, 0), knees: 0.3,
                               leftArm: RigArm(swing: 0.3, spread: 0.0, turn: -0.7, bend: 1.7), rightArm: RigArm(swing: 0.3, spread: 0.0, turn: -0.7, bend: 1.7))
    /// The keeper takes it into his chest.
    static let gather = RigPose(hip: RigVector(-0.02, 0, 0.44), lean: 0.25, left: RigVector(0.05, 0.1, 0), right: RigVector(-0.05, -0.1, 0),
                                leftArm: RigArm(swing: 0.95, spread: 0.1, turn: -0.55, bend: 1.55), rightArm: RigArm(swing: 0.95, spread: 0.1, turn: -0.55, bend: 1.55))
    /// Arms up, chest out.
    static let celebrate = RigPose(lean: -0.15, nod: -0.25, leftArm: RigArm(swing: 2.45, spread: 0, turn: 1.25, bend: 0.15),
                                   rightArm: RigArm(swing: 2.45, spread: 0, turn: 1.25, bend: 0.15))
    /// Hands on his head.
    static let dejected = RigPose(lean: 0.08, nod: 0.25, leftArm: RigArm(swing: 2.2, spread: 0, turn: 1.15, bend: 2.3),
                                  rightArm: RigArm(swing: 2.2, spread: 0, turn: 1.15, bend: 2.3))

    /// The keeper at full stretch toward `d` (from his hips, in his heading's
    /// frame, body units): his body on the line to it, a top corner leaning
    /// him over and a ball along the grass laying him flat; one line from
    /// the trailing foot through him to the leading hand (the top one), the
    /// other just behind it, the push-off leg folded under.
    static func stretch(toward d: RigVector) -> RigPose {
        let side: Double = d.y >= 0 ? 1 : -1
        let across = max(hypot(d.x, d.y), 1e-6)
        // From upright toward the ball: a lean for a top corner, just past flat for one along the grass.
        let over = min(max(atan2(across, d.z), 0.55), 1.8)
        let line = RigVector(sin(over) * d.x / across, sin(over) * d.y / across, cos(over))
        // Leaning forward with the ball's forward part, then over toward it: his chest to the shooter all the way down.
        var p = RigPose(hip: RigVector(0, 0, 0.45), pitch: asin(line.x), bank: atan2(line.y, line.z), left: RigVector(0, 0.06, -0.04),
                        right: RigVector(0, -0.06, -0.04), knees: 0)
        let top = RigArm(swing: 3.08, spread: 0.15, bend: 0.03), under = RigArm(swing: 2.8, spread: 0.18, bend: 0.15)
        let push = RigVector(-0.1, side * 0.07, 0.15)
        if side > 0 { (p.rightArm, p.leftArm, p.left) = (top, under, push) } else { (p.leftArm, p.rightArm, p.right) = (top, under, push) }
        return p
    }

    /// Down on the grass after it, on his side.
    static func down(_ side: Double) -> RigPose {
        RigPose(hip: RigVector(0, 0, 0.1), bank: side * 1.45, left: RigVector(0, 0.06, -0.36), right: RigVector(-0.06, -0.07, -0.3),
                leftArm: RigArm(swing: 2.6, spread: 0.3, bend: 0.5), rightArm: RigArm(swing: 2.4, spread: 0.2, bend: 0.6))
    }
}

// MARK: - Players and ball

/// One frame of a moment through the camera: the pitch, the move's trail on
/// the grass and the shot's path, the shadows, the goals and the players far to near,
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
            PitchLayer.draw(&context, f, ink: ink)
            drawTrails(&context, f)
            let figures = posed(f)
            drawShadows(&context, f, figures)
            let hands = drawStage(&context, f, figures)
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

    private func drawShadows(_ context: inout GraphicsContext, _ f: PitchProjection, _ figures: [Posed]) {
        // Under the hips; smaller and fainter as he leaves the ground.
        for p in figures {
            let air = min(p.figure.air / 0.4, 1), w = p.height * 0.3 * (1 - 0.35 * air), g = p.figure.ground
            context.fill(Path(ellipseIn: CGRect(x: g.x - w, y: g.y - w * 0.3, width: 2 * w, height: w * 0.6)),
                         with: .color(ink.shadow.opacity(1 - 0.45 * air)))
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
    private func drawStage(_ context: inout GraphicsContext, _ f: PitchProjection, _ figures: [Posed]) -> CGPoint? {
        let attacking = FigureInks(teams.attacking, ink: ink, in: context)
        let defending = FigureInks(teams.defending, ink: ink, in: context)
        enum Item {
            case actor(Int)
            case goalBack(right: Bool)
            case nearPost(right: Bool)
            /// From behind a goal: all of it at once, at its goal line.
            case goal(right: Bool)
        }
        var items: [(depth: Double, item: Item)]
        if let behind = f.behind {
            items = script.actors.indices.map { (f.depth(FieldPoint(script.actors[$0].position(at: t))), .actor($0)) }
            for right in [false, true] {
                // The goal in front of the lens covers everyone beyond its line.
                let line = FieldPoint(x: right ? Pitch.length : 0, y: Pitch.width / 2)
                items.append((f.depth(line) + (right == behind ? -0.01 : 0.01), .goal(right: right)))
            }
        } else {
            items = script.actors.indices.map { (script.actors[$0].position(at: t).y, .actor($0)) }
            for right in [false, true] {
                items.append((Pitch.posts.far + 0.01, .goalBack(right: right)))
                items.append((Pitch.posts.near - 0.01, .nearPost(right: right)))
            }
        }
        var hands: CGPoint?
        for (_, item) in items.sorted(by: { $0.depth > $1.depth }) {
            switch item {
            case let .goalBack(right): drawGoal(&context, f, right: right, parts: [.net, .frame])
            case let .nearPost(right): drawGoal(&context, f, right: right, parts: [.nearPost])
            case let .goal(right):
                // Seen from behind, the net is nearest the lens; from the far end, furthest.
                drawGoal(&context, f, right: right, parts: right == f.behind ? [.nearPost, .frame, .net] : [.net, .frame, .nearPost])
            case let .actor(i):
                let actor = script.actors[i], figure = figures[i]
                TheaterDraw.figure(figure.figure, inks: actor.team == .attacking ? attacking : defending, height: figure.height, opacity: 1,
                                   in: context)
                if script.heldBy == i, t >= script.heldFrom { hands = figure.hands }
            }
        }
        return hands
    }

    /// A goal's parts, drawn in the order the camera needs them.
    private enum GoalPart { case net, frame, nearPost }

    /// The goal on one end: the net (its back, roof and sides), the far post
    /// and the bar, the near post. The net ripples where a goal went in; the
    /// woodwork shivers where a shot struck it.
    private func drawGoal(_ context: inout GraphicsContext, _ f: PitchProjection, right: Bool, parts: [GoalPart]) {
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
        for part in parts {
            switch part {
            case .nearPost:
                var p = Path()
                p.move(to: f.point(FieldPoint(x: x, y: posts.near + shiver, z: 0)))
                p.addLine(to: f.point(FieldPoint(x: x, y: posts.near + shiver, z: H)))
                context.stroke(p, with: .color(ink.postRim), style: StrokeStyle(lineWidth: post + 1.4, lineCap: .round))
                context.stroke(p, with: .color(ink.goal), style: StrokeStyle(lineWidth: post, lineCap: .round))
            case .frame:
                // The far post and the bar.
                var frame = Path()
                frame.move(to: f.point(FieldPoint(x: x, y: posts.far + shiver, z: 0)))
                frame.addLine(to: f.point(FieldPoint(x: x, y: posts.far + shiver, z: H + shiver)))
                frame.addLine(to: f.point(FieldPoint(x: x, y: posts.near + shiver, z: H + shiver)))
                context.stroke(frame, with: .color(ink.postRim), style: StrokeStyle(lineWidth: post + 1.4, lineCap: .round, lineJoin: .round))
                context.stroke(frame, with: .color(ink.goal), style: StrokeStyle(lineWidth: post, lineCap: .round, lineJoin: .round))
            case .net:
                drawNet(&context, f, right: right, x: x, s: s, depthLow: depthLow, depthHigh: depthHigh)
            }
        }
    }

    private func drawNet(_ context: inout GraphicsContext, _ f: PitchProjection, right: Bool, x: Double, s: Double, depthLow: Double,
                         depthHigh: Double) {
        let posts = Pitch.posts, H = Pitch.goalHeight
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
        // From behind it, the net is the nearest thing to the lens: a veil, its mesh heavier.
        let close = f.behind == right
        if close {
            var veil = Path()
            let across = (0...12).map { posts.near + (posts.far - posts.near) * Double($0) / 12 }
            veil.addLines(across.map { f.point(back($0, 0)) } + across.reversed().map { f.point(back($0, H)) })
            veil.closeSubpath()
            context.fill(veil, with: .color(ink.net.opacity(0.3)))
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
        context.stroke(mesh, with: .color(ink.net), lineWidth: close ? min(max(f.scale(at: FieldPoint(x: x, y: Pitch.width / 2)) * 0.02, 0.6), 1.1) : 0.5)
    }

    /// A player posed and placed at t: his figure, its height, and where
    /// his hands are (a keeper holding the ball has it there).
    private struct Posed {
        let figure: RigFigure
        let height: CGFloat
        let hands: CGPoint
    }

    /// Everyone at t, by actor.
    private func posed(_ f: PitchProjection) -> [Posed] {
        script.actors.indices.map { place(script.actors[$0], $0, f) }
    }

    private func place(_ actor: SoccerScript.Actor, _ index: Int, _ f: PitchProjection) -> Posed {
        let at = actor.position(at: t)
        let lens = RigLens(f, at: at)
        let (body, heading) = pose(actor, index, at: at, unit: lens.unit)
        var figure = RigFigure(body, heading: heading, lens: lens)
        // At full stretch, his leading hand goes exactly to the ball.
        if let dive = actor.dive, t >= dive.start {
            let target = f.point(dive.target), side = body.bank >= 0 ? 1.0 : -1.0
            let u = min(max((t - dive.start) / max(dive.reach - dive.start, 0.01), 0), 1)
            let fall = min(max((t - dive.reach) / 0.32, 0), 1)
            let lead = side > 0 ? figure.hands.1 : figure.hands.0
            let pull = fall > 0 ? 1 - smooth(fall) : smooth(u)
            figure.shift(by: CGVector(dx: (target.x - lead.x) * pull, dy: (target.y - lead.y) * pull))
            return Posed(figure: figure, height: lens.height, hands: side > 0 ? figure.hands.1 : figure.hands.0)
        }
        return Posed(figure: figure, height: lens.height, hands: figure.grip)
    }

    private func smooth(_ u: Double) -> Double { Rig.smooth(u) }

    /// The body at t, and its heading: at full stretch for the ball; else
    /// what he's doing (a strike, a header, a block, arms up) over how he's
    /// moving (striding to his planted feet), else how he stands: watching
    /// the ball. `unit`: body units to the metre where he stands. (tested)
    func pose(_ actor: SoccerScript.Actor, _ index: Int, at here: CGPoint, unit: Double) -> (RigPose, Double) {
        let track = index < script.rig.count ? script.rig[index] : RigTrack(at: here, height: 2.5)
        let m = track.motion(at: t)
        if let dive = actor.dive, t >= dive.start {
            let set = actor.position(at: dive.start)
            let u = min(max((t - dive.start) / max(dive.reach - dive.start, 0.01), 0), 1)
            let fall = min(max((t - dive.reach) / 0.32, 0), 1)
            // Toward the ball from his hips, as he set: along and across his heading, and up.
            let toward = Rig.yaw(RigVector((dive.target.x - set.x) * unit, (dive.target.y - set.y) * unit, 0), -m.heading)
            let d = RigVector(toward.x, toward.y, dive.target.z * unit - 0.45)
            var body = RigPose.ready.mix(.stretch(toward: d), smooth(u * 1.3)).mix(.down(d.y >= 0 ? 1 : -1), smooth(fall))
            // Off the ground on the way: daylight under him, gone as his hands reach the ball.
            body.hip.z += fall > 0 ? 0 : 4 * u * (1 - u) * 0.17
            return (body, m.heading)
        }
        func envelope(_ x: Double, attack: Double, release: Double) -> Double {
            x < 0 ? max(1 + x / attack, 0) : max(1 - x / release, 0)
        }
        let still: RigPose = actor.role == .keeper ? .ready : .stand
        let feet = track.feet(at: t, anchor: here, heading: m.heading, unit: unit, speed: m.speed, stand: (still.left, still.right))
        var base = still.mix(.gait(m, feet: feet), m.weight)
        for action in actor.actions {
            let x = t - action.at
            switch action.kind {
            case .kick:
                base = RigPose.keyed([(-0.24, base), (-0.09, .backswing), (0, .strike), (0.13, .followThrough), (0.45, base)], at: x) ?? base
            case .header:
                base = RigPose.keyed([(-0.32, base), (-0.12, .rise), (0.02, .header), (0.12, .header), (0.42, base)], at: x) ?? base
            case .throwIn:
                base = RigPose.keyed([(-0.5, base), (-0.15, .throwBack), (0.04, .throwThrough), (0.45, base)], at: x) ?? base
            case .control:
                base = base.over(.gather, envelope(x, attack: 0.12, release: 0.2) * 0.4, moving: m.weight)
            case .block:
                base = base.over(.block, envelope(x, attack: 0.18, release: 0.5), moving: m.weight)
            case .gather:
                // Takes it in and holds it there.
                base = base.over(.gather, x < 0 ? max(1 + x / 0.2, 0) : 1, moving: m.weight)
            case .celebrate:
                base = base.over(.celebrate, smooth((x + 0.25) / 0.35), moving: m.weight)
            case .dejected:
                base = base.over(.dejected, smooth(x / 0.35), moving: m.weight)
            }
        }
        return (base, m.heading)
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
        TheaterDraw.ball(at: p, radius: r, trail: trail, ink: ink, opacity: o, in: context)
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
    /// Round the posts: the figures' halo in the dark; in the light a soft
    /// shade, so white posts read on pale grass.
    var postRim: Color { dark ? halo : Color.black.opacity(0.22) }
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

    /// What the stage shows: a moment replaying, then its end (the scorer
    /// wheeling away, the stamp) until it has held (`rested`); a new moment
    /// not yet begun; otherwise nil, the quiet pitch. History that isn't
    /// news is never shown: moments can be twenty minutes apart, and on
    /// opening the page the pitch is quiet. (pure; tested)
    static func shown(_ state: SoccerTheaterState, replaying: String?, rested: String?) -> SoccerScene? {
        guard let scene = state.scene else { return nil }
        if replaying == scene.id { return rested == scene.id ? nil : scene }
        return state.news ? scene : nil
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

    /// A replayed moment's end that has had its time on screen.
    @State private var rested: String?

    /// The moment on screen (see `SoccerTheater.shown`); nil, the quiet pitch.
    private var shown: SoccerScene? { SoccerTheater.shown(state, replaying: replay?.id, rested: rested) }

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
        let side = shown?.side ?? .top
        return side == .top ? SoccerTeams(attacking: dressed.top, defending: dressed.bottom)
            : SoccerTeams(attacking: dressed.bottom, defending: dressed.top)
    }

    /// Seconds into the moment on screen; infinity once it has ended (or was never replayed).
    private func time(at date: Date) -> Double {
        if case let .frozen(t) = clock { return t }
        guard let scene = shown else { return .infinity }
        if let replay, replay.id == scene.id { return replay.done ? .infinity : date.timeIntervalSince(replay.start) }
        // News not yet begun: its first frame (onChange begins it).
        return state.news && !reduceMotion ? 0 : .infinity
    }

    private var playing: Bool {
        guard clock == .live, let scene = shown else { return false }
        if let replay, replay.id == scene.id { return !replay.done }
        return state.news && !reduceMotion
    }

    var body: some View {
        let scene = shown
        let script = built.script(for: scene)
        let ink = TheaterInk(scheme)
        let teams = teams
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Group {
                    if playing {
                        TimelineView(.animation) { context in
                            SoccerFrame(scene: scene, script: script, t: time(at: context.date), teams: teams, ink: ink, size: geo.size)
                                .equatable()
                        }
                        .transition(.identity)
                    } else {
                        SoccerFrame(scene: scene, script: script, t: time(at: .now), teams: teams, ink: ink, size: geo.size)
                            .equatable()
                            .transition(.identity)
                    }
                }
                .id(scene?.id)
                // A replay cuts in; a moment that isn't replayed crossfades to how it ended.
                .transition(playing ? .identity : .opacity.animation(.easeInOut(duration: 0.35)))
                if let scene {
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
            guard let replay else { return }
            if !replay.done {
                try? await Task.sleep(for: .seconds(max(script.duration - Date.now.timeIntervalSince(replay.start), 0) + 0.05))
                guard !Task.isCancelled, self.replay?.id == replay.id else { return }
                self.replay?.done = true
                return
            }
            // Done: its end holds a while (unless the next moment comes), then the pitch goes quiet.
            try? await Task.sleep(for: TheaterKit.hold)
            guard !Task.isCancelled, self.replay?.id == replay.id else { return }
            rested = replay.id
        }
    }

    /// A new moment replays from its first touch; with Reduce Motion it's
    /// over at once (its end crossfades in, and holds). History doesn't.
    private func begin() {
        guard clock == .live, state.news, let scene = state.scene, replay?.id != scene.id else { return }
        replay = Replay(id: scene.id, start: .now, done: reduceMotion)
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
        let scale = TheaterBurst.scale(height)
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
                case let .field(p): TheaterBurst.inside(f.point(p), size)
                case .banner: TheaterHeadline.confettiOrigin(in: size)
                }
                var layer = context
                layer.translateBy(x: origin.x, y: origin.y)
                Celebration.draw(TheaterBurst.spread(Celebration.particles(burst.cue, origin: .zero, t: t - burst.at), by: burst.scale), in: layer,
                                 palette: palette)
            }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }
}
