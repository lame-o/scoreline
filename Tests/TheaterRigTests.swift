import SwiftUI

// The theaters' rig (TheaterRig.swift), checked on its own and on every
// fixture play of all three sports: feet that stay put while they're down,
// a stride that follows speed, knees and elbows that only bend their own
// way, a heading that turns at a limited rate, limbs that swap in front of
// and behind the body as it turns past the camera, and the projections.

extension ScorelineTests {
    static func theaterRig() {
        print("\nTheater rig")
        let height = 8.5, unit = 1.1 / height

        /// A figure running a straight line, diagonally, at `pace` heights a second (eased: from a standing start, peaking at it), and his track.
        func run(_ pace: Double, length: Double = 160, ease: PlayScript.Ease = .linear) -> (move: PlayScript.Move, track: RigTrack) {
            let time = length / (pace * height) * (ease == .linear ? 1 : 1.5)
            let move = PlayScript.Move(start: 0.3, end: 0.3 + time, path: [.zero, CGPoint(x: length * 0.8, y: length * 0.6)], ease: ease)
            let track = RigTrack(from: 0, through: move.end + 0.6, height: height, position: move.point(at:)) { _ in nil }
            return (move, track)
        }
        /// The skeleton at t through the whole pipeline (standing pose, stride, IK), and each foot in the field.
        func feet(_ track: RigTrack, _ position: (Double) -> CGPoint, at t: Double) -> (RigVector, RigVector) {
            let here = position(t), m = track.motion(at: t)
            let planted = track.feet(at: t, anchor: here, heading: m.heading, unit: unit, speed: m.speed, stand: (RigPose.stand.left, RigPose.stand.right))
            let k = RigSkeleton(RigPose.stand.mix(.gait(m, feet: planted), m.weight))
            func world(_ p: RigVector) -> RigVector {
                let w = Rig.yaw(p, m.heading)
                return RigVector(here.x + w.x / unit, here.y + w.y / unit, w.z / unit)
            }
            return (world(k.feet.0), world(k.feet.1))
        }

        // MARK: Planted feet

        // While a foot is down (from a moment after it lands to a moment before it lifts), it doesn't move: at a walk, a jog, a run, a sprint.
        var slips: [String] = []
        var worst = 0.0, fewest = Int.max
        for pace in [1.2, 3.0, 6.0, 9.0] {
            let (move, track) = run(pace)
            var slip = 0.0, stances = 0
            for (side, steps) in [(0, track.left), (1, track.right)] {
                // Steps at full pace: from a third of the way in to a third from the end.
                for s in steps where s.land.isFinite && s.lift.isFinite && s.land > move.start + (move.end - move.start) * 0.3
                    && s.lift < move.end - (move.end - move.start) * 0.3 {
                    let span = s.lift - s.land, a = s.land + span * 0.02, b = s.lift - span * 0.02
                    stances += 1
                    let first = side == 0 ? feet(track, move.point(at:), at: a).0 : feet(track, move.point(at:), at: a).1
                    for k in 1...24 {
                        let p = feet(track, move.point(at:), at: a + (b - a) * Double(k) / 24)
                        let q = side == 0 ? p.0 : p.1
                        slip = max(slip, hypot(q.x - first.x, q.y - first.y), abs(q.z))
                    }
                }
            }
            worst = max(worst, slip)
            fewest = min(fewest, stances)
            slips.append(String(format: "%.1f H/s %.3f mm over %d stances", pace, slip * 304.8, stances))
        }
        check(worst * 304.8 < 3 && fewest >= 4, "a foot down stays put: under 3 mm of the field while it's down, walking to sprinting", slips.joined(separator: ", "))
        print("    foot slip: " + slips.joined(separator: ", "))

        // MARK: Stride and cadence

        // Strides a second and the ground each covers, at pace: both grow with speed, and cover exactly the ground run.
        let gaits = [1.0, 2.0, 4.0, 7.0, 10.0].map { pace -> (cadence: Double, stride: Double, pace: Double) in
            let (move, track) = run(pace, length: 260)
            let middle = track.left.filter { $0.land > move.start + (move.end - move.start) * 0.35 && $0.land < move.end - (move.end - move.start) * 0.35 }
            guard let first = middle.first, let last = middle.last, middle.count > 2 else { return (0, 0, pace) }
            let n = Double(middle.count - 1)
            return (n / (last.land - first.land), hypot(last.at.x - first.at.x, last.at.y - first.at.y) / n / height, pace)
        }
        let rising = zip(gaits, gaits.dropFirst()).allSatisfy { $0.cadence < $1.cadence && $0.stride < $1.stride }
        let covers = gaits.allSatisfy { g in g.cadence > 0 && abs(g.cadence * g.stride - g.pace) / g.pace < 0.03 }
        check(rising && covers, "cadence and stride both grow with speed, and a stride is exactly the ground covered (no slide)",
              gaits.map { String(format: "%.0f H/s: %.2f Hz × %.2f H", $0.pace, $0.cadence, $0.stride) }.joined(separator: ", "))
        print("    gait: " + gaits.map { String(format: "%.0f H/s %.2f Hz × %.2f H", $0.pace, $0.cadence, $0.stride) }.joined(separator: ", "))
        // No thresholds: a walk becomes a run continuously (each of its parts a smooth function of speed).
        let paces = stride(from: 0.0, through: 12, by: 0.01)
        let smooth = zip(paces, paces.dropFirst()).allSatisfy { a, b in
            abs(RigGait.cadence(b) - RigGait.cadence(a)) < 0.01 && abs(RigGait.duty(b) - RigGait.duty(a)) < 0.01 && abs(RigGait.run(b) - RigGait.run(a)) < 0.01
        }
        check(smooth, "walk, jog and sprint blend continuously: no threshold anywhere in the stride")
        // Starting and stopping: the stride begins and ends with both feet down, and it settles standing.
        let (move, track) = run(4, ease: .inOut)
        let rest = track.motion(at: .infinity), done = feet(track, move.point(at:), at: .infinity)
        check(rest.weight == 0 && abs(done.0.z) < 1e-6 && abs(done.1.z) < 1e-6 && track.motion(at: 0).weight == 0,
              "starting and stopping ease through a stride: standing at both ends, both feet down")

        // MARK: Heading

        // Out and back: the body turns round at no more than 11 rad/s, and faces where it's going once it's going there.
        let out = PlayScript.Move(start: 0.2, end: 1.4, path: [.zero, CGPoint(x: 60, y: 0)], ease: .inOut)
        let back = PlayScript.Move(start: 1.4, end: 2.6, path: [CGPoint(x: 60, y: 0), CGPoint(x: 0, y: 20)], ease: .inOut)
        let turning = RigTrack(from: 0, through: 3, height: height, position: { $0 < 1.4 ? out.point(at: $0) : back.point(at: $0) }) { _ in
            RigFacing(point: CGPoint(x: 0, y: -100))
        }
        let headings = stride(from: 0.0, through: 3, by: 1 / 60).map { turning.motion(at: $0).heading }
        let fastest = zip(headings, headings.dropFirst()).map { abs(remainder($1 - $0, 2 * .pi)) * 60 }.max() ?? 0
        let returning = atan2(20.0, -60.0), standing = atan2(-100.0, 0)
        check(fastest <= 11.01 && abs(remainder(turning.motion(at: 2.0).heading - returning, 2 * .pi)) < 0.05
              && abs(remainder(turning.motion(at: 3).heading - standing, 2 * .pi)) < 0.05,
              "the heading turns at no more than 11 rad/s, toward where he's running, then what he watches",
              String(format: "%.1f rad/s", fastest))

        // MARK: Depth

        // Side-on to the camera his left limbs are behind him (shaded) facing right, in front facing left; they swap as he turns past the camera.
        let f = FieldProjection(size: CGSize(width: 640, height: 320), camera: CameraFrame(x: 0, y: 30, span: 60))
        let lens = RigLens(f, at: CGPoint(x: 0, y: 30))
        let striding = RigPose.gait(RigMotion(heading: 0, phase: 0.1, speed: 5, push: 0, weight: 1),
                                    feet: (RigVector(0.12, 0.06, 0), RigVector(-0.16, -0.06, 0.18)))
        func leftInFront(_ heading: Double) -> (legs: Bool, arms: Bool) {
            let k = RigSkeleton(striding), figure = RigFigure(k, heading: heading, lens: lens)
            func front(_ p: RigVector) -> Bool { figure.limbs.first { $0.end == lens.point(Rig.yaw(p, heading)) }?.front ?? false }
            return (front(k.feet.0), front(k.hands.0))
        }
        let right = leftInFront(0), left = leftInFront(.pi)
        // Turning from facing right through facing the camera to facing left, the left leg comes in front once, and stays.
        let sweep = stride(from: 0.0, through: .pi, by: 0.05).map { leftInFront(-$0).legs }
        let swaps = zip(sweep, sweep.dropFirst()).filter { $0 != $1 }.count
        check(!right.legs && !right.arms && left.legs && left.arms && swaps == 1 && sweep.first == false && sweep.last == true,
              "limbs sort by depth: his left side behind him facing right, in front facing left, swapping once as he turns past the camera")
        let shaded = RigFigure(striding, heading: 0, lens: lens).limbs
        check(shaded.filter { !$0.front }.allSatisfy { $0.shade > 0 } && shaded.filter(\.front).allSatisfy { $0.shade == 0 }
              && zip(shaded, shaded.dropFirst()).allSatisfy { $0.depth >= $1.depth },
              "…drawn far to near: the ones behind shaded, the ones in front in the jersey")

        // MARK: Projections

        // A field offset from where he stands lands where the field's own projection puts it: isometric exactly, perspective to a hair.
        let offsets = [CGPoint(x: 1.5, y: 0), CGPoint(x: 0, y: 1.5), CGPoint(x: -1, y: 1)]
        func gap(_ lens: RigLens, _ p: CGPoint, _ field: (CGPoint) -> CGPoint) -> Double {
            offsets.map { d in
                let a = lens.point(RigVector(d.x * lens.unit, d.y * lens.unit, 0)), b = field(CGPoint(x: p.x + d.x, y: p.y + d.y))
                return hypot(a.x - b.x, a.y - b.y)
            }.max() ?? .infinity
        }
        let spot = CGPoint(x: 40, y: 70)
        let iso = gap(RigLens(f, at: spot), spot) { f.point($0) }
        let g = GridProjection(size: CGSize(width: 640, height: 320), camera: CameraFrame(x: 0, y: 40, span: 70), yaw: Gridiron.yaw)
        let grid = gap(RigLens(g, at: CGPoint(x: 10, y: 100)), CGPoint(x: 10, y: 100)) { g.point($0) }
        let pitch = PitchProjection(size: CGSize(width: 640, height: 320), camera: PitchFrame(camera: CameraFrame(x: 70, y: 30, span: 40)))
        let near = CGPoint(x: 80, y: 20)
        let perspective = gap(RigLens(pitch, at: near), near) { pitch.point($0) } / max(Double(RigLens(pitch, at: near).height), 1)
        let behind = PitchProjection(size: CGSize(width: 640, height: 320), camera: PitchFrame(camera: CameraFrame(x: 100, y: 34, span: 14),
                                                                                            angle: .behind(right: true)))
        let mouth = CGPoint(x: 103, y: 36)
        let reverse = gap(RigLens(behind, at: mouth), mouth) { behind.point($0) } / max(Double(RigLens(behind, at: mouth).height), 1)
        check(iso < 1e-6 && grid < 1e-6 && perspective < 0.03 && reverse < 0.03 && RigLens(pitch, at: near).height == pitch.figure(at: near),
              "the rig projects through each theater's own lens: dimetric (ballpark, gridiron) exactly, perspective (stand, behind the goal) to a hair",
              String(format: "%.2g, %.2g, %.3f, %.3f of his height", iso, grid, perspective, reverse))
        // Running at the lens, his stride is in depth: the feet apart up and down the screen, not across it.
        let toward = RigFigure(.gait(RigMotion(heading: -.pi / 2, phase: 0.1, speed: 5, push: 0, weight: 1),
                                     feet: (RigVector(0.18, 0.06, 0), RigVector(-0.18, -0.06, 0.05))), heading: -.pi / 2, lens: lens)
        let ends = toward.limbs.filter { abs($0.root.y - toward.hip.y) < 2 }.map(\.end)
        check(ends.count == 2 && abs(ends[0].y - ends[1].y) > abs(ends[0].x - ends[1].x),
              "running at the camera his stride goes toward and away from the lens: the feet apart in depth")

        // MARK: Drawn

        // Facing the camera: the head goes over hands cocked behind it and arms raised beside it, under an arm across its face.
        let facing = -Double.pi / 2
        func overHead(_ pose: RigPose) -> [(arm: Bool, crosses: Bool, under: Bool)] {
            let k = RigSkeleton(pose), figure = RigFigure(k, heading: facing, lens: lens)
            let hands = [k.hands.0, k.hands.1].map { lens.point(Rig.yaw($0, facing)) }
            return figure.limbs.map { l in
                let gap = min(RigFigure.nearest(figure.head, l.root, l.joint).gap, RigFigure.nearest(figure.head, l.joint, l.end).gap)
                return (hands.contains(l.end), gap < figure.headRadius + figure.limb / 2, l.underHead)
            }
        }
        let cocked = overHead(RigPose(lean: -0.18, leftArm: RigArm(swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8),
                                      rightArm: RigArm(swing: 3.0, spread: 0.18, turn: -0.2, bend: 0.8)))
        let raised = overHead(RigPose(leftArm: RigArm(swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06),
                                      rightArm: RigArm(swing: 3.05, spread: 0.1, turn: -0.1, bend: 0.06)))
        let across = overHead(RigPose(lean: -0.06, rightArm: RigArm(swing: 2.85, spread: 0.08, turn: -0.1, bend: 0.1)))
        let atEase = overHead(.stand)
        check(cocked.filter(\.arm).allSatisfy { $0.crosses && $0.under } && raised.filter(\.arm).allSatisfy { $0.crosses && $0.under }
              && across.contains { $0.arm && $0.crosses && !$0.under } && atEase.allSatisfy { !$0.crosses && !$0.under }
              && [cocked, raised, across, atEase].joined().allSatisfy { $0.crosses || !$0.under },
              "the head goes over hands cocked behind it and arms raised beside it, under an arm across its face; clear of it, neither")

        // Drawn as one solid figure: the outline one shape, never darker where its parts meet or where a limb's
        // line meets it; and fading, one layer: half the figure, not half of each part over the others.
        let white = Uniform(jersey: .white, cap: .white, accent: .white)
        func pixels(_ figure: RigFigure, opacity: Double, in uniform: Uniform = white) -> [UInt8] {
            let side = 240
            let view = Canvas { context, _ in
                let inks = FigureInks(uniform, ink: TheaterInk(.dark), in: context)
                TheaterDraw.figure(figure, inks: inks, height: 60, opacity: opacity, in: context)
            }.frame(width: 120, height: 120)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            guard let image = renderer.cgImage, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return [] }
            var bytes = [UInt8](repeating: 0, count: side * side * 4)
            let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
                guard let c = CGContext(data: buffer.baseAddress, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                        space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                c.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
                return true
            }
            return drawn ? bytes : []
        }
        // A big figure (60 pt) in the middle of the well.
        var big = lens
        func grown(_ v: CGVector) -> CGVector { CGVector(dx: v.dx * 60 / lens.height, dy: v.dy * 60 / lens.height) }
        (big.origin, big.x, big.y, big.z, big.height) = (CGPoint(x: 60, y: 108), grown(lens.x), grown(lens.y), grown(lens.z), 60)
        let poses: [(RigPose, Double)] = [(.stand, facing), (striding, 0), (striding, .pi * 0.75), (.catchHigh, facing), (.release, -0.6)]
        var darkest = 0.0, apart = 0.0
        for (pose, heading) in poses {
            let figure = RigFigure(pose, heading: heading, lens: big)
            let solid = pixels(figure, opacity: 1), faded = pixels(figure, opacity: 0.5)
            guard solid.count == faded.count, !solid.isEmpty else { darkest = .infinity; break }
            for i in stride(from: 0, to: solid.count, by: 4) {
                // Outside the jersey (next to no white in it), the outline alone: never darker than the halo's half over what's left.
                if solid[i] < 4 { darkest = max(darkest, (Double(solid[i + 3]) - Double(solid[i])) / (255 - Double(solid[i]))) }
                apart = max(apart, (0..<4).map { abs(Double(faded[i + $0]) - Double(solid[i + $0]) / 2) }.max() ?? 0)
            }
        }
        check(darkest <= 0.5 + 3.0 / 255, "the outline is one shape: never darker where the figure's parts meet",
              String(format: "%.3f", darkest))
        check(apart <= 2, "a fading figure fades as one: half the figure, never one part showing through another",
              String(format: "%.0f/255 apart", apart))

