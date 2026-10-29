import SwiftUI

// The football theater: in the Field section, above the drive chart, the
// last snap replayed on an isometric field as it arrives from the live
// lane, shot like a broadcast. The camera opens behind the offense on the
// formation, with the line of scrimmage in blue and the line to gain in
// yellow; it follows the ball in the air and the man carrying it, then
// frames the end spot and the new line to gain as the stamp lands ("+12",
// "1ST DOWN", "−7 SACK", "INC", "FG 47 ✓"). Marquee plays get a headline
// across the top (TOUCHDOWN, FIELD GOAL, INTERCEPTION), and a touchdown's
// fireworks burst over the goal line it crossed; its extra point or
// two-point try follows as a short beat of its own once ESPN has it. The
// drive chart under it, and its play-by-play, is its caption.
//
// Built from the baseball theater's parts: its projection, camera framing,
// pictogram figures, ball and type (TheaterKit.swift). Drawn in one Canvas,
// the field and the players together through the camera, so lines stay
// crisp at any zoom and the two never disagree on it. A TimelineView exists
// only while a replay runs; between plays the field is static. Plays
// already on the page when it opened show as they ended; a new one
// mid-replay cuts to itself; with Reduce Motion each play crossfades to how
// it ended and the camera never moves. Decorative for VoiceOver: the drive
// chart carries the play.

// MARK: - Field

/// The field: the turf mowed in five-yard bands, the end zones in the colors
/// of the teams defending them with their names, the yard lines, hash marks
/// and numbers, the sidelines, and the goalposts. Drawn first in the frame's
/// own pass, through the same projection as the players, so the two can
/// never disagree on the camera; its type is laid out once with the frame's.
/// The goalposts stand up off it, with the play: over the names on the field.
enum GridironLayer {
    struct EndZone: Equatable {
        var color = Color.gray
        var name = ""
    }

    /// The end zone the offense defends (nearest the camera) and the one it attacks.
    struct Zones: Equatable {
        var near = EndZone()
        var far = EndZone()
    }

    private enum Symbol: Hashable { case number(Int), near, far }

    static func draw(_ context: inout GraphicsContext, _ f: GridProjection, ink: TheaterInk, zones: Zones) {
        let yaw = f.yaw
        let h = Gridiron.half
        func quad(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) -> Path {
            var path = Path()
            path.addLines([f.point(CGPoint(x: x0, y: y0)), f.point(CGPoint(x: x1, y: y0)), f.point(CGPoint(x: x1, y: y1)),
                           f.point(CGPoint(x: x0, y: y1))])
            path.closeSubpath()
            return path
        }
        // What's in view, down the field (with a margin for the posts): lines outside it aren't drawn.
        let seen = Self.visible(f)
        func shown(_ y: Double) -> Bool { y >= seen.lowerBound - 12 && y <= seen.upperBound + 40 }
        // Chalk thickens a little as the camera closes in.
        let line = min(max(0.75, f.scale * 0.3), 1.6)
        /// Type painted flat on the grass: a glyph's right and down along these ground directions.
        func flat(right u: CGVector, down v: CGVector, at p: CGPoint, scale k: Double) -> CGAffineTransform {
            let c = f.point(p), s = f.scale
            let gx = CGVector(dx: cos(yaw) * s, dy: 0.5 * sin(yaw) * s), gy = CGVector(dx: sin(yaw) * s, dy: -0.5 * cos(yaw) * s)
            return CGAffineTransform(a: (u.dx * gx.dx + u.dy * gy.dx) * k, b: (u.dx * gx.dy + u.dy * gy.dy) * k,
                                     c: (v.dx * gx.dx + v.dy * gy.dx) * k, d: (v.dx * gx.dy + v.dy * gy.dy) * k, tx: c.x, ty: c.y)
        }

        // The turf runs on past the sidelines (a chase to the sideline never looks into a void); the field is mowed.
        context.fill(quad(-h - 110, -Gridiron.endZone - 110, h + 110, Gridiron.backLine + 130), with: .color(ink.turf))
        // Mowed in five-yard bands, every other one lighter.
        var bands = Path()
        for k in stride(from: 0, to: 20, by: 2) where shown(Double(k) * 15) || shown(Double(k + 1) * 15) {
            bands.addPath(quad(-h, Double(k) * 15, h, Double(k + 1) * 15))
        }
        context.fill(bands, with: .color(ink.mow))
        // The end zones, in their teams' colors, with their names.
        context.fill(quad(-h, -Gridiron.endZone, h, 0), with: .color(zones.near.color.opacity(ink.dark ? 0.34 : 0.28)))
        context.fill(quad(-h, 300, h, Gridiron.backLine), with: .color(zones.far.color.opacity(ink.dark ? 0.34 : 0.28)))
        for (symbol, y) in [(Symbol.near, -15.0), (.far, 315)] where shown(y) {
            guard let text = context.resolveSymbol(id: symbol) else { continue }
            // 14 ft letters, read from behind the offense.
            let k = min(14 / text.size.height, 140 / max(text.size.width, 1))
            var layer = context
            layer.opacity = 0.42
            layer.concatenate(flat(right: CGVector(dx: 1, dy: 0), down: CGVector(dx: 0, dy: -1), at: CGPoint(x: 0, y: y), scale: k))
            layer.draw(text, at: .zero, anchor: .center)
        }

        // Yard lines every five, the goal lines heavier.
        var lines = Path(), goals = Path()
        for k in 0...20 where shown(Double(k) * 15) {
            let y = Double(k) * 15
            var stripe = Path()
            stripe.move(to: f.point(CGPoint(x: -h, y: y)))
            stripe.addLine(to: f.point(CGPoint(x: h, y: y)))
            if k == 0 || k == 20 { goals.addPath(stripe) } else { lines.addPath(stripe) }
        }
        let border = quad(-h, -Gridiron.endZone, h, Gridiron.backLine)
        if let edge = ink.chalkEdge {
            // On pale grass, each line sits in a soft edge of its own.
            var all = lines
            all.addPath(goals)
            context.stroke(all, with: .color(edge), lineWidth: line * 1.3 + 1.2)
            context.stroke(border, with: .color(edge), lineWidth: line * 1.8 + 1.2)
        }
        context.stroke(lines, with: .color(ink.chalk.opacity(ink.dark ? 0.75 : 1)), lineWidth: line)
        context.stroke(goals, with: .color(ink.chalk), lineWidth: line * 1.6)
        // Hash marks every yard, where there's room to see them.
        if f.scale >= 1.1 {
            var hashes = Path()
            for yard in 1..<100 where yard % 5 != 0 && shown(Double(yard) * 3) {
                let y = Double(yard) * 3
                for x in [-Gridiron.hash, Gridiron.hash - 2, -h + 0.7, h - 2.7] {
                    hashes.move(to: f.point(CGPoint(x: x, y: y)))
                    hashes.addLine(to: f.point(CGPoint(x: x + 2, y: y)))
                }
            }
            context.stroke(hashes, with: .color(ink.chalk.opacity(0.6)), lineWidth: line * 0.8)
        }
        // The numbers, read from the sidelines: 6 ft tall, their tops toward the middle.
        if f.scale >= 0.9 {
            var layer = context
            layer.opacity = 0.7
            for k in 1...9 where shown(Double(k) * 30) {
                guard let text = context.resolveSymbol(id: Symbol.number(k <= 5 ? k * 10 : 100 - k * 10)) else { continue }
                let s = 6 / text.size.height
                for side in [-1.0, 1.0] {
                    var number = layer
                    number.concatenate(flat(right: CGVector(dx: 0, dy: -side), down: CGVector(dx: side, dy: 0),
                                            at: CGPoint(x: side * Gridiron.numbers, y: Double(k) * 30), scale: s))
                    number.draw(text, at: .zero, anchor: .center)
                }
            }
        }
        // The sidelines and end lines.
        context.stroke(border, with: .color(ink.chalk), lineWidth: line * 1.8)
    }

    /// The goalposts on the end lines: the post, the crossbar, the uprights.
    static func posts(_ context: GraphicsContext, _ f: GridProjection, ink: TheaterInk) {
        let seen = Self.visible(f), line = min(max(0.75, f.scale * 0.3), 1.6)
        for y in [-Gridiron.endZone, Gridiron.backLine] where y >= seen.lowerBound - 12 && y <= seen.upperBound + 40 {
            var post = Path()
            post.move(to: f.point(CGPoint(x: 0, y: y), z: 0))
            post.addLine(to: f.point(CGPoint(x: 0, y: y), z: Gridiron.crossbar))
            post.move(to: f.point(CGPoint(x: -Gridiron.upright, y: y), z: Gridiron.uprightTop))
            post.addLine(to: f.point(CGPoint(x: -Gridiron.upright, y: y), z: Gridiron.crossbar))
            post.addLine(to: f.point(CGPoint(x: Gridiron.upright, y: y), z: Gridiron.crossbar))
            post.addLine(to: f.point(CGPoint(x: Gridiron.upright, y: y), z: Gridiron.uprightTop))
            context.stroke(post, with: .color(ink.dark ? Celebrate.gold.opacity(0.85) : ink.gold),
                           style: StrokeStyle(lineWidth: line + 0.35, lineCap: .round, lineJoin: .round))
        }
    }

    /// The field's type, for the frame's symbols: the yard numbers and the end zones' names.
    @ViewBuilder
    static func symbols(ink: TheaterInk, zones: Zones) -> some View {
        ForEach([10, 20, 30, 40, 50], id: \.self) { n in
            Text("\(n)").font(.system(size: 40, weight: .bold).monospacedDigit()).foregroundStyle(ink.chalk).tag(Symbol.number(n))
        }
        // On one line whatever the well's width (a narrow one would wrap a long name).
        Text(zones.near.name).font(.system(size: 60, weight: .black).width(.expanded)).foregroundStyle(ink.chalk).fixedSize().tag(Symbol.near)
        Text(zones.far.name).font(.system(size: 60, weight: .black).width(.expanded)).foregroundStyle(ink.chalk).fixedSize().tag(Symbol.far)
    }

