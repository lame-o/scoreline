import Foundation

// Responsive layout: width classes, the panel layout, and the match-page
// column placement, checked without views.

extension ScorelineTests {
    static func responsive() {
        print("\nResponsive layout")
        check(WidthClass.of(312, from: .compact) == .compact && WidthClass.of(380, from: .compact) == .medium
              && WidthClass.of(460, from: .compact) == .large && WidthClass.of(560, from: .compact) == .xlarge,
              "width classes step up at 380, 460, 560")
        check(WidthClass.of(372, from: .medium) == .medium && WidthClass.of(367, from: .medium) == .compact,
              "a class steps down only 12pt below its threshold")
        func layout(_ widths: [CGFloat]) -> PanelLayout {
            widths.reduce(PanelLayout()) { PanelLayout.resolve(width: $1, from: $0) }
        }
        check(layout([340]) == PanelLayout(), "340 is compact, one column: nothing changes until the user drags")
        check(layout([407]).page == .compact && layout([408]).page == .medium && layout([488]).page == .large
              && layout([588]).page == .xlarge, "panel widths map to the spec's classes")
        let split = layout([680])
        check(split.columns == 2 && split.column == .compact && split.page == .xlarge, "680 splits into two compact columns")
        check(layout([680, 670]).split && !layout([680, 667]).split, "the split holds until 12pt below 680")
        check(layout([760]).column == .compact, "at 760 each column is still compact (352pt of content)")

        let slots = [MatchSlot(column: .left, rank: 0), MatchSlot(column: .right, rank: 0), MatchSlot(column: .left, rank: 1),
                     MatchSlot(column: .span, rank: 0), MatchSlot(column: .right, rank: 0)]
        let heights: [CGFloat] = [100, 50, 30, 20, 40]
        let one = MatchColumnsLayout.frames(slots: slots, width: 340, columns: 1, spacing: 0) { i, _ in heights[i] }
        check(one.height == 240 && one.frames[3].minY == 180 && one.frames.allSatisfy { $0.width == 340 },
              "one column: every section stacked in order, full width")
        let two = MatchColumnsLayout.frames(slots: slots, width: 700, columns: 2, spacing: 0) { i, _ in heights[i] }
        check(two.frames[0] == CGRect(x: 0, y: 0, width: 350, height: 100) && two.frames[1].minX == 350
              && two.frames[2].minY == 100, "two columns: left and right stack side by side, by rank")
        check(two.frames[3] == CGRect(x: 0, y: 130, width: 700, height: 20), "a spanning section starts below the taller column")
        check(two.frames[4] == CGRect(x: 350, y: 150, width: 350, height: 40) && two.height == 190,
              "after a span, a new block (an empty left column is fine)")
        let grid = RowGrid.frames(count: 3, width: 700, columns: 2, spacing: 10) { i, _ in [30, 50, 20][i] }
        check(grid.frames[0].height == 50 && grid.frames[1].height == 50 && grid.frames[2].minY == 60 && grid.height == 80,
              "grid rows share their tallest cell's height")
    }
}
