import SwiftUI

// The play theater's broadcast camera: a virtual camera inside the field's
// projection, so every line is drawn at its zoom, never a scaled bitmap.
// Each play is cut into shots (tight on the battery for the pitch, the ball
// and the fielder going for it, each throw, then the runners' last bases),
// and each shot names what must be in frame. The camera follows on a
// critically damped spring (no overshoot, no wobble), with a cap on how
// fast it pans and zooms, and shots hand over through a short blend, so a
// move eases in as well as out. The track is integrated once, when the
// script is built; any frame reads it at t. Between plays it rests on the
// infield and the runners.

/// Where the camera looks: the middle of the view and how much field it
/// takes in, in projected feet (x across; y up the screen, a point's
/// y × 0.5 + z × 0.82, as the projection draws it).
struct CameraFrame: Equatable {
    var x: Double
    var y: Double
    /// Feet from the bottom of the view to the top.
    var span: Double

    /// The well's shape: half as tall as wide (wider panels see more at the sides).
    static let aspect = 2.0
    /// Kept clear at the bottom and the sides, as fractions of the view.
    static let margin = 0.05
    /// Kept clear at the top: a little, or room for the banner.
    static let headroom = 0.07
    static let bannerRoom = 0.22
    /// The closest it goes (the battery) and the widest (the whole park).
    static let tightest = 40.0
    static let widest = 290.0

    /// The framing that fits a region (projected feet, y up) in the view
    /// under `headroom`, no tighter than `closest`.
    static func fitting(_ region: CGRect, headroom: Double = headroom, closest: Double = tightest) -> CameraFrame {
        let tall = 1 - headroom - margin, wide = aspect * (1 - 2 * margin)
        let span = min(max(region.height / tall, region.width / wide, closest, tightest), widest)
        return CameraFrame(x: region.midX, y: region.midY + (headroom - margin) * span / 2, span: span)
    }

    /// The same, keeping every figure and ball out of a bottom-left corner
    /// (the scorer's mark: its width and height as fractions of the view).
    /// The framing slides the least it can (right or up) to clear it, and
    /// widens only when neither fits. `items` must stay in view; `others`
    /// (bystanders) need only stay out of the corner.
    static func fitting(_ region: CGRect, items: [CGRect], others: [CGRect] = [], headroom: Double, closest: Double,
                        corner: CGSize) -> CameraFrame {
        var frame = fitting(region, headroom: headroom, closest: closest)
        guard corner.width > 0, corner.height > 0 else { return frame }
        for _ in 0..<5 {
            let w = frame.span * aspect
            func across(_ x: Double) -> Double { 0.5 + (x - frame.x) / w }
            func up(_ y: Double) -> Double { 0.5 + (y - frame.y) / frame.span }
            // Only what's in view counts.
            func inView(_ r: CGRect) -> Bool { across(r.maxX) > 0 && across(r.minX) < 1 && up(r.maxY) > 0 && up(r.minY) < 1 }
            let shown = items.filter(inView)
            let inside = (shown + others.filter(inView)).filter { across($0.minX) < corner.width && up($0.minY) < corner.height }
            guard !inside.isEmpty else { return frame }
            let right = inside.map { corner.width - across($0.minX) }.max() ?? 0
            let raise = inside.map { corner.height - up($0.minY) }.max() ?? 0
            let roomRight = 1 - margin - (shown.map { across($0.maxX) }.max() ?? 0)
            let roomUp = 1 - headroom - (shown.map { up($0.maxY) }.max() ?? 0)
            if right <= roomRight, right * aspect <= raise || raise > roomUp {
                frame.x -= right * w
                return frame
            }
            if raise <= roomUp {
                frame.y -= raise * frame.span
                return frame
            }
            frame.span = min(frame.span * 1.15, widest)
        }
        return frame
    }

