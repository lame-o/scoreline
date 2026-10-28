import SwiftUI

// The play theater: under the diamond and the count, the last play replayed
// on an isometric field as it arrives from the live lane, shot like a
// broadcast. The camera opens tight on the battery for the delivery and the
// pitch (its type and speed), follows the ball off the bat with the fielder
// going for it, frames each throw end to end, then settles on the runners'
// last bases as the scorer's mark lands. Marquee plays get a headline across
// the top (HOME RUN, TRIPLE, DOUBLE PLAY), and a home run's fireworks burst
// at the wall it cleared. The footer under it (the diamond's last play) is
// its caption.
//
// Drawn in one Canvas, the field and the figures together, projected through
// the camera (PlayCamera.swift), so lines stay crisp at any zoom. A
// TimelineView exists only while a replay runs; between plays the scene is
// static on the infield. Plays already on the page when it opened show as
// they ended; a new one mid-replay cuts to itself; with Reduce Motion each
// play crossfades to how it ended and the camera never moves. Decorative for
// VoiceOver: the caption carries the play.
//
// A play Statcast measured flies for real (PlayScript.swift), its pitch
// label adds the spin, and the stamp adds the batted ball's numbers ("104.4
// MPH · 12° · 273 FT"), only ever when they're measured. A replay keeps the
// play it began with: measurements that land mid-replay wait for its end.

/// The dimetric (2:1) view of the field from behind home plate, through the
/// camera: the ground squashed to half height, heights at 0.82, the
/// camera's framing filling the view.
struct FieldProjection {
    let size: CGSize
    let camera: CameraFrame
    /// Points per foot.
    let scale: CGFloat
    /// Type grows with the well (not with the zoom), but slower.
    let k: CGFloat
    /// A standing figure's height in points: larger than life, growing with
    /// the zoom, never a speck, never a giant.
    let figure: CGFloat

    init(size: CGSize, camera: CameraFrame = .rest) {
        self.size = size
        self.camera = camera
        scale = max(min(size.height / camera.span, size.width / (camera.span * CameraFrame.aspect)), 0.05)
        k = min(max(0.84 + (size.width - 16) / 466 * 0.5, 1.12), 1.75)
        figure = min(max(8.5 * scale, max(10, size.height * 0.07)), max(size.height * 0.18, 10))
    }

    func point(_ p: CGPoint, z: Double = 0) -> CGPoint {
        CGPoint(x: size.width / 2 + (p.x - camera.x) * scale, y: size.height / 2 - (p.y * 0.5 + z * 0.82 - camera.y) * scale)
    }

    func point(_ p: FieldPoint) -> CGPoint { point(p.ground, z: p.z) }

    /// The well's corners: everything is clipped to them.
    var bounds: Path { Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 12, style: .continuous) }
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
    let stands: Color
    let shadow: Color
    /// The rim that separates a figure from the lines under it.
    let halo: Color
    let ball: Color
    let ballEdge: Color
    /// Round the ball: light in the dark, a soft shade in the light.
    let glow: Color
    let trace: Color
    /// What a grounder kicks up.
    let dust: Color
    /// The lighter stripes of the mowing.
    let mow: Color
    /// Gold type (a home run's mark, a grand slam's banner): the system
    /// yellow in the dark, a deep amber that reads on a light panel.
    let gold: Color
    let dark: Bool

    init(_ scheme: ColorScheme) {
        let dark = scheme == .dark
        self.dark = dark
        grass = Color(hue: 0.36, saturation: dark ? 0.42 : 0.38, brightness: dark ? 0.62 : 0.6).opacity(dark ? 0.2 : 0.2)
        infield = Color(hue: 0.36, saturation: dark ? 0.42 : 0.38, brightness: dark ? 0.66 : 0.62).opacity(dark ? 0.26 : 0.26)
        dirt = Color(hue: 0.075, saturation: dark ? 0.38 : 0.42, brightness: dark ? 0.82 : 0.78).opacity(dark ? 0.22 : 0.3)
        chalk = dark ? Color.white.opacity(0.55) : Color.white.opacity(0.95)
        wall = Color.primary.opacity(dark ? 0.1 : 0.07)
        wallTop = Color.primary.opacity(dark ? 0.3 : 0.22)
        stands = Color.primary.opacity(dark ? 0.045 : 0.035)
        shadow = Color.black.opacity(dark ? 0.42 : 0.16)
        halo = dark ? Color.black.opacity(0.5) : Color.white.opacity(0.9)
        ball = .white
        ballEdge = dark ? Color.black.opacity(0.35) : Color.black.opacity(0.45)
        glow = dark ? Color.white : Color.black.opacity(0.5)
        trace = dark ? Color.white : Color.primary
        dust = Color(hue: 0.08, saturation: dark ? 0.25 : 0.35, brightness: dark ? 0.85 : 0.62)
        mow = dark ? Color.white.opacity(0.014) : Color.white.opacity(0.11)
        gold = dark ? Celebrate.gold : Color(red: 0.78, green: 0.52, blue: 0)
    }
}

// MARK: - Field

