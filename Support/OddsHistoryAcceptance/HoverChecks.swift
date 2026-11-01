import AppKit
import Observation

/// Window-local input only: no CGEvent posting, system automation, or changes
/// to the user's mouse. The window supplies the location that its responders
/// read between events, allowing a real stationary-hover regression offscreen.
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
        } onChange: {
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
        let window = HoverCheckWindow(contentRect: panel.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.alphaValue = 0
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
        }
        watchdog.start()
        changes.observe(pointer)
        func pump(_ duration: Double) {
            let until = ProcessInfo.processInfo.systemUptime + duration
            while ProcessInfo.processInfo.systemUptime < until {
                watchdog.beat()
                _ = RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.01))
            }
            watchdog.beat()
        }
        func send(_ type: NSEvent.EventType, at point: NSPoint) {
            window.testLocation = point
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                                                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                                context: nil, eventNumber: 1, clickCount: type == .mouseMoved ? 0 : 1, pressure: 0) else { return }
            window.sendEvent(event)
        }
        func key(_ code: UInt16, _ characters: String) {
            guard let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
                                              timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                              context: nil, characters: characters, charactersIgnoringModifiers: characters,
                                              isARepeat: false, keyCode: code) else { return }
            window.sendEvent(event)
        }
        func element(_ prefix: String) -> NSObject? {
            var queue: [NSObject] = [content]
            var seen: Set<ObjectIdentifier> = []
            while !queue.isEmpty, seen.count < 2000 {
                let next = queue.removeFirst()
                guard seen.insert(ObjectIdentifier(next)).inserted else { continue }
                if next.responds(to: NSSelectorFromString("accessibilityLabel")),
                   let label = next.value(forKey: "accessibilityLabel") as? String, label.hasPrefix(prefix) { return next }
                if next.responds(to: NSSelectorFromString("accessibilityChildren")),
                   let children = next.value(forKey: "accessibilityChildren") as? [NSObject] { queue.append(contentsOf: children) }
            }
            return nil
        }
        func frame(_ prefix: String) -> CGRect? {
            guard let target = element(prefix), target.responds(to: NSSelectorFromString("accessibilityFrame")),
                  let value = target.value(forKey: "accessibilityFrame") as? NSValue else { return nil }
            let rect = value.rectValue
            guard rect.width > 0, rect.height > 0 else { return nil }
            return rect
        }
        func windowPoint(_ point: CGPoint, in frame: CGRect) -> NSPoint {
            // SwiftUI uses top-left local coordinates, AppKit screen frames
            // use bottom-left coordinates. Keep the event on the real mark.
            window.convertPoint(fromScreen: NSPoint(x: frame.minX + point.x, y: frame.maxY - point.y))
        }
        func reading() -> String {
            guard let target = element("Inspect win probability"), target.responds(to: NSSelectorFromString("accessibilityValue")) else { return "" }
            return target.value(forKey: "accessibilityValue") as? String ?? ""
        }
        pointer.clear()
        pump(0.15)
        guard let oddsFrame = frame("Inspect win probability"), let timelineFrame = frame("Match timeline,") else {
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
        check(frames["odds"] != nil && frames["timeline"] != nil, "native hover: production modules are mounted")
        send(.mouseMoved, at: oddsPoint)
        pump(0.2)
        let oddsMoment = pointer.moment, initialChanges = changes.count
        check(oddsMoment == expectedOdds && pointer.active && !pointer.pinned, "native mouse event inspects the exact odds timestamp at forty percent")
        pump(1)
        check(pointer.moment == oddsMoment && changes.count - initialChanges <= 2,
              "stationary native odds hover stays responsive without reading oscillation")
        check(reading().contains("Inspecting") && reading().contains("Market sample"),
              "native odds accessibility value announces the hovered sample")

        send(.mouseMoved, at: timelinePoint)
        pump(0.2)
        let timelineMoment = pointer.moment, timelineChanges = changes.count
        check(timelineMoment == target.t && timelineMoment != oddsMoment && pointer.active,
              "native mouse crossing selects the distinct reported timeline event")
        pump(1)
        check(pointer.moment == timelineMoment && changes.count - timelineChanges <= 2,
              "stationary native timeline hover stays responsive without reading oscillation")

        send(.mouseMoved, at: oddsPoint)
        pump(0.1)
        send(.leftMouseDown, at: oddsPoint); send(.leftMouseUp, at: oddsPoint)
        pump(0.1)
        let pinned = pointer.moment
        check(pointer.pinned && pinned != nil, "native click pins the odds reading and acquires edit focus")
        key(124, "\u{F703}"); pump(0.1)
        check(pointer.pinned && pinned.map { pointer.moment == $0 + 15 } == true,
              "native right arrow advances the clicked odds control fifteen seconds")
        check(reading().contains("Held"), "native odds accessibility value preserves the pinned announcement")
        key(53, "\u{1B}"); pump(0.1)
        check(!pointer.pinned && !pointer.active, "native Escape clears inspection")
        send(.mouseMoved, at: NSPoint(x: -100, y: -100)); pump(0.2)
        check(!pointer.active, "native mouse exit leaves both modules at latest")
    }
}
