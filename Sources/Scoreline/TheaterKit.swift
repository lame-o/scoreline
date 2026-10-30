import SwiftUI

// What the play theaters share, whatever the sport, so the field and the
// pitch read as the same product as the ballpark: the broadcast camera's
// spring and its shot blends, a pictogram figure and the glowing ball with
// its comet tail, the headline and the stamp's type and how they land, and
// the well's shape. The baseball theater came first and keeps its own copies
// (PlayCamera.swift and PlayTheater.swift) with the same constants; these
// are the general form, drawn through any projection.

// MARK: - Hold

enum TheaterKit {
    /// How long a replay's end stays up when nothing new has come: then the
    /// theater returns to the game as it stands (the next batter up, both
    /// teams set at the line, the quiet pitch).
    static let hold: Duration = .seconds(8)
}

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

extension CameraFrame {
    /// The framing that fits a region, no closer than `closest` nor than
    /// `tightest` (the ballpark's battery by default; a court frames tighter,
    /// a man and the rim he's going at).
    static func fitting(_ region: CGRect, headroom: Double, closest: Double, tightest: Double) -> CameraFrame {
        let tall = 1 - headroom - margin, wide = aspect * (1 - 2 * margin)
        let span = min(max(region.height / tall, region.width / wide, closest, tightest), widest)
        return CameraFrame(x: region.midX, y: region.midY + (headroom - margin) * span / 2, span: span)
    }

