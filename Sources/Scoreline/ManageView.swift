import ServiceManagement
import SwiftUI

struct ManageView: View {
    @Environment(ScoreStore.self) private var store
    /// The page Back returns to (Settings opens from any page with ⌘,).
    var backTitle = "Scores"
    var onFollowing: () -> Void = {}
    let onDone: () -> Void
    var onSports: () -> Void = {}
    @State private var notificationsBlocked = false

    var body: some View {
        @Bindable var store = store
        @Bindable var updater = Updater.shared
        VStack(spacing: 0) {
            header.stackIn().pageChrome()

            PageScrollView {
                StackColumn {
                    groupLabel("Your Scoreline", "star")
                    GroupBox {
                        NavigationFormRow(title: "Following", symbol: "star", action: onFollowing)
                        NavigationFormRow(title: "Sports", symbol: "sportscourt", action: onSports)
                    }

                    groupLabel("Menu Bar", "menubar.rectangle")
                    GroupBox {
                        ToggleRow(title: "Live score", subtitle: "When a team you follow is playing",
                                  isOn: $store.scoreInMenuBar)
                        ToggleRow(title: "Live game count", subtitle: "Number of games in progress, next to the icon",
                                  isOn: $store.showLiveCount)
                    }

                    groupLabel("Live Games", "sparkles")
                    GroupBox {
                        CelebrationLevelRow(level: $store.celebrationLevel)
                        ToggleRow(title: "Scoring slides", subtitle: "A broadcast banner across the game when a team scores",
                                  isOn: $store.scoringSlides)
                        ToggleRow(title: "Sounds", subtitle: "When the game you're watching scores",
                                  isOn: $store.celebrationSounds)
                            .disabled(store.celebrationLevel == .off)
                        ToggleRow(title: "Odds", subtitle: "Polymarket's live market and DraftKings' line on game pages",
                                  isOn: $store.showOdds)
                    }
                    caption("With Reduce Motion on, movement becomes gentle fades.")

                    groupLabel("Notifications", "bell")
                    GroupBox {
                        ToggleRow(title: "Alerts for my teams", subtitle: "Starts, scores and finals. A team's bell in Following turns its own off.",
                                  isOn: $store.notifyFollowed)
                        if store.notifyFollowed && notificationsBlocked {
                            systemSettingsNote("Off in System Settings, so alerts won't appear.") {
                                NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!)
                            }
                        }
                    }

                    groupLabel("General", "gearshape")
                    GroupBox {
                        ToggleRow(title: "Show finished games", subtitle: "Results from the last 18 hours",
                                  isOn: $store.showFinished)
                        ToggleRow(title: "Live leagues move to top", subtitle: "In the list. Tiles always show live games first.",
                                  isOn: $store.liveFirst)
                        ToggleRow(title: "Open at login", isOn: $store.launchAtLogin)
                        if store.loginItemNeedsApproval {
                            systemSettingsNote("Needs your approval in Login Items.") {
                                SMAppService.openSystemSettingsLoginItems()
                            }
                        }
                    }

                    groupLabel("Updates", "arrow.down.circle")
                    GroupBox {
                        versionRow
                        ToggleRow(title: "Check automatically", subtitle: "Once a day, from GitHub",
                                  isOn: $updater.checksAutomatically)
                    }

                    caption("Data from ESPN, bo3.gg and IFSC. Streams from YouTube and Twitch. Win probability by ESPN. Odds from Polymarket and DraftKings.")
                        .padding(.top, 8)
                }
                // One centred column however wide the panel: forms read top to
                // bottom (System Settings never goes two-up). The header stays
                // at the window's edges.
                .formColumn()
                .padding(.bottom, 12)
            }
        }
        // Re-check when the page opens: the user may have changed it in System Settings.
        .task { notificationsBlocked = await Notifier.shared.isBlocked() }
    }

    private var header: some View {
        PageHeader("Settings") { BackButton(title: backTitle, action: onDone) }
    }

    /// "Version 1.0" with the manual check beside it, as in Software Update.
    private var versionRow: some View {
        HStack(spacing: 8) {
            Text("Version \(appVersion)").font(.system(size: 13))
            Spacer(minLength: 8)
            Button("Check for Updates…") { Updater.shared.checkForUpdates() }
                .controlSize(.small)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }

    /// Inline warning under a toggle whose effect depends on a system setting.
    private func systemSettingsNote(_ text: String, open: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(.orange)
            Text(text).font(.system(size: 11)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Button("Open System Settings…", action: open)
                .buttonStyle(.plain)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.accentColor)
                .fixedSize()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private func groupLabel(_ title: String, _ symbol: String) -> some View {
        GroupLabel(title: title, symbol: symbol)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 5)
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10.5))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.top, 5)
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }
}
