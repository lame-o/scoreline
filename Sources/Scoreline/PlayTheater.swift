import SwiftUI

// The play theater: under the diamond and the count, the last play replayed
// on a small isometric field as it arrives from the live lane. The pitch
// with its type and speed, the swing, the ball's flight by ESPN's
// trajectory (its height read through its shadow), the fielder the scorer
// named running it down, the throws in scorer's order, the runners to where
// the play left them, then the scorer's mark. The footer under it (the
// diamond's last play) is its caption.
//
// Drawn in two Canvases: the field, which never redraws while a play runs,
// and the figures and ball, which do. A TimelineView exists only while a
// replay runs; between plays the scene is static. Plays already on the page
// when it opened show as they ended; a new one mid-replay cuts to itself;
// with Reduce Motion each play crossfades to how it ended. Decorative for
// VoiceOver: the caption carries the play.

/// The dimetric (2:1) view of the field from behind home plate: the ground
/// squashed to half height, heights at 0.82. Fits fair territory, foul pole
/// to foul pole, with the catcher below the plate.
struct FieldProjection {
    let size: CGSize
    /// Points per foot.
    let scale: CGFloat
    let home: CGPoint
    /// Figures, the ball and type grow with the field, but slower.
    let k: CGFloat

    init(size: CGSize) {
        self.size = size
        scale = max(min((size.width - 16) / 466, (size.height - 24) / 214), 0.1)
        k = min(max(0.84 + scale * 0.5, 1.12), 1.75)
        let used = 208 * scale + 12 * k
        home = CGPoint(x: size.width / 2, y: size.height - max(size.height - used, 0) / 2 - 12 * k)
    }

    func point(_ p: CGPoint, z: Double = 0) -> CGPoint {
        CGPoint(x: home.x + p.x * scale, y: home.y - (p.y * 0.5 + z * 0.82) * scale)
    }

    func point(_ p: FieldPoint) -> CGPoint { point(p.ground, z: p.z) }
}

/// The theater's colors. The field is tinted, not painted: grass and clay
/// at low strength, so team colors carry the figures, in either appearance.
struct TheaterInk: Equatable {
    let grass: Color
    let infield: Color
    let dirt: Color
    let chalk: Color
    let wall: Color
    let wallTop: Color
    let shadow: Color
    /// The rim that separates a figure from the lines under it.
    let halo: Color
    let ball: Color
    let ballEdge: Color
    let trace: Color
    /// The lighter stripes of the mowing.
    let mow: Color

    init(_ scheme: ColorScheme) {
        let dark = scheme == .dark
        grass = Color(hue: 0.36, saturation: dark ? 0.42 : 0.38, brightness: dark ? 0.62 : 0.6).opacity(dark ? 0.2 : 0.2)
        infield = Color(hue: 0.36, saturation: dark ? 0.42 : 0.38, brightness: dark ? 0.66 : 0.62).opacity(dark ? 0.26 : 0.26)
        dirt = Color(hue: 0.075, saturation: dark ? 0.38 : 0.42, brightness: dark ? 0.82 : 0.78).opacity(dark ? 0.22 : 0.3)
        chalk = dark ? Color.white.opacity(0.55) : Color.white.opacity(0.95)
        wall = Color.primary.opacity(dark ? 0.1 : 0.07)
        wallTop = Color.primary.opacity(dark ? 0.3 : 0.22)
        shadow = Color.black.opacity(dark ? 0.42 : 0.16)
        halo = dark ? Color.black.opacity(0.5) : Color.white.opacity(0.9)
        ball = .white
        ballEdge = dark ? Color.black.opacity(0.35) : Color.black.opacity(0.45)
        trace = dark ? Color.white : Color.primary
        mow = dark ? Color.white.opacity(0.014) : Color.white.opacity(0.11)
    }
}

// MARK: - Field

/// The field itself: grass, the infield's clay and grass, the mound, the
/// foul lines and bases, the warning track and the wall with its poles.
/// Equatable: redrawn for a new size or appearance, never for a pitch.
struct BallparkLayer: View, Equatable {
    let ink: TheaterInk

