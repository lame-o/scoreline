import SwiftUI

/// A sport's page: what's coming up first (its games, competitions or
/// tournaments, and the way into its full schedule), then its settings: show
/// every game, or only the teams picked here. For climbing the picks are
/// countries, whose athletes get called out.
///
/// Long lists read as an outline, never one 136-row column: college football
/// by conference, each collapsed to its header and a line of crests (open
/// where a team is yours); a long list with no groups (CS2's ranking,
/// climbing's countries) shows its first dozen and "Show All N".
///
/// Interaction: click anywhere on a row to pick it; the star alone follows.
/// The search field is focused on open, so typing filters immediately (flat,
/// across every group); ↑/↓ move through the rows on screen and the group
/// headers, → and ← open and close a highlighted group, Return toggles,
/// Esc clears the search, then goes back.
struct LeagueSettingsView: View {
    @Environment(ScoreStore.self) private var store
    /// How this page was entered: decides whether loaded teams stack or fade in.
    @Environment(\.stackArrival) private var page
    let league: League
    let backTitle: String
    var onOpen: (Event) -> Void = { _ in }
    var onOpenSchedule: (ScheduleScope) -> Void = { _ in }
    /// The league's results (its schedule page in Results mode).
    var onOpenResults: (ScheduleScope) -> Void = { _ in }
    /// A climbing category's or a CS2 tournament's results page.
    var onOpenEvent: (EventResultsRef) -> Void = { _ in }
    let onBack: () -> Void

    @State private var options: [TeamOption] = []
    /// Picks as they were when the page opened. They're grouped at the top, but
    /// rows don't jump between groups while the user is clicking.
    @State private var initialPicks: Set<String> = []
    @State private var loading = true
    @State private var failed = false
    @State private var query = ""
    /// The hovered or arrow-keyed team. A reference, so a change updates only
    /// the rows whose highlight flips (`HighlightGate`), not this page.
    @State private var highlight = HighlightState()
    private var highlightedID: String? {
        get { highlight.id }
        nonmutating set { highlight.id = newValue }
    }
    @State private var keyboardDriven = false
    /// Conferences' open states (and a long list's "Show All"), remembered
    /// for the session. Each group observes its own flag; this page doesn't.
    @State private var groups = DisclosureGroups()
    @Environment(\.panelLayout) private var layout
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showSpinner = false
    @State private var arrival: StackArrival?
    /// The co-stream channel as typed; saved on Return or when focus leaves.
    @State private var channelDraft = ""
    @FocusState private var searchFocused: Bool
    @FocusState private var channelFocused: Bool

    private static let contentSpace = "picker.content"
    private var isClimbing: Bool { league.source == .ifsc }
    private var showsPicks: Bool { store.isFilterOn(league) || isClimbing }

    var body: some View {
        VStack(spacing: 0) {
            header.stackIn().pageChrome()
            ScrollViewReader { proxy in
                PageScrollView {
                    // One container, so the page measures as one height.
                    VStack(alignment: .leading, spacing: 0) {
                        // Upcoming spans the page (rows go two-up when split);
                        // settings stay a readable column below.
                        LeagueUpcomingSection(league: league, onOpen: onOpen, onOpenSchedule: onOpenSchedule)
                        LeagueResultsSection(league: league, onOpen: onOpen,
                                             onOpenResults: { onOpenResults(.for(league: league)) }, onOpenEvent: onOpenEvent)
                        StackColumn {
                            settingsTitle
                            modePicker
                            if league.source == .counterStrike { counterStrikeOptions }
                            if league.id == "college-football" { collegeOptions }
                            if isClimbing { climbingOptions }
                            if showsPicks { pickList }
                            removeButton
                        }
                        .coordinateSpace(name: Self.contentSpace)
                        // One centred column (search and the lazy team list included);
                        // the header stays at the window's edges.
                        .formColumn()
                        .environment(\.stackArrival, arrival ?? page)
                        .padding(.bottom, 12)
                    }
                }
                .modifier(HighlightScroll(state: highlight, proxy: proxy, keyboardDriven: { keyboardDriven }))
            }
        }
        .pageLoading(loading)
        .delayedSpinner(while: loading, show: $showSpinner)
        .task(id: league.id) { await load() }
        #if DEBUG
        // Render harness only: open or close a group ("outline" id) as a
        // click does, or press a key ("key": up, down, left, right, return).
        .onReceive(NotificationCenter.default.publisher(for: .scorelineHarness)) { note in
            if let id = note.userInfo?["outline"] as? String {
                groups.toggle(id, style: .click, reduceMotion: reduceMotion)
            }
            switch note.userInfo?["key"] as? String {
            case "down": moveHighlight(by: 1)
            case "up": moveHighlight(by: -1)
            case "right": _ = disclose(right: true)
            case "left": _ = disclose(right: false)
            case "return": activateHighlighted()
            default: break
            }
        }
        #endif
    }