/// The field itself: grass, the infield's clay and grass, the mound, the
/// foul lines and boxes, the bases, the warning track, the wall with its
/// poles and the first rows behind it. Drawn in the play's own pass
/// (PlayFrame), through the same camera at the same moment: drawn as a layer
/// of its own, it could hold another framing than the figures over it.
enum BallparkLayer {
    static func draw(_ context: inout GraphicsContext, _ f: FieldProjection, ink: TheaterInk) {
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
        // Chalk thickens a little as the camera closes in.
        let line = min(max(0.75, f.scale * 0.3), 1.6)

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

        // The first rows behind the wall, rising: where a home run lands.
        let fence = fenceLine(inset: 0)
        var stands = Path()
        stands.addLines(fenceLine(inset: -6).map { f.point($0, z: Ballpark.wallHeight + 2) }
                        + fenceLine(inset: -70).reversed().map { f.point($0, z: 44) })
        stands.closeSubpath()
        context.fill(stands, with: .color(ink.stands))
        var rows = Path()
        for row in stride(from: 22.0, through: 62, by: 13) {
            rows.addLines(fenceLine(inset: -row).map { f.point($0, z: Ballpark.wallHeight + 2 + (row - 6) * 0.5) })
        }
        context.stroke(rows, with: .color(ink.stands), lineWidth: 0.5)

        // Fair territory, mowed in a checkerboard (the outfield grass only),
        // and the warning track inside the fence.
        context.fill(polygon([.zero] + fence), with: .color(ink.grass))
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
        context.fill(polygon(fence + fenceLine(inset: 15).reversed()), with: .color(ink.dirt.opacity(0.7)))

        context.fill(skin, with: .color(ink.dirt))
        // The infield grass, inside the base paths.
        let d = Ballpark.baseline / 2.squareRoot(), inset = 3 * 2.squareRoot()
        context.fill(polygon([CGPoint(x: 0, y: inset), CGPoint(x: d - inset, y: d), CGPoint(x: 0, y: 2 * d - inset),
                              CGPoint(x: -(d - inset), y: d)]), with: .color(ink.infield))
        // Cutouts round the bases (inside the lines: foul ground stays the
        // well's), the circle round home, and the mound.
        var fair = context
        fair.clip(to: polygon([.zero] + fence))
        for base in 1...3 { fair.fill(circle(Ballpark.base(base), 11), with: .color(ink.dirt)) }
        context.fill(circle(.zero, 13), with: .color(ink.dirt))
        context.fill(circle(CGPoint(x: 0, y: 59), 9), with: .color(ink.dirt))

        // Foul lines to the poles.
        var lines = Path()
        for side in [-45.0, 45.0] {
            lines.move(to: f.point(.zero))
            lines.addLine(to: f.point(Ballpark.polar(Ballpark.fence(side * .pi / 180), side)))
        }
        context.stroke(lines, with: .color(ink.chalk), lineWidth: line)
        // The batter's and catcher's boxes, where there's room to see them.
        if f.scale >= 0.9 {
            var boxes = Path()
            for x in [-4.7, 0.7] { boxes.addRect(CGRect(x: x, y: -3, width: 4, height: 6)) }
            boxes.addLines([CGPoint(x: -1.75, y: -3), CGPoint(x: -1.75, y: -10), CGPoint(x: 1.75, y: -10), CGPoint(x: 1.75, y: -3)])
            let center = f.point(.zero)
            let projected = boxes.applying(CGAffineTransform(a: f.scale, b: 0, c: 0, d: -f.scale / 2, tx: center.x, ty: center.y))
            context.stroke(projected, with: .color(ink.chalk.opacity(0.6)), lineWidth: line * 0.7)
        }

        // The wall: its face, its top, and the poles.
        var face = Path()
        face.addLines(fence.map { f.point($0) } + fence.reversed().map { f.point($0, z: Ballpark.wallHeight) })
        face.closeSubpath()
        context.fill(face, with: .color(ink.wall))
        var top = Path()
        top.addLines(fence.map { f.point($0, z: Ballpark.wallHeight) })
        context.stroke(top, with: .color(ink.wallTop), lineWidth: line)
        var poles = Path()
        for p in [fence[0], fence[fence.count - 1]] {
            poles.move(to: f.point(p))
            poles.addLine(to: f.point(p, z: 42))
        }
        context.stroke(poles, with: .color(Celebrate.gold.opacity(0.85)), style: StrokeStyle(lineWidth: line + 0.25, lineCap: .round))

        // Bases, the rubber and home plate, a little larger than life (and never specks).
        let bag = max(1.1 * f.scale, 2.4)
        for base in 1...3 {
            let p = f.point(Ballpark.base(base))
            var square = Path()
            square.addLines([CGPoint(x: p.x - bag, y: p.y), CGPoint(x: p.x, y: p.y - bag / 2),
                             CGPoint(x: p.x + bag, y: p.y), CGPoint(x: p.x, y: p.y + bag / 2)])
            square.closeSubpath()
            context.fill(square, with: .color(ink.chalk.opacity(1)))
        }
        let rubber = f.point(Ballpark.rubber), rw = max(1.3 * f.scale, 1.2)
        context.fill(Path(CGRect(x: rubber.x - rw, y: rubber.y - rw / 8, width: 2 * rw, height: rw / 4)), with: .color(ink.chalk))
        let h = f.point(.zero), pw = max(1.15 * f.scale, 2)
        var plate = Path()
        plate.addLines([CGPoint(x: h.x - pw, y: h.y - pw * 0.4), CGPoint(x: h.x + pw, y: h.y - pw * 0.4),
                        CGPoint(x: h.x + pw, y: h.y), CGPoint(x: h.x, y: h.y + pw * 0.5), CGPoint(x: h.x - pw, y: h.y)])
        plate.closeSubpath()
        context.fill(plate, with: .color(ink.chalk))
    }
}

// MARK: - Teams

/// A team's colors as the source gives them (hex): its own and its second.
struct TeamKit: Equatable {
    var color: String?
    var alternate: String?
}

/// Both teams' kits, top (visitors) and bottom (home).
struct TheaterKits: Equatable {
    var top: TeamKit
    var bottom: TeamKit

    init(top: TeamKit, bottom: TeamKit) {
        self.top = top
        self.bottom = bottom
    }

    init(top: Competitor?, bottom: Competitor?) {
        self.init(top: TeamKit(color: top?.color, alternate: top?.alternateColor),
                  bottom: TeamKit(color: bottom?.color, alternate: bottom?.alternateColor))
    }
}

/// How a team's figures are dressed.
struct Uniform: Equatable {
    /// Body and limbs.
    var jersey: Color
    /// The head: always the team's own color.
    var cap: Color
    /// A rim in the team's color round light uniforms on a light field
    /// (nil: the ink's halo).
    var piping: Color? = nil
    /// Type in the team's color: a hit's stamp, the banner, the runs pill.
    var accent: Color

    init(_ color: Color) {
        jersey = color
        cap = color
        accent = color
    }

    init(jersey: Color, cap: Color, piping: Color? = nil, accent: Color) {
        self.jersey = jersey
        self.cap = cap
        self.piping = piping
        self.accent = accent
    }
}

/// The two teams on the field, always told apart at a glance.
struct TheaterTeams: Equatable {
    var batting: Uniform
    var fielding: Uniform

    init(batting: Uniform, fielding: Uniform) {
        self.batting = batting
        self.fielding = fielding
    }

    init(batting: Color, fielding: Color) {
        self.init(batting: Uniform(batting), fielding: Uniform(fielding))
    }

    func uniform(_ team: PlayScript.Team) -> Uniform { team == .batting ? batting : fielding }

    /// A team with no usable color (`Viz.neutral`, which is translucent) is drawn in a solid gray.
    static func solid(_ color: Color, _ scheme: ColorScheme) -> Color {
        color == Viz.neutral ? Color(white: scheme == .dark ? 0.72 : 0.5) : color
    }

    /// Which way the pair was dressed.
    enum Rule: Equatable {
        /// Their own colors read apart.
        case own
        /// This side wears its second color.
        case second(GameDetail.Side)
        /// This side (the home team) wears whites, or charcoal against a pale color in light mode.
        case whites(GameDetail.Side)
    }

    /// Below this (OKLab distance, as each color is shown) two teams look alike on small figures.
    static let apart = 0.15