    var body: some View {
        Canvas { context, size in
            let f = FieldProjection(size: size)
            func polygon(_ points: [CGPoint]) -> Path {
                var path = Path()
                path.addLines(points.map { f.point($0) })
                path.closeSubpath()
                return path
            }
            func circle(_ center: CGPoint, _ r: Double) -> Path {
                let c = f.point(center)
                return Path(ellipseIn: CGRect(x: c.x - r * f.scale, y: c.y - r * f.scale / 2, width: 2 * r * f.scale, height: r * f.scale))
            }
            let steps = 48
            let bearings = (0...steps).map { -Double.pi / 4 + Double($0) / Double(steps) * .pi / 2 }
            func fenceLine(inset: Double) -> [CGPoint] {
                bearings.map { Ballpark.polar(Ballpark.fence($0) - inset, $0 * 180 / .pi) }
            }

            // The infield's clay reaches 95 ft round the rubber, between the lines.
            let c = Ballpark.rubber, r = Ballpark.skin
            let along = c.y / 2.squareRoot()
            let t = along + (along * along - (c.y * c.y - r * r)).squareRoot()
            let corner = t / 2.squareRoot()
            let from = atan2(corner - c.y, corner), to = Double.pi - from
            let arc = (0...32).map { i -> CGPoint in
                let a = from + Double(i) / 32 * (to - from)
                return CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a))
            }
            let skin = polygon([.zero] + arc)

            // Fair territory, mowed in a checkerboard (the outfield grass only),
            // and the warning track inside the fence.
            context.fill(polygon([.zero] + fenceLine(inset: 0)), with: .color(ink.grass))
            var mowed = context
            var grass = polygon(fenceLine(inset: 15) + [.zero])
            grass.addPath(skin)
            mowed.clip(to: grass, style: FillStyle(eoFill: true))
            // Bands along each baseline, every other one lighter; where they cross, lighter still.
            let band = 26.0 * 2.squareRoot()
            for slope in [1.0, -1.0] {
                var stripes = Path()
                for i in stride(from: 0, through: 16, by: 2) {
                    let low = Double(i) * band, high = low + band
                    let corners: [CGPoint] = [CGPoint(x: -300, y: -300 * slope + low), CGPoint(x: 300, y: 300 * slope + low),
                                              CGPoint(x: 300, y: 300 * slope + high), CGPoint(x: -300, y: -300 * slope + high)]
                    stripes.addLines(corners.map { f.point($0) })
                    stripes.closeSubpath()
                }
                mowed.fill(stripes, with: .color(ink.mow))
            }
            context.fill(polygon(fenceLine(inset: 0) + fenceLine(inset: 15).reversed()), with: .color(ink.dirt.opacity(0.7)))

            context.fill(skin, with: .color(ink.dirt))
            // The infield grass, inside the base paths.
            let d = Ballpark.baseline / 2.squareRoot(), inset = 3 * 2.squareRoot()
            context.fill(polygon([CGPoint(x: 0, y: inset), CGPoint(x: d - inset, y: d), CGPoint(x: 0, y: 2 * d - inset),
                                  CGPoint(x: -(d - inset), y: d)]), with: .color(ink.infield))
            // Cutouts round the bases (inside the lines: foul ground stays the
            // well's), the circle round home, and the mound.
            var fair = context
            fair.clip(to: polygon([.zero] + fenceLine(inset: 0)))
            for base in 1...3 { fair.fill(circle(Ballpark.base(base), 11), with: .color(ink.dirt)) }
            context.fill(circle(.zero, 13), with: .color(ink.dirt))
            context.fill(circle(CGPoint(x: 0, y: 59), 9), with: .color(ink.dirt))

            // Foul lines to the poles.
            var lines = Path()
            for side in [-45.0, 45.0] {
                lines.move(to: f.point(.zero))
                lines.addLine(to: f.point(Ballpark.polar(Ballpark.fence(side * .pi / 180), side)))
            }
            context.stroke(lines, with: .color(ink.chalk), lineWidth: 0.75)
            // The batter's and catcher's boxes, where there's room to see them.
            if f.k >= 1.25 {
                var boxes = Path()
                for x in [-4.7, 0.7] { boxes.addRect(CGRect(x: x, y: -3, width: 4, height: 6)) }
                let projected = boxes.applying(CGAffineTransform(a: f.scale, b: 0, c: 0, d: -f.scale / 2, tx: f.home.x, ty: f.home.y))
                context.stroke(projected, with: .color(ink.chalk.opacity(0.6)), lineWidth: 0.5)
            }