        // An official's kit: a few bold stripes down the body (three at this size), legs in their own color,
        // all inside the figure (its outline untouched); a plain uniform exactly as it was.
        var striped = white, slacks = white, own = white
        striped.stripes = .black
        slacks.legs = .black
        own.legs = .white
        var stripesAcross = 0, outside = 0, legsDiffer = false, plainSame = true
        for (pose, heading) in poses {
            let figure = RigFigure(pose, heading: heading, lens: big)
            let plain = pixels(figure, opacity: 1), zebra = pixels(figure, opacity: 1, in: striped)
            let trousers = pixels(figure, opacity: 1, in: slacks), same = pixels(figure, opacity: 1, in: own)
            guard !plain.isEmpty, plain.count == zebra.count, plain.count == trousers.count, plain.count == same.count else { outside = .max; break }
            // Outside the jersey the figure covers just what it did: the outline's shape and strength (an edge's color may differ).
            for i in stride(from: 0, to: plain.count, by: 4) where plain[i] < 4 {
                if abs(Int(zebra[i + 3]) - Int(plain[i + 3])) > 2 || abs(Int(trousers[i + 3]) - Int(plain[i + 3])) > 2 { outside += 1 }
            }
            legsDiffer = legsDiffer || plain != trousers
            plainSame = plainSame && plain == same
        }
        // Across the middle of the body, square to the camera with his arms out of the way: the dark stripes counted.
        let spread = RigFigure(RigPose(leftArm: RigArm(spread: 1.3), rightArm: RigArm(spread: 1.3)), heading: facing, lens: big)
        let zebra = pixels(spread, opacity: 1, in: striped)
        if !zebra.isEmpty {
            let y = Int(spread.hip.y + spread.neck.y), x0 = Int((spread.hip.x - spread.torso * 0.45) * 2), x1 = Int((spread.hip.x + spread.torso * 0.45) * 2)
            var dark = false
            for x in x0...x1 {
                let now = zebra[(y * 240 + x) * 4] < 96
                if now, !dark { stripesAcross += 1 }
                dark = now
            }
        }
        check(stripesAcross == 3 && outside == 0 && legsDiffer && plainSame,
              "an official's kit: three bold stripes down the body and slacks of their own, all inside the outline; a plain uniform as it was",
              "\(stripesAcross) stripes, \(outside) pixels outside")

