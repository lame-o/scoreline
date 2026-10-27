import AppKit
import OSLog
import QuartzCore
import SwiftUI

// The menu bar item and its panel, in AppKit: SwiftUI's MenuBarExtra snaps its
// window back under the item on every content change and reverts user resizes,
// so a panel the user can move and resize needs its own window. This one
// matches the system panel (Liquid Glass, 16pt continuous corners, shadow,
// position, focus, the highlight pill) and adds moving and resizing.
//
// It behaves like a popover that can be torn off (NSPopover's detach): opened
// from the item it's attached, and transient (a click elsewhere, another app,
// Esc, ⌘W or the item put it away). Dragged away and let go, it detaches into
// a floating panel that stays open while you work, with no extra chrome (the
// page's wash runs to the top edge, as attached). Clicking the item, ⌘W, ⌘M or
// Esc puts it away into the menu bar, which is Scoreline's Dock; the next open
// is attached again. The item's right-click menu has the rest (Refresh,
// Settings, Return to Menu Bar, Quit).

// MARK: - The model (pure; Tests/PanelTests.swift)

/// Where the panel is.
enum PanelState: String {
    case closed
    /// Hangs from the menu bar item, transient like a popover.
    case attached
    /// Dragged away: floats above other apps' windows and stays open.
    case detached
}

/// Why the panel was put away: logged, and a detached ⌘M animates.
enum CloseReason: String {
    case outside, appSwitch, space, screen, icon, session, escape, commandW, minimize, menu
}

enum PanelEvent: Equatable {
    /// A click on the item before macOS 27 (target/action toggles).
    case icon
    /// macOS 27: the system began an expanded-interface session (a click on the item).
    case sessionBegan
    /// macOS 27: the system ended it (a second click, another menu bar item, keyboard navigation).
    case sessionEnded
    /// Opened from inside the app: the status menu, or launching Scoreline again.
    case open
    /// A drag of a header or footer was let go: the top-left's offset from
    /// where the attached panel hangs.
    case dragEnded(CGSize)
    /// The status menu's Return to Menu Bar.
    case returnHome
    case close(CloseReason)
}

extension PanelEvent: CustomStringConvertible {
    var description: String {
        switch self {
        case .icon: "icon"
        case .sessionBegan: "sessionBegan"
        case .sessionEnded: "sessionEnded"
        case .open: "open"
        case let .dragEnded(offset): String(format: "dragEnded(%.0f, %.0f)", offset.width, offset.height)
        case .returnHome: "returnHome"
        case let .close(reason): "close(\(reason.rawValue))"
        }
    }
}

enum PanelEffect: Equatable {
    /// Order in, attached, under the item.
    case show
    /// Put away. Animated only for a detached ⌘M.
    case hide(CloseReason, animated: Bool)
    /// Float: window level, every Space; the session ends.
    case detach
    /// Not dragged far enough: glide back under the item.
    case springBack
    /// Glide home under the item and become attached again.
    case returnHome
    /// Detached: keep it on a visible screen.
    case reclamp
    case bringToFront
}

/// Every transition the panel makes, as a table: event in, new state and
/// effects out. PanelController performs the effects.
struct PanelStateMachine {
    /// How far (on either axis) a drag must carry the panel from its anchor
    /// to tear it off. Less springs back, as NSPopover does.
    static let detachDistance: CGFloat = 24

    private(set) var state: PanelState = .closed

    mutating func handle(_ event: PanelEvent) -> [PanelEffect] {
        let (next, effects) = Self.transition(from: state, on: event)
        state = next
        return effects
    }

    static func transition(from state: PanelState, on event: PanelEvent) -> (PanelState, [PanelEffect]) {
        switch (state, event) {
        case (.closed, .icon), (.closed, .sessionBegan), (.closed, .open):
            return (.attached, [.show])
        case (.closed, _):
            return (.closed, [])

        case (.attached, .icon), (.attached, .sessionBegan):
            // A session only begins on an attached panel that was opened
            // without one (the status menu): the click still means "close".
            return (.closed, [.hide(.icon, animated: false)])
        case (.attached, .sessionEnded):
            return (.closed, [.hide(.session, animated: false)])
        case (.attached, .returnHome):
            return (.attached, [])
        case (.attached, .open):
            return (.attached, [.bringToFront])
        case let (.attached, .dragEnded(offset)):
            if shouldDetach(offset) { return (.detached, [.detach]) }
            return (.attached, offset == .zero ? [] : [.springBack])
        case let (.attached, .close(reason)):
            return (.closed, [.hide(reason, animated: false)])

        case (.detached, .icon), (.detached, .sessionBegan):
            // The item is the way to put it away, wherever it floats.
            return (.closed, [.hide(.icon, animated: true)])
        case (.detached, .returnHome):
            return (.attached, [.returnHome])
        case (.detached, .sessionEnded):
            // The session was cancelled at detach; the end it reports isn't a close.
            return (.detached, [])
        case (.detached, .open):
            return (.detached, [.bringToFront])
        case (.detached, .dragEnded):
            return (.detached, [.reclamp])
        case let (.detached, .close(reason)):
            switch reason {
            case .outside, .appSwitch, .space, .session: return (.detached, [])
            case .screen: return (.detached, [.reclamp])
            case .icon: return (.closed, [.hide(.icon, animated: true)])
            case .minimize: return (.closed, [.hide(.minimize, animated: true)])
            case .escape, .commandW, .menu: return (.closed, [.hide(reason, animated: false)])
            }
        }
    }

    static func shouldDetach(_ offset: CGSize) -> Bool {
        abs(offset.width) > detachDistance || abs(offset.height) > detachDistance
    }

    /// The outside-click monitor's filter. Only an attached panel closes on a
    /// click elsewhere, and never for a click on its own menu bar item (the
    /// session, or the toggle before macOS 27, owns those), while one of our
    /// menus is open, or mid-resize.
    static func outsideClickCloses(_ state: PanelState, at point: CGPoint, statusItem: CGRect?, panel: CGRect,
                                   menuOpen: Bool, resizing: Bool) -> Bool {
        guard state == .attached, !menuOpen, !resizing else { return false }
        if let statusItem, statusItem.contains(point) { return false }
        return !panel.contains(point)
    }
}

/// The keys every page shares. Window-level keys are answered by the panel
/// before SwiftUI sees them, so they work even in a text field. Root-level
/// keys are hidden buttons at RootView's root (PanelCommands.swift), routed
/// to whatever page is showing.
enum PanelKey: CaseIterable {
    case close, minimize, quit, settings, refresh, schedule, back

    enum Level { case window, root }

    var character: Character {
        switch self {
        case .close: "w"
        case .minimize: "m"
        case .quit: "q"
        case .settings: ","
        case .refresh: "r"
        case .schedule: "u"   // wired by the Schedule page when it lands
        case .back: "["       // each sub-page's Back button
        }
    }

    var level: Level {
        switch self {
        case .close, .minimize, .quit: .window
        case .settings, .refresh, .schedule, .back: .root
        }
    }

    /// The window-level key a key-down is, if any: ⌘ and the letter, nothing else held.
    static func windowKey(_ characters: String?, _ flags: NSEvent.ModifierFlags) -> PanelKey? {
        guard isCommandOnly(flags), let c = characters?.lowercased().first else { return nil }
        return allCases.first { $0.level == .window && $0.character == c }
    }

    /// A ⌘[ that no page took (the top page has nothing to go back to) is
    /// swallowed instead of beeping.
    static func swallowsUnhandled(_ characters: String?, _ flags: NSEvent.ModifierFlags) -> Bool {
        isCommandOnly(flags) && characters?.first == PanelKey.back.character
    }

    /// Caps Lock and the function key don't count.
    private static func isCommandOnly(_ flags: NSEvent.ModifierFlags) -> Bool {
        flags.intersection([.command, .shift, .option, .control]) == .command
    }
}

/// The panel's lifecycle in the unified log (`Log.panel`), and on stdout too
/// with SCORELINE_PANEL_LOG=1.
enum PanelLog {
    private static let logger = Log.panel
    private static let echo = ProcessInfo.processInfo.environment["SCORELINE_PANEL_LOG"] == "1"

    static func log(_ message: String) {
        logger.notice("\(message, privacy: .public)")
        if echo {
            print("[panel] \(message)")
            fflush(stdout)
        }
    }
}

