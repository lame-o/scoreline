import AppKit
import SwiftUI

// Schedule rows: the scores list's row, continued in time. Teams stacked on
// the left, a status column on the right (time, then network); the day lives
// in the header above, never in the row.

// MARK: - Environment

private struct ScheduleStoreKey: EnvironmentKey {
    static let defaultValue: ScheduleStore? = nil
}

extension EnvironmentValues {
    /// The render harness and tests inject one; the app's pages use the shared store.
    var scheduleStore: ScheduleStore? {
        get { self[ScheduleStoreKey.self] }
        set { self[ScheduleStoreKey.self] = newValue }
    }
}

// MARK: - Row

struct ScheduleRow: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    let item: ScheduleItem
    let highlighted: Bool
    /// The arrow keys put the highlight here (it then wears the accent).
    var keyboard = false
    /// The room the row has (the list's rule: records from medium, a lane from large).
    var width: WidthClass = .compact
    /// Hide the competition when the page is that competition.
    var showsCompetition = true
    /// A collapsed tournament day that's open.
    var expanded = false
    let onHover: (Bool) -> Void
    let onSelect: (ScheduleItem) -> Void
    var onTeamSchedule: (ScheduleTeam) -> Void = { _ in }
    /// Crests that travel in from the folded day's preview.
    var logoMatches: Set<String> = []
    /// Set when the row appears because its day was just unfolded: the text
    /// reveals after this delay (staggered per row) while the crests travel.
    var revealDelay: Double? = nil
    /// Results' Show Details: a finished game's scorers, decisions or top
    /// performers under the teams (otherwise only its knockout context).
    var details = true
    @State private var revealed = false

    private var textShown: Bool { revealDelay == nil || revealed }
    private var detail: RowDetail { .of(width) }
    private var lane: Bool { detail == .lane }
    private var fixedBlock: Bool { detail >= .records }

    /// Games around today take live state from the scores list (same IDs).
    /// Built once per redraw and handed to the parts that need it.
    private func currentEvent() -> Event { Self.event(for: item, store: store) }

    static func event(for item: ScheduleItem, store: ScoreStore) -> Event {
        let base = item.event()
        // A game the board already calls final can't change: reading the
        // live store for it would tie the row (and its page) to every poll.
        guard item.status != .final, abs(DayKey.today().days(to: item.day)) <= 1 else { return base }
        return store.current(base)
    }

    /// One status width for a group of rows (`StatusColumn`), at a row width.
    static func statusWidth(_ items: [ScheduleItem], store: ScoreStore, width: WidthClass) -> CGFloat {
        let lane = RowDetail.of(width) == .lane
        return ScheduleStatusColumn.width(for: items, events: items.map { event(for: $0, store: store) },
                                          networks: width >= .xlarge ? 3 : lane ? 2 : 1)
    }

    private var dimmed: Bool { item.ifNecessary || item.status == .canceled }

    /// A game that didn't happen recedes; one that was stopped keeps its
    /// score, quietly; a forfeit's score (bo3's 1–0) isn't a score at all.
    private var postponed: Bool { item.status == .postponed && item.result?.kind != .suspended }
    private var showsScores: Bool { item.result?.kind != .forfeit }
    private var quietScores: Bool { item.result?.kind == .abandoned }

    var body: some View {
        let event = currentEvent()
        let caption = caption(event)
        Button { onSelect(item) } label: {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    if case let .match(top, bottom) = event.content {
                        ScheduleTeamLine(competitor: top, dimmed: postponed || event.stepsBack(top),
                                         record: detail >= .records ? top.record : nil, soccer: item.sport == .soccer,
                                         matchID: matchID(top), textShown: textShown, showsScore: showsScores, quietScore: quietScores,
                                         gameID: item.id)
                        ScheduleTeamLine(competitor: bottom, dimmed: postponed || event.stepsBack(bottom),
                                         record: detail >= .records ? bottom.record : nil, soccer: item.sport == .soccer,
                                         matchID: matchID(bottom), textShown: textShown, showsScore: showsScores, quietScore: quietScores,
                                         gameID: item.id)
                    } else {
                        HStack(spacing: 6) {
                            Text(item.title ?? "")
                                .font(.system(size: 13, weight: .medium))
                            if item.children != nil {
                                Image(systemName: "chevron.right")
                                    .font(Glyph.disclosure)
                                    .foregroundStyle(.tertiary)
                                    .rotationEffect(.degrees(expanded ? 90 : 0))
                                    .animation(reduceMotion ? nil : Motion.quick, value: expanded)
                            }
                        }
                        .reveal(textShown, reduceMotion: reduceMotion)
                        if let subtitle = item.subtitle, !subtitle.isEmpty, !lane {
                            Text(subtitle)
                                .font(.system(size: 11.5))
                                .foregroundStyle(.secondary)
                                .reveal(textShown, reduceMotion: reduceMotion)
                        }
                    }
                    if !lane, let caption {
                        ResultText.caption(caption)
                            .font(.system(size: 10.5).monospacedDigit())
                            // Information, not decoration: secondary ink either way.
                            .foregroundStyle(.secondary)
                            .reveal(textShown, reduceMotion: reduceMotion)
                    }
                }
                .lineLimit(1)
                .frame(width: fixedBlock ? Metrics.teamBlockWidth : nil, alignment: .leading)
                .frame(maxWidth: fixedBlock ? nil : .infinity, alignment: .leading)
                if lane {
                    ScheduleLane(primary: lanePrimary(event), secondary: laneSecondary(event))
                        .reveal(textShown, reduceMotion: reduceMotion)
                        .widthDetail()
                } else if fixedBlock {
                    Spacer(minLength: 0)
                }
                ScheduleStatusColumn(item: item, event: event, networks: networks)
                    // The group's one status width: every score in it sits in one column.
                    .statusColumn()
                    .reveal(textShown, reduceMotion: reduceMotion)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .frame(maxHeight: .infinity, alignment: .top)
            .opacity(dimmed ? 0.55 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: highlighted, inset: 0, keyboard: keyboard))
        .padding(.horizontal, 6)
        .onHover(perform: onHover)
        .help(item.result == nil ? "" : ResultText.tooltip(item))
        .contextMenu { menu(event) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ScheduleSpeech.row(item, event: event))
        .accessibilityAddTraits(.isButton)
        // The merged element keeps the row's press: VoiceOver opens the game.
        .accessibilityAction { onSelect(item) }
        .accessibilityActions { actions(event) }
        .onAppear {
            guard let delay = revealDelay, !revealed else { return }
            withAnimation((reduceMotion ? Motion.exit : Motion.reveal).delay(reduceMotion ? 0 : delay)) { revealed = true }
        }
    }

    /// Networks the status column lists: one at compact, two with a lane, three at the widest.
    private var networks: Int { width >= .xlarge ? 3 : lane ? 2 : 1 }

    private func matchID(_ competitor: Competitor) -> String? {
        guard !logoMatches.isEmpty else { return nil }
        return logoMatches.first { $0.hasSuffix("|\(competitor.id ?? competitor.name)") }
    }

    /// The line under the teams, one line, never two: live, the situation;
    /// a result, its knockout context, else (Show Details) its scorers,
    /// decisions or performers; otherwise competition and notes.
    private func caption(_ event: Event) -> String? {
        if event.state == .live, let line = event.liveLine, !line.isEmpty { return line }
        let competition = showsCompetition ? item.competition : nil
        if let result = item.result, event.state == .final {
            let story = result.context ?? (details ? result.details : nil) ?? (item.notes.isEmpty ? nil : item.notes.joined(separator: " · "))
            return [competition, story].compactMap { $0 }.joined(separator: " · ").nilIfEmpty
        }
        let parts = [competition] + item.notes.map(Optional.some)
        let text = parts.compactMap { $0 }.joined(separator: " · ")
        return text.isEmpty ? nil : text
    }

    /// The lane's first line: live, the situation; a result, its details
    /// (the wide form); otherwise where it's played.
    private func lanePrimary(_ event: Event) -> String? {
        if event.state == .live, let line = event.liveLine, !line.isEmpty { return line }
        if item.isField { return item.subtitle }
        if let result = item.result, event.state == .final, details, let line = result.detailsWide ?? result.details { return line }
        return item.venue
    }

    /// The lane's second line: what the game was (context, notes); for a
    /// result with nothing to add, where it was and who came.
    private func laneSecondary(_ event: Event) -> String? {
        let competition = showsCompetition ? item.competition : nil
        if let result = item.result, event.state == .final {
            let story = result.context ?? (item.notes.isEmpty ? nil : item.notes.joined(separator: " · "))
            if competition != nil || story != nil { return [competition, story].compactMap { $0 }.joined(separator: " · ") }
            // The venue already led the lane when there were no details to show.
            guard details, result.detailsWide ?? result.details != nil else { return ResultText.attendance(result) }
            return [item.venue?.components(separatedBy: " · ").first, ResultText.attendance(result)].compactMap { $0 }
                .joined(separator: " · ").nilIfEmpty
        }
        let parts = [competition] + item.notes.map(Optional.some)
        let text = parts.compactMap { $0 }.joined(separator: " · ")
        return text.isEmpty ? nil : text
    }

    /// Profile pages for the two teams, when they have them.
    private var teamRefs: [Profile.TeamRef] {
        item.teams.compactMap { t in
            guard let id = t.id else { return nil }
            let ref = Profile.TeamRef(id: id, name: t.name, logo: t.logo, league: League.with(id: item.league)?.id, abbreviation: t.abbreviation)
            return ref.isSupported ? ref : nil
        }
    }

    /// VoiceOver's actions on the merged row: the scores list's (follow, the
    /// team pages), then each team's schedule.
    @ViewBuilder
    private func actions(_ event: Event) -> some View {
        ForEach(RowActions.actions(event, store: store, following: store.isFollowing, navigator: navigator)) { action in
            Button(action.name, action: action.perform)
        }
        ForEach(item.teams.filter { $0.id != nil }, id: \.self) { team in
            Button("\(team.name) Schedule") { onTeamSchedule(team) }
        }
    }

    @ViewBuilder
    private func menu(_ event: Event) -> some View {
        if let link = item.link {
            Button("Open in Browser", systemImage: "safari") { NSWorkspace.shared.open(link) }
            Divider()
        }
        let followable = event.competitors.filter { $0.id != nil }
        if !teamRefs.isEmpty, let navigator {
            ForEach(teamRefs, id: \.id) { ref in GoToTeamItem(team: ref, via: navigator) }
        }
        if !followable.isEmpty {
            ForEach(item.teams.filter { $0.id != nil }, id: \.self) { team in
                Button("\(team.name) Schedule", systemImage: "calendar") { onTeamSchedule(team) }
            }
            Divider()
            ForEach(followable, id: \.self) { team in
                let following = store.isFollowing(team)
                Button(following ? "Unfollow \(team.name)" : "Follow \(team.name)",
                       systemImage: following ? "star.slash" : "star") { store.toggleFollow(team) }
            }
            Divider()
        }
        Button("Copy", systemImage: "doc.on.doc") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(item.result != nil ? ResultText.copy(item) : ScheduleSpeech.row(item, event: event), forType: .string)
        }
    }
}

