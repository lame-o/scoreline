import Foundation
import SwiftUI

/// One tournament or climbing event, followed on its own: never every event in its sport.
struct EditionFollow: Codable, Hashable, Identifiable {
    let source: String
    let key: String
    let name: String
    var id: String { "\(source):\(key)" }
    var valid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && name.count <= 200
            && (source == "cs2" ? key.range(of: "^[a-z0-9][a-z0-9-]{0,199}$", options: .regularExpression) != nil
                : source == "ifsc" && key.range(of: "^[1-9][0-9]{0,9}$", options: .regularExpression) != nil)
    }
    func matches(_ event: Event) -> Bool {
        switch event.ref {
        case let .counterStrike(_, tournament): source == "cs2" && tournament == key
        case let .climbing(eventID, _, _, _, _, _): source == "ifsc" && String(eventID) == key
        default: false
        }
    }
}

enum FollowingPolicy {
    static func sanitizeEditions(_ editions: [EditionFollow]) -> [EditionFollow] {
        var seen: Set<String> = []
        return editions.filter { $0.valid && seen.insert($0.id).inserted }
    }
    /// Old versions treated an empty selection as all games. Preserve that effective scope once.
    static func migrateFilters(_ filters: Set<String>, picks: [String: Set<String>], version: Int) -> Set<String> {
        version >= 2 ? filters : filters.filter { $0 == "ifsc" || !(picks[$0] ?? []).isEmpty }
    }
    /// The board a followed team's league is on. Soccer has none of its own: its
    /// team's next game says which competition to watch.
    static func teamLeague(_ id: String) -> String? {
        ScheduleProvider.ESPN.teamSource(id).flatMap { $0.sport == .soccer ? nil : $0.league } ?? (id.hasPrefix("cs-") ? "cs2" : nil)
    }
    static func alertsFor(_ event: Event, followed: [FollowedTeam], muted: Set<String>, enabled: Bool) -> Bool {
        enabled && event.competitors.contains { c in c.id.map { id in followed.contains { $0.id == id } && !muted.contains(id) } ?? false }
    }
}

// MARK: - The page

/// What the user follows, in one place: teams (in every competition they play
/// in), competitions in their order on the scores list, single tournaments.
struct FollowingPage: View {
    @Environment(ScoreStore.self) private var store
    var backTitle = "Scores"
    let onBack: () -> Void
    let onOpenLeague: (League) -> Void
    let onSports: () -> Void
    var onEdition: (EditionFollow) -> Void = { _ in }
    @State private var addHovering = false

    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Following") { BackButton(title: backTitle, action: onBack) }
                .stackIn()
                .pageChrome()
            PageScrollView {
                StackColumn {
                    myTeams
                    groupLabel("Competitions", "line.3.horizontal")
                    GroupBox {
                        ForEach(store.enabledLeagues) { league in
                            LeagueOrderRow(league: league) { onOpenLeague(league) }
                        }
                        addRow
                    }
                    if store.enabledLeagues.count > 1 {
                        caption("Drag to reorder. Their order is the scores list's.")
                    }
                    if !store.editions.isEmpty {
                        groupLabel("Tournaments & Events", "trophy")
                        GroupBox {
                            ForEach(store.editions) { edition in
                                EditionRow(edition: edition) { onEdition(edition) }
                            }
                        }
                        caption("Only these, not the rest of their sport.")
                    }
                }
                // One centred column, like every settings page.
                .formColumn()
                .padding(.bottom, 12)
            }
        }
    }

    @ViewBuilder
    private var myTeams: some View {
        groupLabel("Teams", "star.fill")
        if store.followed.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "star").font(.system(size: 11)).foregroundStyle(.secondary)
                Text("Star a team in Sports or on its page: its games show first, in every competition, and it sends alerts.")
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
            caption(store.notifyFollowed ? "In every competition they play in. The bell turns a team's alerts off."
                                         : "In every competition they play in. Alerts for your teams are off in Settings.")
        }
    }

    private var addRow: some View {
        Button(action: onSports) {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 16)
                Text("Add Competitions…")
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

    /// A followed team's page. Its league comes from a game on the board
    /// (soccer needs one); without it the row stays plain.
    private func teamPage(_ team: FollowedTeam) -> Profile.TeamRef? {
        let league = store.sections.lazy.flatMap(\.events)
            .first { $0.competitors.contains { $0.id == team.id } }
            .flatMap { store.leagueByEvent[$0.id] }
        let ref = Profile.TeamRef(id: team.id, name: team.name, logo: team.logo, league: league)
        return ref.isSupported ? ref : nil
    }
}