    /// How far down the field the view reaches, near edge to far (on the
    /// grass): the view's corners taken back through the camera.
    static func visible(_ f: GridProjection) -> ClosedRange<Double> {
        let yaw = f.yaw
        let ys = [(0.0, 0.0), (f.size.width, 0), (0, f.size.height), (f.size.width, f.size.height)].map { sx, sy -> Double in
            let x = f.camera.x + (sx - f.size.width / 2) / f.scale
            let y = (f.camera.y - (sy - f.size.height / 2) / f.scale) / 0.5
            return x * sin(yaw) + y * cos(yaw)
        }
        return (ys.min() ?? 0)...(ys.max() ?? 300)
    }
}

// MARK: - Players and ball

/// The two teams on the field, always told apart at a glance.
struct FootballTeams: Equatable {
    var offense: Uniform
    var defense: Uniform
}

/// Football's poses beyond the shared ones, relative to his heading (up
/// the field for the offense, down it for the defense).
enum GridPose {
    /// Down in a three-point stance: wide, hips up, a hand on the grass.
    static let stance = RigPose(hip: RigVector(-0.08, 0, 0.33), lean: 1.1, left: RigVector(0.02, 0.15, 0), right: RigVector(-0.08, -0.15, 0),
                                knees: 0.35, leftArm: RigArm(swing: 0.55, spread: 0.2, turn: -0.3, bend: 1.2),
                                rightArm: RigArm(swing: 1.05, spread: 0.12, turn: -0.1, bend: 0.05))
    /// The quarterback under center, hands under him.
    static let center = RigPose(hip: RigVector(-0.06, 0, 0.38), lean: 0.5, left: RigVector(0, 0.13, 0), right: RigVector(0, -0.13, 0), knees: 0.3,
                                leftArm: RigArm(swing: 0.85, spread: 0.05, turn: -0.35, bend: 0.4),
                                rightArm: RigArm(swing: 0.85, spread: 0.05, turn: -0.35, bend: 0.4))
    /// Engaged: low, arms up and out in front.
    static let block = RigPose(hip: RigVector(-0.03, 0, 0.42), lean: 0.4, left: RigVector(0.1, 0.13, 0), right: RigVector(-0.1, -0.13, 0), knees: 0.3,
                               leftArm: RigArm(swing: 1.45, spread: 0.2, turn: -0.25, bend: 0.65),
                               rightArm: RigArm(swing: 1.45, spread: 0.2, turn: -0.25, bend: 0.65))
    /// On a knee: the quarterback's kneel, a returner's touchback.
    static let kneel = RigPose(hip: RigVector(-0.02, 0, 0.26), lean: 0.08, left: RigVector(0.22, 0.08, 0), right: RigVector(-0.26, -0.07, 0.01),
                               knees: 0.05, leftArm: RigArm(swing: 0.55, spread: 0.15, turn: -0.2, bend: 0.9),
                               rightArm: RigArm(swing: 0.2, spread: 0.2, bend: 0.4))
    /// Brought down: flat on the grass.
    static let down = RigPose(hip: RigVector(0.1, 0, 0.1), pitch: 1.5, lean: 0.05, nod: -0.4, left: RigVector(-0.02, 0.08, -0.39),
                              right: RigVector(0.02, -0.09, -0.36), leftArm: RigArm(swing: 2.6, spread: 0.35, bend: 0.4),
                              rightArm: RigArm(swing: 2.2, spread: 0.3, bend: 0.6))
    /// The touchdown signal: both arms straight up.
    static let touchdown = RigPose(lean: -0.08, leftArm: RigArm(swing: 3.05, spread: 0, turn: 0.4, bend: 0.05),
                                   rightArm: RigArm(swing: 3.05, spread: 0, turn: 0.4, bend: 0.05))
    /// A hand up for the fair catch.
    static let fairCatch = RigPose(leftArm: RigArm(swing: 2.85, spread: 0, turn: 0.6, bend: 0.1), rightArm: RigArm(swing: 0.1, spread: 0.15, bend: 0.3))
    /// Launched at a man: laid out forward, arms reaching.
    static let dive = RigPose(hip: RigVector(0.12, 0, 0.36), pitch: 1.1, lean: 0.1, left: RigVector(-0.04, 0.08, 0.02), right: RigVector(-0.24, -0.08, 0.14),
                              leftArm: RigArm(swing: 2.85, spread: 0.2, turn: -0.1, bend: 0.25),
                              rightArm: RigArm(swing: 2.7, spread: 0.25, turn: -0.1, bend: 0.3))
    /// The ball in both hands at the chest: a quarterback in the pocket.
    static let pocket = RigPose(leftArm: RigArm(swing: 0.7, spread: 0.05, turn: -0.6, bend: 2.0),
                                rightArm: RigArm(swing: 0.75, spread: 0.08, turn: -0.55, bend: 2.05))
    /// The ball tucked under his arm, the forearm across it.
    static let tuck = RigArm(swing: 0.35, spread: 0.08, turn: -0.75, bend: 2.0)
    /// The kick: the plant foot down, the leg cocked back, then through and high.
    static let windup = RigPose(hip: RigVector(0, 0, 0.46), lean: -0.1, left: RigVector(0.06, 0.09, 0), right: RigVector(-0.27, -0.07, 0.22),
                                leftArm: RigArm(swing: 0.9, spread: 0.8, turn: 0.2, bend: 0.3),
                                rightArm: RigArm(swing: -0.6, spread: 0.35, bend: 0.4))
    static let through = RigPose(hip: RigVector(0.04, 0, 0.47), lean: -0.3, left: RigVector(0.06, 0.09, 0), right: RigVector(0.44, -0.05, 0.6),
                                 leftArm: RigArm(swing: 1.4, spread: 0.85, turn: 0.2, bend: 0.25),
                                 rightArm: RigArm(swing: -0.85, spread: 0.45, bend: 0.3))
    /// The strip: lunging in low, one arm wrapping, the other punching down across at the ball.
    static let strip = RigPose(hip: RigVector(0.02, 0, 0.4), lean: 0.75, twist: 0.35, left: RigVector(0.16, 0.12, 0), right: RigVector(-0.16, -0.12, 0),
                               knees: 0.3, leftArm: RigArm(swing: 1.35, spread: 0.2, turn: -0.3, bend: 0.7),
                               rightArm: RigArm(swing: 0.95, spread: 0.05, turn: -0.55, bend: 0.25))
    /// Laid out on the grass for a loose ball, both arms reaching for it.
    static let scramble = RigPose(hip: RigVector(0.15, 0, 0.2), pitch: 1.4, lean: 0.1, nod: -0.5, left: RigVector(-0.1, 0.1, 0.05),
                                  right: RigVector(-0.3, -0.08, 0.1), leftArm: RigArm(swing: 2.7, spread: 0.3, turn: -0.2, bend: 0.5),
                                  rightArm: RigArm(swing: 2.9, spread: 0.2, turn: -0.2, bend: 0.35))
    /// Up off the line to block a kick: feet tucked, both arms straight up.
    static let leap = RigPose(hip: RigVector(0, 0, 0.62), lean: -0.05, nod: -0.3, left: RigVector(0, 0.07, 0.14), right: RigVector(-0.05, -0.07, 0.12),
                              leftArm: RigArm(swing: 3.0, spread: 0.12, turn: 0.2, bend: 0.05),
                              rightArm: RigArm(swing: 3.0, spread: 0.12, turn: 0.2, bend: 0.05))
    /// On his back after a hit as he threw, arms flung out.
    static let knocked = RigPose(hip: RigVector(-0.1, 0, 0.12), pitch: -1.45, nod: 0.35, left: RigVector(0.02, 0.1, -0.36),
                                 right: RigVector(0.06, -0.1, -0.3), knees: 0.3, leftArm: RigArm(swing: 2.5, spread: 0.55, bend: 0.4),
                                 rightArm: RigArm(swing: 2.3, spread: 0.6, bend: 0.5))
    /// An official's flag: drawn back and up beside his head, then whipped through and down at the spot.
    static let flagBack = RigPose(turn: -0.35, twist: -0.3, left: RigVector(0.08, 0.1, 0), right: RigVector(-0.08, -0.1, 0),
                                  leftArm: RigArm(swing: 0.6, spread: 0.3, bend: 0.4), rightArm: RigArm(swing: 2.5, spread: 0.45, turn: 0.9, bend: 1.3))
    static let flagThrow = RigPose(turn: 0.15, lean: 0.25, twist: 0.3, left: RigVector(0.14, 0.1, 0), right: RigVector(-0.12, -0.1, 0.02),
                                   leftArm: RigArm(swing: 0.3, spread: 0.35, bend: 0.4), rightArm: RigArm(swing: 1.35, spread: 0.15, turn: -0.3, bend: 0.2))
}

/// One frame of a play through the camera: the field, the lines on it, the
/// shadows, the names, the goalposts, the flag, the players far to near, the
/// ball, the beats, the headline and the stamp. Equatable: at rest (t = ∞)
/// an update elsewhere on the page doesn't redraw it.
struct FootballFrame: View, Equatable {
    let scene: FootballScene?
    let script: FootballScript
    let t: Double
    let teams: FootballTeams
    let ink: TheaterInk
    /// Where it's drawn: the type is sized from it.
    let size: CGSize
    var zones = GridironLayer.Zones()
    /// The names over the players: the pointer's, the key man's.
    var tags = TheaterTags()

    /// The time first: mid-replay it's all that differs.
    static func == (a: FootballFrame, b: FootballFrame) -> Bool {
        a.t == b.t && a.size == b.size && a.teams == b.teams && a.ink == b.ink && a.zones == b.zones && a.tags == b.tags && a.scene == b.scene
            && a.script == b.script
    }

    /// The type, laid out once as views and drawn into each frame.
    private enum Symbol: Hashable { case stamp, banner, declined }

