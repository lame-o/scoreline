import Foundation
import SwiftUI

// Page geometry and pinned focus: when a section counts as out of view (and
// which way), how far the hero has docked, writes only on change, and the
// pin/hold rules the chart peek relies on.

extension ScorelineTests {
    static func pageGeometry() async {
        print("\nPage geometry")
        let viewport = CGRect(x: 0, y: 0, width: 340, height: 600)
        func vis(_ minY: CGFloat, _ height: CGFloat, scrolled y: CGFloat = 0, inset: CGFloat = 0) -> PageGeometry.Visibility {
            PageGeometry.visibility(frame: CGRect(x: 0, y: minY, width: 340, height: height),
                                    visible: viewport.offsetBy(dx: 0, dy: y), topInset: inset)
        }
        check(vis(100, 200) == .visible, "a section fully on screen is visible")
        check(vis(480, 200) == .visible, "60% shown (120 of 200) is visible")
        check(vis(482, 200) == .partial(.below), "just under 60% is partial, below")
        check(vis(520, 200) == .hidden(.below), "40% shown (80 of 200) is hidden, below")
        check(vis(900, 200) == .hidden(.below), "far below is hidden, below")
        check(vis(0, 200, scrolled: 1000) == .hidden(.above), "scrolled past is hidden, above")
        check(vis(1000, 200, scrolled: 1000, inset: 48) == .visible && vis(1000, 120, scrolled: 1060, inset: 48) == .hidden(.above),
              "the docked bar's inset counts as covered")
        check(vis(0, 2000, scrolled: 800) == .visible, "inside a section taller than the viewport: visible")

        let hero = CGRect(x: 0, y: 0, width: 340, height: 128)
        check(PageGeometry.dockStep(hero: hero, offset: 0) == 0 && PageGeometry.dockStep(hero: hero, offset: 32) == 0,
              "the hero doesn't dock until a quarter of it is under the header")
        check(PageGeometry.dockStep(hero: hero, offset: 32 + 92) == 64 && PageGeometry.dockStep(hero: hero, offset: 2000) == 64,
              "fully docked after three quarters more, and stays docked")
        check(PageGeometry.dockStep(hero: hero, offset: 32 + 46) == 32, "halfway is step 32")
        check(PageGeometry.dockStep(hero: hero, offset: -40) == 0, "an overscroll bounce isn't negative")

        let geometry = PageGeometry()
        geometry.report(frame: hero, for: PageGeometry.hero)
        geometry.report(frame: CGRect(x: 0, y: 140, width: 340, height: 220), for: "court")
        geometry.report(frame: CGRect(x: 0, y: 1400, width: 340, height: 500), for: "box")
        let top = geometry.state(for: viewport)
        check(top.visibility["court"] == .visible && top.visibility["box"] == .hidden(.below) && top.visibility["hero"] == nil,
              "at the top: the court shows, the box score is below, the hero isn't listed")
        geometry.apply(top)
        let scrolled = geometry.state(for: viewport.offsetBy(dx: 0, dy: 1300))
        geometry.apply(scrolled)
        check(geometry.visibility["court"] == .hidden(.above) && geometry.visibility["box"] == .visible && geometry.dockProgress == 1,
              "scrolled to the box score: the court is above, the hero docked")
        // Small scrolls inside a band give the same value: nothing to write.
        check(geometry.state(for: viewport.offsetBy(dx: 0, dy: 1310)) == scrolled, "scrolling within a band changes nothing")
        var scrolledTo: CGFloat?
        geometry.scrollHandler = { y, _ in scrolledTo = y }
        geometry.scroll(toSection: "court", topInset: 56, animated: true)
        check(scrolledTo == 84, "scrolling to a section puts its top under the inset", "\(String(describing: scrolledTo))")

        print("\nPinned focus")
        let linked = LinkedFocus()
        let a = Focus(player: "a"), b = Focus(player: "b")
        check(linked.unpin() == false, "nothing to unpin: Esc goes back instead")
        linked.pin(a)
        check(linked.focus == a, "a pin is the focus while nothing is hovered")
        linked.hover(b, true)
        try? await Task.sleep(for: .milliseconds(140))
        check(linked.focus == b, "a hover shows over the pin")
        linked.hover(b, false)
        try? await Task.sleep(for: .milliseconds(140))
        check(linked.focus == a, "leaving the hover falls back to the pin")
        linked.togglePin(a)
        check(linked.pinned == nil && linked.focus == nil, "clicking the pinned row again unpins")

        linked.hover(b, true)
        try? await Task.sleep(for: .milliseconds(140))
        linked.hold(true)
        linked.hover(b, false)
        linked.clear()
        try? await Task.sleep(for: .milliseconds(140))
        check(linked.focus == b, "held (pointer on the peek): leaving the row and the page doesn't clear it")
        linked.hold(false)
        try? await Task.sleep(for: .milliseconds(140))
        check(linked.focus == nil, "released: the hover clears after its grace")
        linked.hover(a, true)
        try? await Task.sleep(for: .milliseconds(140))
        linked.hold(true); linked.hold(false)
        linked.hover(b, true)
        try? await Task.sleep(for: .milliseconds(140))
        check(linked.focus == b, "landing on another row during the grace takes over")
    }
}

extension ScorelineTests {
    static func scoreChanges() {
        print("\nScore changes")
        func game(_ a: String, _ b: String) -> Event {
            Event(id: "g", content: .match(top: comp("x", "X", a), bottom: comp("y", "Y", b)), state: .live, start: .now,
                  detail: nil, caption: nil, link: nil)
        }
        check(ScoreChange.scorers(from: game("7", "3"), to: game("14", "3")) == ["x"], "the side whose number rose scored")
        check(ScoreChange.scorers(from: game("1", "1"), to: game("2", "2")) == ["x", "y"], "both rose between polls: both scored")
        check(ScoreChange.scorers(from: game("2", "0"), to: game("1", "0")).isEmpty, "a correction downward has no scorer")

        // An unchanged clock keeps its first reading, so unchanged games compare equal.
        let first = GameClock(seconds: 190, sampledAt: Date(timeIntervalSince1970: 0), period: 2, direction: .down,
                              display: "3:10 - 2nd", running: true)
        let again = GameClock(seconds: 190, sampledAt: Date(timeIntervalSince1970: 30), period: 2, direction: .down,
                              display: "3:10 - 2nd", running: false)
        let held = again.reading(after: first)
        check(held.sampledAt == first.sampledAt && !held.running, "a countdown read the same twice: stopped, first reading kept")
        check(held.reading(after: held) == held, "and then equal on every poll (nothing re-renders)")
        let moved = GameClock(seconds: 160, sampledAt: Date(timeIntervalSince1970: 30), period: 2, direction: .down,
                              display: "2:40 - 2nd", running: false).reading(after: first)
        check(moved.running && moved.sampledAt == Date(timeIntervalSince1970: 30), "a countdown that moved: running, new reading")
        let minute = GameClock(seconds: 2220, sampledAt: Date(timeIntervalSince1970: 0), period: 1, direction: .up,
                               display: "37'", running: true)
        let sameMinute = GameClock(seconds: 2220, sampledAt: Date(timeIntervalSince1970: 30), period: 1, direction: .up,
                                   display: "37'", running: true).reading(after: minute)
        check(sameMinute == minute, "a soccer minute read again keeps counting from its first reading")
    }
}
