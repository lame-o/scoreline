import Foundation
import SwiftUI

// The chart peek: which chart a focus lights (every linked pair, and the
// fallbacks), the timing state machine on a hand-moved clock (intent, grace,
// hold, pin, edge flip, swaps), and the layout and motion numbers.

/// A clock the tests move by hand: timers fire in order as it passes them.
@MainActor
final class ManualPeekClock {
    var now = ContinuousClock.now
    private var timers: [(id: Int, at: ContinuousClock.Instant, action: @MainActor () -> Void)] = []
    private var next = 0

    var clock: PeekClock {
        PeekClock(now: { [unowned self] in now }, after: { [unowned self] delay, action in
            next += 1
            let id = next
            timers.append((id, now + delay, action))
            return { [weak self] in self?.timers.removeAll { $0.id == id } }
        })
    }

    func advance(_ ms: Int) {
        let target = now + .milliseconds(ms)
        while let i = timers.indices.min(by: { timers[$0].at < timers[$1].at }), timers[i].at <= target {
            let timer = timers.remove(at: i)
            now = timer.at
            timer.action()
        }
        now = target
    }
}

extension ScorelineTests {
    static func peek() {
        print("\nChart peek")
        typealias Mark = PeekInputs.Mark
        let soccerRef = EventRef.espn(path: "soccer/eng.1", id: "1", sport: .soccer)
        let nbaRef = EventRef.espn(path: NBADetail.path, id: "2", sport: .basketball)
        let mlbRef = EventRef.espn(path: "baseball/mlb", id: "3", sport: .baseball)
        let nflRef = EventRef.espn(path: "football/nfl", id: "4", sport: .football)
        let climbRef = EventRef.climbing(eventID: 1, category: "Lead Women", resultURL: nil, round: "Final", eventName: "", nextURL: nil)
        let csRef = EventRef.counterStrike(slug: "s", tournament: nil)
        func route(_ focus: Focus, _ ref: EventRef, _ inputs: PeekInputs, state: EventState = .live,
                   source: DetailView.Section? = nil) -> DetailView.Section? {
            PeekRouter.target(for: focus, sport: ref, state: state, inputs: inputs, source: source)
        }

        // Soccer: key events → the pitch if the play is on it, else the timeline.
        var soccer = PeekInputs()
        soccer.shown = [.pitch, .timeline, .moments]
        soccer.pitch = [Mark(id: "goal1", lead: "23'", detail: "Saka goal")]
        soccer.timeline = [Mark(id: "goal1"), Mark(id: "card9", lead: "41'", detail: "Rice")]
        check(route(Focus(play: "goal1", period: 1, side: .top), soccerRef, soccer, source: .moments) == .pitch,
              "soccer: a goal row peeks the pitch")
        check(route(Focus(play: "card9"), soccerRef, soccer, source: .moments) == .timeline,
              "soccer: a card with no foul position peeks the timeline")
        check(route(Focus(play: "nope"), soccerRef, soccer, source: .moments) == nil, "soccer: a play on neither chart: no peek")
        check(route(Focus(play: "goal1"), soccerRef, soccer, source: .timeline) == nil
              && route(Focus(play: "goal1"), soccerRef, soccer, source: .pitch) == nil,
              "hovering a chart's own marks never peeks (its footer reads them out)")
        soccer.shown = [.timeline, .moments]
        check(route(Focus(play: "goal1"), soccerRef, soccer, source: .moments) == .timeline, "no pitch on the page: the timeline")

        // Baseball: scoring rows → the spray chart if a ball joins, else the linescore; an inning cell → the spray chart.
        var mlb = PeekInputs()
        mlb.shown = [.linescore, .moments, .battedBalls]
        mlb.balls = [Mark(id: "ab7", period: 7, side: .top, lead: "Home run", detail: "Judge homers")]
        check(route(Focus(play: "ab7", period: 7, side: .top), mlbRef, mlb, source: .moments) == .battedBalls,
              "baseball: a scoring play with its ball in play peeks Balls in Play")
        check(route(Focus(play: "walk", period: 3, side: .bottom), mlbRef, mlb, source: .moments) == .linescore,
              "baseball: a play with no ball peeks the linescore")
        check(route(Focus(period: 7, side: .top), mlbRef, mlb, source: .linescore) == .battedBalls,
              "baseball: an inning's cell peeks that inning's balls")
        check(route(Focus(period: 2, side: .top), mlbRef, mlb, source: .linescore) == nil,
              "baseball: an inning with no balls in play, from the linescore itself: no peek")

        // NBA: box and leader rows → the court; key plays → the court if a shot has the ID, else the flow.
        var nba = PeekInputs()
        nba.shown = [.court, .flow, .linescore, .leaders, .moments, .box]
        nba.shots = [Mark(id: "s1", period: 3, side: .top, player: "lebron", lead: "Made 3", detail: "James 26' 3PT"),
                     Mark(id: "s2", period: 3, side: .bottom, player: "kd", lead: "Missed 2", detail: "Durant jumper")]
        nba.flow = [Mark(id: "f1", period: 2, lead: "LAL 50–48", detail: "2:10")]
        nba.names = ["lebron": "LeBron James"]
        check(route(Focus(player: "lebron"), nbaRef, nba, source: .box) == .court, "NBA: a box score row peeks the court")
        check(route(Focus(player: "lebron"), nbaRef, nba, source: .leaders) == .court, "NBA: a leader row peeks the court")
        check(route(Focus(player: "bench"), nbaRef, nba, source: .box) == nil, "NBA: a player with no shots: nothing to light, no peek")
        check(route(Focus(play: "s1", period: 3, side: .top), nbaRef, nba, source: .moments) == .court, "NBA: a key play that's a shot peeks the court")
        check(route(Focus(play: "f1", period: 2, side: .top), nbaRef, nba, source: .moments) == .flow,
              "NBA: a key play that isn't a shot peeks the game flow")
        check(route(Focus(period: 3, side: .bottom), nbaRef, nba, source: .linescore) == .court, "NBA: a quarter's cell peeks its shots")
        check(route(Focus(player: "lebron"), nbaRef, nba) == .court, "NBA: a pin (no pointer) peeks too")

        // Football: scoring rows → the linescore's quarter (the field shows only this drive).
        var nfl = PeekInputs()
        nfl.shown = [.field, .linescore, .moments]
        check(route(Focus(play: "td", period: 2, side: .top), nflRef, nfl, source: .moments) == .linescore,
              "football: a scoring play peeks its quarter in the linescore")
        check(route(Focus(period: 2, side: .top), nflRef, nfl, source: .linescore) == nil, "football: the linescore itself: no peek")

        // Climbing: results and starting order → the ascent while a final is live, else the wall, else the scorecard.
        var climb = PeekInputs()
        climb.shown = [.ascent, .wall, .results, .startlist]
        climb.ascent = [Mark(id: "7", lead: "J. Garnbret", detail: "40")]
        climb.wall = [Mark(id: "7"), Mark(id: "8", lead: "O. Mori", detail: "25")]
        check(route(Focus(athlete: 7), climbRef, climb, source: .results) == .ascent, "climbing: a final live peeks the ascent first")
        check(route(Focus(athlete: 8), climbRef, climb, source: .startlist) == .wall, "climbing: off the ascent, the wall's lane")
        climb.shown = [.scorecard, .results]
        climb.cards = [Mark(id: "9", lead: "N. Pan", detail: "54.6")]
        check(route(Focus(athlete: 9), climbRef, climb, source: .results) == .scorecard, "boulder: the scorecard row")
        check(route(Focus(round: 4), csRef, PeekInputs()) == nil, "CS2 has no off-screen pairs")

        // Readouts for the short-viewport pill.
        check(PeekRouter.readout(for: Focus(player: "lebron"), target: .court, inputs: nba).map { "\($0.lead)|\($0.detail)" }
              == "LeBron James|1 of 1 shot", "readout: a player's shots")
        check(PeekRouter.readout(for: Focus(play: "s2"), target: .court, inputs: nba).map { "\($0.lead)|\($0.detail)" }
              == "Missed 2|Durant jumper", "readout: one shot")
        check(PeekRouter.readout(for: Focus(play: "goal1"), target: .pitch, inputs: soccer).map(\.lead) == "23'"
              && PeekRouter.readout(for: Focus(play: "card9"), target: .timeline, inputs: soccer).map { "\($0.lead)|\($0.detail)" } == "41'|Rice",
              "readout: a key event")
        var line = PeekInputs()
        line.linescore = (["1", "2", "3", "4", "T"], ["7", "3", "14", "0", "24"], ["0", "10", "7", "3", "20"], ("KC", "BUF"))
        check(PeekRouter.readout(for: Focus(period: 3, side: .top), target: .linescore, inputs: line).map { "\($0.lead)|\($0.detail)" }
              == "Q3|KC 14 · BUF 7", "readout: a quarter")

        // Timing, on a hand-moved clock.
        let clock = ManualPeekClock()
        let peek = PeekController()
        peek.clock = clock.clock
        let below = PageGeometry.Visibility.hidden(.below), above = PageGeometry.Visibility.hidden(.above)
        func input(_ focus: Focus?, _ target: DetailView.Section? = .court, _ visibility: PageGeometry.Visibility? = above,
                   pinned: Bool = false, held: Bool = false, blocked: Bool = false) -> PeekController.Input {
            PeekController.Input(focus: focus, pinned: pinned, target: focus == nil ? nil : target,
                                 visibility: focus == nil ? nil : visibility, held: held, blocked: blocked)
        }
        let a = Focus(player: "a"), b = Focus(player: "b")
        peek.update(input(a))
        clock.advance(150)
        check(peek.presented == nil, "intent: nothing for the first 260ms")
        peek.update(input(b))
        clock.advance(120)
        check(peek.presented == PeekController.Presentation(section: .court, dock: .top, points: .above),
              "intent isn't restarted by moving to another row: shows at 260ms, docked on the chart's side")
        peek.update(input(a))
        check(peek.presented?.section == .court, "another row with the same chart: stays put, no re-entrance")
        peek.update(input(a, .flow))
        check(peek.presented == PeekController.Presentation(section: .flow, dock: .top, points: .above), "a new target swaps in place")

        peek.update(input(nil))
        clock.advance(200)
        check(peek.presented != nil, "grace: still showing 200ms after the focus clears")
        peek.update(input(b))
        clock.advance(400)
        check(peek.presented != nil, "a row taken within the grace keeps it")
        peek.update(input(nil))
        clock.advance(230)
        check(peek.presented == nil, "gone 220ms after the focus clears")

        peek.update(input(a))
        clock.advance(100)
        check(peek.presented == nil, "a new hover after it left waits for intent again")
        clock.advance(200)
        peek.update(input(a, held: true))
        peek.update(input(nil, held: true))
        clock.advance(500)
        check(peek.presented != nil, "held (pointer on the peek): never hides")
        peek.update(input(nil))
        clock.advance(230)
        check(peek.presented == nil, "released: hides after the grace")

        peek.update(input(a, pinned: true))
        check(peek.presented != nil, "a pin shows at once")
        peek.update(input(a, .court, .partial(.above), pinned: true))
        check(peek.presented != nil, "partly in view: keeps showing (hysteresis)")
        peek.expectArrival(.court)
        peek.update(input(a, .court, .visible, pinned: true))
        check(peek.presented == nil && peek.arrivals[.court] == 1, "the chart in view: the peek goes and the chart flashes once")
        peek.update(input(a, .court, above, pinned: true))
        check(peek.presented != nil, "scrolled away again with the pin: back at once")
        peek.update(input(a, nil, nil, pinned: true))
        check(peek.presented == nil, "the router has no target any more (the play was retracted): it goes")

        // Edge flip: the pointer in the preferred edge's band.
        peek.update(input(nil))
        clock.advance(300)
        peek.pointerInBand = { $0 == .bottom }
        peek.update(input(b, .court, below, pinned: true))
        check(peek.presented == PeekController.Presentation(section: .court, dock: .top, points: .below),
              "the pointer in the bottom band: it docks at the top, its chevron still pointing down at the chart")
        peek.pointerInBand = { _ in false }
        peek.update(input(a, .court, below, pinned: true))
        check(peek.presented?.dock == .bottom, "a new focus picks the edge again")
        peek.update(input(a, .court, below, pinned: true, blocked: true))
        check(peek.presented == nil, "live resize: hides at once")
        peek.update(input(a, .court, below, pinned: true))
        check(peek.presented != nil, "after the resize: re-evaluated")
        peek.update(input(nil))
        clock.advance(300)
        peek.update(input(a, .court, nil))
        clock.advance(400)
        check(peek.presented == nil, "no visibility for the target (not on the page): no peek")
        // With nothing focused the host isn't installed, so it can't report the
        // focus clearing: a waiting intent timer asks for the live focus.
        var live: Focus? = a
        peek.begin { live }
        peek.update(input(a))
        live = nil
        clock.advance(300)
        check(peek.presented == nil, "left before it showed (the host gone): the timer finds nothing and shows nothing")
        live = b
        peek.begin { live }
        peek.update(input(b))
        clock.advance(100)
        check(peek.presented == nil, "a new hover after that waits for intent again")
        clock.advance(200)
        check(peek.presented != nil, "and shows at 260ms")

        // Layout and motion.
        check(PeekLayout.mode(viewport: CGSize(width: 340, height: 320), split: false) == .pill
              && PeekLayout.mode(viewport: CGSize(width: 340, height: 600), split: false) == .compact
              && PeekLayout.mode(viewport: CGSize(width: 720, height: 600), split: true) == .column,
              "a pill under 360pt tall; a column peek when split")
        let viewport = CGSize(width: 340, height: 600)
        check(PeekLayout.plotHeight(viewport) == 150 && PeekLayout.plotHeight(CGSize(width: 340, height: 400)) == 128,
              "plot height: 150, never more than 32% of the viewport")
        check(PeekLayout.compactWidth(viewport, aspect: 94.0 / 50.0) == 302 && PeekLayout.compactWidth(viewport, aspect: nil) == 320
              && PeekLayout.compactWidth(CGSize(width: 340, height: 400), aspect: 0.5) == 180,
              "compact width: the chart's aspect, at least 180, inside the margins")
        let enter0 = PeekMotion.enter(0, reduceMotion: false), enterEnd = PeekMotion.enter(0.5, reduceMotion: false)
        check(enter0.offset == 12 && enter0.opacity == 0 && enter0.scale == 0.97, "enter: from 12pt, transparent, 97%")
        check(enterEnd.offset < 0.3 && enterEnd.opacity == 1 && enterEnd.scale == 1, "enter: settled by 0.5 s")
        check(PeekMotion.enter(0, reduceMotion: true).offset == 0 && PeekMotion.enter(0, reduceMotion: true).scale == 1,
              "Reduce Motion: a fade, no travel or scale")
        check(PeekMotion.exit(0.12, reduceMotion: false) == (8, 0) && PeekMotion.exit(0.12, reduceMotion: true) == (0, 0),
              "exit: 8pt toward its edge in 0.12 s, faster than the entrance")

        // AppKit views drawn over the page never take the pointer. The peek's
        // probe spans the whole scroll view while anything is hovered or
        // pinned; taking hits, it swallowed every click and scroll and broke
        // the hover that installed it.
        check(clicksReach(through: PointerProbe(box: PointerProbe.Box())),
              "the peek's pointer probe passes clicks through to the page")
        check(clicksReach(through: LiveDot()), "a live dot passes clicks through to its row")
    }

