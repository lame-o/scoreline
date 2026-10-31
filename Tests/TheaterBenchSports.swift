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

    static var limits: MotionLimits { get }
    static func facts(_ summary: JSON, recording: Recording) -> Sport.Facts
    /// One frame posed (the work the view does per frame after sampling).
    static func pose(_ chain: PlanChain<Sport.Clip>, _ scratch: FrameScratch, size: CGSize) -> Drawn?
    /// Each man as the meter reads him.
    static func figures(_ drawn: Drawn, _ chain: PlanChain<Sport.Clip>, _ scratch: FrameScratch, size: CGSize) -> [MeterFigure]
    /// The frame's view (the Canvas the cost probe times, and the video's frame).
    static func view(_ drawn: Drawn, size: CGSize) -> AnyView
}

/// What moves a man at p, for the meter's causes: the splice's travel (late into a moving clip, or carrying a speed
/// over his sprint from the clip before), a clip's own motion by kind; a referee's or a newcomer's.
@MainActor
func benchCause<Clip: TheaterClip>(_ placement: ClipPlacement<Clip>, _ id: ActorID, at p: PTime, kind: String, band: String, sprint: Double) -> String {
    var cause: String
    if let join = placement.join[id], p < join {
        cause = "splice travel"
        if placement.entry > placement.clip.still + 1e-6 {
            cause += " (late, into a moving clip)"
        } else if let path = placement.travel[id], simd_length(path.velocity(at: placement.start)) > sprint * 1.001 {
            cause += " (carrying an overspeed)"
        }
    } else {
        cause = "clip: \(kind)"
    }
    if band == "official" { cause = "referee · " + cause }
    if placement.entering.contains(id), p < placement.start + 0.4 { cause = "newcomer · " + cause }
    return cause
}

// MARK: - Basketball

@MainActor
enum HoopsBench: BenchSport {
    typealias Sport = HoopsSport
    static var limits: MotionLimits { .basketball }

