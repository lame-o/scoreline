import SwiftUI

// The basketball theater: in the Shot Chart section, above the court, every
// play of a live game told on an isometric court as it arrives from the live
// lane, in order, shot like a broadcast. A basket (a block, a buzzer-beater)
// replays in full: the camera opens on the half court with both fives set,
// follows the ball to the man it goes to, frames the shooter and the rim as
// the shot goes up, and settles on the rim as the stamp lands ("+3 3PT",
// "BROWN JR. · 23 FT JUMP SHOT", "AST ELLIS"); marquee plays get a headline
// across the top (DUNK, AND-ONE, POSTERIZED, BUZZER-BEATER, REJECTED), a
// buzzer-beater's confetti off it. Everything else is a lighter beat that
// carries on from where the court stood (BasketballBeats.swift): each miss
// and its rebound, each free throw, each whistle and turnover, the jump
// balls, substitutions, timeouts, reviews and the ends of periods; between
// plays the court rests possession-aware, a small beat every few seconds.
// The running order and what the tag says are BasketballFlow.swift's.
//
// Over the court: the broadcast tag (SPURS BALL, SHOOTING FOUL · HAYES,
// TIMEOUT · JAZZ, END OF 3RD), the heartbeat ("Live · 4s"), and on hover the
// control that turns the court round to match the viewer's TV (remembered
// per game). The theater takes the broadcast's ends (`HoopsEnds`: swapped at
// halftime); the shot chart under it keeps its whole-game convention (the
// top team at the right basket all game, as its caption says), because it
// lays every shot of both halves on one court and a team's shots split
// across both ends would read as two teams. It's the theater's caption, not
// its mirror.
//
// Built from the other theaters' parts: the projection and camera framing,
// the rig's figures, the ball and its comet tail, the type (TheaterKit.swift,
// TheaterRig.swift). Drawn in one Canvas, the court and the players together
// through the camera, so lines stay crisp at any zoom and the two never
// disagree on it. A TimelineView exists only while something moves; between
// the court's sparse beats it's a still frame. Plays already on the page
// when it opened aren't told (the live court); with Reduce Motion each play
// crossfades to how it ended, the camera never moves, nothing idles, and the
// tags still say what's happening. Decorative for VoiceOver (the shot chart
// carries the play), all but the turn control.

// MARK: - Court

/// The court: the hardwood, the paint and the center circle in the home
/// team's color, the lines (the lanes, the free-throw circles, the arcs and
/// the restricted areas, the half-court line), and its name at center court.
/// The baskets (stanchion, backboard, rim and net) are drawn in two parts
/// round the figures, so a ball dropping through the net passes behind its
/// front. Drawn first in the frame's own pass, through the same projection
/// as the players.
enum HoopsCourtLayer {
    struct Paint: Equatable {
        var color = Color.gray
        var name = ""
        /// The three-point arc's radius (the WNBA's is shorter).
        var three = Hoops.three
    }

    enum Symbol: Hashable { case name }

    /// Every line, in the play's frame, as polylines: drawn the same through any camera.
    private static func lines(three: Double) -> (solid: [[CGPoint]], dashed: [[CGPoint]]) {
        var solid: [[CGPoint]] = [], dashed: [[CGPoint]] = []
        func arc(_ c: CGPoint, _ r: Double, from a: Double, to b: Double, steps: Int = 28) -> [CGPoint] {
            (0...steps).map { k in let t = a + (b - a) * Double(k) / Double(steps); return CGPoint(x: c.x + r * cos(t), y: c.y + r * sin(t)) }
        }
        let L = Hoops.length, W = Hoops.width
        solid.append([CGPoint(x: 0, y: 0), CGPoint(x: L, y: 0), CGPoint(x: L, y: W), CGPoint(x: 0, y: W), CGPoint(x: 0, y: 0)])
        solid.append([CGPoint(x: L / 2, y: 0), CGPoint(x: L / 2, y: W)])
        solid.append(arc(CGPoint(x: L / 2, y: W / 2), 6, from: 0, to: 2 * .pi, steps: 40))
        solid.append(arc(CGPoint(x: L / 2, y: W / 2), 2, from: 0, to: 2 * .pi, steps: 20))
        for end in [1.0, -1.0] {
            // In from the baseline at x = 94 (end 1) or x = 0 (end −1).
            let base = end > 0 ? L : 0
            func x(_ fromBase: Double) -> Double { base - end * fromBase }
            let rim = CGPoint(x: x(L - Hoops.rim.x), y: W / 2)
            let ft = x(L - Hoops.freeThrow)
            solid.append([CGPoint(x: base, y: W / 2 - Hoops.lane), CGPoint(x: ft, y: W / 2 - Hoops.lane), CGPoint(x: ft, y: W / 2 + Hoops.lane),
                          CGPoint(x: base, y: W / 2 + Hoops.lane)])
            // The free-throw circle: solid outside the lane, dashed inside it.
            let facing = end > 0 ? Double.pi : 0
            solid.append(arc(CGPoint(x: ft, y: W / 2), 6, from: facing - .pi / 2, to: facing + .pi / 2))
            let inside = arc(CGPoint(x: ft, y: W / 2), 6, from: facing + .pi / 2, to: facing + 3 * .pi / 2, steps: 16)
            for k in stride(from: 0, to: inside.count - 1, by: 2) { dashed.append([inside[k], inside[k + 1]]) }
            // The restricted area, out to the backboard.
            let board = x(L - Hoops.board)
            var restricted = [CGPoint(x: board, y: W / 2 - 4)]
            restricted += arc(rim, 4, from: facing + end * .pi / 2, to: facing - end * .pi / 2, steps: 20)
            restricted.append(CGPoint(x: board, y: W / 2 + 4))
            solid.append(restricted)
            // The three: the corners straight, then the arc round the rim.
            let reach = (three * three - Hoops.corner * Hoops.corner).squareRoot()
            let meet = asin(Hoops.corner / three)
            var line = [CGPoint(x: base, y: W / 2 - Hoops.corner), CGPoint(x: rim.x - end * reach, y: W / 2 - Hoops.corner)]
            line += arc(rim, three, from: facing + end * meet, to: facing - end * meet, steps: 40)
            line.append(CGPoint(x: base, y: W / 2 + Hoops.corner))
            solid.append(line)
            // The lane's marks: the block, then every 3 ft.
            for d in [7.0, 8.0, 11.0, 14.0] {
                for side in [-1.0, 1.0] {
                    let y = W / 2 + side * Hoops.lane
                    solid.append([CGPoint(x: x(d), y: y), CGPoint(x: x(d), y: y + side * (d == 8 ? 0.7 : 0.5))])
                }
            }
        }
        return (solid, dashed)
    }

    private static let standard = lines(three: Hoops.three)
    private static let wnba = lines(three: 22.15)

    static func draw(_ context: inout GraphicsContext, _ h: HoopProjection, ink: TheaterInk, paint: Paint) {
        func quad(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) -> Path {
            var path = Path()
            path.addLines([h.point(CGPoint(x: x0, y: y0)), h.point(CGPoint(x: x1, y: y0)), h.point(CGPoint(x: x1, y: y1)), h.point(CGPoint(x: x0, y: y1))])
            path.closeSubpath()
            return path
        }
        // The floor runs on past the lines (the apron), the court on it.
        context.fill(quad(-12, -12, Hoops.length + 12, Hoops.width + 12), with: .color(ink.apron))
        context.fill(quad(0, 0, Hoops.length, Hoops.width), with: .color(ink.hardwood))
        // The planks: faint lines along the court, where there's room to see them.
        if h.scale >= 3 {
            var planks = Path()
            for y in stride(from: 2.5, to: Hoops.width, by: 2.5) {
                planks.move(to: h.point(CGPoint(x: 0, y: y)))
                planks.addLine(to: h.point(CGPoint(x: Hoops.length, y: y)))
            }
            context.stroke(planks, with: .color(ink.plank), lineWidth: 0.5)
        }
        // The paint and the center circle in the home team's color.
        let tint = paint.color.opacity(ink.dark ? 0.3 : 0.24)
        context.fill(quad(Hoops.length - (Hoops.length - Hoops.freeThrow), Hoops.width / 2 - Hoops.lane, Hoops.length, Hoops.width / 2 + Hoops.lane),
                     with: .color(tint))
        context.fill(quad(0, Hoops.width / 2 - Hoops.lane, Hoops.length - Hoops.freeThrow, Hoops.width / 2 + Hoops.lane), with: .color(tint))
        var circle = Path()
        circle.addLines((0...40).map { k in
            let a = Double(k) / 40 * 2 * .pi
            return h.point(CGPoint(x: Hoops.length / 2 + 6 * cos(a), y: Hoops.width / 2 + 6 * sin(a)))
        })
        context.fill(circle, with: .color(tint))
        // Its name at center court, flat on the floor, read from the camera's sideline.
        if let text = context.resolveSymbol(id: Symbol.name), h.scale >= 1.2 {
            let k = min(5 / text.size.height, 11 / max(text.size.width, 1))
            var layer = context
            layer.opacity = 0.4
            let yaw = h.yaw, s = h.scale
            // Right and down along the floor as the camera sees it: left to right across the view.
            let flip: Double = cos(yaw) >= 0 ? 1 : -1
            let gx = CGVector(dx: cos(yaw) * s * flip, dy: 0.5 * sin(yaw) * s * flip), gy = CGVector(dx: sin(yaw) * s * flip, dy: -0.5 * cos(yaw) * s * flip)
            let c = h.point(CGPoint(x: Hoops.length / 2, y: Hoops.width / 2))
            layer.concatenate(CGAffineTransform(a: gx.dx * k, b: gx.dy * k, c: -gy.dx * k, d: -gy.dy * k, tx: c.x, ty: c.y))
            layer.draw(text, at: .zero, anchor: .center)
        }
        // The lines: chalk-white paint, thickening a little as the camera closes in.
        let width = min(max(0.7, h.scale * 0.11), 1.5)
        let geometry = paint.three < 23 ? wnba : standard
        var solid = Path(), dashed = Path()
        for line in geometry.solid { solid.addLines(line.map { h.point($0) }) }
        for line in geometry.dashed { dashed.addLines(line.map { h.point($0) }) }
        if let edge = ink.courtEdge {
            context.stroke(solid, with: .color(edge), lineWidth: width + 1.1)
        }
        context.stroke(solid, with: .color(ink.chalk.opacity(ink.dark ? 0.7 : 1)), style: StrokeStyle(lineWidth: width, lineJoin: .round))
        context.stroke(dashed, with: .color(ink.chalk.opacity(ink.dark ? 0.5 : 0.8)), lineWidth: width)
    }

