import AppKit

// The panel's model, without AppKit windows: the attached/detached state
// machine (panel-native.md §3, §13), the outside-click filter, and which
// keys are answered where.

extension ScorelineTests {
    static func panel() {
        print("\nPanel")
        panelTransitions()
        panelSessionGuard()
        panelOutsideClicks()
        panelKeys()
    }

    private static func step(_ state: PanelState, _ event: PanelEvent) -> (PanelState, [PanelEffect]) {
        PanelStateMachine.transition(from: state, on: event)
    }

    private static func expect(_ state: PanelState, _ event: PanelEvent, _ next: PanelState, _ effects: [PanelEffect],
                               _ name: String) {
        let (s, e) = step(state, event)
        check(s == next && e == effects, name, "got \(s) \(e)")
    }

    private static func panelTransitions() {
        expect(.closed, .icon, .attached, [.show], "closed + icon → attached")
        expect(.closed, .sessionBegan, .attached, [.show], "closed + session begins (27 icon click) → attached")
        expect(.closed, .open, .attached, [.show], "closed + open (status menu) → attached")
        expect(.attached, .dragEnded(CGSize(width: 0, height: -30)), .detached, [.detach], "attached + drag 30pt → detached")
        expect(.attached, .dragEnded(CGSize(width: 30, height: 0)), .detached, [.detach], "attached + sideways drag 30pt → detached")
        expect(.attached, .dragEnded(CGSize(width: 10, height: -10)), .attached, [.springBack],
               "attached + drag 10pt → attached (spring back)")
        expect(.attached, .dragEnded(CGSize(width: 24, height: -24)), .attached, [.springBack],
               "attached + drag exactly 24pt → springs back (more than 24 detaches)")
        expect(.attached, .dragEnded(.zero), .attached, [], "attached + no movement → nothing")
        expect(.detached, .icon, .closed, [.hide(.icon, animated: true)], "detached + icon → put away toward the item")
        expect(.detached, .sessionBegan, .closed, [.hide(.icon, animated: true)], "detached + session begins → put away")
        expect(.detached, .returnHome, .attached, [.returnHome], "detached + Return to Menu Bar → return home")
        expect(.attached, .icon, .closed, [.hide(.icon, animated: false)], "attached + icon (before 27) → closed")
        expect(.attached, .close(.outside), .closed, [.hide(.outside, animated: false)], "attached + outside → closed")
        expect(.detached, .close(.outside), .detached, [], "detached + outside → detached")
        expect(.attached, .close(.appSwitch), .closed, [.hide(.appSwitch, animated: false)], "attached + app switch → closed")
        expect(.detached, .close(.appSwitch), .detached, [], "detached + app switch → detached")
        expect(.attached, .close(.space), .closed, [.hide(.space, animated: false)], "attached + Space change → closed")
        expect(.detached, .close(.space), .detached, [], "detached + Space change → detached")
        expect(.attached, .close(.screen), .closed, [.hide(.screen, animated: false)], "attached + display change → closed")
        expect(.detached, .close(.screen), .detached, [.reclamp], "detached + display change → re-clamped")
        expect(.detached, .dragEnded(CGSize(width: 300, height: -200)), .detached, [.reclamp],
               "detached + drag → stays detached, kept on screen")
        for state in [PanelState.attached, .detached] {
            for reason in [CloseReason.commandW, .escape, .minimize, .menu] {
                let (s, e) = step(state, .close(reason))
                let animated = state == .detached && reason == .minimize
                check(s == .closed && e == [.hide(reason, animated: animated)],
                      "\(state) + \(reason) → closed\(animated ? " (animated)" : "")", "got \(s) \(e)")
            }
        }
        expect(.attached, .open, .attached, [.bringToFront], "attached + open → brought forward")
        expect(.detached, .open, .detached, [.bringToFront], "detached + open → stays detached, forward")
        expect(.attached, .sessionBegan, .closed, [.hide(.icon, animated: false)],
               "attached (opened from the menu, no session) + icon click → closed")
        expect(.attached, .returnHome, .attached, [], "attached + Return to Menu Bar → nothing (already home)")
        for event in [PanelEvent.close(.commandW), .close(.outside), .sessionEnded, .dragEnded(CGSize(width: 50, height: 50)), .returnHome] {
            expect(.closed, event, .closed, [], "closed + \(event) → nothing")
        }
        var machine = PanelStateMachine()
        let effects = [PanelEvent.icon, .dragEnded(CGSize(width: 0, height: -80)), .close(.outside), .icon, .icon]
            .flatMap { machine.handle($0) }
        check(machine.state == .attached && effects == [.show, .detach, .hide(.icon, animated: true), .show],
              "a whole session: open, tear off, click elsewhere (stays), the item puts it away, the item opens it attached",
              "got \(machine.state) \(effects)")
    }