// MARK: - Size

/// The panel's size, shared by the controller (AppKit) and RootView (SwiftUI).
@Observable @MainActor
final class PanelSizing {
    /// The user's size: the width, and the most the page's height may grow to.
    var ceiling: CGSize
    /// Room below the panel's top edge on its screen (the controller keeps it
    /// current through `setAvailable`).
    private(set) var available: CGFloat = .greatestFiniteMagnitude
    /// The height RootView fits the page to (natural, capped). The controller
    /// animates the window to it. Detached or attached, there's no other
    /// chrome: the window is the page.
    var height: CGFloat = Metrics.panelHeight
    /// The user is dragging an edge: the window drives, content fills it.
    var liveResizing = false
    /// On screen. RootView builds its pages only while true.
    var isOpen = false
    /// Moves the window's height to a new fit: on the house spring, or at once
    /// (set by the controller).
    @ObservationIgnored var resize: (_ height: CGFloat, _ animated: Bool) -> Void = { _, _ in }

    func fit(_ target: CGFloat, animated: Bool) {
        height = target
        resize(target, animated)
    }

    /// The room on screen changed. Written only when it moves: RootView
    /// re-fits on every change of `maxHeight`.
    func setAvailable(_ room: CGFloat) {
        if available != room { available = room }
    }

    /// The tallest the page may be: the user's size, or the room on screen.
    var maxHeight: CGFloat {
        max(Metrics.minPanelHeight, min(ceiling.height, available))
    }

    init() {
        let d = UserDefaults.standard
        let w = d.double(forKey: Keys.width), h = d.double(forKey: Keys.height)
        ceiling = CGSize(width: w > 0 ? min(max(w, Metrics.minWidth), Metrics.maxWidth) : Metrics.compactWidth,
                         height: h > 0 ? max(h, Metrics.minCeiling) : Metrics.panelHeight)
    }

    func save() {
        UserDefaults.standard.set(ceiling.width, forKey: Keys.width)
        UserDefaults.standard.set(ceiling.height, forKey: Keys.height)
    }

    private enum Keys {
        static let width = "panelWidth"
        static let height = "panelHeight"
    }
}

// MARK: - Window

/// Borderless panels refuse key status; this one needs it for focus and shortcuts.
private final class Panel: NSPanel {
    var onCancel: (() -> Void)?
    var onKey: ((PanelKey) -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    /// Esc that no SwiftUI view handled (the top-level page): close, like the system panel.
    override func cancelOperation(_ sender: Any?) { onCancel?() }

    /// A menu bar app has no menu bar of its own, so the standard window keys
    /// are answered here, before any page: ⌘W and ⌘M put the panel away (into
    /// the menu bar), ⌘Q quits. Pages' own shortcuts (⌘1, ⌘[ and so on) come next.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if let key = PanelKey.windowKey(event.charactersIgnoringModifiers, event.modifierFlags) {
            onKey?(key)
            return true
        }
        if super.performKeyEquivalent(with: event) { return true }
        // Esc that no page claimed (its Back button's cancel shortcut comes
        // first, above): close. SwiftUI's hosting view doesn't pass an
        // unclaimed Esc on as cancelOperation, so without this Esc at the top
        // page did nothing. A field being typed in keeps its own Esc.
        if event.keyCode == 53, event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting(.capsLock).isEmpty,
           !(firstResponder is NSText) {
            onCancel?()
            return true
        }
        return PanelKey.swallowsUnhandled(event.charactersIgnoringModifiers, event.modifierFlags)
    }
}

// MARK: - Controller