    static func facts(_ summary: JSON, recording: Recording) -> HoopsFacts {
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
    static var limits: MotionLimits { .football }

    static func facts(_ summary: JSON, recording: Recording) -> GridFacts {
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
            figure.source = benchCause(placement, actor.id, at: scratch.p, kind: placement.clip.ambient ? "idle" : "replay", band: track.figure.band,
                                       sprint: MotionLimits.football.band(track.figure.band).sprint)
            _ = traveling
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

// MARK: - Soccer

@MainActor
enum PitchBench: BenchSport {
    typealias Sport = PitchSport
    static var limits: MotionLimits { .soccer }

    static func facts(_ summary: JSON, recording: Recording) -> PitchFacts {
        let competitors = summary["header"]["competitions"][0]["competitors"].array
        let home = competitors.first { $0["homeAway"].string == "home" }
        return PitchFacts(homeTeamID: home?["team"]["id"].string ?? home?["id"].string ?? recording.teams().home, flipped: false)
    }

    static func pose(_ chain: PlanChain<PitchClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: PitchClip, t: Double, world: SoccerFrame.World)? {
        PitchPainter.frame(chain, scratch, size: size)
    }

    static func figures(_ drawn: (clip: PitchClip, t: Double, world: SoccerFrame.World), _ chain: PlanChain<PitchClip>, _ scratch: FrameScratch,
                        size: CGSize) -> [MeterFigure] {
        let baked = chain.plans[scratch.plan]
        var out: [MeterFigure] = []
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            let placement = baked.plan.placements[actor.placement]
            let m = actor.motion
            let planted = track.rig.planted(at: scratch.p)
            let rig = track.rig.feet(at: scratch.p, anchor: CGPoint(x: actor.position.x, y: actor.position.y), heading: m.heading, unit: 1,
                                     speed: m.speed, stand: (RigVector(0, 0.1, 0), RigVector(0, -0.1, 0)))
            func rigWorld(_ v: RigVector) -> SIMD2<Double> {
                SIMD2(actor.position.x + v.x * cos(m.heading) - v.y * sin(m.heading), actor.position.y + v.x * sin(m.heading) + v.y * cos(m.heading))
            }
            let band = MotionLimits.soccer.band(track.figure.band)
            var figure = MeterFigure(key: Int(actor.id.raw), position: actor.position, heading: m.heading, band: band,
                                     feet: (SIMD3(rigWorld(rig.left), 0), SIMD3(rigWorld(rig.right), 0)), planted: (planted.left, planted.right),
                                     weight: m.weight, height: track.figure.height, opacity: actor.opacity)
            figure.source = benchCause(placement, actor.id, at: scratch.p, kind: placement.clip.ambient ? "idle" : "moment", band: track.figure.band,
                                       sprint: band.sprint)
            figure.rigFeet = (rigWorld(rig.left), rigWorld(rig.right))
            out.append(figure)
        }
        return out
    }

    static func view(_ drawn: (clip: PitchClip, t: Double, world: SoccerFrame.World), size: CGSize) -> AnyView {
        AnyView(SoccerFrame(scene: drawn.clip.scene, script: drawn.clip.script, t: drawn.t,
                            teams: SoccerTeams(attacking: Uniform(.red), defending: Uniform(.blue)), ink: TheaterInk(.dark), size: size,
                            world: drawn.world))
    }
}

// MARK: - Baseball

@MainActor
enum DiamondBench: BenchSport {
    typealias Sport = DiamondSport
    static var limits: MotionLimits { DiamondClip.limits }

    static func facts(_ summary: JSON, recording: Recording) -> DiamondFacts {
        let competitors = summary["header"]["competitions"][0]["competitors"].array
        let home = competitors.first { $0["homeAway"].string == "home" }, away = competitors.first { $0["homeAway"].string == "away" }
        // Baseball lists the visitors first: the top team.
        return DiamondFacts(topID: away?["team"]["id"].string ?? away?["id"].string, bottomID: home?["team"]["id"].string ?? home?["id"].string)
    }

    static func pose(_ chain: PlanChain<DiamondClip>, _ scratch: FrameScratch, size: CGSize) -> (clip: DiamondClip, t: Double, world: PlayFrame.World)? {
        DiamondPainter.frame(chain, scratch, size: size)
    }

    static func figures(_ drawn: (clip: DiamondClip, t: Double, world: PlayFrame.World), _ chain: PlanChain<DiamondClip>, _ scratch: FrameScratch,
                        size: CGSize) -> [MeterFigure] {
        let baked = chain.plans[scratch.plan]
        var out: [MeterFigure] = []
        for actor in scratch.actors {
            let track = baked.tracks[actor.track]
            let placement = baked.plan.placements[actor.placement]
            let m = actor.motion
            let planted = track.rig.planted(at: scratch.p)
            let rig = track.rig.feet(at: scratch.p, anchor: CGPoint(x: actor.position.x, y: actor.position.y), heading: m.heading, unit: 1,
                                     speed: m.speed, stand: (RigVector(0, 0.1, 0), RigVector(0, -0.1, 0)))
            func rigWorld(_ v: RigVector) -> SIMD2<Double> {
                SIMD2(actor.position.x + v.x * cos(m.heading) - v.y * sin(m.heading), actor.position.y + v.x * sin(m.heading) + v.y * cos(m.heading))
            }
            let band = DiamondClip.limits.band(track.figure.band)
            var figure = MeterFigure(key: Int(actor.id.raw), position: actor.position, heading: m.heading, band: band,
                                     feet: (SIMD3(rigWorld(rig.left), 0), SIMD3(rigWorld(rig.right), 0)), planted: (planted.left, planted.right),
                                     weight: m.weight, height: track.figure.height, opacity: actor.opacity)
            figure.source = benchCause(placement, actor.id, at: scratch.p, kind: "\(placement.clip.kind)", band: track.figure.band, sprint: band.sprint)
            figure.rigFeet = (rigWorld(rig.left), rigWorld(rig.right))
            out.append(figure)
        }
        return out
    }

    static func view(_ drawn: (clip: DiamondClip, t: Double, world: PlayFrame.World), size: CGSize) -> AnyView {
        AnyView(PlayFrame(scene: drawn.clip.scene, script: drawn.clip.script, t: drawn.t, teams: TheaterTeams(batting: .red, fielding: .blue),
                          ink: TheaterInk(.dark), size: size, world: drawn.world))
    }
}
