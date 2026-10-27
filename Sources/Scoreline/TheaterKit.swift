import SwiftUI

// What the play theaters share, whatever the sport, so the field and the
// pitch read as the same product as the ballpark: the broadcast camera's
// spring and its shot blends, a pictogram figure and the glowing ball with
// its comet tail, the headline and the stamp's type and how they land, and
// the well's shape. The baseball theater came first and keeps its own copies
// (PlayCamera.swift and PlayTheater.swift) with the same constants; these
// are the general form, drawn through any projection.

// MARK: - Camera

/// The broadcast camera's follow, for any theater: framings every 1/60 s on
/// a critically damped spring (no overshoot, no wobble) toward each moment's
/// goal, panning and zooming in log space with capped speeds: 1.4
/// view-heights a second across, ×3 a second in, ×9 out. A cut is a cut:
/// the camera is simply there.
enum CameraRig {
    static let rate = 60.0

    static func follow(until settle: Double, cuts: [Double] = [], goal: (Double) -> CameraFrame) -> [CameraFrame] {
        // One step a sample (semi-implicit Euler: at ω·dt ≈ 0.12, stable and smooth).
        let dt = 1 / rate, pan = 7.0, zoom = 7.0
        let first = goal(0)
        var x = first.x, y = first.y, z = log(first.span), vx = 0.0, vy = 0.0, vz = 0.0
        var samples = [first]
        samples.reserveCapacity(Int(max(settle, 0) * rate) + 2)
        var t = 0.0
        while t < settle {
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

    /// A new shot's region `elapsed` seconds in: it blends from the last
    /// shot's over 0.4 s, or, from far across the field, pulls back through a
    /// shot of both and pushes in again (0.9 s), as an operator would rather
    /// than sliding across. Also how far the blend is (1: done).
    static func blend(from a: CGRect, to b: CGRect, elapsed: Double) -> (region: CGRect, u: Double) {
        let far = hypot(a.midX - b.midX, a.midY - b.midY) > 0.6 * max(min(a.height, b.height), 60)
        let length = far ? 0.9 : 0.4, x = elapsed / length
        guard x < 1 else { return (b, 1) }
        let both = a.union(b)
        let region = far ? (x < 0.5 ? lerp(a, both, smooth(2 * x)) : lerp(both, b, smooth(2 * x - 1))) : lerp(a, b, smooth(x))
        return (region, smooth(x))
    }

    /// Room kept clear at the top: a little, or the banner's while it's up (with 0.4 s either side).
    static func headroom(at t: Double, banner: ClosedRange<Double>?) -> Double {
        guard let banner else { return CameraFrame.headroom }
        let up = smooth((t - banner.lowerBound + 0.5) / 0.4) * (1 - smooth((t - banner.upperBound) / 0.4))
        return CameraFrame.headroom + (CameraFrame.bannerRoom - CameraFrame.headroom) * up
    }

    static func smooth(_ x: Double) -> Double { let u = min(max(x, 0), 1); return u * u * (3 - 2 * u) }

    static func lerp(_ a: CGRect, _ b: CGRect, _ s: Double) -> CGRect {
        CGRect(x: a.minX + (b.minX - a.minX) * s, y: a.minY + (b.minY - a.minY) * s,
               width: a.width + (b.width - a.width) * s, height: a.height + (b.height - a.height) * s)
    }

    /// Room round a spot in projected feet (y up), as the camera keeps it:
    /// a figure about 9 ft tall on screen (larger than life), a ball a little.
    static func room(_ p: FieldPoint, figure: Bool) -> CGRect {
        let x = p.x, y = p.y * 0.5 + p.z * 0.82
        let below = figure ? 3.0 : 5.0, above = figure ? 10.0 : 5.0
        return CGRect(x: x - 6, y: y - below, width: 12, height: below + above)
    }
}

/// A camera's path through a replay: framings every 1/60 s until the play
/// settles, then an eased move to where it rests, reached exactly at `back`.
struct CameraPath: Equatable {
    var samples: [CameraFrame] = []
    var settle = 0.0
    var back = 0.0
    var rest: CameraFrame

    func frame(at t: Double) -> CameraFrame {
        guard !samples.isEmpty, t < back else { return rest }
        if t >= settle {
            let u = (t - settle) / max(back - settle, 0.01)
            return sample(settle).mix(rest, u * u * (3 - 2 * u))
        }
        return sample(t)
    }

    private func sample(_ t: Double) -> CameraFrame {
        let i = max(t, 0) * CameraRig.rate
        let lower = min(Int(i), samples.count - 1), upper = min(lower + 1, samples.count - 1)
        return samples[lower].mix(samples[upper], min(i - Double(lower), 1))
    }
}

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

// MARK: - Figures and ball

/// A team's inks for one frame, resolved once: resolving a team color was
/// most of a stroke's cost.
struct FigureInks {
    let rim, inner, far, jersey, cap: GraphicsContext.Shading

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
    /// A pictogram: its rim first (so the lines and figures behind stop short
    /// of it), the far limbs in a shade of the jersey, the body, an inner rim
    /// on the near limbs when it's big enough to carry one, the near limbs,
    /// the head in the team's own color.
    static func figure(_ figure: Figure, inks: FigureInks, height: CGFloat, opacity: Double, in context: GraphicsContext) {
        var layer = context
        if opacity < 1 { layer.opacity = opacity }
        let halo = max(height * 0.045, 0.8)
        let near = figure.nearLimbs, far = figure.farLimbs, body = figure.body
        let limbs = StrokeStyle(lineWidth: figure.limb, lineCap: .round, lineJoin: .round)
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

    /// A soft oval under a figure or the ball.
    static func shadow(at p: CGPoint, radius r: CGFloat, color: Color, in context: GraphicsContext) {
        context.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r * 0.32, width: 2 * r, height: r * 0.64)), with: .color(color))
    }

