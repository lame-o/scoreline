import Darwin
import SwiftUI

// MARK: - Scores

struct ScoresView: View {
    @Environment(ScoreStore.self) private var store
    let onManage: () -> Void
    let onSelect: (Event) -> Void
    let onOpenLeague: (League) -> Void
    let onOpenStandings: (League) -> Void
    var onOpenRankings: (League) -> Void = { _ in }
    /// Schedules: everything (⌘U), a league (section menu, footnotes), Up Next's link.
    var onOpenSchedule: (ScheduleScope) -> Void = { _ in }
    /// A league's results (the section menu's Results).
    var onOpenResults: (ScheduleScope) -> Void = { _ in }
    /// The hovered or arrow-keyed game. A reference, so changing it updates
    /// only the rows and tiles whose highlight flips (HighlightGate), not this page.
    @State private var highlight = HighlightState()
    private var highlightedID: String? {
        get { highlight.id }
        nonmutating set { highlight.id = newValue }
    }
    @FocusState private var focused: Bool
    @Namespace private var logoSpace
    /// The section that was just expanded or collapsed. Its text staggers in;
    /// ordinary panel opens don't animate (they happen dozens of times a day).
    @State private var justToggled: String?
    /// The section whose crests are linked to its collapsed preview, only
    /// while it's being toggled: a matched-geometry link is recomputed on every
    /// frame of every animation, so idle crests don't carry one.
    @State private var linking: String?
    /// The latest toggle: when it happened, and a generation number so only
    /// the latest toggle's cleanup runs.
    @State private var lastToggle = Date.distantPast
    @State private var toggleGeneration = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// One column, or a two-up grid of compact rows from 680pt.
    @Environment(\.panelLayout) private var layout

    /// Landing views (List | Tiles). The page's own entrance, and one for a
    /// click on the switcher: the new view's blocks stack in.
    @Environment(\.stackArrival) private var pageArrival
    @State private var switchArrival: StackArrival?
    /// The view just left, kept built (hidden, quiet, not sizing the panel)
    /// for a minute, so switching straight back is instant: nothing rebuilds,
    /// and it's where you left it. It also carries a click's fade-out.
    @State private var warm: LandingView?
    /// The view on screen was the warm one: its blocks are already in place,
    /// so it doesn't replay the stacking entrance.
    @State private var arrivedWarm = false
    @State private var switchGeneration = 0
    @Environment(\.pageLive) private var pageLive
    /// After a switch, the highlighted game to bring into view.
    @State private var pendingScroll: String?
    @Environment(\.scrollMemory) private var scrollMemory
    @Environment(\.scrollKey) private var pageKey
    /// Snaps the panel's height after a keyboard switch (W-T1; absent in previews).
    @Environment(PanelMotion.self) private var panelMotion: PanelMotion?

    /// The list's column count as drawn. Crossing the split the list fades
    /// through rather than gliding (rows would pass over each other): what
    /// moves (rows, headers below the first, footnotes) fades out, jumps to
    /// its new place in one frame, unseen, and fades back in.
    @State private var shownColumns: Int?
    @State private var reflowHidden = false
    /// True only for the frame of the re-flow: nothing glides, unseen.
    @State private var reflowJumping = false
    @State private var reflowGeneration = 0
    /// Losing a column, the old ones don't fit: take the new count on the very
    /// first frame, hidden (see `reflow(to:)`).
    private var listColumns: Int { min(shownColumns ?? layout.columns, layout.columns) }
    private var listNarrowing: Bool { (shownColumns ?? layout.columns) > layout.columns }
    private var listHidden: Bool { reflowHidden || listNarrowing }
    private var listJumping: Bool { reflowJumping || listNarrowing }

    /// The room each row has: the page's in one column, a column's when split.
    private var rowWidth: WidthClass { layout.split ? layout.column : layout.page }
    /// Crests in a collapsed section's preview; the rows' hand-off uses the same count.
    private var previewLogos: Int { CollapsedPreview.maxLogos(for: layout.page) }

