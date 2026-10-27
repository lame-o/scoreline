import AppKit
import SwiftUI

struct EventRow: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Flashes and pulses run only while the list is on screen.
    @Environment(\.pageLive) private var pageLive
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    let event: Event
    /// Hovered, or picked with the arrow keys.
    let highlighted: Bool
    /// The highlight was moved by the arrow keys (it then wears the accent).
    var keyboard = false
    let onHover: (Bool) -> Void
    let onSelect: (Event) -> Void
    /// Crests that travel from the collapsed preview into this row.
    var logoMatches: Set<String> = []
    /// Set when the row appears because its section was just expanded: the
    /// text reveals after this delay (staggered per row) while crests travel in.
    var revealDelay: Double? = nil
    /// The room the row has. Wider rows show more: team records, then a
    /// detail lane between score and status (see `RowDetail`).
    var width: WidthClass = .compact
    @State private var flashing = false
    /// The latest flash: an older one's decay never cuts a newer one short.
    @State private var flashToken = 0
    /// Who scored in the change being flashed (competitor keys): their dot
    /// shows for exactly as long as the flash.
    @State private var scorers: Set<String> = []
    @State private var revealed = false

    private var textShown: Bool { revealDelay == nil || revealed }

    private var pinned: Bool { store.pinnedID == event.id }

    private var detail: RowDetail { .of(width) }
    private var lane: Bool { detail == .lane }
    /// Wider rows keep the 340pt team block instead of stretching it.
    private var fixedBlock: Bool { detail >= .records }

    /// Soccer records read wins–draws–losses; everyone else's wins–losses(–ties).
    private var soccer: Bool { event.sport == .soccer }

    var body: some View {
        Button { onSelect(event) } label: {
            HStack(alignment: .center, spacing: 12) {
                RowTeams(event: event, logoMatches: logoMatches, textShown: textShown, records: detail >= .records,
                         lane: lane, soccer: soccer, scorers: scorers, flashing: flashing)
                    // Wide rows keep the team block at its 340pt width: the score
                    // stays put, scores form one column, lanes start on one edge.
                    .frame(width: fixedBlock ? Metrics.teamBlockWidth : nil, alignment: .leading)
                    .frame(maxWidth: fixedBlock ? nil : .infinity, alignment: .leading)
                if lane {
                    DetailLane(event: event)
                        .reveal(textShown, reduceMotion: reduceMotion)
                        .widthDetail()
                } else if fixedBlock {
                    Spacer(minLength: 0)
                }
                StatusView(event: event, pinned: pinned)
                    // The section's one status width: every score in it sits in one column.
                    .statusColumn()
                    .reveal(textShown, reduceMotion: reduceMotion)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            // In the two-up grid each cell takes its row's height, so
            // neighbouring highlights line up and team lines align across.
            .frame(maxHeight: .infinity, alignment: .top)
            .contentShape(Rectangle())
            .background(
                // A goal/run/round lands: a soft red wash that fades on its own.
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.red.opacity(flashing ? 0.13 : 0))
            )
        }
        .buttonStyle(ListRowStyle(hovering: highlighted, inset: 0, keyboard: keyboard))
        .padding(.horizontal, 6)
        .stackIn()
        .onHover { inside in
            onHover(inside)
        }
        .contextMenu { EventContextMenu(event: event) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isButton)
        // The merged element keeps the row's press: VoiceOver opens the game.
        .accessibilityAction { onSelect(event) }
        .accessibilityAction(named: pinned ? "Remove from Menu Bar" : "Show in Menu Bar") { store.togglePin(event) }
        .accessibilityActions {
            ForEach(RowActions.actions(event, store: store, following: store.isFollowing, navigator: navigator)) { action in
                Button(action.name, action: action.perform)
            }
        }
        .onAppear {
            guard let delay = revealDelay, !revealed else { return }
            withAnimation((reduceMotion ? Motion.exit : Motion.reveal).delay(reduceMotion ? 0 : delay)) { revealed = true }
        }
        // The row's own event, not the store's change log: reading
        // `store.scoreChanges` here would redraw every row whenever any score
        // anywhere moved. Same rule as `ScoreStore.detectChanges`: a live
        // score that changed between two live readings.
        .onChange(of: event) { old, new in
            guard old.state == .live, new.state == .live,
                  old.competitors.map(\.score) != new.competitors.map(\.score) else { return }
            // Nobody sees a flash under another page or with the panel closed.
            guard pageLive else { return }
            scorers = ScoreChange.scorers(from: old, to: new)
            flashToken += 1
            let mine = flashToken
            Task { await flash(mine) }
        }
    }

    private func flash(_ token: Int) async {
        withAnimation(Motion.fade) { flashing = true }
        try? await Task.sleep(for: .seconds(1.6))
        // A newer score is flashing now: its own decay will end it.
        guard token == flashToken else { return }
        // Deliberately slow: an ambient "this just changed" highlight that
        // decays on its own, not a response to the user.
        withAnimation(reduceMotion ? Motion.fade : Motion.decay) { flashing = false }
    }

    /// What VoiceOver reads: the game in words ("Arsenal 2, Chelsea 1, 67th
    /// minute"), what the row's marks say (pinned, following, live on
    /// YouTube, a co-stream), then the live situation and the caption, and
    /// the records a wider row shows.
    private var accessibilityText: String {
        var parts = [event.spokenSummary]
        parts += RowSpeech.marks(event, store: store, pinned: pinned)
        if event.state == .live, let line = event.liveLine, !line.isEmpty { parts.append(line) }
        if let caption = event.caption, !caption.isEmpty { parts.append(caption) }
        if detail >= .records {
            for team in event.competitors {
                if let record = team.record { parts.append("\(team.name) \(RowText.spokenRecord(record, soccer: soccer))") }
            }
        }
        return parts.joined(separator: ", ")
    }
}