    @ViewBuilder
    static func symbols(ink: TheaterInk, paint: Paint) -> some View {
        Text(paint.name).font(.system(size: 60, weight: .black).width(.expanded)).foregroundStyle(ink.chalk).fixedSize().tag(Symbol.name)
    }

    /// What moves at a basket at t: the net's stretch and swing, the rim's give.
    struct Motion: Equatable {
        var net: BasketballScript.Net?
        var rimHit: Double?
        var rimStrength = 0.0
        var t = Double.infinity
    }

    /// One basket in the play's frame (`end` 1: the one the offense attacks):
    /// its back (the stanchion, the backboard, the far half of the rim) or
    /// its front (the near half of the rim and the net).
    static func basket(_ context: GraphicsContext, _ h: HoopProjection, ink: TheaterInk, end: Double, front: Bool, motion: Motion) {
        let L = Hoops.length, W = Hoops.width
        let rim = end > 0 ? Hoops.rim : CGPoint(x: L - Hoops.rim.x, y: W / 2)
        let board = end > 0 ? Hoops.board : L - Hoops.board
        let behind = end > 0 ? L + 3.5 : -3.5
        let line = min(max(0.8, h.scale * 0.16), 2)
        let attacked = end > 0
        let center = h.depth(rim)
        // The rim: a ring, its front pulled down by a dunk and let go.
        let give: Double = {
            guard attacked, let hit = motion.rimHit, motion.t >= hit else { return 0 }
            let x = motion.t - hit
            return x < 1.2 ? motion.rimStrength * 0.55 * exp(-6 * x) * cos(22 * x) : 0
        }()
        let ring = (0...32).map { k -> (p: CGPoint, depth: Double) in
            let a = Double(k) / 32 * 2 * .pi
            let g = CGPoint(x: rim.x + Hoops.rimRadius * cos(a), y: rim.y + Hoops.rimRadius * sin(a))
            // The front of it (toward midcourt) gives most.
            let front = max(0, -cos(a) * end)
            return (h.point(g, z: Hoops.rimHeight - give * front), h.depth(g))
        }
        if !front {
            // The stanchion behind the baseline, the arm out to the board.
            var pole = Path()
            pole.move(to: h.point(CGPoint(x: behind, y: W / 2)))
            pole.addLine(to: h.point(CGPoint(x: behind, y: W / 2), z: 11.6))
            pole.addLine(to: h.point(CGPoint(x: board + end * 0.3, y: W / 2), z: 11.6))
            context.stroke(pole, with: .color(ink.stanchion), style: StrokeStyle(lineWidth: line * 1.6, lineCap: .round, lineJoin: .round))
            var pad = Path()
            pad.addLines([h.point(CGPoint(x: behind - end * 1.2, y: W / 2 - 2)), h.point(CGPoint(x: behind + end * 2, y: W / 2 - 2)),
                          h.point(CGPoint(x: behind + end * 2, y: W / 2 + 2)), h.point(CGPoint(x: behind - end * 1.2, y: W / 2 + 2))])
            pad.closeSubpath()
            context.fill(pad, with: .color(ink.stanchion.opacity(0.6)))
            // The backboard: glass with its edge and the shooter's square.
            func pane(_ y0: Double, _ y1: Double, _ z0: Double, _ z1: Double) -> Path {
                var p = Path()
                p.addLines([h.point(CGPoint(x: board, y: y0), z: z0), h.point(CGPoint(x: board, y: y1), z: z0),
                            h.point(CGPoint(x: board, y: y1), z: z1), h.point(CGPoint(x: board, y: y0), z: z1)])
                p.closeSubpath()
                return p
            }
            let glass = pane(W / 2 - 3, W / 2 + 3, Hoops.boardBottom, Hoops.boardTop)
            context.fill(glass, with: .color(ink.glass))
            context.stroke(glass, with: .color(ink.chalk.opacity(ink.dark ? 0.75 : 0.95)), lineWidth: line)
            context.stroke(pane(W / 2 - 1, W / 2 + 1, Hoops.rimHeight, Hoops.rimHeight + 1.5), with: .color(ink.chalk.opacity(0.7)), lineWidth: line * 0.8)
            // The far half of the rim, and the bracket to the board.
            var back = Path()
            for k in 0..<32 where ring[k].depth >= center && ring[k + 1].depth >= center {
                back.move(to: ring[k].p)
                back.addLine(to: ring[k + 1].p)
            }
            back.move(to: h.point(CGPoint(x: rim.x + end * Hoops.rimRadius, y: rim.y), z: Hoops.rimHeight))
            back.addLine(to: h.point(CGPoint(x: board, y: rim.y), z: Hoops.rimHeight))
            context.stroke(back, with: .color(ink.hoop), style: StrokeStyle(lineWidth: line * 1.3, lineCap: .round))
            return
        }
        // The net: strands from the ring down to a narrower one, stretched and swung as the ball goes through.
        var stretch = 0.0, swing = CGPoint.zero
        if attacked, let net = motion.net, motion.t >= net.at {
            let x = motion.t - net.at
            if x < 1.6 {
                stretch = net.strength * 0.85 * exp(-5 * x) * sin(min(x / 0.07, 1) * .pi / 2) * cos(14 * max(x - 0.07, 0))
                let w = net.strength * 0.4 * exp(-3.2 * x) * sin(9 * x + 0.4)
                swing = CGPoint(x: net.way.x * w, y: net.way.y * w)
            }
        }
        let depthNet = 1.55 + max(stretch, -0.3)
        var strands = Path(), rings = Path()
        let n = 12
        var bottom: [CGPoint] = [], middle: [CGPoint] = []
        for k in 0..<n {
            let a = Double(k) / Double(n) * 2 * .pi
            let top = CGPoint(x: rim.x + Hoops.rimRadius * cos(a), y: rim.y + Hoops.rimRadius * sin(a))
            let low = CGPoint(x: rim.x + swing.x + 0.42 * cos(a), y: rim.y + swing.y + 0.42 * sin(a))
            let mid = CGPoint(x: rim.x + swing.x * 0.45 + 0.6 * cos(a), y: rim.y + swing.y * 0.45 + 0.6 * sin(a))
            let front = max(0, -cos(a) * end)
            let p0 = h.point(top, z: Hoops.rimHeight - give * front), p1 = h.point(mid, z: Hoops.rimHeight - depthNet * 0.5)
            let p2 = h.point(low, z: Hoops.rimHeight - depthNet)
            strands.move(to: p0)
            strands.addQuadCurve(to: p2, control: p1)
            middle.append(p1)
            bottom.append(p2)
        }
        rings.addLines(middle + [middle[0]])
        rings.addLines(bottom + [bottom[0]])
        context.stroke(strands, with: .color(ink.netting), lineWidth: max(line * 0.5, 0.5))
        context.stroke(rings, with: .color(ink.netting.opacity(0.7)), lineWidth: max(line * 0.45, 0.5))
        // The near half of the rim, over the net.
        var near = Path()
        for k in 0..<32 where ring[k].depth < center || ring[k + 1].depth < center {
            near.move(to: ring[k].p)
            near.addLine(to: ring[k + 1].p)
        }
        context.stroke(near, with: .color(ink.hoop), style: StrokeStyle(lineWidth: line * 1.4, lineCap: .round))
    }
}

extension TheaterInk {
    /// The hardwood: a warm tint, as the grass is tinted, not painted.
    var hardwood: Color {
        dark ? Color(hue: 0.085, saturation: 0.42, brightness: 0.8).opacity(0.17) : Color(hue: 0.085, saturation: 0.5, brightness: 0.74).opacity(0.3)
    }
    /// Past the lines: the same floor, a shade quieter.
    var apron: Color { dark ? Color(hue: 0.085, saturation: 0.3, brightness: 0.6).opacity(0.09) : Color(hue: 0.085, saturation: 0.3, brightness: 0.6).opacity(0.12) }
    var plank: Color { dark ? Color.white.opacity(0.025) : Color.black.opacity(0.03) }
    /// Under the lines in the light: a soft wood-toned edge that keeps white paint crisp on a pale floor.
    var courtEdge: Color? { dark ? nil : Color(hue: 0.08, saturation: 0.5, brightness: 0.3).opacity(0.18) }
    var glass: Color { dark ? Color.white.opacity(0.07) : Color(white: 0.55).opacity(0.1) }
    var stanchion: Color { Color.primary.opacity(dark ? 0.26 : 0.2) }
    /// The rim's orange, a little deeper on a light panel.
    var hoop: Color { Color(hue: 0.055, saturation: 0.85, brightness: dark ? 0.98 : 0.82) }
    var netting: Color { dark ? Color.white.opacity(0.75) : Color(white: 0.45).opacity(0.85) }
    /// The ball's leather.
    var leather: Color { Color(hue: 0.065, saturation: 0.78, brightness: dark ? 0.95 : 0.82) }
}