    private func back() {
        // Esc first clears a search, like any macOS search field.
        if !query.isEmpty { query = ""; return }
        onBack()
    }

    // MARK: Header

    private var header: some View {
        PageHeader(league.name, symbol: league.sport.symbol) { BackButton(title: backTitle, action: back) }
    }

    /// Where the settings start, below what's coming up.
    private var settingsTitle: some View {
        SectionTitle("In Your Scores")
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 6)
    }

    // MARK: Mode

    @ViewBuilder
    private var modePicker: some View {
        if isClimbing {
            Text("Pick countries to see their best-placed athlete on each round and highlighted in the standings.")
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.top, 4)
        } else {
            Picker("Show", selection: Binding(
                get: { store.isFilterOn(league) },
                set: { on in
                    if on {
                        // The team list assembles top to bottom as it appears…
                        arrival = StackArrival(style: .stack, space: Self.contentSpace)
                        withAnimation(Motion.rearrange) { store.setFilterOn(league, on) }
                    } else {
                        // …and leaves faster than it came.
                        withAnimation(Motion.exit) { store.setFilterOn(league, on) }
                    }
                }
            )) {
                Text("All Games").tag(false)
                Text("Only My Teams").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 12)
            .padding(.top, 4)

            Text(store.isFilterOn(league)
                 ? "Only games involving the teams checked below appear under \(league.name)."
                 : "Every \(league.name) game appears. Switch to pick specific teams.")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
                .padding(.top, 6)
        }
    }

    // MARK: CS2 options

    @ViewBuilder
    private var counterStrikeOptions: some View {
        @Bindable var store = store
        GroupLabel(title: "Options", symbol: "slider.horizontal.3")
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 5)
        GroupBox {
            ToggleRow(title: "Show co-streams", subtitle: "Marks live matches this channel is streaming",
                      isOn: $store.showCoStream)
            HStack {
                Text("Twitch channel").font(.system(size: 13)).accessibilityHidden(true)
                Spacer()
                TextField("Twitch channel", text: $channelDraft, prompt: Text("ohnepixel"))
                    .labelsHidden()
                    .textFieldStyle(.plain)
                    .multilineTextAlignment(.trailing)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .frame(width: 140)
                    .autocorrectionDisabled()
                    .focused($channelFocused)
                    .onSubmit(commitChannel)
                    .onChange(of: channelFocused) { _, focused in if !focused { commitChannel() } }
                    .onAppear { channelDraft = store.coStreamer }
                    .onDisappear(perform: commitChannel)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .disabled(!store.showCoStream)
            .opacity(store.showCoStream ? 1 : 0.5)
        }
    }

    // MARK: Climbing options

    @ViewBuilder
    private var climbingOptions: some View {
        GroupLabel(title: "Disciplines", symbol: "figure.climbing")
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 5)
        GroupBox {
            ToggleRow(title: "Lead", subtitle: "Height on one route, hold by hold", isOn: discipline("lead"))
            ToggleRow(title: "Boulder", subtitle: "Tops and zones on short problems", isOn: discipline("boulder"))
            ToggleRow(title: "Speed", subtitle: "Head-to-head races up a standard wall", isOn: discipline("speed"))
        }
    }

    private func discipline(_ name: String) -> Binding<Bool> {
        Binding(get: { store.climbingDisciplines.contains(name) },
                set: { on in
                    if on { store.climbingDisciplines.insert(name) } else { store.climbingDisciplines.remove(name) }
                })
    }

    // MARK: College options

    @ViewBuilder
    private var collegeOptions: some View {
        @Bindable var store = store
        GroupLabel(title: "Options", symbol: "slider.horizontal.3")
            .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 5)
        GroupBox {
            ToggleRow(title: "Top 25 games only", subtitle: "Plus every team you follow", isOn: $store.collegeTop25Only)
        }
    }

    // MARK: Picks

    @ViewBuilder
    private var pickList: some View {
        if loading {
            // Only a slow load shows it (a cached list lands at once).
            if showSpinner {
                PickListSkeleton(flags: isClimbing)
                    .transition(.opacity.animation(Motion.exit))
            }
        } else if failed {
            VStack(spacing: 8) {
                Text("Couldn't load \(isClimbing ? "countries" : "teams"). \(ErrorCopy.message)")
                    .font(.system(size: 11.5)).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button(ErrorCopy.retry) { Task { await load() } }.controlSize(.small)
            }
            .frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.vertical, 20)
        } else {
            if options.count > 12 { searchField }

            let sections = self.sections
            let picks = store.picks(for: league)
            // A lone list says how many are picked; with "Selected" on top it's plain.
            let note = sections.count == 1 && !picks.isEmpty ? "\(picks.count) selected" : nil
            ForEach(sections) { section in
                let ids = Set(section.options.map(\.id))
                PickSectionView(section: section, flag: section.kind == .plain ? nil : groups.flag(section.id),
                                highlight: highlight, picked: picks.intersection(ids), followable: !isClimbing,
                                maxLogos: previewLogos, note: note, noun: isClimbing ? "country" : "team",
                                onHover: { key, inside in
                                    if inside {
                                        highlight.keyboard = false
                                        highlightedID = key
                                    } else if highlightedID == key { highlightedID = nil }
                                },
                                togglePick: { store.togglePick($0, in: league) },
                                toggleGroup: { groups.toggle(section.id, style: .click, reduceMotion: reduceMotion) },
                                showAll: { groups.showAll(section.id, keyboard: false, reduceMotion: reduceMotion) })
                    .equatable()
            }

            if sections.isEmpty {
                Text(isClimbing ? "No countries match “\(query)”" : "No teams match “\(query)”").font(.system(size: 11.5)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 18)
            }
        }
    }

    /// Crests on a collapsed group's line: the scores list's count for the
    /// picker's width (a form column, so never past its medium class).
    private var previewLogos: Int { CollapsedPreview.maxLogos(for: min(layout.page, .medium)) }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(.secondary)
            TextField(isClimbing ? "Search countries" : "Search teams", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 12.5))
                .focused($searchFocused)
                .onKeyPress(.downArrow) { moveHighlight(by: 1); return .handled }
                .onKeyPress(.upArrow) { moveHighlight(by: -1); return .handled }
                // An outline's keys: → opens the highlighted group, ← closes it
                // (or goes up to it). While typing they move the caret.
                .onKeyPress(.rightArrow) { disclose(right: true) }
                .onKeyPress(.leftArrow) { disclose(right: false) }
                .onSubmit(activateHighlighted)
                .onChange(of: query) {
                    // Typing narrows the list; keep the first match ready for Return.
                    highlight.keyboard = true
                    highlightedID = query.isEmpty ? nil : stops.first?.key
                }
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 11)).foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .help("Clear Search")
                .accessibilityLabel("Clear Search")
            }
        }
        .padding(.horizontal, 11)
        .frame(height: 30)
        .glassCapsule()
        // Only the ring fades: nothing else in the field rides its animation.
        // A circular capsule: the continuous one's stroke breaks into flat
        // spurs at its ends (the "clipped" ring at 340).
        .overlay(Capsule(style: .circular).strokeBorder(Color.accentColor.opacity(searchFocused ? 0.55 : 0), lineWidth: 1.5)
            .animation(Motion.fade, value: searchFocused))
        .padding(.horizontal, 12)
        .padding(.top, 12)
    }

    /// The list as shown: search results, or the picks then the rest
    /// (conferences, or a long list's first dozen). See `PickOutline`.
    private var sections: [PickSection] {
        PickOutline.sections(options, query: query, picks: initialPicks, noun: isClimbing ? "Countries" : "Teams",
                             symbol: isClimbing ? "flag" : "person.3")
    }

    /// Hides the league from Scores (Add Sports brings it back): the scores
    /// list's "Hide {League}", in the same words.
    private var removeButton: some View {
        Button {
            store.setEnabled(league, false)
            onBack()
        } label: {
            Text("Hide \(league.name)")
                .font(.system(size: 12.5))
                .foregroundStyle(Color.accentColor)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
        }
        .buttonStyle(ListRowStyle(hovering: false, inset: 0))
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.045)))
        .padding(.horizontal, 12)
        .padding(.top, 16)
    }

    // MARK: Keyboard

    /// What ↑/↓ stop on: rows on screen, the headers of groups, "Show All".
    private var stops: [Outline.Stop] {
        let expanded = groups.expanded
        return Outline.stops(sections.map(\.outline), expanded: expanded, showingAll: expanded)
    }

    private func moveHighlight(by delta: Int) {
        guard let next = Outline.step(from: Outline.Stop(key: highlightedID), by: delta, in: stops) else { return }
        keyboardDriven = true
        highlight.keyboard = true
        highlightedID = next.key
        DispatchQueue.main.async { keyboardDriven = false }
    }

    /// → and ← on the highlighted header (or a row, for ←). Not while
    /// typing: then they're the caret's.
    private func disclose(right: Bool) -> KeyPress.Result {
        guard query.isEmpty else { return .ignored }
        let current = Outline.Stop(key: highlightedID)
        let outline = sections.map(\.outline)
        let expanded = groups.expanded
        guard let action = right ? Outline.right(from: current, sections: outline, expanded: expanded)
                                 : Outline.left(from: current, sections: outline, expanded: expanded) else { return .ignored }
        keyboardDriven = true
        highlight.keyboard = true
        switch action {
        case let .expand(id): groups.set(id, open: true, style: .keyboard, reduceMotion: reduceMotion)
        case let .collapse(id): groups.set(id, open: false, style: .keyboard, reduceMotion: reduceMotion)
        case let .highlight(stop): highlightedID = stop.key
        }
        DispatchQueue.main.async { keyboardDriven = false }
        return .handled
    }

    /// Return: picks the highlighted row, opens or closes a header, or shows
    /// all (the highlight moving on to the first row it revealed).
    private func activateHighlighted() {
        switch Outline.Stop(key: highlightedID) {
        case let .row(_, item)?:
            store.togglePick(item, in: league)
        case let .header(id)?:
            groups.toggle(id, style: .keyboard, reduceMotion: reduceMotion)
        case let .more(id)?:
            groups.showAll(id, keyboard: true, reduceMotion: reduceMotion)
            if let item = sections.first(where: { $0.id == id })?.options.dropFirst(Outline.preview).first {
                keyboardDriven = true
                highlightedID = Outline.Stop.row(id, item.id).key
                DispatchQueue.main.async { keyboardDriven = false }
            }
        case nil:
            break
        }
    }

    /// Saves the channel once the user is done typing, so the co-stream check
    /// doesn't restart on every keystroke.
    private func commitChannel() {
        var handle = channelDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        // An empty field goes back to the default channel (the toggle turns co-streams off).
        if handle.isEmpty {
            handle = "ohnepixel"
            channelDraft = handle
        }
        if handle != store.coStreamer { store.coStreamer = handle }
    }

    private func load() async {
        loading = true
        initialPicks = store.picks(for: league)
        let loaded: [TeamOption]?
        do {
            loaded = try await TeamCatalog.options(for: league)
        } catch {
            loaded = nil
        }
        // The list assembles like a page entrance, in the same transaction as the data.
        arrival = .data(in: Self.contentSpace, page: page)
        if let loaded { options = loaded }
        failed = loaded == nil
        // Conferences holding a picked or followed team start open; the rest
        // start closed (or as the user left them this session).
        let mine = initialPicks.union(store.followed.map(\.id))
        groups.prepare(scope: "picks.\(league.id)",
                       PickOutline.sections(options, query: "", picks: initialPicks).filter { $0.kind != .plain }
                           .map { (id: $0.id, members: $0.kind == .disclosure ? $0.options.map(\.id) : []) },
                       mine: mine)
        loading = false
        // Type-to-filter straight away on long lists.
        if options.count > 12 && showsPicks { searchFocused = true }
    }
}