    /// Dresses both teams so they always contrast. Each color is first fitted
    /// to the panel as the charts fit it (`TeamTone`): when the two read apart
    /// they're worn as they are. When they're too close (two navies), a team
    /// changes into its second color, whichever separates the pair more, if
    /// it's a real color that does. Failing that, the home team wears whites
    /// (light against the other team's color), or in light mode charcoal
    /// against a pale one; its cap keeps its own color either way. (pure; tested)
    static func dress(_ kits: TheaterKits, scheme: ColorScheme) -> (top: Uniform, bottom: Uniform, rule: Rule) {
        let dark = scheme == .dark
        func toned(_ hex: String?) -> OKLab? {
            guard let color = Color(hex: hex), let ns = NSColor(color).usingColorSpace(.sRGB),
                  let adjusted = TeamTone.adjust(ns, scheme: scheme) else { return nil }
            return OKLab(adjusted)
        }
        let gray = OKLab(l: dark ? 0.72 : 0.5, a: 0, b: 0)
        let own = (top: toned(kits.top.color), bottom: toned(kits.bottom.color))
        let top = own.top ?? gray, bottom = own.bottom ?? gray
        func color(_ lab: OKLab) -> Color { Color(nsColor: lab.nsColor) }
        // Type in a pale team color (gold) deepens on a light panel, keeping its hue.
        func accent(_ lab: OKLab?) -> Color {
            guard let lab else { return .primary }
            return color(!dark && lab.l > 0.7 ? OKLab(l: 0.6, chroma: lab.chroma, hue: lab.hue) : lab)
        }
        // On a light panel a pale jersey (gold, sky blue) needs a rim of its own, deepened, not the white halo.
        func uniform(_ lab: OKLab, accent: Color) -> Uniform {
            Uniform(jersey: color(lab), cap: color(lab), piping: !dark && lab.l > 0.7 ? color(OKLab(l: 0.42, chroma: lab.chroma, hue: lab.hue)) : nil,
                    accent: accent)
        }
        if top.distance(to: bottom) >= apart {
            return (uniform(top, accent: accent(own.top)), uniform(bottom, accent: accent(own.bottom)), .own)
        }
        // A second color: a real color (not white, black or gray) that reads apart.
        let seconds: [(side: GameDetail.Side, lab: OKLab)] = [(.top, kits.top.alternate), (.bottom, kits.bottom.alternate)]
            .compactMap { side, hex in toned(hex).flatMap { $0.chroma >= 0.06 ? (side, $0) : nil } }
        let best = seconds.map { s in (s, s.side == .top ? s.lab.distance(to: bottom) : top.distance(to: s.lab)) }
            .filter { $0.1 >= apart }.max { $0.1 < $1.1 }?.0
        if let best {
            let wearer = uniform(best.lab, accent: accent(best.lab))
            let other = best.side == .top ? bottom : top
            let rest = uniform(other, accent: accent(best.side == .top ? own.bottom : own.top))
            return best.side == .top ? (wearer, rest, .second(.top)) : (rest, wearer, .second(.bottom))
        }
        // Home whites: light against dark. In light mode a pale visitor gets charcoal instead.
        let charcoal = !dark && top.l >= 0.6
        let jersey = charcoal ? Color(white: 0.24) : Color(white: dark ? 0.96 : 1)
        let home = Uniform(jersey: jersey, cap: color(bottom), piping: dark || charcoal ? nil : color(bottom).opacity(0.9),
                           accent: accent(own.bottom))
        return (uniform(top, accent: accent(own.top)), home, .whites(.bottom))
    }
}

// MARK: - Poses

/// Baseball's poses beyond the shared ones, for a right-hander (a lefty's
/// are `mirrored`), relative to his heading: the batter faces the plate, the
/// pitcher home, the catcher his pitcher, a fielder his throw.
extension RigPose {
    /// The catcher's squat, the mitt up as a target.
    static let squat = RigPose(hip: RigVector(-0.05, 0, 0.18), lean: 0.3, left: RigVector(0.05, 0.17, 0), right: RigVector(0.05, -0.17, 0),
                               knees: 0.6, leftArm: RigArm(swing: 1.3, spread: 0.3, turn: -0.3, bend: 1.2),
                               rightArm: RigArm(swing: 0.55, spread: 0.25, turn: 0, bend: 1.3))
    /// Leading off: low and wide, side-on to the next base, watching the pitcher.
    static let lead = RigPose(hip: RigVector(0, 0, 0.39), lean: 0.4, left: RigVector(0.02, 0.17, 0), right: RigVector(0.02, -0.17, 0), knees: 0.35,
                              leftArm: RigArm(swing: 0.45, spread: 0.32, turn: -0.15, bend: 0.6),
                              rightArm: RigArm(swing: 0.45, spread: 0.32, turn: -0.15, bend: 0.6))
    /// Feet first: leaning back, the lead leg out along the dirt, the other folded under, a hand up.
    static let slide = RigPose(hip: RigVector(-0.12, 0, 0.09), lean: -1.25, left: RigVector(0.42, 0.04, 0.02), right: RigVector(0.14, -0.07, 0),
                               knees: 0.15, leftArm: RigArm(swing: 2.45, spread: 0, turn: 0.5, bend: 0.3),
                               rightArm: RigArm(swing: 0.9, spread: 0.45, turn: 0.2, bend: 0.4))

    // The pitcher's delivery, facing home: set side-on (his glove side to
    // the plate), the leg kick, the stride with the arm cocked, the release
    // over the top, the follow-through with the back leg up behind him, and
    // square to the plate where he landed, ready to field.
    static let set = RigPose(turn: -1.5, hip: RigVector(0, 0, 0.485), left: RigVector(0.07, 0.01, 0), right: RigVector(-0.07, -0.01, 0),
                             leftArm: RigArm(swing: 0.8, spread: 0.1, turn: -0.55, bend: 1.6),
                             rightArm: RigArm(swing: 0.75, spread: 0.1, turn: -0.6, bend: 1.65))
    static let kick = RigPose(turn: -1.85, hip: RigVector(-0.03, 0, 0.49), lean: -0.12, left: RigVector(0.0, 0.04, 0.33),
                              right: RigVector(-0.06, -0.01, 0), knees: 0.05, leftArm: RigArm(swing: 1.0, spread: 0.08, turn: -0.6, bend: 1.75),
                              rightArm: RigArm(swing: 0.95, spread: 0.08, turn: -0.65, bend: 1.8))
    static let stride = RigPose(turn: -1.35, hip: RigVector(0.24, -0.03, 0.38), twist: -0.5, left: RigVector(0.52, -0.1, 0),
                                right: RigVector(-0.07, -0.01, 0), knees: 0.15, leftArm: RigArm(swing: 1.45, spread: 0.3, turn: 1.2, bend: 0.2),
                                rightArm: RigArm(swing: 1.4, spread: 0.2, turn: 1.9, bend: 1.7))
    static let deliver = RigPose(turn: -0.85, hip: RigVector(0.36, -0.05, 0.36), lean: 0.55, twist: 0.5, left: RigVector(0.52, -0.1, 0),
                                 right: RigVector(0.0, -0.04, 0.12), knees: 0.15, leftArm: RigArm(swing: 0.5, spread: 0.2, turn: -0.4, bend: 1.8),
                                 rightArm: RigArm(swing: 2.7, spread: 0.25, turn: -0.1, bend: 0.4))
    static let follow = RigPose(turn: -0.35, hip: RigVector(0.43, -0.06, 0.36), lean: 0.95, twist: 0.4, left: RigVector(0.52, -0.1, 0),
                                right: RigVector(0.17, 0.08, 0.3), knees: 0.2, leftArm: RigArm(swing: -0.4, spread: 0.3, turn: 0.2, bend: 1.2),
                                rightArm: RigArm(swing: 0.4, spread: 0.0, turn: -0.9, bend: 0.35))
    static let fielding = RigPose(hip: RigVector(0.44, -0.24, 0.41), lean: 0.55, left: RigVector(0.52, -0.1, 0), right: RigVector(0.42, -0.4, 0),
                                  knees: 0.4, leftArm: RigArm(swing: 0.4, spread: 0.3, turn: -0.35, bend: 0.65),
                                  rightArm: RigArm(swing: 0.4, spread: 0.3, turn: -0.35, bend: 0.65))