// MARK: - Players and ball

/// The two teams on the court, always told apart at a glance.
struct BasketballTeams: Equatable {
    var offense: Uniform
    var defense: Uniform

    /// A referee, as near as a pictogram gets for now: a gray shirt, a black
    /// cap. The one place the basketball officials' kit lives (every
    /// referee the theater draws wears this), for when the figure painter
    /// can stripe a shirt and color the legs (zebra stripes, black trousers).
    static let official = Uniform(jersey: Color(white: 0.62), cap: Color(white: 0.1), accent: .white)
}

/// Basketball's poses, relative to his heading (where he faces). Arms swing
/// forward from hanging (straight up past 3), spread out, turn outward, and
/// bend only their own way.
enum HoopPose {
    /// Off the ball, ready to catch: knees a little bent, hands up.
    static let ready = RigPose(hip: RigVector(-0.02, 0, 0.45), lean: 0.2, left: RigVector(0.02, 0.1, 0), right: RigVector(-0.02, -0.1, 0), knees: 0.25,
                               leftArm: RigArm(swing: 0.55, spread: 0.22, turn: -0.2, bend: 1.0), rightArm: RigArm(swing: 0.55, spread: 0.22, turn: -0.2, bend: 1.0))
    /// On defense: low and wide, the arms out.
    static let guarding = RigPose(hip: RigVector(-0.06, 0, 0.39), lean: 0.42, left: RigVector(0.03, 0.18, 0), right: RigVector(0, -0.18, 0), knees: 0.45,
                                  leftArm: RigArm(swing: 0.55, spread: 1.05, turn: -0.3, bend: 0.45),
                                  rightArm: RigArm(swing: 0.8, spread: 0.85, turn: -0.2, bend: 0.5))
    /// The ball in both hands at the chest.
    static let hold = RigPose(lean: 0.08, leftArm: RigArm(swing: 0.75, spread: 0.06, turn: -0.55, bend: 1.9),
                              rightArm: RigArm(swing: 0.8, spread: 0.08, turn: -0.5, bend: 1.95))
    /// On the dribble: the right hand pushing it down at his side (`up`: the
    /// ball's height, 0 the floor), the left arm out to keep his man off.
    static func dribble(_ up: Double) -> RigPose {
        RigPose(hip: RigVector(-0.02, 0, 0.45), lean: 0.24, knees: 0.25,
                leftArm: RigArm(swing: 0.95, spread: 0.55, turn: -0.4, bend: 0.95),
                rightArm: RigArm(swing: 0.3 + 0.3 * up, spread: 0.3, turn: -0.1, bend: 0.35 + 0.55 * up))
    }
    /// Into the shot: the dip, the ball at his chin, knees bent.
    static let dip = RigPose(hip: RigVector(-0.03, 0, 0.42), lean: 0.12, left: RigVector(0.03, 0.09, 0), right: RigVector(-0.02, -0.09, 0), knees: 0.3,
                             leftArm: RigArm(swing: 1.2, spread: 0.25, turn: -0.5, bend: 1.7), rightArm: RigArm(swing: 1.35, spread: 0.12, turn: -0.2, bend: 1.9))
    /// The set: the ball over his forehead, the elbow under it.
    static let set = RigPose(hip: RigVector(0, 0, 0.48), lean: -0.04, left: RigVector(0.02, 0.07, 0), right: RigVector(-0.01, -0.07, 0), knees: 0.12,
                             leftArm: RigArm(swing: 2.25, spread: 0.4, turn: -0.75, bend: 1.3), rightArm: RigArm(swing: 2.35, spread: 0.12, turn: -0.15, bend: 1.75))
    /// The release: the shooting arm up and out, the guide hand off it.
    static let release = RigPose(hip: RigVector(0, 0, 0.49), lean: -0.06, left: RigVector(0, 0.06, 0), right: RigVector(-0.03, -0.06, 0), knees: 0.08,
                                 leftArm: RigArm(swing: 2.3, spread: 0.45, turn: -0.6, bend: 0.75), rightArm: RigArm(swing: 2.85, spread: 0.08, turn: -0.1, bend: 0.1))
    /// The follow-through, held as he comes down.
    static let follow = RigPose(hip: RigVector(0, 0, 0.47), lean: 0.02, left: RigVector(0.02, 0.08, 0), right: RigVector(-0.02, -0.08, 0), knees: 0.15,
                                leftArm: RigArm(swing: 1.6, spread: 0.4, turn: -0.4, bend: 0.6), rightArm: RigArm(swing: 2.55, spread: 0.08, turn: -0.1, bend: 0.3))
    /// The gather for a layup: the ball up at his chest, the right knee coming up.
    static let gather = RigPose(hip: RigVector(0, 0, 0.46), lean: 0.1, left: RigVector(-0.04, 0.07, 0), right: RigVector(0.1, -0.06, 0.14), knees: 0.12,
                                leftArm: RigArm(swing: 1.1, spread: 0.2, turn: -0.5, bend: 1.6), rightArm: RigArm(swing: 1.3, spread: 0.12, turn: -0.3, bend: 1.5))
    /// The layup: off his left foot, the right knee driven up, the ball laid in from the top of his reach.
    static let layup = RigPose(hip: RigVector(0.02, 0, 0.5), lean: -0.04, twist: 0.15, left: RigVector(-0.06, 0.06, 0), right: RigVector(0.16, -0.05, 0.28),
                               knees: 0.1, leftArm: RigArm(swing: 1.55, spread: 0.45, turn: -0.3, bend: 1.0),
                               rightArm: RigArm(swing: 2.95, spread: 0.1, turn: -0.1, bend: 0.12))
    /// The dunk: the ball cocked back over his head in both hands, knees tucked.
    static let cock = RigPose(hip: RigVector(0, 0, 0.5), lean: -0.18, left: RigVector(-0.1, 0.07, 0.1), right: RigVector(-0.12, -0.07, 0.12), knees: 0.15,
                              leftArm: RigArm(swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8), rightArm: RigArm(swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8))
    /// …hammered down through the rim.
    static let slam = RigPose(hip: RigVector(0.02, 0, 0.5), lean: 0.22, left: RigVector(0.06, 0.08, 0.04), right: RigVector(0.04, -0.08, 0.06), knees: 0.12,
                              leftArm: RigArm(swing: 2.35, spread: 0.2, turn: -0.2, bend: 0.25), rightArm: RigArm(swing: 2.35, spread: 0.2, turn: -0.2, bend: 0.25))
    /// Hanging on the rim, legs down.
    static let hang = RigPose(hip: RigVector(-0.02, 0, 0.5), lean: 0.05, left: RigVector(0.07, 0.08, 0.02), right: RigVector(0.05, -0.08, 0), knees: 0.1,
                              leftArm: RigArm(swing: 3.0, spread: 0.12, turn: -0.15, bend: 0.12), rightArm: RigArm(swing: 3.0, spread: 0.12, turn: -0.15, bend: 0.12))
    /// Off the floor: legs a little bent under him.
    static let air = RigPose(hip: RigVector(0, 0, 0.5), left: RigVector(0.02, 0.07, 0.05), right: RigVector(-0.05, -0.07, 0.07), knees: 0.15)
    /// A hand up at the shooter.
    static let contest = RigPose(hip: RigVector(0, 0, 0.47), lean: 0.02, left: RigVector(0.03, 0.12, 0), right: RigVector(-0.03, -0.12, 0), knees: 0.15,
                                 leftArm: RigArm(swing: 0.9, spread: 0.85, turn: -0.2, bend: 0.4), rightArm: RigArm(swing: 3.0, spread: 0.06, turn: -0.1, bend: 0.06))
    /// Up at the rim, both arms straight up: the help's wall.
    static let wall = RigPose(hip: RigVector(0, 0, 0.49), lean: -0.02, leftArm: RigArm(swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06),
                              rightArm: RigArm(swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06))
    /// The block: reaching up and out for it…
    static let block = RigPose(hip: RigVector(0.02, 0, 0.49), lean: 0.1, leftArm: RigArm(swing: 1.7, spread: 0.6, turn: -0.2, bend: 0.4),
                               rightArm: RigArm(swing: 2.85, spread: 0.15, turn: -0.1, bend: 0.05))
    /// …and the swat through it.
    static let swat = RigPose(hip: RigVector(0.02, 0, 0.48), lean: 0.25, leftArm: RigArm(swing: 1.2, spread: 0.6, bend: 0.5),
                              rightArm: RigArm(swing: 1.9, spread: 0.55, turn: 0.5, bend: 0.2))
    /// Boxing out: low and wide, arms out, his back into his man.
    static let boxOut = RigPose(hip: RigVector(-0.07, 0, 0.38), lean: 0.3, left: RigVector(0, 0.2, 0), right: RigVector(0, -0.2, 0), knees: 0.5,
                                leftArm: RigArm(swing: 0.8, spread: 1.15, turn: -0.2, bend: 0.85), rightArm: RigArm(swing: 0.8, spread: 1.15, turn: -0.2, bend: 0.85))
    /// The chest pass: both arms out at it.
    static let pass = RigPose(lean: 0.14, leftArm: RigArm(swing: 1.5, spread: 0.08, turn: -0.25, bend: 0.12), rightArm: RigArm(swing: 1.5, spread: 0.08, turn: -0.25, bend: 0.12))
    /// The lob, from over his head.
    static let lob = RigPose(lean: -0.04, leftArm: RigArm(swing: 2.55, spread: 0.12, turn: -0.3, bend: 0.3), rightArm: RigArm(swing: 2.55, spread: 0.12, turn: -0.3, bend: 0.3))
    /// Hands up and out as a target for the pass.
    static let target = RigPose(lean: 0.1, leftArm: RigArm(swing: 1.25, spread: 0.2, turn: -0.4, bend: 0.75), rightArm: RigArm(swing: 1.25, spread: 0.2, turn: -0.4, bend: 0.75))
    /// The hook: side-on, the far arm sweeping over his head.
    static let hookSet = RigPose(turn: -1.1, hip: RigVector(0, 0, 0.47), lean: 0.05, knees: 0.15, leftArm: RigArm(swing: 1.3, spread: 0.6, turn: -0.3, bend: 0.9),
                                 rightArm: RigArm(swing: 1.9, spread: 1.1, turn: 0.5, bend: 0.9))
    static let hook = RigPose(turn: -1.1, hip: RigVector(0, 0, 0.49), lean: -0.05, knees: 0.1, leftArm: RigArm(swing: 1.4, spread: 0.7, turn: -0.2, bend: 0.8),
                              rightArm: RigArm(swing: 2.95, spread: 0.85, turn: 0.3, bend: 0.15))
    /// The tip: one hand straight up at it.
    static let tip = RigPose(hip: RigVector(0, 0, 0.49), leftArm: RigArm(swing: 2.6, spread: 0.2, bend: 0.3), rightArm: RigArm(swing: 3.05, spread: 0.08, bend: 0.06))
    /// A hand on him: the reach that draws a whistle, the arm out at his chest.
    static let reach = RigPose(hip: RigVector(0.03, 0, 0.42), lean: 0.4, left: RigVector(0.16, 0.1, 0), right: RigVector(-0.14, -0.12, 0), knees: 0.25,
                               leftArm: RigArm(swing: 0.6, spread: 0.5, turn: -0.2, bend: 0.5), rightArm: RigArm(swing: 1.45, spread: 0.12, turn: -0.2, bend: 0.15))
    /// Knocked down by the charge: on his back, arms flung out.
    static let fallen = RigPose(hip: RigVector(-0.1, 0, 0.12), pitch: -1.45, nod: 0.35, left: RigVector(0.02, 0.1, -0.36),
                                right: RigVector(0.06, -0.1, -0.3), knees: 0.3, leftArm: RigArm(swing: 2.5, spread: 0.55, bend: 0.4),
                                rightArm: RigArm(swing: 2.3, spread: 0.6, bend: 0.5))
    /// A referee's call: a fist straight up (a foul, a timeout), the other arm at his side.
    static let signal = RigPose(leftArm: RigArm(swing: 0.25, spread: 0.2, turn: -0.2, bend: 0.3), rightArm: RigArm(swing: 3.05, spread: 0.05, turn: 0.2, bend: 0.12))
    /// Pointing the way the ball goes now: the arm out level.
    static let point = RigPose(turn: 0.35, leftArm: RigArm(swing: 0.2, spread: 0.2, bend: 0.3), rightArm: RigArm(swing: 1.55, spread: 0.45, turn: 0.35, bend: 0.05))
    /// Hands on his hips, waiting on a free throw.
    static let hips = RigPose(hip: RigVector(0, 0, 0.49), leftArm: RigArm(swing: 0.3, spread: 0.75, turn: -0.9, bend: 1.9),
                              rightArm: RigArm(swing: 0.3, spread: 0.75, turn: -0.9, bend: 1.9))
    /// The steal: lunging, a hand out low at the ball.
    static let steal = RigPose(hip: RigVector(0.04, 0, 0.38), lean: 0.65, left: RigVector(0.24, 0.1, 0), right: RigVector(-0.22, -0.12, 0), knees: 0.3,
                               leftArm: RigArm(swing: 0.4, spread: 0.6, bend: 0.4), rightArm: RigArm(swing: 1.35, spread: 0.18, turn: -0.2, bend: 0.1))
}

