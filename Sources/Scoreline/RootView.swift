import Darwin
import SwiftUI

struct RootView: View {
    @Environment(ScoreStore.self) private var store
    @Environment(PanelSizing.self) private var sizing
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Page: Equatable {
        case scores
        case manage
        case addSports
        case detail(Event)
        /// A league's team picks, opened from settings or from the scores list.
        case league(League, fromScores: Bool)
        /// A league table, opened from a match (back returns to it) or the scores list.
        case standings(League, returnTo: Event?)
        /// A playoff bracket or tournament, opened from a match.
        case bracket(BracketSource, highlight: Set<String>, returnTo: Event?)
        /// A league's polls (college football's Top 25).
        case rankings(League, returnTo: Event?)
        /// What's coming up, or what happened (`mode`): everything, a league, a
        /// team, or the climbing and CS2 calendars.
        case schedule(ScheduleScope, mode: ScheduleMode = .upcoming)
        /// A climbing category's full results, or a CS2 tournament's.
        case eventResults(EventResultsRef)
        /// A team: roster, leaders, stats. Opened from any team the app names.
        case team(Profile.TeamRef)
        /// A person: a player, a CS2 player or a climber.
        case player(Profile.PlayerRef)
    }
    @State private var page: Page = .scores
    /// Whether the pages are built. They stay built for a few minutes after the
    /// panel closes, so reopening is instant (about 2ms, against 60–110ms to
    /// rebuild); after that they're swapped for a placeholder to give the
    /// memory back. Starts false: macOS builds the panel's content at launch,
    /// before it's ever shown, so the real views wait for the first open.
    @State private var panelVisible = false
    /// The teardown waiting out those minutes (cancelled by a reopen).
    @State private var teardown: Task<Void, Never>?
    /// When the current page was entered by a click — its blocks stack in.
    /// Nil for panel opens and keyboard navigation, which stay instant.
    @State private var entrance: StackArrival?
    /// The current page's natural height, kept so a new ceiling can re-fit it.
    @State private var natural: CGFloat?
    /// A shrink waiting out its short delay (a taller fit cancels it).
    @State private var pendingShrink: Task<Void, Never>?
    /// Each page's scroll position, for going back and for reopening.
    @State private var scrollMemory = ScrollMemory()
    /// Moments when resizing should snap rather than animate.
    @State private var openedAt: Date?
    @State private var keyboardNavigatedAt: Date?
    /// Keyboard-initiated changes inside pages (⌘1/⌘2 on Scores) ask for an
    /// instant resize too (W-T1).
    @State private var panelMotion = PanelMotion()
    /// The pages to go back to, most recent last: Back returns to whichever
    /// page opened this one (Schedule → Match → Back lands on the schedule).
    @State private var backStack: [Page] = []
    @Environment(\.scheduleStore) private var injectedSchedule
    private var schedule: ScheduleStore { injectedSchedule ?? .shared }
    /// Opens team, player and match pages from any view below. Its actions are
    /// set once and it holds no observed state, so links add no updates.
    @State private var ownNavigator = ProfileNavigator()
    /// The render harness injects its own to drive round trips.
    @Environment(ProfileNavigator.self) private var injectedNavigator: ProfileNavigator?
    private var navigator: ProfileNavigator { injectedNavigator ?? ownNavigator }