    // The batter, facing the plate (a right-hander's front shoulder, his
    // left, to the pitcher): the stance, wide and coiled, the hands by his
    // back shoulder; the bat through the zone, the hips open, the back foot
    // up on its toe; the finish over the front shoulder.
    static let stance = RigPose(hip: RigVector(-0.04, -0.02, 0.4), lean: 0.35, roll: -0.05, twist: -0.35,
                                left: RigVector(-0.08, 0.25, 0), right: RigVector(0.03, -0.21, 0), knees: 0.3,
                                leftArm: RigArm(swing: 1.2, spread: 0.0, turn: -1.3, bend: 1.2),
                                rightArm: RigArm(swing: 0.9, spread: 0.9, turn: -0.4, bend: 2.2))
    static let contact = RigPose(turn: 0.9, hip: RigVector(-0.02, 0.06, 0.4), lean: 0.3, twist: 0.25, left: RigVector(-0.06, 0.27, 0),
                                 right: RigVector(0.02, -0.17, 0.05), knees: 0.45, leftArm: RigArm(swing: 1.3, spread: 0.0, turn: -0.35, bend: 0.1),
                                 rightArm: RigArm(swing: 1.1, spread: 0.0, turn: -0.75, bend: 0.5))
    static let finish = RigPose(turn: 1.35, hip: RigVector(-0.02, 0.08, 0.43), lean: 0.12, twist: 0.55, left: RigVector(-0.06, 0.27, 0),
                                right: RigVector(0.1, -0.08, 0.1), knees: 0.6, leftArm: RigArm(swing: 2.2, spread: 0.6, turn: 1.0, bend: 1.8),
                                rightArm: RigArm(swing: 2.0, spread: 0.15, turn: -1.0, bend: 1.4))
}

// MARK: - Figures and ball

/// One frame of a play through the camera: the field, the ball's trace and
/// shadow, the figures far to near, the ball, the beats, the pitch's label, the
/// headline and the scorer's mark. Equatable: at rest (t = ∞) an update
/// elsewhere on the page doesn't redraw it.
struct PlayFrame: View, Equatable {
    let scene: PlayScene?
    let script: PlayScript
    let t: Double
    let teams: TheaterTeams
    let ink: TheaterInk
    /// Where it's drawn: the type is sized from it.
    let size: CGSize

    /// The time first: mid-replay it's all that differs.
    static func == (a: PlayFrame, b: PlayFrame) -> Bool {
        a.t == b.t && a.size == b.size && a.teams == b.teams && a.ink == b.ink && a.scene == b.scene && a.script == b.script
    }

    /// The type, laid out once as views and drawn into each frame: resolving
    /// text in the renderer every frame was most of a frame's cost.
    private enum Symbol: Hashable { case pitch, stamp, banner }