            // The wall: its face, its top, and the poles.
            let fence = fenceLine(inset: 0)
            var face = Path()
            face.addLines(fence.map { f.point($0) } + fence.reversed().map { f.point($0, z: Ballpark.wallHeight) })
            face.closeSubpath()
            context.fill(face, with: .color(ink.wall))
            var top = Path()
            top.addLines(fence.map { f.point($0, z: Ballpark.wallHeight) })
            context.stroke(top, with: .color(ink.wallTop), lineWidth: 0.75)
            var poles = Path()
            for p in [fence[0], fence[fence.count - 1]] {
                poles.move(to: f.point(p))
                poles.addLine(to: f.point(p, z: 42))
            }
            context.stroke(poles, with: .color(Celebrate.gold.opacity(0.85)), style: StrokeStyle(lineWidth: 1, lineCap: .round))

            // Bases, the rubber and home plate, a little larger than life.
            let k = f.k
            for base in 1...3 {
                let p = f.point(Ballpark.base(base))
                var bag = Path()
                bag.addLines([CGPoint(x: p.x - 2.4 * k, y: p.y), CGPoint(x: p.x, y: p.y - 1.2 * k),
                              CGPoint(x: p.x + 2.4 * k, y: p.y), CGPoint(x: p.x, y: p.y + 1.2 * k)])
                bag.closeSubpath()
                context.fill(bag, with: .color(ink.chalk.opacity(1)))
            }
            let rubber = f.point(Ballpark.rubber)
            context.fill(Path(CGRect(x: rubber.x - 1.2 * k, y: rubber.y - 0.3 * k, width: 2.4 * k, height: 0.6 * k)), with: .color(ink.chalk))
            let h = f.home
            var plate = Path()
            plate.addLines([CGPoint(x: h.x - 2 * k, y: h.y - 0.8 * k), CGPoint(x: h.x + 2 * k, y: h.y - 0.8 * k),
                            CGPoint(x: h.x + 2 * k, y: h.y), CGPoint(x: h.x, y: h.y + 1 * k), CGPoint(x: h.x - 2 * k, y: h.y)])
            plate.closeSubpath()
            context.fill(plate, with: .color(ink.chalk))
        }
    }
}

// MARK: - Figures and ball

/// The colors of the two teams on the field.
struct TheaterTeams: Equatable {
    var batting: Color
    var fielding: Color

    func color(_ team: PlayScript.Team) -> Color { team == .batting ? batting : fielding }

    /// A team with no usable color (`Viz.neutral`, which is translucent) is drawn in a solid gray.
    static func solid(_ color: Color, _ scheme: ColorScheme) -> Color {
        color == Viz.neutral ? Color(white: scheme == .dark ? 0.72 : 0.5) : color
    }
}

/// One frame of a play: the ball's trace and shadow, the figures far to
/// near, the ball, the beats, the pitch's label and the scorer's mark.
/// Equatable: at rest (t = ∞) an update elsewhere on the page doesn't redraw it.
struct PlayFrame: View, Equatable {
    let scene: PlayScene?
    let script: PlayScript
    let t: Double
    let teams: TheaterTeams
    let ink: TheaterInk
    /// Where it's drawn: the type is sized from it.
    let size: CGSize

    /// The type, laid out once as views and drawn into each frame: resolving
    /// text in the renderer every frame was most of a frame's cost.
    private enum Symbol: Hashable { case pitch, stamp }

    var body: some View {
        let k = FieldProjection(size: size).k
        Canvas { context, size in
            let f = FieldProjection(size: size)
            drawTrace(&context, f)
            drawShadows(&context, f)
            drawFigures(&context, f)
            drawBall(&context, f)
            drawFlashes(&context, f)
            drawLabels(&context, f)
        } symbols: {
            pitchLabel(k).tag(Symbol.pitch)
            stamp(k).tag(Symbol.stamp)
        }
    }

    // MARK: The ball's path

