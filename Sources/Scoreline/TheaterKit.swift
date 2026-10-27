import SwiftUI

// What the play theaters share, whatever the sport: the broadcast camera's
// follow, the pictogram figures as they're drawn, the glowing ball with its
// comet tail, and the headline's type and entrance. The baseball theater
// came first and keeps its own copies inline (PlayTheater.swift,
// PlayCamera.swift); these are the same looks and the same constants, drawn
// through any projection, so a new theater matches it without forking it.

// MARK: - Camera

/// The broadcast camera's follow: a critically damped spring toward each
/// moment's framing (pan, and zoom in log space so it feels even), pans
/// capped at 1.4 view-heights a second, zooms at ×3 a second in and ×9 out,
/// and cuts that are simply there. Integrated once, when a script is built;
/// any frame reads the samples at t. (PlayCamera's track, without its
/// baseball rest framing.)
enum CameraFollow {
    static let rate = CameraTrack.rate

    /// Framings every 1/rate s from 0 through `end`.
    static func samples(until end: Double, cuts: [Double] = [], goal: (Double) -> CameraFrame) -> [CameraFrame] {
        // One step a sample (semi-implicit Euler: at ω·dt ≈ 0.12, stable and smooth).
        let dt = 1 / rate, pan = 7.0, zoom = 7.0
        let first = goal(0)
        var x = first.x, y = first.y, z = log(first.span), vx = 0.0, vy = 0.0, vz = 0.0
        var samples = [first]
        samples.reserveCapacity(Int(max(end, 0) * rate) + 2)
        var t = 0.0
        while t < end {
            t += dt
            let g = goal(t)
            if cuts.contains(where: { $0 > t - dt && $0 <= t }) {
                (x, y, z, vx, vy, vz) = (g.x, g.y, log(g.span), 0, 0, 0)
            } else {
                vx += (pan * pan * (g.x - x) - 2 * pan * vx) * dt
                vy += (pan * pan * (g.y - y) - 2 * pan * vy) * dt
                let speed = hypot(vx, vy), reach = 1.4 * exp(z)
                if speed > reach { vx *= reach / speed; vy *= reach / speed }
                vz = min(max(vz + (zoom * zoom * (log(g.span) - z) - 2 * zoom * vz) * dt, -1.1), 2.2)
                x += vx * dt; y += vy * dt; z += vz * dt
            }
            samples.append(CameraFrame(x: x, y: y, span: exp(z)))
        }
        return samples
    }

    /// The framing at t, between samples; the last one from the end on.
    static func frame(_ samples: [CameraFrame], at t: Double) -> CameraFrame? {
        guard let last = samples.last else { return nil }
        guard t.isFinite else { return last }
        let i = max(t, 0) * rate
        let lower = min(Int(i), samples.count - 1), upper = min(lower + 1, samples.count - 1)
        return samples[lower].mix(samples[upper], min(i - Double(lower), 1))
    }
}

// MARK: - Figures

/// A team's inks for one frame's figures, resolved once a frame: resolving a
/// team color was most of a stroke's cost.
struct FigureInks {
    let rim: GraphicsContext.Shading
    let inner: GraphicsContext.Shading
    let far: GraphicsContext.Shading
    let jersey: GraphicsContext.Shading
    let cap: GraphicsContext.Shading

    init(_ uniform: Uniform, ink: TheaterInk, in context: GraphicsContext) {
        let rim = uniform.piping ?? ink.halo
        self.rim = context.resolve(.color(rim))
        inner = context.resolve(.color(rim.opacity(0.7)))
        far = context.resolve(.color(uniform.jersey.mix(with: .black, by: ink.dark ? 0.32 : 0.22)))
        jersey = context.resolve(.color(uniform.jersey))
        cap = context.resolve(.color(uniform.cap))
    }
}

enum TheaterDraw {
    /// A pictogram figure as the theaters draw it: the rim first (so lines and
    /// figures behind stop short of it), the far limbs shaded, the body, the
    /// near limbs (an inner rim once the figure is large enough to hold
    /// one), the head.
    static func figure(_ figure: Figure, inks: FigureInks, opacity: Double, height: CGFloat, in context: inout GraphicsContext) {
        let near = figure.nearLimbs, far = figure.farLimbs, body = figure.body
        let halo = max(height * 0.045, 0.8)
        let limbs = StrokeStyle(lineWidth: figure.limb, lineCap: .round, lineJoin: .round)
        var layer = context
        if opacity < 1 { layer.opacity = opacity }
        var silhouette = far
        silhouette.addPath(near)
        layer.stroke(silhouette, with: inks.rim, style: StrokeStyle(lineWidth: figure.limb + 2 * halo, lineCap: .round, lineJoin: .round))
        layer.stroke(body, with: inks.rim, style: StrokeStyle(lineWidth: figure.torso + 2 * halo, lineCap: .round))
        layer.fill(Path(ellipseIn: figure.headRect.insetBy(dx: -halo, dy: -halo)), with: inks.rim)
        layer.stroke(far, with: inks.far, style: limbs)
        layer.stroke(body, with: inks.jersey, style: StrokeStyle(lineWidth: figure.torso, lineCap: .round))
        // Small figures lose their inner rim: it would only blur them.
        if height >= 15 {
            layer.stroke(near, with: inks.inner, style: StrokeStyle(lineWidth: figure.limb + 1.2, lineCap: .round, lineJoin: .round))
        }
        layer.stroke(near, with: inks.jersey, style: limbs)
        layer.fill(Path(ellipseIn: figure.headRect), with: inks.cap)
    }