    /// A team's trainers: slate, a pale cap.
    static let staff = Uniform(jersey: Color(red: 0.42, green: 0.47, blue: 0.53), cap: Color(white: 0.8), accent: Color(white: 0.5))

    /// The broadcast's lines: the line of scrimmage blue, the line to gain yellow.
    static let scrimmageBlue = Color(red: 0.25, green: 0.52, blue: 1)
    static let gainYellow = Color(red: 1, green: 0.84, blue: 0.1)
    /// A coach's challenge flag.
    static let challengeRed = Color(red: 0.9, green: 0.12, blue: 0.1)

    var body: some View {
        Canvas { context, size in
            let f = GridProjection(size: size, camera: script.camera.frame(at: t), yaw: script.yaw(at: t))
            context.clip(to: f.bounds)
            GridironLayer.draw(&context, f, ink: ink, zones: zones)
            drawLines(&context, f)
            let figures = posed(f), held = figures.lazy.compactMap(\.ball).first
            drawShadows(&context, f, figures)
            // The names on the field, under all that plays: the posts and a flag in the air too.
            let stems = drawTags(context, f, figures, held: held)
            GridironLayer.posts(context, f, ink: ink)
            drawFlag(&context, f)
            drawPlayers(&context, f, figures, stems: stems)
            drawBall(&context, f, held: held)
            drawFlashes(&context, f)
            drawLabels(&context, f)
        } symbols: {
            GridironLayer.symbols(ink: ink, zones: zones)
            stamp.tag(Symbol.stamp)
            banner.tag(Symbol.banner)
            tags.symbols(at: t, size: size)
            if script.flags.contains(where: \.declined) {
                Text("DECLINED").font(.system(size: TheaterType.title(size) * 0.9, weight: .heavy)).tracking(0.8)
                    .foregroundStyle(Self.gainYellow).fixedSize().tag(Symbol.declined)
            }
        }
    }

    // MARK: Lines

    private func drawLines(_ context: inout GraphicsContext, _ f: GridProjection) {
        let u = script.linesProgress(at: t)
        // After a score or a kick they fade with the play's end.
        func band(_ y: Double, width: Double) -> Path {
            var path = Path()
            path.addLines([f.point(CGPoint(x: -Gridiron.half, y: y - width / 2)), f.point(CGPoint(x: Gridiron.half, y: y - width / 2)),
                           f.point(CGPoint(x: Gridiron.half, y: y + width / 2)), f.point(CGPoint(x: -Gridiron.half, y: y + width / 2))])
            path.closeSubpath()
            return path
        }
        let width = max(1.4, 1.6 / max(f.scale, 0.1))
        if let gain = FootballScript.line(script.lines.gain, script.next.gain, u: u) {
            context.fill(band(gain.y, width: width), with: .color(Self.gainYellow.opacity(0.85 * gain.opacity)))
        }
        if let line = FootballScript.line(script.lines.scrimmage, script.next.scrimmage, u: u) {
            context.fill(band(line.y, width: width), with: .color(Self.scrimmageBlue.opacity(0.85 * line.opacity)))
        }
        // A flag's yards, while they're walked off: a band between the spots.
        if let march = script.march, t >= march.start - 0.2, t < script.settle + 0.4 {
            let grow = PlayScript.Ease.inOut.value((t - march.start) / max(march.end - march.start, 0.01))
            let fade = 1 - min(max((t - script.settle) / 0.4, 0), 1)
            let to = march.from + (march.to - march.from) * grow
            var path = Path()
            path.addLines([f.point(CGPoint(x: -Gridiron.half, y: march.from)), f.point(CGPoint(x: Gridiron.half, y: march.from)),
                           f.point(CGPoint(x: Gridiron.half, y: to)), f.point(CGPoint(x: -Gridiron.half, y: to))])
            path.closeSubpath()
            context.fill(path, with: .color(Self.gainYellow.opacity(0.14 * fade)))
        }
    }

    /// The flags: each tossed in end over end, then lying where it landed
    /// until the field settles; a declined one says so beside it once the
    /// play is over.
    private func drawFlag(_ context: inout GraphicsContext, _ f: GridProjection) {
        for flag in script.flags where t >= flag.thrown && t < script.settle + 0.3 {
            drawFlag(flag, &context, f)
        }
    }

    private func drawFlag(_ flag: FootballScript.Flag, _ context: inout GraphicsContext, _ f: GridProjection) {
        let u = min(max((t - flag.thrown) / (flag.lands - flag.thrown), 0), 1)
        let x = flag.from.x + (flag.to.x - flag.from.x) * u, y = flag.from.y + (flag.to.y - flag.from.y) * u
        let z = flag.from.z * (1 - u) + 10 * 4 * u * (1 - u)
        let p = f.point(CGPoint(x: x, y: y), z: z)
        let s = max(f.scale * 1.4, 2.2)
        var layer = context
        layer.opacity = 1 - min(max((t - script.settle) / 0.3, 0), 1)
        layer.translateBy(x: p.x, y: p.y)
        layer.rotate(by: .radians(u < 1 ? u * 9 : 0.4))
        let rect = CGRect(x: -s, y: -s * (u < 1 ? 0.7 : 0.35), width: 2 * s, height: s * (u < 1 ? 1.4 : 0.7))
        layer.fill(Path(roundedRect: rect, cornerRadius: s * 0.2), with: .color(flag.red ? Self.challengeRed : Self.gainYellow))
        layer.stroke(Path(roundedRect: rect, cornerRadius: s * 0.2), with: .color(.black.opacity(0.3)), lineWidth: 0.5)
        let declared = max(flag.lands, script.stamp - 0.2)
        if flag.declined, t >= declared, let label = context.resolveSymbol(id: Symbol.declined) {
            var type = context
            type.opacity = min((t - declared) / 0.2, 1) * (1 - min(max((t - script.settle) / 0.3, 0), 1))
            type.draw(label, at: CGPoint(x: p.x, y: p.y - s * 1.2), anchor: .bottom)
        }
    }

    // MARK: Shadows