/// One section of the picker: a plain list ("Selected", a short list,
/// search results), a long one capped at its first dozen with "Show All N",
/// or a conference that opens and closes (`flag`). Equatable on what it
/// shows, so picking a team re-runs only the sections holding it, and
/// opening a group (its own `flag`) re-runs only that group.
private struct PickSectionView: View {
    let section: PickSection
    /// A disclosure group's open state, or a capped list's "Show All".
    let flag: DisclosureFlag?
    let highlight: HighlightState
    /// The section's picked rows.
    let picked: Set<String>
    let followable: Bool
    let maxLogos: Int
    /// "3 selected" beside a lone list's label.
    let note: String?
    /// "team" or "country", for VoiceOver and "Show All".
    let noun: String
    let onHover: (String, Bool) -> Void
    let togglePick: (String) -> Void
    let toggleGroup: () -> Void
    let showAll: () -> Void
    @Namespace private var crestSpace

    var body: some View {
        switch section.kind {
        case .disclosure:
            disclosure
        case .plain, .capped:
            label
            let shown = Outline.visibleCount(section.options.count, showingAll: flag?.open ?? true)
            rows(Array(section.options.prefix(shown)), revealing: false)
            if shown < section.options.count {
                more(remaining: section.options.count)
            }
        }
    }