    var body: some View {
        Canvas { context, size in
            let f = FieldProjection(size: size, camera: script.camera.frame(at: t))
            context.clip(to: f.bounds)
            BallparkLayer.draw(&context, f, ink: ink)
            drawTrace(&context, f)
            drawPuffs(&context, f)
            let figures = posed(f)
            drawShadows(&context, f, figures)
            drawFigures(&context, f, figures)
            drawBall(&context, f)
            drawFlashes(&context, f)
            drawLabels(&context, f)
        } symbols: {
            pitchLabel.tag(Symbol.pitch)
            stamp.tag(Symbol.stamp)
            banner.tag(Symbol.banner)
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
        // At rest, a plain faint line: a gradient is dithered differently each draw, and the static scene must be the same every time.
        let shading = t > script.settle + 0.8 ? GraphicsContext.Shading.color(ink.trace.opacity(strength * 0.5))
            : .linearGradient(Gradient(colors: [ink.trace.opacity(strength * 0.15), ink.trace.opacity(strength)]),
                              startPoint: points.first ?? .zero, endPoint: points.last ?? .zero)
        context.stroke(path, with: shading, style: StrokeStyle(lineWidth: min(max(f.figure * 0.07, 0.9), 2), lineCap: .round, lineJoin: .round))

        // Where it came down: the spray chart's marks (filled, a ring, a ringed dot).
        guard let landing = script.landing, t >= landing.at else { return }
        let p = f.point(landing.point, z: landing.z)
        let grow = min((t - landing.at) / 0.2, 1)
        let r = max(f.figure * 0.16, 2.6) * (0.6 + 0.4 * grow)
        let rect = CGRect(x: p.x - r, y: p.y - r / 2, width: 2 * r, height: r)
        let color = teams.batting.accent
        switch landing.mark {
        case .out:
            context.stroke(Path(ellipseIn: rect), with: .color(color.opacity(0.9)), lineWidth: 1.4)
        case .hit:
            context.fill(Path(ellipseIn: rect), with: .color(color))
        case .homeRun:
            context.fill(Path(ellipseIn: rect), with: .color(color))
            context.stroke(Path(ellipseIn: rect.insetBy(dx: -1.5, dy: -0.75)), with: .color(.primary), lineWidth: 0.8)
        }
    }

    /// Dust where a grounder touches down between hops.
    private func drawPuffs(_ context: inout GraphicsContext, _ f: FieldProjection) {
        for puff in script.puffs {
            let age = t - puff.at
            guard age >= 0, age < 0.45 else { continue }
            let u = age / 0.45, c = f.point(puff.point)
            let grow = 1 - pow(1 - u, 3)
            let unit = max(f.scale, 0.8)
            for (dx, dy, size) in [(-1.3, 0.2, 1.0), (1.2, 0.5, 0.85), (0.1, -0.5, 1.15)] {
                let r = (0.8 + 1.8 * grow) * size * unit
                let center = CGPoint(x: c.x + dx * unit * (0.5 + grow), y: c.y + dy * unit * 0.5 - grow * 1.2 * unit)
                context.fill(Path(ellipseIn: CGRect(x: center.x - r, y: center.y - r * 0.6, width: 2 * r, height: 1.2 * r)),
                             with: .color(ink.dust.opacity(0.55 * (1 - u))))
            }
        }
    }

    // MARK: Shadows

    private func drawShadows(_ context: inout GraphicsContext, _ f: FieldProjection, _ figures: [Posed]) {
        // Under the hips; smaller and fainter as he leaves the ground.
        let w = f.figure * 0.3
        for p in figures {
            let air = min(p.figure.air / 0.4, 1), r = w * (1 - 0.35 * air), g = p.figure.ground
            context.fill(Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r * 0.32, width: 2 * r, height: r * 0.64)),
                         with: .color(ink.shadow.opacity(p.opacity * (1 - 0.45 * air))))
        }
        // The ball's: under it on the ground, larger and softer the higher it
        // flies, with a hairline up to the ball once it's well off the grass.
        if let ball = script.ball(at: t), ball.z > 0.3 {
            let o = script.ballOpacity(at: t)
            let g = f.point(ball.ground)
            let spread = 1 + min(ball.z / 50, 1.4)
            let r = max(0.55 * f.scale, 1.6) * spread
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

    /// A figure posed and placed at t.
    private struct Posed {
        let index: Int
        let figure: RigFigure
        let opacity: Double
    }

    /// Everyone on the field at t, far to near: a figure in front covers the one behind.
    private func posed(_ f: FieldProjection) -> [Posed] {
        script.actors.indices
            .map { (index: $0, at: script.actors[$0].position(at: t)) }
            .sorted { $0.at.y > $1.at.y }
            .compactMap { index, at in
                let actor = script.actors[index]
                let o = actor.opacity(at: t)
                guard o > 0.01 else { return nil }
                let lens = RigLens(f, at: at)
                let (body, heading) = pose(actor, index, at: at, unit: lens.unit)
                return Posed(index: index, figure: RigFigure(body, heading: heading, lens: lens), opacity: o)
            }
    }

    private func drawFigures(_ context: inout GraphicsContext, _ f: FieldProjection, _ figures: [Posed]) {
        let batting = FigureInks(teams.batting, ink: ink, in: context), fielding = FigureInks(teams.fielding, ink: ink, in: context)
        for p in figures {
            let actor = script.actors[p.index]
            if let bats = actor.bats, actor.dropsBat.map({ t >= $0 }) ?? false {
                drawDroppedBat(&context, at: f.point(Ballpark.box(bats)), bats: bats, fade: 1 - min(max((t - script.settle) / 0.4, 0), 1), f: f)
            }
            TheaterDraw.figure(p.figure, inks: actor.team == .batting ? batting : fielding, height: f.figure, opacity: p.opacity, in: context)
            if let bats = actor.bats, actor.dropsBat.map({ t < $0 }) ?? true {
                var layer = context
                if p.opacity < 1 { layer.opacity = p.opacity }
                drawBat(&layer, bats: bats, hands: p.figure.grip, swing: actor.swing, length: f.figure * 0.62,
                        halo: teams.uniform(actor.team).piping ?? ink.halo)
            }
        }
    }

    /// The body at t, and its heading: how he stands for his position, how
    /// he's moving (striding to his planted feet), and over that what he's
    /// doing (the delivery, a swing, a slide, a catch, a throw). `unit`:
    /// body units to the foot where he stands. (tested)
    func pose(_ actor: PlayScript.Actor, _ index: Int, at here: CGPoint, unit: Double) -> (RigPose, Double) {
        let track = index < script.rig.count ? script.rig[index] : RigTrack(at: here)
        let m = track.motion(at: t)
        func envelope(_ x: Double, attack: Double, release: Double) -> Double {
            x < 0 ? max(1 + x / attack, 0) : max(1 - x / release, 0)
        }

        // How he stands, and how he moves.
        let still: RigPose = switch actor.role {
        case .fielder(1): script.release.map { t > $0 } == true ? .fielding : .ready
        case .fielder(2): actor.crouch ? .squat : .stand
        case .fielder(let n) where n <= 6: .ready
        case .fielder, .batter: .stand
        // Leading off a base, low, watching the pitcher.
        case .runner: Ballpark.distance(here) > 5 ? .lead : .stand
        }
        let feet = track.feet(at: t, anchor: here, heading: m.heading, unit: unit, speed: m.speed, stand: (still.left, still.right))
        var body = still.mix(.gait(m, feet: feet), m.weight)
        if let slide = actor.slide, t >= slide {
            body = body.mix(.slide, actor.motion(at: t) == nil ? 1 : Rig.smooth((t - slide) / 0.12))
        }

        // The batter in the box: the stance, the swing.
        if actor.role == .batter, let bats = actor.bats, actor.dropsBat.map({ t < $0 }) ?? true, actor.motion(at: t) == nil {
            var p = RigPose.stance
            if let swing = actor.swing {
                let u = (t - (swing - 0.09)) / 0.24
                p = RigPose.keyed([(0, .stance), (0.4, .contact), (1, .finish)], at: u) ?? (u <= 0 ? .stance : .finish)
            }
            body = bats == .left ? p.mirrored : p
        }

        // The pitcher's delivery; then he's ready where he landed.
        if case .fielder(1) = actor.role, let r = script.release, actor.motion(at: t) == nil,
           let p = RigPose.keyed([(-0.55, .ready), (-0.42, .set), (-0.24, .kick), (-0.08, .stride), (0, .deliver), (0.16, .follow),
                                  (0.45, .fielding), (0.7, .fielding)], at: t - r) {
            body = p
        }

        // Hands on the ball: a catch, a scoop, a glove, a throw. On the move, the legs keep running.
        for action in actor.actions {
            let x = t - action.at
            switch action.kind {
            case .catchHigh:
                body = body.over(.catchHigh, envelope(x, attack: 0.28, release: 0.35), moving: m.weight)
            case .scoop:
                body = body.over(.scoop, envelope(x, attack: 0.22, release: 0.2), moving: m.weight * 0.5)
            case .glove:
                body = body.over(.glove, envelope(x, attack: 0.2, release: 0.22), moving: m.weight)
            case .throwBall:
                guard x > -0.24, x < 0.4, let throwing = RigPose.keyed([(-0.3, .cock), (-0.04, .cock), (0.1, .release), (0.4, .release)], at: x)
                else { continue }
                body = body.over(throwing, min(envelope(x, attack: 0.2, release: 0.36) * 1.6, 1), moving: m.weight)
            }
        }
        return (body, m.heading)
    }

    /// The bat: on the shoulder, then round through the zone, level at
    /// contact, and on into the follow-through.
    private func drawBat(_ context: inout GraphicsContext, bats: PlayScene.Hand, hands: CGPoint, swing: Double?, length: CGFloat,
                         halo: Color) {
        // Azimuth on the ground (0: toward first base's side, 90: out to center), and lift.
        var azimuth = -105.0, lift = 0.85
        if let swing {
            let u = min(max((t - (swing - 0.09)) / 0.24, 0), 1)
            let e = PlayScript.Ease.inOut.value(u)
            azimuth = -105 + e * 255
            lift = u <= 0 ? 0.85 : u < 0.4 ? 0.85 - (u / 0.4) * 0.7 : 0.15 + (u - 0.4) / 0.6 * 0.5
        }
        if bats == .left { azimuth = 180 - azimuth }
        let a = azimuth * .pi / 180
        let flat = length * (1 - lift * lift).squareRoot()
        let tip = CGPoint(x: hands.x + cos(a) * flat, y: hands.y - sin(a) * flat * 0.5 - lift * length * 0.82)
        var bat = Path()
        bat.move(to: hands)
        bat.addLine(to: tip)
        let width = max(length * 0.09, 1.1)
        context.stroke(bat, with: .color(halo), style: StrokeStyle(lineWidth: width + 1.4, lineCap: .round))
        context.stroke(bat, with: .color(Color(hue: 0.09, saturation: 0.35, brightness: 0.85)), style: StrokeStyle(lineWidth: width, lineCap: .round))
    }

    /// Left lying by the plate when he runs, until the field settles.
    private func drawDroppedBat(_ context: inout GraphicsContext, at p: CGPoint, bats: PlayScene.Hand, fade: Double, f: FieldProjection) {
        guard fade > 0.01 else { return }
        let s: CGFloat = bats == .left ? 1 : -1, l = f.figure * 0.5
        var bat = Path()
        bat.move(to: CGPoint(x: p.x + s * 0.12 * l, y: p.y + 0.14 * l))
        bat.addLine(to: CGPoint(x: p.x + s * 0.95 * l, y: p.y - 0.08 * l))
        var layer = context
        layer.opacity = fade
        layer.stroke(bat, with: .color(Color(hue: 0.09, saturation: 0.35, brightness: 0.85).opacity(0.8)),
                     style: StrokeStyle(lineWidth: max(l * 0.1, 1.1), lineCap: .round))
    }

    // MARK: Ball

    /// A bright core in a soft glow, a short comet tail while it's fast, and
    /// its shadow on the grass (drawn with the shadows).
    private func drawBall(_ context: inout GraphicsContext, _ f: FieldProjection) {
        guard let ball = script.ball(at: t) else { return }
        let o = script.ballOpacity(at: t)
        guard o > 0.01 else { return }
        let p = f.point(ball)
        let r = min(max(0.42 * f.scale, 1.7), max(f.figure * 0.12, 1.7))
        var layer = context
        layer.opacity = o
        // The tail: where it was over the last few hundredths, fading back.
        if let flight = script.flights.last(where: { $0.start < t && t <= $0.end }) {
            let trail = (1...6).map { f.point(flight.point(at: max(t - Double($0) * 0.014, flight.start))) }
            if let last = trail.last, hypot(last.x - p.x, last.y - p.y) > r * 3 {
                var previous = p
                for (i, q) in trail.enumerated() {
                    let u = Double(i) / 6
                    var segment = Path()
                    segment.move(to: previous)
                    segment.addLine(to: q)
                    layer.stroke(segment, with: .color(ink.ball.opacity(0.55 * (1 - u))),
                                 style: StrokeStyle(lineWidth: 2 * r * (1 - u * 0.75), lineCap: .round))
                    previous = q
                }
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

    // MARK: Beats

    private func drawFlashes(_ context: inout GraphicsContext, _ f: FieldProjection) {
        let unit = f.figure / 10
        for flash in script.flashes {
            let age = t - flash.at
            switch flash.beat {
            case .contact:
                // Short rays off the bat.
                guard age >= 0, age < 0.24 else { continue }
                let u = age / 0.24, c = f.point(flash.point)
                var rays = Path()
                for i in 0..<6 {
                    let a = Double(i) / 6 * 2 * .pi + 0.3
                    let inner = (1.2 + 3 * u) * unit, outer = (2.6 + 6 * u) * unit
                    rays.move(to: CGPoint(x: c.x + cos(a) * inner, y: c.y + sin(a) * inner * 0.8))
                    rays.addLine(to: CGPoint(x: c.x + cos(a) * outer, y: c.y + sin(a) * outer * 0.8))
                }
                context.stroke(rays, with: .color(ink.trace.opacity(0.95 * (1 - u))),
                               style: StrokeStyle(lineWidth: max(unit * 0.22, 1), lineCap: .round))
            case .out:
                // A red ring where the out was made.
                guard age >= 0, age < 0.6 else { continue }
                let u = age / 0.6, c = f.point(flash.point)
                let r = (2.5 + 7 * Motion.curve.value(at: u)) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r / 2, width: 2 * r, height: r)),
                               with: .color(Color.red.opacity(0.95 * (1 - u))), lineWidth: 1.6)
                if age < 0.25 {
                    let d = 1.8 * unit
                    context.fill(Path(ellipseIn: CGRect(x: c.x - d, y: c.y - d / 2, width: 2 * d, height: d)),
                                 with: .color(Color.red.opacity(0.8 * (1 - age / 0.25))))
                }
            case .run:
                // The plate pops in the batting team's color.
                guard age >= 0, age < 0.7 else { continue }
                let u = age / 0.7, c = f.point(flash.point)
                let r = (3 + 9 * Motion.curve.value(at: u)) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r / 2, width: 2 * r, height: r)),
                               with: .color(teams.batting.accent.opacity(1 - u)), lineWidth: 1.6)
                let pop = (age < 0.14 ? age / 0.14 : max(1 - (age - 0.14) / 0.4, 0)) * 3.2 * unit
                if pop > 0.1 {
                    context.fill(Path(ellipseIn: CGRect(x: c.x - pop, y: c.y - pop / 2, width: 2 * pop, height: pop)),
                                 with: .color(teams.batting.accent.opacity(0.9)))
                }
            case .catchBall:
                // The pop in the glove: a flash and a ring.
                guard age >= 0, age < 0.32 else { continue }
                let u = age / 0.32, c = f.point(flash.point)
                let r = (1.2 + 3.6 * (1 - pow(1 - u, 3))) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                               with: .color(ink.trace.opacity(0.85 * (1 - u))), lineWidth: max(unit * 0.2, 1))
                if age < 0.1 {
                    let d = (1.8 - age * 6) * unit
                    context.fill(Path(ellipseIn: CGRect(x: c.x - d, y: c.y - d, width: 2 * d, height: 2 * d)),
                                 with: .color(ink.glow.opacity(0.45)))
                }
            case .hitBatter:
                guard age >= 0, age < 0.45 else { continue }
                let u = age / 0.45, c = f.point(flash.point)
                let r = (2 + 6 * u) * unit
                context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                               with: .color(Color.orange.opacity(1 - u)), lineWidth: 1.2)
            }
        }
    }

    // MARK: Type

    /// A quick, critically damped spring: no bounce.
    private static let land = Spring(duration: 0.32, bounce: 0)

    private func drawLabels(_ context: inout GraphicsContext, _ f: FieldProjection) {
        let inset = max(f.size.height * 0.055, 9)
        // The pitch: its name and speed, from the windup until the play is
        // under way, low in the foul ground on the right, across from the stamp.
        if let label = script.label, t > label.lowerBound - 0.1, t < label.upperBound + 0.3,
           let symbol = context.resolveSymbol(id: Symbol.pitch) {
            let fadeIn = min(max((t - label.lowerBound + 0.1) / 0.15, 0), 1)
            let fadeOut = 1 - min(max((t - label.upperBound) / 0.3, 0), 1)
            var layer = context
            layer.opacity = fadeIn * fadeOut
            layer.draw(symbol, at: CGPoint(x: f.size.width - inset, y: f.size.height - inset * 0.8), anchor: .bottomTrailing)
        }
        // The headline across the top: wiped open from the middle as it
        // drops in, held, then lifted away as the field settles.
        if let banner = script.banner, t >= banner.at, t < banner.until + 0.3, let symbol = context.resolveSymbol(id: Symbol.banner) {
            let x = t - banner.at
            let v = x >= 1 ? 1 : Self.land.value(target: 1.0, time: x)
            let out = min(max((t - banner.until) / 0.28, 0), 1)
            let open = Motion.curve.value(at: min(x / 0.3, 1))
            let w = symbol.size.width
            var layer = context
            layer.opacity = min(x / 0.12, 1) * (1 - out)
            let center = CGPoint(x: f.size.width / 2, y: inset * 0.7 + symbol.size.height / 2 + (1 - v) * -8 - out * 5)
            layer.clip(to: Path(CGRect(x: center.x - w / 2 * open - 2, y: 0, width: w * open + 4, height: f.size.height)))
            layer.draw(symbol, at: center, anchor: .center)
        }
        // The scorer's mark, as the play resolves: in from larger on a quick
        // spring that never bounces, never from nothing.
        if t >= script.stamp, let symbol = context.resolveSymbol(id: Symbol.stamp) {
            let x = t - script.stamp
            // Settled long before a second is up (and never asked about t = ∞).
            let v = x >= 1 ? 1 : min(Self.land.value(target: 1.0, time: x), 1)
            let grow = 1.28 - 0.28 * v
            var layer = context
            layer.opacity = min(x / 0.1, 1)
            layer.translateBy(x: inset, y: f.size.height - inset * 0.8)
            layer.scaleBy(x: grow, y: grow)
            layer.draw(symbol, at: .zero, anchor: .bottomLeading)
        }
    }

    /// Type sizes from the well's height: big where there's room.
    private var typeHeight: CGFloat { max(size.height, 120) }

    /// The pitch's type and speed ("Sweeper  82 mph"), and under them its
    /// spin when Statcast tracked it ("2,509 rpm").
    @ViewBuilder
    private var pitchLabel: some View {
        let tracked = scene?.measured?.pitch
        let code = scene?.pitch?.code ?? tracked?.type
        let mph = scene?.pitch?.mph ?? tracked?.mph.map { Int($0.rounded()) }
        if mph != nil || code != nil {
            let name = code.flatMap { GameDetail.Pitch.names[$0] } ?? scene?.pitch?.name ?? code ?? ""
            let size = min(max(typeHeight * 0.068, 9.5), 15)
            VStack(alignment: .trailing, spacing: size * 0.12) {
                Text(name).foregroundStyle(.secondary)
                    + Text(mph.map { "  \($0)" } ?? "").foregroundStyle(.primary).fontWeight(.semibold)
                    + Text(mph == nil ? "" : " mph").foregroundStyle(.secondary)
                if let spin = tracked?.spin {
                    Text(spin.formatted()).foregroundStyle(.primary).fontWeight(.semibold) + Text(" rpm").foregroundStyle(.secondary)
                }
            }
            .font(.system(size: size, weight: .medium).monospacedDigit())
            .fixedSize()
        }
    }

    /// The color a play's type takes: hits and reaching base in the batting
    /// team's color, a home run gold, a strikeout red, outs neutral.
    private var tone: Color {
        guard let scene else { return .primary }
        switch scene.kind {
        case .homeRun: return ink.gold
        case .strikeout: return .red
        case .single, .double, .triple, .walk, .hitByPitch, .error, .stolenBase, .wildPitch, .passedBall, .balk, .indifference:
            return teams.batting.accent
        default: return .primary
        }
    }

    /// The scorer's mark, low in the foul ground on the left: the code big
    /// and bold ("6–3", a backwards K) in the play's color, runs in a pill in
    /// the batting team's color, the play in small capitals under it, and
    /// under that what Statcast measured of the ball, when it did.
    @ViewBuilder
    private var stamp: some View {
        if let scene, !scene.notation.code.isEmpty {
            let size = min(max(typeHeight * 0.2, 24), 54)
            let readout = scene.readout
            let title = [scene.title, scene.kind == .homeRun && readout == nil ? scene.distance.map { "\($0) ft" } : nil].compactMap { $0 }
                .joined(separator: " · ").uppercased()
            let titleSize = min(min(max(typeHeight * 0.056, 8), 14), self.size.width * 0.34 / (Double(title.count) * 0.72))
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: size * 0.18) {
                    code(scene.notation, size: size)
                        // A called third strike: the K turned round.
                        .scaleEffect(x: scene.notation.backwards ? -1 : 1, y: 1)
                    if scene.runs > 0 {
                        Text("+\(scene.runs)")
                            .font(.system(size: size * 0.46, weight: .heavy).monospacedDigit())
                            .foregroundStyle(Viz.ink(on: teams.batting.accent))
                            .padding(.horizontal, size * 0.16)
                            .padding(.vertical, size * 0.04)
                            .background(Capsule().fill(teams.batting.accent))
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - size * 0.08 }
                    }
                }
                // A long title ("DEFENSIVE INDIFFERENCE") steps down rather than reach across the field.
                Text(title)
                    .font(.system(size: titleSize, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(.secondary)
                if let readout {
                    // The same small capitals, a touch lighter: figures, not a heading.
                    Text(readout)
                        .font(.system(size: min(min(max(typeHeight * 0.056, 8), 14) * 0.92, self.size.width * 0.44 / (Double(readout.count) * 0.6)),
                                      weight: .semibold).monospacedDigit())
                        .tracking(0.6)
                        .foregroundStyle(.secondary)
                        .padding(.top, titleSize * 0.15)
                }
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
                .font(bold ? .system(size: size, weight: .heavy).monospacedDigit() : .system(size: size * 0.5, weight: .bold))
                .foregroundStyle(bold ? tone : Color.secondary)
        }
        return text.tracking(-0.5)
    }

    /// The headline: heavy, wide capitals between two short rules, in the
    /// play's color (a hit the batting team's, a grand slam or walk-off
    /// gold, a strikeout red, a double play neutral).
    @ViewBuilder
    private var banner: some View {
        if let banner = script.banner {
            let size = min(max(typeHeight * 0.13, 17), 40)
            let color: Color = switch banner.tone {
            case .hit: teams.batting.accent
            case .gold: ink.gold
            case .out: .primary
            case .strikeout: .red
            }
            HStack(spacing: size * 0.45) {
                Capsule().fill(color.opacity(0.65)).frame(width: size * 1.1, height: max(size * 0.07, 1.5))
                Text(banner.text)
                    .font(.system(size: size, weight: .black).width(.expanded))
                    .tracking(size * 0.06)
                    .foregroundStyle(color)
                Capsule().fill(color.opacity(0.65)).frame(width: size * 1.1, height: max(size * 0.07, 1.5))
            }
            .fixedSize()
        }
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
    /// The teams' own and second colors, so the figures always contrast
    /// (without them, the palette's colors as they are).
    var kits: TheaterKits? = nil

    var body: some View {
        let live = feed?.loaded == true ? feed?.theater : nil
        let state = live.flatMap { $0.play == nil ? nil : $0 } ?? preloaded ?? live ?? TheaterState()
        PlayStage(state: state, bases: bases, batting: batting, palette: palette, kits: kits)
    }
}