        // Each sport's officials in their own kit: soccer's referee in yellow unless a team wears it.
        let kitNavy = Color(red: 0.1, green: 0.15, blue: 0.35), kitRed = Color(red: 0.8, green: 0.1, blue: 0.15)
        let villarrealYellow = Color(red: 0.99, green: 0.86, blue: 0.1)
        let usual = Uniform.referee(against: [kitNavy, kitRed], dark: true)
        let clash = Uniform.referee(against: [villarrealYellow, kitNavy], dark: true)
        let both = Uniform.referee(against: [villarrealYellow, Uniform.refereeShirts[1]], dark: false)
        let zebraKit = Uniform.zebra(dark: false)
        check(usual.jersey == Uniform.refereeShirts[0] && clash.jersey == Uniform.refereeShirts[1] && both.jersey == Uniform.refereeShirts[2]
              && usual.legs != nil && usual.piping == nil && Uniform.referee(against: [kitNavy], dark: false).piping != nil
              && zebraKit.stripes != nil && zebraKit.legs != nil && zebraKit.piping != nil && Uniform.zebra(dark: true).piping == nil,
              "officials' kits: the referee in yellow with black shorts, red when a team wears yellow, teal when red's taken too; the zebra with black trousers; pale shirts rimmed on a light panel")
    }

    /// Every figure of a replay, 30 frames a second and at rest, posed as the
    /// theater poses it: where the first whose knees or elbows break, if any.
    static func jointsBreak(_ duration: Double, _ figures: Int, _ pose: (Int, Double) -> RigPose) -> String? {
        for t in Array(stride(from: 0.0, through: duration, by: 1 / 30)) + [.infinity] {
            for i in 0..<figures where !jointsHold(RigSkeleton(pose(i, t))) {
                return "figure \(i) at \(String(format: "%.2f", t)) s"
            }
        }
        return nil
    }

    /// Knees and elbows only ever bend their own way, and no further than they fold, in a skeleton.
    static func jointsHold(_ k: RigSkeleton) -> Bool {
        func knee(_ hip: RigVector, _ knee: RigVector, _ foot: RigVector, _ forward: RigVector) -> Bool {
            // The knee stands out from the line between hip and foot on its forward side: bent, never bent back.
            let reach = foot - hip, line = reach / max((reach * reach).sum().squareRoot(), 1e-9)
            let out = (knee - hip) - line * ((knee - hip) * line).sum()
            return (out * forward).sum() >= -1e-9
        }
        func elbow(_ shoulder: RigVector, _ elbow: RigVector, _ hand: RigVector, _ axis: RigVector) -> Bool {
            let upper = elbow - shoulder, fore = hand - elbow
            let cross = RigVector(upper.y * fore.z - upper.z * fore.y, upper.z * fore.x - upper.x * fore.z, upper.x * fore.y - upper.y * fore.x)
            let cosine = (upper * fore).sum() / max(((upper * upper).sum() * (fore * fore).sum()).squareRoot(), 1e-12)
            return (cross * axis).sum() <= 1e-9 && acos(min(max(cosine, -1), 1)) <= Rig.fold + 1e-6
        }
        return knee(k.hips.0, k.knees.0, k.feet.0, k.kneeForward.0) && knee(k.hips.1, k.knees.1, k.feet.1, k.kneeForward.1)
            && elbow(k.shoulders.0, k.elbows.0, k.hands.0, k.elbowAxis.0) && elbow(k.shoulders.1, k.elbows.1, k.hands.1, k.elbowAxis.1)
    }
}
