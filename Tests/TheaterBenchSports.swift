import SwiftUI
import simd

// Each sport on the engine bench: its session's sport, the game's facts from
// a recording's summary, and its frames as the painter poses them (what the
// meter reads, and what the cost probe and the video draw).

@MainActor
protocol BenchSport {
    associatedtype Sport: TheaterSport
    /// The painter's output for one frame.
    associatedtype Drawn

    static func facts(_ summary: JSON) -> Sport.Facts
    /// One frame posed (the work the view does per frame after sampling).
    static func pose(_ chain: PlanChain<Sport.Clip>, _ scratch: FrameScratch, size: CGSize) -> Drawn?
    /// Each man as the meter reads him.
    static func figures(_ drawn: Drawn, _ chain: PlanChain<Sport.Clip>, _ scratch: FrameScratch, size: CGSize) -> [MeterFigure]
    /// The frame's view (the Canvas the cost probe times, and the video's frame).
    static func view(_ drawn: Drawn, size: CGSize) -> AnyView
}

// MARK: - Basketball

@MainActor
enum HoopsBench: BenchSport {
    typealias Sport = HoopsSport

    static func facts(_ summary: JSON) -> HoopsFacts {
        let teams = TheaterBench.Samples.nbaTeams(summary)
        return HoopsFacts(topIsHome: teams.topIsHome, flipped: false, topID: teams.topID, bottomID: teams.bottomID, topName: teams.topName,
                          bottomName: teams.bottomName)
    }

    static func pose(_ chain: PlanChain<HoopsClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: HoopsClip, t: Double, world: BasketballFrame.World)? {
        HoopsPainter.frame(chain, scratch, size: size)
    }

    static func figures(_ drawn: (clip: HoopsClip, t: Double, world: BasketballFrame.World), _ chain: PlanChain<HoopsClip>, _ scratch: FrameScratch,
                        size: CGSize) -> [MeterFigure] {
        EngineRun.meterFigures(chain, scratch, drawn, size: size)
    }

    static func view(_ drawn: (clip: HoopsClip, t: Double, world: BasketballFrame.World), size: CGSize) -> AnyView {
        AnyView(BasketballFrame(scene: drawn.clip.scene, script: drawn.clip.script, t: drawn.t,
                                teams: BasketballTeams(offense: Uniform(.orange), defense: Uniform(.blue)), ink: TheaterInk(.dark), size: size,
                                world: drawn.world))
    }
}

// MARK: - Football

@MainActor
enum GridBench: BenchSport {
    typealias Sport = GridSport

    static func facts(_ summary: JSON) -> GridFacts {
        let competitors = summary["header"]["competitions"][0]["competitors"].array
        let home = competitors.first { $0["homeAway"].string == "home" }, away = competitors.first { $0["homeAway"].string == "away" }
        // American football lists the visitors first: the top team.
        return GridFacts(topIsHome: false, flipped: false, topID: away?["team"]["id"].string, bottomID: home?["team"]["id"].string,
                         homeAbbreviation: home?["team"]["abbreviation"].string ?? "", awayAbbreviation: away?["team"]["abbreviation"].string ?? "")
    }

    static func pose(_ chain: PlanChain<GridClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: GridClip, t: Double, world: FootballFrame.World)? {
        GridPainter.frame(chain, scratch, size: size)
    }

    static func figures(_ drawn: (clip: GridClip, t: Double, world: FootballFrame.World), _ chain: PlanChain<GridClip>, _ scratch: FrameScratch,
                        size: CGSize) -> [MeterFigure] {
        let baked = chain.plans[scratch.plan]
        let right = drawn.clip.right
        let f = GridProjection(size: size, camera: drawn.world.camera, yaw: drawn.world.yaw)
        var out: [MeterFigure] = []
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            guard let w = drawn.world.figures.first(where: { $0.index == Int(actor.id.raw) }) else { continue }
            let unit = RigLens(f, at: w.at).unit
            func foot(_ v: RigVector) -> SIMD3<Double> {
                let c = cos(w.heading), s = sin(w.heading)
                let local = CGPoint(x: w.at.x + (v.x * c - v.y * s) / unit, y: w.at.y + (v.x * s + v.y * c) / unit)
                let p = GridWorld.point(local, right: right)
                return SIMD3(p.x, p.y, v.z / unit)
            }
            let planted = track.rig.planted(at: scratch.p)
            let m = actor.motion
            let rig = track.rig.feet(at: scratch.p, anchor: CGPoint(x: actor.position.x, y: actor.position.y), heading: m.heading, unit: 1,
                                     speed: m.speed, stand: (RigVector(0, 0.1, 0), RigVector(0, -0.1, 0)))
            func rigWorld(_ v: RigVector) -> SIMD2<Double> {
                SIMD2(actor.position.x + v.x * cos(m.heading) - v.y * sin(m.heading), actor.position.y + v.x * sin(m.heading) + v.y * cos(m.heading))
            }
            let placement = baked.plan.placements[actor.placement]
            let traveling = placement.join[actor.id].map { scratch.p < $0 } ?? false
            var figure = MeterFigure(key: Int(actor.id.raw), position: actor.position, heading: m.heading, band: MotionLimits.football.band(track.figure.band),
                                     feet: (foot(w.body.left), foot(w.body.right)),
                                     planted: (planted.left && w.body.left.z < 0.01, planted.right && w.body.right.z < 0.01), weight: m.weight,
                                     height: track.figure.height, opacity: actor.opacity)
            figure.source = traveling ? "travel" : placement.clip.ambient ? "idle" : "replay"
            figure.rigFeet = (rigWorld(rig.left), rigWorld(rig.right))
            out.append(figure)
        }
        return out
    }

    static func view(_ drawn: (clip: GridClip, t: Double, world: FootballFrame.World), size: CGSize) -> AnyView {
        AnyView(FootballFrame(scene: drawn.clip.scene, script: drawn.clip.script, t: drawn.t,
                              teams: FootballTeams(offense: Uniform(.green), defense: Uniform(.blue)), ink: TheaterInk(.dark), size: size,
                              world: drawn.world))
    }
}
