import SwiftUI

// The play theater as a broadcast, checked on real plays (World Series Game
// 3's, Game 2's home run): the camera per shot (tight on the battery, riding
// a grounder on the infield, widening with a fly, chasing a home run to the
// wall and cutting to the trot, framing each throw, resting exactly where it
// rests between plays) and never faster than its caps; the two teams always
// dressed apart; one celebration per moment; the headline.

extension ScorelineTests {
    static func playBroadcast() {
        print("\nPlay theater: the broadcast")
        guard let data = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("ws-g3-plays.json")),
              let summary = try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("3bd207fad0c0e7da8976ca99.bin")) else {
            return check(false, "Game 3 plays and Game 2 summary fixtures load")
        }
        let g3 = JSON(data: data)
        let plays = g3["items"].array
        var names: [String: String] = [:]
        for (id, name) in (g3["names"].raw as? [String: String]) ?? [:] { names[id] = name }
        let side: (String?) -> GameDetail.Side? = { $0 == "8" ? .top : $0 == "30" ? .bottom : nil }
        func scene(_ id: String) -> PlayScene? {
            plays.firstIndex { $0["id"].string == id }.flatMap { PlayScene.parse(plays, at: $0, side: side, names: names) }
        }
        let g2 = JSON(data: summary)["plays"].array
        let homer = g2.firstIndex { $0["id"].string == "4019080430005990057" }
            .flatMap { PlayScene.parse(g2, at: $0, side: { $0 == "30" ? .top : .bottom }) }
        func script(_ s: PlayScene?) -> PlayScript? {
            s.map { PlayScript($0, rest: PlayScript.Rest(bases: $0.endsInning ? [false, false, false] : $0.basesAfter,
                                                          bats: .right, swapped: $0.endsInning)) }
        }
        /// Where a point sits in the view, as fractions across and up.
        func view(_ p: FieldPoint, _ c: CameraFrame) -> (x: Double, y: Double) {
            (0.5 + (p.x - c.x) / (c.span * CameraFrame.aspect), 0.5 + (p.y * 0.5 + p.z * 0.82 - c.y) / c.span)
        }
        func inView(_ p: FieldPoint, _ c: CameraFrame, slack: Double = 0) -> Bool {
            let v = view(p, c)
            return v.x >= -slack && v.x <= 1 + slack && v.y >= -slack && v.y <= 1 + slack
        }

        let groundOut = scene("4019080440005990057"), flyOut = scene("4019080440102990057"), popUp = scene("4019080440004990057")
        let dp = scene("4019080441102990057"), looking = scene("4019080440902990057"), walk = scene("4019080440403990057")
        let single = scene("4019080440003990057"), double = scene("4019080440811990057")

        // MARK: Camera, shot by shot

        if let s = script(groundOut), let release = s.release {
            let battery = s.camera.frame(at: 0)
            check(battery.span < 60 && PlayScript.Shot.battery.allSatisfy { inView($0, battery) },
                  "pre-pitch: tight on the battery (pitcher, both boxes, catcher)", "span \(battery.span)")
            let pitch = s.camera.frame(at: release + 0.2)
            check(abs(pitch.span - battery.span) < 1 && hypot(pitch.x - battery.x, pitch.y - battery.y) < 1, "…and it stays tight through the pitch")
            let flight = s.flights[s.batted ?? 0]
            let riding = stride(from: flight.start, through: flight.end, by: 1 / 60).map { s.camera.frame(at: $0) }
            check(riding.allSatisfy { $0.span < 140 && $0.y < 90 && abs($0.x) < 100 }, "a grounder: the camera stays on the infield",
                  "\(riding.map { Int($0.span) })")
            check(stride(from: flight.start, through: flight.end, by: 1 / 30).allSatisfy { inView(flight.point(at: $0), s.camera.frame(at: $0), slack: 0.02) },
                  "…with the ball in frame all the way to the shortstop")
            check(s.camera.frame(at: s.duration) == .rest && s.camera.frame(at: .infinity) == .rest,
                  "the end: it settles exactly on the rest framing (the infield and the runners)")
        } else {
            check(false, "6-3 script")
        }
        if let s = script(flyOut), let batted = s.batted {
            let flight = s.flights[batted]
            let frames = stride(from: flight.start, through: flight.end, by: 1 / 60).map { ($0, s.camera.frame(at: $0)) }
            let widest = frames.map(\.1.span).max() ?? 0
            check(widest > s.camera.frame(at: 0).span * 1.6, "a fly widens with its height and distance",
                  "\(Int(s.camera.frame(at: 0).span)) → \(Int(widest)) ft")
            let seen = frames.filter { inView(flight.point(at: $0.0), $0.1, slack: 0.03) }.count
            check(Double(seen) / Double(frames.count) > 0.9, "…keeping the ball in frame", "\(seen) of \(frames.count) frames")
            let catcher = s.actors[8]
            check(inView(FieldPoint(catcher.position(at: flight.end)), s.camera.frame(at: flight.end)), "…and the right fielder at the catch")
        }
        if let s = script(popUp), let batted = s.batted {
            let flight = s.flights[batted], catchAt = s.camera.frame(at: flight.end)
            check(inView(FieldPoint(s.actors[5].position(at: flight.end)), catchAt), "a pop-up: the shortstop in frame as he squeezes it")
        }
        if let s = script(dp) {
            let throwsFramed = s.flights.indices.filter { $0 > (s.batted ?? 0) }.allSatisfy { i in
                let f = s.flights[i], mid = s.camera.frame(at: (f.start + f.end) / 2 + 0.15)
                return inView(f.from, mid, slack: 0.02) && inView(f.to, mid, slack: 0.02)
            }
            check(throwsFramed, "throws: each one framed end to end (4 to 6, 6 to 3)")
            let flight = s.flights[s.batted ?? 0]
            let fielder = FieldPoint(s.actors[3].position(at: flight.end))
            check(inView(fielder, s.camera.frame(at: flight.end)) && s.camera.frame(at: flight.end).span < s.camera.frame(at: s.duration).span,
                  "…after closing in on the second baseman as he fields it")
        }
        if let s = script(homer), let fence = s.fence {
            let at = s.camera.frame(at: fence.at)
            check(inView(fence.point, at) && at.span < 140, "a home run: the camera chases it to the wall it clears",
                  "span \(Int(at.span)), \(view(fence.point, at))")
            if let cut = s.shots.first(where: \.cut) {
                let before = s.camera.frame(at: cut.from - 1 / 60), after = s.camera.frame(at: cut.from + 1 / 60)
                check(hypot(before.x - after.x, before.y - after.y) > 50
                      && inView(FieldPoint(s.actors[9].position(at: cut.from + 0.2)), s.camera.frame(at: cut.from + 0.2)),
                      "…then cuts to the trot: the batter coming home")
            } else {
                check(false, "…then cuts to the trot")
            }
        }

        // Never seasick: every play of the game under the caps, eased, and finite.
        let all = plays.indices.filter { plays[$0]["type"]["type"].string == "play-result" }
            .compactMap { PlayScene.parse(plays, at: $0, side: side, names: names) }.compactMap(script) + [script(homer)].compactMap { $0 }
        var fastest = (pan: 0.0, closer: 0.0, wider: 0.0), jerky: [String] = []
        for s in all {
            let cuts = s.shots.filter(\.cut).map(\.from)
            var previous = s.camera.frame(at: 0)
            for i in 1...Int(s.duration * 60) {
                let t = Double(i) / 60, now = s.camera.frame(at: t)
                guard !cuts.contains(where: { $0 > t - 1 / 30 && $0 <= t + 1 / 60 }) else { previous = now; continue }
                let pan = hypot(now.x - previous.x, now.y - previous.y) * 60 / now.span, zoom = log(now.span / previous.span) * 60
                fastest = (max(fastest.pan, pan), max(fastest.closer, -zoom), max(fastest.wider, zoom))
                if !pan.isFinite || !zoom.isFinite { jerky.append("\(t)") }
                previous = now
            }
        }
        check(fastest.pan <= 1.5 && fastest.closer <= 1.2 && fastest.wider <= 2.3 && jerky.isEmpty,
              "the camera never outruns its caps on any play: pans ≤ 1.4 view-heights/s, zooms in ≤ ×3/s, out ≤ ×9/s",
              String(format: "pan %.2f, in %.2f, out %.2f", fastest.pan, fastest.closer, fastest.wider))
        // The scorer's mark's corner is clear of every figure at rest.
        let clear = all.filter { $0.stamp.isFinite }.allSatisfy { s in
            let rest = CameraFrame.rest
            return s.actors.filter { $0.opacity(at: s.duration) > 0.5 }.allSatisfy { a in
                let v = view(FieldPoint(a.position(at: s.duration)), rest)
                return !(v.x - 6 / (rest.span * 2) < s.corner.width && v.y - 3 / rest.span < s.corner.height)
            }
        }
        check(clear, "at rest the scorer's mark's corner is clear of every figure")

        // MARK: Teams, always apart

        func lab(_ c: Color) -> OKLab? { NSColor(c).usingColorSpace(.sRGB).flatMap(OKLab.init) }
        func apart(_ a: Uniform, _ b: Uniform) -> Bool {
            guard let x = lab(a.jersey), let y = lab(b.jersey) else { return false }
            return x.distance(to: y) >= TheaterTeams.apart
        }
        let navies = TheaterKits(top: TeamKit(color: "13294b"), bottom: TeamKit(color: "092c5c"))
        let espn = TheaterKits(top: TeamKit(color: "13294b", alternate: "ffc52f"), bottom: TeamKit(color: "092c5c", alternate: "8fbce6"))
        for scheme in [ColorScheme.dark, .light] {
            let mode = scheme == .dark ? "dark" : "light"
            let plain = TheaterTeams.dress(navies, scheme: scheme)
            check(plain.rule == .whites(.bottom) && apart(plain.top, plain.bottom),
                  "\(mode): two navies with no second colors: the home team wears whites", "\(plain.rule)")
            let dressed = TheaterTeams.dress(espn, scheme: scheme)
            check(dressed.rule == .second(.top) && apart(dressed.top, dressed.bottom),
                  "\(mode): Brewers and Rays navies: the Brewers change into gold (their second color), not gray", "\(dressed.rule)")
            let rivals = TheaterTeams.dress(TheaterKits(top: TeamKit(color: "0c2340"), bottom: TeamKit(color: "bd3039")), scheme: scheme)
            check(rivals.rule == .own && apart(rivals.top, rivals.bottom), "\(mode): navy and red read apart as they are")
            // White and gray second colors aren't colors: they don't count.
            let blank = TheaterTeams.dress(TheaterKits(top: TeamKit(color: "005a9c", alternate: "ffffff"),
                                                       bottom: TeamKit(color: "004687", alternate: "c0c0c0")), scheme: scheme)
            check(blank.rule == .whites(.bottom) && apart(blank.top, blank.bottom), "\(mode): two blues whose second colors are white and silver: whites")
        }
        let lightWhites = TheaterTeams.dress(navies, scheme: .light).bottom
        check(lightWhites.piping != nil, "light: whites carry piping in the team's color (a white halo wouldn't show them)")
        let pale = TheaterTeams.dress(TheaterKits(top: TeamKit(color: "fdb827"), bottom: TeamKit(color: "ffc52f")), scheme: .light)
        check(pale.rule == .whites(.bottom) && apart(pale.top, pale.bottom), "light: two golds: the home team in charcoal, dark against light")
        let black = TheaterTeams.dress(TheaterKits(top: TeamKit(color: "000000"), bottom: TeamKit(color: "27251f")), scheme: .dark)
        check(apart(black.top, black.bottom), "dark: two black teams (gray on a dark panel) still read apart", "\(black.rule)")

        // MARK: One celebration per moment

        check(!PlateCelebration.sprayChartBursts(theaterShown: true) && PlateCelebration.sprayChartBursts(theaterShown: false),
              "a home run's fireworks: the theater's when it's on the page, else the spray chart's")
        if let play = homer, let s = script(homer), let fence = s.fence {
            var moment = LiveMoment(id: play.id, chart: .plate, tier: .score, kind: .homeRun, lead: "Home run", detail: play.text)
            moment.burst = true
            let full = PlateCelebration.theater(moment, play: play, script: s, level: .full, reduceMotion: false, height: 156)
            let fireworks = full.first { if case .field = $0.anchor { return true }; return false }
            check(fireworks.map { $0.cue.effects == [.fireworks(shells: 2)] && abs($0.at + $0.cue.delay - fence.at) < 0.001
                    && $0.anchor == .field(fence.point) } == true,
                  "the theater's home run: two shells bursting at the wall as the ball clears it")
            check(full.contains { $0.anchor == .banner && $0.cue.effects.contains { if case .confetti = $0 { return true }; return false } },
                  "…and confetti off the banner")
            let subtle = PlateCelebration.theater(moment, play: play, script: s, level: .subtle, reduceMotion: false, height: 156)
            check(subtle.count == 1 && subtle[0].cue.effects == [.sparks(rays: 8, length: 13)], "Subtle: sparks at the wall, no confetti")
            check(PlateCelebration.theater(moment, play: play, script: s, level: .off, reduceMotion: false, height: 156).isEmpty, "Off: nothing")
            let still = PlateCelebration.theater(moment, play: play, script: s, level: .full, reduceMotion: true, height: 156)
            check(still.count == 1 && still[0].cue.effects == [.bloom(radius: 22)], "Reduce Motion: one bloom, no confetti")
            var cooled = moment
            cooled.burst = false
            check(PlateCelebration.theater(cooled, play: play, script: s, level: .full, reduceMotion: false, height: 156)
                    .map(\.cue.effects) == [[.sparks(rays: 8, length: 13)]], "inside the page's 10 s cooldown: sparks, no confetti")
            var slam = moment
            slam.accents = [.grandSlam]
            let slams = PlateCelebration.theater(slam, play: play, script: s, level: .full, reduceMotion: false, height: 156)
            check(slams.first?.cue.effects == [.fireworks(shells: 3)] && slams.allSatisfy(\.cue.gold), "a grand slam: three shells, all gold")
            let other = LiveMoment(id: "elsewhere", chart: .plate, tier: .score, kind: .homeRun, lead: "Home run", detail: "")
            check(PlateCelebration.theater(other, play: play, script: s, level: .full, reduceMotion: false, height: 156).isEmpty,
                  "another play's moment never bursts over this one")
        }
        if var triple = double {
            triple.kind = .triple
            triple.runners = triple.runners.map { $0.from == 0 ? PlayScene.Runner(id: $0.id, from: 0, end: .base(3)) : $0 }
            let s = script(triple)
            var moment = LiveMoment(id: triple.id, chart: .plate, tier: .score, kind: .runScored, lead: "Run scores", detail: "",
                                    accents: [.triple])
            moment.burst = true
            check(Celebration.wantsBurst(moment) && !Celebration.wantsBurst(LiveMoment(id: "h", chart: .plate, tier: .swing, kind: .hit,
                                                                                       lead: "Single", detail: "")),
                  "a triple's confetti counts toward the page's burst cooldown; a single's nothing doesn't")
            let bursts = s.map { PlateCelebration.theater(moment, play: triple, script: $0, level: .full, reduceMotion: false, height: 156) } ?? []
            check(s?.banner?.text == "TRIPLE" && s?.banner?.confetti == true && bursts.count == 1 && bursts[0].anchor == .banner,
                  "a triple: TRIPLE across the top, with confetti off it")
            check(s.map { b in b.banner.map { abs($0.at - (b.actors[9].moves.first { $0.path.last == Ballpark.base(3) }?.end ?? 0)) < 0.001 } ?? false } == true
                  && s?.actors[9].slide != nil, "…landing as he reaches third (sliding in)")
        }

        // MARK: The headline

        let banners: [(String, PlayScene?, String?, PlayScript.Banner.Tone?)] = [
            ("a home run", homer, "HOME RUN", .hit), ("a double", double, "DOUBLE", .hit), ("a double play", dp, "DOUBLE PLAY", .out),
            ("a strikeout", looking, "STRIKEOUT", .strikeout), ("a single", single, nil, nil), ("a walk", walk, nil, nil),
            ("a groundout", groundOut, nil, nil), ("a flyout", flyOut, nil, nil),
        ]
        let wrong = banners.filter { name, scene, text, tone in script(scene).map { $0.banner?.text != text || $0.banner?.tone != tone } ?? true }
        check(wrong.isEmpty, "banners for marquee plays only: HOME RUN, DOUBLE, DOUBLE PLAY, STRIKEOUT; none for a single, a walk or a routine out",
              wrong.map(\.0).joined(separator: ", "))
        if let s = script(homer), let b = s.banner, let fence = s.fence {
            check(b.at < fence.at && b.at > s.flights[s.batted ?? 0].start && b.until + 0.3 <= s.duration,
                  "a home run's banner lands off the bat, holds through the trot, and clears before the replay ends")
        }
        if let s = script(dp), let b = s.banner {
            check(b.at == s.stamp && b.until + 0.3 <= s.duration, "a double play's lands with the last out")
            // The banner and the stamp both gone or settled: the last frame is the static scene, pixel for pixel.
            func frame(_ t: Double) -> Data? {
                let view = PlayFrame(scene: dp, script: s, t: t, teams: TheaterTeams(batting: .blue, fielding: .orange), ink: TheaterInk(.dark),
                                     size: CGSize(width: 312, height: 156))
                    .frame(width: 312, height: 156)
                    .background(Color(white: 0.16))
                    .environment(\.colorScheme, .dark)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                return renderer.cgImage?.dataProvider?.data as Data?
            }
            let rest = frame(.infinity), last = frame(s.duration), mid = frame(b.at + 0.5)
            check(rest != nil && last == rest && mid != rest, "…and the replay still ends exactly on the static scene, banner gone",
                  "rest \(rest?.count ?? -1), last matches \(last == rest), mid \(mid?.count ?? -1) matches \(mid == rest)")
        }
        let walkOffEntry = JSON(["id": "w", "atBatId": "w1", "type": ["type": "play-result"], "alternativeType": ["type": "single"],
                                 "text": "Bauers singled to left, Chourio scored.", "team": ["id": "30"], "scoreValue": 1,
                                 "period": ["type": "Bottom", "number": 9], "homeScore": 4, "awayScore": 3,
                                 "hitCoordinate": ["x": 90, "y": 130], "trajectory": "L",
                                 "participants": [["type": "batter", "athlete": ["id": "1"]], ["type": "onFirst", "athlete": ["id": "1"]]]]
                                as [String: Any])
        let walkOff = PlayScene.parse([walkOffEntry], at: 0, side: side)
        check(walkOff?.walkOff == true && script(walkOff)?.banner.map { $0.text == "WALK-OFF" && $0.tone == .gold && $0.confetti } == true
              && dp?.walkOff == false, "a walk-off (the home team ahead in the bottom of the 9th): WALK-OFF in gold, with confetti")

        // MARK: Figures

        if let s = script(dp) {
            check(s.release != nil && s.actors[9].swing != nil, "the pitcher's delivery and the batter's swing are on the clock")
            check(s.actors[3].actions.contains { $0.kind == .throwBall } && s.actors[5].actions.contains { $0.kind == .glove }
                  && s.actors[5].actions.contains { $0.kind == .throwBall } && s.actors[2].actions.contains { $0.kind == .glove },
                  "a 4-6-3: the second baseman throws, the shortstop takes it and throws, the first baseman gloves it")
            check(s.actors.contains { $0.role == .runner && $0.slide != nil }, "…and the runner from first slides into second")
        }
        check(script(groundOut).map { !$0.puffs.isEmpty } == true && script(flyOut).map { $0.puffs.isEmpty } == true,
              "a grounder kicks up dust where it hops; a fly doesn't")
        let striding = [0.0, 0.3, 0.6].map { RigPose.gait(RigMotion(heading: 0, phase: $0, speed: 6, push: 0, weight: 1),
                                                         feet: (RigVector(0.1, 0.06, 0), RigVector(-0.15, -0.06, 0.2))) }
        let poses = striding + [RigPose.slide, .stride, .deliver, .stance, .finish, .catchHigh, .scoop, .squat, .lead, .set, .kick]
        check(poses.allSatisfy { p in let k = RigSkeleton(p); return min(k.feet.0.z, k.feet.1.z) <= 0.01 && k.head.z > k.hip.z },
              "every pose stands on the ground, head up")
    }
}