/// The menu bar item and its panel. The user can move it (drag a header),
/// tear it off (drag it away), and resize it (drag an edge); it opens under
/// the item and remembers its size and page.
@MainActor
final class PanelController: NSObject, NSWindowDelegate {
    let store: ScoreStore
    let sizing = PanelSizing()
    let commands = PanelCommands()
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let panel = Panel(contentRect: NSRect(x: 0, y: 0, width: Metrics.compactWidth, height: Metrics.panelHeight),
                              styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView, .resizable],
                              backing: .buffered, defer: true)
    private let session = StatusItemSession()
    private var machine = PanelStateMachine()
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []
    /// NSEvent monitors, kept apart from observer tokens (removing a monitor
    /// through NotificationCenter leaks it).
    private var eventMonitors: [Any] = []
    /// Always on: right-clicks on the item, and clicks in our other windows.
    private var localMonitor: Any?
    /// One of our own menus is tracking (a game's context menu, the status menu): it mustn't close the panel.
    private var ownMenuOpen = false
    private var resizeStart: CGSize?
    private var defaultSubrole: NSAccessibility.Subrole?
    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    init(store: ScoreStore) {
        self.store = store
        super.init()
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true                     // the window server shades the rounded alpha, like the system panel
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovable = true                     // header drags move it
        panel.isMovableByWindowBackground = false  // only headers and footers drag
        panel.minSize = NSSize(width: Metrics.minWidth, height: Metrics.minPanelHeight)
        panel.maxSize = NSSize(width: Metrics.maxWidth, height: .greatestFiniteMagnitude)
        panel.delegate = self
        panel.onCancel = { [weak self] in self?.close(.escape) }
        panel.onKey = { [weak self] in self?.windowKey($0) }
        panel.setAccessibilityTitle("Scoreline")
        defaultSubrole = panel.accessibilitySubrole()
        configure(for: .attached)

        sizing.resize = { [weak self] height, animated in self?.resize(to: height, animated: animated) }
        // A clicked alert opens its game here, in the panel.
        Notifier.shared.openEvent = { [weak self] id in self?.openEvent(id) ?? false }
        let root = PanelRoot(store: store, sizing: sizing, commands: commands)
        let hosting = NSHostingView(rootView: root)
        hosting.sizingOptions = []                 // the controller sizes the window, never the hosting view
        let chrome = Self.chrome(around: hosting)
        installResizeHandles(in: chrome)
        panel.contentView = chrome

        configureStatusItem()
        installLocalMonitor()
    }

    /// Opens the panel (attached) or brings it forward: launching Scoreline again does this.
    func open() { handle(.open) }

    /// Every way of putting the panel away ends here: Esc, ⌘W, ⌘M, the status
    /// menu, a click elsewhere, a Space change.
    func close(_ reason: CloseReason) { handle(.close(reason)) }

    /// Opens a game's page in the panel (a clicked notification). False when
    /// the game has left the scoreboards (the caller opens it on the web).
    private func openEvent(_ id: String) -> Bool {
        guard store.event(id: id) != nil else { return false }
        commands.destination = .event(id)
        open()
        return true
    }

    private func handle(_ event: PanelEvent) {
        let from = machine.state
        let effects = machine.handle(event)
        guard from != machine.state || !effects.isEmpty else { return }
        PanelLog.log("\(event): \(from.rawValue) → \(machine.state.rawValue)")
        effects.forEach(perform)
    }

    private func perform(_ effect: PanelEffect) {
        switch effect {
        case .show: show()
        case let .hide(reason, animated): hide(reason, animated: animated)
        case .detach: detach()
        case .springBack: springBack()
        case .returnHome: returnHome()
        case .reclamp: reclamp()
        case .bringToFront: panel.makeKeyAndOrderFront(nil)
        }
    }

    private func windowKey(_ key: PanelKey) {
        PanelLog.log("key ⌘\(key.character)")
        switch key {
        case .close: close(.commandW)
        case .minimize: close(.minimize)
        case .quit: NSApp.terminate(nil)
        case .settings, .refresh, .schedule, .back: break
        }
    }

    /// Window level, Spaces and the accessibility role for each state.
    private func configure(for state: PanelState) {
        if state == .detached {
            panel.level = .floating                // above other apps' windows, below menus and alerts
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
            panel.setAccessibilitySubrole(.floatingWindow)
        } else {
            panel.level = .popUpMenu               // 101, as the system panel
            panel.collectionBehavior = [.canJoinAllApplications, .fullScreenAuxiliary, .moveToActiveSpace, .ignoresCycle]
            panel.setAccessibilitySubrole(defaultSubrole)
        }
    }

    // MARK: Status item

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }
        // The SwiftUI label; the item resizes with it through these constraints.
        let label = PassthroughHostingView(rootView: MenuBarLabel(store: store))
        label.translatesAutoresizingMaskIntoConstraints = false
        button.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 6),
            button.trailingAnchor.constraint(equalTo: label.trailingAnchor, constant: 6),
        ])
        // No `statusItem.menu`: an item with a menu gets no session (the 27 header).
        if !session.attach(to: statusItem, onBegin: { [weak self] in self?.sessionBegan() },
                           onEnd: { [weak self] animated in
                               PanelLog.log("session.end(animated: \(animated))")
                               self?.handle(.sessionEnded)
                           }) {
            // Before macOS 27: plain target/action. A right-click opens the menu (the local monitor, or `toggle`).
            button.target = self
            button.action = #selector(toggle)
            button.sendAction(on: [.leftMouseDown, .rightMouseDown])
        }
    }

    @objc private func toggle() {
        if let event = NSApp.currentEvent, Self.isMenuClick(event) { return showStatusMenu() }
        handle(.icon)
    }

    private func sessionBegan() {
        // A right-click that reached the item after all: the menu, with the
        // item lit while it shows. Nothing chosen to open the panel: end it.
        if let event = NSApp.currentEvent, Self.isMenuClick(event) {
            PanelLog.log("session.begin (menu click)")
            showStatusMenu()
            if machine.state != .attached { _ = session.cancel() }
            return
        }
        PanelLog.log("session.begin")
        handle(.sessionBegan)
    }

    static func isMenuClick(_ event: NSEvent) -> Bool {
        event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
    }

    // MARK: Status menu (right-click or control-click on the item)

    private lazy var statusMenu = NSMenu()
    private var openItem = NSMenuItem()
    private var homeItem = NSMenuItem()
    private var scoreItem = NSMenuItem()
    private var loginItem = NSMenuItem()
    private var statusMenuOpen = false
    /// For the smoke test.
    private var statusMenuShows = 0

    private func buildStatusMenu() {
        let menu = statusMenu
        menu.autoenablesItems = false
        @discardableResult
        func add(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.target = self
            menu.addItem(item)
            return item
        }
        openItem = add("Open Scoreline", #selector(menuToggle))
        homeItem = add("Return to Menu Bar", #selector(menuReturnHome))
        menu.addItem(.separator())
        add("Refresh", #selector(menuRefresh), String(PanelKey.refresh.character))
        add("Settings…", #selector(menuSettings), String(PanelKey.settings.character))
        menu.addItem(.separator())
        scoreItem = add("Live Score in Menu Bar", #selector(menuToggleScore))
        loginItem = add("Open at Login", #selector(menuToggleLogin))
        menu.addItem(.separator())
        add("About Scoreline", #selector(menuAbout))
        add("Quit Scoreline", #selector(menuQuit), String(PanelKey.quit.character))
    }

    /// Hangs the menu from the item like any menu bar menu. It's popped up,
    /// never assigned to the item, so the expanded-interface session keeps
    /// working; the panel stays open while it shows.
    private func showStatusMenu() {
        guard !statusMenuOpen, let button = statusItem.button else { return }
        if statusMenu.items.isEmpty { buildStatusMenu() }
        openItem.title = machine.state == .closed ? "Open Scoreline" : "Close Scoreline"
        homeItem.isHidden = machine.state != .detached
        scoreItem.state = store.scoreInMenuBar ? .on : .off
        loginItem.state = store.launchAtLogin ? .on : .off
        statusMenuOpen = true
        statusMenuShows += 1
        ownMenuOpen = true
        PanelLog.log("menu.open (\(machine.state.rawValue))")
        let below = button.isFlipped ? button.bounds.maxY + 5 : button.bounds.minY - 5
        statusMenu.popUp(positioning: nil, at: NSPoint(x: 0, y: below), in: button)
        ownMenuOpen = false
        statusMenuOpen = false
    }

    @objc private func menuToggle() { machine.state == .closed ? open() : close(.menu) }
    @objc private func menuReturnHome() { handle(.returnHome) }
    @objc private func menuRefresh() { commands.refresh(store) }
    @objc private func menuSettings() {
        commands.destination = .settings
        open()
    }
    @objc private func menuToggleScore() { store.scoreInMenuBar.toggle() }
    @objc private func menuToggleLogin() { store.launchAtLogin.toggle() }
    @objc private func menuAbout() {
        NSApp.activate()
        NSApp.orderFrontStandardAboutPanel(nil)
    }
    @objc private func menuQuit() { NSApp.terminate(nil) }

    // MARK: Open / close

    private func show() {
        cancelMinimize()
        configure(for: .attached)
        let width = min(sizing.ceiling.width, visibleFrame(statusItemScreen).width - 16)
        let top = anchorTop()
        sizing.setAvailable(availableHeight(top: top, on: statusItemScreen))
        let height = min(sizing.height, sizing.maxHeight)
        setPanelFrame(NSRect(x: anchorX(width: width), y: top - height, width: width, height: height), display: false)
        sizing.isOpen = true                       // RootView builds the page, then fits (instantly, on open)
        panel.makeKeyAndOrderFront(nil)
        if !session.isAttached { DispatchQueue.main.async { self.statusItem.button?.highlight(true) } }
        installObservers()
        PanelLog.log(String(format: "show(attached) %.0f×%.0f", width, height))
        // A fit the first page asked for while the window was still appearing
        // (resize ignores a panel that isn't on screen yet; sizing.height holds it).
        DispatchQueue.main.async { [self] in
            let fitted = min(sizing.height, sizing.maxHeight)
            if heightSpring == nil, !resizing, abs(panel.frame.height - fitted) > 0.5 {
                place(left: panel.frame.minX, top: panel.frame.maxY, height: fitted)
            }
        }
    }

    private func hide(_ reason: CloseReason, animated: Bool) {
        guard panel.isVisible else { return }
        settleWork?.cancel()
        stopMotion()
        removeObservers()
        // The pill goes out with the panel. The end the session reports finds us closed already.
        _ = session.cancel()
        PanelLog.log("hide(\(reason.rawValue))")
        if animated {
            minimizeAway { [weak self] in self?.putAway() }
        } else {
            putAway()
        }
    }

    private func putAway() {
        stopMotion()
        panel.orderOut(nil)
        if !session.isAttached { statusItem.button?.highlight(false) }
        // The next open is attached, under the item; size and page are kept.
        configure(for: .attached)
        sizing.isOpen = false                      // RootView swaps its pages for a placeholder
    }

    // MARK: Detach and return

    /// Torn off: it floats, joins every Space and stops closing on clicks
    /// elsewhere. Nothing is added to it (the page's wash still runs to the
    /// top edge), and it stays exactly where it is under the pointer, kept on
    /// a visible screen.
    private func detach() {
        leftSpring = nil
        topSpring = nil
        // The panel isn't under the item any more: the pill goes out. The end
        // the session reports is ignored (the state is already detached).
        _ = session.cancel()
        if !session.isAttached { statusItem.button?.highlight(false) }
        configure(for: .detached)
        let f = clamped(panel.frame)
        sizing.setAvailable(availableHeight(top: f.maxY, on: screen(for: f)))
        setPanelFrame(f, display: false)
        PanelLog.log(String(format: "detach at (%.0f, %.0f)", f.minX, f.maxY))
    }

    /// Let go too close to home: back under the item, on Motion.quick's curve.
    private func springBack() {
        let x = anchorX(width: panel.frame.width), y = anchorTop()
        sizing.setAvailable(availableHeight(top: y, on: statusItemScreen))
        PanelLog.log("springBack")
        if reduceMotion {
            leftSpring = nil
            topSpring = nil
            place(left: x, top: y, height: panel.frame.height)
        } else {
            glide(left: x, top: y, omega: Self.quickOmega)
        }
    }

    /// Return to Menu Bar while detached: glide home under the item
    /// (Motion.travel's curve) and be attached again.
    private func returnHome() {
        configure(for: .attached)
        let width = min(sizing.ceiling.width, visibleFrame(statusItemScreen).width - 16)
        if abs(width - panel.frame.width) > 0.5 {
            var f = panel.frame
            f.size.width = width
            setPanelFrame(f, display: false)
        }
        let x = anchorX(width: width), y = anchorTop()
        sizing.setAvailable(availableHeight(top: y, on: statusItemScreen))
        panel.makeKeyAndOrderFront(nil)
        if !session.isAttached { statusItem.button?.highlight(true) }
        if reduceMotion {
            leftSpring = nil
            topSpring = nil
            place(left: x, top: y, height: panel.frame.height)
            PanelLog.log("returnHome (instant)")
        } else {
            PanelLog.log("returnHome")
            glide(left: x, top: y, omega: Self.travelOmega) { PanelLog.log("returnHome landed") }
        }
    }

    /// Detached, after a drag or a display change: on a visible screen, top under its menu bar.
    private func reclamp() {
        let f = clamped(panel.frame)
        sizing.setAvailable(availableHeight(top: f.maxY, on: screen(for: f)))
        guard f.origin != panel.frame.origin else { return }
        PanelLog.log("reclamp")
        if reduceMotion {
            place(left: f.minX, top: f.maxY, height: f.height)
        } else {
            glide(left: f.minX, top: f.maxY, omega: Self.quickOmega)
        }
    }

    // MARK: Minimize (detached)

    private var minimizeGeneration = 0

    /// ⌘M on a detached panel: it shrinks to 92% and fades as it drifts toward
    /// the menu bar item. The one close that animates, because the window has
    /// to show where it went. With Reduce Motion, a plain fade.
    private func minimizeAway(then done: @escaping @MainActor @Sendable () -> Void) {
        minimizeGeneration &+= 1
        let generation = minimizeGeneration
        let ease = CAMediaTimingFunction(controlPoints: 0.23, 1, 0.32, 1)   // Motion's strong ease-out
        let reduce = reduceMotion
        let duration = reduce ? 0.15 : 0.2
        let from = panel.frame
        var to = from
        if !reduce, let content = panel.contentView, let layer = content.layer {
            // Scale about the center, whatever the layer's anchor.
            let b = content.bounds, a = layer.anchorPoint
            let pivot = CGPoint(x: b.width * (0.5 - a.x), y: b.height * (0.5 - a.y))
            var scale = CATransform3DMakeTranslation(pivot.x, pivot.y, 0)
            scale = CATransform3DScale(scale, 0.92, 0.92, 1)
            scale = CATransform3DTranslate(scale, -pivot.x, -pivot.y, 0)
            let animation = CABasicAnimation(keyPath: "transform")
            animation.fromValue = CATransform3DIdentity
            animation.toValue = scale
            animation.duration = duration
            animation.timingFunction = ease
            layer.transform = scale
            layer.add(animation, forKey: "minimize")
            if let item = statusItem.button?.window?.frame {
                let dx = item.midX - from.midX, dy = item.minY - from.maxY
                let distance = max(hypot(dx, dy), 1), travel = min(distance * 0.25, 60)
                to.origin.x += dx / distance * travel
                to.origin.y += dy / distance * travel
            }
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = duration
            context.timingFunction = ease
            panel.animator().alphaValue = 0
            if to != from { panel.animator().setFrame(to, display: false) }
        }, completionHandler: { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.minimizeGeneration == generation else { return }
                done()
                self.resetMinimize()
            }
        })
    }

    private func resetMinimize() {
        panel.contentView?.layer?.removeAnimation(forKey: "minimize")
        panel.contentView?.layer?.transform = CATransform3DIdentity
        panel.alphaValue = 1
    }

    /// Reopened mid-minimize: come back whole.
    private func cancelMinimize() {
        guard panel.alphaValue < 1 || panel.contentView?.layer?.animation(forKey: "minimize") != nil else { return }
        minimizeGeneration &+= 1
        NSAnimationContext.runAnimationGroup { context in   // replaces the running animations
            context.duration = 0
            panel.animator().alphaValue = 1
            panel.animator().setFrame(panel.frame, display: false)
        }
        resetMinimize()
    }

    // MARK: Geometry

    private var statusItemScreen: NSScreen? { statusItem.button?.window?.screen ?? NSScreen.main }
    private func visibleFrame(_ s: NSScreen?) -> NSRect { (s ?? NSScreen.main)?.visibleFrame ?? .zero }

    /// The screen under a frame's top edge (where it's grabbed).
    private func screen(for frame: NSRect) -> NSScreen? {
        let grab = NSPoint(x: frame.midX, y: frame.maxY - 1)
        return NSScreen.screens.first { $0.frame.contains(grab) } ?? panel.screen ?? NSScreen.main
    }

    /// 2pt under the menu bar, left edge on the item's: where the system panel sat.
    private func anchorTop() -> CGFloat {
        (statusItem.button?.window?.frame.minY ?? visibleFrame(statusItemScreen).maxY) - 2
    }

    private func anchorX(width: CGFloat) -> CGFloat {
        let vf = visibleFrame(statusItemScreen)
        let x = statusItem.button?.window?.frame.minX ?? vf.maxX - width
        return min(max(x, vf.minX + 8), vf.maxX - width - 8)
    }

    private func availableHeight(top: CGFloat, on screen: NSScreen?) -> CGFloat {
        max(Metrics.minPanelHeight, top - visibleFrame(screen).minY - 12)
    }

    /// Keeps the top under the menu bar and enough of the panel on screen to grab.
    private func clamped(_ frame: NSRect) -> NSRect {
        let vf = visibleFrame(screen(for: frame))
        var f = frame
        if f.maxY > vf.maxY { f.origin.y -= f.maxY - vf.maxY }
        if f.maxY < vf.minY + 60 { f.origin.y = vf.minY + 60 - f.height }
        f.origin.x = min(max(f.minX, vf.minX - f.width + 60), vf.maxX - 60)
        return f
    }

    /// Every frame change of ours goes through here. It records the top-left
    /// first, so `windowDidMove` can tell our moves from the user's drags.
    private func setPanelFrame(_ frame: NSRect, display: Bool) {
        lastTopLeft = NSPoint(x: frame.minX, y: frame.maxY)
        panel.setFrame(frame, display: display)
        // The content always fills the window, even when the frame changes mid-update.
        if let content = panel.contentView, content.frame.size != frame.size { content.setFrameSize(frame.size) }
    }

    /// The window by its top-left and height (the height on the half point).
    /// Content fills the window and lays out once, in this frame's display pass.
    private func place(left: CGFloat, top: CGFloat, height: CGFloat) {
        let frame = panel.frame
        let h = (height * 2).rounded() / 2
        guard abs(frame.minX - left) > 0.25 || abs(frame.maxY - top) > 0.25 || abs(frame.height - h) > 0.25 else { return }
        if smokeLog { print(String(format: "  window %.1f", h)) }
        let start = CACurrentMediaTime()
        setPanelFrame(NSRect(x: left, y: top - h, width: frame.width, height: h), display: false)
        smokeMeter?.resized(CACurrentMediaTime() - start)
    }

    // MARK: Motion (one display-link loop: height and position)

    /// One critically damped spring: where it is, how fast it's moving, and
    /// where it's headed.
    private struct Spring {
        var value: Double
        var velocity: Double = 0
        var target: Double
        var omega: Double

        /// The exact solution over `dt`, so the motion is the same at any frame
        /// rate. True once it has settled (it's then exactly on target).
        mutating func advance(by dt: Double) -> Bool {
            let w = omega, x = value - target, v = velocity
            let decay = exp(-w * dt)
            let nextX = (x + (v + w * x) * dt) * decay
            let nextV = (v - w * (v + w * x) * dt) * decay
            if abs(nextX) < 0.3 && abs(nextV) < 4 {
                value = target
                velocity = 0
                return true
            }
            value = target + nextX
            velocity = nextV
            return false
        }

        /// A new target mid-flight keeps the position and the velocity, so a
        /// page that settles its height in a few steps reads as one motion.
        static func toward(_ target: CGFloat, from current: Spring?, at value: CGFloat, omega: Double) -> Spring {
            Spring(value: current?.value ?? Double(value), velocity: current?.velocity ?? 0,
                   target: Double(target), omega: omega)
        }
    }

    /// The page's height (auto-height), top edge fixed.
    private var heightSpring: Spring?
    /// The top-left, gliding (spring back, return home, re-clamping).
    private var leftSpring: Spring?
    private var topSpring: Spring?
    private var onLanded: (() -> Void)?
    private var lastStep: CFTimeInterval = 0
    private var link: CADisplayLink?
    private var moving: Bool { heightSpring != nil || leftSpring != nil || topSpring != nil }

    private static func omega(response: Double) -> Double { 2 * Double.pi / response }
    /// Auto-height: response 0.3s, Motion.standard's curve.
    private static let heightOmega = omega(response: 0.3)
    /// Spring back and re-clamping: Motion.quick's curve.
    private static let quickOmega = omega(response: 0.2)
    /// Return home: Motion.travel's curve.
    private static let travelOmega = omega(response: 0.4)

    /// RootView's fit for the page: on the spring, or at once.
    private func resize(to target: CGFloat, animated: Bool) {
        guard panel.isVisible, !resizing else { return }
        let page = panel.frame.height
        guard animated else {
            heightSpring = nil
            place(left: panel.frame.minX, top: panel.frame.maxY, height: target)
            return
        }
        if heightSpring == nil, abs(page - target) <= 0.5 { return }
        heightSpring = .toward(target, from: heightSpring, at: page, omega: Self.heightOmega)
        startLink()
    }

    private func glide(left x: CGFloat, top y: CGFloat, omega: Double, then landed: (() -> Void)? = nil) {
        let f = panel.frame
        leftSpring = .toward(x, from: leftSpring, at: f.minX, omega: omega)
        topSpring = .toward(y, from: topSpring, at: f.maxY, omega: omega)
        onLanded = landed
        startLink()
    }

    private func startLink() {
        guard link == nil else { return }
        let link = panel.contentView?.displayLink(target: self, selector: #selector(step(_:)))
        link?.add(to: .main, forMode: .common)
        self.link = link
    }

    /// One step per display frame, every spring at once, one window frame.
    @objc private func step(_ link: CADisplayLink) {
        guard moving, panel.isVisible, !resizing else { return stopMotion() }
        let now = link.targetTimestamp
        let dt = lastStep == 0 ? link.duration : min(max(now - lastStep, 0), 1.0 / 30)
        lastStep = now
        let frame = panel.frame
        var page = frame.height, x = frame.minX, y = frame.maxY
        if var s = heightSpring {
            heightSpring = s.advance(by: dt) ? nil : s
            page = CGFloat(s.value)
        }
        if var s = leftSpring {
            leftSpring = s.advance(by: dt) ? nil : s
            x = (CGFloat(s.value) * 2).rounded() / 2
        }
        if var s = topSpring {
            topSpring = s.advance(by: dt) ? nil : s
            y = (CGFloat(s.value) * 2).rounded() / 2
        }
        place(left: x, top: y, height: page)
        if !moving {
            let landed = onLanded
            stopMotion()
            landed?()
        }
    }

    private func stopMotion() {
        link?.invalidate()
        link = nil
        lastStep = 0
        heightSpring = nil
        leftSpring = nil
        topSpring = nil
        onLanded = nil
    }

    // MARK: Live resize (the window drives)

    /// The user is dragging an edge (ours or AppKit's): content fills the window.
    private var resizing: Bool { resizeStart != nil }

    func windowWillStartLiveResize(_ notification: Notification) { beginResize() }
    func windowDidEndLiveResize(_ notification: Notification) { endResize() }

    func windowWillResize(_ sender: NSWindow, to size: NSSize) -> NSSize {
        sender.inLiveResize ? constrained(size) : size
    }

    private func beginResize() {
        guard resizeStart == nil else { return }
        stopMotion()                               // a running spring stops where it is
        resizeStart = panel.frame.size
        sizing.height = panel.frame.height
        sizing.liveResizing = true
    }

    /// The limits for a size the user drags to. Widening a short page mustn't
    /// jump it to the 300pt minimum; nothing goes past the screen.
    private func constrained(_ size: NSSize) -> NSSize {
        let start = resizeStart ?? panel.frame.size
        let minH = min(Metrics.minCeiling, start.height)
        let maxH = availableHeight(top: panel.frame.maxY, on: panel.screen)
        let maxW = min(Metrics.maxWidth, visibleFrame(panel.screen).width - 16)
        var width = min(max(size.width, Metrics.minWidth), maxW)
        // Gentle detents at the two widths the layouts are designed around.
        for detent in [Metrics.compactWidth, Metrics.splitWidth] where abs(width - detent) < 8 && detent <= maxW {
            width = detent
        }
        return NSSize(width: width, height: min(max(size.height, minH), maxH))
    }

    /// One step of a drag on one of our handles: the dragged edges move, the
    /// opposite ones stay put.
    fileprivate func resize(from start: NSRect, edges: ResizeEdges, by delta: CGSize) {
        var proposed = start.size
        if edges.contains(.right) { proposed.width = start.width + delta.width }
        if edges.contains(.left) { proposed.width = start.width - delta.width }
        if edges.contains(.bottom) { proposed.height = start.height - delta.height }
        if edges.contains(.top) { proposed.height = start.height + delta.height }
        let size = constrained(proposed)
        var frame = start
        frame.size = size
        frame.origin.x = edges.contains(.left) ? start.maxX - size.width : start.minX
        frame.origin.y = edges.contains(.top) ? start.minY : start.maxY - size.height
        panel.setFrame(frame, display: true)
    }

    fileprivate func handleDragBegan() { beginResize() }
    fileprivate func handleDragEnded() { endResize() }

    private func endResize() {
        guard resizeStart != nil else { return }
        let end = panel.frame.size, start = resizeStart ?? end
        var ceiling = sizing.ceiling
        // Only what the user dragged becomes their size: widening a short page
        // keeps its height ceiling. One size for both states.
        if abs(end.width - start.width) >= 1 { ceiling.width = end.width }
        if abs(end.height - start.height) >= 1 { ceiling.height = max(end.height, Metrics.minCeiling) }
        if sizing.ceiling != ceiling { sizing.ceiling = ceiling }
        sizing.height = end.height
        sizing.setAvailable(availableHeight(top: panel.frame.maxY, on: panel.screen))
        sizing.liveResizing = false
        resizeStart = nil
        sizing.save()
        lastTopLeft = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        // RootView re-fits on the new maxHeight (a short page springs back up, top fixed).
    }

    // MARK: Moves

    private var settleWork: DispatchWorkItem?
    private var lastTopLeft = NSPoint.zero

    func windowDidMove(_ notification: Notification) {
        // Our own frames are recorded before they're set (setPanelFrame), and
        // per-frame resizes keep the top-left: anything else is a drag.
        let topLeft = NSPoint(x: panel.frame.minX, y: panel.frame.maxY)
        guard !resizing, machine.state != .closed,
              abs(topLeft.x - lastTopLeft.x) > 0.5 || abs(topLeft.y - lastTopLeft.y) > 0.5 else { return }
        lastTopLeft = topLeft
        leftSpring = nil                           // the user has it: a glide stops where it is
        topSpring = nil
        scheduleSettle(after: 0.15)
    }

    private func scheduleSettle(after delay: Double) {
        settleWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.settleAfterDrag() }
        settleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// A drag was let go. Attached: torn off if it went far enough, back home
    /// if not. Detached: kept on screen.
    private func settleAfterDrag() {
        guard panel.isVisible, machine.state != .closed else { return }
        // Still held (a pause mid-drag): look again shortly.
        guard NSEvent.pressedMouseButtons == 0 else { return scheduleSettle(after: 0.1) }
        let f = panel.frame
        handle(.dragEnded(CGSize(width: f.minX - anchorX(width: f.width), height: f.maxY - anchorTop())))
    }

    // MARK: Dismissal

    private func installObservers() {
        removeObservers()
        let ws = NSWorkspace.shared.notificationCenter
        let nc = NotificationCenter.default
        // The state machine decides: attached closes, detached stays (and re-clamps on a display change).
        observe(ws, NSWorkspace.activeSpaceDidChangeNotification) { c, _ in c.close(.space) }
        observe(nc, NSApplication.didChangeScreenParametersNotification) { c, _ in c.close(.screen) }
        // The smoke test runs while someone may be using the Mac: their clicks
        // and app switches mustn't close the panel it's measuring.
        guard ProcessInfo.processInfo.environment["SCORELINE_SMOKE"] == nil else { return }
        // Another app coming forward: ⌘-Tab, the Dock, Mission Control.
        observe(ws, NSWorkspace.didActivateApplicationNotification) { c, note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            if app?.processIdentifier != ProcessInfo.processInfo.processIdentifier { c.close(.appSwitch) }
        }
        // A click in another app. macOS 27's session catches some of these but
        // not all (not once the panel has been dragged), so it's never left to
        // the session; a close the session already did is a no-op here.
        if let m = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.clickedElsewhere() }
        }) { eventMonitors.append(m) }
        // Our own menus (a game's context menu, the status menu) don't count as elsewhere.
        observe(nc, NSMenu.didBeginTrackingNotification) { c, _ in c.ownMenuOpen = true }
        observe(nc, NSMenu.didEndTrackingNotification) { c, _ in c.ownMenuOpen = c.statusMenuOpen }
        guard !session.isAttached else { return }
        // Before macOS 27: other apps' menus. Ours post this too, so skip while one is open.
        observe(DistributedNotificationCenter.default(), .init("com.apple.HIToolbox.beginMenuTrackingNotification")) { c, _ in
            if !c.ownMenuOpen { c.close(.outside) }
        }
    }

    private func clickedElsewhere() {
        let point = NSEvent.mouseLocation
        let item = statusItem.button?.window?.frame
        if PanelStateMachine.outsideClickCloses(machine.state, at: point, statusItem: item, panel: panel.frame,
                                                menuOpen: ownMenuOpen, resizing: resizing) {
            PanelLog.log(String(format: "monitor.outside(%.0f, %.0f)", point.x, point.y))
            close(.outside)
        } else if machine.state == .attached, item?.contains(point) == true {
            PanelLog.log("monitor.ignored(statusItem)")
        }
    }

    /// Our own process's clicks: a right-click or control-click on the item
    /// opens the status menu (and is kept from the session and the button);
    /// a click in another of our windows (the About panel) closes an attached
    /// panel, as the NSStatusItem header asks.
    private func installLocalMonitor() {
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]) { [weak self] event in
            let swallow = MainActor.assumeIsolated { self?.swallowsMouseDown(event) ?? false }
            return swallow ? nil : event
        }
    }

    private func swallowsMouseDown(_ event: NSEvent) -> Bool {
        guard let window = event.window else { return false }
        let onItem = window === statusItem.button?.window || NSStringFromClass(type(of: window)).contains("StatusBar")
        if onItem, Self.isMenuClick(event) {
            showStatusMenu()
            return true
        }
        if machine.state == .attached, window !== panel, !onItem, !ownMenuOpen,
           window.level.rawValue < NSWindow.Level.popUpMenu.rawValue {
            close(.outside)
        }
        return false
    }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name,
                         _ action: @escaping @MainActor @Sendable (PanelController, Notification) -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
            MainActor.assumeIsolated { if let self { action(self, note) } }
        }
        observers.append((center, token))
    }

    private func removeObservers() {
        eventMonitors.forEach(NSEvent.removeMonitor)
        eventMonitors.removeAll()
        for (center, token) in observers { center.removeObserver(token) }
        observers.removeAll()
    }

    // MARK: Resize handles

    /// Grab zones wider than AppKit's 3pt borderless edges: the sides and
    /// bottom, corners for resizing both ways at once, and a thin top (the
    /// header is for moving). A grip marks the bottom-right corner.
    private func installResizeHandles(in container: NSView) {
        let edge: CGFloat = 7, corner: CGFloat = 20, top: CGFloat = 4
        func add(_ edges: ResizeEdges, _ frame: (NSRect) -> NSRect, mask: NSView.AutoresizingMask) {
            let handle = ResizeHandle(edges: edges, controller: self)
            handle.frame = frame(container.bounds)
            handle.autoresizingMask = mask
            container.addSubview(handle)
        }
        let b = NSRect(x: 0, y: 0, width: Metrics.compactWidth, height: Metrics.panelHeight)
        container.frame = b
        // Flipped-agnostic: AppKit's y runs up, so the bottom edge is y = 0.
        add(.left, { _ in NSRect(x: 0, y: corner, width: edge, height: b.height - corner - top) }, mask: [.height, .maxXMargin])
        add(.right, { _ in NSRect(x: b.width - edge, y: corner, width: edge, height: b.height - corner - top) }, mask: [.height, .minXMargin])
        add(.bottom, { _ in NSRect(x: corner, y: 0, width: b.width - 2 * corner, height: edge) }, mask: [.width, .maxYMargin])
        add(.top, { _ in NSRect(x: corner, y: b.height - top, width: b.width - 2 * corner, height: top) }, mask: [.width, .minYMargin])
        add([.bottom, .left], { _ in NSRect(x: 0, y: 0, width: corner, height: corner) }, mask: [.maxXMargin, .maxYMargin])
        add([.top, .left], { _ in NSRect(x: 0, y: b.height - top, width: corner, height: top) }, mask: [.maxXMargin, .minYMargin])
        add([.top, .right], { _ in NSRect(x: b.width - corner, y: b.height - top, width: corner, height: top) }, mask: [.minXMargin, .minYMargin])
        let grip = ResizeHandle(edges: [.bottom, .right], controller: self, showsGrip: true)
        grip.frame = NSRect(x: b.width - corner, y: 0, width: corner, height: corner)
        grip.autoresizingMask = [.minXMargin, .maxYMargin]
        container.addSubview(grip)
        // The grip shows faintly while the pointer is over the panel.
        let hover = PanelHoverView(onChange: { inside in grip.panelHovered = inside })
        hover.frame = container.bounds
        hover.autoresizingMask = [.width, .height]
        container.addSubview(hover, positioned: .below, relativeTo: nil)
    }

    // MARK: Chrome

    /// Liquid Glass on macOS 26+ (measured identical to the system panel at 16pt
    /// continuous), the translucent menu material before. Clipped to the
    /// panel's shape: content never paints past the corners, and the glass's
    /// own soft outer shadow is cut (the window server draws the real one).
    private static func chrome(around content: NSView) -> NSView {
        let container: NSView
        let radius: CGFloat
        if #available(macOS 26.0, *) {
            // The page sits on top of the glass, not inside it: NSGlassEffectView
            // draws its content vibrant, which washed every color out (white
            // fills at a third, reds pink). On top, colors are true, as in the
            // system panel.
            radius = 16
            let glass = NSGlassEffectView()
            glass.cornerRadius = radius
            let stack = NSView()
            for view in [glass, content] {
                view.frame = stack.bounds
                view.autoresizingMask = [.width, .height]
                stack.addSubview(view)
            }
            container = stack
        } else {
            let fx = NSVisualEffectView()
            fx.material = .menu
            fx.blendingMode = .behindWindow
            fx.state = .active
            content.frame = fx.bounds
            content.autoresizingMask = [.width, .height]
            fx.addSubview(content)
            radius = 10
            container = fx
        }
        container.wantsLayer = true
        container.layer?.cornerRadius = radius
        container.layer?.cornerCurve = .continuous
        container.layer?.masksToBounds = true
        return container
    }

    // MARK: Smoke test

    /// SCORELINE_SMOKE=1: open the panel, run a few auto-size animations while
    /// timing every frame, drag and resize it, tear it off and bring it home,
    /// try the keys, report, and quit. For checking the panel without anyone
    /// clicking the menu bar. It takes the keyboard for about 20s: run it only
    /// while nobody's at the Mac.
    func smokeTest(snapshot path: String?) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            open()
            try? await Task.sleep(for: .seconds(1))
            let meter = SmokeMeter()
            meter.attach(to: panel.contentView!)
            smokeMeter = meter
            for target in [300.0, 540, 260, 480, 320, 540] as [CGFloat] {
                meter.begin()
                sizing.fit(target, animated: true)
                try? await Task.sleep(for: .milliseconds(700))
                print(meter.report(target > panel.frame.height ? "grow" : "shrink", to: target))
            }
            smokeMeter = nil
            // A corner drag (diagonal), then a width drag into the 680 detent.
            let saved = sizing.ceiling
            let before = panel.frame
            handleDragBegan()
            resize(from: before, edges: [.bottom, .right], by: CGSize(width: 120, height: -80))
            handleDragEnded()
            print(String(format: "corner drag: %.0f×%.0f → %.0f×%.0f, top %.0f → %.0f, ceiling %.0f×%.0f",
                         before.width, before.height, panel.frame.width, panel.frame.height, before.maxY, panel.frame.maxY,
                         sizing.ceiling.width, sizing.ceiling.height))
            let wide = panel.frame
            handleDragBegan()
            resize(from: wide, edges: .right, by: CGSize(width: 680 - wide.width + 5, height: 0))
            handleDragEnded()
            print(String(format: "width drag to 685 → %.0f (detent)", panel.frame.width))
            sizing.ceiling = saved
            sizing.save()
            setPanelFrame(before, display: true)
            // A click into a match and back: what heights does the page ask for?
            print("-- navigate to match")
            NotificationCenter.default.post(name: .scorelineSmokeNavigate, object: nil)
            try? await Task.sleep(for: .seconds(4))
            print("-- back")
            NotificationCenter.default.post(name: .scorelineSmokeNavigate, object: true)
            try? await Task.sleep(for: .seconds(2))
            if let path, let view = panel.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            }
            await smokePanelNative(snapshot: path)
        }
    }

    /// Detach, return home, spring back, the status menu, and the keys.
    private func smokePanelNative(snapshot path: String?) async {
        print("-- panel native")
        var failed = 0
        func check(_ ok: Bool, _ name: String, _ detail: String = "") {
            if !ok { failed += 1 }
            print("\(ok ? "PASS" : "FAIL") \(name)\(detail.isEmpty ? "" : " (\(detail))")")
        }
        func key(_ c: String, _ code: UInt16, _ flags: NSEvent.ModifierFlags = .command) -> NSEvent {
            NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                             windowNumber: panel.windowNumber, context: nil, characters: c,
                             charactersIgnoringModifiers: c, isARepeat: false, keyCode: code)!
        }
        func anchored() -> Bool {
            abs(panel.frame.minX - anchorX(width: panel.frame.width)) < 1 && abs(panel.frame.maxY - anchorTop()) < 1
        }
        func frame(_ f: NSRect) -> String { String(format: "%.0f,%.0f %.0f×%.0f", f.minX, f.minY, f.width, f.height) }
        func dragBy(_ dx: CGFloat, _ dy: CGFloat) {
            // As a header drag would: not one of our frames, so a settle follows.
            panel.setFrameOrigin(NSPoint(x: panel.frame.minX + dx, y: panel.frame.minY + dy))
        }

        check(machine.state == .attached && anchored(), "open: attached under the item", frame(panel.frame))
        // Tear it off: 80pt down and let go.
        let start = panel.frame
        dragBy(0, -80)
        let dropped = panel.frame
        try? await Task.sleep(for: .milliseconds(500))
        check(machine.state == .detached, "detach: state")
        check(panel.level == .floating, "detach: level 3", "\(panel.level.rawValue)")
        check(panel.collectionBehavior.contains(.canJoinAllSpaces), "detach: every Space")
        check(abs(panel.frame.height - dropped.height) < 0.6, "detach: same height (nothing added)",
              "\(frame(dropped)) → \(frame(panel.frame))")
        check(abs(panel.frame.maxY - dropped.maxY) < 0.6 && abs(panel.frame.minX - dropped.minX) < 0.6,
              "detach: page stays where it was let go")
        if let path {
            try? await Task.sleep(for: .milliseconds(300))
            let file = path.replacingOccurrences(of: ".png", with: "-detached.png")
            if let view = panel.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: file))
            }
        }
        // Clicks elsewhere, app switches and Space changes leave it be.
        clickedElsewhere()
        close(.outside)
        close(.appSwitch)
        close(.space)
        check(machine.state == .detached && panel.isVisible, "detached: stays open on clicks elsewhere")
        // The status menu over a detached panel, dismissed after a moment.
        let dismiss = Timer(timeInterval: 0.6, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.statusMenu.cancelTracking() }
        }
        RunLoop.main.add(dismiss, forMode: .common)
        showStatusMenu()
        check(!homeItem.isHidden && openItem.title == "Close Scoreline", "menu: Return to Menu Bar and Close while detached")
        check(machine.state == .detached && panel.isVisible, "menu: panel stays open")
        // A right-click on the item, as AppKit queues it: the local monitor opens the menu.
        if let itemWindow = statusItem.button?.window,
           let click = NSEvent.mouseEvent(with: .rightMouseDown, location: NSPoint(x: 8, y: itemWindow.frame.height / 2),
                                          modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                          windowNumber: itemWindow.windowNumber, context: nil, eventNumber: 0,
                                          clickCount: 1, pressure: 1) {
            let shows = statusMenuShows
            let dismiss = Timer(timeInterval: 0.5, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.statusMenu.cancelTracking() }
            }
            RunLoop.main.add(dismiss, forMode: .common)
            NSApp.postEvent(click, atStart: false)
            try? await Task.sleep(for: .milliseconds(900))
            check(statusMenuShows == shows + 1 && machine.state == .detached, "right-click on the item opens the menu",
                  "item window \(NSStringFromClass(type(of: itemWindow)))")
        }
        // The item puts a floating panel away; the next click opens it attached,
        // under the item. (Return to Menu Bar's glide is in the unit tests.)
        handle(.icon)
        try? await Task.sleep(for: .milliseconds(900))
        check(machine.state == .closed, "icon puts a floating panel away")
        handle(.icon)
        try? await Task.sleep(for: .milliseconds(600))
        check(machine.state == .attached && panel.isVisible, "icon reopens it: state")
        check(panel.level == .popUpMenu, "icon reopens it: level 101", "\(panel.level.rawValue)")
        check(anchored(), "icon reopens it: under the item", "\(frame(panel.frame)) vs start \(frame(start))")
        // A short drag springs back.
        dragBy(12, -10)
        try? await Task.sleep(for: .milliseconds(600))
        check(machine.state == .attached && anchored(), "spring back")
        // Root keys reach the page; ⌘[ at the top page is swallowed.
        check(panel.performKeyEquivalent(with: key("r", 15)), "⌘R handled")
        check(panel.performKeyEquivalent(with: key(",", 43)), "⌘, handled (Settings)")
        try? await Task.sleep(for: .milliseconds(500))
        check(panel.performKeyEquivalent(with: key("\u{1b}", 53, [])), "Esc on Settings goes back")
        try? await Task.sleep(for: .milliseconds(500))
        check(panel.performKeyEquivalent(with: key("[", 33)), "⌘[ at the top page: no beep")
        // Esc at the top page, through the whole key path.
        NSApp.sendEvent(key("\u{1b}", 53, []))
        try? await Task.sleep(for: .milliseconds(200))
        check(machine.state == .closed && !panel.isVisible, "Esc at the top page closes")
        // ⌘W through NSApp: the window answers before SwiftUI's main menu.
        open()
        try? await Task.sleep(for: .milliseconds(400))
        NSApp.sendEvent(key("w", 13))
        try? await Task.sleep(for: .milliseconds(100))
        check(machine.state == .closed && !panel.isVisible, "⌘W closes (through NSApp.sendEvent)")
        // ⌘M while detached: animates away.
        open()
        try? await Task.sleep(for: .milliseconds(400))
        dragBy(-60, -120)
        try? await Task.sleep(for: .milliseconds(500))
        check(machine.state == .detached, "detach again")
        check(panel.performKeyEquivalent(with: key("m", 46)), "⌘M handled")
        check(panel.isVisible, "⌘M: still visible while it animates")
        try? await Task.sleep(for: .milliseconds(300))
        check(!panel.isVisible && panel.alphaValue == 1, "⌘M: hidden after 0.25s, alpha restored")
        // Reopens attached, under the item.
        open()
        try? await Task.sleep(for: .milliseconds(400))
        check(machine.state == .attached && anchored() && panel.level == .popUpMenu,
              "reopen: attached under the item")
        print("panel native: \(failed == 0 ? "all passed" : "\(failed) failed")")
        try? await Task.sleep(for: .milliseconds(300))
        // ⌘Q quits.
        _ = panel.performKeyEquivalent(with: key("q", 12))
    }

    /// SCORELINE_SMOKE=open: open the panel as a first launch does, log every
    /// height the page asks for and the window takes for six seconds, save a
    /// snapshot, quit. Nothing is forced, so it shows what a user sees.
    func smokeOpen(snapshot path: String?) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            show()
            for _ in 0..<12 {
                try? await Task.sleep(for: .milliseconds(500))
                print(String(format: "t window %.0f  sizing.height %.0f  ceiling %.0f  max %.0f",
                             panel.frame.height, sizing.height, sizing.ceiling.height, sizing.maxHeight))
            }
            @MainActor func dump(_ v: NSView, _ depth: Int) {
                guard depth < 4 else { return }
                print(String(repeating: "  ", count: depth) + "\(type(of: v)) \(v.frame)")
                v.subviews.forEach { dump($0, depth + 1) }
            }
            print("panel", panel.frame)
            if let view = panel.contentView { dump(view, 0) }
            if let path, let view = panel.contentView, let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
            }
            close(.menu)
            try? await Task.sleep(for: .milliseconds(300))
            NSApp.terminate(nil)
        }
    }

    private var smokeMeter: SmokeMeter?
    private var smokeLog: Bool { smokeMeter == nil && ProcessInfo.processInfo.environment["SCORELINE_SMOKE"] != nil }
}