/// The theater's stage: the field and one frame of the play through the
/// camera (a TimelineView only while it replays), and its celebration.
private struct PlayStage: View {
    let state: TheaterState
    let bases: [Bool]?
    let batting: GameDetail.Side?
    let palette: TeamPalette
    let kits: TheaterKits?
    @Environment(\.celebrationClock) private var clock
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    /// The replay on screen: which play, when it began, and whether it's over.
    @State private var replay: Replay?
    /// The script last built: a body that runs again for the same play and
    /// field (a replay beginning or ending) doesn't build it again.
    @State private var scripts = ScriptMemo()

    struct Replay: Equatable {
        let id: String
        let start: Date
        /// The play as it began: kept to the end, whatever lands meanwhile.
        let play: PlayScene
        var done = false
    }

    /// A replayed play's end that has had its time on screen.
    @State private var rested: String?

    /// How long a replay's end stays up when the next at-bat hasn't begun.
    static let hold = TheaterKit.hold

    /// The play on screen: a replay's own until it's over; then how the
    /// latest ended, until the next pitch or the hold; then none, and the
    /// field shows the live bases and batter.
    private var play: PlayScene? {
        if let replay, !replay.done, replay.id == state.play?.id { return replay.play }
        guard let latest = state.play, !state.cleared, latest.id != rested else { return nil }
        return latest
    }