    private func drawShadows(_ context: inout GraphicsContext, _ f: GridProjection, _ figures: [Posed]) {
        // Under the hips (longer for a man down); smaller and fainter as he leaves the ground.
        let w = f.figure * 0.3
        for p in figures {
            let down = [.down, .knocked].contains(script.players[p.index].hold(at: t)?.kind)
            let air = min(p.figure.air / 0.4, 1)
            TheaterDraw.shadow(at: p.figure.ground, radius: (down ? w * 1.6 : w) * (1 - 0.35 * air), color: ink.shadow.opacity(p.opacity * (1 - 0.45 * air)),
                               in: context)
        }
        // The ball's: larger and softer the higher it flies, with a hairline up to it once it's well off the grass.
        if let ball = script.ball(at: t), ball.z > 0.3, script.flight(at: t) != nil {
            let g = f.point(ball.ground)
            let spread = 1 + min(ball.z / 50, 1.4)
            let r = max(0.55 * f.scale, 1.6) * spread
            context.fill(Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r / 2, width: 2 * r, height: r)),
                         with: .color(ink.shadow.opacity(min(1.6 / (1 + ball.z / 40), 1))))
            if ball.z > 6 {
                var drop = Path()
                drop.move(to: g)
                drop.addLine(to: f.point(ball))
                context.stroke(drop, with: .color(ink.trace.opacity(0.16 * min((ball.z - 6) / 10, 1))), lineWidth: 0.5)
            }
        }
    }

    // MARK: Players

    /// A player posed and placed at t; with the ball, where it is in his hands.
    private struct Posed {
        let index: Int
        let figure: RigFigure
        let opacity: Double
        var ball: CGPoint? = nil
    }

    /// Everyone on the field at t, far to near: a player in front covers the one behind.
    private func posed(_ f: GridProjection) -> [Posed] {
        script.players.indices
            .map { (index: $0, at: script.players[$0].position(at: t)) }
            .sorted { Gridiron.view($0.at, yaw: script.yaw(at: t)).y > Gridiron.view($1.at, yaw: script.yaw(at: t)).y }
            .compactMap { index, at in
                let player = script.players[index]
                let o = player.opacity(at: t)
                guard o > 0.01 else { return nil }
                let lens = RigLens(f, at: at)
                let (body, heading) = pose(player, index, at: at, unit: lens.unit)
                let figure = RigFigure(body, heading: heading, lens: lens)
                // Carried: in both hands at the chest, or the tucking hand; from where it came, into them.
                var ball: CGPoint?
                if let carry = script.carrier(at: t), carry.player == index, let spot = script.ball(at: t) {
                    let held = Rig.smooth((t - carry.from) / 0.15) * (carry.until.isFinite ? Rig.smooth((carry.until - t) / 0.15) : 1)
                    let tucked = player.role == .quarterback ? Rig.smooth((script.rig[index].motion(at: t).speed - 1.5) / 1) : 1
                    let grip = figure.grip, tuck = figure.hands.0, throwing = figure.hands.1
                    // Leaving his hands: toward where it goes next (the throw's first inch, the back's hands), not his middle.
                    let next = carry.until.isFinite && carry.until - t < 0.15 ? script.ball(at: carry.until + 1e-4) ?? spot : spot
                    let loose = f.point(next)
                    var hold = CGPoint(x: grip.x + (tuck.x - grip.x) * tucked, y: grip.y + (tuck.y - grip.y) * tucked)
                    // Cocked to throw: in the throwing hand, back by his ear.
                    let cocked = Self.cocked(player, at: t)
                    hold = CGPoint(x: hold.x + (throwing.x - hold.x) * cocked, y: hold.y + (throwing.y - hold.y) * cocked)
                    ball = CGPoint(x: loose.x + (hold.x - loose.x) * held, y: loose.y + (hold.y - loose.y) * held)
                }
                return Posed(index: index, figure: figure, opacity: o, ball: ball)
            }
    }

    /// How far the ball has gone from both hands into the throwing hand
    /// (his right) as he cocks to throw: none until the windup, all of it
    /// from then until it's away. (pure; tested)
    static func cocked(_ player: FootballScript.Player, at t: Double) -> Double {
        guard let pass = player.actions.first(where: { ($0.kind == .throwBall || $0.kind == .spike) && t > $0.at - 0.34 && t < $0.at + 0.05 })
        else { return 0 }
        return Rig.smooth((t - pass.at + 0.34) / 0.14)
    }

    /// Far to near, each with the stem of his raised name just before him.
    private func drawPlayers(_ context: inout GraphicsContext, _ f: GridProjection, _ figures: [Posed], stems: [Int: [TheaterTags.Stem]]) {
        let offense = FigureInks(teams.offense, ink: ink, in: context), defense = FigureInks(teams.defense, ink: ink, in: context)
        // An official, only when one throws a flag (or between snaps): the zebra shirt. A trainer in the staff's slate.
        let official = script.players.contains { $0.team == .official } ? FigureInks(.zebra(dark: ink.dark), ink: ink, in: context) : offense
        let staff = script.players.contains { $0.team == .staff } ? FigureInks(Self.staff, ink: ink, in: context) : offense
        for p in figures {
            let inks = switch script.players[p.index].team {
            case .offense: offense
            case .defense: defense
            case .official: official
            case .staff: staff
            }
            stems[p.index]?.forEach { $0.draw(in: context) }
            TheaterDraw.figure(p.figure, inks: inks, height: f.figure, opacity: p.opacity, in: context)
        }
    }

    /// The body at t, and its heading: a pose he holds (on a knee, down, a
    /// signal), else what he's doing with the ball (a catch, a throw, a
    /// kick, a tackle, a block) over how he's moving (striding to his
    /// planted feet), else how he stands (down in his stance before the snap
    /// and once he's set at the new line). `unit`: body units to the foot
    /// where he stands. (tested)
    func pose(_ player: FootballScript.Player, _ index: Int, at here: CGPoint, unit: Double) -> (RigPose, Double) {
        let track = index < script.rig.count ? script.rig[index] : RigTrack(at: here)
        let m = track.motion(at: t)
        func envelope(_ x: Double, attack: Double, release: Double) -> Double {
            x < 0 ? max(1 + x / attack, 0) : max(1 - x / release, 0)
        }
        func smooth(_ u: Double) -> Double { Rig.smooth(u) }

        // How he stands: in his stance (out of it as the ball's snapped, into it as he sets at the new line), else ready or upright.
        let upright: RigPose = switch player.role {
        case .line, .front, .backer, .corner, .safety, .tightEnd: .ready
        default: .stand
        }
        var set = player.set.map { 1 - smooth((t - $0) / 0.15) } ?? 0
        if let resets = player.resets { set = max(set, smooth((t - resets + 0.3) / 0.3)) }
        let still = upright.mix(player.role == .quarterback ? GridPose.center : GridPose.stance, set)
        let feet = track.feet(at: t, anchor: here, heading: m.heading, unit: unit, speed: m.speed, stand: (still.left, still.right))
        var body = still.mix(.gait(m, feet: feet), m.weight)

        if let hold = player.hold(at: t) {
            let into = smooth((t - hold.from) / 0.16)
            switch hold.kind {
            case .down: return (GridPose.dive.mix(GridPose.down, into), m.heading)
            case .kneel: return (body.mix(GridPose.kneel, into), m.heading)
            case .touchdown: return (body.over(GridPose.touchdown, into, moving: m.weight), m.heading)
            case .fairCatch: return (body.over(GridPose.fairCatch, smooth((t - hold.from) / 0.2), moving: m.weight), m.heading)
            case .knocked: return (body.mix(GridPose.knocked, smooth((t - hold.from) / 0.3)), m.heading)
            }
        }

        // With the ball: held at the chest in the pocket, tucked away on the run (the other arm still pumping).
        if let carry = script.carrier(at: t), carry.player == index {
            let held = smooth((t - carry.from) / 0.15) * (carry.until.isFinite ? smooth((carry.until - t) / 0.15) : 1)
            if player.role == .quarterback, m.speed < 2.5 {
                body = body.over(GridPose.pocket, held * (1 - smooth((m.speed - 1.5) / 1)), moving: 1)
            }
            var tucked = body
            tucked.leftArm = GridPose.tuck
            body = body.over(tucked, held * (player.role == .quarterback ? smooth((m.speed - 1.5) / 1) : 1), moving: 1)
        }

        for action in player.actions {
            let x = t - action.at
            switch action.kind {
            case .catchHigh:
                body = body.over(.catchHigh, envelope(x, attack: 0.25, release: 0.3), moving: m.weight)
            case .catchChest, .handoff:
                body = body.over(.glove, envelope(x, attack: 0.2, release: 0.25), moving: m.weight)
            case .scoop:
                body = body.over(.scoop, envelope(x, attack: 0.2, release: 0.3), moving: m.weight * 0.5)
            case .throwBall, .spike:
                guard x > -0.24, x < 0.4, let throwing = RigPose.keyed([(-0.3, .cock), (-0.04, .cock), (0.1, .release), (0.4, .release)], at: x)
                else { continue }
                body = body.over(throwing, min(envelope(x, attack: 0.2, release: 0.36) * 1.6, 1), moving: m.weight)
            case .kick:
                guard let kicking = RigPose.keyed([(-0.3, body), (-0.08, GridPose.windup), (0.1, GridPose.through), (0.25, GridPose.through),
                                                   (0.6, body)], at: x) else { continue }
                body = kicking
            case .tackle:
                body = body.mix(GridPose.dive, envelope(x, attack: 0.16, release: 0.5))
            case .strip:
                body = body.mix(GridPose.strip, envelope(x, attack: 0.18, release: 0.45))
            case .scramble:
                body = body.mix(GridPose.scramble, envelope(x, attack: 0.2, release: 0.6))
            case .leap:
                body = body.mix(GridPose.leap, envelope(x, attack: 0.22, release: 0.5))
            case .flagThrow:
                guard let throwing = RigPose.keyed([(-0.35, body), (-0.12, GridPose.flagBack), (0.04, GridPose.flagThrow), (0.18, GridPose.flagThrow),
                                                    (0.55, body)], at: x) else { continue }
                body = body.over(throwing, 1, moving: m.weight)
            case .block:
                // Held once engaged, while he's set.
                guard x > -0.2, t < script.settle else { continue }
                body = body.over(GridPose.block, smooth((x + 0.2) / 0.2), moving: m.weight * 0.7)
            }
        }
        return (body, m.heading)
    }

    // MARK: Ball

    /// A football: a brown oval along its flight in a soft glow, a comet tail
    /// while it's in the air, in his hands while he has it, its shadow on
    /// the grass (with the shadows).
    private func drawBall(_ context: inout GraphicsContext, _ f: GridProjection, held: CGPoint?) {
        guard let ball = ballSpot(f, held: held) else { return }
        let p = ball.point, r = ball.radius
        if let trail = ball.trail {
            TheaterDraw.trail(trail, from: p, radius: r * 0.8, color: ink.ball, in: context)
            TheaterDraw.glow(at: p, radius: r, color: ink.glow, in: context)
        } else if t < script.settle {
            TheaterDraw.glow(at: p, radius: r * 0.8, color: ink.glow.opacity(0.7), in: context)
        }
        var layer = context
        layer.translateBy(x: p.x, y: p.y)
        layer.rotate(by: .radians(ball.angle))
        let oval = Self.oval(r)
        layer.fill(Path(ellipseIn: oval.insetBy(dx: -0.6, dy: -0.6)), with: .color(ink.ballEdge))
        layer.fill(Path(ellipseIn: oval), with: .color(Color(hue: 0.06, saturation: 0.62, brightness: ink.dark ? 0.72 : 0.55)))
        if r > 2.6 {
            var laces = Path()
            laces.move(to: CGPoint(x: -r * 0.5, y: 0))
            laces.addLine(to: CGPoint(x: r * 0.5, y: 0))
            layer.stroke(laces, with: .color(.white.opacity(0.85)), lineWidth: max(r * 0.18, 0.6))
        }
    }

    /// Where the ball is drawn at t: in his hands or along its flight, how
    /// big (a touch larger than life, as the baseball is: it's what the eye
    /// follows), the way it points (along its flight) and its tail while it flies.
    private func ballSpot(_ f: GridProjection, held: CGPoint?) -> (point: CGPoint, radius: CGFloat, angle: Double, trail: [CGPoint]?)? {
        guard let ball = script.ball(at: t) else { return nil }
        let p = held ?? f.point(ball)
        let r = min(max(0.55 * f.scale, 2.2), max(f.figure * 0.13, 2.2))
        guard let flight = script.flight(at: t) else { return (p, r, 0, nil) }
        let trail = (1...6).map { f.point(flight.point(at: max(t - Double($0) * 0.014, flight.start))) }
        let angle = trail.first.map { hypot($0.x - p.x, $0.y - p.y) > 0.3 ? atan2(p.y - $0.y, p.x - $0.x) : 0 } ?? 0
        return (p, r, angle, trail)
    }

    /// The ball's oval round its middle, `r` its size, along its way.
    static func oval(_ r: CGFloat) -> CGRect { CGRect(x: -r * 1.45, y: -r * 0.92, width: r * 2.9, height: r * 1.84) }

    // MARK: Beats

    private func drawFlashes(_ context: inout GraphicsContext, _ f: GridProjection) {
        let unit = f.figure / 10
        for flash in script.flashes {
            let age = t - flash.at
            let c = f.point(flash.point)
            switch flash.beat {
            case .snap:
                continue
            case .kick:
                // Short rays off the foot.
                guard age >= 0, age < 0.24 else { continue }
                let u = age / 0.24
                var rays = Path()
                for i in 0..<6 {
                    let a = Double(i) / 6 * 2 * .pi + 0.3
                    let inner = (1.2 + 3 * u) * unit, outer = (2.6 + 6 * u) * unit
                    rays.move(to: CGPoint(x: c.x + cos(a) * inner, y: c.y + sin(a) * inner * 0.8))
                    rays.addLine(to: CGPoint(x: c.x + cos(a) * outer, y: c.y + sin(a) * outer * 0.8))
                }
                context.stroke(rays, with: .color(ink.trace.opacity(0.95 * (1 - u))), style: StrokeStyle(lineWidth: max(unit * 0.22, 1), lineCap: .round))
            case .catchBall:
                // The pop in his hands: a flash and a ring.
                guard age >= 0, age < 0.32 else { continue }
                let u = age / 0.32
                let r = (1.2 + 3.6 * (1 - pow(1 - u, 3))) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                               with: .color(ink.trace.opacity(0.85 * (1 - u))), lineWidth: max(unit * 0.2, 1))
                if age < 0.1 {
                    let d = (1.8 - age * 6) * unit
                    context.fill(Path(ellipseIn: CGRect(x: c.x - d, y: c.y - d, width: 2 * d, height: 2 * d)), with: .color(ink.glow.opacity(0.45)))
                }
            case .hit:
                // The stop: a ring on the grass where they met.
                guard age >= 0, age < 0.55 else { continue }
                let u = age / 0.55
                let g = f.point(CGPoint(x: flash.point.x, y: flash.point.y))
                let r = (2.5 + 8 * Motion.curve.value(at: u)) * unit
                context.stroke(Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r / 2, width: 2 * r, height: r)),
                               with: .color(ink.trace.opacity(0.8 * (1 - u))), lineWidth: 1.4)
            case .deflect:
                // Knocked away: sparks off his hands.
                guard age >= 0, age < 0.3 else { continue }
                let u = age / 0.3
                var rays = Path()
                for i in 0..<5 {
                    let a = Double(i) / 5 * 2 * .pi - 0.4
                    rays.move(to: CGPoint(x: c.x + cos(a) * (1 + 2 * u) * unit, y: c.y + sin(a) * (1 + 2 * u) * unit))
                    rays.addLine(to: CGPoint(x: c.x + cos(a) * (2.4 + 4.5 * u) * unit, y: c.y + sin(a) * (2.4 + 4.5 * u) * unit))
                }
                context.stroke(rays, with: .color(ink.trace.opacity(0.9 * (1 - u))), style: StrokeStyle(lineWidth: max(unit * 0.2, 1), lineCap: .round))
            case .flag:
                guard age >= 0, age < 0.45 else { continue }
                let u = age / 0.45
                let r = (1.5 + 5 * Motion.curve.value(at: u)) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r / 2, width: 2 * r, height: r)),
                               with: .color(Self.gainYellow.opacity(0.9 * (1 - u))), lineWidth: 1.2)
            }
        }
    }

    // MARK: Type

    private func drawLabels(_ context: inout GraphicsContext, _ f: GridProjection) {
        if let banner = script.banner, let symbol = context.resolveSymbol(id: Symbol.banner) {
            TheaterType.drawBanner(symbol, from: banner.at, until: banner.until, t: t, in: context, size: f.size)
        }
        if let symbol = context.resolveSymbol(id: Symbol.stamp) {
            TheaterType.drawStamp(symbol, from: script.stamp, t: t, in: context, size: f.size)
        }
    }

    /// The names round the players, drawn under them and the ball, clear of the headline and the stamp while they're up;
    /// the raised ones' stems, to draw with their men.
    private func drawTags(_ context: GraphicsContext, _ f: GridProjection, _ figures: [Posed], held: CGPoint?) -> [Int: [TheaterTags.Stem]] {
        var clear: [CGRect] = []
        if let banner = script.banner, t >= banner.at, t < banner.until + 0.3, let symbol = context.resolveSymbol(id: Symbol.banner) {
            clear.append(TheaterTagLayout.banner(symbol.size, in: f.size))
        }
        if t >= script.stamp, let symbol = context.resolveSymbol(id: Symbol.stamp) {
            clear.append(TheaterTagLayout.stamp(symbol.size, in: f.size, inset: TheaterType.inset(f.size)))
        }
        let ball = ballSpot(f, held: held).map { b in
            TheaterTags.Ball(shape: Path(ellipseIn: Self.oval(b.radius).insetBy(dx: -0.6, dy: -0.6))
                                .applying(CGAffineTransform(rotationAngle: b.angle).concatenating(CGAffineTransform(translationX: b.point.x, y: b.point.y))),
                             height: f.f.figure)
        }
        let well = f.size
        return tags.draw(figures.map { TheaterTags.Figure(index: $0.index, figure: $0.figure, height: f.f.figure, opacity: $0.opacity) }, ball: ball, t: t,
                  size: f.size, clear: clear, ring: ink.tagRing, replay: TheaterReplay(length: script.duration) { Self.spots(script, at: $0, size: well) },
                  in: context)
    }

    /// Each player's spot on screen at t and the ball's, through the camera, no posing.
    static func spots(_ script: FootballScript, at t: Double, size: CGSize) -> TheaterSpots {
        let f = GridProjection(size: size, camera: script.camera.frame(at: t), yaw: script.yaw(at: t))
        return TheaterSpots(figures: script.players.indices.filter { script.players[$0].opacity(at: t) > 0.01 }.map { i in
            let lens = RigLens(f, at: script.players[i].position(at: t))
            return (i, lens.origin, lens.height)
        }, ball: script.ball(at: t).map { f.point($0) })
    }

    private func color(_ side: GameDetail.Side?) -> Color {
        guard let side, let offense = scene?.offense else { return .primary }
        return side == offense ? teams.offense.accent : teams.defense.accent
    }

    /// The stamp: the number heavy in the play's color, the tag lighter
    /// beside it, the play in small capitals under it.
    @ViewBuilder
    private var stamp: some View {
        if let scene {
            let stamp = FootballStamp(scene)
            let size = TheaterType.stamp(self.size)
            let tone: Color = switch stamp.tone {
            case .gain: teams.offense.accent
            case .score: color(scene.scorer)
            case .loss: .red
            case .flag: ink.gold
            case .neutral: .primary
            }
            if !stamp.parts.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: size * 0.16) {
                        ForEach(Array(stamp.parts.enumerated()), id: \.offset) { _, part in
                            Text(part.text)
                                .font(part.heavy ? .system(size: size, weight: .heavy).monospacedDigit() : .system(size: size * 0.42, weight: .bold))
                                .tracking(part.heavy ? -0.5 : 0.6)
                                // A first down in the yellow of the line it crossed.
                                .foregroundStyle(part.text == "✗" ? Color.red : part.heavy ? tone : part.text == "1ST DOWN" ? ink.gold : Color.secondary)
                        }
                    }
                    if !stamp.title.isEmpty {
                        let title = stamp.title.uppercased()
                        Text(title)
                            .font(.system(size: min(TheaterType.title(self.size), self.size.width * 0.34 / (Double(title.count) * 0.72)), weight: .bold))
                            .tracking(1)
                            .foregroundStyle(.secondary)
                    }
                }
                .fixedSize()
            }
        }
    }

    @ViewBuilder
    private var banner: some View {
        if let banner = script.banner {
            let color: Color = switch banner.tone {
            case let .side(side): color(side)
            case .neutral: .primary
            case .gold: ink.gold
            }
            TheaterBanner(text: banner.text, color: color, size: TheaterType.banner(size, fitting: banner.text))
        }
    }
}