    var body: some View {
        VStack(spacing: 0) {
            header.stackIn().pageChrome()
            content.frame(maxHeight: .infinity, alignment: .top)
            footer.stackIn().pageChrome()
        }
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        // On appear, and again after Back or a reopen (it's disabled while covered).
        .keyFocusWhenLive($focused)
        .onAppear {
            shownColumns = layout.columns
        }
        .onChange(of: layout.columns) { _, columns in reflow(to: columns) }
        .onKeyPress(.downArrow) { moveHighlight(.down) }
        .onKeyPress(.upArrow) { moveHighlight(.up) }
        .onKeyPress(.leftArrow) { moveHighlight(.left) }
        .onKeyPress(.rightArrow) { moveHighlight(.right) }
        .onKeyPress(.return) { openHighlighted() }
        .onKeyPress(.space) { openHighlighted() }
        // ⌘P pins the highlighted game to the menu bar (the context menu's
        // Show in Menu Bar, from the keyboard).
        .background { ShortcutButton(key: "p") { pinHighlighted() } }
        // A minute after a switch, the view left behind is let go.
        .task(id: switchGeneration) {
            guard warm != nil else { return }
            try? await Task.sleep(for: .seconds(60))
            guard !Task.isCancelled else { return }
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) { warm = nil }
        }
        #if DEBUG
        // Render harness only: switch views ("list"/"tiles", userInfo keyboard)
        // or toggle a section or tier (id) the way a click or ⌘1/⌘2 would.
        .onReceive(NotificationCenter.default.publisher(for: .scorelineHarness)) { note in
            if let view = (note.object as? String).flatMap(LandingView.init(rawValue:)) {
                switchView(to: view, keyboard: note.userInfo?["keyboard"] as? Bool ?? false)
            } else if let id = note.userInfo?["toggle"] as? String {
                toggle(id: id)
            }
        }
        #endif
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            PageTitle("Scores")
            if store.liveCount > 0 {
                Text("\(store.liveCount) Live")
                    .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                    .contentTransition(.numericText(value: Double(store.liveCount)))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .glassCapsule(tint: .red)
                    .help("\(plural(store.liveCount, "game")) in progress")
                    .accessibilityLabel("\(plural(store.liveCount, "game")) in progress")
                    .transition(Motion.chip(reduceMotion: reduceMotion))
            }
            Spacer()
            GlassGroup(spacing: 6) {
                HStack(spacing: 6) {
                    ViewSwitcher(selection: store.landingView, onSelect: switchView)
                    IconButton(symbol: "calendar", label: "Schedule", shortcut: "⌘U") { onOpenSchedule(.all) }
                        .keyboardShortcut("u")
                    RefreshButton()
                    IconButton(symbol: "slider.horizontal.3", label: "Settings", shortcut: "⌘,", action: onManage)
                }
            }
        }
        .animation(reduceMotion ? Motion.fade : Motion.quick, value: store.liveCount)
        .pageHeader()
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if store.enabledIDs.isEmpty {
            EmptyState(symbol: "sportscourt", title: "No Sports Yet",
                       message: "Choose the leagues you follow and their scores will live here.") {
                Button("Add Sports", action: onManage).controlSize(.small)
            }
        } else if store.sections.isEmpty && store.quietLeagues.isEmpty {
            if store.allFailed {
                // The store really does retry on its own (with backoff).
                ErrorState("Scores", retriesAutomatically: true) { store.startPolling() }
            } else if store.landingView == .tiles {
                SkeletonTiles()
            } else {
                SkeletonList(layout: layout)
            }
        } else {
            landing
                // Every league failing: live dots hold still over old data.
                .environment(\.listStale, store.allFailed)
        }
    }

    /// The selected view, plus the one just left while it's warm (overlapping:
    /// in a VStack the panel would jump). Each block of a freshly built view
    /// stacks in; a warm one is already in place.
    private var landing: some View {
        ZStack(alignment: .top) {
            if store.landingView == .list || warm == .list { layer(.list) { list } }
            if store.landingView == .tiles || warm == .tiles { layer(.tiles) { tiles } }
        }
    }

    private func layer(_ view: LandingView, @ViewBuilder content: () -> some View) -> some View {
        let current = view == store.landingView
        let content = content()
        return ScrollViewReader { proxy in
            content
                .onAppear { scrollToPending(current: current, proxy: proxy) }
                // A warm view coming back appears no more: bring the game in then.
                .onChange(of: current) { _, now in scrollToPending(current: now, proxy: proxy) }
        }
        .environment(\.stackArrival, current && !arrivedWarm ? switchArrival ?? pageArrival : nil)
        // Hidden: no clocks, pulses or flashes, no shortcuts or focus, no
        // keyboard scrolling, no say in the panel's height.
        .environment(\.pageLive, pageLive && current)
        .opacity(current ? 1 : 0)
        .allowsHitTesting(current)
        .disabled(!current)
        .accessibilityHidden(!current)
        .pageContentInactive(!current)
        // The fade is the opacity above; arriving and leaving are instant.
        .transition(.identity)
    }

    /// A game highlighted before a switch: bring it into view.
    private func scrollToPending(current: Bool, proxy: ScrollViewProxy) {
        guard current, let id = pendingScroll else { return }
        pendingScroll = nil
        DispatchQueue.main.async { proxy.scrollTo(id) }
    }

    /// The games regrouped by state (Live, Your Teams, Up Next, Final) as tiles.
    private var tiles: some View {
        ScrollViewReader { proxy in
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    TileBoard(highlight: highlight,
                              onHover: { id, inside in
                                  if inside {
                                      // The pointer takes over: the highlight goes back to gray.
                                      highlight.keyboard = false
                                      highlightedID = id
                                  } else if highlightedID == id { highlightedID = nil }
                              },
                              onSelect: onSelect, onToggle: { toggle(id: $0.id) }, justToggled: justToggled,
                              logoNamespace: logoSpace, linking: linking, onOpenSchedule: { onOpenSchedule(.all) }) {
                        footnotes
                    }
                }
                .padding(.bottom, 8)
            }
            .modifier(HighlightScroll(state: highlight, proxy: proxy, keyboardDriven: { keyboardDriven },
                                      active: store.landingView == .tiles))
        }
        // Its own scroll memory, apart from the list's.
        .environment(\.scrollKey, tilesKey)
    }

    private var tilesKey: String? { pageKey.map { "\($0).tiles" } }

    /// List ⇄ Tiles. A click fades the old view out (0.12s) while the new
    /// one stacks in; ⌘1/⌘2 switch instantly and the panel snaps to the new
    /// height (as it does under Reduce Motion). The view left stays warm for
    /// a minute: switching back to it is instant and lands where you left it,
    /// as Back to Scores does. A freshly built view starts at the top. Either
    /// way a highlighted game is brought into view.
    private func switchView(to view: LandingView, keyboard: Bool) {
        let old = store.landingView
        guard view != old else { return }
        let fromWarm = warm == view
        if !fromWarm { scrollMemory?.offsets[(view == .tiles ? tilesKey : pageKey) ?? ""] = nil }
        pendingScroll = highlightedID
        switchGeneration += 1
        var instant = Transaction()
        instant.disablesAnimations = true
        if keyboard {
            panelMotion?.snapNextResize()
            withTransaction(instant) {
                switchArrival = nil
                arrivedWarm = fromWarm
                warm = old
                store.landingView = view
            }
            return
        }
        if reduceMotion { panelMotion?.snapNextResize() }
        withTransaction(instant) {
            switchArrival = fromWarm ? nil : StackArrival(style: .stack)
            arrivedWarm = fromWarm
            warm = old
        }
        withAnimation(Motion.exit) { store.landingView = view }
    }

    /// The games, grouped by league in the user's order.
    private var list: some View {
        ScrollViewReader { proxy in
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(store.sections) { section in
                        sectionView(section)
                    }
                    footnotes
                }
                .padding(.bottom, 8)
            }
            .modifier(HighlightScroll(state: highlight, proxy: proxy, keyboardDriven: { keyboardDriven },
                                      active: store.landingView == .list))
            // VoiceOver's rotor: straight to each game in progress.
            .accessibilityRotor("Live Games") {
                ForEach(store.sections.flatMap(\.events).filter { $0.state == .live }) { event in
                    AccessibilityRotorEntry(event.scoreLine(abbreviated: false), id: event.id)
                }
            }
        }
    }

    @ViewBuilder
    private func sectionView(_ section: ScoreStore.Section) -> some View {
        let isCollapsed = store.collapsed.contains(section.id)
        SectionHeader(section: section, collapsed: isCollapsed, justToggled: justToggled == section.id, maxLogos: previewLogos,
                      onOpenLeague: onOpenLeague, onOpenStandings: onOpenStandings, onOpenRankings: onOpenRankings,
                      onOpenSchedule: onOpenSchedule, onOpenResults: onOpenResults) {
            toggle(section)
        }
        .environment(\.logoNamespace, linking == section.id ? logoSpace : nil)
        // Inside the transaction: hiding for a re-flow is instant, never a fade
        // inherited from the width change.
        .opacity(listHidden && section.id != store.sections.first?.id ? 0 : 1)
        .transaction { if listJumping { $0.animation = nil } }
        if !isCollapsed {
            Group {
                if section.failed {
                    Text(ErrorCopy.inline(section.title))
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, Metrics.gutter)
                        .padding(.vertical, 6)
                }
                let matches = firstAppearances(in: section, limit: previewLogos)
                let staggered = justToggled == section.id
                // The same rows in one column or two: crossing the split moves
                // them without rebuilding any. One status width per section.
                StatusColumnScope(events: section.events) {
                    RowGrid(columns: listColumns) {
                        ForEach(Array(section.events.enumerated()), id: \.element.id) { index, event in
                            HighlightGate(state: highlight, id: event.id) { lit in
                                EventRow(event: event, highlighted: lit, keyboard: lit && highlight.keyboard,
                                         onHover: { inside in
                                             if inside {
                                                 highlight.keyboard = false
                                                 highlightedID = event.id
                                             } else if highlightedID == event.id { highlightedID = nil }
                                         },
                                         onSelect: onSelect,
                                         logoMatches: matches[event.id] ?? [],
                                         revealDelay: staggered ? ScoresGrid.revealDelay(index: index, columns: layout.columns) : nil,
                                         width: rowWidth)
                                    .equatable()
                            }
                            .id(event.id)
                        }
                    }
                }
                .opacity(listHidden ? 0 : 1)
                .transaction { if listJumping { $0.animation = nil } }
            }
            // Rows arrive in place (the crests and text animate themselves) and
            // leave quickly, faster than they came.
            .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
            .environment(\.logoNamespace, linking == section.id ? logoSpace : nil)
        }
    }

    /// One column ⇄ two: fade out where they are, re-flow unseen, fade back in.
    private func reflow(to columns: Int) {
        reflowGeneration += 1
        let generation = reflowGeneration
        if columns < (shownColumns ?? columns) {
            // Already hidden and re-flowed on the first frame (see `listColumns`).
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) {
                reflowHidden = true
                reflowJumping = true
                shownColumns = columns
            }
            Task {
                // Rows changed width class at the same moment: let their
                // outgoing detail finish leaving (`Motion.exit`) before showing them.
                try? await Task.sleep(for: .seconds(0.12))
                guard generation == reflowGeneration else { return }
                reflowJumping = false
                withAnimation(reduceMotion ? Motion.fade : Motion.reveal) { reflowHidden = false }
            }
            return
        }
        withAnimation(Motion.exit) { reflowHidden = true }
        Task {
            try? await Task.sleep(for: .seconds(0.12))
            guard generation == reflowGeneration else { return }
            reflowJumping = true
            shownColumns = columns
            // A frame later (the jump has landed), fade back in.
            try? await Task.sleep(for: .seconds(0.03))
            guard generation == reflowGeneration else { return }
            reflowJumping = false
            withAnimation(reduceMotion ? Motion.fade : Motion.reveal) { reflowHidden = false }
        }
    }

    /// Expands or collapses a section, its crests travelling between the
    /// preview and the rows.
    private func toggle(_ section: ScoreStore.Section) {
        toggle(id: section.id)
    }

    /// Sections and tile tiers ("tiles.live") toggle the same way.
    private func toggle(id: String) {
        let now = Date()
        // Clicking faster than the choreography can play: skip it. A plain,
        // fast transition stays clean however quickly sections are toggled;
        // the crest travel and text stagger are for a deliberate click.
        let rapid = now.timeIntervalSince(lastToggle) < 0.45
        lastToggle = now
        toggleGeneration += 1
        let generation = toggleGeneration
        func cleanUp(after delay: Double) {
            Task {
                try? await Task.sleep(for: .seconds(delay))
                // A newer toggle owns the state now.
                guard generation == toggleGeneration else { return }
                justToggled = nil
                linking = nil
            }
        }
        if rapid || reduceMotion {
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) {
                justToggled = nil
                linking = nil
            }
            withAnimation(reduceMotion ? Motion.fade : Motion.exit) { store.toggleCollapsed(id: id) }
            return
        }
        let run = {
            // Overtaken by a faster click before it began: still count it, just
            // without the show, so two clicks are always two toggles.
            guard generation == toggleGeneration else {
                var instant = Transaction()
                instant.disablesAnimations = true
                withTransaction(instant) { store.toggleCollapsed(id: id) }
                return
            }
            justToggled = id
            // One transaction, so preview crests and row crests trade places
            // together. Building the section's rows takes a frame or two; the
            // travel starts just after, so it gets every frame instead of
            // jumping ahead by the ones the build used.
            withAnimation(Motion.travel.delay(0.04)) {
                store.toggleCollapsed(id: id)
            }
            cleanUp(after: 0.8)
        }
        // Link the crests first, so the frame before the toggle registers
        // where they start, and toggle on the next pass.
        linking = id
        DispatchQueue.main.async(execute: run)
    }

    /// For each row, the teams appearing there for the first time in the
    /// section, among those the collapsed preview shows: the crests it hands
    /// off to. Others have no partner, so they don't carry a link.
    private func firstAppearances(in section: ScoreStore.Section, limit: Int) -> [String: Set<String>] {
        var seen = Set<String>()
        var result: [String: Set<String>] = [:]
        for event in section.events {
            for competitor in event.competitors where competitor.logo != nil {
                guard seen.count < limit else { return result }
                let id = logoMatchID(section: section.id, competitor)
                if seen.insert(id).inserted { result[event.id, default: []].insert(id) }
            }
        }
        return result
    }

    @ViewBuilder
    private var footnotes: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Say over what period: daily leagues are fetched for today and
            // tomorrow, weekly ones (NFL, college) for the current week.
            let quiet = store.quietLeagues
            // A quiet league whose calendar knows its next game day links to its schedule.
            let schedule = ScheduleStore.shared
            let known = quiet.filter { schedule.nextDay(for: $0) != nil }
            let rest = quiet.filter { schedule.nextDay(for: $0) == nil }
            let weekly = rest.filter { if case .espn(_, true) = $0.source { return true }; return false }
            let daily = rest.filter { league in !weekly.contains(league) }
            ForEach(known) { league in
                Button {
                    onOpenSchedule(.for(league: league))
                } label: {
                    Text("\(league.name): next \(schedule.nextDay(for: league)?.mediumLabel ?? "")")
                }
                .buttonStyle(.plain)
                .help("\(league.name) schedule")
            }
            if !daily.isEmpty {
                Text("No games today or tomorrow: " + daily.map(\.name).joined(separator: ", "))
            }
            if !weekly.isEmpty {
                Text("No games this week: " + weekly.map(\.name).joined(separator: ", "))
            }
            if store.followed.isEmpty {
                // Teaches the one hidden gesture until it's been used.
                Label("Right-click a game to follow a team or pin it to the menu bar (⌘P).", systemImage: "hand.point.up.left")
            }
        }
        .font(.system(size: 11))
        // Information, not decoration: secondary ink.
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
        .readableWidth()
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 12)
        .stackIn()
        .task(id: store.quietLeagues.map(\.id)) { await ScheduleStore.shared.loadCalendars(store.quietLeagues) }
        // They move when the list re-flows at the split (see `reflow(to:)`).
        .opacity(listHidden ? 0 : 1)
        .transaction { if listJumping { $0.animation = nil } }
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            UpdatedLabel(text: updatedText, offline: { store.allFailed && store.lastUpdated != nil })
            Spacer()
            Button("Quit Scoreline") { NSApp.terminate(nil) }
                .buttonStyle(.plain)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .help("Quit (⌘Q)")
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 8)
    }

    private func updatedText(now: Date) -> String {
        guard let last = store.lastUpdated else { return "Updating…" }
        if store.allFailed { return "Can't connect · Updated \(last.formatted(date: .omitted, time: .shortened))" }
        return UpdatedLabel.ago(last, now: now)
    }

    // MARK: Keyboard

    /// Distinguishes arrow-key moves (which should scroll) from hover (which shouldn't).
    @State private var keyboardDriven = false

    /// Arrow keys: through the list in one column; around the grid when split.
    /// Tiles: ↑/↓ to the nearest tile in the next row, ←/→ in reading order.
    private func moveHighlight(_ move: ScoresGrid.Move) -> KeyPress.Result {
        let next: String?
        if store.landingView == .tiles {
            let direction: TileNavigator.Direction = switch move {
            case .up: .up
            case .down: .down
            case .left: .left
            case .right: .right
            }
            let navigator = TileNavigator(plans: TilePlanner.plan(store.board, layout: layout), collapsed: store.collapsed,
                                          largeColumns: TileMetrics.largeColumns(layout),
                                          smallColumns: TileMetrics.smallColumns(layout))
            next = navigator.move(from: highlightedID, direction)
        } else {
            let sections = store.sections.filter { !store.collapsed.contains($0.id) }.map { $0.events.map(\.id) }
            next = ScoresGrid.next(from: highlightedID, move: move, sections: sections, columns: layout.columns)
        }
        guard let next else { return .ignored }
        keyboardDriven = true
        // The keyboard's highlight wears the accent until the pointer takes over.
        highlight.keyboard = true
        highlightedID = next
        DispatchQueue.main.async { keyboardDriven = false }
        return .handled
    }

    private var highlightedEvent: Event? {
        let events = store.landingView == .tiles ? store.board.events : store.navigableEvents
        return highlightedID.flatMap { id in events.first { $0.id == id } }
    }

    private func openHighlighted() -> KeyPress.Result {
        guard let event = highlightedEvent else { return .ignored }
        onSelect(event)
        return .handled
    }

    /// ⌘P: the highlighted game in (or out of) the menu bar. Instant.
    private func pinHighlighted() {
        guard let event = highlightedEvent else { return }
        store.togglePin(event)
    }
}