    private var label: some View {
        HStack {
            GroupLabel(title: section.title, symbol: section.symbol)
            Spacer()
            if let note {
                Text(note).font(.system(size: 10.5)).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 5)
    }

    // MARK: Disclosure

    @ViewBuilder
    private var disclosure: some View {
        let flag = flag ?? DisclosureFlag(open: true)
        let open = flag.open
        // Crests link to the rows only while this group is toggling.
        let linked = flag.animating ? crestSpace : nil
        let selected = picked.isEmpty ? nil : "\(picked.count) selected"
        HighlightGate(state: highlight, id: Outline.Stop.header(section.id).key) { lit in
            DisclosureHeader(title: section.title, count: section.options.count, noun: noun, open: open,
                             highlighted: lit && highlight.keyboard, spokenPreview: selected, toggle: toggleGroup) {
                CrestStrip(group: section.id,
                           crests: section.options.prefix(maxLogos).map { CrestStrip.Crest(id: $0.id, name: $0.name, logo: $0.logo, darkLogo: $0.darkLogo) },
                           note: selected, revealNote: flag.collapsing)
            }
            .equatable()
        }
        .id(Outline.Stop.header(section.id).key)
        .environment(\.logoNamespace, linked)
        if open {
            rows(section.options, revealing: flag.revealing, fadesIn: flag.revealing)
                // Rows arrive in place (crests travel, text staggers in) and
                // leave quickly, faster than they came.
                .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
                .environment(\.logoNamespace, linked)
        }
    }

    // MARK: Rows

    /// Lazy: only rows on screen are built.
    private func rows(_ options: [TeamOption], revealing: Bool, fadesIn: Bool = false) -> some View {
        OutlineBox(fadesIn: fadesIn) {
            LazyVStack(spacing: 0) {
                ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                    let key = Outline.Stop.row(section.id, option.id).key
                    HighlightGate(state: highlight, id: key) { lit in
                        PickRow(option: option, picked: picked.contains(option.id), followable: followable, highlighted: lit,
                                keyboard: lit && highlight.keyboard, divider: index > 0,
                                crest: section.kind == .disclosure && index < maxLogos
                                    ? Outline.crestID(group: section.id, item: option.id) : nil,
                                revealDelay: revealing ? ScoresGrid.revealDelay(index: index, columns: 1) : nil,
                                onHover: { onHover(key, $0) }) {
                            togglePick(option.id)
                        }
                        .equatable()
                    }
                    .id(key)
                }
            }
        }
    }