/// A row redraws when what it shows changes, not when the list does.
extension ScheduleRow: @MainActor Equatable {
    static func == (a: ScheduleRow, b: ScheduleRow) -> Bool {
        a.item == b.item && a.highlighted == b.highlighted && a.keyboard == b.keyboard && a.width == b.width && a.expanded == b.expanded
            && a.showsCompetition == b.showsCompetition && a.logoMatches == b.logoMatches && a.revealDelay == b.revealDelay
            && a.details == b.details
    }
}

/// One team: crest, rank, name, follow star, record (when it fits), score.
private struct ScheduleTeamLine: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let competitor: Competitor
    let dimmed: Bool
    var record: String?
    var soccer = false
    var matchID: String?
    var textShown = true
    /// False for a forfeit: its score isn't one.
    var showsScore = true
    /// An abandoned game's score at the time: shown, but quietly.
    var quietScore = false
    /// The game this line belongs to: a score rolls only within one game (a
    /// goal), never when the row is reused for another (stepping rounds).
    var gameID = ""

    var body: some View {
        HStack(spacing: 8) {
            // The crest stays opaque so it can travel in from the folded day's
            // preview; only the text reveals around it.
            LogoView(url: competitor.logo, darkURL: competitor.darkLogo)
                // A row reused for another game (Results' rounds swap rows by
                // position) gets a fresh crest, never the last one's image.
                .id(competitor.logo)
                .matchedLogo(matchID)
            HStack(spacing: 8) {
                identity
                Spacer(minLength: 8)
                if showsScore, let score = competitor.score {
                    Text(score)
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .foregroundStyle(quietScore ? .secondary : .primary)
                        .contentTransition(.numericText(value: Double(score) ?? 0))
                        .animation(reduceMotion ? nil : Motion.quick, value: score)
                        .id(gameID)
                }
            }
            .reveal(textShown, reduceMotion: reduceMotion)
        }
        .foregroundStyle(dimmed ? .secondary : .primary)
    }

    @ViewBuilder
    private var identity: some View {
        HStack(spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if let rank = competitor.rank {
                    Text("\(rank)")
                        .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .help("No. \(rank) in the AP Top 25")
                }
                // The loser steps back (dimmed); the winner keeps its weight.
                Text(competitor.name)
                    .font(.system(size: 13))
            }
            if store.isFollowing(competitor) {
                Image(systemName: "star.fill")
                    .font(.system(size: 7.5))
                    .foregroundStyle(.yellow)
                    .help("Following")
            }
            if let record = shownRecord {
                Text(record)
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .help(soccer ? "Wins, draws and losses this season" : "Season record")
            }
        }
    }

    private var shownRecord: String? {
        guard let record else { return nil }
        let marks = store.isFollowing(competitor) ? 1 : 0
        let shown = RowText.record(record)
        return RecordFit.fits(name: competitor.name, bold: false, rank: competitor.rank, marks: marks,
                              record: shown, score: showsScore ? competitor.score : nil) ? shown : nil
    }
}