    private func drawTrace(_ context: inout GraphicsContext, _ f: FieldProjection) {
        guard let index = script.batted, index < script.flights.count else { return }
        let flight = script.flights[index]
        guard t > flight.start else { return }
        let end = min(t, flight.end)
        let samples = 40
        let points = (0...samples).map { f.point(flight.point(at: flight.start + (end - flight.start) * Double($0) / Double(samples))) }
        var path = Path()
        path.addLines(points)
        // Bright behind the ball, settling to a faint record of where it went.
        let landed = flight.end
        let after = t - landed
        let strength = after <= 0 ? 0.75 : max(0.75 - after / 0.6 * 0.45, 0.3) - (t > script.settle ? min((t - script.settle) / 0.8, 1) * 0.1 : 0)
        let shading = GraphicsContext.Shading.linearGradient(
            Gradient(colors: [ink.trace.opacity(strength * 0.15), ink.trace.opacity(strength)]),
            startPoint: points.first ?? .zero, endPoint: points.last ?? .zero)
        context.stroke(path, with: shading, style: StrokeStyle(lineWidth: 0.9, lineCap: .round, lineJoin: .round))

        // Where it came down: the spray chart's marks (filled, a ring, a ringed dot).
        guard let landing = script.landing, t >= landing.at else { return }
        let p = f.point(landing.point)
        let grow = min((t - landing.at) / 0.2, 1)
        let r = 2.2 * f.k * (0.6 + 0.4 * grow)
        let rect = CGRect(x: p.x - r, y: p.y - r / 2, width: 2 * r, height: r)
        switch landing.mark {
        case .out:
            context.stroke(Path(ellipseIn: rect), with: .color(teams.batting.opacity(0.9)), lineWidth: 1.2)
        case .hit:
            context.fill(Path(ellipseIn: rect), with: .color(teams.batting))
        case .homeRun:
            context.fill(Path(ellipseIn: rect), with: .color(teams.batting))
            context.stroke(Path(ellipseIn: rect.insetBy(dx: -1.5, dy: -0.75)), with: .color(.primary), lineWidth: 0.8)
        }
    }

    // MARK: Shadows

