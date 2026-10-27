import SwiftUI

// The football theater: in the Field section, above the drive chart, the
// last snap replayed on an isometric field as it arrives from the live
// lane, shot like a broadcast. The camera opens behind the offense on the
// formation, with the line of scrimmage in blue and the line to gain in
// yellow; it follows the ball in the air and the man carrying it, then
// frames the end spot and the new line to gain as the stamp lands ("+12",
// "1ST DOWN", "−7 SACK", "INC", "FG 47 ✓"). Marquee plays get a headline
// across the top (TOUCHDOWN, FIELD GOAL, INTERCEPTION), and a touchdown's
// fireworks burst over the goal line it crossed. The drive chart under it,
// and its play-by-play, is its caption.
//
// Built from the baseball theater's parts: its projection, camera framing,
// pictogram figures, ball and type (TheaterKit.swift). Drawn in two
// Canvases, the field and the players, both through the camera, so lines
// stay crisp at any zoom. A TimelineView exists only while a replay runs;
// between plays the field is static. Plays already on the page when it
// opened show as they ended; a new one mid-replay cuts to itself; with
// Reduce Motion each play crossfades to how it ended and the camera never
// moves. Decorative for VoiceOver: the drive chart carries the play.

// MARK: - Field

/// The field: the turf mowed in five-yard bands, the end zones in the colors
/// of the teams defending them with their names, the yard lines, hash marks
/// and numbers, the sidelines, and the goalposts. Equatable: redrawn for a
/// new size, appearance or camera, never for a player.
struct GridironLayer: View, Equatable {
    struct EndZone: Equatable {
        var color: Color
        var name: String
    }

    let ink: TheaterInk
    var camera: CameraFrame
    /// The end zone the offense defends (nearest the camera) and the one it attacks.
    let near: EndZone
    let far: EndZone
    var yaw = Gridiron.yaw

    private enum Symbol: Hashable { case number(Int), near, far }

