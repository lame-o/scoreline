import ServiceManagement
import SwiftUI

struct ManageView: View {
    @Environment(ScoreStore.self) private var store
    /// The page Back returns to (Settings opens from any page with ⌘,).
    var backTitle = "Scores"
    let onDone: () -> Void
    let onOpenLeague: (League) -> Void
    let onAddSports: () -> Void
    @State private var notificationsBlocked = false
    @State private var addHovering = false

    var body: some View {
        @Bindable var store = store
        @Bindable var updater = Updater.shared
        VStack(spacing: 0) {
            header.stackIn().pageChrome()

            PageScrollView {
                StackColumn {
                    myTeams

                    groupLabel("Your Sports", "line.3.horizontal")
                    GroupBox {
                        ForEach(store.enabledLeagues) { league in
                            LeagueOrderRow(league: league) { onOpenLeague(league) }
                        }
                        addSportsRow
                    }
                    if store.enabledLeagues.count > 1 {
                        caption("Drag to reorder. Click a league for its teams and options.")
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
                    }
                    caption("With Reduce Motion on, movement becomes gentle fades.")

                    groupLabel("Notifications", "bell")
                    GroupBox {
                        ToggleRow(title: "Alerts for my teams", subtitle: "When a game starts, on every score, and at the end",
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

                    caption("Data from ESPN, bo3.gg and IFSC. Streams from YouTube and Twitch. Win probability by ESPN.")
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

    private var addSportsRow: some View {
        Button(action: onAddSports) {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 16)
                Text(store.enabledLeagues.isEmpty ? "Add a Sport…" : "Add Sports…")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.accentColor)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(Glyph.row)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 30)
            .padding(.trailing, 12)
            .padding(.vertical, 7)
        }
        .buttonStyle(ListRowStyle(hovering: addHovering))
        .onHover { addHovering = $0 }
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

    @ViewBuilder
    private var myTeams: some View {
        groupLabel("My Teams", "star.fill")
        if store.followed.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "star").font(.system(size: 11)).foregroundStyle(.secondary)
                Text("Right-click a game, or use the ★ on a league's team list, to follow a team. It shows first, sends alerts and puts its live score in the menu bar.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.045)))
            .padding(.horizontal, 12)
        } else {
            GroupBox {
                ForEach(store.followed) { team in
                    TeamRow(team: team, page: teamPage(team)) { withAnimation(Motion.quick) { store.unfollow(team) } }
                }
            }
        }
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

/// A league in the user's order: drag to reorder, click to open its settings.
private struct LeagueOrderRow: View {
    @Environment(ScoreStore.self) private var store
    let league: League
    let open: () -> Void
    @State private var hovering = false
    @State private var targeted = false

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .help("Drag to reorder")
                Image(systemName: league.sport.symbol)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .frame(width: 16)
                Text(league.name).font(.system(size: 13))
                Spacer()
                Text(filterSummary).font(.system(size: 11.5)).foregroundStyle(.secondary)
                Image(systemName: "chevron.right")
                    .font(Glyph.row)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        }
        .buttonStyle(ListRowStyle(hovering: hovering))
        .onHover { hovering = $0 }
        // Drop indicator: a line above the row the dragged league will land before.
        .overlay(alignment: .top) {
            if targeted { Capsule().fill(Color.accentColor).frame(height: 2).padding(.horizontal, 8).offset(y: -1) }
        }
        .draggable(league.id) {
            Label(league.name, systemImage: league.sport.symbol)
                .font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(.regularMaterial, in: Capsule())
        }
        .dropDestination(for: String.self) { ids, _ in
            guard let id = ids.first else { return false }
            withAnimation(Motion.rearrange) { store.move(id, before: league.id) }
            return true
        } isTargeted: { targeted = $0 }
        .contextMenu {
            Button("Move Up", systemImage: "arrow.up") { withAnimation(Motion.rearrange) { store.move(league.id, by: -1) } }
            Button("Move Down", systemImage: "arrow.down") { withAnimation(Motion.rearrange) { store.move(league.id, by: 1) } }
            Divider()
            Button("Hide \(league.name)", systemImage: "eye.slash") { withAnimation(Motion.rearrange) { store.setEnabled(league, false) } }
        }
        .accessibilityAction(named: "Move Up") { store.move(league.id, by: -1) }
        .accessibilityAction(named: "Move Down") { store.move(league.id, by: 1) }
        .accessibilityAction(named: "Hide \(league.name)") { store.setEnabled(league, false) }
    }

    private var filterSummary: String {
        let count = store.picks(for: league).count
        guard store.isFilterOn(league), count > 0 else { return league.source == .ifsc ? "No countries" : "All games" }
        if league.source == .ifsc { return count == 1 ? "1 country" : "\(count) countries" }
        return count == 1 ? "1 team" : "\(count) teams"
    }
}

extension ManageView {
    /// A followed team's page. Its league comes from a game on the board
    /// (soccer needs one); without it the row stays plain.
    func teamPage(_ team: FollowedTeam) -> Profile.TeamRef? {
        let league = store.sections.lazy.flatMap(\.events)
            .first { $0.competitors.contains { $0.id == team.id } }
            .flatMap { store.leagueByEvent[$0.id] }
        let ref = Profile.TeamRef(id: team.id, name: team.name, logo: team.logo, league: league)
        return ref.isSupported ? ref : nil
    }
}

private struct TeamRow: View {
    let team: FollowedTeam
    /// The team's page, when its sport has them: the row opens it.
    var page: Profile.TeamRef? = nil
    let remove: () -> Void
    @State private var hovering = false
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    var body: some View {
        HStack(spacing: 8) {
            // Logo, name and chevron are the link; the remove button stays its own.
            HStack(spacing: 8) {
                LogoView(url: team.logo)
                Text(team.name).font(.system(size: 13))
                Spacer(minLength: 4)
                if page != nil, navigator != nil {
                    Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
            }
            .profileRowLink(help: "Go to \(team.name)", action: navigator.flatMap { nav in page.map { p in { nav.open(p) } } })
            .contextMenu { if let page { GoToTeamItem(team: page, via: navigator) } }
            Button(action: remove) {
                Image(systemName: "minus.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(hovering ? .red : .secondary)
                    // A 22pt target around the 13pt glyph.
                    .frame(width: 22, height: 22)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .help("Unfollow \(team.name)")
            .accessibilityLabel("Unfollow \(team.name)")
            .onHover { hovering = $0 }
        }
        // The row stays 28pt tall; the button's larger target eats the inset.
        .padding(.leading, 12)
        .padding(.trailing, 7)
        .padding(.vertical, 3)
    }
}