// MARK: - Section header

private struct SectionHeader: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let section: ScoreStore.Section
    let collapsed: Bool
    let justToggled: Bool
    let maxLogos: Int
    let onOpenLeague: (League) -> Void
    let onOpenStandings: (League) -> Void
    let onOpenRankings: (League) -> Void
    var onOpenSchedule: (ScheduleScope) -> Void = { _ in }
    var onOpenResults: (ScheduleScope) -> Void = { _ in }
    let toggle: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: toggle) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    GroupLabel(title: section.title, symbol: section.symbol)
                    Spacer()
                    // Always visible so collapsing is discoverable; brighter on hover.
                    Image(systemName: "chevron.right")
                        .font(Glyph.disclosure)
                        .foregroundStyle(hovering ? .secondary : .tertiary)
                        .rotationEffect(.degrees(collapsed ? 0 : 90))
                        .animation(reduceMotion ? nil : Motion.quick, value: collapsed)
                        .accessibilityHidden(true)
                }
                // Collapsed sections still hint at what's inside.
                if collapsed && !section.events.isEmpty {
                    // Crests carry the motion themselves, so the line just fades.
                    CollapsedPreview(events: section.events, sectionID: section.id, maxLogos: maxLogos,
                                     revealSummary: justToggled)
                        .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
                }
            }
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 12)
            .padding(.bottom, collapsed ? 6 : 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .stackIn()
        .onHover { hovering = $0 }
        .contextMenu {
            Button(collapsed ? "Expand" : "Collapse", systemImage: collapsed ? "chevron.down" : "chevron.right", action: toggle)
            if let league = League.with(id: section.id) {
                if league.sport == .soccer {
                    Button("Table", systemImage: "list.number") { onOpenStandings(league) }
                }
                if league.id == "college-football" {
                    Button("Standings", systemImage: "list.number") { onOpenStandings(league) }
                    Button("Top 25", systemImage: "trophy") { onOpenRankings(league) }
                }
                if league.id == "nba" {
                    Button("Standings", systemImage: "list.number") { onOpenStandings(league) }
                }
                Button("Schedule", systemImage: "calendar") { onOpenSchedule(.for(league: league)) }
                Button("Results", systemImage: "flag.checkered") { onOpenResults(.for(league: league)) }
                Button(league.source == .ifsc ? "Choose Countries…" : "Choose Teams…", systemImage: "line.3.horizontal.decrease.circle") {
                    onOpenLeague(league)
                }
                Divider()
                Button("Move Up", systemImage: "arrow.up") { withAnimation(Motion.rearrange) { store.move(league.id, by: -1) } }
                Button("Move Down", systemImage: "arrow.down") { withAnimation(Motion.rearrange) { store.move(league.id, by: 1) } }
                Divider()
                Button("Hide \(league.name)", systemImage: "eye.slash") { withAnimation(Motion.rearrange) { store.setEnabled(league, false) } }
            }
        }
        // The title stays the label; the state (and a collapsed section's
        // preview, "2 live") is its value, so neither replaces the other.
        .accessibilityLabel(section.title)
        .accessibilityValue(collapsed ? "Collapsed, \(CollapsedPreview.spoken(section.events))" : "Expanded")
        .accessibilityAddTraits(.isHeader)
        .help(collapsed ? "Show \(section.title)" : "Hide \(section.title)")
    }
}

