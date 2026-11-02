import Foundation

extension ScorelineTests {
    @MainActor
    static func matchFocusBridge() async {
        print("\nSoccer linked history focus")
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        func event(_ id: String, _ offset: Double) -> MatchHistory.Event {
            .init(id: id, t: start + offset, period: 1, clock: "43′", text: id, side: .top,
                  kind: .goal, score: "1–0", timing: .reported)
        }
        let goal = event("goal", 30), card = event("card", 60)
        var history = MatchHistory(sport: .soccer, events: [goal, card])
        let domain = start...(start + 100)
        var clock = PresentationClock()
        clock.update(now: start.timeIntervalSince1970, inputs: .init(target: 0, cap: start.timeIntervalSince1970 + 1_000))
        var scheduled = history
        scheduled.periods = [OddsPeriod(number: 1, label: "1st", start: start - 20, end: start + 50)]
        let quiet = OddsSection.schedule([], clock: clock, now: start, history: scheduled)
        let expected = [30.0, 50, 60].map { start + $0 + 0.01 }
        check(quiet == [start] + expected,
              "a quiet market still schedules soccer event reveals and the period boundary on the broadcast clock")
        check(OddsSection.schedule([goal.t, goal.t, card.t, start + 50], clock: clock, now: start, history: scheduled) == quiet,
              "coincident quotes, events and period boundaries schedule one redraw per timestamp")
        let gated = MatchHistory(sport: .soccer, events: [event("past", -1), event("beyond-watermark", 1_200)])
        check(OddsSection.schedule([], clock: clock, now: start, history: gated) == [start]
              && OddsSection.schedule((1...300).map { start + Double($0) }, clock: clock, now: start).count == 241,
              "history scheduling excludes already presented or unreachable events and retains the 240-redraw cap")
        let linked = LinkedFocus(), pointer = OddsPointer(), bridge = MatchFocusBridge()
        func sync() { bridge.synchronize(history: history, domain: domain, linked: linked, pointer: pointer) }
        func settle() async { try? await Task.sleep(for: .milliseconds(110)); sync() }
        sync()
        linked.pin(Focus(play: goal.id)); sync()
        check(pointer.pinned && pointer.moment == goal.t, "a linked soccer play pin selects its exact reported history timestamp")
        linked.hover(Focus(play: card.id), true); await settle()
        check(pointer.pinned && pointer.moment == goal.t, "linked hover cannot displace a held odds reading")
        linked.clear(); sync()
        linked.unpin(); sync()
        check(pointer.moment == nil, "unpinning the external play clears only the cursor that bridge created")

        pointer.pin(card.t); sync(); await settle()
        check(linked.focus?.play == card.id && linked.pinned == nil, "a shared timeline event highlights the existing play without creating a row pin")
        pointer.clear(); sync(); await settle()
        check(linked.focus == nil && pointer.moment == nil, "Latest clears the bridge highlight without an asynchronous echo repinning the cursor")

        linked.pin(Focus(player: "unrelated-player")); sync()
        pointer.pin(goal.t); sync(); await settle()
        check(linked.focus?.play == goal.id && linked.pinned?.player == "unrelated-player",
              "timeline inspection can highlight a play while preserving an unrelated row pin")
        pointer.clear(); sync(); await settle()
        check(linked.focus?.player == "unrelated-player" && pointer.moment == nil,
              "clearing timeline inspection restores unrelated focus and does not select an invented event")
        linked.unpin(); sync()

        linked.pin(Focus(play: "delayed")); sync()
        check(pointer.moment == nil, "a play without a visible timestamp does not fabricate a cursor time")
        let delayed = event("delayed", 80)
        history.events.append(delayed); sync()
        check(pointer.moment == delayed.t && pointer.pinned, "a still-selected play links when its history arrives")
        history.events[2] = event("delayed", 81); sync()
        check(pointer.moment == start + 81, "an owned play selection follows a corrected provider timestamp")
        linked.pin(Focus(play: "later")); sync()
        pointer.pin(goal.t); sync()
        history.events.append(event("later", 90)); sync()
        check(pointer.moment == goal.t, "delayed history cannot replace a newer explicit timeline pin")
        await settle()
        linked.unpin(); sync()
        check(pointer.moment == goal.t, "an external unpin cannot clear a newer cursor owned by the user")

        pointer.clear(); sync(); await settle()
        pointer.hover(goal.t + 0.1); sync(); await settle()
        check(linked.focus == nil, "a nearby odds time never impersonates an exact soccer event")
        pointer.hover(card.t); sync(); await settle()
        check(linked.focus?.play == card.id, "an exact odds sample time links the corresponding existing play")
        linked.hover(Focus(player: "other-hover"), true); sync()
        pointer.clear(); sync(); await settle()
        check(linked.focus?.player == "other-hover", "clearing a bridge cursor never clears an unrelated hover")
        linked.clear(); sync()

        history.events.append(event("simultaneous", 30)); history.events.sort { $0.t < $1.t }
        pointer.hover(goal.t); sync(); await settle()
        check(linked.focus == nil, "a time-only cursor does not guess between simultaneous provider play IDs")
        linked.pin(Focus(play: "simultaneous")); sync()
        check(pointer.moment == goal.t && linked.focus?.play == "simultaneous", "an explicit simultaneous play retains its provider identity")

        let held = OddsPointer(), existing = LinkedFocus(), mounted = MatchFocusBridge()
        held.pin(card.t); existing.pin(Focus(play: goal.id))
        mounted.synchronize(history: history, domain: domain, linked: existing, pointer: held)
        check(held.moment == card.t, "mounting the bridge preserves a preexisting held odds cursor")
        mounted.detach(linked: existing)

        let recent = OddsPointer(), oldPlay = LinkedFocus(), windowBridge = MatchFocusBridge()
        recent.window = .recent; oldPlay.pin(Focus(play: goal.id))
        windowBridge.synchronize(history: history, domain: (start + 50)...(start + 100), linked: oldPlay, pointer: recent)
        check(recent.window == .game && recent.moment == goal.t, "selecting an earlier linked play expands the recent window to Game")
        windowBridge.detach(linked: oldPlay)
        bridge.detach(linked: linked)
    }
}