    /// "Show All 60", in place of the rest: the app's one "show the rest" link.
    private func more(remaining count: Int) -> some View {
        let key = Outline.Stop.more(section.id).key
        return HighlightGate(state: highlight, id: key) { lit in
            ProfileMoreButton(title: "Show All \(count)", action: showAll)
                .padding(.horizontal, 8)
                .background {
                    // The arrow keys can land here: it wears the list's keyboard highlight.
                    if lit && highlight.keyboard {
                        RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color.accentColor.opacity(0.16))
                            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(Color.accentColor.opacity(0.5), lineWidth: 1))
                    }
                }
                // Says what it reveals.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Show all \(plural(count, noun, plural: noun == "country" ? "countries" : nil))")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction(.default, showAll)
        }
        .id(key)
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
    }
}

extension PickSectionView: @MainActor Equatable {
    static func == (a: PickSectionView, b: PickSectionView) -> Bool {
        a.section == b.section && a.flag === b.flag && a.picked == b.picked && a.followable == b.followable
            && a.maxLogos == b.maxLogos && a.note == b.note && a.noun == b.noun
    }
}

private struct PickRow: View {
    @Environment(ScoreStore.self) private var store
    let option: TeamOption
    let picked: Bool
    let followable: Bool
    let highlighted: Bool
    /// Typing or the arrow keys moved the highlight here (it then wears the accent).
    var keyboard = false
    /// A hairline above (every row but the first). Drawn over the row, so
    /// each row is one view (constant per row in the lazy stack).
    var divider = false
    /// Its crest's identity in a group's collapsed preview: it travels there
    /// and back while the group toggles (`\.logoNamespace`).
    var crest: String? = nil
    /// Just revealed by opening its group: the text arrives after this delay
    /// (staggered per row) while the crest travels in.
    var revealDelay: Double? = nil
    let onHover: (Bool) -> Void
    let toggle: () -> Void
    @State private var starHovering = false
    @State private var revealed = false
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var textShown: Bool { revealDelay == nil || revealed }