// MARK: - Collapsed preview

/// One line under a collapsed header: the teams inside (logos, in on-screen
/// order) and what's happening — live now, or when the next game starts.
struct CollapsedPreview: View {
    let events: [Event]
    let sectionID: String
    /// How many crests show before "N more" (see `maxLogos(for:)`).
    var maxLogos = 7
    /// Just collapsed: the summary waits for the crests to land, then fades in.
    var revealSummary = false
    @State private var revealed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// More crests as the header widens: 7, 9, 11, 14. The rows' crest
    /// hand-off (`firstAppearances`) must use the same count.
    static func maxLogos(for width: WidthClass) -> Int {
        switch width {
        case .compact: 7
        case .medium: 9
        case .large: 11
        case .xlarge: 14
        }
    }

    private var summaryShown: Bool { !revealSummary || revealed }

    private var logos: [Competitor] {
        var seen = Set<String>()
        return events.flatMap(\.competitors).filter { c in
            guard c.logo != nil else { return false }
            return seen.insert(c.id ?? c.name).inserted
        }
    }

    private var isField: Bool {
        events.first.map { if case .field = $0.content { return true }; return false } ?? false
    }

    var body: some View {
        HStack(spacing: 10) {
            let teams = logos
            if !teams.isEmpty {
                HStack(spacing: 5) {
                    ForEach(teams.prefix(maxLogos), id: \.key) { team in
                        // A touch smaller than in the rows (16pt), so expanding
                        // reads as the crests settling into place.
                        LogoView(url: team.logo, darkURL: team.darkLogo, size: 14)
                            .matchedLogo(logoMatchID(section: sectionID, team))
                            .help(team.name)
                    }
                    if teams.count > maxLogos {
                        Text("\(teams.count - maxLogos) more")
                            .reveal(summaryShown, reduceMotion: reduceMotion)
                            .font(.system(size: 10, weight: .semibold).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 5)
                            .frame(height: 15)
                            .background(Capsule().fill(Color.primary.opacity(0.08)))
                            .help("\(teams.count - maxLogos) more teams in this section")
                    }
                }
                // Never squeezed: the status text gives way first.
                .fixedSize()
            } else if isField {
                Text(plural(events.count, "category", plural: "categories"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                    .reveal(summaryShown, reduceMotion: reduceMotion)
            }
            Spacer(minLength: 6)
            summary.reveal(summaryShown, reduceMotion: reduceMotion)
        }
        .onAppear {
            guard revealSummary, !revealed else { return }
            // ~ when the crests (0.4s travel) have mostly landed.
            withAnimation(Motion.reveal.delay(reduceMotion ? 0 : 0.22)) { revealed = true }
        }
        .padding(.leading, 17)  // aligns with the header title, past its icon
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spoken(events))
    }

    private var summary: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let live = events.filter { $0.state == .live }.count
            HStack(spacing: 4) {
                if live > 0 {
                    LiveDot()
                    Text("\(live) Live").foregroundStyle(.red).fontWeight(.semibold)
                } else {
                    Text(status(now: context.date)).foregroundStyle(.secondary)
                }
            }
            .font(.system(size: 11).monospacedDigit())
            .lineLimit(1)
        }
    }

    /// "Starts in 2h 9m", "Tomorrow 7:00 AM", or "3 Results".
    private func status(now: Date) -> String {
        if let next = events.filter({ $0.state == .scheduled && $0.start > now }).min(by: { $0.start < $1.start }) {
            if next.start.timeIntervalSince(now) < 3 * 3600, let countdown = Countdown.text(to: next.start, from: now) {
                return countdown == "Starting" ? "Starting" : "Starts \(countdown)"
            }
            return When.dayAndTime(next.start, now: now)
        }
        if events.contains(where: { $0.state == .scheduled }) { return Self.isField(events) ? "Time TBA" : "Starting soon" }
        return plural(events.filter { $0.state == .final }.count, "result")
    }

    private static func isField(_ events: [Event]) -> Bool {
        events.first.map { if case .field = $0.content { return true }; return false } ?? false
    }

    /// What a collapsed section holds, in words: "2 games in progress",
    /// "Starts in 45 minutes", "3 results".
    static func spoken(_ events: [Event], now: Date = .now) -> String {
        let live = events.filter { $0.state == .live }.count
        if live > 0 { return "\(plural(live, "game")) in progress" }
        if let next = events.filter({ $0.state == .scheduled && $0.start > now }).min(by: { $0.start < $1.start }) {
            return "Next starts \(When.dayAndTime(next.start, now: now))"
        }
        if events.contains(where: { $0.state == .scheduled }) { return isField(events) ? "Time to be announced" : "Starting soon" }
        return plural(events.filter { $0.state == .final }.count, "result")
    }
}

