import AppKit
import Foundation
import Observation
import SwiftUI

// The shared moment: hover, pin, keys and zoom, as state, then keys and rows
// through real events in an offscreen window (the mouse never moves).

/// Reads the location its events carry, as a real window would read the mouse.
private final class InspectionWindow: NSWindow {
    var location = NSPoint(x: -100, y: -100)
    override var canBecomeKey: Bool { true }
    override var mouseLocationOutsideOfEventStream: NSPoint { location }
}

extension ScorelineTests {
    static func matchInspection() async {
        print("\nMatch inspection")
        pointerStates()
        pointerObservation()
        focusLink()
        await hostedInspection()
    }

    // MARK: The pointer's states

    private static func pointerStates() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let range = start...(start + 1000)

        // Hover is its own state, and leaving ends it whatever else is going on.
        var pointer = OddsPointer()
        pointer.hover(start + 10)
        check(pointer.moment == start + 10 && pointer.active, "the pointer over a chart reads it")
        pointer.hover(nil)
        check(pointer.moment == nil && !pointer.active, "leaving clears it")
        pointer.key(start + 20)
        pointer.hover(start + 30)
        check(pointer.moment == start + 30, "the pointer reads over the keyboard's reading")
        pointer.hover(nil)
        check(pointer.moment == start + 20, "leaving ends only the pointer's reading: focus doesn't hold it, and the keyboard's stays")
        pointer.key(nil)
        check(pointer.moment == nil && !pointer.active, "and losing focus ends the keyboard's")

        // A pin holds, and hover reads over it, as LinkedFocus puts the hover over the pin.
        pointer = OddsPointer()
        pointer.toggle(start + 100, play: nil, within: range, linked: nil)
        check(pointer.pinned && pointer.moment == start + 100 && pointer.heldPlay == nil, "a click holds the moment")
        pointer.hover(start + 200)
        check(pointer.moment == start + 200 && pointer.held == start + 100, "hover reads over the pin")
        pointer.hover(nil)
        check(pointer.moment == start + 100, "and returns to it")
        pointer.toggle(start + 105, play: nil, within: range, linked: nil)
        check(!pointer.pinned && pointer.moment == nil, "again on the same spot lets go")
        pointer.toggle(start + 100, play: nil, within: range, linked: nil)
        pointer.toggle(start + 500, play: nil, within: range, linked: nil)
        check(pointer.held == start + 500, "elsewhere, the pin moves")

        // A play's pin is the page's pin.
        let linked = LinkedFocus()
        pointer = OddsPointer()
        pointer.toggle(start + 100, play: "goal", within: range, linked: linked)
        check(pointer.heldPlay == "goal" && linked.pinned?.play == "goal", "a click on a key play pins it, the same pin as its row")
        pointer.toggle(start + 100, play: "goal", within: range, linked: linked)
        check(!pointer.pinned && linked.pinned == nil, "again lets go of both")
        pointer.toggle(start + 100, play: "goal", within: range, linked: linked)
        pointer.toggle(start + 400, play: nil, within: range, linked: linked)
        check(pointer.heldPlay == nil && pointer.held == start + 400 && linked.pinned == nil, "a pin on open time replaces it")

        // Keys step a fraction of what's shown; the pin moves if there is one.
        pointer = OddsPointer()
        pointer.step(-0.01, within: range, linked: nil)
        check(pointer.moment == start + 990 && !pointer.pinned, "← from the latest: 1% back, the keyboard's reading")
        pointer.step(0.5, within: range, linked: nil)
        check(pointer.moment == start + 1000, "held to the range")
        pointer.toggle(start + 100, play: nil, within: range, linked: nil)
        pointer.step(0.01, within: range, linked: nil)
        check(pointer.held == start + 110, "with a pin, it moves the pin")
        pointer.clear()
        check(pointer.moment == nil && !pointer.pinned, "back to the latest")

        // Esc: the reading first, then the zoom, then it's the page's.
        pointer = OddsPointer()
        pointer.window = .period(3)
        pointer.pin(start)
        check(pointer.back(linked: nil) && !pointer.pinned && pointer.window == .period(3), "Esc lets go of the pin first")
        check(pointer.back(linked: nil) && pointer.window == .game, "then the zoom")
        check(!pointer.back(linked: nil), "then there's nothing to undo here: the page goes back")