    var body: some View {
        // The whole row picks; the star sits on top of it and only follows.
        Button(action: toggle) {
            HStack(spacing: 8) {
                if followable {
                    // A crest from the preview stays opaque, so it can travel in;
                    // the rest arrive with their row's text (a long group's
                    // later rows would otherwise sit over what's sliding below).
                    LogoView(url: option.logo, darkURL: option.darkLogo, size: 18)
                        .matchedLogo(crest)
                        .opacity(crest != nil || textShown ? 1 : 0)
                } else if let flag = option.flag {
                    Text(flag).font(.system(size: 15)).reveal(textShown, reduceMotion: reduceMotion)
                }
                Text(option.name).font(.system(size: 13)).lineLimit(1)
                    .reveal(textShown, reduceMotion: reduceMotion)
                Spacer(minLength: 6)
                if followable { Color.clear.frame(width: 22, height: 1) }  // room for the star
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 14))
                    .foregroundStyle(picked ? Color.accentColor : Color.secondary.opacity(0.45))
                    .contentTransition(.symbolEffect(.replace))
                    .reveal(textShown, reduceMotion: reduceMotion)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .buttonStyle(ListRowStyle(hovering: highlighted, keyboard: keyboard))
        .overlay(alignment: .trailing) {
            if followable { star.padding(.trailing, 12 + 14 + 8).reveal(textShown, reduceMotion: reduceMotion) }
        }
        .overlay(alignment: .top) {
            if divider { Divider().padding(.leading, followable ? 40 : 12) }
        }
        .onHover(perform: onHover)
        .accessibilityAddTraits(picked ? .isSelected : [])
        // Waits, then animates: a delayed animation in flight would let a crest
        // whose image lands meanwhile jump straight to visible.
        .task(id: revealDelay == nil) {
            guard let delay = revealDelay, !revealed else { return }
            if !reduceMotion { try? await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? Motion.exit : Motion.reveal) { revealed = true }
        }
    }