    var body: some View {
        Group {
            if panelVisible {
                pages
            } else {
                Color.clear
            }
        }
        // Top-anchored, the panel grows and shrinks to fit each page on the same
        // critically damped spring as everything else, never past the user's size.
        .modifier(PanelFrame())
        // One width measurement for the whole panel: content adds detail by class.
        .modifier(ResponsiveRoot(initialWidth: sizing.ceiling.width))
        .environment(\.panelResizing, sizing.liveResizing)
        .environment(\.panelOpen, sizing.isOpen)
        .environment(\.celebrationLevel, store.celebrationLevel)
        .environment(panelMotion)
        .onChange(of: sizing.isOpen, initial: true) { _, open in
            // VoiceOver announcements only while the panel shows.
            Announcer.panelOpen = open
        }
        .onChange(of: sizing.isOpen) { _, open in
            teardown?.cancel()
            if open {
                openedAt = .now
                panelVisible = true
                store.refreshIfStale()
            } else {
                entrance = nil
                // Reopening comes back to the same page, scrolled where it was:
                // straight away for a few minutes, rebuilt after that.
                teardown = Task {
                    try? await Task.sleep(for: .seconds(180))
                    guard !Task.isCancelled, !sizing.isOpen else { return }
                    panelVisible = false
                    // Hand the freed view graph back once SwiftUI has released it.
                    try? await Task.sleep(for: .seconds(1))
                    malloc_zone_pressure_relief(nil, 0)
                }
            }
        }
        // The user resized, or the panel moved: re-fit the page under the new ceiling.
        .onChange(of: sizing.maxHeight) { refit() }
        // ⌘, and ⌘R from every page, and the status menu's Settings… (PanelCommands.swift).
        // Settings opens as a step from wherever you are, so Back returns there.
        .panelCommands(settings: { if page != .manage { open(.manage) } },
                       event: { id in if let event = store.event(id: id) { follow(.detail(event)) } })
        // Smoke test (SCORELINE_SMOKE=1): open a match and come back.
        .onReceive(NotificationCenter.default.publisher(for: .scorelineSmokeNavigate)) { note in
            if let back = note.object as? Bool, back { go(.scores) }
            else if let event = store.sections.flatMap(\.events).first(where: { $0.state == .live })
                        ?? store.sections.first?.events.first { go(.detail(event)) }
        }
        #if STUDIO
        // Scoreline Studio (the launch-video build) films any page: open it, or open it deeper (object: [page, true]).
        .onReceive(NotificationCenter.default.publisher(for: .scorelineStudioPage)) { note in
            if let page = note.object as? Page { go(page) } else if let deeper = note.object as? [Page], let page = deeper.last { open(page) }
        }
        #endif
        // A schedule asked for from the game menu (rows and tiles share it).
        .onChange(of: schedule.openRequest) { _, scope in
            guard let scope else { return }
            schedule.openRequest = nil
            open(.schedule(scope))
        }
        .onAppear {
            let navigator = navigator
            navigator.openTeam = { follow(.team($0)) }
            navigator.openPlayer = { follow(.player($0)) }
            navigator.openEvent = { follow(.detail($0)) }
            navigator.goBack = { back() }
        }
    }