// MARK: - SwiftUI root

/// RootView with its environment.
struct PanelRoot: View {
    let store: ScoreStore
    let sizing: PanelSizing
    let commands: PanelCommands

    var body: some View {
        RootView()
        .environment(store)
        .environment(sizing)
        .environment(commands)
    }
}

/// Hosts the menu bar label without taking its clicks (they belong to the button).
private final class PassthroughHostingView<Content: View>: NSHostingView<Content> {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

/// macOS 27's NSStatusItem expanded-interface session (public in the 27 SDK;
/// reached at runtime because Scoreline builds against 26.5). The system then
/// draws the highlight pill and ends the session on a second click on the
/// item, other menus and menu bar keyboard navigation. Clicks elsewhere are
/// the app's to catch (the header says so), and so is cancelling the session
/// when the panel closes some other way.
/// Switch to the typed API under `if #available(macOS 27, *)` once the build uses the 27 SDK.
private final class StatusItemSession: NSObject {
    private weak var item: NSStatusItem?
    private var onBegin: (() -> Void)?
    private var onEnd: ((Bool) -> Void)?
    var isAttached: Bool { item != nil }

    func attach(to item: NSStatusItem, onBegin: @escaping () -> Void, onEnd: @escaping (Bool) -> Void) -> Bool {
        guard item.responds(to: NSSelectorFromString("setExpandedInterfaceDelegate:")) else { return false }
        self.item = item
        self.onBegin = onBegin
        self.onEnd = onEnd
        item.setValue(self, forKey: "expandedInterfaceDelegate")   // weak: the controller retains self
        return true
    }