    /// Whether a click at the center of a button reaches it through `overlay`.
    private static func clicksReach(through overlay: some View) -> Bool {
        let clicks = ClickCount()
        let host = NSHostingView(rootView: Button { clicks.count += 1 } label: { Color.gray.frame(width: 120, height: 120) }
            .buttonStyle(.plain)
            .overlay { overlay })
        let window = NSWindow(contentRect: NSRect(x: -3000, y: -3000, width: 120, height: 120), styleMask: [.borderless],
                              backing: .buffered, defer: false)
        window.contentView = host
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: NSPoint(x: 60, y: 60), modifierFlags: [],
                                                 timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                                 context: nil, eventNumber: 0, clickCount: 1, pressure: 1) else { return false }
            window.sendEvent(event)
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        return clicks.count == 1
    }
}

@MainActor
private final class ClickCount {
    var count = 0
}

/// The peek's transition (`PeekMotion.transition`) sampled frame by frame:
/// the model the timing tests check. Test-only, so it isn't in the app.
extension PeekMotion {
    /// Enter: 12pt from the docked edge on `Motion.standard`; opacity and
    /// 0.97 → 1 scale on `Motion.fade`. A plain fade with Reduce Motion.
    static func enter(_ t: Double, reduceMotion: Bool) -> (offset: CGFloat, opacity: Double, scale: CGFloat) {
        let fade = Motion.curve.value(at: min(max(t / 0.15, 0), 1))
        if reduceMotion { return (0, fade, 1) }
        let spring = Spring(duration: 0.3, bounce: 0).value(target: 1.0, initialVelocity: 0.0, time: max(t, 0))
        return (12 * CGFloat(1 - min(spring, 1)), fade, 0.97 + 0.03 * CGFloat(fade))
    }

    /// Exit: faster than the entrance (`Motion.exit`), 8pt toward the docked edge.
    static func exit(_ t: Double, reduceMotion: Bool) -> (offset: CGFloat, opacity: Double) {
        let out = Motion.curve.value(at: min(max(t / 0.12, 0), 1))
        return (reduceMotion ? 0 : 8 * CGFloat(out), 1 - out)
    }
}