// MARK: - Loading

/// Placeholder rows shaped like real ones, so first load doesn't jump: the
/// same grid as the live list (2 × 3 when split) and, on lane rows, a lane.
/// Deliberately static: it's on screen for a second, and a repeating SwiftUI
/// animation would keep running after the menu closes.
private struct SkeletonList: View {
    let layout: PanelLayout

    private var lane: Bool { !layout.split && RowDetail.of(layout.page) == .lane }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RoundedRectangle(cornerRadius: 3).frame(width: 90, height: 8)
                .padding(.horizontal, Metrics.gutter).padding(.top, 14).padding(.bottom, 8)
            RowGrid(columns: layout.columns) {
                ForEach(0..<(layout.split ? 6 : 4), id: \.self) { _ in
                    row
                }
            }
        }
        .foregroundStyle(Color.primary.opacity(0.07))
        .padding(.bottom, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading scores")
    }

    private var row: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(0..<2, id: \.self) { _ in
                    HStack(spacing: 8) {
                        Circle().frame(width: 14, height: 14)
                        RoundedRectangle(cornerRadius: 3).frame(width: 110, height: 9)
                    }
                }
            }
            .frame(width: lane ? Metrics.teamBlockWidth : nil, alignment: .leading)
            if lane {
                RoundedRectangle(cornerRadius: 3).frame(width: 120, height: 8).padding(.leading, 6)
            }
            Spacer()
            RoundedRectangle(cornerRadius: 3).frame(width: 44, height: 9)
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 9)
    }
}