/// One frame of a play through the camera: the court, the shadows, the
/// baskets' backs, the players far to near, the ball, the nets and the
/// rims' fronts, the beats, the headline and the stamp. Equatable: at rest
/// (t = ∞) an update elsewhere on the page doesn't redraw it.
struct BasketballFrame: View, Equatable {
    let scene: BasketballScene?
    let script: BasketballScript
    let t: Double
    let teams: BasketballTeams
    let ink: TheaterInk
    /// Where it's drawn: the type is sized from it.
    let size: CGSize
    var paint = HoopsCourtLayer.Paint()

    /// The time first: mid-replay it's all that differs.
    static func == (a: BasketballFrame, b: BasketballFrame) -> Bool {
        a.t == b.t && a.size == b.size && a.teams == b.teams && a.ink == b.ink && a.paint == b.paint && a.scene == b.scene && a.script == b.script
    }

    private enum Symbol: Hashable { case stamp, banner }

    var body: some View {
        Canvas { context, size in
            let h = HoopProjection(size: size, camera: script.camera.frame(at: t), yaw: script.yaw)
            context.clip(to: h.bounds)
            HoopsCourtLayer.draw(&context, h, ink: ink, paint: paint)
            let figures = posed(h)
            drawShadows(&context, h, figures)
            let motion = HoopsCourtLayer.Motion(net: script.net, rimHit: script.rimHit, rimStrength: script.rimStrength, t: t)
            for end in [-1.0, 1.0] { HoopsCourtLayer.basket(context, h, ink: ink, end: end, front: false, motion: motion) }
            drawPlayers(&context, h, figures)
            let ball = ballPoint(h, figures)
            if let ball, ball.inHoop { drawBall(&context, h, at: ball.point) }
            for end in [-1.0, 1.0] { HoopsCourtLayer.basket(context, h, ink: ink, end: end, front: true, motion: motion) }
            if let ball, !ball.inHoop { drawBall(&context, h, at: ball.point) }
            drawFlashes(&context, h)
            drawLabels(&context, h)
        } symbols: {
            HoopsCourtLayer.symbols(ink: ink, paint: paint)
            stamp.tag(Symbol.stamp)
            banner.tag(Symbol.banner)
        }
    }

    // MARK: Players

    /// A player posed and placed at t; with the ball, where it is in his hands.
    private struct Posed {
        let index: Int
        let figure: RigFigure
        var ball: CGPoint? = nil
    }

    /// Everyone at t, far to near: a player in front covers the one behind.
    private func posed(_ h: HoopProjection) -> [Posed] {
        let carrier = script.carrier(at: t)
        return script.players.indices
            .filter { script.players[$0].opacity(at: t) > 0.01 }
            .map { (index: $0, at: script.players[$0].position(at: t)) }
            .sorted { h.depth($0.at) > h.depth($1.at) }
            .map { index, at in
                let player = script.players[index]
                let lens = RigLens(h, at: at)
                let (body, heading) = pose(player, index, at: at, unit: lens.unit)
                let skeleton = RigSkeleton(body)
                let figure = RigFigure(skeleton, heading: heading, lens: lens)
                var ball: CGPoint?
                if let carrier, carrier.player == index, let spot = script.ball(at: t) {
                    let held = Rig.smooth((t - carrier.from) / 0.12) * (carrier.until.isFinite ? Rig.smooth((carrier.until - t) / 0.08) : 1)
                    let hand: CGPoint
                    if carrier.dribbling {
                        // At his right hand at the top of the bounce, on the floor under it at the bottom.
                        let leg = script.legs.last { t >= $0.from }
                        let up = BasketballScript.bounce(t - (leg?.from ?? 0))
                        let c = cos(heading), s = sin(heading)
                        let k = skeleton.hands.1
                        let top = lens.point(RigVector(k.x * c - k.y * s, k.x * s + k.y * c, k.z))
                        let floor = lens.point(RigVector(k.x * c - k.y * s, k.x * s + k.y * c, 0.06))
                        hand = CGPoint(x: floor.x + (top.x - floor.x) * up, y: floor.y + (top.y - floor.y) * up)
                    } else {
                        // Both hands; the right alone through a layup or a tip.
                        let one = player.actions.contains { ($0.kind == .layup || $0.kind == .hook) && abs(t - $0.at) < 0.4 } ? 1.0 : 0
                        let grip = figure.grip, right = figure.hands.1
                        hand = CGPoint(x: grip.x + (right.x - grip.x) * one, y: grip.y + (right.y - grip.y) * one)
                    }
                    let loose = h.point(spot)
                    ball = CGPoint(x: loose.x + (hand.x - loose.x) * held, y: loose.y + (hand.y - loose.y) * held)
                }
                return Posed(index: index, figure: figure, ball: ball)
            }
    }

