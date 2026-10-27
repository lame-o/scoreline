import Foundation
import SwiftUI

// Chart hygiene: marks keep their room by clipping (no blend-mode knockouts,
// which punch through the glass panel); charts in the linked peek drop their
// footers but lay out exactly as they do on the page; the lead ascent takes
// part in linked hover; one map-point rule.

extension ScorelineTests {
    static func chartHygiene() {
        print("\nChart hygiene")
        clearances()
        noBlendModes()
        peekMode()
        ascentLinks()
        var agree = true
        for top in 0...30 { for bottom in 0...30 where RoundHistoryView.mapPoint(top: top, bottom: bottom) != MatchRules.mapPoint(top: top, bottom: bottom) { agree = false } }
        check(agree, "one map-point rule: the round grid reads MatchRules")
    }

    private static func clearances() {
        let a = Clearance(.zero, radius: 3), b = Clearance(CGPoint(x: 10, y: 0), radius: 4)
        let rooms: [Clearance?] = [a, nil, b, Clearance(.zero, radius: 0)]
        check(Clearance.ahead(of: 0, in: rooms) == [b] && Clearance.ahead(of: 1, in: rooms) == [b]
              && Clearance.ahead(of: 2, in: rooms).isEmpty && Clearance.ahead(of: 3, in: rooms).isEmpty,
              "a mark leaves room only for the marks drawn after it (and none for an empty room)")
        check(Clearance(around: CGRect(x: 0, y: 0, width: 8, height: 8)) == Clearance(CGPoint(x: 4, y: 4), radius: 5.5),
              "a mark's room reaches 1.5 pt past its edge")
        let bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
        let room = MovingClearance(Clearance(CGPoint(x: 50, y: 50), radius: 6)).path(in: bounds)
        check(!room.contains(CGPoint(x: 50, y: 50), eoFill: true) && !room.contains(CGPoint(x: 54, y: 50), eoFill: true)
              && room.contains(CGPoint(x: 57, y: 50), eoFill: true) && room.contains(CGPoint(x: 1, y: 1), eoFill: true)
              && room.contains(CGPoint(x: -20, y: 50), eoFill: true),
              "a moving mark's room: empty inside its disk, everything else kept (even strokes just past the edge)")
        check(MovingClearance(nil).path(in: bounds).contains(CGPoint(x: 50, y: 50), eoFill: true), "no mark, no room")
        let pass = PitchAction(id: 1, kind: .pass, side: .top, x: 0, y: 0, endX: nil, endY: nil, minute: "", text: "")
        let goal = PitchAction(id: 2, kind: .goal, side: .top, x: 0, y: 0, endX: nil, endY: nil, minute: "", text: "")
        let card = PitchAction(id: 3, kind: .yellow, side: .top, x: 0, y: 0, endX: nil, endY: nil, minute: "", text: "")
        check(PitchView.room(pass) == 7 && PitchView.room(goal) == 10 && PitchView.room(card) == nil,
              "the focused pitch mark's room: 7 pt for an action, 10 for a shot or goal, none for a card")
    }