    /// Ends the session from inside the app; the system then calls statusItemDidEnd….
    /// False when there's none.
    func cancel() -> Bool {
        guard let session = item?.value(forKey: "expandedInterfaceSession") as? NSObject else { return false }
        _ = session.perform(NSSelectorFromString("cancel"))
        return true
    }

    @objc(statusItem:didBeginExpandedInterfaceSession:)
    func statusItem(_ item: NSStatusItem, didBeginExpandedInterfaceSession session: NSObject) {
        MainActor.assumeIsolated { onBegin?() }
    }

    @objc(statusItemDidEndExpandedInterfaceSession:animated:)
    func statusItemDidEndExpandedInterfaceSession(_ item: NSStatusItem, animated: Bool) {
        MainActor.assumeIsolated { onEnd?(animated) }
    }
}

/// Smoke-test frame timing: display-link gaps (dropped frames) and the time
/// each window resize takes.
@MainActor
private final class SmokeMeter: NSObject {
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var gaps: [Double] = []
    private var resizes: [Double] = []
    private var duration: CFTimeInterval = 1.0 / 60

    func attach(to view: NSView) {
        link = view.displayLink(target: self, selector: #selector(tick(_:)))
        link?.add(to: .main, forMode: .common)
    }

    func begin() { gaps = []; resizes = []; last = 0 }
    func resized(_ seconds: Double) { resizes.append(seconds) }

    @objc private func tick(_ link: CADisplayLink) {
        if link.duration > 0 { duration = link.duration }
        if last > 0 { gaps.append(link.timestamp - last) }
        last = link.timestamp
    }

    func report(_ kind: String, to target: CGFloat) -> String {
        let dropped = gaps.reduce(0) { $0 + max(0, Int(($1 / duration).rounded()) - 1) }
        let sorted = resizes.sorted()
        let median = sorted.isEmpty ? 0 : sorted[sorted.count / 2]
        return String(format: "%@ → %.0f: frames %d resizes %d dropped %d | resize median %.1fms max %.1fms",
                      kind, target, gaps.count, resizes.count, dropped, median * 1000, (sorted.last ?? 0) * 1000)
    }
}

/// Which edges a resize handle moves.
struct ResizeEdges: OptionSet {
    let rawValue: Int
    static let left = ResizeEdges(rawValue: 1)
    static let right = ResizeEdges(rawValue: 2)
    static let top = ResizeEdges(rawValue: 4)
    static let bottom = ResizeEdges(rawValue: 8)
}

/// An invisible strip (or corner) along the panel's edge that resizes it.
/// The drag tracks the pointer 1:1; the panel's top-left stays put unless the
/// top or left edge is the one being dragged.
private final class ResizeHandle: NSView {
    let edges: ResizeEdges
    weak var controller: PanelController?
    let showsGrip: Bool
    private var hovered = false { didSet { needsDisplay = true } }
    var panelHovered = false {
        didSet {
            guard showsGrip, oldValue != panelHovered else { return }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.15
                animator().alphaValue = panelHovered ? 1 : 0
            }
        }
    }