// MARK: - Theater

/// The football theater over the drive chart. It reads the live lane itself
/// (and nothing above it does), so a new play redraws the theater alone.
struct FootballTheater: View {
    let feed: FootballFeed?
    /// What to show without a live lane (previews and the render harness).
    var preloaded: FootballTheaterState? = nil
    /// The field between plays when no play has come yet: the spot, from the live situation.
    var rest: FootballScript.Rest? = nil
    var restOffense: GameDetail.Side? = nil
    let palette: TeamPalette
    /// The teams' own and second colors, so the players always contrast.
    var kits: TheaterKits? = nil
    var topName = ""
    var bottomName = ""
    /// The game: the viewer's turn of the field is remembered for it.
    var eventID: String? = nil
    /// The live down and distance ("2nd & 7 at MIN 38", "Kickoff") and each team's timeouts left, for the tag.
    var situation: String? = nil
    var timeouts: (top: Int?, bottom: Int?) = (nil, nil)
    /// The teams' names for the tag ("Eagles"); their abbreviations if not given.
    var topTeam = ""
    var bottomTeam = ""
    /// The box score's players, by athlete ID: the names over the credited men.
    var people: [String: TheaterPerson] = [:]

    var body: some View {
        let names = FootballStatus.Names(top: topTeam.isEmpty ? topName : topTeam, bottom: bottomTeam.isEmpty ? bottomName : bottomTeam,
                                         topColor: kits?.top.color, bottomColor: kits?.bottom.color)
        FootballStage(state: feed?.theater ?? preloaded ?? FootballTheaterState(), rest: rest, restOffense: restOffense, situation: situation,
                      timeouts: timeouts, palette: palette, kits: kits, topName: topName, bottomName: bottomName, names: names,
                      eventID: eventID ?? "football", people: people)
    }

    /// What the stage shows: a play replaying (or one of the snaps queued
    /// before it, oldest first), then its end until it has held (`rested`);
    /// a touchdown's try in a beat of its own, the same; a new play not yet
    /// begun; otherwise nil, the field between snaps (FootballIdle). History
    /// that isn't news is never shown: on opening the page, the field is the
    /// live one. `played`: the snaps already replayed. (pure; tested)
    static func shown(_ state: FootballTheaterState, replaying: String?, rested: String?, played: Set<String> = []) -> FootballScene? {
        guard let play = state.play else { return nil }
        for scene in state.queue.filter({ $0.id != play.id }) + [play] {
            if let attempt = scene.conversion, replaying == attempt.id { return rested == attempt.id ? nil : attempt }
            if replaying == scene.id { return rested == scene.id ? nil : scene }
        }
        guard state.news else { return nil }
        return state.queue.first { $0.id != play.id && !played.contains($0.id) } ?? play
    }