    private func drawShadows(_ context: inout GraphicsContext, _ f: FieldProjection) {
        let k = f.k
        for actor in script.actors {
            let o = actor.opacity(at: t)
            guard o > 0.01 else { continue }
            let p = f.point(actor.position(at: t))
            context.fill(Path(ellipseIn: CGRect(x: p.x - 3.2 * k, y: p.y - 1.1 * k, width: 6.4 * k, height: 2.2 * k)),
                         with: .color(ink.shadow.opacity(o)))
        }
        // The ball's: under it on the ground, larger and softer the higher it
        // flies, with a hairline up to the ball once it's well off the grass.
        if let ball = script.ball(at: t), ball.z > 0.3 {
            let o = script.ballOpacity(at: t)
            let g = f.point(ball.ground)
            let spread = 1 + min(ball.z / 50, 1.4)
            let r = 1.6 * k * spread
            let strength = 1.6 / (1 + ball.z / 40)
            context.fill(Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r / 2, width: 2 * r, height: r)),
                         with: .color(ink.shadow.opacity(min(strength, 1) * o)))
            if ball.z > 6 {
                var drop = Path()
                drop.move(to: g)
                drop.addLine(to: f.point(ball))
                context.stroke(drop, with: .color(ink.trace.opacity(0.16 * min((ball.z - 6) / 10, 1) * o)), lineWidth: 0.5)
            }
        }
    }

    // MARK: Figures

    private func drawFigures(_ context: inout GraphicsContext, _ f: FieldProjection) {
        let k = f.k
        // Far to near: a figure in front covers the one behind.
        let order = script.actors.indices
            .map { (index: $0, at: script.actors[$0].position(at: t)) }
            .sorted { $0.at.y > $1.at.y }
        for (index, at) in order {
            let actor = script.actors[index]
            let o = actor.opacity(at: t)
            guard o > 0.01 else { continue }
            var foot = f.point(at)
            // A stride's bob while running.
            if actor.running(at: t) { foot.y -= abs(sin(t * 2 * .pi * 3.2 + Double(index))) * 0.9 * k }
            let color = teams.color(actor.team)
            let bodyWidth = 3.4 * k, bodyHeight = (actor.crouch ? 4.2 : 6.2) * k, head = 2.9 * k
            let body = CGRect(x: foot.x - bodyWidth / 2, y: foot.y - bodyHeight - 0.4 * k, width: bodyWidth, height: bodyHeight)
            let headRect = CGRect(x: foot.x - head / 2, y: body.minY - head - 0.55 * k, width: head, height: head)
            let bodyPath = Path(roundedRect: body, cornerRadius: bodyWidth / 2)
            let headPath = Path(ellipseIn: headRect)
            var layer = context
            layer.opacity = o
            // The halo first, so lines and figures behind stop short of this one.
            layer.fill(Path(roundedRect: body.insetBy(dx: -0.75, dy: -0.75), cornerRadius: bodyWidth / 2 + 0.75), with: .color(ink.halo))
            layer.fill(Path(ellipseIn: headRect.insetBy(dx: -0.75, dy: -0.75)), with: .color(ink.halo))
            if let bats = actor.bats {
                if actor.dropsBat.map({ t < $0 }) ?? true {
                    drawBat(&layer, bats: bats, body: body, swing: actor.swing, k: k)
                } else {
                    drawDroppedBat(&context, at: f.point(Ballpark.box(bats)), bats: bats, fade: 1 - min(max((t - script.settle) / 0.4, 0), 1), k: k)
                }
            }
            layer.fill(bodyPath, with: .color(color))
            layer.fill(headPath, with: .color(color))
        }
    }

    /// The bat: on the shoulder, then round through the zone, level at
    /// contact, and on into the follow-through.
    private func drawBat(_ context: inout GraphicsContext, bats: PlayScene.Hand, body: CGRect, swing: Double?, k: CGFloat) {
        // Azimuth on the ground (0: toward first base's side, 90: out to center), and lift.
        var azimuth = -105.0, lift = 0.85
        if let swing {
            let u = min(max((t - (swing - 0.09)) / 0.24, 0), 1)
            let e = PlayScript.Ease.inOut.value(u)
            azimuth = -105 + e * 255
            lift = u <= 0 ? 0.85 : u < 0.4 ? 0.85 - (u / 0.4) * 0.7 : 0.15 + (u - 0.4) / 0.6 * 0.5
        }
        if bats == .left { azimuth = 180 - azimuth }
        let a = azimuth * .pi / 180, length = 7.5 * k
        let hands = CGPoint(x: body.midX + (bats == .left ? -0.6 : 0.6) * k, y: body.minY + 1.6 * k)
        let flat = length * (1 - lift * lift).squareRoot()
        let tip = CGPoint(x: hands.x + cos(a) * flat, y: hands.y - sin(a) * flat * 0.5 - lift * length * 0.82)
        var bat = Path()
        bat.move(to: hands)
        bat.addLine(to: tip)
        context.stroke(bat, with: .color(ink.halo), style: StrokeStyle(lineWidth: 2.4, lineCap: .round))
        context.stroke(bat, with: .color(Color(hue: 0.09, saturation: 0.35, brightness: 0.85)), style: StrokeStyle(lineWidth: 1.1, lineCap: .round))
    }

    /// Left lying by the plate when he runs, until the field settles.
    private func drawDroppedBat(_ context: inout GraphicsContext, at p: CGPoint, bats: PlayScene.Hand, fade: Double, k: CGFloat) {
        guard fade > 0.01 else { return }
        let s: CGFloat = bats == .left ? 1 : -1
        var bat = Path()
        bat.move(to: CGPoint(x: p.x + s * 1 * k, y: p.y + 1.2 * k))
        bat.addLine(to: CGPoint(x: p.x + s * 7 * k, y: p.y - 0.6 * k))
        var layer = context
        layer.opacity = fade
        layer.stroke(bat, with: .color(Color(hue: 0.09, saturation: 0.35, brightness: 0.85).opacity(0.8)),
                     style: StrokeStyle(lineWidth: 1.1, lineCap: .round))
    }

    // MARK: Ball

    private func drawBall(_ context: inout GraphicsContext, _ f: FieldProjection) {
        guard let ball = script.ball(at: t) else { return }
        let o = script.ballOpacity(at: t)
        guard o > 0.01 else { return }
        let p = f.point(ball)
        let r = 1.45 * f.k
        let rect = CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)
        var layer = context
        layer.opacity = o
        layer.fill(Path(ellipseIn: rect.insetBy(dx: -0.6, dy: -0.6)), with: .color(ink.ballEdge))
        layer.fill(Path(ellipseIn: rect), with: .color(ink.ball))
    }

    // MARK: Beats

    private func drawFlashes(_ context: inout GraphicsContext, _ f: FieldProjection) {
        let k = f.k
        for flash in script.flashes {
            let age = t - flash.at
            switch flash.beat {
            case .contact:
                // Four short rays off the bat.
                guard age >= 0, age < 0.22 else { continue }
                let u = age / 0.22, c = f.point(flash.point)
                var rays = Path()
                for i in 0..<5 {
                    let a = Double(i) / 5 * 2 * .pi + 0.3
                    let inner = (1.6 + 3 * u) * k, outer = (2.6 + 5 * u) * k
                    rays.move(to: CGPoint(x: c.x + cos(a) * inner, y: c.y + sin(a) * inner * 0.8))
                    rays.addLine(to: CGPoint(x: c.x + cos(a) * outer, y: c.y + sin(a) * outer * 0.8))
                }
                context.stroke(rays, with: .color(ink.trace.opacity(0.9 * (1 - u))), style: StrokeStyle(lineWidth: 1, lineCap: .round))
            case .out:
                // A red ring where the out was made.
                guard age >= 0, age < 0.6 else { continue }
                let u = age / 0.6, c = f.point(flash.point)
                let r = (2.5 + 7 * Motion.curve.value(at: u)) * k
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r / 2, width: 2 * r, height: r)),
                               with: .color(Color.red.opacity(0.95 * (1 - u))), lineWidth: 1.5)
                if age < 0.25 {
                    let d = 1.8 * k
                    context.fill(Path(ellipseIn: CGRect(x: c.x - d, y: c.y - d / 2, width: 2 * d, height: d)),
                                 with: .color(Color.red.opacity(0.8 * (1 - age / 0.25))))
                }
            case .run:
                // The plate pops in the batting team's color.
                guard age >= 0, age < 0.7 else { continue }
                let u = age / 0.7, c = f.point(flash.point)
                let r = (3 + 9 * Motion.curve.value(at: u)) * k
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r / 2, width: 2 * r, height: r)),
                               with: .color(teams.batting.opacity(1 - u)), lineWidth: 1.5)
                let pop = (age < 0.14 ? age / 0.14 : max(1 - (age - 0.14) / 0.4, 0)) * 3.2 * k
                if pop > 0.1 {
                    context.fill(Path(ellipseIn: CGRect(x: c.x - pop, y: c.y - pop / 2, width: 2 * pop, height: pop)),
                                 with: .color(teams.batting.opacity(0.9)))
                }
            case .catchBall:
                guard age >= 0, age < 0.35 else { continue }
                let u = age / 0.35, c = f.point(flash.point)
                let r = (1.8 + 4 * u) * k
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                               with: .color(ink.trace.opacity(0.7 * (1 - u))), lineWidth: 1)
            case .hitBatter:
                guard age >= 0, age < 0.45 else { continue }
                let u = age / 0.45, c = f.point(flash.point)
                let r = (2 + 6 * u) * k
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                               with: .color(Color.orange.opacity(1 - u)), lineWidth: 1.2)
            }
        }
    }

    // MARK: Type

    private func drawLabels(_ context: inout GraphicsContext, _ f: FieldProjection) {
        let k = f.k
        // The pitch: its name and speed, from the windup until the play is
        // under way, low in the foul ground on the right, across from the stamp.
        if let label = script.label, t > label.lowerBound - 0.1, t < label.upperBound + 0.3,
           let symbol = context.resolveSymbol(id: Symbol.pitch) {
            let fadeIn = min(max((t - label.lowerBound + 0.1) / 0.15, 0), 1)
            let fadeOut = 1 - min(max((t - label.upperBound) / 0.3, 0), 1)
            var layer = context
            layer.opacity = fadeIn * fadeOut
            layer.draw(symbol, at: CGPoint(x: f.size.width - 10 - 2 * k, y: f.size.height - 9 - 2 * k), anchor: .bottomTrailing)
        }
        // The scorer's mark, as the play resolves: in from 92%, never from nothing.
        if t >= script.stamp, let symbol = context.resolveSymbol(id: Symbol.stamp) {
            let u = min((t - script.stamp) / 0.22, 1)
            let grow = 0.92 + 0.08 * Motion.curve.value(at: u)
            var layer = context
            layer.opacity = Motion.curve.value(at: u)
            layer.translateBy(x: 10 + 2 * k, y: f.size.height - 9 - 2 * k)
            layer.scaleBy(x: grow, y: grow)
            layer.draw(symbol, at: .zero, anchor: .bottomLeading)
        }
    }

    @ViewBuilder
    private func pitchLabel(_ k: CGFloat) -> some View {
        if let pitch = scene?.pitch, pitch.mph != nil || pitch.code != nil {
            let name = pitch.code.flatMap { GameDetail.Pitch.names[$0] } ?? pitch.name ?? pitch.code ?? ""
            (Text(name).foregroundStyle(.secondary)
                + Text(pitch.mph.map { "  \($0)" } ?? "").foregroundStyle(.primary)
                + Text(pitch.mph == nil ? "" : " mph").foregroundStyle(.secondary))
                .font(.system(size: 9 + (k - 1) * 2, weight: .medium).monospacedDigit())
                .fixedSize()
        }
    }

    /// The scorer's mark, low in the foul ground on the left: the code
    /// large ("6–3", a backwards K), the play in small capitals under it,
    /// runs in a pill in the batting team's color.
    @ViewBuilder
    private func stamp(_ k: CGFloat) -> some View {
        if let scene, !scene.notation.code.isEmpty {
            let size = 15 + (k - 1) * 9
            let title = [scene.title, scene.kind == .homeRun ? scene.distance.map { "\($0) ft" } : nil].compactMap { $0 }
                .joined(separator: " · ").uppercased()
            VStack(alignment: .leading, spacing: 0.5) {
                HStack(spacing: 4 * k) {
                    code(scene.notation, size: size)
                        // A called third strike: the K turned round.
                        .scaleEffect(x: scene.notation.backwards ? -1 : 1, y: 1)
                    if scene.runs > 0 {
                        Text("+\(scene.runs)")
                            .font(.system(size: size * 0.6, weight: .bold).monospacedDigit())
                            .foregroundStyle(Viz.ink(on: teams.batting))
                            .padding(.horizontal, 3 * k)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(teams.batting))
                    }
                }
                Text(title)
                    .font(.system(size: 7.5 + (k - 1) * 2, weight: .semibold))
                    .tracking(0.7)
                    .foregroundStyle(.secondary)
            }
            .fixedSize()
        }
    }

    /// The fielders' numbers bold, en-dashed ("4–6–3"); a tag (DP, FC, SAC) lighter and smaller.
    private func code(_ notation: PlayScene.Notation, size: CGFloat) -> Text {
        let marks: Set<String> = ["HR", "BB", "HBP", "IBB", "SB", "WP", "PB", "BK", "DI", "K"]
        var text = Text("")
        for (i, part) in notation.code.split(separator: " ").map(String.init).enumerated() {
            let bold = part.contains(where: \.isNumber) || marks.contains(part)
            text = text + Text((i > 0 ? " " : "") + part.replacingOccurrences(of: "-", with: "–"))
                .font(bold ? .system(size: size, weight: .bold).monospacedDigit() : .system(size: size * 0.62, weight: .semibold))
                .foregroundStyle(bold ? Color.primary : Color.secondary)
        }
        return text.tracking(-0.2)
    }
}