    private var pages: some View {
        ZStack(alignment: .top) {
            // Scores stays built under every other page: Back is a fade, not a
            // rebuild (55–70ms), and it's still scrolled where you left it.
            let onScores = page == .scores
            SizedPage(onChange: { fit($0, loading: $1, for: .scores) }) {
                ScoresView(onManage: { open(.manage) }, onSelect: { open(.detail($0)) },
                           onOpenLeague: { open(.league($0, fromScores: true)) },
                           onOpenStandings: { open(.standings($0, returnTo: nil)) },
                           onOpenRankings: { open(.rankings($0, returnTo: nil)) },
                           onOpenSchedule: { open(.schedule($0)) },
                           onOpenResults: { open(.schedule($0, mode: .results)) })
            }
            .environment(\.scrollKey, Page.scores.memoryKey)
            // Never an entrance: it's the page you come back to, as you left it.
            .environment(\.stackArrival, nil)
            // Its clocks and pulses stop while it's covered (or the panel is closed).
            .environment(\.pageLive, onScores && sizing.isOpen)
            .opacity(onScores ? 1 : 0)
            .allowsHitTesting(onScores)
            // Its shortcuts (⌘1, ⌘2, ⌘U) and key handlers go quiet underneath.
            .disabled(!onScores)
            .accessibilityHidden(!onScores)
            // Only the page on top sizes the panel.
            .pageContentInactive(!onScores)
            Group {
                switch page {
                case .scores:
                    EmptyView()
                case .manage:
                    SizedPage(onChange: { fit($0, loading: $1, for: .manage) }) {
                        // ⌘, opens Settings from any page: Back says where it returns to.
                        ManageView(backTitle: backStack.last?.backTitle ?? "Scores", onDone: { back() },
                                   onOpenLeague: { open(.league($0, fromScores: false)) },
                                   onAddSports: { open(.addSports) })
                    }
                    .environment(\.scrollKey, Page.manage.memoryKey)
                    .transition(pageTransition)
                case .addSports:
                    SizedPage(onChange: { fit($0, loading: $1, for: .addSports) }) {
                        AddSportsView { back() }
                    }
                    .environment(\.scrollKey, Page.addSports.memoryKey)
                    .transition(pageTransition)
                case let .league(league, fromScores):
                    SizedPage(onChange: { fit($0, loading: $1, for: .league(league, fromScores: fromScores)) }) {
                        LeagueSettingsView(league: league, backTitle: fromScores ? "Scores" : "Settings",
                                           onOpen: { open(.detail($0)) }, onOpenSchedule: { open(.schedule($0)) },
                                           onOpenResults: { open(.schedule($0, mode: .results)) },
                                           onOpenEvent: { open(.eventResults($0)) }) { back() }
                    }
                    .environment(\.scrollKey, Page.league(league, fromScores: fromScores).memoryKey)
                    .transition(pageTransition)
                case let .detail(event):
                    SizedPage(onChange: { fit($0, loading: $1, for: .detail(event)) }) {
                        DetailView(snapshot: event, onBack: { back() },
                                   onOpenStandings: { open(.standings($0, returnTo: event)) },
                                   onOpenBracket: { open(.bracket($0, highlight: $1, returnTo: event)) },
                                   onOpenRankings: { open(.rankings($0, returnTo: event)) },
                                   backTitle: backStack.last?.backTitle ?? "Scores")
                    }
                    // A different match is a new page: no state carried over.
                    .id(event.id)
                    .environment(\.scrollKey, Page.detail(event).memoryKey)
                    .transition(pageTransition)
                case let .standings(league, returnTo):
                    SizedPage(onChange: { fit($0, loading: $1, for: .standings(league, returnTo: returnTo)) }) {
                        StandingsView(league: league, backTitle: returnTo == nil ? "Scores" : "Match",
                                      focus: Set(returnTo?.competitors.compactMap(\.id) ?? [])) { back() }
                    }
                    .environment(\.scrollKey, Page.standings(league, returnTo: returnTo).memoryKey)
                    .transition(pageTransition)
                case let .rankings(league, returnTo):
                    SizedPage(onChange: { fit($0, loading: $1, for: .rankings(league, returnTo: returnTo)) }) {
                        RankingsView(league: league, backTitle: returnTo == nil ? "Scores" : "Match",
                                     highlight: Set(returnTo?.competitors.compactMap(\.id) ?? [])) { back() }
                    }
                    .environment(\.scrollKey, Page.rankings(league, returnTo: returnTo).memoryKey)
                    .transition(pageTransition)
                case let .bracket(source, highlight, returnTo):
                    SizedPage(onChange: { fit($0, loading: $1, for: .bracket(source, highlight: highlight, returnTo: returnTo)) }) {
                        BracketPage(source: source, backTitle: backStack.last?.backTitle ?? (returnTo == nil ? "Scores" : "Match"),
                                    highlight: highlight) { back() }
                    }
                    .environment(\.scrollKey, Page.bracket(source, highlight: highlight, returnTo: returnTo).memoryKey)
                    .transition(pageTransition)
                case let .schedule(scope, mode):
                    SizedPage(onChange: { fit($0, loading: $1, for: .schedule(scope, mode: mode)) }) {
                        SchedulePage(scope: scope, mode: mode, backTitle: backStack.last?.backTitle ?? "Scores", onBack: { back() },
                                     onOpen: { open(.detail($0)) },
                                     onScope: { replace(with: .schedule($0, mode: mode)) },
                                     onMode: { switchMode(to: .schedule(scope, mode: $0)) },
                                     onOpenBracket: { open(.bracket($0, highlight: $1, returnTo: nil)) },
                                     onOpenResults: { open(.eventResults($0)) },
                                     onDrill: { open(.schedule($0, mode: mode)) })
                    }
                    .environment(\.scrollKey, Page.schedule(scope, mode: mode).memoryKey)
                    .transition(pageTransition)
                case let .eventResults(ref):
                    SizedPage(onChange: { fit($0, loading: $1, for: .eventResults(ref)) }) {
                        EventResultsPage(ref: ref, backTitle: backStack.last?.backTitle ?? "Scores", onBack: { back() },
                                         onOpen: { open(.detail($0)) },
                                         onOpenBracket: { open(.bracket($0, highlight: $1, returnTo: nil)) })
                    }
                    // A different category or tournament is a new page.
                    .id(ref)
                    .environment(\.scrollKey, Page.eventResults(ref).memoryKey)
                    .transition(pageTransition)
                case let .team(ref):
                    SizedPage(onChange: { fit($0, loading: $1, for: .team(ref)) }) {
                        TeamPage(ref: ref, backTitle: backStack.last?.backTitle ?? "Scores",
                                 onOpenSchedule: { open(.schedule($0, mode: $1)) }, onBack: { back() })
                    }
                    .id(ref.id)
                    .environment(\.scrollKey, Page.team(ref).memoryKey)
                    .transition(pageTransition)
                case let .player(ref):
                    SizedPage(onChange: { fit($0, loading: $1, for: .player(ref)) }) {
                        PlayerPage(ref: ref, backTitle: backStack.last?.backTitle ?? "Scores", onBack: { back() })
                    }
                    .id(ref.key)
                    .environment(\.scrollKey, Page.player(ref).memoryKey)
                    .transition(pageTransition)
                }
            }
            // The arriving page's entrance. Set here, not above the stack, so
            // Scores (and a page on its way out) never replays its own.
            .environment(\.stackArrival, entrance)
            .environment(\.pageLive, sizing.isOpen)
        }
        .coordinateSpace(name: StackSpace.name)
        .environment(\.scrollMemory, scrollMemory)
        // Reaches Scores' rows too (their "Go to …" menu items), which sit in the same stack.
        .environment(navigator)
    }