/// A row redraws only when what it shows changes, not whenever the list does
/// (hovering another row, expanding another section). Closures can't be
/// compared and don't change what's drawn.
extension EventRow: @MainActor Equatable {
    static func == (a: EventRow, b: EventRow) -> Bool {
        a.event == b.event && a.highlighted == b.highlighted && a.keyboard == b.keyboard && a.logoMatches == b.logoMatches
            && a.revealDelay == b.revealDelay && a.width == b.width
    }
}

/// The words a row's or tile's marks stand for, and its VoiceOver actions,
/// shared so rows and tiles say the same thing.
@MainActor
enum RowSpeech {
    /// "In menu bar", "Following Arsenal", "Live on YouTube", "ohnePixel is co-streaming".
    static func marks(_ event: Event, store: ScoreStore, pinned: Bool) -> [String] {
        var marks: [String] = []
        if pinned { marks.append("In menu bar") }
        for team in event.competitors where store.isFollowing(team) { marks.append("Following \(team.name)") }
        // Each read only where it can apply, so other rows don't depend on it.
        if store.broadcast(for: event)?.isLive == true { marks.append("Live on YouTube") }
        if event.sport == .esports, store.coStreamingIDs.contains(event.id) { marks.append("\(store.coStreamerName) is co-streaming") }
        return marks
    }
}

/// A game's VoiceOver actions beyond opening it, in the context menu's words:
/// follow or unfollow each team, and go to each team's page.
struct RowActions {
    struct Action: Identifiable {
        let id: String
        let name: String
        let perform: () -> Void
    }

    /// Reads nothing from the store while building (only when an action is
    /// performed), so a row or tile gains no dependency for its actions.
    @MainActor
    static func actions(_ event: Event, store: ScoreStore, following: (Competitor) -> Bool,
                        navigator: ProfileNavigator?) -> [Action] {
        let teams = event.competitors.filter { $0.id != nil }
        var actions = teams.map { team in
            Action(id: "follow-\(team.key)", name: following(team) ? "Unfollow \(team.name)" : "Follow \(team.name)") {
                store.toggleFollow(team)
            }
        }
        guard let navigator else { return actions }
        var pathLeague: String?
        if case let .espn(path, _, _)? = event.ref { pathLeague = Profile.TeamRef.league(forPath: path) }
        for team in teams where event.sport == .soccer || Profile.TeamRef(team, league: pathLeague).isSupported {
            actions.append(Action(id: "page-\(team.key)", name: "Go to \(team.name)") {
                // A soccer team's page needs its domestic league: the board knows it.
                let page = Profile.TeamRef(team, league: store.leagueByEvent[event.id] ?? pathLeague)
                if page.isSupported { navigator.open(page) }
            })
        }
        return actions
    }
}