    /// The live situation as the field between plays: the spot and line to
    /// gain in the offense's yards (the top team attacks the right end zone).
    static func rest(_ situation: GameDetail.Football) -> (rest: FootballScript.Rest, offense: GameDetail.Side)? {
        guard let side = situation.possession else { return nil }
        func yard(_ x: Double) -> Double { side == .top ? x : 100 - x }
        return (FootballScript.Rest(yard: yard(situation.ballX), gain: situation.lineToGainX.map(yard)), side)
    }

    /// "3rd & 7 at PHI 35" → 3rd & 7; "1st & Goal" → its distance unknown (10). (pure; tested)
    static func down(_ text: String?) -> FootballScene.Down? {
        guard let text, let m = text.firstMatch(of: #/^(\d)(?:st|nd|rd|th) & (\d+|Goal)/#), let down = Int(m.1) else { return nil }
        return FootballScene.Down(down: down, distance: Int(m.2) ?? 10)
    }
}

/// The theater's stage: the field and one frame of the play through the
/// camera (a TimelineView only while it replays, or while a beat of the
/// field between snaps moves), its celebration, the tag and the heartbeat,
/// and the control that turns the field round.
private struct FootballStage: View {
    let state: FootballTheaterState
    let rest: FootballScript.Rest?
    let restOffense: GameDetail.Side?
    let situation: String?
    let timeouts: (top: Int?, bottom: Int?)
    let palette: TeamPalette
    let kits: TheaterKits?
    let topName: String
    let bottomName: String
    let names: FootballStatus.Names
    let eventID: String
    let people: [String: TheaterPerson]
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    /// The replay on screen: which play, when it began, and whether it's over.
    @State private var replay: Replay?
    /// The play's script, built once (a body run for anything else reuses it).
    @State private var built = FootballScripts()
    /// A replayed play's end that has had its time on screen.
    @State private var rested: String?
    /// The snaps replayed on this page.
    @State private var played: Set<String> = []
    /// When the field went idle, and which idle it was.
    @State private var idleClock: IdleClock?
    /// Wakes the field between snaps for its next beat.
    @State private var tick = 0
    @State private var hovering = false
    @State private var onScreen = false
    /// Who the pointer's over (the name over him), and while his tag fades in or out.
    @State private var pointer = TheaterPointer()
    @State private var fading = false
    /// The viewer's turn of the field, for this game.
    @AppStorage private var flipped: Bool

    init(state: FootballTheaterState, rest: FootballScript.Rest?, restOffense: GameDetail.Side?, situation: String?, timeouts: (top: Int?, bottom: Int?),
         palette: TeamPalette, kits: TheaterKits?, topName: String, bottomName: String, names: FootballStatus.Names, eventID: String,
         people: [String: TheaterPerson]) {
        self.state = state
        self.rest = rest
        self.restOffense = restOffense
        self.situation = situation
        self.timeouts = timeouts
        self.palette = palette
        self.kits = kits
        self.topName = topName
        self.bottomName = bottomName
        self.names = names
        self.eventID = eventID
        self.people = people
        _flipped = AppStorage(wrappedValue: false, TheaterOrientation.key(eventID))
    }

    struct Replay: Equatable {
        let id: String
        let start: Date
        var done = false
    }

    struct IdleClock: Equatable {
        let key: String
        let since: Date
    }

    private struct Wake: Equatable {
        let key: String?
        let tick: Int
        let onScreen: Bool
    }

    /// Half as tall as wide, up to this.
    static let maxHeight: CGFloat = 320

    /// The play on screen (see `FootballTheater.shown`); nil, the field between snaps.
    private var shown: FootballScene? { FootballTheater.shown(state, replaying: replay?.id, rested: rested, played: played) }

    /// The field between snaps, from what the feed says now.
    private var idle: FootballIdle {
        FootballIdle.make(play: state.play, stoppage: state.stoppage, rest: rest ?? FootballScript.Rest(yard: 25, gain: 35),
                          offense: restOffense ?? state.play?.offense ?? .top, down: FootballTheater.down(situation),
                          kickoff: situation == "Kickoff", flipped: flipped)
    }

    /// Which idle it is: a new stoppage, snap, spot or turn of the field starts it again.
    private var idleKey: String {
        "\(state.stoppage?.id ?? "-")|\(state.play?.id ?? "-")|\(rest.map { "\($0.yard)" } ?? "-")|\(restOffense == .bottom)|\(flipped)|\(situation ?? "")"
    }

    private func teams(_ offense: GameDetail.Side) -> FootballTeams {
        let dressed: (top: Uniform, bottom: Uniform)
        if let kits {
            let d = TheaterTeams.dress(kits, scheme: scheme)
            dressed = (d.top, d.bottom)
        } else {
            dressed = (Uniform(TheaterTeams.solid(palette.top, scheme)), Uniform(TheaterTeams.solid(palette.bottom, scheme)))
        }
        return offense == .top ? FootballTeams(offense: dressed.top, defense: dressed.bottom)
            : FootballTeams(offense: dressed.bottom, defense: dressed.top)
    }

    /// The end zones: the offense's own nearest the camera, the one it attacks at the far end.
    private func zones(_ offense: GameDetail.Side) -> GridironLayer.Zones {
        let top = GridironLayer.EndZone(color: TheaterTeams.solid(palette.top, scheme), name: topName.uppercased())
        let bottom = GridironLayer.EndZone(color: TheaterTeams.solid(palette.bottom, scheme), name: bottomName.uppercased())
        return offense == .top ? GridironLayer.Zones(near: top, far: bottom) : GridironLayer.Zones(near: bottom, far: top)
    }

    /// Seconds into the play on screen; infinity once it has ended (or was never replayed).
    private func time(at date: Date) -> Double {
        if case let .frozen(t) = clock { return t }
        guard let play = shown else { return .infinity }
        if let replay, replay.id == play.id { return replay.done ? .infinity : date.timeIntervalSince(replay.start) }
        // News not yet begun: its first frame (onChange begins it).
        return state.news && !reduceMotion ? 0 : .infinity
    }

    private var playing: Bool {
        guard clock == .live, let play = shown else { return false }
        if let replay, replay.id == play.id { return !replay.done }
        return state.news && !reduceMotion
    }

    /// Seconds into the field between snaps (its script's time): from when it
    /// went idle, round the loop; with Reduce Motion, one still moment that
    /// says what's happening.
    private func idleTime(_ script: FootballScript, _ idle: FootballIdle, at date: Date) -> Double {
        if case let .frozen(t) = clock { return script.idleTime(t) }
        if reduceMotion { return Self.still(idle, script) }
        guard let idleClock, idleClock.key == idleKey else { return 0 }
        return script.idleTime(date.timeIntervalSince(idleClock.since))
    }

    /// The moment Reduce Motion shows: lined up for the snap; through a stoppage, its own (the benches, the man down, the monitor).
    static func still(_ idle: FootballIdle, _ script: FootballScript) -> Double {
        switch idle.phase {
        case .between, .kickoff: script.loop?.start ?? script.duration
        case .quarter: 5.5
        case .off: script.duration
        default: 12
        }
    }