    private func drawShadows(_ context: inout GraphicsContext, _ h: HoopProjection, _ figures: [Posed]) {
        // Under the hips; smaller and fainter as he leaves the floor.
        let w = h.figure * 0.26
        for p in figures {
            let air = min(p.figure.air / 0.35, 1)
            let seen = script.players[p.index].opacity(at: t)
            TheaterDraw.shadow(at: p.figure.ground, radius: w * (1 - 0.35 * air), color: ink.shadow.opacity((1 - 0.5 * air) * seen), in: context)
        }
        // The ball's: larger and softer the higher it flies.
        if let ball = script.ball(at: t), ball.z > 0.6, script.flight(at: t) != nil {
            let g = h.point(ball.ground)
            let spread = 1 + min(ball.z / 30, 0.9)
            let r = max(0.45 * h.scale, 1.4) * spread
            context.fill(Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r / 2, width: 2 * r, height: r)),
                         with: .color(ink.shadow.opacity(min(1.4 / (1 + ball.z / 14), 0.9))))
        }
    }

    private func drawPlayers(_ context: inout GraphicsContext, _ h: HoopProjection, _ figures: [Posed]) {
        let offense = FigureInks(teams.offense, ink: ink, in: context), defense = FigureInks(teams.defense, ink: ink, in: context)
        // The referee, only when one comes in to make a call: gray, a black cap.
        let official = script.players.contains { $0.team == .official } ? FigureInks(BasketballTeams.official, ink: ink, in: context) : offense
        for p in figures {
            let player = script.players[p.index]
            let inks = switch player.team {
            case .offense: offense
            case .defense: defense
            case .official: official
            }
            TheaterDraw.figure(p.figure, inks: inks, height: h.figure, opacity: player.opacity(at: t), in: context)
        }
    }

    /// The body at t, and its heading: what he's doing with the ball (a pass,
    /// the shot, the layup, the dunk, a block, a box-out) over how he's
    /// moving (striding to his planted feet), over how he stands (ready off
    /// the ball, low on defense, at ease once the ball's through); and off
    /// the floor when he jumps. `unit`: body units to the foot. (tested)
    func pose(_ player: BasketballScript.Player, _ index: Int, at here: CGPoint, unit: Double) -> (RigPose, Double) {
        let track = index < script.rig.count ? script.rig[index] : RigTrack(at: here)
        let m = track.motion(at: t)
        func envelope(_ x: Double, attack: Double, release: Double) -> Double {
            x < 0 ? max(1 + x / attack, 0) : max(1 - x / release, 0)
        }
        func smooth(_ u: Double) -> Double { Rig.smooth(u) }
        // How he stands: ready, or down in his stance on defense; at ease a beat after the ball's through.
        let ease = script.score.map { smooth((t - $0 - 0.7) / 0.5) } ?? 0
        let stance = player.team == .defense ? HoopPose.guarding : player.team == .official ? .stand : HoopPose.ready
        let still = stance.mix(.stand, ease)
        let feet = track.feet(at: t, anchor: here, heading: m.heading, unit: unit, speed: m.speed, stand: (still.left, still.right))
        var body = still.mix(.gait(m, feet: feet), m.weight)

        // With the ball: in both hands at the chest, or on the dribble.
        if let carry = script.carrier(at: t), carry.player == index {
            let held = smooth((t - carry.from) / 0.12) * (carry.until.isFinite ? smooth((carry.until - t) / 0.1) : 1)
            if carry.dribbling {
                let leg = script.legs.last { t >= $0.from }
                body = body.over(HoopPose.dribble(BasketballScript.bounce(t - (leg?.from ?? 0))), held, moving: 1)
            } else {
                body = body.over(HoopPose.hold, held, moving: 1)
            }
        }

        for action in player.actions {
            let x = t - action.at
            switch action.kind {
            case .shoot:
                guard x > -0.5, x < 1.1, let shot = RigPose.keyed([(-0.55, HoopPose.hold), (-0.26, HoopPose.dip), (-0.08, HoopPose.set),
                                                                    (0.04, HoopPose.release), (0.45, HoopPose.follow), (0.75, HoopPose.follow),
                                                                    (1.1, still)], at: x) else { continue }
                body = body.over(shot, smooth((x + 0.55) / 0.12), moving: m.weight)
            case .layup:
                guard x > -0.45, x < 0.8, let shot = RigPose.keyed([(-0.5, HoopPose.hold), (-0.2, HoopPose.gather), (0, HoopPose.layup),
                                                                    (0.3, HoopPose.layup), (0.8, still)], at: x) else { continue }
                body = body.over(shot, smooth((x + 0.5) / 0.12), moving: m.weight)
            case .dunk:
                guard x > -0.5, x < 0.9, let shot = RigPose.keyed([(-0.55, HoopPose.hold), (-0.22, HoopPose.cock), (0, HoopPose.slam),
                                                                    (0.2, HoopPose.hang), (0.45, HoopPose.hang), (0.9, still)], at: x) else { continue }
                body = body.over(shot, smooth((x + 0.55) / 0.12), moving: m.weight)
            case .hook:
                guard x > -0.5, x < 0.9, let shot = RigPose.keyed([(-0.55, HoopPose.hold), (-0.15, HoopPose.hookSet), (0.03, HoopPose.hook),
                                                                    (0.4, HoopPose.hook), (0.9, still)], at: x) else { continue }
                body = body.over(shot, smooth((x + 0.55) / 0.12), moving: m.weight)
            case .tip:
                body = body.over(HoopPose.tip, envelope(x, attack: 0.3, release: 0.4), moving: m.weight)
            case .pass:
                guard x > -0.3, x < 0.4, let throwing = RigPose.keyed([(-0.32, HoopPose.hold), (-0.06, HoopPose.hold), (0.07, HoopPose.pass),
                                                                        (0.4, HoopPose.pass)], at: x) else { continue }
                body = body.over(throwing, envelope(x, attack: 0.3, release: 0.4), moving: m.weight)
            case .lob:
                guard x > -0.35, x < 0.45, let throwing = RigPose.keyed([(-0.36, HoopPose.hold), (-0.1, HoopPose.set), (0.08, HoopPose.lob),
                                                                          (0.45, HoopPose.lob)], at: x) else { continue }
                body = body.over(throwing, envelope(x, attack: 0.35, release: 0.45), moving: m.weight)
            case .catchBall:
                body = body.over(HoopPose.target, envelope(x, attack: 0.28, release: 0.16), moving: m.weight)
            case .contest:
                let up = player.jumps.contains { abs($0.peak - action.at) < 0.3 && $0.height > 1.5 }
                body = body.over(up ? HoopPose.wall : HoopPose.contest, envelope(x, attack: 0.3, release: 0.45), moving: m.weight)
            case .block:
                guard x > -0.35, x < 0.5, let reach = RigPose.keyed([(-0.36, still), (-0.04, HoopPose.block), (0.1, HoopPose.swat),
                                                                      (0.5, still)], at: x) else { continue }
                body = body.over(reach, envelope(x, attack: 0.35, release: 0.5) > 0 ? 1 : 0, moving: m.weight)
            case .steal:
                body = body.over(HoopPose.steal, envelope(x, attack: 0.22, release: 0.3), moving: m.weight * 0.5)
            case .rebound:
                body = body.over(.catchHigh, envelope(x, attack: 0.25, release: 0.35), moving: m.weight)
            case .boxOut:
                guard x > -0.2, t < script.settle || script.formation == .lane else { continue }
                body = body.over(HoopPose.boxOut, smooth((x + 0.2) / 0.25) * (1 - ease), moving: m.weight * 0.6)
            case .reach:
                body = body.over(HoopPose.reach, envelope(x, attack: 0.22, release: 0.55), moving: m.weight * 0.6)
            case .fall:
                // Down, and stays down while the call's made.
                guard x > -0.02 else { continue }
                body = body.over(HoopPose.fallen, smooth(x / 0.35), moving: 0)
            case .signal, .point:
                body = body.over(action.kind == .signal ? HoopPose.signal : HoopPose.point, envelope(x, attack: 0.15, release: 1.3), moving: m.weight)
            case .toss:
                body = body.over(HoopPose.wall, envelope(x, attack: 0.3, release: 0.45), moving: m.weight)
            case .hips:
                // Until he moves again.
                guard x > -0.3 else { continue }
                body = body.over(HoopPose.hips, smooth((x + 0.3) / 0.3) * (1 - min(m.weight * 2, 1)), moving: m.weight)
            }
        }

        // Off the floor: a crouch into it, the legs under him in the air (a
        // layup's knee up, a dunk's tuck: the action's pose keeps its legs),
        // the landing taken in the knees.
        if let jump = player.jump(at: t) {
            let lift = jump.lift(at: t)
            let crouch = 0.07 * max(envelope(t - jump.from, attack: 0.18, release: 0.03), envelope(t - jump.until, attack: 0.01, release: 0.22))
            let up = smooth(lift / 0.35)
            let action = player.actions.contains { [.layup, .dunk].contains($0.kind) && t > $0.at - 0.6 && t < $0.at + 0.6 }
            if !action {
                body.left = body.left + (HoopPose.air.left - body.left) * up
                body.right = body.right + (HoopPose.air.right - body.right) * up
            }
            let raise = lift * Hoops.lift
            body.hip.z += raise - crouch
            body.left.z += raise
            body.right.z += raise
        }
        return (body, m.heading)
    }

    // MARK: Ball

    /// Where the ball is drawn: in his hands, or along its flight; and
    /// whether it's inside the hoop (then the rim's front and the net go over it).
    private func ballPoint(_ h: HoopProjection, _ figures: [Posed]) -> (point: CGPoint, inHoop: Bool)? {
        guard let ball = script.ball(at: t) else { return nil }
        if let held = figures.lazy.compactMap(\.ball).first { return (held, false) }
        let inHoop = hypot(ball.x - Hoops.rim.x, ball.y - Hoops.rim.y) < 1.1 && ball.z < Hoops.rimHeight + 0.25 && ball.z > Hoops.rimHeight - 2.6
        return (h.point(ball), inHoop)
    }

    /// The basketball: a glowing core with its comet tail while it flies.
    private func drawBall(_ context: inout GraphicsContext, _ h: HoopProjection, at p: CGPoint) {
        // A touch larger than life: it's what the eye follows.
        let r = min(max(0.5 * h.scale, 2.1), max(h.figure * 0.09, 2.1))
        if let flight = script.flight(at: t) {
            let trail = (1...6).map { h.point(flight.point(at: max(t - Double($0) * 0.014, flight.start))) }
            TheaterDraw.trail(trail, from: p, radius: r * 0.8, color: ink.leather, in: context)
            TheaterDraw.glow(at: p, radius: r, color: ink.glow, in: context)
        } else if t < script.settle {
            TheaterDraw.glow(at: p, radius: r * 0.8, color: ink.glow.opacity(0.6), in: context)
        }
        let rect = CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)
        context.fill(Path(ellipseIn: rect.insetBy(dx: -0.6, dy: -0.6)), with: .color(ink.ballEdge))
        context.fill(Path(ellipseIn: rect), with: .color(ink.leather))
        if r > 2.8 {
            // The seams.
            var seams = Path()
            seams.move(to: CGPoint(x: p.x - r, y: p.y))
            seams.addLine(to: CGPoint(x: p.x + r, y: p.y))
            seams.addEllipse(in: rect.insetBy(dx: r * 0.42, dy: 0))
            context.stroke(seams, with: .color(.black.opacity(0.4)), lineWidth: max(r * 0.12, 0.5))
        }
    }

    // MARK: Beats

    private func drawFlashes(_ context: inout GraphicsContext, _ h: HoopProjection) {
        let unit = h.figure / 10
        for flash in script.flashes {
            let age = t - flash.at
            let c = h.point(flash.point)
            switch flash.beat {
            case .catchBall:
                guard age >= 0, age < 0.28 else { continue }
                let u = age / 0.28
                let r = (1 + 2.8 * (1 - pow(1 - u, 3))) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                               with: .color(ink.trace.opacity(0.7 * (1 - u))), lineWidth: max(unit * 0.18, 0.8))
            case .block:
                // Swatted: sparks off his hand.
                guard age >= 0, age < 0.32 else { continue }
                let u = age / 0.32
                var rays = Path()
                for i in 0..<6 {
                    let a = Double(i) / 6 * 2 * .pi - 0.3
                    rays.move(to: CGPoint(x: c.x + cos(a) * (1 + 2 * u) * unit, y: c.y + sin(a) * (1 + 2 * u) * unit))
                    rays.addLine(to: CGPoint(x: c.x + cos(a) * (2.4 + 5 * u) * unit, y: c.y + sin(a) * (2.4 + 5 * u) * unit))
                }
                context.stroke(rays, with: .color(ink.trace.opacity(0.9 * (1 - u))), style: StrokeStyle(lineWidth: max(unit * 0.22, 1), lineCap: .round))
            case .steal:
                guard age >= 0, age < 0.5 else { continue }
                let u = age / 0.5
                let g = h.point(flash.point.ground)
                let r = (2 + 7 * Motion.curve.value(at: u)) * unit
                context.stroke(Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r / 2, width: 2 * r, height: r)),
                               with: .color(ink.trace.opacity(0.75 * (1 - u))), lineWidth: 1.2)
            case .whistle:
                // The whistle: short ticks off the referee's head.
                guard age >= 0, age < 0.4 else { continue }
                let u = age / 0.4
                var ticks = Path()
                for i in 0..<5 {
                    let a = -.pi / 2 + (Double(i) - 2) * 0.42
                    ticks.move(to: CGPoint(x: c.x + cos(a) * (1.2 + 1.4 * u) * unit, y: c.y + sin(a) * (1.2 + 1.4 * u) * unit))
                    ticks.addLine(to: CGPoint(x: c.x + cos(a) * (2.2 + 2.4 * u) * unit, y: c.y + sin(a) * (2.2 + 2.4 * u) * unit))
                }
                context.stroke(ticks, with: .color(ink.trace.opacity(0.85 * (1 - u))), style: StrokeStyle(lineWidth: max(unit * 0.2, 0.9), lineCap: .round))
            case .horn:
                // The horn: the backboards' red edge lit, as the arena's are.
                guard age >= 0, age < 1.6 else { continue }
                let glow = (age < 0.2 ? age / 0.2 : 1) * (1 - Rig.smooth((age - 1.1) / 0.5))
                for end in [-1.0, 1.0] {
                    let board = end > 0 ? Hoops.board : Hoops.length - Hoops.board, y = Hoops.width / 2
                    var pane = Path()
                    pane.addLines([h.point(CGPoint(x: board, y: y - 3), z: Hoops.boardBottom), h.point(CGPoint(x: board, y: y + 3), z: Hoops.boardBottom),
                                   h.point(CGPoint(x: board, y: y + 3), z: Hoops.boardTop), h.point(CGPoint(x: board, y: y - 3), z: Hoops.boardTop)])
                    pane.closeSubpath()
                    context.stroke(pane, with: .color(Color.red.opacity(0.85 * glow)), lineWidth: max(h.scale * 0.35, 1.6))
                }
            case .rim:
                guard age >= 0, age < 0.25 else { continue }
                let u = age / 0.25
                let r = (0.8 + 2 * u) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r * 0.6, width: 2 * r, height: r * 1.2)),
                               with: .color(ink.hoop.opacity(0.8 * (1 - u))), lineWidth: 1)
            }
        }
    }

    // MARK: Type

    private func drawLabels(_ context: inout GraphicsContext, _ h: HoopProjection) {
        if let banner = script.banner, let symbol = context.resolveSymbol(id: Symbol.banner) {
            TheaterType.drawBanner(symbol, from: banner.at, until: banner.until, t: t, in: context, size: h.size)
        }
        if let symbol = context.resolveSymbol(id: Symbol.stamp) {
            TheaterType.drawStamp(symbol, from: script.stamp, t: t, in: context, size: h.size)
        }
    }

    private func color(_ side: GameDetail.Side?) -> Color {
        guard let side, let offense = script.side ?? scene?.offense else { return .primary }
        return side == offense ? teams.offense.accent : teams.defense.accent
    }

    /// The stamp: the points heavy in the scoring team's color (BLK in the
    /// blocker's), the tag lighter beside it, the shot and the credits in
    /// small capitals under it.
    @ViewBuilder
    private var stamp: some View {
        if let scene, script.stamp.isFinite, !BasketballStamp(scene).parts.isEmpty {
            let stamp = BasketballStamp(scene)
            let size = TheaterType.stamp(self.size)
            let tone: Color = switch stamp.tone {
            case .score: color(scene.offense)
            case .block: color(scene.defense)
            case .neutral: .primary
            }
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: size * 0.16) {
                    ForEach(Array(stamp.parts.enumerated()), id: \.offset) { _, part in
                        Text(part.text)
                            .font(part.heavy ? .system(size: size, weight: .heavy).monospacedDigit() : .system(size: size * 0.42, weight: .bold))
                            .tracking(part.heavy ? -0.5 : 0.6)
                            .foregroundStyle(part.heavy ? tone : Color.secondary)
                    }
                }
                let longest = Double(stamp.lines.map(\.count).max() ?? 1)
                ForEach(Array(stamp.lines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.system(size: max(min(TheaterType.title(self.size), self.size.width * 0.44 / (longest * 0.66)), 6.5), weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(.secondary)
                }
            }
            .fixedSize()
        }
    }

    @ViewBuilder
    private var banner: some View {
        if let banner = script.banner {
            let color: Color = switch banner.tone {
            case let .side(side): color(side)
            case .gold: ink.gold
            }
            TheaterBanner(text: banner.text, color: color, size: TheaterType.banner(size, fitting: banner.text))
        }
    }
}