/// The team block: two competitor lines (or a field event's title and
/// summary) and, without a lane, the context line under them.
private struct RowTeams: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let event: Event
    let logoMatches: Set<String>
    let textShown: Bool
    let records: Bool
    let lane: Bool
    let soccer: Bool
    let scorers: Set<String>
    let flashing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            switch event.content {
            case let .match(top, bottom):
                line(top)
                line(bottom)
            case let .field(title, summary):
                Group {
                    Text(title)
                        .font(.system(size: 13, weight: .medium))
                    // With a lane, the summary moves into it.
                    if !summary.isEmpty && !lane {
                        Text(summary)
                            .font(.system(size: 11.5))
                            .foregroundStyle(.secondary)
                    }
                }
                .reveal(textShown, reduceMotion: reduceMotion)
            }
            if !lane { contextLine }
        }
        .lineLimit(1)
    }

    private func line(_ c: Competitor) -> some View {
        CompetitorLine(competitor: c, dimmed: event.stepsBack(c), matchID: matchID(c), textShown: textShown,
                       hasBall: event.state == .live && event.possession != nil && event.possession == c.id,
                       record: records ? c.record : nil, soccer: soccer, live: event.state == .live,
                       final: event.state == .final && !RowText.unplayed(event), scored: scorers.contains(c.key), lit: flashing)
    }

    /// The line under the teams: live, the situation takes the caption's
    /// place and changes with each play.
    @ViewBuilder
    private var contextLine: some View {
        if let line = RowText.contextLine(event) {
            Text(line.text)
                .font(.system(size: 10.5).monospacedDigit())
                // Information, not decoration: secondary ink either way.
                .foregroundStyle(.secondary)
                .contentTransition(.opacity)
                .animation(reduceMotion ? nil : Motion.fade, value: line.text)
                .reveal(textShown, reduceMotion: reduceMotion)
                // It moves into the lane as the row widens, and back.
                .widthDetail(.vertical)
        }
    }

    private func matchID(_ competitor: Competitor) -> String? {
        logoMatches.first { $0.hasSuffix("|\(competitor.id ?? competitor.name)") }
    }
}

private struct CompetitorLine: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let competitor: Competitor
    let dimmed: Bool
    var matchID: String?
    var textShown = true
    /// Live football: this team has the ball.
    var hasBall = false
    /// Season record, shown beside the name on wider rows when it fits.
    var record: String?
    var soccer = false
    /// The game is live: only then can the score change.
    var live = false
    /// A played final: a missing score shows as "–", never as nothing (it
    /// would read like a game not yet played).
    var final = false
    /// This team's number just rose, and the row flash is on: a 4pt red dot
    /// before the score (colour, so the same with Reduce Motion).
    var scored = false
    var lit = false

    var body: some View {
        HStack(spacing: 8) {
            // The crest stays fully opaque so it can travel in from the
            // collapsed preview; only the text reveals around it.
            LogoView(url: competitor.logo, darkURL: competitor.darkLogo)
                .matchedLogo(matchID)
            HStack(spacing: 8) {
                identity
                if let record = shownRecord {
                    Text(record)
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .help(soccer ? "Wins, draws and losses this season" : "Season record")
                        // Widening reveals it from the edge being pulled.
                        .widthDetail()
                }
                Spacer(minLength: 8)
                score
            }
            .reveal(textShown, reduceMotion: reduceMotion)
        }
        .foregroundStyle(dimmed ? .secondary : .primary)
    }

    @ViewBuilder
    private var score: some View {
        if let score = competitor.score {
            let number = Text(score)
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .contentTransition(.numericText(value: Double(score) ?? 0))
                .animation(reduceMotion ? nil : Motion.quick, value: score)
            if live {
                // An overlay, so the row's layout never moves for it. It
                // fades in and out on the flash's own transactions. Only
                // live scores change, so only they carry it.
                number.overlay(alignment: .leading) {
                    if scored {
                        Circle().fill(.red)
                            .frame(width: 4, height: 4)
                            .offset(x: -7)
                            .opacity(lit ? 1 : 0)
                            .accessibilityHidden(true)
                    }
                }
            } else {
                number
            }
        } else if final {
            Text("–").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
        }
    }

    /// The record, when it fits beside the name (see `RecordFit`).
    private var shownRecord: String? {
        guard let record else { return nil }
        let marks = (hasBall ? 1 : 0) + (store.isFollowing(competitor) ? 1 : 0)
        let shown = RowText.record(record)
        return RecordFit.fits(name: competitor.name, bold: false, rank: competitor.rank, marks: marks,
                              record: shown, score: competitor.score) ? shown : nil
    }

    /// Rank, name, and the ball and follow marks that belong to the name. A
    /// finished game's loser steps back (dimmed); the winner keeps its weight,
    /// as in tiles, the hero and the docked bar.
    @ViewBuilder
    private var identity: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            // College poll rank, small and quiet before the name.
            if let rank = competitor.rank {
                Text("\(rank)")
                    .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .help("No. \(rank) in the AP Top 25")
            }
            Text(competitor.name)
                .font(.system(size: 13))
        }
        HStack(spacing: 8) {
            // The ball changing hands leaves one name and arrives at the other.
            if hasBall { PossessionGlyph() }
            if store.isFollowing(competitor) {
                Image(systemName: "star.fill")
                    .font(.system(size: 7.5))
                    .foregroundStyle(.yellow)
                    .help("Following")
                    .accessibilityHidden(true)
            }
        }
        .animation(reduceMotion ? Motion.fade : Motion.quick, value: hasBall)
    }
}