    // MARK: Navigation

    /// Forward to a page; Back will return here. A fresh visit starts at the top.
    private func open(_ destination: Page) {
        backStack.append(page)
        scrollMemory.offsets[destination.memoryKey] = nil
        show(destination)
    }

    /// Back from the current page: to whichever page opened it, or with
    /// nothing to return to, to its parent (Scores at the top). Every Back
    /// button calls this, and so should Esc and ⌘[ at the root.
    /// Back keeps the destination's place and forgets the page left behind.
    func back() {
        guard let previous = backStack.popLast() ?? page.parent else { return }
        scrollMemory.offsets[page.memoryKey] = nil
        show(previous)
    }

    /// A link to a team, player or match (the navigator). Following a link to
    /// the page you're on does nothing (a team's own row in its table), and to
    /// the page Back would show is Back (Team → Player → that Team), so the
    /// stack never doubles back on itself.
    private func follow(_ destination: Page) {
        if destination == page { return }
        if destination == backStack.last { return back() }
        open(destination)
    }

    /// The same page with a new scope (a schedule's chips and title menu): no
    /// new step for Back.
    private func replace(with destination: Page) {
        scrollMemory.offsets[destination.memoryKey] = nil
        show(destination)
    }

    /// A schedule turned the other way in time (Upcoming | Results, ⌘1 / ⌘2):
    /// the same place in the stack, each mode keeping its own scroll. ⌘1 / ⌘2
    /// are instant, like every key action. A click on the control crossfades
    /// the content in place (no slide: it's the same place, facing the other
    /// way) and the panel eases to the new height, as on any page change.
    private func switchMode(to destination: Page) {
        guard destination != page else { return }
        if NSApp.currentEvent?.type == .keyDown {
            entrance = nil
            keyboardNavigatedAt = .now
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) { page = destination }
        } else {
            entrance = StackArrival(style: .fade)
            withAnimation(Motion.exit) { page = destination }
        }
    }

    /// Straight to a page, forgetting the way back (the smoke test).
    private func go(_ destination: Page) {
        backStack = []
        // Back keeps the page's place (and forgets the deeper one left behind);
        // a fresh visit starts at the top.
        if destination.depth < page.depth {
            scrollMemory.offsets[page.memoryKey] = nil
        } else {
            scrollMemory.offsets[destination.memoryKey] = nil
        }
        show(destination)
    }

    /// Clicks slide pages; keyboard navigation (Esc, ⌘[, Return, ⌘,) is
    /// instant — keyboard actions are repeated constantly and motion makes them
    /// feel slow.
    private func show(_ destination: Page) {
        if NSApp.currentEvent?.type == .keyDown {
            entrance = nil
            keyboardNavigatedAt = .now
            page = destination
        } else {
            // The new page's blocks stack in (see `stackIn()`); the old one fades out fast.
            entrance = StackArrival(style: .stack)
            withAnimation(Motion.exit) { page = destination }
        }
    }

    /// Fits the panel to the current page's natural height, within the
    /// screen-safe limits. A page that's still loading never shrinks the panel
    /// (it holds its frame, then resizes once, when content lands). Opening
    /// the panel, keyboard navigation and Reduce Motion resize instantly.
    private func fit(_ natural: CGFloat, loading: Bool, for source: Page) {
        guard source == page, panelVisible else { return }
        if Self.smoke { print(String(format: "fit natural %.0f loading %@ page %@", natural, loading ? "y" : "n", page.memoryKey)) }
        self.natural = natural
        // While the user drags an edge, the window drives.
        guard !sizing.liveResizing else { return }
        let target = min(max(natural, Metrics.minPanelHeight), sizing.maxHeight)
        // Any newer height supersedes a shrink that's still waiting, even one
        // that turns out to need no change.
        pendingShrink?.cancel()
        pendingShrink = nil
        guard abs(target - sizing.height) >= 2 else { return }
        if loading && target < sizing.height { return }
        let now = Date()
        let instant = reduceMotion
            || openedAt.map { now.timeIntervalSince($0) < 0.25 } == true
            || keyboardNavigatedAt.map { now.timeIntervalSince($0) < 0.3 } == true
            || panelMotion.snapping
        // Growing happens at once. Shrinking waits a beat: a page that's just
        // landed often reports a stale height for a frame before its real one,
        // and acting on it would dip the panel and bounce it back.
        if target < sizing.height, !instant {
            pendingShrink = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(90))
                guard !Task.isCancelled else { return }
                sizing.fit(target, animated: true)
            }
        } else {
            sizing.fit(target, animated: !instant)
        }
    }

    private static let smoke = ProcessInfo.processInfo.environment["SCORELINE_SMOKE"] != nil

    private func refit() {
        if let natural { fit(natural, loading: false, for: page) }
    }

    /// The outgoing page leaves quickly; the incoming one arrives in place and
    /// its contents animate themselves, top to bottom.
    private let pageTransition = AnyTransition.asymmetric(insertion: .identity, removal: .opacity)
}