    init(edges: ResizeEdges, controller: PanelController, showsGrip: Bool = false) {
        self.edges = edges
        self.controller = controller
        self.showsGrip = showsGrip
        super.init(frame: .zero)
        alphaValue = showsGrip ? 0 : 1
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private var cursor: NSCursor {
        let horizontal: NSCursor.FrameResizePosition? = edges.contains(.left) ? .left : edges.contains(.right) ? .right : nil
        let vertical: NSCursor.FrameResizePosition? = edges.contains(.top) ? .top : edges.contains(.bottom) ? .bottom : nil
        let position: NSCursor.FrameResizePosition = switch (vertical, horizontal) {
        case (.top?, .left?): .topLeft
        case (.top?, .right?): .topRight
        case (.bottom?, .left?): .bottomLeft
        case (.bottom?, .right?): .bottomRight
        case (let v?, nil): v
        case (nil, let h?): h
        default: .bottomRight
        }
        return NSCursor.frameResize(position: position, directions: .all)
    }

    override func resetCursorRects() { addCursorRect(bounds, cursor: cursor) }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        guard showsGrip else { return }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self))
    }

    override func mouseEntered(with event: NSEvent) { hovered = true }
    override func mouseExited(with event: NSEvent) { hovered = false }

    /// A short arc hugging the corner's curve, like an iPad window's.
    override func draw(_ dirtyRect: NSRect) {
        guard showsGrip else { return }
        let radius: CGFloat = 16, inset: CGFloat = 4.5
        let center = NSPoint(x: bounds.maxX - radius, y: radius)
        let arc = NSBezierPath()
        arc.appendArc(withCenter: center, radius: radius - inset, startAngle: 290, endAngle: 340)
        arc.lineWidth = 3
        arc.lineCapStyle = .round
        NSColor.secondaryLabelColor.withAlphaComponent(hovered ? 0.85 : 0.4).setStroke()
        arc.stroke()
    }

    override func mouseDown(with event: NSEvent) {
        guard let window, let controller else { return }
        let start = window.frame
        let origin = NSEvent.mouseLocation
        controller.handleDragBegan()
        // Track until release: the panel follows the pointer 1:1.
        while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            if next.type == .leftMouseUp { break }
            let now = NSEvent.mouseLocation
            controller.resize(from: start, edges: edges, by: CGSize(width: now.x - origin.x, height: now.y - origin.y))
        }
        controller.handleDragEnded()
    }
}

/// Reports the pointer entering and leaving the panel (for the corner grip).
private final class PanelHoverView: NSView {
    let onChange: (Bool) -> Void

    init(onChange: @escaping (Bool) -> Void) {
        self.onChange = onChange
        super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
                                       owner: self))
    }

    override func mouseEntered(with event: NSEvent) { onChange(true) }
    override func mouseExited(with event: NSEvent) { onChange(false) }
}