// MARK: - Theater

/// The basketball theater over the shot chart. It reads the live lane itself
/// (and nothing above it does), so a new play redraws the theater alone.
struct BasketballTheater: View {
    let feed: BasketballFeed?
    /// What to show without a live lane (previews and the render harness).
    var preloaded: BasketballTheaterState? = nil
    /// Who has the ball between plays when there's no lane.
    var restOffense: GameDetail.Side? = nil
    let palette: TeamPalette
    /// The teams' own and second colors, so the players always contrast.
    var kits: TheaterKits? = nil
    var topIsHome = false
    var topName = ""
    var bottomName = ""
    /// The teams as a tag names them ("SPURS BALL"), when not their codes.
    var topTeam = ""
    var bottomTeam = ""
    /// The game: the court's turn is remembered for it.
    var eventID = ""
    /// The period without a lane (the ends swap at halftime).
    var period: Int? = nil

    var body: some View {
        BasketballStage(state: feed?.theater ?? preloaded ?? BasketballTheaterState(), possession: feed?.possession ?? restOffense,
                        period: feed?.period ?? period, live: feed?.playing ?? false, palette: palette, kits: kits, topIsHome: topIsHome,
                        homeName: topIsHome ? topName : bottomName,
                        names: (topTeam.isEmpty ? topName : topTeam, bottomTeam.isEmpty ? bottomName : bottomTeam), eventID: eventID,
                        onReplay: { feed?.replay($0) })
    }
}

/// The theater's stage: whatever is being told (a replay, a beat), or the
/// court between plays, through the camera; a TimelineView only while
/// something moves (a replay, a beat, the opening and the sparse beats of
/// the court between plays), the frame still in between. The broadcast tag
/// at the top, the heartbeat at the bottom, the court's turn on hover.
private struct BasketballStage: View {
    let state: BasketballTheaterState
    let possession: GameDetail.Side?
    let period: Int?
    let live: Bool
    let palette: TeamPalette
    let kits: TheaterKits?
    let topIsHome: Bool
    let homeName: String
    let names: (top: String, bottom: String)
    let eventID: String
    /// A replay starts (its play), or something else does (nil).
    let onReplay: (String?) -> Void
    @AppStorage private var flipped: Bool
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    /// What's being told, from when.
    @State private var showing: Showing?
    /// The court between plays, from when.
    @State private var resting: Resting?
    /// What's been told (or passed over), the last of it, and the stoppage it left.
    @State private var told = Told()
    /// One of the court's sparse beats is moving.
    @State private var animating = false
    @State private var hovering = false
    /// The scripts on screen, built once (a body run for anything else reuses them).
    @State private var built = BasketballScripts()