    /// Half as tall as wide, up to this; wider than that, the field centers in the well.
    static let maxHeight: CGFloat = 320

    /// The field between plays: the live bases and batter, or how the play left them.
    private var rest: PlayScript.Rest {
        guard let play else {
            return PlayScript.Rest(bases: bases ?? [false, false, false], bats: state.bats)
        }
        let swapped = play.endsInning
        return PlayScript.Rest(bases: swapped ? [false, false, false] : bases ?? play.basesAfter, bats: state.bats, swapped: swapped)
    }

    private var teams: TheaterTeams {
        let dressed: (top: Uniform, bottom: Uniform)
        if let kits {
            let d = TheaterTeams.dress(kits, scheme: scheme)
            dressed = (d.top, d.bottom)
        } else {
            let top = TheaterTeams.solid(palette.top, scheme), bottom = TheaterTeams.solid(palette.bottom, scheme)
            // Without kits the palette may have grayed a near-twin: gray against a color still reads apart.
            dressed = (Uniform(top), Uniform(bottom))
        }
        // The play's batting team; else the live one; else the top team (the visitors bat first).
        let side = play?.batting ?? batting ?? .top
        return side == .top ? TheaterTeams(batting: dressed.top, fielding: dressed.bottom)
            : TheaterTeams(batting: dressed.bottom, fielding: dressed.top)
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
        let play = play
        let script = scripts.script(play, rest: rest)
        let ink = TheaterInk(scheme)
        let teams = teams
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Group {
                    if playing {
                        TimelineView(.animation) { context in
                            PlayFrame(scene: play, script: script, t: time(at: context.date), teams: teams, ink: ink, size: geo.size)
                                .equatable()
                        }
                        .transition(.identity)
                    } else {
                        PlayFrame(scene: play, script: script, t: time(at: .now), teams: teams, ink: ink, size: geo.size)
                            .equatable()
                            .transition(.identity)
                    }
                }
                .id(play?.id)
                // A replay cuts in; a play that isn't replayed crossfades to how it ended.
                .transition(playing ? .identity : .opacity.animation(.easeInOut(duration: 0.35)))
                if let play {
                    TheaterCelebration(play: play, script: script, size: geo.size, color: teams.batting.accent,
                                       start: replay?.id == play.id ? replay?.start : nil)
                        .id(play.id)
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
            guard let replay else { return }
            if !replay.done {
                try? await Task.sleep(for: .seconds(max(script.duration - Date.now.timeIntervalSince(replay.start), 0) + 0.05))
                guard !Task.isCancelled, self.replay?.id == replay.id else { return }
                self.replay?.done = true
                return
            }
            // Done: its end holds a while, then the field returns to the game.
            try? await Task.sleep(for: Self.hold)
            guard !Task.isCancelled, self.replay?.id == replay.id else { return }
            rested = replay.id
        }
    }

