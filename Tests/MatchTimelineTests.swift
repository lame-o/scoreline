import Foundation
import SwiftUI

extension ScorelineTests {
    static func matchTimeline() {
        print("\nMatch timeline interaction")
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let end = start + 7_200
        let domain = start...end
        let labelWidth = OddsStyle.labelWidth(["LIV", "CHE", "Draw"])
        let timeline = OddsLayout(size: CGSize(width: 540, height: 91), plotHeight: 76, domain: domain, labelWidth: labelWidth)
        let odds = OddsLayout(size: CGSize(width: 540, height: 165), plotHeight: 150, domain: domain, labelWidth: labelWidth)
        check(timeline.x(start) == odds.x(start) && timeline.x(end) == odds.x(end)
              && timeline.x(start + 2_780) == odds.x(start + 2_780),
              "Timeline and odds share exact horizontal endpoints and event positions despite different heights")

        func event(_ id: String, _ offset: TimeInterval, _ side: GameDetail.Side?, _ kind: MatchHistory.Kind = .goal) -> MatchHistory.Event {
            MatchHistory.Event(id: id, t: start + offset, period: offset < 3_600 ? 1 : 2, clock: "43′", text: "Goal \(id)",
                               side: side, kind: kind, score: nil, timing: .reported)
        }
        let top = event("top", 2_780, .top)
        let bottom = event("bottom", 2_780, .bottom)
        let later = event("late", 6_800, .top)
        let events = [top, bottom, later]
        let topPoint = MatchTimelineGeometry.point(top, layout: timeline)
        let bottomPoint = MatchTimelineGeometry.point(bottom, layout: timeline)
        check(topPoint.x == bottomPoint.x && topPoint.y < bottomPoint.y,
              "Simultaneous opposing-team events keep their lanes without moving their timestamps")
        check(MatchTimelineGeometry.target(at: topPoint, events: events, layout: timeline)?.id == top.id
              && MatchTimelineGeometry.target(at: bottomPoint, events: events, layout: timeline)?.id == bottom.id,
              "Hit testing distinguishes teams when two key events share a timestamp")
        check(MatchTimelineGeometry.target(at: CGPoint(x: topPoint.x + 30, y: topPoint.y), events: events, layout: timeline) == nil,
              "Hovering far from a marker does not jump to an unrelated key event")
        check(MatchTimelineGeometry.time(at: topPoint, events: events, layout: timeline) == top.t,
              "A marker selects its exact event timestamp, not the nearest minute")
        let second = start + 1_237
        check(MatchTimelineGeometry.time(at: CGPoint(x: timeline.x(second), y: timeline.plot.midY), events: events, layout: timeline) == second,
              "An empty timeline position preserves second-level inspection")
        check(MatchTimelineGeometry.time(at: CGPoint(x: -100, y: 0), events: [], layout: timeline) == start
              && MatchTimelineGeometry.time(at: CGPoint(x: 9_999, y: 0), events: [], layout: timeline) == end,
              "Timeline inspection cannot escape the shared displayed domain")

        let fractionalDomain = (start + 0.8)...(end + 0.2)
        let fractionalLayout = OddsLayout(size: CGSize(width: 540, height: 91), plotHeight: 76,
                                         domain: fractionalDomain, labelWidth: labelWidth)
        let nearStart = event("near-start", 1.2, .top)
        let nearEnd = event("near-end", 7_199.6, .bottom)
        let edgeEvents = [nearStart, nearEnd]
        let startPoint = MatchTimelineGeometry.point(nearStart, layout: fractionalLayout)
        let endPoint = MatchTimelineGeometry.point(nearEnd, layout: fractionalLayout)
        check(MatchTimelineGeometry.time(at: CGPoint(x: fractionalLayout.plot.minX, y: startPoint.y), events: edgeEvents, layout: fractionalLayout) == fractionalDomain.lowerBound
              && MatchTimelineGeometry.time(at: CGPoint(x: fractionalLayout.plot.maxX, y: endPoint.y), events: edgeEvents, layout: fractionalLayout) == fractionalDomain.upperBound,
              "Exact timeline endpoints win over nearby event targets and preserve fractional timestamps")
        check(MatchTimelineGeometry.time(at: startPoint, events: edgeEvents, layout: fractionalLayout) == nearStart.t
              && MatchTimelineGeometry.time(at: endPoint, events: edgeEvents, layout: fractionalLayout) == nearEnd.t,
              "Interior markers still snap to their reported fractional event times")
        let edgeMarks = MatchTimelineRail.marks(events: edgeEvents, layout: fractionalLayout)
        check(MatchTimelineRail.time(at: CGPoint(x: fractionalLayout.plot.minX, y: edgeMarks[0].point.y), marks: edgeMarks, layout: fractionalLayout) == fractionalDomain.lowerBound
              && MatchTimelineRail.time(at: CGPoint(x: fractionalLayout.plot.maxX, y: edgeMarks[1].point.y), marks: edgeMarks, layout: fractionalLayout) == fractionalDomain.upperBound,
              "Football's compact rail reaches the same fractional endpoints despite near-edge scores")
        check(MatchTimelineRail.time(at: edgeMarks[0].point, marks: edgeMarks, layout: fractionalLayout) == nearStart.t
              && MatchTimelineRail.time(at: edgeMarks[1].point, marks: edgeMarks, layout: fractionalLayout) == nearEnd.t,
              "Interior football markers retain exact event snapping near the edges")
        let interior = CGPoint(x: fractionalLayout.x(second + 0.3), y: fractionalLayout.plot.midY)
        check(MatchTimelineGeometry.time(at: interior, events: edgeEvents, layout: fractionalLayout) == second
              && MatchTimelineRail.time(at: interior, marks: edgeMarks, layout: fractionalLayout) == second,
              "Empty positions in both timeline styles retain the odds whole-second mapping")

        let football = OddsLayout(size: CGSize(width: 306, height: 69), plotHeight: 54, domain: domain, labelWidth: labelWidth)
        let rail = MatchTimelineRail.marks(events: events, layout: football)
        check(rail.count == 2 && rail[0].events.count == 2 && rail.flatMap(\.events).count == events.count,
              "Football combines simultaneous opposing-team scores without losing either event")
        check(rail[0].point.x == football.x(top.t) && rail[0].point.y == football.plot.midY,
              "A simultaneous football group sits on one rail at its exact timestamp")
        check(MatchTimelineRail.time(at: rail[0].point, marks: rail, layout: football) == top.t,
              "Selecting a counted football marker pins the reported event time")
        let near = event("near", 2_781, .bottom)
        let close = MatchTimelineRail.marks(events: [top, near], layout: football)
        check(close.count == 1 && MatchTimelineRail.time(at: CGPoint(x: football.x(near.t), y: close[0].point.y), marks: close, layout: football) == near.t,
              "Nearby grouped scores still select individual timestamps rather than the visual group center")
        let corner = CGPoint(x: 2.7, y: 2.7)
        check(MatchTimelineRail.symbol(side: .top, at: .zero, radius: 4).contains(corner)
              && !MatchTimelineRail.symbol(side: .bottom, at: .zero, radius: 4).contains(corner),
              "Football team markers differ by circle and diamond shape as well as color")
        let dense = (0..<200).map { event("dense\($0)", Double($0) * 36, $0.isMultiple(of: 2) ? .top : .bottom) }
        let denseMarks = MatchTimelineRail.marks(events: dense, layout: football)
        check(Set(denseMarks.flatMap(\.events).map(\.id)) == Set(dense.map(\.id)),
              "Narrow football rails preserve every event through dense grouping")
        let overlap = denseMarks.enumerated().contains { index, mark in
            denseMarks.dropFirst(index + 1).contains { other in
                abs(mark.point.y - other.point.y) < 12 && abs(mark.point.x - other.point.x) < mark.radius + other.radius
            }
        }
        check(!overlap && denseMarks.allSatisfy { $0.point.y - 7 >= 0 && $0.point.y + 7 <= football.bounds.height },
              "Dense football markers do not overlap or expand the compact plotting height")
        check(MatchTimelineRail.target(at: CGPoint(x: rail[0].point.x, y: -50), marks: rail, layout: football) == nil
              && MatchTimelineRail.marks(events: [], layout: football).isEmpty,
              "Football hit testing and empty history do not fabricate events")

        let history = MatchHistory(sport: .soccer, events: events)
        check(MatchInspectionControls.destination(forward: false, history: history, domain: domain, moment: nil)?.id == later.id
              && MatchInspectionControls.destination(forward: true, history: history, domain: domain, moment: nil)?.id == top.id,
              "Keyboard navigation enters the game at the last or first key event")
        check(MatchInspectionControls.destination(forward: false, history: history, domain: domain, moment: top.t) == nil
              && MatchInspectionControls.destination(forward: true, history: history, domain: domain, moment: later.t) == nil,
              "Previous and next controls stop at recorded history boundaries")
        let pointer = OddsPointer()
        pointer.window = .recent
        pointer.pin(later.t)
        check(MatchInspectionControls.select(forward: false, history: history, domain: (end - 600)...end, pointer: pointer)
              && pointer.window == .game && pointer.moment == bottom.t && pointer.pinned,
              "Previous-event navigation outside a recent window reveals and pins the event in Game view")
        pointer.hover(later.t)
        check(pointer.moment == bottom.t, "Linked hover does not displace a pinned timeline event")
        pointer.clear()
        check(pointer.moment == nil && !pointer.active && !pointer.pinned,
              "Returning to Live or Latest clears timeline inspection in both modules")
        check(!MatchInspectionControls.select(forward: true, history: MatchHistory(sport: .baseball), domain: domain, pointer: pointer),
              "No recorded events leaves navigation idle without fabricating a selection")
    }
}