    init(state: BasketballTheaterState, possession: GameDetail.Side?, period: Int?, live: Bool, palette: TeamPalette, kits: TheaterKits?,
         topIsHome: Bool, homeName: String, names: (top: String, bottom: String), eventID: String, onReplay: @escaping (String?) -> Void) {
        self.state = state
        self.possession = possession
        self.period = period
        self.live = live
        self.palette = palette
        self.kits = kits
        self.topIsHome = topIsHome
        self.homeName = homeName
        self.names = names
        self.eventID = eventID
        self.onReplay = onReplay
        _flipped = AppStorage(wrappedValue: false, TheaterOrientation.key(eventID))
    }

    struct Showing: Equatable {
        let unit: BasketballQueue.Unit
        /// Where the court stood as it began (nil: a replay's own set).
        let from: Lineup?
        let fallback: GameDetail.Side?
        let start: Date
        var done = false
    }

    struct Resting: Equatable {
        let rest: BasketballScript.Rest
        let start: Date
    }

    struct Told: Equatable {
        var cursor: String?
        var ids = Set<String>()
        /// The last play told that wasn't a substitution: the stoppage the tag keeps saying.
        var context: BasketballScene?
        /// The court before the last thing told.
        var rest: BasketballScript.Rest?
    }

    /// Half as tall as wide, up to this.
    static let maxHeight: CGFloat = 320

    // MARK: What's on screen

    /// The ends for a period (the turn included).
    private func ends(_ period: Int?) -> HoopsEnds { HoopsEnds(period: period ?? self.period, topIsHome: topIsHome, flipped: flipped) }

    /// On the harness's frozen clock: the first news there is, else the court the plays left.
    private var frozenUnit: BasketballQueue.Unit? { BasketballQueue.next(after: nil, told: [], in: state) }

    private var historyRest: BasketballScript.Rest {
        BasketballFlow.rest(after: state.plays.last { $0.kind != .substitution }, previous: nil, from: nil,
                            ends: ends(state.plays.last?.period), possession: possession)
    }

    private func script(_ showing: Showing) -> BasketballScript {
        built.unit(showing.unit, from: showing.from, ends: ends(showing.unit.scene.period), fallback: showing.fallback)
    }

    private func script(_ resting: Resting) -> BasketballScript {
        var rest = resting.rest
        rest.ends = ends(restPeriod)
        return built.rest(rest)
    }

    private var restPeriod: Int? { told.context?.period ?? state.plays.last?.period ?? period }

    private func teams(_ offense: GameDetail.Side) -> BasketballTeams {
        let dressed: (top: Uniform, bottom: Uniform)
        if let kits {
            let d = TheaterTeams.dress(kits, scheme: scheme)
            dressed = (d.top, d.bottom)
        } else {
            dressed = (Uniform(TheaterTeams.solid(palette.top, scheme)), Uniform(TheaterTeams.solid(palette.bottom, scheme)))
        }
        return offense == .top ? BasketballTeams(offense: dressed.top, defense: dressed.bottom)
            : BasketballTeams(offense: dressed.bottom, defense: dressed.top)
    }

    /// The paint in the home team's color, its name at center court.
    private var paint: HoopsCourtLayer.Paint {
        HoopsCourtLayer.Paint(color: TheaterTeams.solid(topIsHome ? palette.top : palette.bottom, scheme), name: homeName.uppercased())
    }

    private func tint(_ side: GameDetail.Side?) -> String? {
        guard let side else { return nil }
        return side == .top ? kits?.top.color : kits?.bottom.color
    }

    private struct Now {
        var script: BasketballScript
        var scene: BasketballScene?
        var unit: BasketballQueue.Unit?
        var start: Date?
        var moving: Bool
        var key: String
    }

    private func current(_ date: Date) -> Now {
        if case .frozen = clock {
            if let unit = frozenUnit {
                let s = built.unit(unit, from: nil, ends: ends(unit.scene.period), fallback: possession)
                return Now(script: s, scene: unit.scene, unit: unit, start: nil, moving: false, key: unit.scene.id)
            }
            var rest = historyRest
            rest.ends = ends(state.plays.last?.period)
            return Now(script: built.rest(rest), scene: nil, unit: nil, start: nil, moving: false, key: "rest")
        }
        if let showing {
            let s = script(showing)
            return Now(script: s, scene: showing.unit.scene, unit: showing.unit, start: showing.start, moving: !showing.done && !reduceMotion,
                       key: showing.unit.scene.id)
        }
        let resting = resting ?? Resting(rest: historyRest, start: date)
        return Now(script: script(resting), scene: nil, unit: nil, start: resting.start, moving: animating && !reduceMotion,
                   key: "rest-\(resting.rest.seed)-\(resting.rest.round)")
    }

    /// Seconds into what's on screen.
    private func time(_ now: Now, at date: Date) -> Double {
        if case let .frozen(t) = clock { return t }
        guard let start = now.start else { return now.unit == nil ? 0 : .infinity }
        if let showing, showing.done { return .infinity }
        if now.unit == nil, reduceMotion { return now.script.active.first?.upperBound ?? 0 }
        return max(date.timeIntervalSince(start), 0)
    }

    private func status(_ now: Now, t: Double) -> TheaterStatus {
        let said: (text: String, side: GameDetail.Side?)?
        if let unit = now.unit {
            said = BasketballStatus.during(unit: unit, script: now.script, t: t, names: names)
        } else {
            let context = told.context ?? state.plays.last { $0.kind != .substitution }
            said = BasketballStatus.between(context: context, rest: resting?.rest ?? historyRest, names: names)
        }
        return TheaterStatus(tag: said?.text, tint: tint(said?.side), updated: state.heard)
    }

    var body: some View {
        let now = current(.now)
        let ink = TheaterInk(scheme)
        let teams = teams(now.script.side ?? .top), paint = paint
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Group {
                    if now.moving {
                        TimelineView(.animation) { context in
                            picture(now, t: time(now, at: context.date), teams: teams, ink: ink, size: geo.size, paint: paint)
                        }
                    } else {
                        picture(now, t: time(now, at: .now), teams: teams, ink: ink, size: geo.size, paint: paint)
                    }
                }
                // A replay cuts in; anything else crossfades (the same floor from the same side: no change at all).
                .id(now.key)
                .transition(now.unit?.marquee == true ? .identity : .opacity.animation(.easeInOut(duration: 0.28)))
                .accessibilityHidden(true)
                if let unit = now.unit, unit.marquee {
                    BasketballCelebrationStage(play: unit.scene, script: now.script, size: geo.size, colors: (teams.offense.accent, teams.defense.accent),
                                               start: now.start)
                        .id(unit.scene.id)
                        .accessibilityHidden(true)
                }
                if live || clock != .live {
                    TheaterHeartbeat(updated: state.heard, source: "ESPN")
                        .padding(7)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                }
                TheaterFlipButton(eventID: eventID, surface: "court")
                    .padding(7)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .opacity(hovering ? 1 : 0)
                    .animation(Motion.fade, value: hovering)
            }
        }
        // The well spans the column, so its edges line up with the court under it.
        .modifier(HoopsWellHeight(cap: Self.maxHeight))
        .vizWell(padding: 0)
        .onHover { hovering = $0 }
        .onAppear { advance() }
        .onChange(of: state) { _, _ in if showing == nil { advance() } }
        .task(id: showing) { await finish() }
        .task(id: resting) { await breathe() }
    }

    /// One frame and its tag.
    private func picture(_ now: Now, t: Double, teams: BasketballTeams, ink: TheaterInk, size: CGSize, paint: HoopsCourtLayer.Paint) -> some View {
        ZStack(alignment: .topLeading) {
            BasketballFrame(scene: now.scene, script: now.script, t: t, teams: teams, ink: ink, size: size, paint: paint)
                .equatable()
            TheaterStatusTag(status: status(now, t: t), height: size.height)
                .padding(.top, 8)
        }
    }

    // MARK: The running order

    /// Where everyone is now on screen: what the next beat starts from.
    private func lineup(at date: Date) -> Lineup? {
        if let showing {
            let s = script(showing)
            return s.lineup(at: min(date.timeIntervalSince(showing.start), s.duration))
        }
        if let resting { return script(resting).lineup(at: date.timeIntervalSince(resting.start)) }
        return nil
    }

    /// The next thing to tell, or the court the last one left.
    private func advance(at date: Date = .now) {
        guard clock == .live else { return }
        let from = lineup(at: date)
        animating = false
        if let unit = BasketballQueue.next(after: told.cursor, told: told.ids, in: state) {
            told.cursor = unit.scene.id
            told.ids.formUnion([unit.scene.id] + unit.covers)
            if told.ids.count > 400 { told.ids = Set(state.plays.map(\.id)).intersection(told.ids) }
            if unit.scene.kind != .substitution { told.context = unit.scene }
            if let resting { told.rest = resting.rest }
            let fallback = resting?.rest.offense ?? showing.map { script($0).side } ?? possession
            showing = Showing(unit: unit, from: unit.marquee ? nil : from, fallback: fallback, start: date, done: reduceMotion)
            resting = nil
            onReplay(unit.marquee ? unit.scene.id : nil)
            return
        }
        guard showing != nil || resting == nil else { return }
        let last = showing?.unit.scene ?? state.plays.last { $0.kind != .substitution }
        let previous = told.rest
        resting = Resting(rest: BasketballFlow.rest(after: last, previous: previous, from: from, ends: ends(last?.period), possession: possession),
                          start: date)
        showing = nil
    }

    /// While something's told: wait out its length (and a beat to read its
    /// stamp), then the next.
    private func finish() async {
        guard let showing, clock == .live else { return }
        let s = script(showing)
        // The court it leaves, built off the main thread while it plays (its rig
        // and camera take longer than a frame); taken as is if nothing comes next.
        var next = BasketballFlow.rest(after: showing.unit.scene, previous: told.rest, from: s.lineup(at: s.duration),
                                       ends: ends(showing.unit.scene.period), possession: possession)
        next.ends = ends(restPeriod)
        if !built.has(next) {
            let key = next
            let prebuilt = await Task.detached(priority: .utility) { BasketballScript(rest: key) }.value
            guard !Task.isCancelled, self.showing == showing else { return }
            built.keep(key, prebuilt)
        }
        let pending = BasketballQueue.next(after: told.cursor, told: told.ids, in: state) != nil
        let read = showing.unit.marquee ? (pending ? 0.9 : 1.6) : (pending ? 0.2 : 0.45)
        let length = reduceMotion ? min(s.duration, 2.4) : s.duration
        let wait = length + read - Date.now.timeIntervalSince(showing.start)
        if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
        guard !Task.isCancelled, self.showing == showing else { return }
        advance()
    }

    /// The court between plays: each of its sparse beats runs (a
    /// TimelineView only while one does), still in between; when it runs
    /// out, it goes on as a new one from where it stands.
    private func breathe() async {
        guard let resting, clock == .live, !reduceMotion else { return }
        let s = script(resting)
        for window in s.active {
            let begin = resting.start.addingTimeInterval(window.lowerBound).timeIntervalSinceNow
            if begin > 0 { try? await Task.sleep(for: .seconds(begin)) }
            guard !Task.isCancelled, self.resting == resting else { return }
            let end = resting.start.addingTimeInterval(window.upperBound).timeIntervalSinceNow
            guard end > 0 else { continue }
            animating = true
            try? await Task.sleep(for: .seconds(end))
            guard !Task.isCancelled, self.resting == resting else { return }
            animating = false
        }
        guard s.duration >= BasketballScript.Builder.restLength else { return }
        let over = resting.start.addingTimeInterval(s.duration).timeIntervalSinceNow
        if over > 0 { try? await Task.sleep(for: .seconds(over)) }
        guard !Task.isCancelled, self.resting == resting else { return }
        var next = resting.rest
        next.from = s.lineup(at: s.duration)
        next.round += 1
        if case .inbound = next.phase { next.phase = .live }
        self.resting = Resting(rest: next, start: .now)
    }
}