    /// Between plays: the four bases, the mound and the battery, with the
    /// runners' leads, set a touch right of center so the widest scorer's
    /// mark ("4–6–3 DP") clears the batter's box.
    static let rest: CameraFrame = {
        let infield = PlayScript.Shot.infield
        var box = PlayScript.Box()
        for p in infield { box.add(p, figure: true) }
        return fitting(box.rect, items: box.items, headroom: headroom, closest: tightest, corner: CGSize(width: 0.47, height: 0.3))
    }()

    /// Part way to another framing; the zoom eases in proportion.
    func mix(_ other: CameraFrame, _ u: Double) -> CameraFrame {
        CameraFrame(x: x + (other.x - x) * u, y: y + (other.y - y) * u, span: span * pow(other.span / span, u))
    }
}

extension PlayScript {
    /// One shot of the broadcast: from when, and what it keeps in frame.
    struct Shot: Equatable {
        var from: Double
        /// A flight's ball, now and a beat ahead, and its shadow.
        var flight: Int? = nil
        /// Figures by index, now and a beat ahead.
        var actors: [Int] = []
        /// Fixed spots: a base, the wall.
        var points: [FieldPoint] = []
        /// No closer than this (feet top to bottom).
        var closest = CameraFrame.tightest
        /// A cut, not a move: the camera is simply there (the home run's trot).
        var cut = false

        /// The battery: the pitcher on the rubber, the batter (either box)
        /// and the catcher.
        static let battery: [FieldPoint] = [FieldPoint(x: 0, y: 56), FieldPoint(x: -9, y: 1), FieldPoint(x: 9, y: 1),
                                            FieldPoint(x: 0, y: -8)]
        /// The bases, the plate and the infielders where they play (so the
        /// banner never sits on the middle infielders).
        static let infield: [FieldPoint] = [FieldPoint(Ballpark.base(1)), FieldPoint(Ballpark.base(2)), FieldPoint(Ballpark.base(3)),
                                            FieldPoint(x: 0, y: -8), FieldPoint(x: -9, y: 1), FieldPoint(x: 9, y: 1),
                                            FieldPoint(Ballpark.position(4)), FieldPoint(Ballpark.position(6))]

        /// A region in projected feet (y up) around spots where figures
        /// stand: room for a figure's height above each, a little below.
        static func region(_ points: [FieldPoint], figures: Bool = true) -> CGRect {
            var box = Box()
            for p in points { box.add(p, figure: figures) }
            return box.rect
        }

        /// What it keeps in frame at t.
        func region(in script: PlayScript, at t: Double) -> Box {
            var box = Box()
            for p in points { box.add(p, figure: true) }
            if let flight, flight < script.flights.count {
                let f = script.flights[flight]
                for dt in [0, 0.2, 0.45] {
                    let p = f.point(at: min(max(t + dt, f.start), f.end))
                    box.add(p, figure: false)
                    box.add(FieldPoint(p.ground), figure: false)
                }
            }
            for index in actors where index < script.actors.count {
                let actor = script.actors[index]
                for dt in [0, 0.25] where actor.opacity(at: t + dt) > 0.5 {
                    box.add(FieldPoint(actor.position(at: t + dt)), figure: true)
                }
            }
            return box
        }
    }

    /// What a shot keeps in frame, in projected feet: each figure's or
    /// ball's room, and the box round them all.
    struct Box {
        var items: [CGRect] = []

        mutating func add(_ p: FieldPoint, figure: Bool) {
            let x = p.x, y = p.y * 0.5 + p.z * 0.82
            // A figure stands about 9 ft tall on screen (drawn larger than life); a ball needs a little room.
            let below = figure ? 3.0 : 5.0, above = figure ? 10.0 : 5.0
            items.append(CGRect(x: x - 6, y: y - below, width: 12, height: below + above))
        }

        mutating func add(_ other: Box) { items += other.items }

        var rect: CGRect {
            guard let first = items.first else { return Shot.region(Shot.infield) }
            return items.dropFirst().reduce(first) { $0.union($1) }
        }
    }
}

/// The camera through a play: framings every 1/60 s from the first pitch to
/// the field settling, then an eased move to the rest framing, which it
/// reaches exactly as the replay ends.
struct CameraTrack: Equatable {
    static let rate = 60.0