// MARK: - Theater

/// The play theater under the diamond. It reads the live lane itself (and
/// nothing above it does), so a new play redraws the theater alone.
struct PlayTheater: View {
    let feed: BaseballFeed?
    /// The full load's last play and batter, until the live lane has spoken.
    var preloaded: TheaterState? = nil
    /// The live bases and the team at bat (the diamond's), for the field between plays.
    var bases: [Bool]? = nil
    var batting: GameDetail.Side? = nil
    let palette: TeamPalette

    var body: some View {
        let live = feed?.loaded == true ? feed?.theater : nil
        let state = live.flatMap { $0.play == nil ? nil : $0 } ?? preloaded ?? live ?? TheaterState()
        PlayStage(state: state, bases: bases, batting: batting, palette: palette)
    }
}

/// The theater's stage: the field, one frame of the play (a TimelineView
/// only while it replays), and a home run's fireworks.
private struct PlayStage: View {
    let state: TheaterState
    let bases: [Bool]?
    let batting: GameDetail.Side?
    let palette: TeamPalette
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

    /// Half as tall as wide, up to this; wider than that, the field centers in the well.
    static let maxHeight: CGFloat = 320

    /// The field between plays: the live bases and batter, or how the play left them.
    private var rest: PlayScript.Rest {
        guard let play = state.play else {
            return PlayScript.Rest(bases: bases ?? [false, false, false], bats: state.bats)
        }
        let swapped = play.endsInning
        return PlayScript.Rest(bases: swapped ? [false, false, false] : bases ?? play.basesAfter, bats: state.bats, swapped: swapped)
    }