/// The detail lane of a wide row: the live situation (or a field event's
/// summary) over the game's context, one line each, between the teams and
/// the status. With one line it centres against the teams.
private struct DetailLane: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let event: Event

    private var isField: Bool {
        if case .field = event.content { return true }
        return false
    }

    var body: some View {
        let lines = RowText.lane(event, broadcast: event.broadcast, venue: event.venue)
        VStack(alignment: .leading, spacing: 3) {
            if let primary = lines.primary {
                Text(primary)
                    .font(isField ? .system(size: 11.5) : .system(size: 10.5).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .contentTransition(.opacity)
                    .animation(reduceMotion ? nil : Motion.fade, value: primary)
            }
            if let secondary = lines.secondary {
                Text(secondary)
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
                    .widthDetail(.vertical)
            }
        }
        .lineLimit(1)
        // Breathing room after the score column, so the lane reads as its own column.
        .padding(.leading, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .help([lines.primary, lines.secondary].compactMap { $0 }.joined(separator: "\n"))
    }
}

private struct StatusView: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The scores can't be refreshed: live dots hold still (the data is old).
    @Environment(\.listStale) private var stale
    let event: Event
    let pinned: Bool

    var body: some View {
        // Read here rather than in the row, so a co-stream change redraws
        // only this corner of each row.
        let coStreaming = store.coStreamingIDs.contains(event.id)
        HStack(spacing: 5) {
            if coStreaming {
                CoStreamIcon(size: 13)
                    .help("\(store.coStreamerName) is co-streaming")
                    .transition(Motion.chip(reduceMotion: reduceMotion))
            }
            if let broadcast = store.broadcast(for: event), broadcast.isLive {
                Image(systemName: "play.rectangle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .help("Streaming on YouTube")
            }
            if pinned {
                Image(systemName: "pin.fill")
                    .font(.system(size: 8.5))
                    .foregroundStyle(.tertiary)
                    .help("Shown in menu bar")
            }
            status
        }
    }

    @ViewBuilder
    private var status: some View {
        switch event.state {
        case .live:
            LiveStatus(event, animated: !stale)
        case .scheduled:
            TimelineView(.periodic(from: Date(timeIntervalSinceReferenceDate: 0), by: 30)) { context in
                ScheduledStatus(event: event, now: AppClock.time(at: context.date))
            }
        case .final:
            Text(event.detail ?? "Final")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }
}

/// A scheduled game's status: the time (and its day), a countdown within
/// three hours, "Delayed" in orange once a delayed game is past its start,
/// "Starting soon" for one that's simply late.
private struct ScheduledStatus: View {
    let event: Event
    let now: Date

    var body: some View {
        let soon = event.start.timeIntervalSince(now) < 3 * 3600
        VStack(alignment: .trailing, spacing: 1) {
            if RowStatus.delayed(event, now: now) {
                Text("Delayed")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.orange)
                Text(RowStatus.time(event.start))
                    .font(.system(size: 10).monospacedDigit())
                    .foregroundStyle(.secondary)
            } else if event.start < now {
                // Past its listed start but not underway: a late start, or a
                // round of a multi-day event without a published time.
                Text(event.competitors.isEmpty ? "Time TBA" : "Starting soon")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                    .help(event.competitors.isEmpty ? "Start time not announced yet"
                          : "Scheduled for \(RowStatus.time(event.start))")
            } else if case let .climbing(_, category, _, _, _, _)? = event.ref, category.isEmpty {
                // A whole competition ahead (the off-season's next opener): its
                // first day, not a midnight placeholder time.
                Text(When.day(event.start, now: now) ?? "Today")
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                Text("Starts")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            } else if soon, let countdown = Countdown.text(to: event.start, from: now) {
                // Within a few hours a countdown reads better than a clock time.
                Text(countdown)
                    .font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Color.accentColor)
                Text(RowStatus.time(event.start))
                    .font(.system(size: 10).monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                Text(RowStatus.time(event.start))
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                if let day = When.day(event.start, now: now) {
                    Text(day)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Stale

private struct ListStaleKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Scores can't be refreshed (every league failing): live dots on rows
    /// and tiles hold still, so a pulse never vouches for old data.
    var listStale: Bool {
        get { self[ListStaleKey.self] }
        set { self[ListStaleKey.self] = newValue }
    }
}