    var samples: [CameraFrame] = []
    var settle = 0.0
    /// When it reaches the rest framing.
    var back = 0.0
    /// Where it rests: the infield (a pitch with another to follow stays on the battery).
    var rest = CameraFrame.rest

    func frame(at t: Double) -> CameraFrame {
        guard !samples.isEmpty, t < back else { return rest }
        if t >= settle {
            let u = (t - settle) / max(back - settle, 0.01)
            return sample(settle).mix(rest, u * u * (3 - 2 * u))
        }
        return sample(t)
    }

    /// A track already followed (a beat's: CameraFollow over its framings), resting where it ends.
    init(samples: [CameraFrame], rest: CameraFrame) {
        self.samples = samples
        settle = Double(max(samples.count - 1, 0)) / Self.rate
        back = settle + 0.001
        self.rest = rest
    }

    private func sample(_ t: Double) -> CameraFrame {
        let i = max(t, 0) * Self.rate
        let lower = min(Int(i), samples.count - 1), upper = min(lower + 1, samples.count - 1)
        return samples[lower].mix(samples[upper], min(i - Double(lower), 1))
    }

    /// Follows the shots' framings on a critically damped spring: pan and
    /// zoom (in log space, so zooming feels even), with capped speeds: pans
    /// at 1.4 view-heights a second, zooms in at ×3 a second and out at ×9
    /// (pulling back to find a ball off the bat can't wait; pushing in
    /// can). A new shot blends in over 0.4 s; one far from the last pulls
    /// back through a shot of both and pushes in again (0.9 s), as a
    /// broadcast camera would, rather than sliding across the field. While
    /// the scorer's mark is up, nothing stays in its corner.
    init(shots: [PlayScript.Shot], script: PlayScript, settle: Double, back: Double) {
        self.settle = settle
        self.back = back
        guard !shots.isEmpty else { return }
        func band(_ t: Double) -> Double {
            guard let banner = script.banner else { return CameraFrame.headroom }
            func smooth(_ x: Double) -> Double { let u = min(max(x, 0), 1); return u * u * (3 - 2 * u) }
            let up = smooth((t - banner.at + 0.5) / 0.4) * (1 - smooth((t - banner.until) / 0.4))
            return CameraFrame.headroom + (CameraFrame.bannerRoom - CameraFrame.headroom) * up
        }
        func smooth(_ x: Double) -> Double { let u = min(max(x, 0), 1); return u * u * (3 - 2 * u) }
        func lerp(_ a: CGRect, _ b: CGRect, _ s: Double) -> CGRect {
            CGRect(x: a.minX + (b.minX - a.minX) * s, y: a.minY + (b.minY - a.minY) * s,
                   width: a.width + (b.width - a.width) * s, height: a.height + (b.height - a.height) * s)
        }
        func goal(_ t: Double) -> CameraFrame {
            let k = shots.lastIndex { $0.from <= t } ?? 0
            let shot = shots[k]
            var box = shot.region(in: script, at: t)
            var region = box.rect, closest = shot.closest
            if k > 0, !shot.cut {
                let before = shots[k - 1].region(in: script, at: t)
                let a = before.rect, b = region
                let far = hypot(a.midX - b.midX, a.midY - b.midY) > 0.6 * max(min(a.height, b.height), 60)
                let length = far ? 0.9 : 0.4, x = (t - shot.from) / length
                if x < 1 {
                    let both = a.union(b)
                    region = far ? (x < 0.5 ? lerp(a, both, smooth(2 * x)) : lerp(both, b, smooth(2 * x - 1))) : lerp(a, b, smooth(x))
                    closest = shots[k - 1].closest + (closest - shots[k - 1].closest) * smooth(x)
                    // Mid-blend, both shots' figures stay out of the mark's corner.
                    box.add(before)
                }
            }
            guard script.stamp.isFinite, t >= script.stamp - 0.3 else { return CameraFrame.fitting(region, headroom: band(t), closest: closest) }
            // The mark never sits on anyone in view, in the play or not.
            var others = PlayScript.Box()
            for actor in script.actors where actor.opacity(at: t) > 0.5 { others.add(FieldPoint(actor.position(at: t)), figure: true) }
            return CameraFrame.fitting(region, items: box.items, others: others.items, headroom: band(t), closest: closest,
                                       corner: script.corner)
        }
        // One step a sample (semi-implicit Euler: at ω·dt ≈ 0.12, stable and smooth).
        let dt = 1 / Self.rate, pan = 7.0, zoom = 7.0
        let first = goal(0)
        var x = first.x, y = first.y, z = log(first.span), vx = 0.0, vy = 0.0, vz = 0.0
        samples.reserveCapacity(Int(settle * Self.rate) + 2)
        samples.append(first)
        var t = 0.0
        let cuts = shots.filter(\.cut).map(\.from)
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
    }