// MARK: - Rows

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
            Button("Unfollow \(league.name)", systemImage: "star.slash") { withAnimation(Motion.rearrange) { store.setEnabled(league, false) } }
        }
        .accessibilityAction(named: "Move Up") { store.move(league.id, by: -1) }
        .accessibilityAction(named: "Move Down") { store.move(league.id, by: 1) }
        .accessibilityAction(named: "Unfollow \(league.name)") { store.setEnabled(league, false) }
    }

    private var filterSummary: String {
        let count = store.picks(for: league).count
        guard store.isFilterOn(league) else { return league.source == .ifsc ? "No countries" : "All matches" }
        if count == 0 { return league.source == .ifsc ? "No countries" : "No teams selected" }
        if league.source == .ifsc { return count == 1 ? "1 country" : "\(count) countries" }
        return count == 1 ? "1 team" : "\(count) teams"
    }
}

private struct TeamRow: View {
    @Environment(ScoreStore.self) private var store
    let team: FollowedTeam
    /// The team's page, when its sport has them: the row opens it.
    var page: Profile.TeamRef? = nil
    let remove: () -> Void
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    private var muted: Bool { store.mutedTeams.contains(team.id) }

    var body: some View {
        HStack(spacing: 8) {
            // Logo, name and chevron are the link; the bell and the remove button stay their own.
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
            Button { store.setTeamAlerts(team.id, muted) } label: {
                Image(systemName: muted ? "bell.slash" : "bell.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(muted ? Color.secondary : Color.accentColor)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!store.notifyFollowed)
            .opacity(store.notifyFollowed ? 1 : 0.4)
            .help(store.notifyFollowed ? (muted ? "Turn on alerts for \(team.name)" : "Turn off alerts for \(team.name)") : "Alerts for your teams are off in Settings")
            .accessibilityLabel(muted ? "Turn on alerts for \(team.name)" : "Turn off alerts for \(team.name)")
            RemoveButton(label: "Unfollow \(team.name)", action: remove)
        }
        // The row stays 28pt tall; the button's larger target eats the inset.
        .padding(.leading, 12)
        .padding(.trailing, 7)
        .padding(.vertical, 3)
    }
}

/// A tournament or event followed on its own: it opens, and it can go.
private struct EditionRow: View {
    @Environment(ScoreStore.self) private var store
    let edition: EditionFollow
    let open: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Button(action: open) {
                HStack(spacing: 8) {
                    Text(edition.name).font(.system(size: 13)).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary).accessibilityHidden(true)
                }
                .padding(.leading, 12)
                .padding(.trailing, 4)
                .padding(.vertical, 7)
            }
            .buttonStyle(ListRowStyle(hovering: hovering))
            .onHover { hovering = $0 }
            RemoveButton(label: "Unfollow \(edition.name)") { withAnimation(Motion.quick) { store.toggleEdition(edition) } }
                .padding(.trailing, 7)
        }
    }
}

/// The list's remove control: quiet until pointed at, red then.
private struct RemoveButton: View {
    let label: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "minus.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(hovering ? .red : .secondary)
                // A 22pt target around the 13pt glyph.
                .frame(width: 22, height: 22)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
        .onHover { hovering = $0 }
    }
}

/// A settings row that goes somewhere: the list's hover treatment and hit area,
/// and what's there on the right.
struct NavigationFormRow: View {
    let title: String
    let symbol: String
    var value: String? = nil
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol).font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 16)
                Text(title).font(.system(size: 13))
                Spacer(minLength: 8)
                if let value { Text(value).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1) }
                Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        }
        .buttonStyle(ListRowStyle(hovering: hovering))
        .onHover { hovering = $0 }
    }
}

/// The star everywhere something can be followed: outlined, then filled yellow as on the rest of the app.
struct FollowStar: View {
    let following: Bool
    /// "Premier League"
    let name: String
    var help: String? = nil
    let toggle: () -> Void
    @State private var hovering = false
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Button(action: toggle) {
            Image(systemName: following ? "star.fill" : "star")
                .font(.system(size: 12))
                .foregroundStyle(following ? Color.yellow : Color.secondary.opacity(hovering ? 0.9 : contrast == .increased ? 0.8 : 0.55))
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(following ? "Unfollow \(name)" : help ?? "Follow \(name)")
        .accessibilityLabel(following ? "Unfollow \(name)" : "Follow \(name)")
    }
}

/// The star on one tournament or climbing event.
struct EditionStar: View {
    @Environment(ScoreStore.self) private var store
    let edition: EditionFollow

    var body: some View {
        FollowStar(following: store.editions.contains { $0.id == edition.id }, name: edition.name, help: "Follow \(edition.name) only") {
            store.toggleEdition(edition)
        }
    }
}