    /// Blend modes punch through the glass panel: none anywhere in the app
    /// (VizKit's old helper aside, until it's deleted).
    private static func noBlendModes() {
        let dir = URL(fileURLWithPath: "Sources/Scoreline")
        let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter { $0.hasSuffix(".swift") }
        var offenders: [String] = []
        for file in files where file != "VizKit.swift" {
            let text = (try? String(contentsOf: dir.appendingPathComponent(file), encoding: .utf8)) ?? ""
            for (index, line) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
                let code = line.components(separatedBy: "//").first ?? ""
                if code.contains("blendMode") || code.contains(".knockout(") { offenders.append("\(file):\(index + 1)") }
            }
        }
        check(files.count > 20 && offenders.isEmpty, "no blend modes or knockouts in any chart", offenders.joined(separator: ", "))
    }

    // MARK: Peek

    private struct Bitmap: Equatable {
        let bytes: [UInt8]
        let width: Int
        let height: Int
        let bytesPerRow: Int

        /// Rows `from..<to` (in pixels), for comparing part of a chart.
        func rows(_ from: Int, _ to: Int) -> ArraySlice<UInt8> {
            bytes[(from * bytesPerRow)..<(min(to, height) * bytesPerRow)]
        }
    }

    private static func render<V: View>(_ view: V, width: CGFloat, linked: LinkedFocus? = nil, peek: Bool) -> Bitmap? {
        let content = view
            .environment(linked ?? LinkedFocus())
            .environment(\.chartPeek, peek)
            .frame(width: width)
            .fixedSize(horizontal: false, vertical: true)
            .background(Color(white: 0.16))
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        guard let image = renderer.cgImage, let data = image.dataProvider?.data as Data? else { return nil }
        return Bitmap(bytes: [UInt8](data), width: image.width, height: image.height, bytesPerRow: image.bytesPerRow)
    }

    /// In a peek the chart drops what's under it, and what's left is the
    /// page's chart, pixel for pixel, at the same width (never scaled).
    private static func peekKeepsPlot<V: View>(_ name: String, _ view: V, width: CGFloat = 300) {
        guard let full = render(view, width: width, peek: false), let peek = render(view, width: width, peek: true) else {
            return check(false, "\(name) renders")
        }
        // (The peek's last pixel row can be part-covered: a fractional height.)
        check(peek.height < full.height && peek.width == full.width && peek.rows(0, peek.height - 1) == full.rows(0, peek.height - 1),
              "\(name) in a peek: no footer, the plot itself unchanged at \(Int(width)) pt",
              "peek \(peek.width)×\(peek.height), page \(full.width)×\(full.height)")
    }

    private static func peekMode() {
        let palette = TeamPalette(top: "c8102e", bottom: "132257", scheme: .dark)
        let shots: [PitchAction] = (0..<8).map { (i: Int) -> PitchAction in
            let goal = i == 3
            let x = 70 + Double(i * 3), y = 30 + Double(i * 5)
            let end: Double? = goal ? 100 : nil, endY: Double? = goal ? 50 : nil
            return PitchAction(id: i, kind: goal ? .goal : .shot, side: i % 2 == 0 ? .top : .bottom, x: x, y: y,
                               endX: end, endY: endY, minute: "\(i * 10)'", text: "Shot \(i)", playID: "p\(i)")
        }
        peekKeepsPlot("the shot map", PitchView(trail: [], shots: shots, live: false, palette: palette, topName: "LIV", bottomName: "TOT"))
        let outcomes: [GameDetail.BattedBall.Outcome] = [.single, .out, .homeRun, .extraBases]
        let balls: [GameDetail.BattedBall] = (0..<10).map { (i: Int) -> GameDetail.BattedBall in
            let x = 60 + Double(i * 12), y = 60 + Double(i * 9)
            return GameDetail.BattedBall(id: "b\(i)", x: x, y: y, outcome: outcomes[i % 4], side: i % 2 == 0 ? .top : .bottom,
                                         text: "Ball \(i)", period: i / 3 + 1)
        }
        peekKeepsPlot("balls in play", SprayChartView(balls: balls, palette: palette, topName: "NYY", bottomName: "LAD"))
        typealias C = GameDetail.WallRoute.Climber
        func climber(_ id: Int, _ h: Double, onWall: Bool = false) -> C {
            var c = C(id: id, name: "Climber \(id)", country: "USA", flag: nil, height: h, top: false, label: "\(Int(h))", rank: id)
            c.onWall = onWall
            return c
        }
        let routeA = GameDetail.WallRoute(name: "A", climbers: [climber(1, 40), climber(2, 35), climber(3, 31)], total: 8)
        let routeB = GameDetail.WallRoute(name: "B", climbers: [climber(4, 44), climber(5, 22)], total: 8)
        peekKeepsPlot("high points", ClimbingWallView(routes: [routeA], live: false, yours: []))
        let cards = (1...3).map { i in
            GameDetail.BoulderCard(id: i, rank: i, name: "Athlete \(i)", country: "JPN", flag: nil,
                                   problems: [.init(reach: .top, tries: 1), .init(reach: .zone, tries: 2)], score: "\(90 - i * 10)")
        }
        peekKeepsPlot("the boulder scorecard", BoulderScorecard(cards: cards, problems: ["1", "2"]))
        let ascent = GameDetail.WallRoute(name: "1", climbers: [climber(1, 40), climber(2, 35), climber(3, 30, onWall: true)], total: 8)
        peekKeepsPlot("the lead ascent", LeadAscentView(route: ascent))

        // No route picker in a peek: it shows the route where the linked climber has a lane.
        let toB = LinkedFocus()
        toB.pin(Focus(athlete: 5))
        let both = render(ClimbingWallView(routes: [routeA, routeB], live: false, yours: []), width: 300, linked: toB, peek: true)
        let onlyB = render(ClimbingWallView(routes: [routeB], live: false, yours: []), width: 300, linked: toB, peek: true)
        check(both != nil && both == onlyB, "a peek of the wall shows the linked climber's route")

        // The timeline in a peek keeps its minute labels while a mark is pointed at.
        let moments = [GameDetail.Moment(id: "g1", kind: .goal, clock: "12'", text: "Mo Salah Goal", side: .top, minute: 12),
                       GameDetail.Moment(id: "y1", kind: .yellow, clock: "40'", text: "Yellow Card", side: .bottom, minute: 40)]
        let timeline = SoccerTimeline(moments: moments, currentMinute: nil, palette: palette, topName: "LIV", bottomName: "TOT")
        let pointed = LinkedFocus()
        pointed.pin(Focus(play: "g1"))
        let labels = (92, 120)     // the label row, y 46…60 at 2×
        if let quiet = render(timeline, width: 300, peek: true), let lit = render(timeline, width: 300, linked: pointed, peek: true),
           let page = render(timeline, width: 300, linked: pointed, peek: false) {
            check(lit.rows(labels.0, labels.1) == quiet.rows(labels.0, labels.1) && page.rows(labels.0, labels.1) != quiet.rows(labels.0, labels.1),
                  "the timeline in a peek keeps its minute labels (on the page, the pointed-at goal takes their row)")
        } else {
            check(false, "the timeline renders")
        }
    }

    // MARK: Lead ascent

    private static func ascentLinks() {
        typealias C = GameDetail.WallRoute.Climber
        func climber(_ id: Int, _ h: Double, onWall: Bool = false) -> C {
            var c = C(id: id, name: "Climber \(id)", country: "AUT", flag: nil, height: h, top: false, label: "\(Int(h))", rank: id)
            c.onWall = onWall
            return c
        }
        let route = GameDetail.WallRoute(name: "1", climbers: [climber(11, 41), climber(12, 36), climber(13, 33, onWall: true)], total: 8)
        func shot(_ athlete: Int?) -> Bitmap? {
            let linked = LinkedFocus()
            if let athlete { linked.pin(Focus(athlete: athlete)) }
            return render(LeadAscentView(route: route), width: 340, linked: linked, peek: false)
        }
        let none = shot(nil), finished = shot(12), climbing = shot(13), elsewhere = shot(99)
        check(none != nil && finished != none && climbing != none && finished != climbing,
              "the lead ascent lights a linked climber (finished or on the wall); the others step back")
        check(elsewhere == none, "a climber not on this route changes nothing")
    }
}