/// The scripts on screen, and the court between plays. A reference, so
/// keeping them isn't a change anything observes: building one (its rig
/// tracks and camera) takes a millisecond or a few, and a body run that
/// isn't about a new play shouldn't.
private final class BasketballScripts {
    private struct UnitKey: Equatable {
        let unit: BasketballQueue.Unit
        let from: Lineup?
        let ends: HoopsEnds
        let fallback: GameDetail.Side?
    }

    private var unitKey: UnitKey?
    private var unitScript: BasketballScript?
    private var restKey: BasketballScript.Rest?
    private var restScript: BasketballScript?

    func unit(_ unit: BasketballQueue.Unit, from: Lineup?, ends: HoopsEnds, fallback: GameDetail.Side?) -> BasketballScript {
        let key = UnitKey(unit: unit, from: from, ends: ends, fallback: fallback)
        if key != unitKey || unitScript == nil {
            unitKey = key
            unitScript = unit.marquee ? BasketballScript(unit.scene, right: ends.right(unit.scene.offense))
                : BasketballScript(beat: unit.scene, group: unit.group, ends: ends, from: from, fallback: fallback)
        }
        return unitScript!
    }

    func has(_ rest: BasketballScript.Rest) -> Bool { rest == restKey && restScript != nil }

    /// A court between plays built ahead (off the main thread).
    func keep(_ rest: BasketballScript.Rest, _ script: BasketballScript) {
        restKey = rest
        restScript = script
    }

    func rest(_ rest: BasketballScript.Rest) -> BasketballScript {
        if rest != restKey || restScript == nil {
            restKey = rest
            restScript = BasketballScript(rest: rest)
        }
        return restScript!
    }
}

private struct HoopsWellHeight: ViewModifier {
    let cap: CGFloat

    func body(content: Content) -> some View {
        TheaterWell(cap: cap) { content }
    }
}

// MARK: - Celebration

/// One celebration per moment, and the theater owns its plays' when the page
/// shows it (the shot chart keeps its marks and its shot story, and bursts
/// nothing): a three's sparks at the rim as it drops, a clutch basket's, a
/// hot hand's embers, a buzzer-beater's confetti off its banner (gold when it
/// tied or won it). The net, the rim and the banner are the rest: a two, a
/// dunk, a block get no particles. Every burst goes through the page's
/// rules (`Celebration.cue`): the celebration level, Reduce Motion, and one
/// particle burst every 10 s. (pure; tested)
enum BasketballCelebration {
    /// The shot chart bursts only when there's no theater to.
    static func courtBursts(theaterShown: Bool) -> Bool { !theaterShown }

    /// A burst on the theater's stage.
    struct Burst: Equatable {
        enum Anchor: Equatable {
            /// A point on the court: it moves with the camera.
            case court(FieldPoint)
            /// Under the headline.
            case banner
        }
        var cue: CelebrationCue
        /// Script time it mounts (its cue's own delay comes after).
        var at: Double
        var anchor: Anchor
        var scale: Double
        var side: GameDetail.Side?

        var end: Double { at + cue.duration }
    }

    /// The theater's bursts for this play's moment, in script time. Nothing
    /// for another play's moment, or when the level is Off.
    static func theater(_ moment: LiveMoment?, play: BasketballScene, script: BasketballScript, level: CelebrationLevel,
                        reduceMotion: Bool, height: CGFloat) -> [Burst] {
        guard let moment, moment.id == play.id, moment.chart == .court, play.made, let at = script.score else { return [] }
        let scale = TheaterBurst.scale(height)
        func cue(_ effects: [CelebrationCue.Effect]) -> CelebrationCue? {
            guard !effects.isEmpty else { return nil }
            var cue = Celebration.cue(for: moment, level: level, reduceMotion: reduceMotion, geometry: .init(height: height),
                                      direction: .degrees(90), effects: effects)
            if moment.decisive || play.decisive { cue?.gold = true }
            return cue
        }
        var bursts: [Burst] = []
        // At the rim: a three's sparks, a clutch two's; a hot hand's embers.
        var rim: [CelebrationCue.Effect] = []
        if play.value >= 3 { rim.append(.sparks(rays: 6, length: 13)) } else if moment.accents.contains(.clutch) { rim.append(.sparks(rays: 4, length: 13)) }
        if moment.accents.contains(.onFire) { rim.append(.embers) }
        if let sparks = cue(rim) {
            bursts.append(Burst(cue: sparks, at: at - sparks.delay, anchor: .court(FieldPoint(x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight)),
                                scale: scale * 0.7, side: play.offense))
        }
        // The buzzer-beater's banner brings its confetti (only ever confetti: Subtle, the cooldown and Reduce Motion leave the banner alone).
        if let banner = script.banner, banner.confetti,
           let confetti = cue([.confetti(direction: .degrees(90), spread: .degrees(play.decisive ? 170 : 150), preset: .medium)]),
           confetti.effects.contains(where: { if case .confetti = $0 { return true }; return false }) {
            bursts.append(Burst(cue: confetti, at: banner.at + 0.1 - confetti.delay, anchor: .banner, scale: scale * (play.decisive ? 0.85 : 0.7),
                                side: play.offense))
        }
        return bursts
    }
}

/// The theater's bursts, drawn through the camera so they stay at the rim as
/// it moves. A TimelineView only while one plays; on the harness's frozen
/// clock, the frame at t. With Reduce Motion there's no replay: a basket
/// that celebrates blooms at the rim, as the play's end shows.
private struct BasketballCelebrationStage: View {
    let play: BasketballScene
    let script: BasketballScript
    let size: CGSize
    let colors: (offense: Color, defense: Color)
    let start: Date?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var live: Date?
    @State private var over: Date?
    /// The play's moment, kept once it lands: the page's slot may move on
    /// before the ball reaches the net.
    @State private var latched: LiveMoment?

    var body: some View {
        let current = momentFor(.court, in: moments)
        let moment = latched ?? (current?.id == play.id ? current : nil)
        let bursts = BasketballCelebration.theater(moment, play: play, script: script, level: level, reduceMotion: reduceMotion, height: size.height)
        Group {
            switch clock {
            case let .frozen(t):
                if bursts.contains(where: { t >= $0.at && t <= $0.end }) { surface(bursts, at: t) }
            case .live:
                if reduceMotion {
                    if !bursts.isEmpty, let moment {
                        CelebrationStage(moment: moment,
                                         origin: HoopProjection(size: size, camera: script.camera.rest, yaw: script.yaw)
                                             .point(FieldPoint(x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight)),
                                         size: size, colors: .team(colors.offense), wellInset: 0)
                    }
                } else if let start, live == start, over != start {
                    TimelineView(.animation) { context in surface(bursts, at: context.date.timeIntervalSince(start)) }
                }
            }
        }
        .onChange(of: current?.id, initial: true) { _, _ in
            if latched == nil, let current, current.id == play.id { latched = current }
        }
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

    private func surface(_ bursts: [BasketballCelebration.Burst], at t: Double) -> some View {
        Canvas { context, size in
            let h = HoopProjection(size: size, camera: script.camera.frame(at: t), yaw: script.yaw)
            context.clip(to: h.bounds)
            for burst in bursts where t >= burst.at && t <= burst.end {
                let origin = switch burst.anchor {
                case let .court(p): TheaterBurst.inside(h.point(p), size)
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