    private var teams: TheaterTeams {
        // The play's batting team; else the live one; else the top team (the visitors bat first).
        let side = state.play?.batting ?? batting ?? .top
        let at = side == .top ? palette.top : palette.bottom
        let field = side == .top ? palette.bottom : palette.top
        return TheaterTeams(batting: TheaterTeams.solid(at, scheme), fielding: TheaterTeams.solid(field, scheme))
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

    var body: some View {
        let script = state.play.map { PlayScript($0, rest: rest) } ?? PlayScript(rest: rest)
        let ink = TheaterInk(scheme)
        let teams = teams
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                BallparkLayer(ink: ink).equatable()
                Group {
                    if playing {
                        TimelineView(.animation) { context in
                            PlayFrame(scene: state.play, script: script, t: time(at: context.date), teams: teams, ink: ink, size: geo.size)
                                .equatable()
                        }
                        .transition(.identity)
                    } else {
                        PlayFrame(scene: state.play, script: script, t: time(at: .now), teams: teams, ink: ink, size: geo.size)
                            .equatable()
                            .transition(.identity)
                    }
                }
                .id(state.play?.id)
                // A replay cuts in; a play that isn't replayed crossfades to how it ended.
                .transition(.opacity.animation(playing ? Motion.fade : .easeInOut(duration: 0.35)))
                if let play = state.play, let fence = script.fence {
                    HomeRunFireworks(playID: play.id, origin: FieldProjection(size: geo.size).point(fence.point), size: geo.size,
                                     color: teams.batting, clears: fence.at, start: replay?.id == play.id ? replay?.start : nil)
                }
            }
        }
        // The well spans the column, so its edges line up with the diamond and the caption.
        .modifier(HalfHeight(cap: Self.maxHeight))
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