extension RootView.Page {
    /// How many steps from the scores list: going to a shallower page is "back".
    var depth: Int {
        switch self {
        case .scores: 0
        case .manage, .detail: 1
        case .addSports: 2
        case let .league(_, fromScores): fromScores ? 1 : 2
        case let .standings(_, returnTo), let .rankings(_, returnTo): returnTo == nil ? 1 : 2
        case let .bracket(_, _, returnTo): returnTo == nil ? 1 : 2
        case .schedule: 1
        case .eventResults, .team, .player: 2
        }
    }

    /// Where Back goes when nothing opened this page (after a jump): the
    /// classic one-level rule. Nil on Scores.
    var parent: RootView.Page? {
        switch self {
        case .scores: nil
        case .manage, .detail, .schedule: .scores
        case .addSports: .manage
        case let .league(_, fromScores): fromScores ? .scores : .manage
        case let .standings(_, returnTo), let .rankings(_, returnTo): returnTo.map { .detail($0) } ?? .scores
        case let .bracket(_, _, returnTo): returnTo.map { .detail($0) } ?? .scores
        case .eventResults(.climbing): .schedule(.climbing, mode: .results)
        case .eventResults(.tournament): .schedule(.tournaments, mode: .results)
        case .team, .player: .scores
        }
    }

    /// What a Back button says on a page this one opened.
    var backTitle: String {
        switch self {
        case .scores: "Scores"
        case .manage, .addSports: "Settings"
        case let .league(league, _): league.shortName
        case .detail: "Match"
        case .standings: "Table"
        case .rankings: "Top 25"
        case .bracket: "Bracket"
        case .schedule(_, .results): "Results"
        case .schedule(.climbing, _): "Season"
        case .schedule(.tournaments, _): "Tournaments"
        case .schedule: "Schedule"
        case let .eventResults(ref): ref.backTitle
        case let .team(ref): ref.name
        case let .player(ref): ref.name
        }
    }

    /// The page's name in the scroll memory.
    var memoryKey: String {
        switch self {
        case .scores: "scores"
        case .manage: "manage"
        case .addSports: "addSports"
        case let .league(league, _): "league:\(league.id)"
        case let .detail(event): "detail:\(event.id)"
        case let .standings(league, _): "standings:\(league.id)"
        case let .rankings(league, _): "rankings:\(league.id)"
        case let .bracket(source, _, _): "bracket:\(source.title)"
        // Upcoming keeps its old key, so remembered scroll positions hold.
        case let .schedule(scope, mode): mode == .upcoming ? "schedule:\(scope.memoryKey)" : "schedule:\(scope.memoryKey):results"
        case let .eventResults(ref): ref.memoryKey
        case let .team(ref): ref.memoryKey
        case let .player(ref): ref.memoryKey
        }
    }
}

extension Notification.Name {
    /// Smoke test only: open a match (object nil) or go back (object true).
    static let scorelineSmokeNavigate = Notification.Name("ScorelineSmokeNavigate")
    #if STUDIO
    /// Scoreline Studio only: go to the page in the object.
    static let scorelineStudioPage = Notification.Name("ScorelineStudioPage")
    #endif
}