/// The wide row's middle column: where it's played over what it is.
private struct ScheduleLane: View {
    let primary: String?
    let secondary: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let primary {
                ResultText.caption(primary).font(.system(size: 10.5)).foregroundStyle(.secondary)
            }
            if let secondary {
                Text(secondary).font(.system(size: 10.5)).foregroundStyle(.secondary)
            }
        }
        .lineLimit(1)
        .padding(.leading, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .help([primary, secondary].compactMap { $0 }.joined(separator: "\n"))
    }
}

// MARK: - Status column

/// Time, then network. Within three hours a countdown takes the first line;
/// games without a time say so plainly; live and final read as in the list.
struct ScheduleStatusColumn: View {
    @Environment(\.colorSchemeContrast) private var contrast
    let item: ScheduleItem
    let event: Event
    var networks = 1

    private var secondLine: String? {
        let names = item.networks.prefix(networks)
        if !names.isEmpty { return names.joined(separator: " · ") }
        return item.format
    }

    /// A stopped, moved or abandoned game says so in orange (never red: red is live).
    private var warns: Bool {
        guard item.status != .canceled else { return false }
        return item.status == .postponed || item.result?.kind == .suspended || item.result?.kind == .abandoned
    }

    var body: some View {
        Group {
            switch event.state {
            case .live:
                LiveStatus(event)
            case .final:
                VStack(alignment: .trailing, spacing: 1) {
                    Text(finalText)
                        .font(.system(size: 11, weight: warns ? .medium : .regular))
                        .foregroundStyle(warns ? AnyShapeStyle(Color.orange) : AnyShapeStyle(.secondary))
                    if let line = item.result?.secondLine {
                        Text(line)
                            .font(.system(size: 10).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            case .scheduled:
                scheduled
            }
        }
        .multilineTextAlignment(.trailing)
        .help(item.networks.isEmpty ? "" : item.networks.joined(separator: ", "))
    }

    /// The width a group's status column needs (`StatusColumn`): each row's
    /// lines in their own fonts, the live dot included.
    static func width(for items: [ScheduleItem], events: [Event], networks: Int, now: Date = .now) -> CGFloat {
        RowStatus.clamp(zip(items, events).reduce(0) { widest, pair in
            max(widest, ScheduleStatusColumn(item: pair.0, event: pair.1, networks: networks).natural(now: now))
        })
    }

    /// This row's status lines, measured.
    private func natural(now: Date) -> CGFloat {
        switch event.state {
        case .live:
            return RowStatus.width(of: event, now: now)
        case .final:
            return max(RowStatus.measure(finalText), item.result?.secondLine.map { RowStatus.measure($0, second: true) } ?? 0)
        case .scheduled:
            switch item.start {
            case .tba, .tbc: return RowStatus.measure("TBA")
            case let .provisional(date, _): return max(RowStatus.measure(RowStatus.time(date)), RowStatus.measure("Provisional", second: true))
            case let .exact(date):
                if RowStatus.delayed(event, now: now) { return max(RowStatus.measure("Delayed"), RowStatus.measure(RowStatus.time(date), second: true)) }
                if date < now { return RowStatus.measure(item.isField ? "Time TBA" : "Starting soon") }
                if date.timeIntervalSince(now) < 3 * 3600, let countdown = Countdown.text(to: date, from: now) {
                    return max(RowStatus.measure(countdown), RowStatus.measure(RowStatus.time(date), second: true))
                }
                return max(RowStatus.measure(RowStatus.time(date)), secondLine.map { RowStatus.measure($0, second: true) } ?? 0)
            }
        }
    }

    private var finalText: String {
        if let label = item.result?.label, !label.isEmpty { return label }
        switch item.status {
        case .postponed: return "Postponed"
        case .canceled: return "Canceled"
        default: return event.detail ?? "Final"
        }
    }

    private var quiet: HierarchicalShapeStyle { contrast == .increased ? .secondary : .tertiary }

    @ViewBuilder
    private var scheduled: some View {
        switch item.start {
        case .tba, .tbc:
            Text(item.start == .tba ? "TBA" : "TBC")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .help(item.start == .tba
                      ? (item.league == "college-football"
                         ? "Kickoff time not announced yet. College times are usually set 6 to 12 days ahead."
                         : "Start time not announced yet")
                      : "Date and time to be confirmed")
        case let .provisional(date, reason):
            VStack(alignment: .trailing, spacing: 1) {
                Text(date.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .foregroundStyle(quiet)
                Text("Provisional")
                    .font(.system(size: 10))
                    .foregroundStyle(quiet)
            }
            .help(reason == .tvPicks ? "Kickoff times are confirmed about six weeks ahead, when TV picks are made."
                  : "Order of play not set yet.")
        case let .exact(date):
            if date.timeIntervalSinceNow < 24 * 3600 {
                TimelineView(.periodic(from: .now, by: 30)) { context in timed(date, now: context.date) }
            } else {
                timed(date, now: .now)
            }
        }
    }

    @ViewBuilder
    private func timed(_ date: Date, now: Date) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            if RowStatus.delayed(event, now: now) {
                Text("Delayed")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.orange)
                Text(RowStatus.time(date))
                    .font(.system(size: 10).monospacedDigit())
                    .foregroundStyle(.secondary)
            } else if date < now {
                Text(item.isField ? "Time TBA" : "Starting soon")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
            } else if date.timeIntervalSince(now) < 3 * 3600, let countdown = Countdown.text(to: date, from: now) {
                Text(countdown)
                    .font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Color.accentColor)
                Text(date.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 10).monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                Text(date.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                if let line = secondLine {
                    Text(line)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Headers and lines

/// "Today · Sunday, Oct 25": a day's heading in the agenda.
struct ScheduleDayHeader: View {
    let day: DayKey
    let today: DayKey

    var body: some View {
        ScheduleDayTitle(day: day, today: today)
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 16)
            .padding(.bottom, 2)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
    }
}

/// "Today  Monday, Oct 26", or just the date further out.
struct ScheduleDayTitle: View {
    let day: DayKey
    let today: DayKey

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let relative = day.relative(to: today) {
                Text(relative)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(day == today ? Color.accentColor : .primary)
                Text(day.longLabel)
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
            } else {
                Text(day.longLabel)
                    .font(.system(size: 13, weight: .semibold))
            }
        }
        .lineLimit(1)
    }
}

/// A day that folds, the scores list's section header in the agenda: the
/// whole header toggles. Folded, the count joins the title ("14 games") and
/// a line of the day's crests and leagues ("NFL, NBA, EPL") stands in for its rows.
struct ScheduleFoldingDayHeader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let day: AgendaDay
    let today: DayKey
    let open: Bool
    /// "14 games".
    let count: String
    /// "NFL, NBA, EPL" on the calendar; nil on a league's own page.
    let leagues: String?
    /// Just folded: the summary waits for the crests to land.
    let justToggled: Bool
    let maxLogos: Int
    let toggle: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: toggle) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    ScheduleDayTitle(day: day.day, today: today)
                    Spacer(minLength: 6)
                    if !open {
                        Text(count)
                            .font(.system(size: 11).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .fixedSize()
                            .transition(.asymmetric(insertion: .opacity.animation(Motion.reveal), removal: .opacity.animation(Motion.exit)))
                    }
                    // Always visible so folding is discoverable; brighter on hover.
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(hovering ? .secondary : .tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .animation(reduceMotion ? nil : Motion.quick, value: open)
                }
                if !open {
                    // Crests carry the motion themselves, so the line just fades.
                    ScheduleDayPreview(day: day, summary: leagues ?? "", maxLogos: maxLogos, revealSummary: justToggled)
                        .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 14)
            .padding(.bottom, open ? 2 : 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .contextMenu {
            Button(open ? "Collapse" : "Expand", systemImage: open ? "chevron.right" : "chevron.down", action: toggle)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(day.day.relative(to: today).map { "\($0), " } ?? "")\(day.day.longLabel), \(([count] + (leagues.map { [$0] } ?? [])).joined(separator: ", ")), \(open ? "expanded" : "collapsed")")
        .accessibilityAddTraits([.isHeader, .isButton])
        .help(open ? "Hide \(day.day.mediumLabel)" : "Show \(day.day.mediumLabel)")
    }
}

/// A folded day's line: the teams playing (crests, in on-screen order) and
/// its leagues. Crests share identities with the rows' (`logoMatchID`), so
/// unfolding glides each into its row. No "N more" chip: the title line
/// already says how many games there are.
struct ScheduleDayPreview: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let day: AgendaDay
    let summary: String
    var maxLogos = 7
    var revealSummary = false
    @State private var revealed = false

    static func sectionID(_ day: DayKey) -> String { "day-\(day)" }

    /// The first `limit` crests of the day, by team, in row order.
    static func crests(_ day: AgendaDay) -> [Competitor] {
        var seen = Set<String>()
        return day.items.flatMap { $0.event().competitors }.filter { c in
            guard c.logo != nil else { return false }
            return seen.insert(c.id ?? c.name).inserted
        }
    }

    /// For each row, the crests it takes from the preview (first appearances only).
    static func handOffs(_ day: AgendaDay, limit: Int) -> [String: Set<String>] {
        var seen = Set<String>()
        var result: [String: Set<String>] = [:]
        for item in day.items {
            for competitor in item.event().competitors where competitor.logo != nil {
                guard seen.count < limit else { return result }
                let id = logoMatchID(section: sectionID(day.day), competitor)
                if seen.insert(id).inserted { result[item.id, default: []].insert(id) }
            }
        }
        return result
    }

    private var summaryShown: Bool { !revealSummary || revealed }

    var body: some View {
        let teams = Self.crests(day)
        HStack(spacing: 10) {
            if !teams.isEmpty {
                HStack(spacing: 5) {
                    ForEach(teams.prefix(maxLogos), id: \.key) { team in
                        // A touch smaller than in the rows (16pt), so unfolding
                        // reads as the crests settling into place.
                        LogoView(url: team.logo, darkURL: team.darkLogo, size: 14)
                            .matchedLogo(logoMatchID(section: Self.sectionID(day.day), team))
                            .help(team.name)
                    }
                }
                // Never squeezed: the summary gives way first.
                .fixedSize()
            }
            Spacer(minLength: 6)
            if !summary.isEmpty {
                Text(summary)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .reveal(summaryShown, reduceMotion: reduceMotion)
            }
        }
        // The crests stay on the line; leagues give way first.
        .frame(minHeight: 16)
        .onAppear {
            guard revealSummary, !revealed else { return }
            // ~ when the crests (0.4s travel) have mostly landed.
            withAnimation(Motion.reveal.delay(reduceMotion ? 0 : 0.22)) { revealed = true }
        }
    }
}

/// A league's label inside a day (All scope).
struct ScheduleGroupLabel: View {
    let title: String
    let symbol: String
    /// The league's own schedule (its season page for climbing and CS2).
    var onOpen: (() -> Void)? = nil
    @State private var hovering = false

    var body: some View {
        if let onOpen {
            Button(action: onOpen) {
                HStack(spacing: 4) {
                    GroupLabel(title: title, symbol: symbol)
                    Image(systemName: "chevron.right")
                        .font(Glyph.link)
                        .foregroundStyle(.tertiary)
                        .opacity(hovering ? 1 : 0)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .help("\(title) schedule")
            .accessibilityLabel("\(title) schedule")
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 8)
            .padding(.bottom, 2)
        } else {
            GroupLabel(title: title, symbol: symbol)
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 8)
                .padding(.bottom, 2)
        }
    }
}

/// A small line in the agenda's voice (byes, "Time TBA", footnotes).
struct ScheduleNote: View {
    let text: String
    var symbol: String? = nil

    var body: some View {
        HStack(spacing: 5) {
            if let symbol { Image(systemName: symbol).font(.system(size: 9.5, weight: .semibold)) }
            Text(text)
        }
        .font(.system(size: 10.5))
        // Information, not decoration: secondary ink.
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 3)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Placeholder rows shaped like the agenda's, so first load doesn't jump.
/// Static: a repeating animation would keep running after the panel closes.
struct ScheduleSkeleton: View {
    var days = 2
    var rows = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<days, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 3).frame(width: 120, height: 9)
                    .padding(.horizontal, Metrics.gutter).padding(.top, 18).padding(.bottom, 8)
                ForEach(0..<rows, id: \.self) { _ in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(0..<2, id: \.self) { _ in
                                HStack(spacing: 8) {
                                    Circle().frame(width: 14, height: 14)
                                    RoundedRectangle(cornerRadius: 3).frame(width: 110, height: 9)
                                }
                            }
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 6) {
                            RoundedRectangle(cornerRadius: 3).frame(width: 48, height: 9)
                            RoundedRectangle(cornerRadius: 3).frame(width: 32, height: 7)
                        }
                    }
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.vertical, 9)
                }
            }
        }
        .foregroundStyle(Color.primary.opacity(0.07))
        .padding(.bottom, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading schedule")
    }
}

