import SwiftUI

/// A person: who they are, how they're playing this season, their recent
/// games and their career. Leads with this season (four tiles, ranked where
/// it means something), then the game-log strip, then sport sections, bio,
/// career and the status note. One column, or two from 680pt.
///
/// Standalone like `TeamPage`: a reference and a back action; the navigator
/// and score store come from the environment when present.
struct PlayerPage: View {
    let ref: Profile.PlayerRef
    var backTitle: String = "Scores"
    let onBack: () -> Void

    @State private var state: PlayerState
    @State private var arrival: StackArrival?
    /// Bumped when the team's logo colors arrive, so the wash takes them.
    @State private var colorsVersion = 0
    private let store: ProfileStore

    @Environment(ScoreStore.self) private var scores: ScoreStore?
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    @Environment(\.panelLayout) private var layout
    @Environment(\.stackArrival) private var page
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let contentSpace = "player.content"

    init(ref: Profile.PlayerRef, backTitle: String = "Scores", store: ProfileStore? = nil, onBack: @escaping () -> Void) {
        self.ref = ref
        self.backTitle = backTitle
        self.onBack = onBack
        let store = store ?? .shared
        self.store = store
        _state = State(initialValue: store.state(for: ref))
    }

    enum Section: Hashable {
        case season, gameLog, mapPool, podiums, results, note, competitions, table, about, career, awards
    }

