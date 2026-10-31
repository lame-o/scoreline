import SwiftUI

// The basketball theater on the choreography engine, Phase 0 (CHOREOGRAPHY
// §12): today's scripts (a marquee replay, a beat, the court between plays)
// become clips the engine places at their plays' anchors, and every hand-off
// between them is a splice from the world as it stands.
//
// The world frame is the absolute court (§7.1): x 0–94 along it, y 0–50 from
// the near sideline, the right basket at x = 88.75. A script is laid out in
// its own frame, the offense attacking the basket at x = 88.75, and drawn
// turned half a turn when its play is at the left basket; in the world that
// half turn is the figures' (x → 94 − x, y → 50 − y), and the view's yaw is
// −30° at the right basket and +30° at the left: a camera parameter that
// orbits as the ball changes ends, never a frame that snaps (B4).

enum HoopsWorld {
    /// The court's center: a left-basket script turns about it.
    static let center = SIMD2(Hoops.length / 2, Hoops.width / 2)

    /// The world yaw at each basket.
    static func yaw(right: Bool) -> Double { right ? -Hoops.turn : Hoops.turn }

    /// Whether a script is laid out at the right basket (its yaw is the right's).
    static func right(_ yaw: Double) -> Bool { abs(remainder(yaw - Hoops.yaw(right: true), 2 * .pi)) < 0.1 }

    /// A point of a script's frame in the world.
    static func point(_ p: CGPoint, right: Bool) -> SIMD2<Double> {
        right ? SIMD2(p.x, p.y) : SIMD2(Hoops.length - p.x, Hoops.width - p.y)
    }

    /// A world point in a script's frame.
    static func local(_ p: SIMD2<Double>, right: Bool) -> CGPoint {
        right ? CGPoint(x: p.x, y: p.y) : CGPoint(x: Hoops.length - p.x, y: Hoops.width - p.y)
    }

    static func point(_ p: FieldPoint, right: Bool) -> SIMD3<Double> {
        let g = point(p.ground, right: right)
        return SIMD3(g.x, g.y, p.z)
    }

    /// A heading of a script's frame in the world.
    static func heading(_ h: Double, right: Bool) -> Double { right ? h : h + .pi }

    /// A script's camera framing (in its view, at its yaw) as the world camera:
    /// the ground point at the view's center, the span, the world yaw.
    static func camera(_ frame: CameraFrame, yaw: Double) -> SIMD4<Double> {
        let right = right(yaw)
        // The view's (x, y) back onto the ground: y was halved by the dimetric view.
        let vx = frame.x, vy = 2 * frame.y
        let ground = SIMD2(vx * cos(yaw) - vy * sin(yaw), vx * sin(yaw) + vy * cos(yaw))
        let world = right ? ground : SIMD2(Hoops.length, Hoops.width) - ground
        return SIMD4(world.x, world.y, log(frame.span), Self.yaw(right: right))
    }

    /// The world camera as a framing in the view at its yaw (the projection's terms).
    static func frame(_ camera: SIMD4<Double>) -> (frame: CameraFrame, yaw: Double) {
        let yaw = camera.w
        let view = Gridiron.view(CGPoint(x: camera.x, y: camera.y), yaw: yaw)
        return (CameraFrame(x: view.x, y: view.y / 2, span: exp(camera.z)), yaw)
    }
}
