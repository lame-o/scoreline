import SwiftUI

/// Panel-wide commands that reach the pages from outside them: refreshes
/// (⌘R, the status menu's Refresh) and pages asked for from outside (the
/// status menu's Settings…, a clicked notification's game). PanelController
/// puts one in the environment.
@Observable @MainActor
final class PanelCommands {
    enum Destination: Equatable {
        case settings
        /// A game's page, by event ID (a notification was clicked).
        case event(String)
    }

    /// Bumped on every refresh. Pages with their own data (a match) observe it
    /// and refresh too.
    private(set) var refreshToken = 0
    /// A page to show; RootView goes there and clears it.
    var destination: Destination?

    func refresh(_ store: ScoreStore) {
        store.startPolling()
        refreshToken &+= 1
    }
}

extension View {
    /// The root-level keys every page shares (⌘, Settings and ⌘R Refresh), and
    /// pages asked for from outside (Settings…, a notification's game). ⌘W,
    /// ⌘M, ⌘Q, Esc at the top page and a stray ⌘[ are the window's (`Panel`
    /// in PanelController.swift); each sub-page's Back button keeps ⌘[ and Esc.
    /// Pages with their own data observe `refreshToken` for ⌘R rather than
    /// binding the key again.
    func panelCommands(settings: @escaping () -> Void, event: @escaping (String) -> Void) -> some View {
        modifier(PanelCommandsModifier(settings: settings, event: event))
    }
}

private struct PanelCommandsModifier: ViewModifier {
    let settings: () -> Void
    let event: (String) -> Void
    @Environment(ScoreStore.self) private var store
    @Environment(PanelCommands.self) private var commands: PanelCommands?

    func body(content: Content) -> some View {
        content
            // Always present, whatever the page: no page can forget them.
            .background {
                ShortcutButton(key: KeyEquivalent(PanelKey.settings.character)) {
                    PanelLog.log("key ⌘, → settings")
                    settings()
                }
                ShortcutButton(key: KeyEquivalent(PanelKey.refresh.character)) {
                    PanelLog.log("key ⌘R → refresh")
                    if let commands { commands.refresh(store) } else { store.startPolling() }
                }
            }
            .onChange(of: commands?.destination) { _, destination in
                guard let destination else { return }
                commands?.destination = nil
                switch destination {
                case .settings: settings()
                case let .event(id): event(id)
                }
            }
    }
}