#if DEBUG
extension Notification.Name {
    /// Render harness only (see `ScoresView.body`).
    static let scorelineHarness = Notification.Name("ScorelineHarness")
}
#endif


@Observable @MainActor
final class HighlightState {
    var id: String?
    /// The arrow keys put it there (it then wears the accent); the pointer
    /// clears it. Read only by the lit row, so flipping it redraws one row.
    var keyboard = false
}

/// Reads the highlight for one row or tile, so a change re-runs only these
/// small bodies; the row itself (equatable) redraws only when its own flag flips.
struct HighlightGate<Content: View>: View {
    let state: HighlightState
    let id: String
    @ViewBuilder let content: (Bool) -> Content
    var body: some View { content(state.id == id) }
}

/// Arrow keys scroll the highlighted game into view (hover doesn't).
/// `active: false` for a view kept built but hidden (the warm landing view).
struct HighlightScroll: ViewModifier {
    let state: HighlightState
    let proxy: ScrollViewProxy
    let keyboardDriven: () -> Bool
    var active = true
    func body(content: Content) -> some View {
        content.onChange(of: state.id) { _, id in
            guard active, let id, keyboardDriven() else { return }
            proxy.scrollTo(id)
        }
    }
}

/// Hands a section's rows one status width (`StatusColumn`), measured from
/// what each row's status says and the marks beside it (pin, co-stream,
/// YouTube). It reads those marks itself, so a change re-measures here
/// without re-running the page.
struct StatusColumnScope<Content: View>: View {
    @Environment(ScoreStore.self) private var store
    let events: [Event]
    @ViewBuilder let content: Content

    var body: some View {
        let width = RowStatus.width(for: events) { event in
            RowStatus.accessories(pinned: store.pinnedID == event.id, coStreaming: store.coStreamingIDs.contains(event.id),
                                  streaming: store.broadcast(for: event)?.isLive == true)
        }
        content.environment(\.statusColumnWidth, width)
    }
}

/// Refresh: one turn of the arrow per click. Background polls show nothing,
/// so polls don't re-render the header (or the page around it).
private struct RefreshButton: View {
    @Environment(ScoreStore.self) private var store
    @State private var turns = 0

    var body: some View {
        IconButton(symbol: "arrow.clockwise", label: "Refresh", shortcut: "⌘R", turns: turns) {
            turns += 1
            store.startPolling()
        }
    }
}