// MARK: - Words

/// What VoiceOver (and Copy) says for a row.
enum ScheduleSpeech {
    /// "ARS 2–0 EVE", or the date when there's no score.
    static func result(_ item: ScheduleItem) -> String {
        guard let top = item.top, let bottom = item.bottom, let a = top.score, let b = bottom.score else { return item.day.shortLabel }
        return "\(top.abbreviation) \(a)–\(b) \(bottom.abbreviation)"
    }

    static func row(_ item: ScheduleItem, event: Event) -> String {
        var parts: [String] = []
        if let top = item.top, let bottom = item.bottom {
            let joiner = item.sport == .soccer || item.sport == .esports ? "versus" : "at"
            parts.append("\(top.name) \(joiner) \(bottom.name)")
        } else if let title = item.title {
            parts.append(title)
            if let subtitle = item.subtitle { parts.append(subtitle) }
        }
        switch event.state {
        case .live:
            parts.append("Live")
            if let top = event.competitors.first?.score, let bottom = event.competitors.last?.score { parts.append("\(top) to \(bottom)") }
            parts.append(event.spokenStatus)
        case .final:
            if item.status == .postponed { parts.append("Postponed") } else if item.status == .canceled { parts.append("Canceled") } else {
                if let top = event.competitors.first?.score, let bottom = event.competitors.last?.score { parts.append("\(top) to \(bottom)") }
                parts.append(event.spokenStatus)
                if let result = event.spokenResult { parts.append(result) }
            }
        case .scheduled:
            if RowStatus.delayed(event) { parts.append("Delayed") }
            switch item.start {
            case let .exact(date): parts.append(date.formatted(date: .omitted, time: .shortened))
            case let .provisional(date, _): parts.append("\(date.formatted(date: .omitted, time: .shortened)), provisional")
            case .tba: parts.append("time to be announced")
            case .tbc: parts.append("date and time to be confirmed")
            }
            if let network = item.networks.first { parts.append("on \(network)") }
        }
        if item.ifNecessary { parts.append("if necessary") }
        // A result's own sentence (score, outcome, context, details: the
        // parser's), with its competition outside one and the day it was played.
        if event.state == .final, let spoken = item.result?.spoken, !spoken.isEmpty {
            let day = item.day.displayDate.formatted(.dateTime.weekday(.wide).month(.wide).day())
            return [item.competition.map { "\($0)." }, spoken, "\(day)."].compactMap { $0 }.joined(separator: " ")
        }
        parts += ([item.competition] + item.notes.map(Optional.some)).compactMap { $0 }
        return parts.joined(separator: ", ")
    }
}

/// Hands the current hover to a small piece of a page (a season timeline and
/// its readout), so hovering re-runs that piece, not the page around it.
struct HoverReader<Content: View>: View {
    let state: HighlightState
    @ViewBuilder let content: (String?) -> Content
    var body: some View { content(state.id) }
}

/// Text that arrives with an unfolding day: hidden, then revealed after
/// `delay` (nil: shown as is). The rows do the same themselves.
private struct RevealOnAppear: ViewModifier {
    let delay: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var revealed = false

    func body(content: Content) -> some View {
        content
            .reveal(delay == nil || revealed, reduceMotion: reduceMotion)
            .onAppear {
                guard let delay, !revealed else { return }
                withAnimation((reduceMotion ? Motion.exit : Motion.reveal).delay(reduceMotion ? 0 : delay)) { revealed = true }
            }
    }
}

extension View {
    func revealOnAppear(after delay: Double?) -> some View { modifier(RevealOnAppear(delay: delay)) }
}