    var body: some View {
        let play = shown
        let idle = self.idle
        let script = play.map { built.script(for: $0, yaw: FieldFacing.yaw($0.offense, period: $0.period, flipped: flipped)) } ?? built.idle(idle)
        let ink = TheaterInk(scheme)
        let offense = play?.offense ?? idle.offense
        let teams = teams(offense), zones = zones(offense)
        let idleNow = play == nil ? idleTime(script, idle, at: .now) : 0
        let cast = script.cast(play, offense: offense, people: people, scope: play?.id ?? "idle|" + idleKey)
        let labels = TheaterLabels.make(kits: kits, scheme: scheme, teams: (names.top, names.bottom))
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Group {
                    if let play {
                        if playing || fading {
                            TimelineView(.animation) { context in
                                layer(play, script, at: context.date, cast, labels, teams, ink, geo.size, zones)
                            }
                            .transition(.identity)
                        } else {
                            layer(play, script, at: .now, cast, labels, teams, ink, geo.size, zones)
                                .transition(.identity)
                        }
                    } else if (clock == .live && !reduceMotion && onScreen && script.moving(at: idleNow)) || fading {
                        // A beat: animated until it's over, then still again.
                        TimelineView(.animation) { context in
                            idleLayer(idle, script, idleTime(script, idle, at: context.date), at: context.date, cast, labels, teams, ink, geo.size, zones)
                        }
                        .transition(.identity)
                    } else {
                        idleLayer(idle, script, idleNow, at: .now, cast, labels, teams, ink, geo.size, zones)
                            .transition(.identity)
                    }
                }
                .id(play?.id ?? "idle|" + idleKey)
                // A replay cuts in; a play that isn't replayed crossfades to how it ended, as does a new stoppage.
                .transition(playing ? .identity : .opacity.animation(.easeInOut(duration: 0.35)))
                if let play {
                    FootballCelebrationStage(play: play, script: script, size: geo.size, colors: (teams.offense.accent, teams.defense.accent),
                                             start: replay?.id == play.id ? replay?.start : nil)
                        .id(play.id)
                }
            }
            .accessibilityHidden(true)
            .overlay(alignment: .bottomTrailing) {
                TheaterHeartbeat(updated: state.heard, source: "ESPN").padding(6)
            }
            .overlay(alignment: .topTrailing) {
                TheaterFlipButton(eventID: eventID, surface: "field")
                    .padding(6)
                    .opacity(hovering ? 1 : 0)
                    .animation(Motion.fade, value: hovering)
            }
            .theaterPointer($pointer, cast: cast) { point in
                figure(at: point, script, t: play == nil ? idleTime(script, idle, at: .now) : time(at: .now), size: geo.size)
            }
        }
        // The well spans the column, so its edges line up with the drive chart under it.
        .modifier(WellHeight(cap: Self.maxHeight))
        .vizWell(padding: 0)
        .onHover { hovering = $0 }
        .theaterFading(pointer, $fading)
        .onAppear {
            onScreen = true
            begin()
            startIdle()
        }
        .onDisappear { onScreen = false }
        .onChange(of: state.play?.id) { _, _ in begin() }
        .onChange(of: state.queue.map(\.id)) { _, _ in begin() }
        // A touchdown's try follows it once the touchdown's replay is done and the try is in.
        .onChange(of: replay) { _, _ in follow() }
        .onChange(of: state.play?.conversion?.id) { _, _ in follow() }
        .onChange(of: play?.id) { _, now in if now == nil { startIdle() } }
        .onChange(of: idleKey) { _, _ in if shown == nil { startIdle() } }
        .task(id: replay) {
            guard let replay else { return }
            if !replay.done {
                try? await Task.sleep(for: .seconds(max(script.duration - Date.now.timeIntervalSince(replay.start), 0) + 0.05))
                guard !Task.isCancelled, self.replay?.id == replay.id else { return }
                self.replay?.done = true
                return
            }
            // Done: the next snap waiting replays at once; else its end holds a while, then the field returns to the game.
            if let next = nextQueued(after: replay.id) {
                try? await Task.sleep(for: .seconds(0.7))
                guard !Task.isCancelled, self.replay?.id == replay.id else { return }
                start(next)
                return
            }
            try? await Task.sleep(for: TheaterKit.hold)
            guard !Task.isCancelled, self.replay?.id == replay.id else { return }
            rested = replay.id
        }
        // Between snaps: wake for the next beat (or the tag's next change), sleep through the still.
        .task(id: Wake(key: play == nil ? idleKey : nil, tick: tick, onScreen: onScreen)) {
            guard play == nil, clock == .live, !reduceMotion, onScreen else { return }
            let t = idleTime(script, idle, at: .now)
            let wake: Double?
            if let beat = script.beats.first(where: { t >= $0.lowerBound && t < $0.upperBound }) {
                wake = beat.upperBound
            } else {
                let tags = FootballStatus.changes(idle, script: script).filter { $0 > t }
                wake = ([script.nextBeat(after: t)] + tags.map(Optional.some)).compactMap { $0 }.min()
            }
            guard let wake else { return }
            try? await Task.sleep(for: .seconds(max(wake - t, 0.05) + 0.02))
            guard !Task.isCancelled else { return }
            tick &+= 1
        }
    }

    /// A replay's frame, its tag and the names over its players.
    private func layer(_ play: FootballScene, _ script: FootballScript, at date: Date, _ cast: TheaterCast, _ labels: TheaterLabels,
                       _ teams: FootballTeams, _ ink: TheaterInk, _ size: CGSize, _ zones: GridironLayer.Zones) -> some View {
        let t = time(at: date)
        let banner = script.banner.map { t >= $0.at - 0.3 && t < $0.until + 0.3 } ?? false
        let status = banner ? TheaterStatus(updated: state.heard) : FootballStatus.replay(play, script: script, t: t, names: names)
        let tags = TheaterTags(cast: cast, labels: labels, pointer: pointer, at: date, reduceMotion: reduceMotion, status: status.tag, flip: hovering)
        return ZStack(alignment: .topLeading) {
            FootballFrame(scene: play, script: script, t: t, teams: teams, ink: ink, size: size, zones: zones, tags: tags)
                .equatable()
            TheaterStatusTag(status: status, height: size.height).padding(.top, 8)
        }
    }

    /// The field between snaps at t, its tag and the names over its players.
    private func idleLayer(_ idle: FootballIdle, _ script: FootballScript, _ t: Double, at date: Date, _ cast: TheaterCast, _ labels: TheaterLabels,
                           _ teams: FootballTeams, _ ink: TheaterInk, _ size: CGSize, _ zones: GridironLayer.Zones) -> some View {
        let status = FootballStatus.idle(idle, stoppage: state.stoppage, script: script, t: t, names: names, situation: situation,
                                         timeoutsLeft: timeouts)
        let tags = TheaterTags(cast: cast, labels: labels, pointer: pointer, at: date, reduceMotion: reduceMotion, status: status.tag, flip: hovering)
        return ZStack(alignment: .topLeading) {
            FootballFrame(scene: nil, script: script, t: t, teams: teams, ink: ink, size: size, zones: zones, tags: tags)
                .equatable()
            TheaterStatusTag(status: status, height: size.height).padding(.top, 8)
        }
    }

    /// The figure under the pointer in the frame on screen: each player's
    /// spot at t through the camera, no posing.
    private func figure(at point: CGPoint, _ script: FootballScript, t: Double, size: CGSize) -> Int? {
        TheaterTags.hit(FootballFrame.spots(script, at: t, size: size).figures, at: point)
    }

    /// The field goes idle (again): its beats count from now.
    private func startIdle() {
        guard shown == nil, idleClock?.key != idleKey || idleClock == nil else { return }
        idleClock = IdleClock(key: idleKey, since: .now)
    }

    /// A new snap replays from its snap, after any queued before it that
    /// haven't (one already replaying carries on to them); with Reduce
    /// Motion each is over at once (its end crossfades in, and holds).
    /// History doesn't.
    private func begin() {
        guard clock == .live, state.news, let play = state.play else { return }
        if reduceMotion {
            guard replay?.id != play.id else { return }
            played.formUnion(state.queue.map(\.id) + [play.id])
            replay = Replay(id: play.id, start: .now, done: true)
            return
        }
        if let replay, !replay.done { return }
        if let replay, replay.done, nextQueued(after: replay.id) != nil { return }
        let waiting = state.queue.first { !played.contains($0.id) } ?? (played.contains(play.id) ? nil : play)
        if let waiting { start(waiting) }
    }

    private func start(_ scene: FootballScene) {
        played.insert(scene.id)
        rested = nil
        replay = Replay(id: scene.id, start: .now)
    }

    /// The next queued snap after this one (or after the try of it) that hasn't replayed.
    private func nextQueued(after id: String) -> FootballScene? {
        let base = id.hasSuffix("-try") ? String(id.dropLast(4)) : id
        guard let i = state.queue.firstIndex(where: { $0.id == base }) else { return nil }
        if !id.hasSuffix("-try"), let attempt = state.queue[i].conversion, !played.contains(attempt.id) { return nil }
        return state.queue[(i + 1)...].first { !played.contains($0.id) }
    }

    /// A touchdown replayed here is followed by its try, as a short beat of
    /// its own: a cut to the try's formation, a breath, the snap.
    private func follow() {
        guard clock == .live, !reduceMotion, let replay, replay.done,
              let scene = (state.queue + [state.play].compactMap { $0 }).first(where: { $0.id == replay.id }),
              let attempt = scene.conversion, !played.contains(attempt.id) else { return }
        played.insert(attempt.id)
        self.replay = Replay(id: attempt.id, start: .now + 0.3)
    }
}

/// The last play's script, and the field's between snaps. A reference, so
/// keeping them isn't a change anything observes: building one (its camera
/// track, its motion) takes a millisecond or a few, and a body run that
/// isn't about a new play shouldn't.
private final class FootballScripts {
    private var scene: FootballScene?
    private var yaw = Gridiron.yaw
    private var script: FootballScript?
    private var idle: FootballIdle?
    private var idleScript: FootballScript?

    func script(for scene: FootballScene, yaw: Double) -> FootballScript {
        if scene != self.scene || yaw != self.yaw || script == nil {
            self.scene = scene
            self.yaw = yaw
            script = FootballScript(scene, yaw: yaw)
        }
        return script!
    }

    func idle(_ idle: FootballIdle) -> FootballScript {
        if idle != self.idle || idleScript == nil {
            self.idle = idle
            idleScript = FootballScript(idle: idle)
        }
        return idleScript!
    }
}

private struct WellHeight: ViewModifier {
    let cap: CGFloat

    func body(content: Content) -> some View {
        TheaterWell(cap: cap) { content }
    }
}

// MARK: - Names

extension FootballScript {
    /// Who each figure is, for the names over the field: the men ESPN
    /// credits on the play (`credits`), each on the very figure the replay
    /// puts him on (his depth-chart slot, college's by his role), named from
    /// the box score (else the text's "B.Murphy") with its number; everyone
    /// else only what the theater knows of him, his team and the place he
    /// lines up in (`SEAHAWKS · DE`), never the depth chart's probable name.
    /// Officials and trainers: nobody. The key man is the one with the ball:
    /// the first credited man to have it from the start (a pass's
    /// quarterback, a run's back), then from each carry on whoever has it
    /// last (the receiver from the catch, the man who picked it off); the
    /// kicker on a kickoff until it's caught; the kicker of a field goal or a
    /// try throughout. Between snaps, nobody. (pure; tested)
    func cast(_ scene: FootballScene?, offense: GameDetail.Side, people: [String: TheaterPerson], scope: String) -> TheaterCast {
        var members: [Int: TheaterCast.Member] = [:]
        for (i, player) in players.enumerated() {
            let side: GameDetail.Side
            switch player.team {
            case .offense: side = offense
            case .defense: side = FootballScene.opponent(offense)
            case .official, .staff: continue
            }
            let place = Self.tagPosition(player, credit: credits[i]?.position, kick: scene?.kind)
            var who = TheaterWho.assumed(place)
            if let credit = credits[i] {
                let name = credit.name ?? Self.textName(credit, in: scene)
                var person = credit.id.flatMap { people[$0] } ?? name.map { TheaterPerson(name: $0, last: $0) }
                person?.position = place.isEmpty ? nil : place
                if person?.number == nil { person?.number = credit.jersey ?? name.flatMap { n in scene.flatMap { Self.number(of: n, in: $0.text) } } }
                if let person { who = .known(person) }
            }
            members[i] = TheaterCast.member(who, side: side, athlete: credits[i]?.id ?? credits[i]?.name, figure: i, scope: scope)
        }
        var keys: [TheaterCast.Key] = []
        func kicker() -> Int? { credits.first { $0.value.role == "kicker" }?.key }
        switch scene?.kind {
        case .fieldGoal?, .extraPoint?:
            return TheaterCast(members: members, key: kicker(), scope: scope)
        case .kickoff?:
            if let k = kicker() { keys.append(TheaterCast.Key(from: -.infinity, figure: k)) }
        default:
            break
        }
        for leg in legs {
            guard case let .carry(p) = leg.hand, credits[p] != nil, members[p] != nil, keys.last?.figure != p else { continue }
            keys.append(TheaterCast.Key(from: keys.isEmpty ? -.infinity : leg.from, figure: p))
        }
        return TheaterCast(members: members, keys: keys, scope: scope)
    }