    var body: some View {
        VStack(spacing: 0) {
            header.stackIn().pageChrome()
            PageScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    hero.stackIn()
                    if let live = liveEvent { liveStrip(live).stackIn() }
                    StackContainer(layout: AnyLayout(MatchColumnsLayout(columns: layout.columns))) { content }
                        .accessibilityElement(children: .contain)
                        .coordinateSpace(name: Self.contentSpace)
                        .environment(\.stackArrival, arrival ?? page)
                    footer
                }
                .padding(.bottom, 14)
            }
        }
        .background(alignment: .top) {
            // The team's colors arrive as a change of light: the new wash
            // crossfades in over the old.
            ZStack { wash.id(colorsVersion).transition(.opacity) }
                .animation(reduceMotion ? Motion.fade : Motion.light, value: colorsVersion)
                .frame(height: 250)
                .ignoresSafeArea()
                .stackIn(slides: false)
        }
        .pageLoading(state.profile.bio == nil && !state.loaded)
        .task(id: ref.key) {
            await store.load(ref)
            await ProfileColors.awaitLogoColors(team?.logo) { colorsVersion += 1 }
        }
        .onChange(of: shown) { old, new in
            if new.count > old.count { arrival = .data(in: Self.contentSpace, page: page) }
        }
    }

    private var bio: Profile.Bio { state.bio }
    private var team: Profile.TeamRef? { bio.team ?? ref.team }
    private var session: ProfileStore.PageSession { store.session[ref.memoryKey] ?? .init() }

    // MARK: Header

    /// No title: the hero below is the page's heading.
    private var header: some View {
        HStack(spacing: 6) {
            BackButton(title: backTitle, action: onBack)
            Spacer()
            if let link = bio.link {
                GlassGroup(spacing: 6) {
                    IconButton(symbol: "safari", label: "Open in Browser") { NSWorkspace.shared.open(link) }
                }
            }
        }
        .pageHeader()
    }

    // MARK: Hero

    private var colors: (Color, Color)? {
        _ = colorsVersion
        if ref.sport == .climbing, let c = FlagPalette.colors(ioc: bio.country ?? ref.country) { return (c.0, c.1) }
        return ProfileColors.team(team, scheme: scheme)
    }

    private var tint: Color { colors?.0 ?? .accentColor }

    /// The match page's wash, at the match page's strength.
    private var wash: some View {
        let c = colors
        return HeroWash(left: c?.0 ?? .accentColor, right: c?.1 ?? .accentColor,
                        intensity: c == nil ? 0.6 : ref.sport == .climbing ? 0.85 : 1)
    }

    private var hero: some View {
        HStack(alignment: .center, spacing: 14) {
            PlayerPhoto(url: bio.photo ?? ref.photo, name: bio.name, tint: tint, size: 76,
                        crop: ref.sport == .climbing ? .portrait : .cutout)
                .background(HeroGlow(color: tint, diameter: 94))
            VStack(alignment: .leading, spacing: 3) {
                Text(bio.name)
                    .font(.system(size: 17, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let real = bio.realName {
                    Text(real).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
                identityLine
                if let facts = factsLine {
                    Text(facts).font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
                        .accessibilityLabel(factsSpoken ?? facts)
                }
                if let injury = state.profile.injury {
                    statusLine(injury).padding(.top, 2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard(cornerRadius: Metrics.heroRadius, clear: true)
        .padding(.horizontal, 10)
        .padding(.top, 6)
        .padding(.bottom, 4)
        .pageHero()
        // The team link inside the merged hero, as an action (the menus' words).
        .accessibilityActions {
            if let team, team.isSupported, ref.sport != .climbing, let navigator {
                Button("Go to \(team.name)") { navigator.open(team) }
            }
        }
    }

    /// "#15 · Quarterback · Chiefs" (the team is a link); "🇸🇮 Slovenia" for climbers.
    @ViewBuilder
    private var identityLine: some View {
        // Long position names ("Designated Hitter") give way to their abbreviation.
        let position = (bio.position?.count ?? 0) > 12 ? bio.positionAbbreviation ?? bio.position : bio.position ?? bio.positionAbbreviation
        let parts = [bio.jersey.map { "#\($0)" }, position].compactMap { $0 }
        HStack(spacing: 0) {
            if ref.sport == .climbing {
                Text([Flag.emoji(ioc: bio.country), bio.nationality].compactMap { $0 }.joined(separator: " "))
            } else {
                if !parts.isEmpty { Text(parts.joined(separator: " · ") + (team != nil ? " · " : "")) }
                if let team {
                    if team.isSupported, navigator != nil {
                        QuietLink(help: "Go to \(team.name)", hint: LinkHint.team, action: { navigator?.open(team) },
                                  onDwell: { store.prefetch(team) }) { Text(team.name) }
                            .fixedSize()
                            .layoutPriority(1)
                    } else {
                        Text(team.name).layoutPriority(1)
                    }
                } else if state.profile.bio != nil, ref.sport != .esports {
                    Text(bio.active ? "Free agent" : "Retired")
                }
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }

    /// "31 · 6′2″ · 225 lb"; college "Sophomore · 6′4″"; climbers "27 · 164 cm · Slovenj Gradec".
    private var factsLine: String? {
        var parts: [String] = []
        if ref.isCollege, let year = bio.classYear { parts.append(year) } else if let age = bio.age { parts.append("\(age)") }
        if let h = bio.height { parts.append(Self.height(h)) }
        if let w = bio.weight { parts.append(w.replacingOccurrences(of: " lbs", with: " lb")) }
        if ref.sport == .climbing, let city = bio.hometown { parts.append(city) }
        if ref.sport == .esports, let nation = bio.nationality { parts.insert("\(Flag.emoji(iso2: bio.country) ?? "") \(nation)", at: 0) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// The facts line as VoiceOver should say it: "31 years old, 6 feet 2
    /// inches, 225 pounds" (primes read as "prime", "lb" as letters).
    private var factsSpoken: String? {
        var parts: [String] = []
        if ref.isCollege, let year = bio.classYear { parts.append(year) } else if let age = bio.age { parts.append("\(age) years old") }
        if let h = bio.height { parts.append(Self.spokenHeight(h)) }
        if let w = bio.weight { parts.append(w.replacingOccurrences(of: " lbs", with: " pounds").replacingOccurrences(of: " lb", with: " pounds")) }
        if ref.sport == .climbing, let city = bio.hometown { parts.append(city) }
        if ref.sport == .esports, let nation = bio.nationality { parts.insert(nation, at: 0) }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// ESPN's "6' 2\"" in typographic primes.
    nonisolated static func height(_ s: String) -> String {
        s.replacingOccurrences(of: "' ", with: "′").replacingOccurrences(of: "\"", with: "″")
    }

    /// "6' 2\"" → "6 feet 2 inches"; "164 cm" stays as is.
    nonisolated static func spokenHeight(_ s: String) -> String {
        let digits = s.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }
        guard s.contains("'"), let feet = digits.first else { return s }
        let inches = digits.count > 1 ? digits[1] : 0
        return "\(feet) feet" + (inches > 0 ? " \(inches) \(inches == 1 ? "inch" : "inches")" : "")
    }

    /// "Out · Hamstring · Expected back Nov 1"; where that doesn't fit, "Out · Back Nov 1", then the status alone.
    private func statusLine(_ injury: Profile.InjuryNote) -> some View {
        let back = injury.returnDate.flatMap { $0 > .now ? "Expected back \(ProfileFormat.short($0))" : nil }
        let full = [injury.detail, back].compactMap { $0 }
        let short = full.map { RosterRow.short($0).replacingOccurrences(of: "Expected back", with: "Back") }
        return ViewThatFits(in: .horizontal) {
            statusText(injury, full).fixedSize()
            statusText(injury, short).fixedSize()
            statusText(injury, short.suffix(1)).fixedSize()
            statusText(injury, []).lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(([injury.status] + full).joined(separator: ", "))
    }

    private func statusText(_ injury: Profile.InjuryNote, _ parts: some Collection<String>) -> Text {
        let out = injury.status.lowercased().hasPrefix("out") || injury.status.contains("Reserve")
        return (Text(injury.status).fontWeight(out ? .semibold : .regular).foregroundColor(.primary)
            + Text(parts.map { " · \($0)" }.joined()).foregroundColor(.secondary))
            .font(.system(size: 11))
    }

    // MARK: Live

    private var liveEvent: Event? {
        guard let id = team?.id else { return nil }
        return scores?.sections.lazy.flatMap(\.events).first { $0.state == .live && $0.competitors.contains { $0.id == id } }
    }

    private func liveStrip(_ event: Event) -> some View {
        LiveStrip(event: event) { navigator?.open(event) }
    }

    // MARK: Sections

    private var order: [Section] {
        switch ref.sport {
        case .esports: [.season, .gameLog, .mapPool, .about]
        case .climbing: [.season, .podiums, .results, .about]
        case .soccer: [.season, .gameLog, .competitions, .about]
        default: [.season, .gameLog, .note, .table, .about, .career, .awards]
        }
    }

    private var shown: [Section] { order.filter(has) }

    private func has(_ s: Section) -> Bool {
        let p = state.profile
        switch s {
        case .season: return !p.tiles.isEmpty || !state.loaded
        case .gameLog: return !(p.gameLog?.entries.isEmpty ?? true)
        case .mapPool: return !p.mapPool.isEmpty
        case .podiums: return !p.podiums.isEmpty || !p.worldChampionships.isEmpty
        case .results: return !p.results.isEmpty
        case .note: return p.note.map { note in note.published.map { Date().timeIntervalSince($0) < 14 * 86400 } ?? true } ?? false
        case .competitions: return !(p.competitions?.rows.isEmpty ?? true)
        case .table: return !(p.season?.rows.isEmpty ?? true)
        case .about: return p.bio != nil && !AboutFacts.facts(bio: bio, sport: ref.sport, college: ref.isCollege, profile: p).isEmpty
        case .career: return ref.sport != .soccer && ref.sport != .esports && ref.sport != .climbing && p.bio != nil
        case .awards: return !p.awards.isEmpty
        }
    }

    /// From 680pt: what he's doing (season, games, viz) on the left; who he is (bio, career) on the right.
    private func slot(_ s: Section, rank: Int) -> MatchSlot {
        guard layout.split else { return MatchSlot() }
        if s == .season { return MatchSlot(column: .span, rank: rank) }
        let right: Set<Section> = [.about, .career, .awards, .table]
        return MatchSlot(column: right.contains(s) ? .right : .left, rank: rank)
    }

    @ViewBuilder
    private var content: some View {
        let sections = shown
        ForEach(Array(sections.enumerated()), id: \.element) { index, s in
            let slot = slot(s, rank: index)
            section(s)
                .environment(\.widthClass, layout.split && slot.column != .span ? layout.column : layout.page)
                .matchSlot(slot.column, rank: slot.rank)
        }
    }

    @ViewBuilder
    private func section(_ s: Section) -> some View {
        let p = state.profile
        switch s {
        case .season:
            DetailSection(title: seasonTitle, caption: seasonCaption) {
                if p.tiles.isEmpty {
                    TileSkeleton()
                } else {
                    StatTiles(tiles: p.tiles, rankSuffix: rankSuffix)
                    if lagging {
                        Text("Season averages update a few hours after each game.")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        case .gameLog:
            GameLogSection(ref: ref, profile: p, team: team, tint: tint, session: session, store: store)
        case .mapPool:
            DetailSection(title: "Map Pool", caption: "Average bo3 rating per map, career. The line is his overall rating.") {
                MapPoolBars(maps: Array(p.mapPool.prefix(9)), tint: tint)
            }
        case .podiums:
            DetailSection(title: "Podiums", caption: "World Cup podiums by discipline, then World Championships.") {
                PodiumRows(podiums: p.podiums, championships: p.worldChampionships)
            }
        case .results:
            DetailSection(title: "Results", caption: "\(p.resultCount) results on record, newest first.") {
                let all = session.expanded.contains("results")
                ResultRows(results: all ? p.results : Array(p.results.prefix(12)))
                if !all, p.results.count > 12 {
                    ProfileMoreButton(title: "All Results (\(p.results.count))") {
                        store.session[ref.memoryKey, default: .init()].expanded.insert("results")
                    }
                }
            }
        case .note:
            if let note = p.note {
                DetailSection(title: "Latest", caption: "From RotoWire.") { NoteView(note: note) }
            }
        case .competitions:
            if let table = p.competitions {
                DetailSection(title: "All Competitions", caption: "This season, club and country.") {
                    StatTableView(table: table, keys: [("starts", .compact), ("totalGoals", .compact), ("goalAssists", .compact),
                                                       ("totalShots", .medium), ("yellowCards", .large)], titleWidth: 140)
                }
            }
        case .table:
            if let table = p.season {
                DetailSection(title: "Season & Career", caption: "This season and career, from ESPN.") {
                    StatTableView(table: table, keys: PlayerColumns.season(sport: ref.sport, position: bio.positionAbbreviation),
                                  titleWidth: 104)
                }
            }
        case .about:
            DetailSection(title: "About", caption: aboutCaption) {
                AboutGrid(facts: AboutFacts.facts(bio: bio, sport: ref.sport, college: ref.isCollege, profile: p))
            }
        case .career:
            DetailSection(title: "Career by Season", caption: "Each season's line, from ESPN.") {
                CareerSection(ref: ref, state: state, store: store, position: bio.positionAbbreviation)
            }
        case .awards:
            DetailSection(title: "Awards", caption: "Honors from ESPN.") { FlowChips(items: p.awards) }
        }
    }

    private var aboutCaption: String {
        switch ref.sport {
        case .esports: "From bo3.gg."
        case .climbing: "From World Climbing (IFSC)."
        default: "From ESPN."
        }
    }

    private var seasonTitle: String {
        switch ref.sport {
        case .esports: "Form"
        case .climbing: "World Cup"
        default: "This Season"
        }
    }

    private var seasonCaption: String? {
        if ref.sport == .climbing { return "This season's World Cup ranks by discipline." }
        if ref.sport == .esports { return "bo3.gg's rating, and career kills, damage and headshots." }
        guard let caption = state.profile.tilesCaption else { return nil }
        // ESPN's "2026-27 Premier League Stats": a caption, not a title.
        let text = caption.hasSuffix(" Stats") ? String(caption.dropLast(5)) + "stats" : caption
        return text.capitalizedFirst + "."
    }

    private var rankSuffix: String? {
        switch ref.sport {
        case .basketball: "in the NBA"
        case .football: ref.isCollege ? "in the FBS" : "in the NFL"
        case .baseball: "in MLB"
        case .soccer: "in the league"
        default: nil
        }
    }

    /// The log has more games this season than the averages count (ESPN updates them hours later).
    private var lagging: Bool {
        guard let log = state.profile.gameLog, ref.sport == .basketball || ref.sport == .football else { return false }
        let regular = log.entries.filter { !$0.postseason && $0.played }.count
        guard let gp = state.profile.season?.rows.first.flatMap({ row -> Int? in
            guard let i = state.profile.season?.keys.firstIndex(of: "gamesPlayed"), i < row.values.count else { return nil }
            return Int(row.values[i])
        }) else { return false }
        return regular > gp
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        if state.loaded, state.profile.bio == nil {
            if state.failed.contains(.bio) {
                // The request failed: nothing retries on its own, so say so.
                ErrorState("Player", retry: reload)
            } else {
                // The source answered, with nobody: trying again won't help.
                EmptyState(symbol: "person.crop.circle.badge.questionmark", title: "Player Not Available",
                           message: "Scoreline doesn't have a page for this player yet.")
            }
        } else if state.failed.contains(.gameLog), state.profile.gameLog == nil, ref.sport != .climbing {
            ProfileFootnote(text: "Couldn't load the game log.") { reload() }
        }
    }

    private func reload() {
        Task { await store.load(ref, force: true) }
    }
}

/// Static placeholder tiles while the season loads.
struct TileSkeleton: View {
    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 5) {
                    RoundedRectangle(cornerRadius: 4).fill(Color.primary.opacity(0.08)).frame(width: 44, height: 18)
                    RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.05)).frame(width: 30, height: 7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading this season")
    }
}