    /// A new play replays from its pitch; history and Reduce Motion don't.
    private func begin() {
        guard clock == .live, !reduceMotion, state.news, let play = state.play, replay?.id != play.id else { return }
        replay = Replay(id: play.id, start: .now, play: play)
    }
}

/// One script, kept until its play or field changes (a reference: keeping
/// it redraws nothing). A measured play's flight is calibrated as it's built.
@MainActor
private final class ScriptMemo {
    private var play: PlayScene?
    private var rest: PlayScript.Rest?
    private var built: PlayScript?

    func script(_ play: PlayScene?, rest: PlayScript.Rest) -> PlayScript {
        if let built, self.play == play, self.rest == rest { return built }
        let script = play.map { PlayScript($0, rest: rest) } ?? PlayScript(rest: rest)
        (self.play, self.rest, built) = (play, rest, script)
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

/// One celebration per moment, and the theater owns its plays' when the
/// page shows it: a home run's fireworks burst at the wall it cleared (the
/// spray chart only flies its ball in), with confetti off the banner; a
/// triple's and a walk-off's confetti come off the banner too. Every burst
/// goes through the page's rules (`Celebration.cue`): the celebration
/// level, Reduce Motion, and one particle burst every 10 s. (pure; tested)
enum PlateCelebration {
    /// The spray chart bursts over a home run only when there's no theater to.
    static func sprayChartBursts(theaterShown: Bool) -> Bool { !theaterShown }

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

        var end: Double { at + cue.duration }
    }

    /// The theater's bursts for this play's moment, in script time. Nothing
    /// for another play's moment, or when the level is Off.
    static func theater(_ moment: LiveMoment?, play: PlayScene, script: PlayScript, level: CelebrationLevel,
                        reduceMotion: Bool, height: CGFloat) -> [Burst] {
        guard let moment, moment.id == play.id, moment.chart == .plate else { return [] }
        var bursts: [Burst] = []
        let gold = moment.accents.contains(.grandSlam) || moment.decisive
        func cue(_ effects: [CelebrationCue.Effect]?) -> CelebrationCue? {
            var cue = Celebration.cue(for: moment, level: level, reduceMotion: reduceMotion, geometry: .init(height: height),
                                      direction: .degrees(90), effects: effects)
            if gold { cue?.gold = true }
            return cue
        }
        // The theater is the stage: bursts grow with the well (the charts' are sized for their own).
        let scale = max(2.2, height / 95)
        if moment.kind == .homeRun, let fence = script.fence,
           let fireworks = cue([.fireworks(shells: moment.decisive ? 3 : moment.accents.contains(.grandSlam) ? 3 : 2)]) {
            // The shells burst as the ball clears the wall: two, three for a grand slam or a walk-off.
            bursts.append(Burst(cue: fireworks, at: fence.at - fireworks.delay, anchor: .field(fence.point), scale: scale))
        }
        // The banner's confetti: only ever confetti (Subtle, the cooldown and Reduce Motion leave the banner alone).
        if let banner = script.banner, banner.confetti, moment.kind == .homeRun || Celebration.theaterBursts(moment),
           let confetti = cue([.confetti(direction: .degrees(90), spread: .degrees(150), preset: .medium)]),
           confetti.effects.contains(where: { if case .confetti = $0 { return true }; return false }) {
            let at = moment.kind == .homeRun ? (script.fence?.at ?? banner.at) + 0.12 : banner.at + 0.05
            bursts.append(Burst(cue: confetti, at: at - confetti.delay, anchor: .banner, scale: scale * 0.7))
        }
        return bursts
    }
}

/// The theater's bursts, drawn through the camera so a firework stays on
/// the wall as the camera moves. A TimelineView only while one plays; on
/// the harness's frozen clock, the frame at t. With Reduce Motion there's no
/// replay: a home run blooms at the plate, as the play's end state shows.
private struct TheaterCelebration: View {
    let play: PlayScene
    let script: PlayScript
    let size: CGSize
    let color: Color
    /// When the replay began.
    let start: Date?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.celebrationClock) private var clock
    @Environment(\.celebrationLevel) private var level
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var live: Date?
    @State private var over: Date?
    /// This play's moment, kept once seen: its replay can begin after the
    /// page's moment slot has moved on (a play held a moment for Statcast).
    @State private var held: LiveMoment?

    var body: some View {
        let current = momentFor(.plate, in: moments)
        let moment = current?.id == play.id ? current : start == nil ? nil : held
        let bursts = PlateCelebration.theater(moment, play: play, script: script, level: level, reduceMotion: reduceMotion,
                                              height: size.height)
        Group {
            switch clock {
            case let .frozen(t):
                if bursts.contains(where: { t >= $0.at && t <= $0.end }) { surface(bursts, at: t) }
            case .live:
                if reduceMotion {
                    // The end state: a bloom where the runs crossed.
                    if current?.id == play.id, current?.kind == .homeRun {
                        CelebrationStage(moment: current, origin: FieldProjection(size: size).point(.zero), size: size,
                                         colors: .team(color), wellInset: 0)
                    }
                } else if let start, live == start, over != start {
                    TimelineView(.animation) { context in surface(bursts, at: context.date.timeIntervalSince(start)) }
                }
            }
        }
        .onChange(of: current?.id, initial: true) {
            if let current, current.id == play.id { held = current }
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

    private func surface(_ bursts: [PlateCelebration.Burst], at t: Double) -> some View {
        let palette = CelebrationColors.team(color).palette
        return Canvas { context, size in
            let f = FieldProjection(size: size, camera: script.camera.frame(at: t))
            context.clip(to: f.bounds)
            for burst in bursts where t >= burst.at && t <= burst.end {
                let origin = switch burst.anchor {
                case let .field(p): f.point(p)
                case .banner: CGPoint(x: size.width / 2, y: max(size.height * 0.055, 9) * 0.7 + min(max(size.height * 0.13, 17), 40) * 0.6)
                }
                var layer = context
                layer.translateBy(x: origin.x, y: origin.y)
                layer.scaleBy(x: burst.scale, y: burst.scale)
                Celebration.draw(Celebration.particles(burst.cue, origin: .zero, t: t - burst.at), in: layer, palette: palette)
            }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityHidden(true)
    }
}