    var body: some View {
        Canvas { context, size in
            let f = GridProjection(size: size, camera: camera, yaw: yaw)
            context.clip(to: f.bounds)
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
            context.fill(quad(-h - 110, -Gridiron.endZone - 110, h + 110, Gridiron.backLine + 130), with: .color(ink.grass))
            // Mowed in five-yard bands, every other one lighter.
            var bands = Path()
            for k in stride(from: 0, to: 20, by: 2) where shown(Double(k) * 15) || shown(Double(k + 1) * 15) {
                bands.addPath(quad(-h, Double(k) * 15, h, Double(k + 1) * 15))
            }
            context.fill(bands, with: .color(ink.mow))
            // The end zones, in their teams' colors, with their names.
            context.fill(quad(-h, -Gridiron.endZone, h, 0), with: .color(near.color.opacity(ink.dark ? 0.34 : 0.28)))
            context.fill(quad(-h, 300, h, Gridiron.backLine), with: .color(far.color.opacity(ink.dark ? 0.34 : 0.28)))
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
            context.stroke(lines, with: .color(ink.chalk.opacity(0.75)), lineWidth: line)
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
            context.stroke(quad(-h, -Gridiron.endZone, h, Gridiron.backLine), with: .color(ink.chalk), lineWidth: line * 1.8)

            // The goalposts on the end lines: the post, the crossbar, the uprights.
            for y in [-Gridiron.endZone, Gridiron.backLine] where shown(y) {
                var post = Path()
                post.move(to: f.point(CGPoint(x: 0, y: y), z: 0))
                post.addLine(to: f.point(CGPoint(x: 0, y: y), z: Gridiron.crossbar))
                post.move(to: f.point(CGPoint(x: -Gridiron.upright, y: y), z: Gridiron.uprightTop))
                post.addLine(to: f.point(CGPoint(x: -Gridiron.upright, y: y), z: Gridiron.crossbar))
                post.addLine(to: f.point(CGPoint(x: Gridiron.upright, y: y), z: Gridiron.crossbar))
                post.addLine(to: f.point(CGPoint(x: Gridiron.upright, y: y), z: Gridiron.uprightTop))
                context.stroke(post, with: .color(Celebrate.gold.opacity(0.85)),
                               style: StrokeStyle(lineWidth: line + 0.35, lineCap: .round, lineJoin: .round))
            }
        } symbols: {
            ForEach([10, 20, 30, 40, 50], id: \.self) { n in
                Text("\(n)").font(.system(size: 40, weight: .bold).monospacedDigit()).foregroundStyle(ink.chalk).tag(Symbol.number(n))
            }
            Text(near.name).font(.system(size: 60, weight: .black).width(.expanded)).foregroundStyle(ink.chalk).tag(Symbol.near)
            Text(far.name).font(.system(size: 60, weight: .black).width(.expanded)).foregroundStyle(ink.chalk).tag(Symbol.far)
        }
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

/// Football's poses beyond baseball's: front on (or from behind) for the
/// stances and the signals, in profile for the kick and the dive.
enum GridPose {
    /// Down in a stance: knees bent wide, hands low.
    static let stance = Pose(lean: 0, nearThigh: 1.05, nearShin: -0.3, farThigh: -1.05, farShin: 0.3,
                             nearUpper: 0.3, nearFore: 0.12, farUpper: -0.3, farFore: -0.12)
    /// The quarterback under center.
    static let center = Pose(lean: 0, nearThigh: 0.7, nearShin: -0.15, farThigh: -0.7, farShin: 0.15,
                             nearUpper: 0.6, nearFore: 0.2, farUpper: -0.6, farFore: -0.2)
    /// Engaged: arms up and out in front.
    static let block = Pose(lean: 0, nearThigh: 0.6, nearShin: -0.15, farThigh: -0.6, farShin: 0.15,
                            nearUpper: 1.15, nearFore: 1.85, farUpper: -1.15, farFore: -1.85)
    static let kneel = Pose(lean: 0, nearThigh: 1.45, nearShin: 0.05, farThigh: 0.25, farShin: -1.4,
                            nearUpper: 0.3, nearFore: 0.8, farUpper: -0.1, farFore: 0.5)
    /// Brought down: flat on the grass.
    static let down = Pose(lean: 1.45, nearThigh: -1.35, nearShin: -1.45, farThigh: -1.5, farShin: -1.6,
                           nearUpper: 2.0, nearFore: 2.2, farUpper: 1.6, farFore: 1.9)
    /// The touchdown signal: both arms straight up.
    static let touchdown = Pose(lean: 0, nearThigh: 0.12, nearShin: 0.05, farThigh: -0.12, farShin: -0.05,
                                nearUpper: 2.9, nearFore: 3.08, farUpper: -2.9, farFore: -3.08)
    /// A hand up for the fair catch.
    static let fairCatch = Pose(lean: 0, nearThigh: 0.1, nearShin: 0.05, farThigh: -0.1, farShin: -0.05,
                                nearUpper: 2.95, nearFore: 3.1, farUpper: -0.25, farFore: -0.1)
    static let dive = Pose(lean: 1.15, nearThigh: 0.1, nearShin: -0.7, farThigh: -0.7, farShin: -1.5,
                           nearUpper: 1.75, nearFore: 1.65, farUpper: 1.55, farFore: 1.45)
    /// The kick: the leg cocked back, then through and high.
    static let windup = Pose(lean: -0.1, nearThigh: -0.9, nearShin: -1.6, farThigh: 0.05, farShin: 0,
                             nearUpper: -0.6, nearFore: -0.3, farUpper: 0.9, farFore: 0.7)
    static let through = Pose(lean: -0.25, nearThigh: 1.7, nearShin: 1.9, farThigh: -0.05, farShin: -0.05,
                              nearUpper: -0.9, nearFore: -0.7, farUpper: 1.4, farFore: 1.5)
}

/// One frame of a play through the camera: the lines on the field, the flag,
/// the shadows, the players far to near, the ball, the beats, the headline
/// and the stamp. Equatable: at rest (t = ∞) an update elsewhere on the page
/// doesn't redraw it.
struct FootballFrame: View, Equatable {
    let scene: FootballScene?
    let script: FootballScript
    let t: Double
    let teams: FootballTeams
    let ink: TheaterInk
    /// Where it's drawn: the type is sized from it.
    let size: CGSize

    /// The time first: mid-replay it's all that differs.
    static func == (a: FootballFrame, b: FootballFrame) -> Bool {
        a.t == b.t && a.size == b.size && a.teams == b.teams && a.ink == b.ink && a.scene == b.scene && a.script == b.script
    }

    /// The type, laid out once as views and drawn into each frame.
    private enum Symbol: Hashable { case stamp, banner }

    /// The broadcast's lines: the line of scrimmage blue, the line to gain yellow.
    static let scrimmageBlue = Color(red: 0.25, green: 0.52, blue: 1)
    static let gainYellow = Color(red: 1, green: 0.84, blue: 0.1)

    var body: some View {
        Canvas { context, size in
            let f = GridProjection(size: size, camera: script.camera.frame(at: t), yaw: script.yaw)
            context.clip(to: f.bounds)
            drawLines(&context, f)
            drawFlag(&context, f)
            drawShadows(&context, f)
            drawPlayers(&context, f)
            drawBall(&context, f)
            drawFlashes(&context, f)
            drawLabels(&context, f)
        } symbols: {
            stamp.tag(Symbol.stamp)
            banner.tag(Symbol.banner)
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

    /// The flag: tossed in end over end, then lying where it landed until the field settles.
    private func drawFlag(_ context: inout GraphicsContext, _ f: GridProjection) {
        guard let flag = script.flag, t >= flag.thrown, t < script.settle + 0.3 else { return }
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
        layer.fill(Path(roundedRect: rect, cornerRadius: s * 0.2), with: .color(Self.gainYellow))
        layer.stroke(Path(roundedRect: rect, cornerRadius: s * 0.2), with: .color(.black.opacity(0.3)), lineWidth: 0.5)
    }

    // MARK: Shadows

    private func drawShadows(_ context: inout GraphicsContext, _ f: GridProjection) {
        let w = f.figure * 0.3
        for player in script.players {
            let o = player.opacity(at: t)
            guard o > 0.01 else { continue }
            let down = player.hold(at: t)?.kind == .down
            TheaterDraw.shadow(at: f.point(player.position(at: t)), radius: down ? w * 1.6 : w, color: ink.shadow.opacity(o), in: context)
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

    private func drawPlayers(_ context: inout GraphicsContext, _ f: GridProjection) {
        let height = f.figure
        let offense = FigureInks(teams.offense, ink: ink, in: context), defense = FigureInks(teams.defense, ink: ink, in: context)
        // Far to near: a player in front covers the one behind.
        let order = script.players.indices
            .map { (index: $0, at: script.players[$0].position(at: t)) }
            .sorted { Gridiron.view($0.at, yaw: script.yaw).y > Gridiron.view($1.at, yaw: script.yaw).y }
        for (index, at) in order {
            let player = script.players[index]
            let o = player.opacity(at: t)
            guard o > 0.01 else { continue }
            let figure = Figure(pose(player, index), at: f.point(at), height: height)
            TheaterDraw.figure(figure, inks: player.team == .offense ? offense : defense, height: height, opacity: o, in: context)
        }
    }

    /// The pose at t: a pose he holds (on a knee, down, a signal), else what
    /// he's doing with the ball (a catch, a throw, a kick, a tackle), over how
    /// he's moving (running, jogging), else how he stands (down in his stance
    /// before the snap).
    private func pose(_ player: FootballScript.Player, _ index: Int) -> Pose {
        let here = player.position(at: t)
        // Offense faces up the field, the defense down it: in profile, right and left.
        let home: Double = player.team == .offense ? 1 : -1
        func facing(toward p: CGPoint) -> Double { abs(p.x - here.x) < 2 ? home : p.x - here.x >= 0 ? 1 : -1 }
        func envelope(_ x: Double, attack: Double, release: Double) -> Double {
            x < 0 ? max(1 + x / attack, 0) : max(1 - x / release, 0)
        }
        func smooth(_ u: Double) -> Double { let c = min(max(u, 0), 1); return c * c * (3 - 2 * c) }

        if let hold = player.hold(at: t) {
            let into = smooth((t - hold.from) / 0.16)
            switch hold.kind {
            case .down:
                let heading = player.motion(at: hold.from - 0.05).map { Double($0.heading.x) } ?? home
                let f: Double = abs(heading) < 0.15 ? home : heading > 0 ? 1 : -1
                return GridPose.dive.facing(f).mix(GridPose.down.facing(f), into)
            case .kneel: return Pose.stand.mix(GridPose.kneel.facing(home), into)
            case .touchdown: return Pose.stand.mix(GridPose.touchdown, into)
            case .fairCatch: return GridPose.fairCatch.facing(home)
            }
        }

        var base: Pose
        if let motion = player.motion(at: t), motion.speed > 3 {
            let f: Double = abs(motion.heading.x) < 0.2 ? home : motion.heading.x > 0 ? 1 : -1
            base = motion.speed > 28 ? Pose.run(2 * .pi * 3.4 * t + Double(index)).facing(f)
                : Pose.walk(2 * .pi * 2.2 * t + Double(index)).facing(f)
        } else if player.inStance(at: t) {
            base = player.role == .quarterback ? GridPose.center : GridPose.stance
        } else {
            switch player.role {
            case .line, .front, .backer, .corner, .safety, .tightEnd: base = .ready
            default: base = .stand
            }
        }

        for action in player.actions {
            let x = t - action.at
            let f = facing(toward: action.toward)
            switch action.kind {
            case .catchHigh:
                base = base.mix(Pose.catchHigh.facing(f), envelope(x, attack: 0.25, release: 0.3))
            case .catchChest, .handoff:
                base = base.mix(Pose.glove.facing(f), envelope(x, attack: 0.2, release: 0.25))
            case .scoop:
                base = base.mix(Pose.scoop.facing(f), envelope(x, attack: 0.2, release: 0.3))
            case .throwBall, .spike:
                guard x > -0.24, x < 0.4 else { continue }
                let throwing = x < -0.04 ? Pose.cock : Pose.cock.mix(.release, smooth((x + 0.04) / 0.14))
                base = base.mix(throwing.facing(action.kind == .spike ? home : f), min(envelope(x, attack: 0.2, release: 0.36) * 1.6, 1))
            case .kick:
                guard x > -0.3, x < 0.6 else { continue }
                let kicking = x < 0 ? Pose.stand.mix(GridPose.windup, smooth((x + 0.3) / 0.22)) : GridPose.windup.mix(GridPose.through, smooth(x / 0.1))
                base = x < 0.25 ? kicking.facing(home) : kicking.facing(home).mix(base, smooth((x - 0.25) / 0.35))
            case .tackle:
                base = base.mix(GridPose.dive.facing(f), envelope(x, attack: 0.16, release: 0.5))
            case .block:
                // Held once engaged, while he's set.
                guard x > -0.2, t < script.settle else { continue }
                base = base.mix(GridPose.block.facing(f), smooth((x + 0.2) / 0.2) * (player.motion(at: t).map { $0.speed > 28 ? 0.3 : 1 } ?? 1))
            }
        }
        return base
    }

    // MARK: Ball

    /// A football: a brown oval along its flight in a soft glow, a comet tail
    /// while it's in the air, its shadow on the grass (with the shadows).
    private func drawBall(_ context: inout GraphicsContext, _ f: GridProjection) {
        guard let ball = script.ball(at: t) else { return }
        let p = f.point(ball)
        // A touch larger than life, as the baseball is: it's what the eye follows.
        let r = min(max(0.55 * f.scale, 2.2), max(f.figure * 0.13, 2.2))
        let flight = script.flight(at: t)
        var angle = 0.0
        if let flight {
            let trail = (1...6).map { f.point(flight.point(at: max(t - Double($0) * 0.014, flight.start))) }
            TheaterDraw.trail(trail, from: p, radius: r * 0.8, color: ink.ball, in: context)
            if let last = trail.first, hypot(last.x - p.x, last.y - p.y) > 0.3 { angle = atan2(p.y - last.y, p.x - last.x) }
            TheaterDraw.glow(at: p, radius: r, color: ink.glow, in: context)
        } else if t < script.settle {
            TheaterDraw.glow(at: p, radius: r * 0.8, color: ink.glow.opacity(0.7), in: context)
        }
        var layer = context
        layer.translateBy(x: p.x, y: p.y)
        layer.rotate(by: .radians(angle))
        let oval = CGRect(x: -r * 1.45, y: -r * 0.92, width: r * 2.9, height: r * 1.84)
        layer.fill(Path(ellipseIn: oval.insetBy(dx: -0.6, dy: -0.6)), with: .color(ink.ballEdge))
        layer.fill(Path(ellipseIn: oval), with: .color(Color(hue: 0.06, saturation: 0.62, brightness: ink.dark ? 0.72 : 0.55)))
        if r > 2.6 {
            var laces = Path()
            laces.move(to: CGPoint(x: -r * 0.5, y: 0))
            laces.addLine(to: CGPoint(x: r * 0.5, y: 0))
            layer.stroke(laces, with: .color(.white.opacity(0.85)), lineWidth: max(r * 0.18, 0.6))
        }
    }

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
            TheaterBanner(text: banner.text, color: color, size: TheaterType.banner(size))
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

    var body: some View {
        FootballStage(state: feed?.theater ?? preloaded ?? FootballTheaterState(), rest: rest, restOffense: restOffense, palette: palette, kits: kits,
                      topName: topName, bottomName: bottomName)
    }

    /// The live situation as the field between plays: the spot and line to
    /// gain in the offense's yards (the top team attacks the right end zone).
    static func rest(_ situation: GameDetail.Football) -> (rest: FootballScript.Rest, offense: GameDetail.Side)? {
        guard let side = situation.possession else { return nil }
        func yard(_ x: Double) -> Double { side == .top ? x : 100 - x }
        return (FootballScript.Rest(yard: yard(situation.ballX), gain: situation.lineToGainX.map(yard)), side)
    }
}

/// The theater's stage: the field and one frame of the play through the
/// camera (a TimelineView only while it replays), and its celebration.
private struct FootballStage: View {
    let state: FootballTheaterState
    let rest: FootballScript.Rest?
    let restOffense: GameDetail.Side?
    let palette: TeamPalette
    let kits: TheaterKits?
    let topName: String
    let bottomName: String
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    /// The replay on screen: which play, when it began, and whether it's over.
    @State private var replay: Replay?

    struct Replay: Equatable {
        let id: String
        let start: Date
        var done = false
    }

    /// Half as tall as wide, up to this.
    static let maxHeight: CGFloat = 320

    private var offense: GameDetail.Side { state.play?.offense ?? restOffense ?? .top }

    private var teams: FootballTeams {
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
    private var zones: (near: GridironLayer.EndZone, far: GridironLayer.EndZone) {
        let top = GridironLayer.EndZone(color: TheaterTeams.solid(palette.top, scheme), name: topName.uppercased())
        let bottom = GridironLayer.EndZone(color: TheaterTeams.solid(palette.bottom, scheme), name: bottomName.uppercased())
        return offense == .top ? (top, bottom) : (bottom, top)
    }

    /// Seconds into the play on screen; infinity once it has ended (or was never replayed).
    private func time(at date: Date) -> Double {
        if case let .frozen(t) = clock { return t }
        guard let play = state.play else { return .infinity }
        if let replay, replay.id == play.id { return replay.done ? .infinity : date.timeIntervalSince(replay.start) }
        // News not yet begun: its first frame (onChange begins it).
        return state.news && !reduceMotion ? 0 : .infinity
    }

    private var playing: Bool {
        guard clock == .live, let play = state.play else { return false }
        if let replay, replay.id == play.id { return !replay.done }
        return state.news && !reduceMotion
    }

    /// On the frozen clock (the harness) every frame is a replay's.
    private var moving: Bool { playing || clock != .live }

    var body: some View {
        let script = state.play.map(FootballScript.init) ?? FootballScript(rest: rest ?? FootballScript.Rest(yard: 25, gain: 35))
        let ink = TheaterInk(scheme)
        let teams = teams, zones = zones
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                // Between plays the field holds still under the crossfade.
                if !moving { GridironLayer(ink: ink, camera: script.camera.rest, near: zones.near, far: zones.far, yaw: script.yaw).equatable().transition(.identity) }
                Group {
                    if playing {
                        TimelineView(.animation) { context in
                            let t = time(at: context.date)
                            GridironLayer(ink: ink, camera: script.camera.frame(at: t), near: zones.near, far: zones.far, yaw: script.yaw).equatable()
                            FootballFrame(scene: state.play, script: script, t: t, teams: teams, ink: ink, size: geo.size).equatable()
                        }
                        .transition(.identity)
                    } else {
                        let t = time(at: .now)
                        ZStack {
                            if moving { GridironLayer(ink: ink, camera: script.camera.frame(at: t), near: zones.near, far: zones.far, yaw: script.yaw).equatable() }
                            FootballFrame(scene: state.play, script: script, t: t, teams: teams, ink: ink, size: geo.size).equatable()
                        }
                        .transition(.identity)
                    }
                }
                .id(state.play?.id)
                // A replay cuts in; a play that isn't replayed crossfades to how it ended.
                .transition(playing ? .identity : .opacity.animation(.easeInOut(duration: 0.35)))
                if let play = state.play {
                    FootballCelebrationStage(play: play, script: script, size: geo.size, colors: (teams.offense.accent, teams.defense.accent),
                                             start: replay?.id == play.id ? replay?.start : nil)
                        .id(play.id)
                }
            }
        }
        // The well spans the column, so its edges line up with the drive chart under it.
        .modifier(WellHeight(cap: Self.maxHeight))
        .vizWell(padding: 0)
        .accessibilityHidden(true)
        .onAppear(perform: begin)
        .onChange(of: state.play?.id) { _, _ in begin() }
        .task(id: replay) {
            guard let replay, !replay.done else { return }
            try? await Task.sleep(for: .seconds(max(script.duration - Date.now.timeIntervalSince(replay.start), 0) + 0.05))
            guard !Task.isCancelled, self.replay?.id == replay.id else { return }
            self.replay?.done = true
        }
    }

    /// A new play replays from its snap; history and Reduce Motion don't.
    private func begin() {
        guard clock == .live, !reduceMotion, state.news, let play = state.play, replay?.id != play.id else { return }
        replay = Replay(id: play.id, start: .now)
    }
}

private struct WellHeight: ViewModifier {
    let cap: CGFloat

    func body(content: Content) -> some View {
        TheaterWell(cap: cap) { content }
    }
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
        let scale = max(2.2, height / 95)
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
            let f = GridProjection(size: size, camera: script.camera.frame(at: t), yaw: script.yaw)
            context.clip(to: f.bounds)
            for burst in bursts where t >= burst.at && t <= burst.end {
                let origin = switch burst.anchor {
                case let .field(p): f.point(p)
                case .banner: TheaterType.bannerOrigin(size)
                }
                var layer = context
                layer.translateBy(x: origin.x, y: origin.y)
                layer.scaleBy(x: burst.scale, y: burst.scale)
                Celebration.draw(Celebration.particles(burst.cue, origin: .zero, t: t - burst.at), in: layer,
                                 palette: CelebrationColors.team(color(burst.side)).palette)
            }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }
}