    private static func panelSessionGuard() {
        // Detaching cancels the session; the end it reports must not close the panel.
        expect(.detached, .sessionEnded, .detached, [], "session end while detached → ignored")
        expect(.attached, .sessionEnded, .closed, [.hide(.session, animated: false)], "session end while attached → closed")
        var machine = PanelStateMachine()
        _ = machine.handle(.sessionBegan)
        let detach = machine.handle(.dragEnded(CGSize(width: 0, height: -40)))
        let end = machine.handle(.sessionEnded)   // what cancelling at detach reports
        check(detach == [.detach] && end.isEmpty && machine.state == .detached, "detach, then the cancelled session ends → still detached")
    }

    private static func panelOutsideClicks() {
        let item = CGRect(x: 1100, y: 924, width: 30, height: 32)
        let panel = CGRect(x: 1100, y: 380, width: 340, height: 540)
        func closes(_ state: PanelState, _ x: CGFloat, _ y: CGFloat, menu: Bool = false, resizing: Bool = false) -> Bool {
            PanelStateMachine.outsideClickCloses(state, at: CGPoint(x: x, y: y), statusItem: item, panel: panel,
                                                 menuOpen: menu, resizing: resizing)
        }
        check(!closes(.attached, 1110, 940), "a click on the status item is ignored (the session owns it)")
        check(closes(.attached, 400, 300), "a click elsewhere closes an attached panel")
        check(closes(.attached, 1500, 940), "a click on another menu bar item closes an attached panel")
        check(!closes(.detached, 400, 300), "a click elsewhere leaves a detached panel")
        check(!closes(.attached, 400, 300, menu: true), "not while one of our menus is open")
        check(!closes(.attached, 400, 300, resizing: true), "not mid-resize")
        check(!closes(.attached, 1200, 600), "not inside the panel")
        check(!closes(.closed, 400, 300), "nothing to close when closed")
    }

    private static func panelKeys() {
        let window = PanelKey.allCases.filter { $0.level == .window }.map(\.character)
        let root = PanelKey.allCases.filter { $0.level == .root }.map(\.character)
        check(window == ["w", "m", "q"], "window level: ⌘W ⌘M ⌘Q", "\(window)")
        check(root == [",", "r", "u", "["], "root level: ⌘, ⌘R ⌘U ⌘[", "\(root)")
        check(Set(window + root).count == window.count + root.count, "no key answered at two levels")
        check(PanelKey.windowKey("w", .command) == .close, "⌘W → close")
        check(PanelKey.windowKey("m", .command) == .minimize, "⌘M → minimize")
        check(PanelKey.windowKey("q", .command) == .quit, "⌘Q → quit")
        check(PanelKey.windowKey("W", [.command, .capsLock]) == .close, "⌘W with Caps Lock on → close")
        check(PanelKey.windowKey("w", [.command, .shift]) == nil, "⇧⌘W isn't ⌘W")
        check(PanelKey.windowKey("w", [.command, .option]) == nil, "⌥⌘W isn't ⌘W")
        check(PanelKey.windowKey("w", []) == nil, "a plain W types (search fields)")
        check(PanelKey.windowKey(",", .command) == nil && PanelKey.windowKey("r", .command) == nil,
              "⌘, and ⌘R go to the pages, not the window")
        check(PanelKey.swallowsUnhandled("[", .command), "an unhandled ⌘[ (top page) is swallowed, no beep")
        check(!PanelKey.swallowsUnhandled("x", .command), "other unhandled keys still beep")
        check(PanelStateMachine.detachDistance == 24, "tear-off distance 24pt")
        let sizing = PanelSizing()
        sizing.ceiling = CGSize(width: 340, height: 600)
        sizing.setAvailable(900)
        check(sizing.maxHeight == 600, "max height: the user's size when the screen has room", "\(sizing.maxHeight)")
        sizing.setAvailable(450)
        check(sizing.maxHeight == 450, "max height: the room on screen when that's less", "\(sizing.maxHeight)")
        sizing.setAvailable(100)
        check(sizing.maxHeight == Metrics.minPanelHeight, "max height: never under the panel's minimum", "\(sizing.maxHeight)")
    }
}
