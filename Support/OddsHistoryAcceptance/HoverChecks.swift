import AppKit
import Observation

/// Window-local input only: no CGEvent posting, system automation, or changes
/// to the user's mouse. The window supplies the location that its responders
/// read between events. Offscreen hover coverage remains an explicit failed
/// assertion if AppKit does not establish its WindowServer tracking phase.
private final class HoverCheckWindow: NSWindow {
    var testLocation = NSPoint(x: -100, y: -100)
    override var canBecomeKey: Bool { true }
    override var mouseLocationOutsideOfEventStream: NSPoint { testLocation }
}

private final class HoverWatchdog: @unchecked Sendable {
    private let lock = NSLock()
    private var heartbeat = ProcessInfo.processInfo.systemUptime
    private var finished = false

    func beat() { lock.lock(); heartbeat = ProcessInfo.processInfo.systemUptime; lock.unlock() }
    func finish() { lock.lock(); finished = true; lock.unlock() }
    func start() {
        DispatchQueue.global(qos: .utility).async { [self] in
            while true {
                Thread.sleep(forTimeInterval: 0.25)
                lock.lock()
                let done = finished
                let stalled = ProcessInfo.processInfo.systemUptime - heartbeat > 4
                lock.unlock()
                if done { return }
                if stalled {
                    fputs("FAIL native hover: main run loop did not return for four seconds\n", stderr)
                    _exit(2)
                }
            }
        }
    }
}

@MainActor private final class HoverChanges {
    var count = 0
    private var finished = false
    func stop() { finished = true }
    func observe(_ pointer: OddsPointer) {
        guard !finished else { return }
        withObservationTracking {
            _ = pointer.moment
            _ = pointer.active
        } onChange: { [weak self] in
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.finished else { return }
                self.count += 1
                self.observe(pointer)
            }
        }
    }
}