    /// A credited man's name where only the text gives it (college's
    /// credits, a man the box score hasn't listed): the passer or the runner
    /// the text leads with, the man it went to, the first man in on the stop,
    /// the man who picked it off or fell on it, the returner.
    static func textName(_ credit: FootballScene.Participant, in scene: FootballScene?) -> String? {
        guard let scene else { return nil }
        let names = scene.names
        switch credit.role {
        case "passer", "rusher", "kicker", "punter", "fumbler": return names["lead"]
        case "receiver": return names["target"]
        case "tackler": return names["stop"]
        case "assistedBy": return scene.participants.first { $0.role == "tackler" || $0.role == "assistedBy" } == credit ? names["stop"] : nil
        case "interceptor", "recoverer": return names["taker"]
        case "returner": return names["returner"] ?? names["taker"]
        default: return nil
        }
    }

    /// His number where the text gives it (college's "#12 K.Russell").
    static func number(of surname: String, in text: String) -> String? {
        text.matches(of: #/[#](\d+) ([A-Z][A-Za-z'\-]*\.\s?[A-Z][A-Za-z'\-]+(?: (?:Jr\.|Sr\.|III|II|IV))?)/#)
            .first { FootballScene.shortName($0.2) == surname }.map { String($0.1) }
    }

    /// The place a man lines up in, as a tag says it: his depth-chart slot
    /// ("lde": DE, "rcb": CB), else his role's (OL, DL); a kick's men by
    /// their part (K, P, H, KR, PR); a man on the coverage only his team's.
    static func tagPosition(_ player: Player, credit: FootballScene.Position?, kick: FootballScene.Kind?) -> String {
        if let key = player.key, let slot = slots[key] { return slot }
        switch player.role {
        case .line: return "OL"
        case .quarterback: return "QB"
        case .back: return credit == .fullback ? "FB" : "RB"
        case .receiver: return "WR"
        case .tightEnd: return "TE"
        case .front: return "DL"
        case .backer: return "LB"
        case .corner: return credit == .safety ? "S" : "CB"
        case .safety: return "S"
        case .kicker: return "K"
        case .holder: return "H"
        case .punter: return "P"
        case .returner: return kick == .punt ? "PR" : "KR"
        case .cover, .official: return ""
        }
    }

    /// ESPN's depth-chart slots, as a tag names them.
    static let slots: [String: String] = [
        "lt": "LT", "lg": "LG", "c": "C", "rg": "RG", "rt": "RT", "te": "TE", "wr": "WR", "qb": "QB", "rb": "RB", "fb": "FB",
        "lde": "DE", "rde": "DE", "ldt": "DT", "rdt": "DT", "nt": "NT", "lolb": "OLB", "rolb": "OLB", "mlb": "MLB", "lilb": "ILB",
        "rilb": "ILB", "wlb": "LB", "slb": "LB", "lcb": "CB", "rcb": "CB", "nb": "NB", "ss": "SS", "fs": "FS", "pk": "K", "p": "P",
    ]
}

// MARK: - Celebration

/// One celebration per moment, and the theater owns its plays' when the page
/// shows it (the drive chart keeps its marks and bursts nothing): a
/// touchdown's fireworks over the goal line it crossed with confetti off the
/// banner, a pick six's at the maximum, a field goal's small pop at the
/// crossbar, a big play's sparks where he was stopped. Turnovers, a safety
/// and fourth down get their banner alone. Every burst goes through the
/// page's rules (`Celebration.cue`): the celebration level, Reduce Motion,
/// and one particle burst every 10 s. (pure; tested)
enum FootballCelebration {
    /// The drive chart bursts only when there's no theater to.
    static func driveChartBursts(theaterShown: Bool) -> Bool { !theaterShown }

    /// A burst on the theater's stage.
    struct Burst: Equatable {
        enum Anchor: Equatable {
            /// A point on the field: it moves with the camera.
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
        /// Whose colors it wears.
        var side: GameDetail.Side?

        var end: Double { at + cue.duration }
    }

    /// The theater's bursts for this play's moment, in script time. Nothing
    /// for another play's moment, or when the level is Off.
    static func theater(_ moment: LiveMoment?, play: FootballScene, script: FootballScript, level: CelebrationLevel,
                        reduceMotion: Bool, height: CGFloat) -> [Burst] {
        guard let moment, moment.id == play.id, moment.chart == .field else { return [] }
        let gold = moment.decisive
        func cue(_ effects: [CelebrationCue.Effect]?) -> CelebrationCue? {
            var cue = Celebration.cue(for: moment, level: level, reduceMotion: reduceMotion, geometry: .init(height: height),
                                      direction: .degrees(90), effects: effects)
            if gold { cue?.gold = true }
            return cue
        }
        let scale = TheaterBurst.scale(height)
        var bursts: [Burst] = []
        switch moment.kind {
        case .touchdown:
            guard let at = script.score, let point = script.scorePoint else { return [] }
            // The shells burst over the goal line as the ball crosses: two, three for a pick six or a game-winner.
            let shells = play.pickSix || moment.decisive ? 3 : 2
            if let fireworks = cue([.fireworks(shells: shells)]) {
                bursts.append(Burst(cue: fireworks, at: at - fireworks.delay, anchor: .field(FieldPoint(x: point.x, y: point.y, z: 24)),
                                    scale: scale, side: play.scorer))
            }
            // The banner's confetti: only ever confetti (Subtle, the cooldown and Reduce Motion leave the banner alone).
            if let banner = script.banner, banner.confetti,
               let confetti = cue([.confetti(direction: .degrees(90), spread: .degrees(play.pickSix ? 170 : 150), preset: .medium)]),
               confetti.effects.contains(where: { if case .confetti = $0 { return true }; return false }) {
                bursts.append(Burst(cue: confetti, at: at + 0.12 - confetti.delay, anchor: .banner,
                                    scale: scale * (play.pickSix ? 0.85 : 0.7), side: play.scorer))
            }
        case .fieldGoal:
            // A small pop at the crossbar as the ball goes over it.
            guard let at = script.score, let point = script.scorePoint, let pop = cue(nil) else { return [] }
            bursts.append(Burst(cue: pop, at: at - pop.delay, anchor: .field(point), scale: scale * 0.8, side: play.scorer))
        case .passComplete, .rush:
            guard moment.accents.contains(.bigPlay), let end = script.end, let sparks = cue(nil) else { return [] }
            bursts.append(Burst(cue: sparks, at: script.stamp - 0.1 - sparks.delay, anchor: .field(FieldPoint(x: end.x, y: end.y, z: 4)),
                                scale: scale * 0.7, side: play.offense))
        default:
            // Turnovers, a safety, a miss, fourth down: the banner alone.
            break
        }
        return bursts
    }
}

/// The theater's bursts, drawn through the camera so a firework stays over
/// the goal line as the camera moves. A TimelineView only while one plays; on
/// the harness's frozen clock, the frame at t. With Reduce Motion there's no
/// replay: a touchdown blooms in the end zone, as the play's end state shows.
private struct FootballCelebrationStage: View {
    let play: FootballScene
    let script: FootballScript
    let size: CGSize
    /// The offense's and the defense's colors.
    let colors: (offense: Color, defense: Color)
    /// When the replay began.
    let start: Date?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var live: Date?
    @State private var over: Date?

    var body: some View {
        let moment = momentFor(.field, in: moments)
        let bursts = FootballCelebration.theater(moment, play: play, script: script, level: level, reduceMotion: reduceMotion,
                                                 height: size.height)
        Group {
            switch clock {
            case let .frozen(t):
                if bursts.contains(where: { t >= $0.at && t <= $0.end }) { surface(bursts, at: t) }
            case .live:
                if reduceMotion {
                    // The end state: a bloom where the score happened.
                    if moment?.id == play.id, moment?.kind == .touchdown, let point = script.scorePoint ?? script.end {
                        CelebrationStage(moment: moment, origin: GridProjection(size: size, camera: script.camera.rest, yaw: script.yaw).point(point),
                                         size: size, colors: .team(color(play.scorer)), wellInset: 0)
                    }
                } else if let start, live == start, over != start {
                    TimelineView(.animation) { context in surface(bursts, at: context.date.timeIntervalSince(start)) }
                }
            }
        }
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

    private func color(_ side: GameDetail.Side?) -> Color {
        side == nil || side == play.offense ? colors.offense : colors.defense
    }

    private func surface(_ bursts: [FootballCelebration.Burst], at t: Double) -> some View {
        Canvas { context, size in
            let f = GridProjection(size: size, camera: script.camera.frame(at: t), yaw: script.yaw(at: t))
            context.clip(to: f.bounds)
            for burst in bursts where t >= burst.at && t <= burst.end {
                let origin = switch burst.anchor {
                case let .field(p): TheaterBurst.inside(f.point(p), size)
                case .banner: TheaterType.bannerOrigin(size)
                }
                var layer = context
                layer.translateBy(x: origin.x, y: origin.y)
                Celebration.draw(TheaterBurst.spread(Celebration.particles(burst.cue, origin: .zero, t: t - burst.at), by: burst.scale), in: layer,
                                 palette: CelebrationColors.team(color(burst.side)).palette)
            }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }
}