        // Zoom.
        pointer = OddsPointer()
        pointer.pin(start + 100)
        pointer.zoom(to: 2, span: (start + 50)...(start + 200))
        check(pointer.window == .period(2) && pointer.pinned, "zooming keeps a pin it still shows")
        pointer.zoom(to: 3, span: (start + 500)...(start + 700))
        check(pointer.window == .period(3) && !pointer.pinned, "and lets go of one it doesn't")
        pointer.zoom(to: nil, span: nil)
        check(pointer.window == .game, "the whole game again")

        // ⌥←/→ walks the key plays.
        func mark(_ id: String, _ offset: Double) -> TimelineMark {
            TimelineMark(moment: GameDetail.Moment(id: id, kind: .score, clock: "", text: id, side: .top), t: start + offset)
        }
        let marks = [mark("a", 100), mark("b", 200), mark("c", 300)]
        check(MatchInspectionActions.destination(forward: false, marks: marks, from: nil)?.id == "c"
              && MatchInspectionActions.destination(forward: true, marks: marks, from: nil)?.id == "a"
              && MatchInspectionActions.destination(forward: true, marks: marks, from: start + 200)?.id == "c"
              && MatchInspectionActions.destination(forward: false, marks: marks, from: start + 100) == nil,
              "the key plays either side of the reading")
        pointer = OddsPointer()
        pointer.window = .period(1)
        MatchInspectionActions.select(forward: true, marks: marks, range: start...(start + 50), pointer: pointer, linked: linked)
        check(pointer.heldPlay == "a" && pointer.window == .game && linked.pinned?.play == "a",
              "stepping to a play outside the zoom brings the game back to show it")
        linked.unpin()
    }

    /// A move re-renders only what reads the moment: what flips stays still.
    private static func pointerObservation() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let pointer = OddsPointer()
        var activeChanges = 0, heldChanges = 0
        func watchActive() {
            withObservationTracking { _ = pointer.active } onChange: { activeChanges += 1 }
        }
        func watchHeld() {
            withObservationTracking { _ = pointer.held } onChange: { heldChanges += 1 }
        }
        watchActive()
        watchHeld()
        pointer.hover(start)
        check(activeChanges == 1, "reading starts: `active` flips")
        watchActive()
        for k in 1...50 { pointer.hover(start + Double(k)) }
        check(activeChanges == 1 && heldChanges == 0, "fifty moves: `active` and the pin don't change, so nothing reading them re-renders")
        pointer.hover(nil)
        check(activeChanges == 2, "reading ends: it flips back")
    }

    // MARK: Rows

    private static func focusLink() {
        // Row focus to the moment, by play ID; an NBA run's moment is its last basket.
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let event = MatchHistory.Event(id: "basket", t: start + 90, period: 1, clock: "Q1 9:00", text: "Basket", side: .top)
        let history = MatchHistory(sport: .basketball, events: [event])
        check(history.time(of: "basket-run") == start + 90, "a run's mark finds its last basket")
    }

    // MARK: Real events, offscreen

    private static func hostedInspection() async {
        _ = NSApplication.shared
        let previous = NSApp.activationPolicy()
        NSApp.setActivationPolicy(.prohibited)
        defer { NSApp.setActivationPolicy(previous) }
        guard let game = timelineGames().first(where: { $0.name == "NBA" }) else { return check(false, "the recorded game loads") }

        let width: CGFloat = 540, plotHeight = OddsStyle.plotHeight(.xlarge), height: CGFloat = 320
        let timelineHeight = MatchTimeline.height
        let feed = OddsFeed()
        feed.preview(market: game.market, series: game.series)
        let pointer = OddsPointer(), linked = LinkedFocus()
        let palette = TeamPalette.nba(top: game.event.competitors.first, bottom: game.event.competitors.last, scheme: .light)
        let marks = game.detail.timelineMarks
        let lines = [OddsLine(outcome: .top, name: game.names.top, color: palette.top), OddsLine(outcome: .bottom, name: game.names.bottom, color: palette.bottom)]
        let domain = game.history.domain(state: .final, window: .game, eventStart: game.event.start)
        let data = OddsChartData.make(feed: feed, baseline: game.detail.odds ?? OddsBaseline(), history: game.history, state: .final, window: .game, eventStart: game.event.start)
        let root = VStack(alignment: .leading, spacing: 0) {
            MatchTimelineSection(history: game.history, marks: marks, feed: feed, event: game.event, names: game.names, palette: palette, pointer: pointer)
            OddsPlot(data: data, lines: lines, pointer: pointer, marks: marks, spoken: SpokenTeams(top: "A", bottom: "B"), live: false)
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .background { MatchFocusLink(history: game.history, linked: linked, pointer: pointer) }
        .environment(linked)
        .environment(\.widthClass, .xlarge)
        .environment(\.pageLive, false)
        let view = NSHostingView(rootView: root)
        let window = InspectionWindow(contentRect: NSRect(x: -9000, y: -9000, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        window.acceptsMouseMovedEvents = true
        window.orderFrontRegardless()
        window.makeKey()
        defer { window.orderOut(nil); window.contentView = nil }
        func pump(_ seconds: Double = 0.06) {
            let end = Date(timeIntervalSinceNow: seconds)
            while Date() < end { _ = RunLoop.main.run(mode: .default, before: min(end, Date(timeIntervalSinceNow: 0.005))) }
        }
        pump(0.4)
        func point(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: x, y: height - y) }
        func now() -> TimeInterval { ProcessInfo.processInfo.systemUptime }
        func click(_ x: CGFloat, _ y: CGFloat) {
            window.location = point(x, y)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                if let e = NSEvent.mouseEvent(with: type, location: window.location, modifierFlags: [], timestamp: now(), windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) {
                    window.sendEvent(e)
                }
                pump()
            }
        }
        func key(_ code: UInt16, _ characters: String, _ flags: NSEvent.ModifierFlags = []) {
            if let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: now(), windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                window.sendEvent(e)
            }
            pump()
        }
        let right = String(UnicodeScalar(NSRightArrowFunctionKey)!), left = String(UnicodeScalar(NSLeftArrowFunctionKey)!), escape = "\u{1b}"
        // Inside the odds well (8pt padding) and clear of the key plays' columns.
        let layout = OddsLayout(size: CGSize(width: width - 16, height: plotHeight + OddsStyle.axis), plotHeight: plotHeight, domain: domain, labelWidth: OddsStyle.labelWidth(lines.map(\.name)))
        let columns = marks.compactMap(\.t).map(layout.x)
        let open = stride(from: layout.plot.minX + 20, to: layout.plot.maxX - 40, by: 2).first { x in columns.allSatisfy { abs($0 - x) > 16 } } ?? layout.plot.midX
        let oddsX = open + 8, oddsY = timelineHeight + 8 + plotHeight / 2

        // A window this offscreen gets a mouse-down (it gives the chart focus)
        // but no hover or completed click, from SwiftUI or a plain Button alike:
        // those are the pointer states tested above. Keys and rows are real here.
        click(oddsX, oddsY)
        key(124, right)
        check(pointer.moment != nil && !pointer.pinned, "→ reads a moment: the keyboard's own reading")
        key(53, escape)
        check(pointer.moment == nil, "Esc ends it")
        key(123, left, .option)
        check(pointer.heldPlay != nil && linked.pinned?.play == pointer.heldPlay, "⌥← holds a key play, the same pin as its row")
        let walked = pointer.heldPlay
        key(123, left, .option)
        check(pointer.heldPlay != walked || marks.count == 1, "⌥← again walks to the one before")
        key(53, escape)
        check(!pointer.pinned && linked.pinned == nil, "Esc lets go of both")

        // A key play's row, from elsewhere on the page.
        if let mark = marks.first, let t = mark.t {
            // LinkedFocus's delay and grace run on the main actor: let them.
            linked.hover(Focus(play: mark.id), true)
            try? await Task.sleep(for: .milliseconds(150))
            pump()
            check(pointer.moment == t, "a row hovered moves both charts' line")
            linked.hover(Focus(play: mark.id), false)
            try? await Task.sleep(for: .milliseconds(150))
            pump()
            check(pointer.moment == nil, "and leaving it clears")
            linked.pin(Focus(play: mark.id))
            pump()
            check(pointer.held == t && pointer.heldPlay == mark.id, "a row pinned holds them")
            linked.unpin()
            pump()
            check(!pointer.pinned, "unpinned, it lets go")
        } else {
            check(false, "a key play on show")
        }

        pointer.window = .period(2)
        pump(0.1)
        key(53, escape)
        check(pointer.window == .game, "Esc returns to the whole game", "\(pointer.window)")
    }
}