    /// The ball: a bright core in a soft glow, with a short comet tail (where
    /// it was over the last few hundredths, fading back) while it's fast.
    static func ball(at p: CGPoint, radius r: CGFloat, trail: [CGPoint], ink: TheaterInk, opacity: Double, in context: inout GraphicsContext) {
        guard opacity > 0.01 else { return }
        var layer = context
        layer.opacity = opacity
        if let last = trail.last, hypot(last.x - p.x, last.y - p.y) > r * 3 {
            var previous = p
            for (i, q) in trail.enumerated() {
                let u = Double(i) / Double(trail.count)
                var segment = Path()
                segment.move(to: previous)
                segment.addLine(to: q)
                layer.stroke(segment, with: .color(ink.ball.opacity(0.55 * (1 - u))),
                             style: StrokeStyle(lineWidth: 2 * r * (1 - u * 0.75), lineCap: .round))
                previous = q
            }
        }
        for (grow, strength) in [(2.8, 0.1), (1.85, 0.22)] {
            let g = r * grow
            layer.fill(Path(ellipseIn: CGRect(x: p.x - g, y: p.y - g, width: 2 * g, height: 2 * g)), with: .color(ink.glow.opacity(strength)))
        }
        let rect = CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)
        layer.fill(Path(ellipseIn: rect.insetBy(dx: -0.6, dy: -0.6)), with: .color(ink.ballEdge))
        layer.fill(Path(ellipseIn: rect), with: .color(ink.ball))
    }
}

// MARK: - Headline

/// The headline across the top of the theater for a marquee moment (HOME
/// RUN, GOAL, SAVE): heavy, wide capitals between two short rules, in the
/// moment's color.
struct TheaterHeadline: View {
    let text: String
    let color: Color
    /// The well's height: the type is sized from it.
    let height: CGFloat

    static func size(for height: CGFloat) -> CGFloat { min(max(max(height, 120) * 0.13, 17), 40) }

    var body: some View {
        let size = Self.size(for: height)
        HStack(spacing: size * 0.45) {
            Capsule().fill(color.opacity(0.65)).frame(width: size * 1.1, height: max(size * 0.07, 1.5))
            Text(text)
                .font(.system(size: size, weight: .black).width(.expanded))
                .tracking(size * 0.06)
                .foregroundStyle(color)
            Capsule().fill(color.opacity(0.65)).frame(width: size * 1.1, height: max(size * 0.07, 1.5))
        }
        .fixedSize()
    }

    /// A quick, critically damped spring: no bounce.
    static let land = Spring(duration: 0.32, bounce: 0)

    /// Draws a resolved headline `since` seconds after it lands: wiped open
    /// from the middle as it drops in, held, then lifted away over 0.28 s
    /// from `leaving` seconds after it landed.
    static func draw(_ symbol: GraphicsContext.ResolvedSymbol, in context: inout GraphicsContext, size: CGSize,
                     since x: Double, leaving: Double) {
        let inset = max(size.height * 0.055, 9)
        let v = x >= 1 ? 1 : land.value(target: 1.0, time: x)
        let out = min(max((x - leaving) / 0.28, 0), 1)
        let open = Motion.curve.value(at: min(x / 0.3, 1))
        let w = symbol.size.width
        var layer = context
        layer.opacity = min(x / 0.12, 1) * (1 - out)
        let center = CGPoint(x: size.width / 2, y: inset * 0.7 + symbol.size.height / 2 + (1 - v) * -8 - out * 5)
        layer.clip(to: Path(CGRect(x: center.x - w / 2 * open - 2, y: 0, width: w * open + 4, height: size.height)))
        layer.draw(symbol, at: center, anchor: .center)
    }

    /// Where the headline's confetti comes from: just under its middle.
    static func confettiOrigin(in size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2, y: max(size.height * 0.055, 9) * 0.7 + Self.size(for: size.height) * 0.6)
    }
}
