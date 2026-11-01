import Foundation
import SwiftUI

// Chart hygiene: marks keep their room by clipping (no blend-mode knockouts,
// which punch through the glass panel); the lead ascent takes part in linked
// hover; one map-point rule.

extension ScorelineTests {
    static func chartHygiene() {
        print("\nChart hygiene")
        clearances()
        noBlendModes()
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

    // MARK: Rendering

    private struct Bitmap {
        let bytes: [UInt8]
        let width: Int
        let height: Int
        let bytesPerRow: Int

        /// The same picture: two renders of one view can differ by a rounding
        /// step (±1 in a few hundred bytes); a real change moves thousands, by far more.
        static func same(_ a: Bitmap?, _ b: Bitmap?) -> Bool {
            guard let a, let b, a.width == b.width, a.height == b.height, a.bytes.count == b.bytes.count else { return false }
            return zip(a.bytes, b.bytes).allSatisfy { abs(Int($0) - Int($1)) <= 2 }
        }
    }

    private static func render<V: View>(_ view: V, width: CGFloat, linked: LinkedFocus? = nil) -> Bitmap? {
        let content = view
            .environment(linked ?? LinkedFocus())
            .frame(width: width)
            .fixedSize(horizontal: false, vertical: true)
            .background(Color(white: 0.16))
            .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        guard let image = renderer.cgImage, let data = image.dataProvider?.data as Data? else { return nil }
        return Bitmap(bytes: [UInt8](data), width: image.width, height: image.height, bytesPerRow: image.bytesPerRow)
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
            return render(LeadAscentView(route: route), width: 340, linked: linked)
        }
        let none = shot(nil), finished = shot(12), climbing = shot(13), elsewhere = shot(99)
        check(none != nil && !Bitmap.same(finished, none) && !Bitmap.same(climbing, none) && !Bitmap.same(finished, climbing),
              "the lead ascent lights a linked climber (finished or on the wall); the others step back")
        check(Bitmap.same(elsewhere, none), "a climber not on this route changes nothing")
    }
}