    /// A new play replays from its pitch; history and Reduce Motion don't.
    private func begin() {
        guard clock == .live, !reduceMotion, state.news, let play = state.play, replay?.id != play.id else { return }
        replay = Replay(id: play.id, start: .now)
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

/// A home run's fireworks, handed to the page's celebration stage as the
/// ball clears the fence (its level, Reduce Motion and cooldown rules
/// apply). Only for the moment the page is showing: a play already on the
/// page when it opened never bursts.
private struct HomeRunFireworks: View {
    let playID: String
    let origin: CGPoint
    let size: CGSize
    let color: Color
    /// Seconds from the pitch to the ball clearing the fence.
    let clears: Double
    /// When the replay began.
    let start: Date?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.celebrationClock) private var clock
    @State private var armed: Date?

    /// The fireworks' own lead-in (their cue waits 0.35 s for the ball).
    private static let lead = 0.35

    var body: some View {
        let moment = momentFor(.plate, in: moments).flatMap { $0.id == playID && $0.kind == .homeRun ? $0 : nil }
        Group {
            switch clock {
            case let .frozen(t):
                if t >= clears - Self.lead { stage(moment).environment(\.celebrationClock, .frozen(t - (clears - Self.lead))) }
            case .live:
                if let start, armed == start { stage(moment) }
            }
        }
        .task(id: start) {
            guard let start, clock == .live else { return }
            let wait = start.addingTimeInterval(clears - Self.lead).timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard !Task.isCancelled else { return }
            armed = start
        }
        .allowsHitTesting(false)
    }

    private func stage(_ moment: LiveMoment?) -> some View {
        CelebrationStage(moment: moment, origin: origin, size: size, colors: .team(color), wellInset: 0)
    }
}