    /// The framing that fits a region and keeps its corner clear (the
    /// stamp's), checked again after every move: sliding the play over or
    /// up can bring someone else into the corner (a pile trailing the play,
    /// a man jogging back to the line), and then it moves again, or widens.
    /// `items` must stay in view; `others` need only stay out of the corner.
    /// (The ballpark's `fitting(_:items:others:…)` with a field's crowd in mind.)
    static func clearing(_ region: CGRect, items: [CGRect], others: [CGRect], headroom: Double, closest: Double,
                         corner: CGSize, tightest: Double = CameraFrame.tightest) -> CameraFrame {
        var frame = fitting(region, headroom: headroom, closest: closest, tightest: tightest)
        guard corner.width > 0, corner.height > 0 else { return frame }
        for _ in 0..<10 {
            let w = frame.span * aspect
            func across(_ x: Double) -> Double { 0.5 + (x - frame.x) / w }
            func up(_ y: Double) -> Double { 0.5 + (y - frame.y) / frame.span }
            func inView(_ r: CGRect) -> Bool { across(r.maxX) > 0 && across(r.minX) < 1 && up(r.maxY) > 0 && up(r.minY) < 1 }
            let shown = items.filter(inView)
            let inside = (shown + others.filter(inView)).filter { across($0.minX) < corner.width && up($0.minY) < corner.height }
            guard !inside.isEmpty else { break }
            let right = inside.map { corner.width - across($0.minX) }.max() ?? 0
            let raise = inside.map { corner.height - up($0.minY) }.max() ?? 0
            let roomRight = 1 - margin - (shown.map { across($0.maxX) }.max() ?? 0)
            let roomUp = 1 - headroom - (shown.map { up($0.maxY) }.max() ?? 0)
            // The smaller move that keeps the play in view: across (by its share of the width) or up.
            if right <= roomRight, right * aspect <= raise || raise > roomUp {
                frame.x -= (right + 0.005) * w
            } else if raise <= roomUp {
                frame.y -= (raise + 0.005) * frame.span
            } else {
                frame.span = min(frame.span * 1.12, widest)
            }
        }
        return frame
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

// MARK: - Turf

extension TheaterInk {
    /// The grass of a field marked out in lines (the gridiron, the pitch):
    /// the ballpark's tint in the dark; in the light a deeper green, so
    /// white chalk has something to stand on.
    var turf: Color { dark ? grass : Color(hue: 0.37, saturation: 0.4, brightness: 0.52).opacity(0.36) }
    /// Under the chalk in the light: a soft edge that keeps a white line
    /// crisp on pale grass (nothing in the dark).
    var chalkEdge: Color? { dark ? nil : Color(hue: 0.37, saturation: 0.5, brightness: 0.25).opacity(0.16) }
}

// MARK: - Figures and ball

/// A team's inks for one frame, resolved once: resolving a team color was
/// most of a stroke's cost. A limb behind the body is the jersey (or an
/// official's slacks) shaded by how far behind it is (a few steps, from the
/// jersey to its deepest), each shade resolved the first time a figure needs
/// it: most frames need only the deepest.
struct FigureInks {
    let rim, inner, jersey, cap: GraphicsContext.Shading
    /// The legs: the jersey's, or an official's shorts or slacks.
    let legs: GraphicsContext.Shading
    /// An official's stripes, if the uniform has them.
    let stripes: GraphicsContext.Shading?
    /// Whether the legs differ from the jersey: then each limb is drawn on its own.
    let dressed: Bool
    private let color: Color
    private let legColor: Color
    private let deepest: Double
    private let shades = Shades(), legShades = Shades()

    private final class Shades {
        var resolved = [GraphicsContext.Shading?](repeating: nil, count: RigFigure.shades)
    }

    init(_ uniform: Uniform, ink: TheaterInk, in context: GraphicsContext) {
        let rim = uniform.piping ?? ink.halo
        self.rim = context.resolve(.color(rim))
        inner = context.resolve(.color(rim.opacity(0.7)))
        jersey = context.resolve(.color(uniform.jersey))
        cap = context.resolve(.color(uniform.cap))
        legs = uniform.legs.map { context.resolve(.color($0)) } ?? jersey
        stripes = uniform.stripes.map { context.resolve(.color($0)) }
        dressed = uniform.legs != nil
        color = uniform.jersey
        legColor = uniform.legs ?? uniform.jersey
        deepest = ink.dark ? 0.32 : 0.22
    }

    /// The jersey `k` steps behind the body (0: the jersey itself).
    func shade(_ k: Int, in context: GraphicsContext) -> GraphicsContext.Shading {
        shade(k, of: color, base: jersey, cache: shades, in: context)
    }

    /// A limb `k` steps behind the body: an arm in the jersey, a leg in the legs' color.
    func shade(_ k: Int, of limb: RigFigure.Limb, in context: GraphicsContext) -> GraphicsContext.Shading {
        limb.arm ? shade(k, in: context) : shade(k, of: legColor, base: legs, cache: legShades, in: context)
    }

    private func shade(_ k: Int, of color: Color, base: GraphicsContext.Shading, cache: Shades, in context: GraphicsContext) -> GraphicsContext.Shading {
        let k = min(max(k, 0), RigFigure.shades - 1)
        guard k > 0 else { return base }
        if let shading = cache.resolved[k] { return shading }
        let shading = context.resolve(.color(color.mix(with: .black, by: deepest * Double(k) / Double(RigFigure.shades - 1))))
        cache.resolved[k] = shading
        return shading
    }
}

enum TheaterDraw {
    /// A pictogram, as one solid figure. Its outline first, round all of it
    /// at once (so the lines and figures behind stop short of it, and where
    /// its parts meet it never doubles up); the limbs behind the body (shaded
    /// by how far behind) and the body; then the head and the limbs in front,
    /// far to near, the head over a limb it's in front of and under one
    /// across its face. A limb in front crosses what's drawn already with one
    /// fine line in the outline's ink, only there: never over the outline,
    /// never round its own root (it grows out of the body), fading in as it
    /// comes round in front. The head takes the same line where it covers a
    /// limb. Small figures keep the outline alone: the lines would only blur
    /// them. Fading in or out, it's drawn as one layer, so it never shows
    /// through itself.
    static func figure(_ figure: RigFigure, inks: FigureInks, height: CGFloat, opacity: Double, in context: GraphicsContext) {
        guard opacity < 1 else { return draw(figure, inks: inks, height: height, in: context) }
        var faded = context
        faded.opacity = opacity
        faded.drawLayer { draw(figure, inks: inks, height: height, in: $0) }
    }

    /// The line where a limb in front crosses: this far out either side of it.
    static let line: CGFloat = 0.6
    /// The smallest figure that carries those lines.
    static let lined: CGFloat = 15

    /// The outline's width round a figure `height` tall.
    static func halo(_ height: CGFloat) -> CGFloat { max(height * 0.045, 0.8) }

    /// A figure's silhouette, every part grown by `grown`, as one shape (its
    /// capsules wound alike, so they fill as their union): his outline at
    /// the halo; a name tag's ring round him a little wider.
    static func outline(_ figure: RigFigure, grown: CGFloat) -> Path {
        let w = figure.limb / 2
        var outline = Path()
        for l in figure.limbs {
            capsule(l.root, l.joint, w + grown, into: &outline)
            capsule(l.joint, l.end, w + grown, into: &outline)
        }
        capsule(figure.hip, figure.neck, figure.torso / 2 + grown, into: &outline)
        capsule(figure.head, figure.head, figure.headRadius + grown, into: &outline)
        return outline
    }

    private static func draw(_ figure: RigFigure, inks: FigureInks, height: CGFloat, in context: GraphicsContext) {
        let w = figure.limb / 2, limbs = figure.limbs
        // The outline: every part's, grown by the halo, filled as one shape.
        context.fill(outline(figure, grown: halo(height)), with: inks.rim)
        let style = StrokeStyle(lineWidth: figure.limb, lineCap: .round, lineJoin: .round)
        func paint(_ l: RigFigure.Limb, _ shade: Int) {
            var p = Path()
            p.addLines([l.root, l.joint, l.end])
            context.stroke(p, with: inks.shade(shade, of: l, in: context), style: style)
        }
        // Behind the body, far to near: a run of the same shade in one stroke (one at a time in an official's kit).
        var drawn: [Bone] = []
        var i = 0
        while i < limbs.count, !limbs[i].front {
            let shade = limbs[i].shade
            if inks.dressed {
                paint(limbs[i], shade)
                drawn += Bone.of(limbs[i], w)
                i += 1
                continue
            }
            var run = Path()
            while i < limbs.count, !limbs[i].front, limbs[i].shade == shade {
                run.addLines([limbs[i].root, limbs[i].joint, limbs[i].end])
                drawn += Bone.of(limbs[i], w)
                i += 1
            }
            context.stroke(run, with: inks.shade(shade, in: context), style: style)
        }
        context.stroke(figure.body, with: inks.jersey, style: StrokeStyle(lineWidth: figure.torso, lineCap: .round))
        if let ink = inks.stripes { zebra(figure, ink: ink, in: context) }
        drawn.append(Bone(a: figure.hip, b: figure.neck, r: figure.torso / 2, body: true))
        let head = Path(ellipseIn: figure.headRect)
        let under = limbs[i...].filter(\.underHead), over = limbs[i...].filter { !$0.underHead }
        // Small: the limbs in front in a stroke either side of the head.
        guard height >= lined else {
            func stroke(_ group: [RigFigure.Limb]) {
                guard !group.isEmpty else { return }
                guard !inks.dressed else { return group.forEach { paint($0, 0) } }
                var p = Path()
                for l in group { p.addLines([l.root, l.joint, l.end]) }
                context.stroke(p, with: inks.jersey, style: style)
            }
            stroke(under)
            context.fill(head, with: inks.cap)
            stroke(over)
            return
        }
        func cross(_ l: RigFigure.Limb) {
            let r = w + line, fade = Rig.smooth(-l.depth / 0.015)
            // A leg's top always overlaps the body's round bottom: it crosses the body only with its knee across it (a knee drive, a high step).
            let crossed = fade > 0.01 ? drawn.filter { b in
                (b.near(l.root, l.joint, r) || b.near(l.joint, l.end, r)) && (l.arm || !b.body || b.near(l.joint, l.joint, r))
            } : []
            if !crossed.isEmpty {
                // Its line: square at the root, round at the joint and the end; kept to what it crosses.
                var ring = Path()
                capsule(l.root, l.joint, r, flat: true, into: &ring)
                capsule(l.joint, l.end, r, into: &ring)
                var over = Path()
                for b in crossed { capsule(b.a, b.b, b.r, into: &over) }
                var c = context
                c.clip(to: over)
                c.opacity *= fade
                c.fill(ring, with: inks.inner)
            }
            paint(l, 0)
            drawn += Bone.of(l, w)
        }
        under.forEach(cross)
        if !under.isEmpty {
            var covered = Path()
            for l in under { for b in Bone.of(l, w) { capsule(b.a, b.b, b.r, into: &covered) } }
            var c = context
            c.clip(to: covered)
            c.fill(Path(ellipseIn: figure.headRect.insetBy(dx: -line, dy: -line)), with: inks.inner)
        }
        context.fill(head, with: inks.cap)
        drawn.append(Bone(a: figure.head, b: figure.head, r: figure.headRadius))
        over.forEach(cross)
    }

    /// An official's shirt, as a pictogram draws it: a few bold, even black
    /// stripes down the torso, white between them and at its edges, clipped
    /// to the body's own shape (the arms and the head go over it as they
    /// would over a jersey). Three where the torso has room for them to
    /// read, two on a small figure (`zebraBands`).
    static func zebra(_ figure: RigFigure, ink: GraphicsContext.Shading, in context: GraphicsContext) {
        let a = figure.hip, b = figure.neck, r = figure.torso / 2
        let d = hypot(b.x - a.x, b.y - a.y)
        let along = d > 1e-6 ? CGVector(dx: (b.x - a.x) / d, dy: (b.y - a.y) / d) : CGVector(dx: 0, dy: -1)
        let across = CGVector(dx: -along.dy, dy: along.dx)
        let bands = zebraBands(figure.torso)
        var stripes = Path()
        var x = -r + bands.white
        for _ in 0..<bands.count {
            // Each stripe overruns the body's round ends: the clip trims it.
            func corner(_ o: CGFloat, _ from: CGPoint, _ out: CGFloat) -> CGPoint {
                CGPoint(x: from.x + across.dx * o + along.dx * out, y: from.y + across.dy * o + along.dy * out)
            }
            stripes.addLines([corner(x, a, -r), corner(x + bands.black, a, -r), corner(x + bands.black, b, r), corner(x, b, r)])
            stripes.closeSubpath()
            x += bands.black + bands.white
        }
        var body = Path()
        capsule(a, b, r, into: &body)
        var layer = context
        layer.clip(to: body)
        layer.fill(stripes, with: ink)
    }

    /// The zebra's stripes for a torso this wide: how many black ones, and
    /// how wide each black and white band is (black nearly twice as wide
    /// as white, so they read bold): three once the torso has room for
    /// them, two on a small figure, one on the smallest. (pure; tested)
    static func zebraBands(_ torso: CGFloat) -> (count: Int, black: CGFloat, white: CGFloat) {
        let count = torso >= 4 ? 3 : torso >= 2.2 ? 2 : 1
        // `count` black at 1.8 units, `count + 1` white at 1.
        let unit = torso / (CGFloat(count) * 1.8 + CGFloat(count + 1))
        return (count, unit * 1.8, unit)
    }

    /// A drawn part of a figure: a segment and how far round it.
    private struct Bone {
        var a: CGPoint
        var b: CGPoint
        var r: CGFloat
        /// The body itself (hip to neck).
        var body = false

        static func of(_ l: RigFigure.Limb, _ r: CGFloat) -> [Bone] { [Bone(a: l.root, b: l.joint, r: r), Bone(a: l.joint, b: l.end, r: r)] }

        /// Within `r` of the segment from `p` to `q`, beyond its own reach.
        func near(_ p: CGPoint, _ q: CGPoint, _ r: CGFloat) -> Bool {
            func side(_ o: CGPoint, _ u: CGPoint, _ v: CGPoint) -> Bool { (u.x - o.x) * (v.y - o.y) - (u.y - o.y) * (v.x - o.x) > 0 }
            if side(a, b, p) != side(a, b, q), side(p, q, a) != side(p, q, b) { return true }
            let gap = min(RigFigure.nearest(p, a, b).gap, RigFigure.nearest(q, a, b).gap, RigFigure.nearest(a, p, q).gap, RigFigure.nearest(b, p, q).gap)
            return gap < r + self.r
        }
    }

    /// A capsule round a segment (a disc where its ends meet; square at `a`
    /// if `flat`), always wound the same way, so any number of them fill as
    /// their union.
    private static func capsule(_ a: CGPoint, _ b: CGPoint, _ r: CGFloat, flat: Bool = false, into p: inout Path) {
        let dx = b.x - a.x, dy = b.y - a.y
        let angle = dx * dx + dy * dy > 1e-12 ? atan2(dy, dx) : 0
        let n = CGVector(dx: -sin(angle) * r, dy: cos(angle) * r)
        p.move(to: CGPoint(x: b.x + n.dx, y: b.y + n.dy))
        p.addArc(center: b, radius: r, startAngle: .radians(angle + .pi / 2), endAngle: .radians(angle - .pi / 2), clockwise: true)
        if flat {
            p.addLine(to: CGPoint(x: a.x - n.dx, y: a.y - n.dy))
            p.addLine(to: CGPoint(x: a.x + n.dx, y: a.y + n.dy))
        } else {
            p.addArc(center: a, radius: r, startAngle: .radians(angle - .pi / 2), endAngle: .radians(angle - 3 * .pi / 2), clockwise: true)
        }
        p.closeSubpath()
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

// MARK: - Bursts

/// A celebration on a theater's stage (a touchdown's or a goal's fireworks,
/// the headline's confetti), sized by the well: its spread in proportion to
/// the well's height, as big in the compact panel as in a wide one, its
/// strokes growing more slowly so a big burst stays finely drawn; and kept
/// far enough inside the well that it isn't cut off at an edge.
enum TheaterBurst {
    /// How far a burst spreads, as a multiple of the charts' bursts: about
    /// two fifths of the well's height either way.
    static func scale(_ height: CGFloat) -> Double { 2.7 * pow(max(Double(height), 120) / 156, 0.75) }

    /// The particles of a burst at the origin, spread by `scale`.
    static func spread(_ particles: [Celebration.Particle], by scale: Double) -> [Celebration.Particle] {
        let fine = pow(scale, 0.6)
        func far(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * scale, y: p.y * scale) }
        return particles.map { p in
            var q = p
            q.center = far(p.center)
            switch p.shape {
            case let .piece(size, corner): q.shape = .piece(CGSize(width: size.width * fine, height: size.height * fine), corner: corner * fine)
            case let .streak(from, to, width): q.shape = .streak(from: far(from), to: far(to), width: width * fine)
            case let .ring(radius, width): q.shape = .ring(radius: radius * scale, width: width * fine)
            case let .disc(radius): q.shape = .disc(radius: radius * fine)
            case let .ball(radius): q.shape = .ball(radius: radius * fine)
            }
            return q
        }
    }

    /// A burst's origin, moved in from the well's edges so most of it
    /// shows, and down clear of the headline's band.
    static func inside(_ p: CGPoint, _ size: CGSize) -> CGPoint {
        let m = min(size.height * 0.3, size.width * 0.2)
        return CGPoint(x: min(max(p.x, m), size.width - m), y: min(max(p.y, size.height * 0.36), size.height - m))
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
    /// The headline's size for its words: stepped down for a long one in a
    /// narrow well (TURNOVER ON DOWNS in the compact panel), so it never
    /// runs off the sides. (Wide heavy capitals and their tracking about
    /// 0.92 of the size each; the rules either side about 3.1.)
    static func banner(_ size: CGSize, fitting text: String) -> CGFloat {
        min(banner(size), size.width * 0.92 / (0.92 * CGFloat(text.count) + 3.1))
    }
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