    init() {}
}

// MARK: - Shots

extension PlayScript.Builder {
    /// Cuts the play into shots: tight on the battery through the pitch;
    /// on contact the ball and the fielder going for it (a grounder stays on
    /// the infield, a fly widens with its height and distance, a home run is
    /// chased to the wall and held for its fireworks); each throw, end to
    /// end; then the runners' last bases, where it rests.
    mutating func shoot() {
        typealias Shot = PlayScript.Shot
        var shots = [Shot(from: 0, points: Shot.battery)]
        var end = contact + 0.45, running = false
        if let i = script.batted {
            let flight = script.flights[i]
            if let fence = script.fence {
                let target = flight.to.ground
                let bearing = Ballpark.bearing(target), degrees = bearing * 180 / .pi
                let wall = Ballpark.polar(Ballpark.fence(bearing), degrees)
                let chaser = script.actors.indices.filter { $0 < 9 }.min { a, b in
                    hypot(script.actors[a].position(at: fence.at).x - wall.x, script.actors[a].position(at: fence.at).y - wall.y)
                        < hypot(script.actors[b].position(at: fence.at).x - wall.x, script.actors[b].position(at: fence.at).y - wall.y)
                }
                shots.append(Shot(from: contact - 0.08, flight: i, actors: chaser.map { [$0] } ?? [],
                                  points: [FieldPoint(wall, z: Ballpark.wallHeight)], closest: 70))
                // Held on the wall for the fireworks, with room for them above it.
                let side = CGPoint(x: wall.y / max(Ballpark.distance(wall), 1) * 40, y: -wall.x / max(Ballpark.distance(wall), 1) * 40)
                shots.append(Shot(from: fence.at + 0.1, points: [FieldPoint(x: wall.x - side.x, y: wall.y - side.y, z: 30),
                                                                 FieldPoint(x: wall.x + side.x, y: wall.y + side.y, z: 30),
                                                                 FieldPoint(target), FieldPoint(wall)], closest: 100))
                // Cut to the trot: the batter coming home behind his runners (a broadcast cuts; it doesn't sweep the park).
                let home = script.flashes.filter { $0.beat == .run }.map(\.at).max() ?? fence.at + 1.2
                let trotting = [batter] + crossings.map { $0.actor }.filter { $0 != batter }
                shots.append(Shot(from: fence.at + Self.trotCut, actors: trotting, points: [FieldPoint(x: 0, y: 0), FieldPoint(Ballpark.base(3))],
                                  cut: true))
                shots.append(Shot(from: max(home + 0.1, fence.at + 1.2), points: Shot.infield))
                script.shots = shots
                script.camera = CameraTrack(shots: shots, script: script, settle: script.settle, back: script.duration)
                return
            }
            let first = handling?.fielder ?? scene.fielders.first ?? scene.error ?? Ballpark.nearest(to: flight.to.ground)
            // A beat before contact the camera starts to open up, as an operator reads the swing.
            shots.append(Shot(from: contact - 0.08, flight: i, actors: [fielder(first)], closest: 56))
            end = flight.end + 0.35
            // A clean hit: once the ball's run down, the story is the runners, not the relay to the
            // cutoff man. As the ball's gathered in the outfield it cuts to the batter taking his base
            // (sliding into third), or for a single to the infield and its runners.
            let outfield = Ballpark.distance(flight.to.ground) > 200
            if !scene.runners.contains(where: \.isOut), case let .base(b)? = scene.batter?.end, b >= 2 || outfield,
               let gathered = script.actors[fielder(first)].actions.first(where: { $0.kind == .scoop })?.at {
                if let last = crossings.last?.at {
                    // Runs: the camera takes the lead runner home, and each one after him, then the batter at his base.
                    shots.append(Shot(from: gathered, actors: crossings.map { $0.actor }, points: [FieldPoint(x: 0, y: 0)], cut: outfield))
                    end = last + 0.35
                    if b >= 2, let reach = script.actors[batter].moves.first(where: { $0.path.last == Ballpark.base(b) })?.end {
                        shots.append(Shot(from: last + 0.15, actors: [batter], points: [FieldPoint(Ballpark.base(b)), FieldPoint(Ballpark.base(b - 1))],
                                          cut: true))
                        end = max(end, reach + 0.5)
                    }
                } else if b >= 2, let reach = script.actors[batter].moves.first(where: { $0.path.last == Ballpark.base(b) })?.end {
                    shots.append(Shot(from: gathered, actors: [batter], points: [FieldPoint(Ballpark.base(b)), FieldPoint(Ballpark.base(b - 1))],
                                      cut: outfield))
                    end = reach + 0.5
                } else {
                    shots.append(Shot(from: gathered, points: Shot.infield, cut: true))
                    end = gathered
                }
                running = true
            }
        }
        // The throws (and a ball that gets away), end to end; a rundown's, all its bases at once. (After the
        // pitch: a pickoff has none, and its throw can come before a pitch would have.)
        let primary = Set([0, script.batted].compactMap { $0 }), after = script.release == nil ? 0 : contact - 0.3
        let rundown = script.batted == nil ? script.flights.indices.filter { !primary.contains($0) && script.flights[$0].start > after } : []
        if rundown.count > 1, let first = rundown.first, let last = rundown.last {
            shots.append(Shot(from: max(script.flights[first].start - 0.3, (shots.last?.from ?? 0) + 0.25),
                              points: rundown.flatMap { [FieldPoint(script.flights[$0].from.ground), FieldPoint(script.flights[$0].to.ground)] }))
            end = max(end, script.flights[last].end + 0.2)
            running = true
        }
        for (j, flight) in script.flights.enumerated() where !primary.contains(j) && flight.start > after && !running {
            let from = max(flight.start - 0.3, (shots.last?.from ?? 0) + 0.25)
            shots.append(Shot(from: from, flight: j, points: [FieldPoint(flight.from.ground), FieldPoint(flight.to.ground)]))
            end = max(end, flight.end + 0.2)
        }
        // Runs after the throws (or a catch): the camera takes each one home (cutting in from the outfield).
        if let lead = crossings.first?.at, let last = crossings.last?.at, !running, script.fence == nil {
            let onBall = script.batted.map { b in shots.last?.flight == b && Ballpark.distance(script.flights[b].to.ground) > 200 } ?? false
            shots.append(Shot(from: max(lead - 0.9, (shots.last?.from ?? 0) + 0.35), actors: crossings.map { $0.actor },
                              points: [FieldPoint(x: 0, y: 0)], cut: onBall))
            end = max(end, last + 0.35)
        }
        // A strikeout's mark sinks in on the battery before it widens.
        if script.batted == nil, script.stamp.isFinite { end = max(end, script.stamp + 0.5) }
        shots.append(Shot(from: min(max(end, (shots.last?.from ?? 0) + 0.25), script.settle - 0.2), points: Shot.infield))
        script.shots = shots
        script.camera = CameraTrack(shots: shots, script: script, settle: script.settle, back: script.duration)
    }
}