@MainActor enum NativeHoverChecks {
    static func run(panel: NSPanel, pointer: OddsPointer, frames: [String: CGRect],
                    data: OddsChartData, history: MatchHistory, names: (top: String, bottom: String),
                    check: (Bool, String) -> Void) {
        guard let content = panel.contentView else { check(false, "native hover: missing fixture view"); return }
        let previousPolicy = NSApplication.shared.activationPolicy()
        let dispatch = ProcessInfo.processInfo.environment["SCORELINE_HOVER_DISPATCH"] ?? "queue"
        // A prohibited app with an alpha-zero window can be absent from the
        // accessibility tree. Keep this fixture offscreen, but expose its real
        // native controls just as an ordinary accessory app does.
        NSApplication.shared.setActivationPolicy(.accessory)
        // This command-line fixture pumps RunLoop directly instead of calling
        // NSApplication.run(). Complete AppKit's one-time launch lifecycle so
        // its native accessibility bridge and key-window machinery exist.
        NSApplication.shared.finishLaunching()
        NSApplication.shared.activate()
        let window = HoverCheckWindow(contentRect: panel.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.alphaValue = 1
        window.acceptsMouseMovedEvents = true
        panel.contentView = nil
        window.contentView = content
        window.orderFrontRegardless()
        window.makeKey()
        let watchdog = HoverWatchdog(), changes = HoverChanges()
        defer {
            changes.stop(); watchdog.finish()
            window.contentView = nil
            panel.contentView = content
            window.close()
            NSApplication.shared.setActivationPolicy(previousPolicy)
        }
        watchdog.start()
        changes.observe(pointer)
        func pump(_ duration: Double) {
            let until = ProcessInfo.processInfo.systemUptime + duration
            while ProcessInfo.processInfo.systemUptime < until {
                watchdog.beat()
                if dispatch == "queue" {
                    while let event = NSApp.nextEvent(matching: .any, until: Date(), inMode: .default, dequeue: true) {
                        NSApp.sendEvent(event)
                    }
                }
                _ = RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.01))
            }
            watchdog.beat()
        }
        func deliver(_ event: NSEvent) {
            switch dispatch {
            case "window": window.sendEvent(event)
            case "queue": NSApp.postEvent(event, atStart: false)
            default: NSApp.sendEvent(event)
            }
        }
        func send(_ type: NSEvent.EventType, at point: NSPoint) {
            window.testLocation = point
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                                                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                                context: nil, eventNumber: 1, clickCount: type == .mouseMoved ? 0 : 1, pressure: 0) else { return }
            deliver(event)
        }
        func key(_ code: UInt16, _ characters: String) {
            guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                                              timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                              context: nil, characters: characters, charactersIgnoringModifiers: characters,
                                              isARepeat: false, keyCode: code) else { return }
            deliver(event)
        }
        // SwiftUI's virtual nodes can expose the legacy attribute interface
        // while NSView uses modern accessors. Traverse both; KVC-only discovery
        // silently loses the virtual controls on some macOS versions.
        func attribute(_ object: NSObject, modern: String, legacy: String) -> Any? {
            if object.responds(to: NSSelectorFromString(modern)), let value = object.value(forKey: modern) { return value }
            let selector = NSSelectorFromString("accessibilityAttributeValue:")
            guard object.responds(to: selector) else { return nil }
            return object.perform(selector, with: legacy)?.takeUnretainedValue()
        }
        var inspectedLabels: [String] = []
        var inspectedNodes: [String] = []
        func element(_ prefix: String) -> NSObject? {
            var queue: [NSObject] = [window, content]
            var seen: Set<ObjectIdentifier> = []
            inspectedLabels = []
            inspectedNodes = []
            while !queue.isEmpty, seen.count < 2000 {
                let next = queue.removeFirst()
                guard seen.insert(ObjectIdentifier(next)).inserted else { continue }
                let labels = [attribute(next, modern: "accessibilityLabel", legacy: "AXDescription"),
                              attribute(next, modern: "accessibilityTitle", legacy: "AXTitle")]
                    .compactMap { $0 as? String }.filter { !$0.isEmpty }
                let children = attribute(next, modern: "accessibilityChildren", legacy: "AXChildren") as? [NSObject] ?? []
                inspectedNodes.append("\(type(of: next)): children=\(children.count), labels=\(labels)")
                for label in labels {
                    inspectedLabels.append(label)
                    if label.hasPrefix(prefix) { return next }
                }
                queue.append(contentsOf: children)
                if let view = next as? NSView { queue.append(contentsOf: view.subviews) }
            }
            return nil
        }
        func frame(_ prefix: String) -> CGRect? {
            guard let target = element(prefix) else { return nil }
            let rect: CGRect
            if let value = attribute(target, modern: "accessibilityFrame", legacy: "AXFrame") as? NSValue {
                rect = value.rectValue
            } else if let point = attribute(target, modern: "accessibilityPosition", legacy: "AXPosition") as? NSValue,
                      let size = attribute(target, modern: "accessibilitySize", legacy: "AXSize") as? NSValue {
                rect = CGRect(origin: point.pointValue, size: size.sizeValue)
            } else { return nil }
            guard rect.width > 0, rect.height > 0 else { return nil }
            return rect
        }
        func windowPoint(_ point: CGPoint, in frame: CGRect) -> NSPoint {
            // SwiftUI uses top-left local coordinates, AppKit screen frames
            // use bottom-left coordinates. Keep the event on the real mark.
            window.convertPoint(fromScreen: NSPoint(x: frame.minX + point.x, y: frame.maxY - point.y))
        }
        func reading() -> String {
            guard let target = element("Inspect win probability") else { return "" }
            return attribute(target, modern: "accessibilityValue", legacy: "AXValue") as? String ?? ""
        }
        func press(_ prefix: String) -> Bool {
            guard let target = element(prefix) else { return false }
            // SwiftUI virtual elements adopt the complete protocol rather
            // than necessarily declaring the role-specific Button protocol.
            // Its Bool reports actual dispatch; legacy NSObject action
            // fallback can silently do nothing and cannot prove activation.
            if let accessible = target as? NSAccessibilityProtocol {
                let triggered = accessible.accessibilityPerformPress()
                print("Native AX press: \(prefix), class=\(type(of: target)), triggered=\(triggered)")
                return triggered
            }
            if let button = target as? NSAccessibilityButton { return button.accessibilityPerformPress() }
            print("Native AX press: \(prefix), class=\(type(of: target)), modern action unavailable")
            return false
        }
        pointer.clear()
        pump(0.15)
        // Moving a hosted view between fixture windows rebuilds its native AX
        // tree asynchronously. Wait for that tree, never substitute guessed
        // frames or skip assertions when controls are missing.
        for _ in 0..<20 {
            if frame("Inspect win probability") != nil && frame("Match timeline,") != nil { break }
            pump(0.05)
        }
        guard let oddsFrame = frame("Inspect win probability"), let timelineFrame = frame("Match timeline,") else {
            print("Native hover AX discovery: visible=\(window.isVisible), alpha=\(window.alphaValue), key=\(window.isKeyWindow), active=\(NSApp.isActive), labels=\(inspectedLabels.prefix(30)), nodes=\(inspectedNodes.prefix(30))")
            check(false, "native hover: both real inspection controls expose their frames")
            return
        }
        let labelWidth = OddsStyle.labelWidth([names.top, names.bottom])
        let widthClass = PanelLayout.resolve(width: frames["odds"]?.width ?? panel.frame.width, from: PanelLayout()).page
        let oddsLayout = OddsLayout(size: oddsFrame.size, plotHeight: OddsStyle.plotHeight(widthClass), domain: data.domain, labelWidth: labelWidth)
        let timelineLayout = OddsLayout(size: timelineFrame.size, plotHeight: 76, domain: data.domain, labelWidth: labelWidth)
        let oddsLocation = CGPoint(x: oddsLayout.plot.minX + oddsLayout.plot.width * 0.4, y: oddsLayout.plot.midY)
        let oddsPoint = windowPoint(oddsLocation, in: oddsFrame)
        let rawOddsTime = oddsLayout.time(at: oddsLocation.x)
        let expectedOdds = min(max(Date(timeIntervalSince1970: rawOddsTime.timeIntervalSince1970.rounded()), data.domain.lowerBound), data.domain.upperBound)
        let targetTime = data.domain.lowerBound + data.domain.upperBound.timeIntervalSince(data.domain.lowerBound) * 0.7
        let events = history.keyEvents.filter { data.domain.contains($0.t) }
        guard let target = events.min(by: { abs($0.t.timeIntervalSince(targetTime)) < abs($1.t.timeIntervalSince(targetTime)) }),
              target.t != expectedOdds else {
            check(false, "native hover: fixture supplies a distinct reported timeline event")
            return
        }
        let timelineLocation = MatchTimelineGeometry.point(target, layout: timelineLayout)
        let timelinePoint = windowPoint(timelineLocation, in: timelineFrame)
        print("Native input geometry: dispatch=\(dispatch), window=\(window.frame), key=\(window.isKeyWindow), active=\(NSApp.isActive), oddsAX=\(oddsFrame), timelineAX=\(timelineFrame), oddsWindow=\(oddsPoint), timelineWindow=\(timelinePoint)")
        func diagnose(_ step: String, expected: Date?) {
            print("Native input \(step): expected=\(expected?.timeIntervalSince1970.description ?? "nil"), actual=\(pointer.moment?.timeIntervalSince1970.description ?? "nil"), active=\(pointer.active), pinned=\(pointer.pinned), key=\(window.isKeyWindow), responder=\(String(describing: window.firstResponder)), AX=\(reading())")
            fflush(stdout)
        }
        check(frames["odds"] != nil && frames["timeline"] != nil, "native hover: production modules are mounted")

        // A click may arrive without a preceding move (for example a freshly
        // presented panel). Its event location must determine the held time.
        // Do not seed hovered state first: that would hide a latest-time bug.
        send(.leftMouseDown, at: oddsPoint); send(.leftMouseUp, at: oddsPoint)
        pump(0.1)
        diagnose("direct odds click", expected: expectedOdds)
        check(pointer.pinned && pointer.moment == expectedOdds,
              "native odds click without prior movement pins the exact clicked timestamp")
        key(53, "\u{1B}"); pump(0.1)
        send(.mouseMoved, at: NSPoint(x: -100, y: -100)); pump(0.1)
        send(.leftMouseDown, at: timelinePoint); send(.leftMouseUp, at: timelinePoint)
        pump(0.1)
        diagnose("direct timeline click", expected: target.t)
        check(pointer.pinned && pointer.moment == target.t,
              "native timeline click without prior movement pins the exact reported event")
        send(.leftMouseDown, at: oddsPoint); send(.leftMouseUp, at: oddsPoint)
        pump(0.1)
        check(pointer.pinned && pointer.moment == expectedOdds,
              "native odds click replaces an existing held timeline reading")
        send(.leftMouseDown, at: timelinePoint); send(.leftMouseUp, at: timelinePoint)
        pump(0.1)
        check(pointer.pinned && pointer.moment == target.t,
              "native timeline click replaces an existing held odds reading")
        key(53, "\u{1B}"); pump(0.1)
        send(.mouseMoved, at: NSPoint(x: -100, y: -100)); pump(0.1)
        send(.mouseMoved, at: oddsPoint)
        pump(0.2)
        let oddsMoment = pointer.moment, initialChanges = changes.count
        diagnose("odds move", expected: expectedOdds)
        check(oddsMoment == expectedOdds && pointer.active && !pointer.pinned, "native mouse event inspects the exact odds timestamp at forty percent")
        pump(1)
        check(pointer.active && oddsMoment == expectedOdds && pointer.moment == oddsMoment && changes.count - initialChanges <= 2,
              "stationary native odds hover stays responsive without reading oscillation")
        check(reading().contains("Inspecting") && reading().contains("Market sample"),
              "native odds accessibility value announces the hovered sample")
        let pressedOdds = press("Inspect win probability")
        pump(0.1)
        check(pressedOdds && pointer.pinned && pointer.moment == expectedOdds,
              "native odds accessibility press holds the currently inspected time")
        key(53, "\u{1B}"); pump(0.1)

        send(.mouseMoved, at: timelinePoint)
        pump(0.2)
        let timelineMoment = pointer.moment, timelineChanges = changes.count
        diagnose("timeline move", expected: target.t)
        check(timelineMoment == target.t && timelineMoment != oddsMoment && pointer.active,
              "native mouse crossing selects the distinct reported timeline event")
        pump(1)
        check(pointer.active && timelineMoment == target.t && pointer.moment == timelineMoment && changes.count - timelineChanges <= 2,
              "stationary native timeline hover stays responsive without reading oscillation")
        let pressedTimeline = press("Match timeline,")
        pump(0.1)
        check(pressedTimeline && pointer.pinned && pointer.moment == target.t,
              "native timeline accessibility press holds the currently inspected event")
        key(53, "\u{1B}"); pump(0.1)

        send(.mouseMoved, at: oddsPoint)
        pump(0.1)
        send(.leftMouseDown, at: oddsPoint); send(.leftMouseUp, at: oddsPoint)
        pump(0.1)
        let pinned = pointer.moment
        check(pointer.pinned && pinned == expectedOdds, "native click pins the exact odds reading and acquires edit focus")
        key(124, "\u{F703}"); pump(0.1)
        diagnose("odds right arrow", expected: pinned.map { min($0 + 15, data.domain.upperBound) })
        check(pointer.pinned && pinned.map { pointer.moment == $0 + 15 } == true,
              "native right arrow advances the clicked odds control fifteen seconds")
        key(123, "\u{F702}"); pump(0.1)
        check(pointer.pinned && pointer.moment == expectedOdds,
              "native left arrow returns exactly fifteen seconds to the clicked time")
        check(reading().contains("Held"), "native odds accessibility value preserves the pinned announcement")
        key(53, "\u{1B}"); pump(0.1)
        check(!pointer.pinned && !pointer.active, "native Escape clears inspection")
        send(.mouseMoved, at: NSPoint(x: -100, y: -100)); pump(0.2)
        check(!pointer.active, "native mouse exit leaves both modules at latest")
        let activateOdds = press("Inspect win probability")
        pump(0.1)
        check(activateOdds && pointer.pinned && pointer.moment == data.domain.upperBound,
              "native odds accessibility press activates the latest reading without pointer coordinates")
        key(53, "\u{1B}"); pump(0.1)
        let activateTimeline = press("Match timeline,")
        pump(0.1)
        check(activateTimeline && pointer.pinned && pointer.moment == data.domain.upperBound,
              "native timeline accessibility press activates the latest reading without pointer coordinates")
        key(53, "\u{1B}"); pump(0.1)
    }
}