    /// The ball's comet tail: where it was over the last few hundredths,
    /// fading back, drawn only while it's moving fast enough to leave one.
    static func trail(_ points: [CGPoint], from p: CGPoint, radius r: CGFloat, color: Color, in context: GraphicsContext) {
        guard let last = points.last, hypot(last.x - p.x, last.y - p.y) > r * 3 else { return }
        var previous = p
        for (i, q) in points.enumerated() {
            let u = Double(i) / Double(points.count)
            var segment = Path()
            segment.move(to: previous)
            segment.addLine(to: q)
            context.stroke(segment, with: .color(color.opacity(0.55 * (1 - u))),
                           style: StrokeStyle(lineWidth: 2 * r * (1 - u * 0.75), lineCap: .round))
            previous = q
        }
    }

    /// The ball's glow: two soft discs round its core.
    static func glow(at p: CGPoint, radius r: CGFloat, color: Color, in context: GraphicsContext) {
        for (grow, strength) in [(2.8, 0.1), (1.85, 0.22)] {
            let g = r * grow
            context.fill(Path(ellipseIn: CGRect(x: p.x - g, y: p.y - g, width: 2 * g, height: 2 * g)), with: .color(color.opacity(strength)))
        }
    }

    /// The ball: a bright core in a soft glow, with its comet tail while it's fast.
    static func ball(at p: CGPoint, radius r: CGFloat, trail points: [CGPoint], ink: TheaterInk, opacity: Double, in context: GraphicsContext) {
        guard opacity > 0.01 else { return }
        var layer = context
        layer.opacity = opacity
        Self.trail(points, from: p, radius: r, color: ink.ball, in: layer)
        Self.glow(at: p, radius: r, color: ink.glow, in: layer)
        let rect = CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)
        layer.fill(Path(ellipseIn: rect.insetBy(dx: -0.6, dy: -0.6)), with: .color(ink.ballEdge))
        layer.fill(Path(ellipseIn: rect), with: .color(ink.ball))
    }
}

// MARK: - Type

/// The headline and the stamp: how big, where, and how they land.
enum TheaterType {
    /// A quick, critically damped spring: no bounce.
    static let land = Spring(duration: 0.32, bounce: 0)

    /// Type sizes from the well's height: big where there's room.
    static func height(_ size: CGSize) -> CGFloat { max(size.height, 120) }
    static func inset(_ size: CGSize) -> CGFloat { max(size.height * 0.055, 9) }
    static func banner(_ size: CGSize) -> CGFloat { min(max(height(size) * 0.13, 17), 40) }
    static func stamp(_ size: CGSize) -> CGFloat { min(max(height(size) * 0.2, 24), 54) }
    static func title(_ size: CGSize) -> CGFloat { min(max(height(size) * 0.056, 8), 14) }

    /// Where the banner's burst comes from: under the headline.
    static func bannerOrigin(_ size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2, y: inset(size) * 0.7 + banner(size) * 0.6)
    }

    /// The headline across the top: wiped open from the middle as it drops
    /// in, held, then lifted away.
    static func drawBanner(_ symbol: GraphicsContext.ResolvedSymbol, from start: Double, until end: Double, t: Double,
                           in context: GraphicsContext, size: CGSize) {
        guard t >= start, t < end + 0.3 else { return }
        let x = t - start
        let v = x >= 1 ? 1 : land.value(target: 1.0, time: x)
        let out = min(max((t - end) / 0.28, 0), 1)
        let open = Motion.curve.value(at: min(x / 0.3, 1))
        let w = symbol.size.width
        var layer = context
        layer.opacity = min(x / 0.12, 1) * (1 - out)
        let center = CGPoint(x: size.width / 2, y: inset(size) * 0.7 + symbol.size.height / 2 + (1 - v) * -8 - out * 5)
        layer.clip(to: Path(CGRect(x: center.x - w / 2 * open - 2, y: 0, width: w * open + 4, height: size.height)))
        layer.draw(symbol, at: center, anchor: .center)
    }

    /// The stamp, low on the left as the play resolves: in from larger on a
    /// quick spring that never bounces, never from nothing.
    static func drawStamp(_ symbol: GraphicsContext.ResolvedSymbol, from start: Double, t: Double, in context: GraphicsContext,
                          size: CGSize) {
        guard t >= start else { return }
        let x = t - start
        // Settled long before a second is up (and never asked about t = ∞).
        let v = x >= 1 ? 1 : min(land.value(target: 1.0, time: x), 1)
        let grow = 1.28 - 0.28 * v
        let inset = inset(size)
        var layer = context
        layer.opacity = min(x / 0.1, 1)
        layer.translateBy(x: inset, y: size.height - inset * 0.8)
        layer.scaleBy(x: grow, y: grow)
        layer.draw(symbol, at: .zero, anchor: .bottomLeading)
    }
}

/// The headline: heavy, wide capitals between two short rules, in the play's color.
struct TheaterBanner: View {
    let text: String
    let color: Color
    let size: CGFloat

    var body: some View {
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
}

// MARK: - Well

/// A theater's well: the column's full width, half as tall, up to `cap`.
struct TheaterWell: Layout {
    let cap: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? Metrics.compactWidth - 2 * Metrics.gutter
        return CGSize(width: width, height: min(width / 2, cap).rounded())
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews { subview.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size)) }
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
