import AppKit
import UserNotifications

/// Posts start / score / final alerts for followed teams. Clicking one opens
/// the game's page in the panel (or, if the game has left the scoreboards,
/// its page on the web).
///
/// Every alert's title is the score line ("Arsenal 2–1 Chelsea"); the body
/// says what happened: "Started", "Goal · 23rd minute", "Chiefs scored ·
/// 3:10 left in the 2nd", "Full time".
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    /// Opens a game's page in the panel; false when the store doesn't have
    /// it any more. Set by PanelController.
    var openEvent: ((_ id: String) -> Bool)?

    private var center: UNUserNotificationCenter { .current() }

    func activate() {
        // A process without a bundle (the render harness) has no notification center.
        guard Bundle.main.bundleIdentifier != nil else { return }
        center.delegate = self
    }

    /// Whether macOS will actually show our alerts (the user can block them in System Settings).
    func isBlocked() async -> Bool {
        await center.notificationSettings().authorizationStatus == .denied
    }

    func requestAuthorization() {
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Compares two snapshots of the same event and alerts on meaningful changes.
    func notifyChanges(from old: Event, to new: Event) {
        guard let body = Self.body(from: old, to: new) else { return }
        let content = UNMutableNotificationContent()
        content.title = new.scoreLine(abbreviated: false)
        content.body = body
        content.sound = .default
        // Each event replaces its own previous alert rather than stacking.
        content.threadIdentifier = new.id
        var info: [String: String] = ["event": new.id]
        if let link = new.link { info["url"] = link.absoluteString }
        content.userInfo = info
        center.add(UNNotificationRequest(identifier: new.id, content: content, trigger: nil))
    }

    /// What an alert says under the score line, or nil when the change isn't
    /// news (pure; tested).
    static func body(from old: Event, to new: Event) -> String? {
        let scored = new.competitors.allSatisfy { $0.score != nil }
        switch (old.state, new.state) {
        case (.scheduled, .live):
            return "Started"
        // A "final" without scores is a postponement, not a result.
        case (.live, .final) where scored, (.scheduled, .final) where scored:
            return new.spokenStatus
        case (.live, .live) where old.competitors.map(\.score) != new.competitors.map(\.score):
            let status = new.spokenStatus
            let scorers = ScoreChange.scorers(from: old, to: new)
            // A correction (a goal taken back) or two polls' worth at once.
            guard scorers.count == 1, let team = new.competitors.first(where: { scorers.contains($0.key) }) else {
                return "Score updated · \(status)"
            }
            return new.sport == .soccer ? "Goal · \(status)" : "\(team.name) scored · \(status)"
        default:
            return nil
        }
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler handler: @escaping (UNNotificationPresentationOptions) -> Void) {
        handler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler handler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let id = info["event"] as? String
        let url = (info["url"] as? String).flatMap(URL.init(string:))
        Task { @MainActor in
            if let id, Notifier.shared.openEvent?(id) == true { return }
            if let url { NSWorkspace.shared.open(url) }
        }
        handler()
    }
}
