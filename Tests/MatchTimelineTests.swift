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