    private var star: some View {
        let competitor = Competitor(id: option.id, name: option.name, abbreviation: option.name,
                                    score: nil, logo: option.logo, isWinner: false)
        let following = store.isFollowing(competitor)
        return Button { store.toggleFollow(competitor) } label: {
            Image(systemName: following ? "star.fill" : "star")
                .font(.system(size: 12))
                .foregroundStyle(following ? Color.yellow
                                 : Color.secondary.opacity(starHovering ? 0.9 : contrast == .increased ? 0.8 : (highlighted ? 0.65 : 0.5)))
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { starHovering = $0 }
        .help(following ? "Unfollow \(option.name)" : "Follow \(option.name): My Teams, alerts, menu bar score")
        .accessibilityLabel(following ? "Unfollow \(option.name)" : "Follow \(option.name)")
    }
}

/// A row redraws when what it shows changes (its pick, its highlight), not on
/// every hover elsewhere in a 700-team list.
extension PickRow: @MainActor Equatable {
    static func == (a: PickRow, b: PickRow) -> Bool {
        a.option == b.option && a.picked == b.picked && a.followable == b.followable && a.highlighted == b.highlighted
            && a.keyboard == b.keyboard && a.divider == b.divider && a.crest == b.crest && a.revealDelay == b.revealDelay
    }
}

// MARK: - The picker's outline

/// A section of the team picker, decided from the list alone.
struct PickSection: Identifiable, Equatable {
    let id: String
    let title: String
    let symbol: String
    let options: [TeamOption]
    let kind: Outline.Section.Kind

    var outline: Outline.Section { Outline.Section(id: id, kind: kind, items: options.map(\.id)) }
}

enum PickOutline {
    static let selected = "selected", rest = "all", matches = "matches"

    static func groupID(_ name: String) -> String { "conf:\(name)" }

    /// The picker's sections:
    /// - Searching: every match, flat, across all groups (alphabetical where
    ///   the list is grouped).
    /// - Otherwise the picks as of opening ("Selected", open), then the rest:
    ///   - 24 or fewer in all: listed in full, as always;
    ///   - natural groups (college conferences): one collapsible group each,
    ///     whole (a picked team is also in its conference), in the list's order;
    ///   - no groups: the rest in order, capped at its first dozen ("Show All").
    static func sections(_ options: [TeamOption], query: String, picks: Set<String>,
                         noun: String = "Teams", symbol: String = "person.3") -> [PickSection] {
        let grouped = options.count > Outline.threshold && Set(options.compactMap(\.group)).count > 1
        let q = query.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty {
            var matches = options.filter { $0.name.localizedCaseInsensitiveContains(q) }
            if grouped { matches.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending } }
            return matches.isEmpty ? [] : [PickSection(id: Self.matches, title: noun, symbol: symbol, options: matches, kind: .plain)]
        }
        let mine = options.filter { picks.contains($0.id) }
        var sections = mine.isEmpty ? [] : [PickSection(id: Self.selected, title: "Selected", symbol: "checkmark.circle", options: mine, kind: .plain)]
        if grouped {
            var order: [String] = []
            var members: [String: [TeamOption]] = [:]
            for option in options {
                let group = option.group ?? "Other"
                if members[group] == nil { order.append(group) }
                members[group, default: []].append(option)
            }
            sections += order.map { PickSection(id: groupID($0), title: $0, symbol: symbol, options: members[$0] ?? [], kind: .disclosure) }
            return sections
        }
        let rest = options.filter { !picks.contains($0.id) }
        guard !rest.isEmpty else { return sections }
        let kind: Outline.Section.Kind = options.count > Outline.threshold ? .capped : .plain
        sections.append(PickSection(id: Self.rest, title: mine.isEmpty ? noun : "All \(noun)", symbol: symbol, options: rest, kind: kind))
        return sections
    }
}

/// Six rows shaped like the team list's (crest or flag, name, the pick
/// circle), in the list's own box, while a slow list loads. Static.
private struct PickListSkeleton: View {
    let flags: Bool

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<6, id: \.self) { i in
                if i > 0 { Divider().padding(.leading, flags ? 12 : 40) }
                HStack(spacing: 8) {
                    if flags {
                        RoundedRectangle(cornerRadius: 2).frame(width: 18, height: 13)
                    } else {
                        Circle().frame(width: 18, height: 18)
                    }
                    RoundedRectangle(cornerRadius: 3).frame(width: CGFloat([120, 96, 140, 108, 84, 128][i]), height: 9)
                    Spacer(minLength: 6)
                    Circle().frame(width: 14, height: 14)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
            }
        }
        .foregroundStyle(Color.primary.opacity(0.07))
        .padding(.vertical, 3)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.045)))
        .padding(.horizontal, 12)
        .padding(.top, 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(flags ? "Loading countries" : "Loading teams")
    }
}
