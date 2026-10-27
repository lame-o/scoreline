import Synchronization
import SwiftUI

struct DetailView: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    /// How this page was entered: decides whether arriving data stacks or fades.
    @Environment(\.stackArrival) private var page
    /// One column, or two from 680pt (coarse: changes only at a breakpoint).
    @Environment(\.panelLayout) private var layout
    /// ⌘R and the status menu's Refresh (PanelController.swift).
    @Environment(PanelCommands.self) private var commands: PanelCommands?
    @Environment(\.panelResizing) private var resizing
    @Environment(\.celebrationLevel) private var celebrationLevel
    /// Opens team and player pages (RootView's; nil in previews, and names stay plain).
    /// A stable object with no observed state: reading it never re-runs this body.
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    let snapshot: Event
    let onBack: () -> Void
    var onOpenStandings: (League) -> Void = { _ in }
    /// Opens a bracket, with the team IDs of this match to ring.
    var onOpenBracket: (BracketSource, Set<String>) -> Void = { _, _ in }
    /// Opens a league's polls (college football's Top 25).
    var onOpenRankings: (League) -> Void = { _ in }
    /// The page Back returns to ("Scores", "Schedule").
    let backTitle: String

    /// The event as the store last had it. Held here, not read through
    /// `store.current` (which observes every poll): `LiveEventSync` reads the
    /// store and writes this only when the event actually changed.
    @State private var live: Event
    /// Live games in this page's table league (the projected table), synced the same way.
    @State private var leagueLive: [Event] = []
    @State private var detail: GameDetail?
    @State private var failed = false
    /// When the detail last loaded, and how many refreshes in a row have
    /// failed since: two or more on a live game, and the page says it's stale.
    @State private var lastLoaded: Date?
    @State private var detailFailures = 0
    /// While every score feed is failing: when the scores last updated.
    @State private var storeStaleSince: Date?
    @State private var standings: [StandingsRow] = []
    /// Set when the first data replaces the spinner, so it assembles like a page.
    @State private var arrival: StackArrival?
    /// Soccer pitch and table appear together with the rest (or glide in once ready).
    @State private var extrasShown = false
    @State private var showSpinner = false
    /// What the pointer is on, so every chart on the page can light it up.
    @State private var linked = LinkedFocus()
    /// College: AP ranks by team ID, for the conference table.
    @State private var collegeRanks: [String: Int] = [:]
    /// Football's real-time lane: spot, down and clock every few seconds.
    @State private var footballFeed = FootballFeed()
    /// The page's one live moment: what just happened, shown by its chart.
    @State private var moments = MomentCenter()
    /// Baseball's real-time lane: count, runners and each pitch as it's thrown.
    @State private var baseballFeed = BaseballFeed()
    /// The NBA's real-time lane: clock, score and each shot as it's taken.
    @State private var basketballFeed = BasketballFeed()
    /// NBA: the court's replay and the player picked in the box score or leaders, shared by every NBA view.
    @State private var nbaStage = NBAStage()
    /// The hero scoreboard's beats: digit pops, the wash pulse, the glint, the trophy.
    @State private var beats = HeroBeats()
    /// Climbing, live: who moved up or down the results in the last refresh.
    @State private var rankShift = RankShift()
    /// Where the page's sections are and how far the hero has docked: the
    /// docked scorebar and the chart peek read it; this page never does, so
    /// scrolling never re-renders it.
    @State private var geometry = PageGeometry()
    /// The chart peek's timing and placement.
    @State private var peek = PeekController()
    /// Which scoreboard is on screen (hero or docked bar), flipped only at half docked.
    @State private var surface = ScoreboardSurface()
    /// Whether the pointer is over the page's content (a reference: writing it re-renders nothing).
    @State private var pointer = PointerPresence()
    #if DEBUG
    @Environment(\.pageProbe) private var probe
    /// Harness counter: body runs (scrolling must add none).
    static var bodyRuns = 0
    #endif

    /// Live score and status come from the store's regular refresh; the richer
    /// detail refreshes on its own cadence while this page is open.
    private var event: Event { live }
    private var soccerFeed: SoccerFeed { store.soccerFeed(for: snapshot.id) }

    private static let contentSpace = "detail.content"
    /// Each team's column in the hero. Never reached at 340 (about 97pt each there).
    static let heroTeamWidth: CGFloat = 220

    /// `preloaded` and `standings` show data immediately (previews, snapshots);
    /// the page still refreshes on its own.
    init(snapshot: Event, onBack: @escaping () -> Void, onOpenStandings: @escaping (League) -> Void = { _ in },
         onOpenBracket: @escaping (BracketSource, Set<String>) -> Void = { _, _ in },
         onOpenRankings: @escaping (League) -> Void = { _ in }, backTitle: String = "Scores",
         preloaded: GameDetail? = nil, standings: [StandingsRow] = []) {
        self.snapshot = snapshot
        _live = State(initialValue: snapshot)
        self.onBack = onBack
        self.onOpenStandings = onOpenStandings
        self.onOpenBracket = onOpenBracket
        self.onOpenRankings = onOpenRankings
        self.backTitle = backTitle
        _detail = State(initialValue: preloaded)
        _standings = State(initialValue: standings)
        _extrasShown = State(initialValue: preloaded != nil)
    }

    var body: some View {
        #if DEBUG
        let _ = Self.bodyRuns += 1
        #endif
        // No divider under the header: the team-color wash runs straight up to it.
        VStack(spacing: 0) {
            header.stackIn().pageChrome()
            // Arrows, Page Up/Down, Space, Home and End scroll the page.
            PageScrollView(keyboardScrolls: true) {
                VStack(alignment: .leading, spacing: 0) {
                    hero.stackIn()
                    // One column, or two from 680pt. The same children either
                    // way, so crossing the breakpoint never rebuilds a section.
                    StackContainer(layout: AnyLayout(MatchColumnsLayout(columns: layout.columns))) { content }
                        // VoiceOver reads the columns in order, not across them.
                        .accessibilityElement(children: .contain)
                        .coordinateSpace(name: Self.contentSpace)
                        .environment(\.stackArrival, arrival ?? page)
                        // Rows below build their team and player links from these.
                        .environment(\.profilePath, espnPath)
                        .environment(\.profileLeague, profileLeague)
                        // A hovered row can vanish in a live update without a
                        // "pointer left"; leaving the page always clears it.
                        .onHover { inside in pointerMoved(inside: inside) }
                        // Charts draw short names; VoiceOver says the full ones.
                        .environment(\.spokenTeams, spokenTeams)
                }
                .padding(.bottom, 14)
            }
            // The docked scorebar and the chart peek float over the scroll
            // view: neither ever changes the page's measured height.
            .overlay(alignment: .top) {
                DockedScorebarHost(bar: dockBar, beats: beats, moments: moments, pinEvent: event, pinned: store.pinnedID == event.id)
            }
            .overlay {
                LinkedPeekHost(controller: peek, route: { focus, source in peekRoute(focus, source: source) },
                               readout: { focus, section in peekReadout(focus, section) }, title: peekTitle,
                               aspect: peekAspect) { section, focus in
                    peekChart(section, focus: focus)
                }
            }
            .environment(\.pageGeometry, geometry)
            .environment(\.scoreboardSurface, surface)
            .environment(linked)
            .environment(moments)
            .environment(nbaStage)
            // NBA: players on fire, ESPN's scoring run (CourtView, GameFlowView, BoxScoreView, LeadersView).
            .environment(basketballFeed)
            .environment(\.peekShow, peekShow)
        }
        // Polls re-run only this modifier; the page re-renders when its event (or its table's live games) changed.
        .modifier(LiveEventSync(snapshot: snapshot, league: tableLeague, live: $live, leagueLive: $leagueLive,
                                staleSince: $storeStaleSince))
        // The wash sits behind the whole page, not inside the scroll content, so
        // it starts at the panel's top edge (under the header and its glass
        // buttons) and fades out below the card with no hard edge.
        .background(alignment: .top) {
            // Fades in with the page instead of appearing at full strength
            // behind the outgoing one.
            // A new climber's colors crossfade in, slowly enough to feel like a
            // change of light rather than a cut.
            ZStack {
                // A score lifts the scorer's side for 1.55 s (both sides on a
                // climbing page: they're the climber's flag). Only the wash
                // re-renders while it plays.
                WashPulse(trigger: beats.washPulses) { b in
                    HeroWash(left: wash.left, right: wash.right, intensity: wash.intensity,
                             boost: (beats.washSide == .bottom ? 0 : b, beats.washSide == .top ? 0 : b))
                }
                .id(washCountry ?? "none")
                .transition(.opacity)
            }
            .animation(reduceMotion ? Motion.fade : Motion.light, value: washCountry)
            .frame(height: 250)
            .ignoresSafeArea()
            .stackIn(slides: false)
        }
        .pageLoading(detail == nil && !failed)
        .delayedSpinner(while: detail == nil && !failed, show: $showSpinner)
        .task(id: snapshot.id) {
            // The soccer feed outlives the page: until it has caught up, it's history.
            if case .espn(_, _, .soccer)? = snapshot.ref { soccerFeed.beginPage() }
            await poll()
        }
        .onDisappear { moments.clear() }
        .onChange(of: snapshot.id) { nbaStage.reset() }
        #if DEBUG
        .onAppear { probe?(PageProbe(geometry: geometry, linked: linked, peek: peek, stage: nbaStage, moments: moments)) }
        #endif
        // The hero's scoreboard beat: a score-tier moment, on this page, now.
        .onChange(of: moments.current?.id) { _, _ in
            guard let m = moments.current, m.tier == .score, !resizing else { return }
            beats.score(MatchRules.scorer(of: m), decisive: m.decisive, at: .now)
            // A climbing final decided: the trophy arrives with the gold.
            if m.decisive, m.chart == .ascent { beats.trophy() }
        }
        // The hero's numbers going up (same match only: a page reused for
        // another match isn't a score).
        .onChange(of: [event.id] + heroScores) { old, new in
            guard old.count == 3, new.count == 3, old[0] == new[0] else { return }
            for side in [GameDetail.Side.top, .bottom] {
                let i = side == .top ? 1 : 2
                guard let was = old[i].flatMap(Double.init), let now = new[i].flatMap(Double.init), now > was else { continue }
                beats.scoreRose(side, at: .now)
            }
        }
        // The final whistle, while the page is open (never when it opens on a final).
        .onChange(of: event.state) { old, new in
            guard old == .live, new == .final else { return }
            finalBeat()
        }
        // While the game is live, the fast lane keeps the moving parts current.
        .task(id: "\(snapshot.id)|\(event.state == .live)") { await fastLane() }
        // ⌘R on a match refreshes the match too, not just the scores list.
        .onChange(of: commands?.refreshToken) { Task { await refreshDetail(event) } }
    }

    // MARK: Header

    private var header: some View {
        // No title: the hero below is the page's heading.
        HStack(spacing: 6) {
            BackButton(title: backTitle, action: back)
            Spacer()
            let pinned = store.pinnedID == event.id
            GlassGroup(spacing: 6) {
                HStack(spacing: 6) {
                    IconButton(symbol: pinned ? "pin.fill" : "pin", label: pinned ? "Remove from Menu Bar" : "Show in Menu Bar",
                               active: pinned) {
                        store.togglePin(event)
                    }
                    if let link = event.link {
                        IconButton(symbol: "safari", label: "Open in Browser") { NSWorkspace.shared.open(link) }
                    }
                }
            }
        }
        .pageHeader()
    }

    // MARK: Hero

    @ViewBuilder
    private var hero: some View {
        switch event.content {
        case let .match(top, bottom):
            VStack(spacing: 8) {
              VStack(spacing: 6) {
                if let caption = event.caption ?? detail?.roundName {
                    Text(caption).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(1)
                }
                HStack(alignment: .center, spacing: 0) {
                    teamColumn(top)
                    VStack(spacing: 3) {
                        if top.score != nil || bottom.score != nil {
                            let lane = laneScores
                            HStack(spacing: 10) {
                                // A final's loser steps back; nobody does on a draw (the house rule).
                                score(lane?.top ?? top.score, emphasized: !event.stepsBack(top), side: .top)
                                Text("–").foregroundStyle(.tertiary)
                                score(lane?.bottom ?? bottom.score, emphasized: !event.stepsBack(bottom), side: .bottom)
                            }
                            .font(.system(size: 30, weight: .semibold, design: .rounded).monospacedDigit())
                            // The score never wraps; team names give way first.
                            .fixedSize()
                        }
                        heroStatus(alignment: .center)
                    }
                    .frame(minWidth: 110)
                    .layoutPriority(1)
                    teamColumn(bottom)
                }
              }
              // The card spans the page; the capped team columns keep the
              // scoreboard one centered group inside it.
              .frame(maxWidth: .infinity)
              .padding(.horizontal, 8)
              .padding(.vertical, 14)
              // Clear glass lets the team colors behind it refract through.
              .floatingGlass(in: RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous), clear: true, interactive: false)
              // Decisive (or the final whistle): one sheen across the card,
              // while the hero (not the docked bar) is the scoreboard on screen.
              .scoreboardGlint(beats.glints, in: RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous), on: .hero)
              coStreamBadge
              staleNote
            }
            // Neighboring glass shapes blend as one surface.
            .modifier(GlassGroupModifier(spacing: 8))
            // Scrolling away, it shrinks toward the header and fades as the bar takes over.
            .heroTuck()
            .pageSection(PageGeometry.hero)
            .padding(.horizontal, 10)
            .padding(.top, 6)
            .padding(.bottom, 4)
            // One spoken summary, the page's heading; the links, the follow
            // stars and the co-stream badge become its actions.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(heroSpoken)
            .accessibilityAddTraits(event.state == .live ? [.isHeader, .updatesFrequently] : .isHeader)
            .accessibilityHeading(.h1)
            .accessibilityActions { heroActions(top: top, bottom: bottom) }
            .modifier(PageHeadingFocus())

        case let .field(title, summary):
            VStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                if let caption = event.caption { Text(caption).font(.system(size: 10.5)).foregroundStyle(.secondary) }
                Text(title).font(.system(size: 20, weight: .semibold))
                if !summary.isEmpty {
                    HStack(spacing: 4) {
                        // A final's winner ("Winner 🇸🇮 J. Garnbret"): a real trophy.
                        if climbingTrophy { trophy }
                        Text(summary).font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    .animation(reduceMotion ? Motion.fade : Motion.pop, value: climbingTrophy)
                }
                heroStatus(alignment: .leading).padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            // One hero style everywhere: clear glass over the page's wash.
            .floatingGlass(in: RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous), clear: true, interactive: false)
            .scoreboardGlint(beats.glints, in: RoundedRectangle(cornerRadius: Metrics.heroRadius, style: .continuous), on: .hero)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(event.state == .live ? [.isHeader, .updatesFrequently] : .isHeader)
            .accessibilityHeading(.h1)
            .modifier(PageHeadingFocus())
            staleNote
            }
            .heroTuck()
            .pageSection(PageGeometry.hero)
            .padding(.horizontal, 10)
            .padding(.top, 6)
            .padding(.bottom, 4)
        }
    }

    /// Team colors behind head-to-head matches. Climbing has no teams: its
    /// header takes the flag colors of whoever is on the wall (between
    /// climbers, the leader's; after the round, the winner's), and a soft
    /// accent wash until there's anyone to follow.
    private var wash: (left: Color, right: Color, intensity: Double) {
        if case .match = event.content { return (palette.top, palette.bottom, 1) }
        if let colors = FlagPalette.colors(ioc: washCountry) { return (colors.0, colors.1, 0.85) }
        return (.accentColor, .accentColor, 0.6)
    }

    /// The country the climbing header is dressed in.
    private var washCountry: String? {
        guard case .climbing? = event.ref, let d = detail else { return nil }
        if event.state == .live {
            if let climber = d.wall.lazy.flatMap(\.climbers).first(where: \.onWall) { return climber.country }
            if let card = d.boulders.first(where: \.onWall) { return card.country }
        }
        return d.ranking.first(where: { $0.rank == 1 })?.country
    }

    private var palette: TeamPalette {
        if isNBA { return .nba(top: event.competitors.first, bottom: event.competitors.last, scheme: colorScheme) }
        return TeamPalette(top: event.competitors.first?.color, bottom: event.competitors.last?.color, scheme: colorScheme)
    }


    /// Live football: the team with the ball (fast lane first, then the scoreboard).
    private var footballPossession: GameDetail.Side? {
        guard event.state == .live, case .espn(_, _, .football)? = event.ref else { return nil }
        if let side = footballFeed.possession ?? footballFeed.situation?.possession { return side }
        guard let id = event.possession else { return nil }
        return event.competitors.first?.id == id ? .top : event.competitors.last?.id == id ? .bottom : nil
    }

    /// Live NBA: who has the ball (the data spec's rule from the core plays),
    /// still the shooting team's while a shot is in the air. The hero and the
    /// docked bar both read it.
    private var nbaBall: (side: GameDetail.Side?, inAir: Bool) {
        guard event.state == .live, isNBA else { return (nil, false) }
        return (basketballFeed.possession, basketballFeed.ballInAir)
    }

    /// Live NBA: the last five minutes of the fourth or overtime, within five.
    private var nbaClutch: Bool { event.state == .live && isNBA && basketballFeed.clutch }

    /// The ball by a team's name in the hero, while live: football, and the
    /// NBA (dimmed while a shot is in the air).
    private struct HeroBall: Equatable {
        let symbol: String
        let inAir: Bool
    }

    private func ball(for c: Competitor) -> HeroBall? {
        let side: GameDetail.Side = c.id == event.competitors.first?.id ? .top : .bottom
        if footballPossession == side { return HeroBall(symbol: "football.fill", inAir: false) }
        let nba = nbaBall
        if nba.side == side { return HeroBall(symbol: "basketball.fill", inAir: nba.inAir) }
        return nil
    }

    private func teamColumn(_ c: Competitor) -> some View {
        let color = c.id == event.competitors.first?.id ? palette.top : palette.bottom
        return VStack(spacing: 6) {
            LogoView(url: c.logo, darkURL: c.darkLogo, size: 34)
                // A soft glow in the team's color seats the logo on the wash: a
                // drawn falloff, not a blur (which re-rasterized on every
                // scroll frame inside the hero's tuck).
                .background(Circle()
                    .fill(RadialGradient(stops: [.init(color: color.opacity(0.35), location: 0),
                                                 .init(color: color.opacity(0.33), location: 0.5),
                                                 .init(color: color.opacity(0.17), location: 0.68),
                                                 .init(color: color.opacity(0.05), location: 0.85),
                                                 .init(color: color.opacity(0), location: 1)],
                                         center: .center, startRadius: 0, endRadius: 35))
                    .frame(width: 70, height: 70))
            // The name opens the team's page: plain at rest, underlined under
            // the pointer. A long name wraps to a second line rather than
            // losing its end ("Brighton & Hove Albion"); a word too long for
            // the column steps the size down instead of breaking ("Wolverhampton").
            let ball = ball(for: c), following = store.isFollowing(c), won = wonSeries(c)
            // Both names step down together, so the two sides always match.
            HeroNameLine(words: HeroName.longestWords(event.competitors.map(\.name)),
                         extras: HeroName.extras(rank: c.rank, glyphs: [ball != nil, following, won].filter { $0 }.count)) { size in
                HStack(spacing: 3) {
                    if let rank = c.rank {
                        Text("\(rank)").font(.system(size: 10, weight: .semibold).monospacedDigit()).foregroundStyle(.secondary)
                    }
                    TeamNameLink(team: teamRef(c)) {
                        Text(c.name)
                            .font(.system(size: size, weight: .medium))
                            .foregroundStyle(event.stepsBack(c) ? .secondary : .primary)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    // The ball before the star, as in rows and tiles.
                    if let ball {
                        PossessionGlyph(symbol: ball.symbol, inAir: ball.inAir)
                            // A shot in the air: still their trip until the rebound.
                            .animation(Motion.fade, value: ball.inAir)
                    }
                    if following {
                        Image(systemName: "star.fill").font(.system(size: 7.5)).foregroundStyle(.yellow)
                    }
                    if won { trophy }
                }
            }
            .animation(reduceMotion ? nil : Motion.quick, value: ball)
            .animation(reduceMotion ? Motion.fade : Motion.pop, value: wonSeries(c))
            // "7-1 · 4-1 conf" in college; the record elsewhere.
            if let record = c.record {
                Text([record, c.conferenceRecord.map { "\($0) conf" }].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 10).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        // Capped, so on a wide panel the scoreboard stays one tight, centered
        // group (at most 550pt) instead of drifting to the card's edges.
        .frame(maxWidth: Self.heroTeamWidth)
        .contextMenu {
            if let ref = teamRef(c) {
                GoToTeamItem(team: ref, via: navigator)
            }
            if c.id != nil {
                Button(store.isFollowing(c) ? "Unfollow \(c.name)" : "Follow \(c.name)",
                       systemImage: store.isFollowing(c) ? "star.slash" : "star") { store.toggleFollow(c) }
            }
        }
    }

    /// This match's team as a page (the link and the menu decide whether its sport has pages).
    private func teamRef(_ c: Competitor) -> Profile.TeamRef? {
        guard c.id != nil else { return nil }
        return Profile.TeamRef(c, league: profileLeague)
    }

    /// The league whose table this page shows (college, NBA or soccer): its live games project the table.
    private var tableLeague: League? { collegeLeague ?? nbaLeague ?? soccerLeague }

    /// The court's "Profile ›" under a picked player: their page. NBA only (the
    /// WNBA has no pages), and nil without a navigator, which hides the link.
    private func courtProfile(_ nba: GameDetail.Basketball) -> ((String) -> Void)? {
        guard let navigator, espnPath == NBADetail.path else { return nil }
        let players = nba.players, names = leaderNames(nba)
        return { id in
            let name = players[id]?.name ?? names[id] ?? "Player"
            if let ref = Profile.PlayerRef.espn(path: NBADetail.path, id: id, name: name) { navigator.open(ref) }
        }
    }

    /// "basketball/nba": player rows build their page links from it.
    private var espnPath: String? {
        if case let .espn(path, _, _)? = event.ref { return path }
        return nil
    }

    /// The match's league ("eng.1"), for team links (soccer pages need the domestic league).
    private var profileLeague: String? {
        store.leagueByEvent[event.id] ?? Profile.TeamRef.league(forPath: espnPath)
    }

    /// A side's number. On a score it pops (1 → 1.12 → 1, with the roll) over
    /// a pill in the scorer's color; the pill stays still while the digits move.
    private func score(_ value: String?, emphasized: Bool, side: GameDetail.Side) -> some View {
        Text(value ?? "–")
            .foregroundStyle(emphasized ? .primary : .secondary)
            .contentTransition(.numericText(value: Double(value ?? "") ?? 0))
            .animation(reduceMotion ? nil : Motion.quick, value: value)
            // Plays here while the hero is the scoreboard on screen; once the
            // bar is half docked, the bar plays it instead (never both).
            .scoreboardBeat(beats.pops(side), color: side == .top ? palette.top : palette.bottom, on: .hero)
    }

    /// The numbers the hero shows, top first (the lane's, while it's ahead).
    private var heroScores: [String?] {
        guard case let .match(top, bottom) = event.content else { return [] }
        let lane = laneScores
        return [lane?.top ?? top.score, lane?.bottom ?? bottom.score]
    }

    /// A real trophy: 9 pt, yellow. It appears with the symbol's own entrance
    /// and bounces once when it's won on this page.
    private var trophy: some View {
        let bounces = celebrationLevel == .off || reduceMotion ? 0 : beats.trophies
        return Image(systemName: "trophy.fill")
            .font(.system(size: 9))
            .foregroundStyle(.yellow)
            .symbolEffect(.bounce, options: .nonRepeating, value: bounces)
            .transition(reduceMotion ? AnyTransition.opacity : AnyTransition(.symbolEffect(.appear)))
            .help("Winner")
            .accessibilityLabel("Winner")
    }

    /// CS2: the series winner, once it's over. (One map isn't a series; a
    /// regular-season win isn't a trophy.)
    private func wonSeries(_ c: Competitor) -> Bool {
        guard case .counterStrike? = event.ref, event.state == .final, c.isWinner else { return false }
        return (detail?.maps.count ?? 0) > 1
    }

    /// Climbing: the winner of a final, once it's decided.
    private var climbingTrophy: Bool {
        guard isClimbing, let d = detail, MatchRules.isFinalRound(d.roundName) else { return false }
        return event.state == .final || MatchRules.decided(d.wall)
    }

    /// The final whistle on an open page: the winner's number pops with its
    /// pill, their side of the wash lifts and the glint sweeps once. No
    /// particles (there's no event point). Said aloud either way.
    private func finalBeat() {
        let trophy = climbingTrophy || event.competitors.contains(where: wonSeries)
        switch event.content {
        case let .match(top, bottom):
            let scores = heroScores
            let winner = MatchRules.winner(top: top, bottom: bottom, scores: (scores.first ?? nil, scores.last ?? nil))
            if !resizing { beats.final(winner: winner, bothSides: false, trophy: trophy, at: .now) }
            Announcer.announce(MatchRules.finalAnnouncement(
                top: (top.name, scores.first ?? nil), bottom: (bottom.name, scores.last ?? nil), winner: winner))
        case let .field(_, summary):
            if !resizing { beats.final(winner: nil, bothSides: true, trophy: trophy, at: .now) }
            Announcer.announce(summary.isEmpty ? "Final." : "Final. \(summary)")
        }
    }

    /// Baseball, live: the team at bat (its color fills the bases).
    private var battingSide: GameDetail.Side? {
        guard isBaseball, event.state == .live else { return nil }
        return MatchRules.battingSide(inning: baseballFeed.inning ?? event.detail, topIsHome: detail?.topIsHome)
    }

    /// Football, live: the team with the ball trails by one score with two minutes or less left.
    private var twoMinuteDrill: Bool {
        guard event.state == .live, case .espn(_, _, .football)? = event.ref, let clock = footballFeed.gameClock else { return false }
        let scores = heroScores.compactMap { $0.flatMap(Int.init) }
        guard scores.count == 2 else { return false }
        let possession = footballFeed.possession ?? footballFeed.situation?.possession
        return MatchRules.twoMinuteDrill(period: clock.period, seconds: clock.seconds, possession: possession,
                                         top: scores[0], bottom: scores[1])
    }

    /// The live clock, for the hero and the bar: football's fast lane, then the
    /// NBA's, then the scoreboard's.
    private var liveClock: GameClock? { footballFeed.gameClock ?? basketballFeed.gameClock ?? event.clock }

    /// What the clock line says without a running clock: the lanes' text, the inning, half-time.
    private var liveClockFallback: String {
        footballFeed.clock ?? basketballFeed.clock ?? baseballFeed.inning
            ?? (event.detail?.uppercased() == "HT" ? "Half-time" : event.detail ?? "Live")
    }

    @ViewBuilder
    private func heroStatus(alignment: HorizontalAlignment) -> some View {
        switch event.state {
        case .live:
            if let live = detail?.csLive, !live.mapEnded {
                // The big score counts maps; this is the map being played, round by round.
                VStack(spacing: 1) {
                    HStack(spacing: 4) {
                        LiveDot(animated: staleSince == nil)
                        Text([live.mapName, "\(live.topScore)–\(live.bottomScore)"].compactMap { $0 }.joined(separator: " "))
                            .contentTransition(.numericText())
                    }
                    .font(.system(size: 11.5, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.red)
                    if let round = live.round {
                        Text("Round \(round)").font(.system(size: 10.5).monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                .animation(reduceMotion ? nil : Motion.quick, value: live)
            } else {
                VStack(alignment: alignment, spacing: 1) {
                    HStack(spacing: 4) {
                        // Holds still while the data is stale (refreshes failing).
                        LiveDot(animated: staleSince == nil)
                        // The clock ticks live; football's comes from the fast lane's
                        // 5-second readings, baseball shows the inning. It stops
                        // ticking while the hero is tucked under the docked bar.
                        WhileHeroShows { showing in
                            if showing {
                                LiveClockText(clock: liveClock, fallback: liveClockFallback)
                            } else {
                                Text(liveClock.map { $0.running ? $0.text(at: .now) : liveClockFallback } ?? liveClockFallback)
                            }
                        }
                        // NBA: the last five minutes of the fourth or overtime, within five.
                        if nbaClutch {
                            StateChip(text: "CLUTCH")
                                .help("Last 5 minutes, within 5 points")
                                .accessibilityLabel("clutch time")
                                .transition(Motion.chip(reduceMotion: reduceMotion))
                        }
                    }
                    .font(.system(size: 11.5, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.red)
                    .animation(reduceMotion ? nil : Motion.quick, value: nbaClutch)
                    // Baseball: who's up, like CS2's round line.
                    if let side = battingSide, let team = side == .top ? event.competitors.first : event.competitors.last {
                        Text("\(team.abbreviation) batting")
                            .font(.system(size: 10.5)).foregroundStyle(.secondary)
                            .contentTransition(.opacity)
                    }
                }
                .animation(reduceMotion ? nil : Motion.quick, value: battingSide)
            }
        case .scheduled:
            // Within a day: a ticking countdown, while the hero is the
            // scoreboard on screen (the docked bar ticks instead).
            WhileHeroShows { showing in
                if showing {
                    // On the shared whole-second grid: every clock on screen ticks in the same frame.
                    TimelineView(.periodic(from: Date(timeIntervalSinceReferenceDate: 0), by: 1)) { context in
                        countdown(alignment: alignment, now: context.date)
                    }
                } else {
                    countdown(alignment: alignment, now: .now)
                }
            }
        case .final:
            // The hero has room for words: "FT" → "Full time", "Final/OT" → "Final, overtime";
            // and, under it, when ("Sat, Oct 24"; an older season's "May 19, 2024").
            VStack(alignment: alignment, spacing: 1) {
                Text(Spoken.status(event.detail ?? "Final"))
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                Text(Self.playedOn(event.start))
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// When a finished game was played: "Today", "Yesterday", "Sat, Oct 24"
    /// within the last ten months, else "May 19, 2024".
    static func playedOn(_ start: Date, now: Date = .now) -> String {
        let day = DayKey.of(start), today = DayKey.of(now)
        if let relative = day.relative(to: today), relative != "Tomorrow" { return relative }
        if abs(day.days(to: today)) < 300 { return start.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
        return start.formatted(.dateTime.month(.abbreviated).day().year())
    }

    @ViewBuilder
    private func countdown(alignment: HorizontalAlignment, now: Date) -> some View {
        if let clock = Countdown.clock(to: event.start, from: now) {
            VStack(alignment: alignment, spacing: 1) {
                Text("Starts in \(clock)")
                    .font(.system(size: 12, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Color.accentColor)
                Text(When.dayAndTime(event.start, now: now))
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
            }
        } else {
            Text(Self.notStarted(event, now: now))
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.secondary)
        }
    }

    /// A start that has passed without the game going live: "Starting soon"
    /// (a match), "Time TBA" (a climbing round with no time); else when.
    /// The same words rows and tiles use.
    static func notStarted(_ event: Event, now: Date = .now) -> String {
        guard event.start < now else { return When.dayAndTime(event.start, now: now) }
        if event.detail == "Delayed" { return "Delayed" }
        return event.competitors.isEmpty ? "Time TBA" : "Starting soon"
    }

    /// "Starts in 31 minutes, 45 seconds" (VoiceOver; the hero shows "Starts in 31:45").
    static func spokenCountdown(to start: Date, from now: Date = .now) -> String? {
        let seconds = Int(start.timeIntervalSince(now))
        guard seconds > 0, seconds < 24 * 3600 else { return nil }
        let h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60
        let parts = [h > 0 ? plural(h, "hour") : nil, m > 0 ? plural(m, "minute") : nil, h == 0 && s > 0 ? plural(s, "second") : nil]
        return "Starts in " + parts.compactMap { $0 }.joined(separator: ", ")
    }

    @ViewBuilder
    private var coStreamBadge: some View {
        if store.coStreamingIDs.contains(event.id) {
            Button {
                if let url = store.coStreamerURL { NSWorkspace.shared.open(url) }
            } label: {
                HStack(spacing: 5) {
                    CoStreamIcon(size: 14)
                    Text("\(store.coStreamerName) is co-streaming").font(.system(size: 11, weight: .medium))
                    Image(systemName: "arrow.up.right").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 10).frame(height: 24)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .glassCapsule(tint: Color.twitch.opacity(0.25), interactive: true)
            .help("Watch on Twitch")
        }
    }

    /// Refreshes have been failing for a while (this page's, or the scores'):
    /// what's shown is from then. Live games only, where it matters.
    private var staleSince: Date? {
        guard event.state == .live else { return nil }
        if detailFailures >= 2, let lastLoaded { return lastLoaded }
        return storeStaleSince
    }

    /// "Can't connect · Updated 10:42 AM", under the hero, while stale.
    @ViewBuilder
    private var staleNote: some View {
        if let since = staleSince {
            Label("Can't connect · Updated \(since.formatted(date: .omitted, time: .shortened))", systemImage: "wifi.slash")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .transition(.opacity.animation(Motion.fade))
        }
    }

    /// The hero in one sentence: "Arsenal 2, Chelsea 1. 67th minute. Premier
    /// League, Matchweek 9. Chiefs ball." A heading, read when the page opens.
    private var heroSpoken: String {
        guard case let .match(top, bottom) = event.content else { return event.spokenSummary }
        let scores = heroScores
        var parts: [String] = []
        if let a = scores.first ?? nil, let b = scores.last ?? nil {
            parts.append("\(top.name) \(a), \(bottom.name) \(b)")
        } else {
            parts.append("\(top.name) versus \(bottom.name)")
        }
        switch event.state {
        case .live:
            if let cs = detail?.csLive, !cs.mapEnded {
                parts.append([cs.mapName, "\(cs.topScore) to \(cs.bottomScore)"].compactMap { $0 }.joined(separator: " ")
                             + (cs.round.map { ", round \($0)" } ?? ""))
            } else {
                parts.append(Spoken.status(liveClock.map { $0.running ? $0.text(at: .now) : liveClockFallback } ?? liveClockFallback))
            }
        case .final:
            parts.append(Spoken.status(event.detail ?? "Final"))
            if let result = event.spokenResult { parts.append(result) }
        case .scheduled:
            parts.append(Self.spokenCountdown(to: event.start) ?? Self.notStarted(event).replacingOccurrences(of: "TBA", with: "to be announced"))
        }
        if let caption = event.caption ?? detail?.roundName { parts.append(caption) }
        if let side = footballPossession ?? nbaBall.side, let team = side == .top ? event.competitors.first : event.competitors.last {
            parts.append("\(team.name) ball")
        }
        if let side = battingSide, let team = side == .top ? event.competitors.first : event.competitors.last {
            parts.append("\(team.name) batting")
        }
        if store.coStreamingIDs.contains(event.id) { parts.append("\(store.coStreamerName) is co-streaming") }
        if let since = staleSince {
            parts.append("Can't connect, updated \(since.formatted(date: .omitted, time: .shortened))")
        }
        return parts.joined(separator: ". ") + "."
    }

    /// What the hero's links, stars and badge do, as VoiceOver actions.
    @ViewBuilder
    private func heroActions(top: Competitor, bottom: Competitor) -> some View {
        ForEach(Array([top, bottom].enumerated()), id: \.offset) { _, c in
            if let ref = teamRef(c), ref.isSupported, let navigator {
                Button("Go to \(c.name)") { navigator.open(ref) }
            }
        }
        ForEach(Array([top, bottom].enumerated()), id: \.offset) { _, c in
            if c.id != nil {
                Button(store.isFollowing(c) ? "Unfollow \(c.name)" : "Follow \(c.name)") { store.toggleFollow(c) }
            }
        }
        if store.coStreamingIDs.contains(event.id), let url = store.coStreamerURL {
            Button("Watch \(store.coStreamerName) on Twitch") { NSWorkspace.shared.open(url) }
        }
    }

    // MARK: Content

    /// A block of the match page. Internal (not private) so the split-page
    /// plan can be unit tested.
    enum Section: Hashable {
        case field, atPlate, atBat, pitch, timeline, table, maps, rounds, rosters, winProbability
        case linescore, moments, stats, plays, battedBalls, wall, scorecard, climbingWatch, results, startlist, ascent
        case streams, whereToWatch, bracket
        // NBA
        case court, flow, leaders, box, injuries
    }

    /// What a fan wants first, per sport and state: the live picture while
    /// it's on; the story of the game once it's over.
    private var order: [Section] {
        let state = event.state
        switch event.ref {
        case .espn(_, _, .soccer)?:
            switch state {
            case .live: return [.pitch, .timeline, .winProbability, .stats, .table, .moments, .plays, .whereToWatch]
            case .final: return [.timeline, .pitch, .moments, .stats, .table, .plays]
            case .scheduled: return [.table, .whereToWatch]
            }
        case .espn(_, _, .baseball)?:
            switch state {
            case .live: return [.atPlate, .atBat, .linescore, .winProbability, .bracket, .moments, .battedBalls, .plays, .whereToWatch]
            case .final: return [.linescore, .bracket, .moments, .battedBalls, .plays]
            case .scheduled: return [.bracket, .whereToWatch]
            }
        case let .espn(path, _, .basketball)? where path == NBADetail.path:
            switch state {
            case .live: return [.court, .flow, .linescore, .leaders, .moments, .box, .stats, .winProbability, .plays, .table,
                                .injuries, .whereToWatch]
            case .final: return [.flow, .court, .linescore, .leaders, .box, .moments, .stats, .table]
            // Before tip-off: who's out, ESPN's matchup predictor, season leaders.
            case .scheduled: return [.injuries, .winProbability, .leaders, .table, .whereToWatch]
            }
        case .espn?:
            switch state {
            case .live: return [.field, .winProbability, .linescore, .moments, .stats, .table, .plays, .whereToWatch]
            case .final: return [.linescore, .moments, .stats, .table, .plays]
            case .scheduled: return [.table, .whereToWatch]
            }
        case .counterStrike?:
            switch state {
            case .live: return [.maps, .rounds, .streams, .bracket, .rosters]
            case .final: return [.maps, .rounds, .bracket, .rosters]
            case .scheduled: return [.streams, .maps, .bracket, .rosters]
            }
        case .climbing?:
            if state == .live { return [.ascent, .climbingWatch, .wall, .scorecard, .results, .startlist] }
            if state == .final { return [.results, .wall, .scorecard, .climbingWatch] }
            return [.climbingWatch, .startlist, .results, .wall, .scorecard]
        case nil:
            return []
        }
    }

    // MARK: Split page

    /// One stretch of the two-column page: a block of two columns, or a
    /// section spanning both between blocks.
    enum WidePart: Equatable {
        case columns(left: [Section], right: [Section])
        case span(Section)

        var sections: [Section] {
            switch self {
            case let .columns(left, right): left + right
            case let .span(section): [section]
            }
        }
    }

    /// A shown section and its place on the split page.
    struct PlacedSection: Equatable {
        let section: Section
        let slot: MatchSlot
    }

    /// The page from 680pt, per sport and state: blocks of two columns (each
    /// listed top to bottom), with full-width sections between them. Linked
    /// hover partners sit side by side: the pitch beside the timeline and key
    /// events, linescore cells beside the plays they light, climbers' rows
    /// beside the lanes and cards they light. A section's column never changes
    /// at runtime, so a live list growing in one column never moves the other.
    static func widePlan(_ ref: EventRef?, _ state: EventState) -> [WidePart] {
        switch ref {
        case .espn(_, _, .soccer)?:
            switch state {
            case .live: [.columns(left: [.pitch, .stats, .plays], right: [.timeline, .moments, .winProbability, .table, .whereToWatch])]
            case .final: [.columns(left: [.pitch, .stats], right: [.timeline, .moments, .table, .plays])]
            case .scheduled: [.columns(left: [.table], right: [.whereToWatch])]
            }
        case .espn(_, _, .baseball)?:
            switch state {
            case .live: [.columns(left: [.atPlate, .atBat, .battedBalls],
                                  right: [.linescore, .winProbability, .moments, .bracket, .plays, .whereToWatch])]
            case .final: [.columns(left: [.linescore, .battedBalls], right: [.moments, .bracket, .plays])]
            case .scheduled: [.columns(left: [.bracket], right: [.whereToWatch])]
            }
        case let .espn(path, _, .basketball)? where path == NBADetail.path:
            // The game's story on the left, its numbers on the right. The box
            // score opens the right column, beside the court: clicking a
            // player shows only their shots without scrolling, and the
            // leaders below it light the same player on both.
            switch state {
            case .live: [.columns(left: [.court, .flow, .winProbability, .linescore, .moments, .plays, .table],
                                  right: [.box, .leaders, .stats, .injuries, .whereToWatch])]
            case .final: [.columns(left: [.flow, .court, .linescore, .moments, .table], right: [.box, .leaders, .stats, .injuries])]
            // Before tip-off: who's out and how it shapes up, beside the standings.
            case .scheduled: [.columns(left: [.injuries, .winProbability, .leaders], right: [.table, .whereToWatch])]
            }
        case .espn?:
            switch state {
            case .live: [.columns(left: [.field, .stats, .plays], right: [.winProbability, .linescore, .moments, .table, .whereToWatch])]
            case .final: [.columns(left: [.linescore, .stats], right: [.moments, .table, .plays])]
            case .scheduled: [.columns(left: [.table], right: [.whereToWatch])]
            }
        case .counterStrike?:
            switch state {
            case .live: [.columns(left: [.maps, .rounds], right: [.streams, .bracket, .rosters])]
            case .final: [.columns(left: [.maps, .rounds], right: [.bracket, .rosters])]
            case .scheduled: [.columns(left: [.streams, .maps], right: [.bracket, .rosters])]
            }
        case .climbing?:
            switch state {
            case .live: [.columns(left: [.ascent, .wall, .scorecard], right: [.climbingWatch, .results, .startlist])]
            case .final: [.columns(left: [.wall, .scorecard], right: [.results, .climbingWatch])]
            case .scheduled: [.columns(left: [.wall, .scorecard], right: [.climbingWatch, .startlist, .results])]
            }
        case nil:
            []
        }
    }

    /// The shown sections in the order the split page lays them out: block by
    /// block, the left column then the right, then the span that closes it.
    /// That is also VoiceOver's reading order. A section the plan doesn't list
    /// joins the right column of the last block, in single-column order; one
    /// with nothing to show leaves no hole. A block never leaves a whole column
    /// empty (speed climbing has no wall or scorecard; a cup tie has no
    /// table): the other column lends it a section. Ranks run across the whole
    /// page, so when a span between two blocks is hidden they merge in order.
    static func wideArrangement(_ shown: [Section], plan: [WidePart]) -> [PlacedSection] {
        let listed = Set(plan.flatMap(\.sections))
        let unlisted = shown.filter { !listed.contains($0) }
        var parts = plan
        if !unlisted.isEmpty {
            if let last = parts.lastIndex(where: { if case .columns = $0 { return true }; return false }),
               case let .columns(left, right) = parts[last] {
                parts[last] = .columns(left: left, right: right + unlisted)
            } else {
                parts.append(.columns(left: [], right: unlisted))
            }
        }
        let visible = Set(shown)
        var placed: [PlacedSection] = []
        func place(_ sections: [Section], _ column: MatchColumn) {
            for section in sections {
                placed.append(PlacedSection(section: section, slot: MatchSlot(column: column, rank: placed.count)))
            }
        }
        for part in parts {
            switch part {
            case let .columns(left, right):
                var left = left.filter(visible.contains), right = right.filter(visible.contains)
                if left.isEmpty, !right.isEmpty {
                    left = [right.removeFirst()]
                } else if right.isEmpty, left.count > 1 {
                    right = [left.removeLast()]
                }
                place(left, .left)
                place(right, .right)
            case let .span(section):
                if visible.contains(section) { place([section], .span) }
            }
        }
        return placed
    }

    /// The shown sections and where each goes: today's order in one column;
    /// the sport's plan from 680pt.
    private func arrangement(_ d: GameDetail) -> [PlacedSection] {
        let shown = order.filter { has($0, d) }
        guard layout.split else { return shown.map { PlacedSection(section: $0, slot: MatchSlot()) } }
        return Self.wideArrangement(shown, plan: Self.widePlan(event.ref, event.state))
    }

    /// The room a section has: a column's when split (unless it spans), else the page's.
    private func room(for slot: MatchSlot) -> WidthClass {
        layout.split && slot.column != .span ? layout.column : layout.page
    }

    /// The room a section has, from its kind (for content sized in this view).
    private func room(for kind: Section) -> WidthClass {
        guard layout.split else { return layout.page }
        let spans = Self.widePlan(event.ref, event.state).contains(.span(kind))
        return spans ? layout.page : layout.column
    }

    @ViewBuilder
    private var content: some View {
        if let detail {
            let placed = arrangement(detail)
            ForEach(Array(placed.enumerated()), id: \.element.section) { index, item in
                section(item.section, detail)
                    .environment(\.widthClass, room(for: item.slot))
                    // Where it is (for the peek and the bar), which section the
                    // pointer is in (rows there may peek), and the flash when a
                    // clicked peek brings it into view.
                    .pageSection(sectionID(item.section))
                    .onHover { inside in peek.pointer(item.section, inside: inside) }
                    .overlay {
                        PeekArrivalFlash(controller: peek, section: item.section)
                            .padding(.horizontal, Metrics.gutter - 6)
                            .padding(.top, 9)
                            .padding(.bottom, -6)
                    }
                    .matchSlot(item.slot.column, rank: item.slot.rank)
                    .accessibilitySortPriority(Double(placed.count - index))
            }
            if placed.isEmpty {
                note(emptyMessage)
                    .matchSlot(.span, rank: 0)
            }
            if let venue = detail.venue {
                Text(venue)
                    .font(Viz.note)
                    .foregroundStyle(.secondary)
                    .readableWidth()
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.top, 16)
                    .matchSlot(.span, rank: 0)
            }
        } else if failed {
            note(ErrorCopy.inline("match details"))
        } else if showSpinner {
            PageSpinner("Loading match details")
        }
    }

    /// Whether a section has anything to show right now.
    private func has(_ kind: Section, _ d: GameDetail) -> Bool {
        switch kind {
        case .field: (footballFeed.situation ?? d.football) != nil && event.state == .live
        case .atPlate: liveBaseball(d) != nil && event.state == .live
        // Stays up between batters ("Waiting for the first pitch"), so the page doesn't jump.
        case .atBat: event.state == .live && (baseballFeed.loaded || !d.atBat.isEmpty)
        case .pitch: extrasShown && (event.state == .live ? !soccerFeed.trail.isEmpty : !soccerFeed.shots.isEmpty)
        case .timeline: d.moments.contains { $0.minute != nil } || event.state == .live
        // Today's table says nothing about a game from another season (G2).
        case .table: extrasShown && d.seasonIsCurrent != false && (soccerLeague ?? collegeLeague ?? nbaLeague) != nil && !standings.isEmpty
            && (nbaLeague == nil || standings.contains { row in event.competitors.contains { $0.id == row.id } })
        case .maps: !d.maps.isEmpty
        case .rounds: !d.rounds.isEmpty
        case .rosters: !d.topRoster.isEmpty || !d.bottomRoster.isEmpty
        case .winProbability: d.topWinProbability != nil && event.state != .final
        case .linescore: d.linescore != nil
        case .moments: !d.moments.isEmpty
        case .stats: !d.stats.isEmpty
        case .plays: !d.recentPlays.isEmpty && d.football == nil
        case .battedBalls: !d.battedBalls.isEmpty || !baseballFeed.battedBalls.isEmpty
        // While a final is on, the climber-by-climber view above covers it.
        case .wall: !d.wall.isEmpty && !has(.ascent, d)
        case .scorecard: !d.boulders.isEmpty
        // A past round's stream is long over: the channel's live one isn't it (G4).
        case .climbingWatch: event.state != .final || event.start > .now - 86_400
        // One route, one climber at a time (finals and semis): who's on the wall.
        // It stays while its moment holds: the last climber's finish (a final
        // decided) celebrates where it happened before the page moves on.
        case .ascent: d.wall.count == 1 && ((roundLive(d) && (d.wall[0].climbers.contains(where: \.onWall) || d.upNext != nil))
                                            || (event.state == .live && moments.current?.chart == .ascent))
        case .results: !d.ranking.isEmpty
        // This round before anyone finishes, or the next round before it starts.
        case .startlist: !d.startlist.isEmpty && (d.ranking.isEmpty || d.startlistRound != d.roundName)
        case .streams: !d.streams.isEmpty || store.coStreamingIDs.contains(event.id)
        case .whereToWatch: !d.broadcasters.isEmpty
        case .bracket: bracketSource(d) != nil
        // A live court shows from tip-off; shots fill it in.
        case .court: d.basketball.map { !$0.shots.isEmpty || event.state == .live } ?? false
        case .flow: d.basketball.map { $0.flow.count > 1 || event.state == .live } ?? false
        case .leaders: !(d.basketball?.leaders.isEmpty ?? true)
        case .box: d.basketball.map { !$0.topBox.isEmpty || !$0.bottomBox.isEmpty } ?? false
        // ESPN's report is today's, even on an old game's page: not after the final.
        case .injuries: !(d.basketball?.injuries.isEmpty ?? true) && event.state != .final
        }
    }

    /// Each side's full name, for what VoiceOver says about the charts.
    private var spokenTeams: SpokenTeams {
        SpokenTeams(top: event.competitors.first?.name ?? "", bottom: event.competitors.last?.name ?? "")
    }

    /// Each side's short name. bo3.gg's own acronyms ("VIT", "MGZ") beat anything derived from the name.
    private func shortNames(_ d: GameDetail) -> (top: String, bottom: String) {
        (top: d.topRoster.acronym ?? event.competitors.first?.abbreviation ?? "",
         bottom: d.bottomRoster.acronym ?? event.competitors.last?.abbreviation ?? "")
    }

    /// The chart a section shows, shared by the section and its peek: the
    /// same initializers, so the peek is the same chart with the same
    /// highlight. `excerpt` narrows list-like charts to a focused climber.
    @ViewBuilder
    private func chart(_ kind: Section, _ d: GameDetail, excerpt: Focus? = nil) -> some View {
        let names = shortNames(d)
        let live = event.state == .live
        switch kind {
        case .pitch:
            PitchView(trail: soccerFeed.trail, shots: soccerFeed.shots, live: live,
                      palette: palette, topName: names.top, bottomName: names.bottom, cards: soccerFeed.cards)
        case .timeline:
            SoccerTimeline(moments: d.moments, currentMinute: live ? soccerMinute : nil, palette: palette,
                           topName: names.top, bottomName: names.bottom)
        case .linescore:
            if let summary = d.linescore {
                // NBA live: T (and the quarter being played) from the live lane, so it matches the hero
                // instead of trailing it by up to the summary's 30 s.
                let linescore = isNBA && event.state == .live
                    ? d.topIsHome.map { basketballFeed.linescore(summary, topIsHome: $0) } ?? summary : summary
                LinescoreGrid(linescore: linescore, topName: names.top, bottomName: names.bottom,
                              totals: isBaseball ? 3 : 1, palette: palette)
            }
        case .battedBalls:
            SprayChartView(balls: battedBalls(d), palette: palette, topName: names.top, bottomName: names.bottom)
        case .wall:
            ClimbingWallView(routes: excerpt?.athlete.map { Self.wallExcerpt(d.wall, athlete: $0) } ?? d.wall,
                             live: roundLive(d), yours: Set(store.climbingCountries))
        case .scorecard:
            let cards = excerpt?.athlete.map { id in d.boulders.filter { $0.id == id } } ?? []
            BoulderScorecard(cards: cards.isEmpty ? d.boulders : cards, problems: d.boulderProblems, yours: Set(store.climbingCountries))
        case .ascent:
            if let route = d.wall.first {
                LeadAscentView(route: route, upNext: d.upNext, yours: Set(store.climbingCountries),
                               final: LeadAscentView.isFinal(d.roundName))
            }
        case .court:
            if let nba = d.basketball {
                CourtView(shots: nbaShots(nba), palette: palette, topName: names.top, bottomName: names.bottom,
                          players: nba.players, names: leaderNames(nba), live: live,
                          plays: nbaPlays(nba), now: live ? basketballFeed.elapsed ?? event.clock.flatMap(nbaElapsed) : nil,
                          onOpenProfile: courtProfile(nba))
            }
        case .flow:
            if let nba = d.basketball {
                GameFlowView(flow: NBADetail.flow(summary: nba.flow, lane: live ? basketballFeed.flow : []),
                             palette: palette, topName: names.top, bottomName: names.bottom,
                             now: live ? basketballFeed.elapsed ?? event.clock.flatMap(nbaElapsed) : nil,
                             final: event.state == .final)
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func section(_ kind: Section, _ d: GameDetail) -> some View {
        let names = shortNames(d)
        let full = spokenTeams
        let live = event.state == .live
        if has(kind, d) {
            switch kind {
            case .field:
                if let football = footballFeed.situation ?? d.football {
                    DetailSection(title: "Field",
                                  caption: "This drive, snap by snap. \(names.top) defends the left end zone.",
                                  accessory: .live,
                                  spokenCaption: "This drive, snap by snap. \(full.top) defending the left end zone.") {
                        FootballField(situation: football, topLabel: names.top, bottomLabel: names.bottom, palette: palette,
                                      drive: fieldDrive, possession: footballFeed.possession ?? football.possession,
                                      twoMinuteDrill: twoMinuteDrill)
                    }
                }
            case .atPlate:
                if let baseball = liveBaseball(d) {
                    DetailSection(title: "At the Plate", caption: "Live count, runners and matchup from ESPN.", accessory: .live) {
                        BaseballDiamond(situation: baseball, batting: battingSide, palette: palette) {
                            // Reads the live lane's last play itself, so a play redraws only the theater.
                            PlayTheater(feed: baseballFeed, preloaded: d.theater,
                                        bases: [baseball.onFirst, baseball.onSecond, baseball.onThird], batting: battingSide,
                                        palette: palette)
                        }
                    }
                }
            case .atBat:
                let count = liveBaseball(d).map { SectionAccessory.count(balls: $0.balls, strikes: $0.strikes) }
                DetailSection(title: "This At-Bat", accessory: count) {
                    StrikeZoneView(pitches: baseballFeed.loaded ? baseballFeed.atBat : d.atBat)
                }
            case .pitch:
                DetailSection(title: live ? "Live Pitch" : "Shot Map",
                              caption: live ? "The last 10 actions, live. \(names.top) attacks →"
                                            : "Every shot, with each goal's path. \(names.top) attacks →, \(names.bottom) ←",
                              accessory: live ? .live : .final,
                              spokenCaption: (live ? "The last 10 actions, live. " : "Every shot, with each goal's path. ")
                                  + "\(full.top) attacking left to right, \(full.bottom) right to left.") {
                    chart(.pitch, d)
                }
            case .timeline:
                DetailSection(title: "Timeline",
                              caption: "Goals and cards by minute. \(names.top) above, \(names.bottom) below."
                                  + (live ? " The red dot marks now." : ""),
                              spokenCaption: "Goals and cards by minute. \(full.top) above, \(full.bottom) below.") {
                    chart(.timeline, d)
                }
            case .table:
                if let league = collegeLeague {
                    DetailSection(title: "Conference",
                                  caption: "Ranked by conference record; season record alongside.") {
                        ConferenceTable(rows: collegeWindow(reach: tableReach), highlight: Set(event.competitors.compactMap(\.id)),
                                        ranks: collegeRanks, live: ConferenceTable.liveScores(leagueLive))
                        HStack(spacing: 16) {
                            linkButton("Full Standings") { onOpenStandings(league) }
                            linkButton("Top 25") { onOpenRankings(league) }
                        }
                    }
                } else if let league = nbaLeague {
                    let live = NBAStandings.project(standings, liveEvents: leagueLive)
                    let projected = live.contains { $0.liveScore != nil }
                    DetailSection(title: "Standings",
                                  caption: projected ? "Projected if live scores hold. Arrows show moves from the official seeding."
                                                     : "By conference seed. Top 6 make the playoffs; 7–10 go to the play-in.",
                                  accessory: projected ? .live : nil) {
                        NBAStandingsTable(rows: NBAStandings.window(live, around: Set(event.competitors.compactMap(\.id))),
                                          highlight: Set(event.competitors.compactMap(\.id)))
                        linkButton("Full Standings") { onOpenStandings(league) }
                    }
                } else if let league = soccerLeague {
                    let projected = leagueLive.contains { !$0.isKnockout }
                    DetailSection(title: "Table",
                                  caption: projected ? "Projected if live scores hold. Arrows show moves from the official table."
                                      : event.state == .final && !isRecent ? "Table today, from ESPN."
                                      : "Official table from ESPN. New results can take a few minutes.",
                                  accessory: projected ? .live : nil) {
                        StandingsTable(rows: tableWindow(league: league, reach: tableReach), highlight: Set(event.competitors.compactMap(\.id)))
                        linkButton("Full Table") { onOpenStandings(league) }
                    }
                }
            case .maps:
                DetailSection(title: "Maps", caption: mapsCaption(d)) {
                    MapList(maps: d.maps, final: event.state == .final, live: d.csLive,
                            topTeam: event.competitors.first, bottomTeam: event.competitors.last)
                }
            case .rounds:
                DetailSection(title: "Rounds", caption: "Each square is a round, filled in the winner's row. First to 13; OT first to 4.",
                              accessory: live ? .live : .final,
                              spokenCaption: "Each square is a round, filled in the winner's row. First to 13; overtime first to 4.") {
                    RoundHistoryView(rounds: d.rounds, maps: d.maps, palette: palette,
                                     topName: names.top, bottomName: names.bottom, live: d.csLive)
                }
            case .rosters:
                DetailSection(title: "Rosters", caption: "Each team's current lineup on bo3.gg. May differ from who plays.") {
                    RosterColumns(top: d.topRoster, bottom: d.bottomRoster,
                                  topTeam: event.competitors.first, bottomTeam: event.competitors.last)
                }
            case .winProbability:
                if let p = d.topWinProbability {
                    DetailSection(title: "Win Probability",
                                  caption: event.state == .scheduled ? "ESPN's matchup predictor, before tip-off."
                                                                     : "ESPN's estimate of each team's chance to win, updated live.") {
                        WinProbability(topShare: p, draw: d.drawProbability, topName: names.top, bottomName: names.bottom, palette: palette)
                    }
                }
            case .linescore:
                DetailSection(title: linescoreTitle, caption: linescoreCaption) {
                    chart(.linescore, d)
                }
            case .moments:
                DetailSection(title: isSoccer ? "Key Events" : isNBA ? "Key Plays" : "Scoring",
                              caption: isSoccer ? "Goals and cards, newest first."
                                  : isNBA ? "Runs of 8+, late lead changes and each break, newest first. Score is \(names.top)–\(names.bottom)."
                                  : "Every scoring play, newest first. Score is \(names.top)–\(names.bottom) after the play.",
                              spokenCaption: isSoccer ? nil
                                  : isNBA ? "Runs of 8 or more, late lead changes and each break, newest first."
                                  : "Every scoring play, newest first, with the score after it.") {
                    MomentList(moments: d.moments, topName: names.top, bottomName: names.bottom, palette: palette,
                               topTeam: event.competitors.first, bottomTeam: event.competitors.last)
                }
            case .stats:
                let unit = isNBA ? "game" : "match"
                DetailSection(title: "Team Stats", caption: live ? "\(unit.capitalized) totals so far, from ESPN." : "Final \(unit) totals, from ESPN.") {
                    StatBars(stats: d.stats, palette: palette)
                }
            case .plays:
                DetailSection(title: live ? "Latest" : "Last Plays",
                              caption: isNBA ? "Play-by-play from ESPN, newest first." : "ESPN commentary, newest first.") {
                    StackColumn(spacing: 6) {
                        // The NBA's live lane is a step ahead of the full refresh.
                        ForEach(isNBA && live && !basketballFeed.recentPlays.isEmpty ? basketballFeed.recentPlays : d.recentPlays,
                                id: \.self) { play in
                            Text(play).font(.system(size: 11.5)).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .readableWidth()
                }
            case .battedBalls:
                DetailSection(title: "Balls in Play", caption: "Every batted ball this game, colored by batting team.") {
                    chart(.battedBalls, d)
                }
            case .wall:
                DetailSection(title: "\(d.roundName ?? "Route") · High Points", caption: wallCaption(d),
                              accessory: roundLive(d) ? .live : .final) {
                    chart(.wall, d)
                }
            case .scorecard:
                DetailSection(title: "\(d.roundName ?? "Round") · Scorecard",
                              caption: "Each boulder: lower half for the zone, upper half for the top. Numbers show attempts.",
                              accessory: roundLive(d) ? .live : .final) {
                    chart(.scorecard, d)
                }
            case .ascent:
                if let route = d.wall.first {
                    let climbing = route.climbers.first(where: \.onWall)
                    DetailSection(title: "On the Wall",
                                  caption: climbing.map { "\($0.name) is climbing. Marks show where everyone before them reached." }
                                      ?? "Between climbers. Marks show where everyone so far reached.",
                                  accessory: .live) {
                        chart(.ascent, d)
                    }
                }
            case .climbingWatch:
                DetailSection(title: "Watch", caption: "Official World Climbing streams on YouTube.") {
                    ClimbingWatch(broadcast: store.broadcast(for: event), final: event.state == .final)
                }
            case .results:
                DetailSection(title: roundLive(d) ? "\(d.roundName ?? "Round") · Live" : "\(d.roundName ?? "Round") Results",
                              caption: resultsCaption(d)) {
                    RankingList(athletes: d.ranking, countries: Set(store.climbingCountries), shift: roundLive(d) ? rankShift : nil)
                }
            case .startlist:
                let climbingNow = roundLive(d) && d.startlistRound == d.roundName
                DetailSection(title: "\(d.startlistRound ?? "Round") · Starting Order",
                              caption: climbingNow
                                  ? "Climbing now, in this order. Results appear as each climber finishes."
                                  : "Who climbs in the \((d.startlistRound ?? "next round").lowercased()), in order. Results appear once it starts.",
                              accessory: climbingNow ? .live : nil) {
                    RankingList(athletes: d.startlist, countries: Set(store.climbingCountries))
                }
            case .streams:
                DetailSection(title: "Watch", caption: "Streams listed by bo3.gg, official first. Viewer counts are live.") {
                    StreamList(streams: d.streams, coStreaming: store.coStreamingIDs.contains(event.id))
                }
            case .whereToWatch:
                DetailSection(title: "Where to Watch", caption: "Official US broadcasts, as listed by ESPN.") {
                    BroadcasterList(broadcasters: d.broadcasters)
                }
            case .court:
                DetailSection(title: "Shot Chart",
                              caption: "\(courtLead(live: live)) \(names.top) shoots →, \(names.bottom) ←.",
                              accessory: live ? .live : .final,
                              spokenCaption: "\(courtLead(live: live)) \(full.top) at the right basket, \(full.bottom) at the left.") {
                    chart(.court, d)
                }
            case .flow:
                DetailSection(title: "Game Flow",
                              caption: "The margin through the game. \(names.top) ahead above, \(names.bottom) below.",
                              spokenCaption: "The margin through the game. \(full.top) ahead above, \(full.bottom) below.") {
                    chart(.flow, d)
                }
            case .leaders:
                if let nba = d.basketball {
                    DetailSection(title: nba.seasonLeaders ? "Season Leaders" : "Leaders",
                                  caption: nba.seasonLeaders ? "Per-game averages this season." : live ? "This game so far." : "This game.") {
                        LeadersView(lines: nba.leaders)
                    }
                }
            case .box:
                if let nba = d.basketball {
                    // At most two lines at 340 (the deck's 90 characters).
                    DetailSection(title: "Box Score",
                                  caption: (live ? "A dot marks the five on court. " : "Starters, then the bench. ")
                                      + (courtProfile(nba) == nil ? "Click a player to see only their shots."
                                                                  : "Click a player for their shots; double-click for their page."),
                                  accessory: live ? .live : .final) {
                        BoxScoreView(top: nba.topBox, bottom: nba.bottomBox, topName: names.top, bottomName: names.bottom,
                                     topTotals: nba.topTotals, bottomTotals: nba.bottomTotals, live: live,
                                     initial: followedSide ?? .top)
                    }
                }
            case .injuries:
                if let nba = d.basketball {
                    DetailSection(title: "Injury Report", caption: "ESPN's latest report.") {
                        InjuryReport(injuries: nba.injuries, topTeam: event.competitors.first, bottomTeam: event.competitors.last)
                    }
                }
            case .bracket:
                if let source = bracketSource(d) {
                    let lines = bracketLines(d)
                    DetailSection(title: d.tournament == nil ? "Series" : "Tournament", caption: lines.caption) {
                        Button {
                            onOpenBracket(source, Set(event.competitors.compactMap { $0.id?.split(separator: "-").last.map(String.init) }))
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "trophy").font(.system(size: 12)).foregroundStyle(.secondary).frame(width: 16)
                                Text(lines.title).font(.system(size: 12, weight: .medium)).lineLimit(1)
                                Spacer()
                                Text("Bracket").font(.system(size: 11.5)).foregroundStyle(.secondary)
                                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 6).padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(ListRowStyle(hovering: false, inset: 0))
                        .padding(.horizontal, -6)
                    }
                }
            }
        }
    }

    /// The shot chart's caption, before the directions.
    private func courtLead(live: Bool) -> String {
        live ? "The last plays trail to the ball." : "Every shot. Play to replay the game."
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11.5))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            // Wraps at the width it was written for (never narrower than at
            // 340), centered, rather than running across a wide panel.
            .frame(maxWidth: Metrics.compactWidth - 2 * Metrics.gutter)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Metrics.gutter)
            .padding(.vertical, 24)
    }

    private var emptyMessage: String {
        switch (event.ref, event.state) {
        case (.counterStrike?, .scheduled): "Map picks appear before the match; rounds once it starts."
        case (.climbing?, .scheduled): "Results appear once the first round starts."
        case (_, .scheduled): "Stats and live data appear once the game starts."
        case (_, .live): "Live details aren't available for this game yet."
        case (_, .final): "No further details for this game."
        }
    }

    // MARK: Captions

    /// The bracket this match belongs to: the MLB postseason, or a CS2 tournament.
    private func bracketSource(_ d: GameDetail) -> BracketSource? {
        if let t = d.tournament { return .csTournament(slug: t.slug, name: t.name) }
        if case let .espn(path, _, .baseball)? = event.ref, event.stage == "post-season" {
            return .espnPostseason(path: path, year: Calendar.current.component(.year, from: event.start))
        }
        return nil
    }

    /// "World Series" / "Game 2 · MIL leads 2–0"; "PGL Masters Bucharest 2026" / "Group Stage · Round 2".
    private func bracketLines(_ d: GameDetail) -> (title: String, caption: String) {
        if let t = d.tournament { return (t.name, t.stage ?? "The full tournament, stage by stage.") }
        let parts = (event.caption ?? "Postseason").components(separatedBy: " · ")
        return (parts.first ?? "Postseason",
                parts.count > 1 ? parts.dropFirst().joined(separator: " · ") : "The road to the World Series.")
    }

    /// IFSC marks a round active hours early; it's live once the page's event is.
    private func roundLive(_ d: GameDetail) -> Bool { d.roundStatus == "active" && event.state == .live }

    private var linescoreTitle: String {
        switch event.ref {
        case .espn(_, _, .baseball)?: "Score by Inning"
        case .espn(_, _, .football)?, .espn(_, _, .basketball)?: "Score by Quarter"
        default: "Score by Period"
        }
    }

    private var linescoreCaption: String {
        isBaseball ? "Runs per inning. R runs, H hits, E errors." : "Points per period. T is the total."
    }

    private func mapsCaption(_ d: GameDetail) -> String {
        let bestOf = d.maps.count
        guard bestOf > 1 else { return "Rounds won on each map." }
        return "Best of \(bestOf): first to \(bestOf / 2 + 1) maps wins. Rounds won on each map."
    }

    /// Which round the wall shows, and why — so a previous round is never mistaken for the current one.
    private func wallCaption(_ d: GameDetail) -> String {
        let shown = d.roundName ?? "This round"
        if roundLive(d) { return "Live from the \(shown.lowercased()). Bars rise as climbers move up." }
        if case let .climbing(_, _, _, round?, _, _)? = event.ref, round != d.roundName, event.state != .final {
            if event.state == .live { return "\(round) results aren't in yet. Showing \(shown.lowercased())." }
            let when = event.start > .now ? " starts \(When.dayAndTime(event.start))," : ""
            return "Final heights from \(shown.lowercased()). \(round)\(when) and this switches to it live."
        }
        return "\(shown): how high each climber got. Top 8 per route."
    }

    private func resultsCaption(_ d: GameDetail) -> String {
        let category: String = { if case let .climbing(_, c, _, _, _, _)? = event.ref { return c.lowercased() }; return "" }()
        let round = (d.roundName ?? "").lowercased()
        if category.contains("speed") {
            return round.contains("qualif") ? "Fastest time in seconds. Lower is better."
                : "Places come from head-to-head races, not the fastest time. Seconds; earlier best in brackets."
        }
        if category.contains("boulder") { return "Points for tops and zones, less for extra attempts." }
        if round.contains("qualif") { return "Score combines places on both routes. Lower is better." }
        return "Score is the highest hold reached. Top means finished."
    }

    /// The soccer league this match belongs to ("soccer/eng.1" → Premier League).
    private var soccerLeague: League? {
        guard case let .espn(path, _, .soccer)? = event.ref, let slug = path.split(separator: "/").last else { return nil }
        return League.with(id: String(slug))
    }

    /// Positioned play-by-play (pitch, shots) and the league table.
    private func loadSoccerExtras(_ current: Event) async {
        guard let league = soccerLeague, case let .espn(path, id, _)? = current.ref,
              let slug = path.split(separator: "/").last else { return }
        // Soccer lists the home side first.
        let homeID = current.competitors.first?.id?.split(separator: "-").last.map(String.init)
        let feed = soccerFeed
        async let updated: Void = feed.update(league: String(slug), eventID: id, homeTeamID: homeID)
        if standings.isEmpty { standings = await store.standings(for: league) }
        await updated
        let fresh = feed.takeMoments()
        moments.offer(fresh)
        // A goal or card: bring the timeline and key events along now, not in half a minute.
        if fresh.contains(where: { if case .card = $0.kind { return true }; return $0.kind == .goal }), detail != nil {
            await refreshDetail(current)
        }
    }

    private func linkButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 3) {
                Text(title)
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold))
            }
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(Color.accentColor)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The NBA (not the WNBA), when this is one of its games.
    private var nbaLeague: League? {
        guard isNBA else { return nil }
        return League.with(id: "nba")
    }

    private var isNBA: Bool {
        if case let .espn(path, _, .basketball)? = event.ref { return path == NBADetail.path }
        return false
    }

    /// Every shot: the full load's, plus any newer ones the live lane has seen.
    private func nbaShots(_ nba: GameDetail.Basketball) -> [GameDetail.Shot] {
        event.state == .live ? NBADetail.shots(summary: nba.shots, newestElapsed: nba.newestElapsed, lane: basketballFeed.shots)
                             : nba.shots
    }

    /// Every play for the court: the full load's, with the live lane's newer
    /// (and re-read) plays spliced over them.
    private func nbaPlays(_ nba: GameDetail.Basketball) -> [GameDetail.CourtPlay] {
        event.state == .live ? NBADetail.plays(summary: nba.plays, lane: basketballFeed.plays) : nba.plays
    }

    /// Leaders' names by athlete ID, for players the box score doesn't list.
    private func leaderNames(_ nba: GameDetail.Basketball) -> [String: String] {
        var names: [String: String] = [:]
        for line in nba.leaders {
            for leader in [line.top, line.bottom].compactMap({ $0 }) { if let id = leader.player { names[id] = leader.name } }
        }
        return names
    }

    /// Game seconds played, from the scoreboard's clock (until the live lane reads its own).
    private func nbaElapsed(_ clock: GameClock) -> Double? {
        let left = Double(clock.seconds)
        return NBADetail.elapsed(period: clock.period, clock: String(format: "%d:%02d", Int(left) / 60, Int(left) % 60))
    }

    /// The side of a team the user follows, if exactly one is playing.
    private var followedSide: GameDetail.Side? {
        guard let top = event.competitors.first, let bottom = event.competitors.last else { return nil }
        let (a, b) = (store.isFollowing(top), store.isFollowing(bottom))
        return a == b ? nil : (a ? .top : .bottom)
    }

    /// NBA standings, once, alongside the first load.
    private func loadNBAExtras() async {
        guard let league = nbaLeague, standings.isEmpty else { return }
        standings = await store.standings(for: league)
    }

    /// College football, when this is one of its games.
    private var collegeLeague: League? {
        guard case let .espn(path, _, _)? = event.ref, path.hasSuffix("college-football") else { return nil }
        return League.with(id: "college-football")
    }

    /// Places shown either side of each team in the table: two when the table
    /// has a wide single column to itself (more of the race around them), else one.
    private var tableReach: Int { room(for: .table) >= .xlarge ? 2 : 1 }

    /// Each team's conference, `reach` places either side of it (both
    /// conferences for a non-conference game).
    private func collegeWindow(reach: Int) -> [StandingsRow] {
        let ids = Set(event.competitors.compactMap(\.id))
        let groups = Set(standings.filter { ids.contains($0.id) }.compactMap(\.group))
        let rows = standings.filter { groups.contains($0.group ?? "") }
        let positions = rows.indices.filter { ids.contains(rows[$0].id) }
        let keep = Set(positions.flatMap { p in
            (p - reach...p + reach).filter { rows.indices.contains($0) && rows[$0].group == rows[p].group }
        })
        return rows.indices.filter(keep.contains).map { rows[$0] }
    }

    /// College standings and the AP poll, once, alongside the first load.
    private func loadCollegeExtras() async {
        guard let league = collegeLeague, case let .espn(path, _) = league.source else { return }
        if standings.isEmpty { standings = await store.standings(for: league) }
        if collegeRanks.isEmpty, let ap = try? await Rankings.fetch(path: path).first {
            collegeRanks = Dictionary(ap.entries.map { ($0.teamID, $0.rank) }, uniquingKeysWith: { a, _ in a })
        }
    }

    /// The table around this match's two teams (`reach` places either side
    /// of each), within their own group or conference.
    private func tableWindow(league: League, reach: Int) -> [LiveStandingsRow] {
        let ids = Set(event.competitors.compactMap(\.id))
        var live = Standings.live(standings, liveEvents: leagueLive)
        // Each team's own group or conference (both, for a cross-conference game).
        let groups = Set(live.filter { ids.contains($0.id) }.map(\.row.group))
        if !groups.isEmpty { live = live.filter { groups.contains($0.row.group) } }
        // In the order the ranks read, group by group: with no live games the
        // projection still sorts ties by goals, not the league's tiebreak
        // (MLS: wins), and a window would then skip a rank ("7 … 9").
        let groupOrder = live.reduce(into: [String: Int]()) { order, r in order[r.row.group ?? ""] = order[r.row.group ?? ""] ?? order.count }
        live.sort { (groupOrder[$0.row.group ?? ""] ?? 0, $0.liveRank) < (groupOrder[$1.row.group ?? ""] ?? 0, $1.liveRank) }
        let positions = live.indices.filter { ids.contains(live[$0].id) }
        guard !positions.isEmpty else { return Array(live.prefix(5)) }
        let keep = Set(positions.flatMap { p in
            (p - reach...p + reach).filter { live.indices.contains($0) && live[$0].row.group == live[p].row.group }
        })
        return live.indices.filter(keep.contains).map { live[$0] }
    }

    private var isClimbing: Bool { if case .climbing? = event.ref { return true }; return false }
    private var isSoccer: Bool { if case .espn(_, _, .soccer)? = event.ref { return true }; return false }
    private var isBaseball: Bool { if case .espn(_, _, .baseball)? = event.ref { return true }; return false }

    /// "67'" → 67, "90'+5'" → 95, "HT" → 45.
    private var soccerMinute: Double? {
        guard let d = event.detail else { return nil }
        if d.uppercased() == "HT" { return 45 }
        let numbers = d.split { !$0.isNumber }.compactMap { Double($0) }
        return numbers.isEmpty ? nil : numbers.reduce(0, +)
    }

    /// The drive on the field: the current one, or, while a score's moment
    /// shows, the scoring drive (the extra point and kickoff can't clear it mid-moment).
    private var fieldDrive: [DrivePlay] {
        if let moment = moments.current, moment.chart == .field, moment.tier == .score,
           let scoring = footballFeed.drive(containing: moment.id) {
            return scoring
        }
        return footballFeed.drive
    }

    /// The diamond from the fast lane when it has spoken, else the last full load.
    private func liveBaseball(_ d: GameDetail) -> GameDetail.Baseball? {
        guard let s = baseballFeed.situation else { return d.baseball }
        return GameDetail.Baseball(balls: s.balls, strikes: s.strikes, outs: s.outs,
                                   onFirst: s.onFirst, onSecond: s.onSecond, onThird: s.onThird,
                                   batter: s.batter ?? d.baseball?.batter, pitcher: s.pitcher ?? d.baseball?.pitcher,
                                   lastPlay: s.lastPlay ?? d.baseball?.lastPlay, runners: s.runners,
                                   // An ID goes with the name shown: the fast lane's, or the full load's it fell back to.
                                   batterID: s.batter == nil ? d.baseball?.batterID : s.batterID,
                                   pitcherID: s.pitcher == nil ? d.baseball?.pitcherID : s.pitcherID)
    }

    /// Every ball in play: the full load's, plus any the fast lane has seen since.
    private func battedBalls(_ d: GameDetail) -> [GameDetail.BattedBall] {
        let known = Set(d.battedBalls.map(\.id))
        return d.battedBalls + baseballFeed.battedBalls.filter { !known.contains($0.id) }
    }

    /// The fast lane's score, top team first, while it's ahead of the panel's
    /// regular refresh (never behind it).
    private var laneScores: (top: String, bottom: String)? {
        guard event.state == .live, let topIsHome = detail?.topIsHome,
              let lane = footballFeed.score ?? baseballFeed.score ?? basketballFeed.score else { return nil }
        let known = event.competitors.compactMap { $0.score.flatMap(Int.init) }.reduce(0, +)
        guard lane.home + lane.away >= known else { return nil }
        return topIsHome ? ("\(lane.home)", "\(lane.away)") : ("\(lane.away)", "\(lane.home)")
    }

    // MARK: Docked scorebar and chart peek

    /// What the docked scorebar shows: the hero's numbers, clock and live detail.
    private var dockBar: DockBar {
        let scores = heroScores
        var inputs = DockInputs(event: event, detail: detail, colors: (palette.top, palette.bottom),
                                scores: (scores.first ?? nil, scores.last ?? nil))
        inputs.football = footballFeed.situation ?? detail?.football
        inputs.clock = liveClock
        inputs.clockFallback = liveClockFallback
        inputs.baseball = detail.flatMap(liveBaseball)
        inputs.twoMinuteDrill = twoMinuteDrill
        inputs.coStreaming = store.coStreamingIDs.contains(event.id)
        inputs.stale = staleSince != nil
        if let side = footballPossession {
            inputs.possession = side
        } else if isNBA {
            let ball = nbaBall
            inputs.possession = ball.side
            inputs.possessionInAir = ball.inAir
            inputs.clutch = nbaClutch
            inputs.run = event.state == .live ? basketballFeed.runs.first?.label : nil
        }
        return DockBar.make(inputs)
    }

    /// Back, except that Esc first drops a pin (a click or ⌘[ always goes back).
    /// Esc is never swallowed: with nothing pinned it goes back as before.
    private func back() {
        if let key = NSApp.currentEvent, key.type == .keyDown, key.keyCode == 53 {
            if linked.unpin() { return }
            if nbaStage.pinned != nil {
                nbaStage.unpin()
                return
            }
        }
        onBack()
    }

    /// Leaving the page's content clears the hover a beat later: the pointer
    /// may be on its way onto the peek, which holds what it shows.
    private func pointerMoved(inside: Bool) {
        pointer.inside = inside
        guard !inside else { return }
        let linked = linked, pointer = pointer
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(40))
            if !pointer.inside { linked.clear() }
        }
    }

    /// The section a focus would light, if the page has it (`PeekRouter`).
    private func peekRoute(_ focus: Focus, source: Section?) -> Section? {
        guard let d = detail else { return nil }
        return PeekRouter.target(for: focus, sport: event.ref, state: event.state, inputs: peekInputs(d, for: focus, readout: false),
                                 source: source)
    }

    private func peekReadout(_ focus: Focus, _ section: Section) -> (lead: String, detail: String)? {
        guard let d = detail else { return nil }
        return PeekRouter.readout(for: focus, target: section, inputs: peekInputs(d, for: focus, readout: true))
    }

    /// What the router needs from this page, for this sport only. Routing
    /// runs on every focus change, so the readout's words are built only for
    /// the pill (`readout`).
    private func peekInputs(_ d: GameDetail, for focus: Focus, readout: Bool) -> PeekInputs {
        var inputs = PeekInputs()
        inputs.shown = Set(order.filter { has($0, d) })
        let names = shortNames(d)
        if let line = d.linescore {
            inputs.linescore = (line.headers, line.top, line.bottom, names)
        }
        switch event.ref {
        case .espn(_, _, .soccer)?:
            let actions = (event.state == .live ? soccerFeed.trail : []) + soccerFeed.shots
            inputs.pitch = actions.map { PeekInputs.Mark(id: $0.playID, lead: $0.minute, detail: $0.text) }
                + soccerFeed.cards.map { PeekInputs.Mark(id: $0.key, lead: $0.value.minute, detail: $0.value.text) }
            inputs.timeline = d.moments.filter { $0.minute != nil && $0.kind != .other && $0.kind != .score }
                .map { PeekInputs.Mark(id: $0.id, side: $0.side, lead: $0.clock, detail: MomentList.headline($0)) }
        case .espn(_, _, .baseball)?:
            inputs.balls = battedBalls(d).map { ball in
                let lead = switch ball.outcome {
                case .single: "Single"
                case .extraBases: "Extra bases"
                case .homeRun: "Home run"
                case .out: "Out"
                }
                return PeekInputs.Mark(id: ball.id, period: ball.period, side: ball.side, lead: lead, detail: ball.text)
            }
        case let .espn(path, _, .basketball)? where path == NBADetail.path:
            guard let nba = d.basketball else { break }
            inputs.shots = nbaShots(nba).map { shot in
                PeekInputs.Mark(id: shot.id, period: shot.period, side: shot.side, player: shot.player,
                                lead: readout ? "\(shot.made ? "Made" : "Missed") \(shot.value)" : (shot.made ? "Made" : ""),
                                detail: readout ? NBADetail.short(shot.text) : "")
            }
            inputs.flow = nba.flow.map { point in
                guard readout else { return PeekInputs.Mark(id: point.id, period: point.period, side: point.scorer) }
                let line = point.top == point.bottom ? "Tied \(point.top)–\(point.bottom)"
                    : point.top > point.bottom ? "\(names.top) \(point.top)–\(point.bottom)" : "\(names.bottom) \(point.bottom)–\(point.top)"
                return PeekInputs.Mark(id: point.id, period: point.period, side: point.scorer, lead: line, detail: point.clock)
            }
            if readout, let player = focus.player {
                inputs.names = leaderNames(nba).merging(nba.players.mapValues(\.name)) { _, box in box }
                if let box = nba.players[player], let fg = CourtView.made(box.fieldGoals) {
                    inputs.lines[player] = CourtView.shooting(fg, threes: CourtView.made(box.threes) ?? (0, 0))
                }
            }
        case .climbing?:
            func mark(_ c: GameDetail.WallRoute.Climber) -> PeekInputs.Mark { PeekInputs.Mark(id: String(c.id), lead: c.name, detail: c.label) }
            if inputs.shown.contains(.ascent), let route = d.wall.first { inputs.ascent = route.climbers.map(mark) }
            inputs.wall = d.wall.flatMap(\.climbers).map(mark)
            inputs.cards = d.boulders.map { PeekInputs.Mark(id: String($0.id), lead: $0.name, detail: $0.score ?? "") }
        default:
            break
        }
        return inputs
    }

    /// The peek's header: the section's own name.
    private func peekTitle(_ section: Section) -> String {
        switch section {
        case .court: "Shot Chart"
        case .flow: "Game Flow"
        case .pitch: event.state == .live ? "Live Pitch" : "Shot Map"
        case .timeline: "Timeline"
        case .battedBalls: "Balls in Play"
        case .linescore: linescoreTitle
        case .ascent: "On the Wall"
        case .wall: "High Points"
        case .scorecard: "Scorecard"
        default: ""
        }
    }

    /// The chart's width over its height (`chartUnit`); nil fills the peek's width.
    private func peekAspect(_ section: Section) -> CGFloat? {
        switch section {
        case .court: 94.0 / 50.0
        case .pitch: 105.0 / 68.0
        case .battedBalls: 250.0 / 210.0
        default: nil
        }
    }

    /// The chart in the peek: the section's own chart; list-like ones show
    /// just the focused climber (and neighbors).
    @ViewBuilder
    private func peekChart(_ section: Section, focus: Focus?) -> some View {
        if let d = detail { chart(section, d, excerpt: focus) }
    }

    /// A climber's lane and their neighbors by rank, on each route they're on.
    static func wallExcerpt(_ routes: [GameDetail.WallRoute], athlete: Int) -> [GameDetail.WallRoute] {
        let excerpt = routes.compactMap { route -> GameDetail.WallRoute? in
            guard let i = route.climbers.firstIndex(where: { $0.id == athlete }) else { return nil }
            let keep = route.climbers[max(i - 1, 0)...min(i + 1, route.climbers.count - 1)]
            return GameDetail.WallRoute(name: route.name, climbers: Array(keep), total: route.total)
        }
        return excerpt.isEmpty ? routes : excerpt
    }

    /// Rows' "Show on {chart}": pin, bring the chart into view at once, and
    /// move VoiceOver's attention there.
    private var peekShow: PeekShowAction {
        PeekShowAction(title: { focus in peekRoute(focus, source: nil).map(peekTitle) }, perform: { focus in
            guard let target = peekRoute(focus, source: nil) else { return }
            linked.pin(focus)
            geometry.scroll(toSection: sectionID(target), topInset: PageGeometry.dockInset + 8, animated: false)
            AccessibilityNotification.LayoutChanged().post()
        })
    }

    // MARK: Fast lane

    private func hasFastLane(_ event: Event) -> Bool {
        switch event.ref {
        case .espn(_, _, .football)?, .espn(_, _, .baseball)?, .espn(_, _, .soccer)?, .counterStrike?, .climbing?: true
        case let .espn(path, _, .basketball)?: path == NBADetail.path
        default: false
        }
    }

    /// Small, frequent requests while live and only while this page is open:
    /// football's spot and clock, CS2's round score, soccer's newest actions.
    private func fastLane() async {
        while !Task.isCancelled {
            let current = event
            guard current.state == .live, hasFastLane(current) else { return }
            switch current.ref {
            case let .espn(path, id, .football)?:
                // Wait for the first full load: it says which team is home.
                guard let homeIsTop = detail?.topIsHome else { break }
                let ids = current.competitors.map { $0.id?.split(separator: "-").last.map(String.init) }
                let names = (top: current.competitors.first?.abbreviation ?? "", bottom: current.competitors.last?.abbreviation ?? "")
                let teams = FootballFeed.Teams(topIsHome: homeIsTop, topID: ids.first ?? nil, bottomID: ids.last ?? nil,
                                               homeAbbreviation: homeIsTop ? names.top : names.bottom,
                                               awayAbbreviation: homeIsTop ? names.bottom : names.top)
                let before = footballFeed.score
                await footballFeed.update(path: path, eventID: id, teams: teams)
                moments.retract(footballFeed.takeRetractions())
                moments.offer(footballFeed.takeMoments())
                // A score: refresh the rest (scoring list, stats) now, not in half a minute.
                if before != nil, footballFeed.score != before { await refreshDetail(current) }
            case let .espn(path, id, .baseball)?:
                guard let names = detail?.athleteNames else { break }
                let ids = current.competitors.map { $0.id?.split(separator: "-").last.map(String.init) }
                let top = ids.first ?? nil, bottom = ids.last ?? nil
                let before = baseballFeed.score
                await baseballFeed.update(path: path, eventID: id, names: names) { team in
                    team == top ? .top : team == bottom ? .bottom : nil
                }
                moments.offer(baseballFeed.takeMoments())
                if before != nil, baseballFeed.score != before { await refreshDetail(current) }
            case let .espn(path, id, .basketball)? where path == NBADetail.path:
                // Wait for the first full load: it says which team is home.
                guard let topIsHome = detail?.topIsHome else { break }
                let ids = current.competitors.map { $0.id?.split(separator: "-").last.map(String.init) }
                let teams = BasketballFeed.Teams(topIsHome: topIsHome, topID: ids.first ?? nil, bottomID: ids.last ?? nil,
                                                 topName: current.competitors.first?.abbreviation ?? "",
                                                 bottomName: current.competitors.last?.abbreviation ?? "")
                await basketballFeed.update(eventID: id, teams: teams)
                moments.retract(basketballFeed.takeRetractions())
                moments.offer(basketballFeed.takeMoments())
            case .counterStrike?:
                guard let matchID = Int(current.id.dropFirst(3)) else { return }
                let ids = current.competitors.map { $0.id.flatMap { Int($0.dropFirst(3)) } }
                let live = await CSDetail.liveState(matchID: matchID, topTeamID: ids.first ?? nil, bottomTeamID: ids.last ?? nil)
                if !Task.isCancelled, detail != nil, live != detail?.csLive {
                    if let previous = detail?.csLive, let live {
                        moments.offer(MatchRules.csMoments(from: previous, to: live,
                                                           names: (current.competitors.first?.name ?? "", current.competitors.last?.name ?? ""),
                                                           maps: detail?.maps ?? []))
                    }
                    withAnimation(reduceMotion ? nil : Motion.quick) { detail?.csLive = live }
                }
            case .espn(_, _, .soccer)?:
                // A few kilobytes: only actions added since the last look.
                if detail != nil { await loadSoccerExtras(current) }
            case .climbing?:
                // IFSC updates a climber's score hold by hold.
                if let d = detail, roundLive(d) { await refreshDetail(current) }
            default:
                return
            }
            try? await Task.sleep(for: .seconds(isSoccer ? 8 : (isClimbing ? 4 : 5)))
        }
    }

    // MARK: Loading

    /// Later refreshes update in place; only new events (a goal, a play)
    /// animate, so the page doesn't shift while it's read.
    private func apply(_ loaded: GameDetail) {
        var loaded = loaded
        // Keep whichever CS2 reading is newer, the fast lane's or the full load's
        // (so the score never steps back), and a newer one can carry a moment.
        if let lane = detail?.csLive {
            if let full = loaded.csLive, Self.newer(full, than: lane) {
                moments.offer(MatchRules.csMoments(from: lane, to: full,
                                                   names: (event.competitors.first?.name ?? "", event.competitors.last?.name ?? ""),
                                                   maps: loaded.maps))
            } else {
                loaded.csLive = lane
            }
        }
        if let previous = detail, event.state == .live {
            moments.offer(MatchRules.climbingMoments(from: previous, to: loaded))
            // Climbing results, live: who moved up or down since the last look (same round only).
            if isClimbing, previous.roundName == loaded.roundName {
                let deltas = MatchRules.rankDeltas(from: previous.ranking, to: loaded.ranking)
                if !deltas.isEmpty { rankShift = RankShift(id: rankShift.id + 1, deltas: deltas) }
            }
        }
        let structural = loaded.moments.map(\.id) != detail?.moments.map(\.id)
            || loaded.recentPlays != detail?.recentPlays
        if structural {
            withAnimation(reduceMotion ? Motion.fade : Motion.standard) { detail = loaded }
        } else {
            detail = loaded
        }
    }

    /// Whether one CS2 reading is further on than another.
    private static func newer(_ a: GameDetail.CSLive, than b: GameDetail.CSLive) -> Bool {
        let key = { (r: GameDetail.CSLive) in (r.mapNumber ?? 0, r.topScore + r.bottomScore, r.mapEnded ? 1 : 0) }
        return key(a) > key(b)
    }

    /// An out-of-cycle full refresh, when the fast lane sees a score.
    private func refreshDetail(_ current: Event) async {
        guard let loaded = try? await DetailProvider.detail(for: current), !Task.isCancelled else { return }
        apply(loaded)
    }

    /// A final that started more than six hours ago: loaded once, never refreshed.
    static func isHistory(_ event: Event, now: Date = .now) -> Bool {
        event.state == .final && event.start < now - 6 * 3600
    }

    /// Finished within the last day: today's table is still about this game.
    private var isRecent: Bool { event.start > .now - 86_400 }

    /// Waits for `task`, cancelling it if this page goes away first.
    private func finish(_ task: Task<Void, Never>) async {
        await withTaskCancellationHandler { await task.value } onCancel: { task.cancel() }
    }

    /// Whether `task` finishes within `limit`; either way it keeps running.
    /// (A task group can't race it: the group would wait for the task anyway.)
    private static func finishes(_ task: Task<Void, Never>, within limit: Duration) async -> Bool {
        await withCheckedContinuation { (result: CheckedContinuation<Bool, Never>) in
            let once = ResumeOnce(result)
            Task { @MainActor in
                await task.value
                once.resume(true)
            }
            Task { @MainActor in
                try? await Task.sleep(for: limit)
                once.resume(false)
            }
        }
    }

    private func poll() async {
        var extras: Task<Void, Never>?
        // Leaving the page stops its background fetches too.
        defer { extras?.cancel() }
        var firstLoad = true
        while !Task.isCancelled {
            let current = event
            do {
                let task = Task {
                    await loadSoccerExtras(current)
                    await loadCollegeExtras()
                    await loadNBAExtras()
                }
                extras = task
                let loaded = try await DetailProvider.detail(for: current)
                if firstLoad {
                    // Give the extras (pitch, table) up to 200ms to land with
                    // the rest, so the page usually assembles once; past that
                    // the page shows and they glide in when they're ready.
                    let ready = await Self.finishes(task, within: .milliseconds(200))
                    guard !Task.isCancelled else { return }
                    // The first data assembles like a page entrance: no withAnimation here.
                    arrival = .data(in: Self.contentSpace, page: page)
                    extrasShown = ready
                    detail = loaded
                    firstLoad = false
                    if !ready {
                        await finish(task)
                        guard !Task.isCancelled else { return }
                        // Sections below glide down; the late ones stack in.
                        withAnimation(reduceMotion ? Motion.fade : Motion.standard) {
                            arrival = .data(in: Self.contentSpace, page: page)
                            extrasShown = true
                        }
                    }
                } else {
                    await finish(task)
                    apply(loaded)
                }
                failed = false
                lastLoaded = .now
                if detailFailures != 0 { withAnimation(Motion.fade) { detailFailures = 0 } }
                store.noteStreams(loaded.streams, for: current)
                // History (finished more than six hours ago) doesn't change: one
                // load per visit, extras included (they've finished by here) (G1).
                if Self.isHistory(current) { return }
            } catch {
                if detail == nil { failed = true } else if !Task.isCancelled { detailFailures += 1 }
            }
            // Live games refresh quickly; everything else rarely changes. A first
            // load that failed retries soon.
            // The fast lane keeps live football, CS2 and soccer moving; the full
            // refresh (stats, key events, rosters) can take its time.
            let interval: Double = detail == nil ? 5 : (current.state == .live ? (hasFastLane(current) ? 30 : 15) : 120)
            try? await Task.sleep(for: .seconds(interval))
        }
    }
}

/// Whether the pointer is over a page's content, kept by reference so
/// writing it re-renders nothing.
@MainActor
final class PointerPresence {
    var inside = false
}

/// How big a team's name is in the hero: 12pt, stepping down (11.5, 11,
/// 10.5) only when its longest word wouldn't fit the column, so a long word
/// ("Wolverhampton", "Mönchengladbach") never breaks mid-word. Plain
/// arithmetic on measured word widths: no trial layouts (a `ViewThatFits`
/// here re-measured the hero on every hover anywhere on the page).
enum HeroName {
    static let sizes: [CGFloat] = [12, 11.5, 11, 10.5]

    /// The widest word among these names at each size (pure; tested).
    static func longestWords(_ names: [String]) -> [CGFloat] {
        let words = names.flatMap { $0.split(separator: " ").map(String.init) }
        return sizes.map { size in
            let font = NSFont.systemFont(ofSize: size, weight: .medium)
            return words.map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max()?.rounded(.up) ?? 0
        }
    }

    /// The largest size whose longest word fits `room` (the smallest if none does). (pure; tested)
    nonisolated static func size(longestWords: [CGFloat], room: CGFloat) -> CGFloat {
        for (index, width) in longestWords.enumerated() where width <= room { return sizes[index] }
        return sizes[sizes.count - 1]
    }

    /// What else shares the name's line: the rank, and 11pt per glyph (ball, star, trophy).
    static func extras(rank: Int?, glyphs: Int) -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .semibold)
        let rankWidth = rank.map { ("\($0)" as NSString).size(withAttributes: [.font: font]).width + 3 } ?? 0
        return rankWidth + CGFloat(glyphs) * 11
    }
}

/// The name's line in a hero column: it takes the column's width (so the
/// size never feeds back into it) and hands its content the name's size.
/// The size is worked out from the geometry, and the line re-renders only
/// when it changes (crossing a step), never per frame of a resize.
private struct HeroNameLine<Content: View>: View {
    /// `HeroName.longestWords` of the names sharing a size.
    let words: [CGFloat]
    let extras: CGFloat
    @ViewBuilder let content: (CGFloat) -> Content
    @State private var size = HeroName.sizes[0]

    var body: some View {
        let words = words, extras = extras
        content(size)
            .frame(maxWidth: .infinity)
            .onGeometryChange(for: CGFloat.self) { proxy in
                HeroName.size(longestWords: words, room: proxy.size.width - extras)
            } action: { size = $0 }
    }
}

/// A continuation two racers share: the first to finish resumes it.
private final class ResumeOnce: Sendable {
    private let continuation: Mutex<CheckedContinuation<Bool, Never>?>

    init(_ continuation: CheckedContinuation<Bool, Never>) {
        self.continuation = Mutex(continuation)
    }

    func resume(_ value: Bool) {
        continuation.withLock { $0.take() }?.resume(returning: value)
    }
}

/// The page's heading takes VoiceOver's focus when the page comes on screen
/// (opened, Back to it, the panel reopened), as `PageTitle` does for pages
/// with a title. Reading `pageLive` here keeps it out of the page's body.
private struct PageHeadingFocus: ViewModifier {
    @AccessibilityFocusState private var focused: Bool
    @Environment(\.pageLive) private var live

    func body(content: Content) -> some View {
        content
            .accessibilityFocused($focused)
            .task(id: live) {
                guard live else { return }
                // Once the page is in the accessibility tree.
                try? await Task.sleep(for: .milliseconds(100))
                focused = true
            }
    }
}

// MARK: - CS2 pieces

extension Color {
    static let twitch = Color(red: 0.57, green: 0.27, blue: 1.0)
}

/// The co-streamer's Twitch avatar with a purple ring; a generic live glyph if
/// the avatar can't be fetched.
struct CoStreamIcon: View {
    @Environment(ScoreStore.self) private var store
    var size: CGFloat = 13

    var body: some View {
        Group {
            if let avatar = store.coStreamerAvatar {
                LogoView(url: avatar, size: size).clipShape(Circle())
            } else {
                Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: size * 0.7, weight: .semibold))
                    .foregroundStyle(Color.twitch)
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(Color.twitch, lineWidth: 1.25))
        .help("\(store.coStreamerName) is streaming this match on Twitch")
        .accessibilityLabel("\(store.coStreamerName) is streaming this match on Twitch")
    }
}

private struct MapList: View {
    let maps: [GameDetail.MapResult]
    let final: Bool
    /// bo3.gg's live feed, for the map being played.
    var live: GameDetail.CSLive? = nil
    let topTeam: Competitor?
    let bottomTeam: Competitor?

    var body: some View {
        StackColumn {
            ForEach(maps) { map in
                VStack(spacing: 0) {
                    if map.id != maps.first?.id { Divider() }
                    row(map)
                }
            }
        }
    }

    private func row(_ map: GameDetail.MapResult) -> some View {
        // The live feed knows the map being played before the match record does.
        let feed = map.live && (live?.mapNumber == nil || live?.mapNumber == map.number) ? live : nil
        let name = map.name != "TBD" ? map.name : feed?.mapName ?? map.name
        let picked = name != "TBD"
        let topScore = map.topScore ?? feed?.topScore, bottomScore = map.bottomScore ?? feed?.bottomScore
        return HStack(spacing: 8) {
            Text("\(map.number)").font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .foregroundStyle(.secondary).frame(width: 12)
            Text(picked ? name : "Not picked yet")
                .font(.system(size: 12.5, weight: picked ? .medium : .regular))
                .foregroundStyle(picked ? .primary : .secondary)
            if map.live {
                HStack(spacing: 3) { LiveDot(); Text("Live") }
                    .font(.system(size: 10.5, weight: .semibold)).foregroundStyle(.red)
            }
            Spacer()
            if let t = topScore, let b = bottomScore {
                HStack(spacing: 5) {
                    Text("\(t)").fontWeight(map.winner == .top ? .bold : .regular)
                        .foregroundStyle(map.winner == .bottom ? .secondary : .primary)
                    Text("–").foregroundStyle(.secondary)
                    Text("\(b)").fontWeight(map.winner == .bottom ? .bold : .regular)
                        .foregroundStyle(map.winner == .top ? .secondary : .primary)
                }
                .font(.system(size: 12.5).monospacedDigit())
                .contentTransition(.numericText())
            } else if final || map.live || picked {
                // An unpicked map that hasn't started needs no second "not".
                Text(final ? "Not played" : map.live ? "In progress" : "Not started")
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            // The winner's crest rather than a truncated name.
            Group {
                if let winner = map.winner, let team = winner == .top ? topTeam : bottomTeam {
                    LogoView(url: team.logo, darkURL: team.darkLogo, size: 14)
                        .help("\(team.name) won \(map.name)")
                } else {
                    Color.clear
                }
            }
            .frame(width: 22, alignment: .trailing)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(map))
    }

    private func accessibilityText(_ map: GameDetail.MapResult) -> String {
        let name = map.name == "TBD" ? "not picked yet" : map.name
        guard let t = map.topScore, let b = map.bottomScore else { return "Map \(map.number), \(name)." }
        let winner = map.winner.flatMap { ($0 == .top ? topTeam : bottomTeam)?.name }
        return "Map \(map.number), \(name): \(topTeam?.name ?? "") \(t), \(bottomTeam?.name ?? "") \(b)."
            + (winner.map { " \($0) won." } ?? "")
    }
}

/// Where a stream lives, shown as a small platform glyph.
private enum Platform {
    case twitch, youtube, kick, other

    init(_ url: URL) {
        let host = url.host()?.lowercased() ?? ""
        self = host.contains("twitch") ? .twitch : host.contains("youtube") || host.contains("youtu.be") ? .youtube
            : host.contains("kick.com") ? .kick : .other
    }

    var name: String? {
        switch self {
        case .twitch: "Twitch"
        case .youtube: "YouTube"
        case .kick: "Kick"
        case .other: nil
        }
    }

    var icon: some View {
        let (symbol, color): (String, Color) = switch self {
        case .twitch: ("dot.radiowaves.left.and.right", .twitch)
        case .youtube: ("play.rectangle.fill", .red)
        case .kick: ("play.fill", .green)
        case .other: ("tv", .secondary)
        }
        // Told apart by glyph and color on screen; by name to VoiceOver and in the tooltip.
        return Image(systemName: symbol).font(.system(size: 11)).foregroundStyle(color).frame(width: 16)
            .help(name ?? "Stream")
    }
}

private struct StreamList: View {
    @Environment(ScoreStore.self) private var store
    let streams: [GameDetail.Stream]
    let coStreaming: Bool

    var body: some View {
        StackColumn(spacing: 2) {
            if coStreaming, let url = store.coStreamerURL {
                StreamRow(name: store.coStreamerName, detail: "Co-streaming", url: url, highlight: true) {
                    CoStreamIcon(size: 16)
                }
            }
            ForEach(streams.prefix(5)) { s in
                StreamRow(name: s.name,
                          detail: [s.official ? "Official" : nil, s.language?.uppercased(), viewers(s.viewers)]
                              .compactMap { $0 }.joined(separator: " · "),
                          url: s.url, highlight: false, platform: Platform(s.url).name) {
                    Platform(s.url).icon
                }
            }
        }
    }

    private func viewers(_ n: Int) -> String? {
        guard n > 0 else { return nil }
        return n.formatted(.number.notation(.compactName)) + " watching"
    }
}

/// A stream or broadcaster: what it is, then (fixed, never cut) its detail
/// ("241K watching", "Radio"). The name gives way first: in the middle for a
/// channel name (two channels often differ only at the end), or onto a
/// second line for a broadcaster ("… Radio Network (Spanish)").
private struct StreamRow<Icon: View>: View {
    let name: String
    let detail: String
    let url: URL?
    let highlight: Bool
    var tint: Color = .twitch
    /// Twitch, YouTube, Kick: said first, as the glyph shows it.
    var platform: String? = nil
    /// Broadcaster names wrap to two lines; channel names truncate in the middle.
    var nameLines = 1
    @ViewBuilder let icon: Icon
    @State private var hovering = false

    var body: some View {
        Button { if let url { NSWorkspace.shared.open(url) } } label: {
            HStack(spacing: 8) {
                icon
                Text(name).font(.system(size: 12, weight: highlight ? .semibold : .regular))
                    .lineLimit(nameLines)
                    .truncationMode(nameLines == 1 ? .middle : .tail)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                Text(detail).font(.system(size: 10.5)).foregroundStyle(highlight ? tint : .secondary).lineLimit(1)
                    .fixedSize()
                    .layoutPriority(1)
                if url != nil {
                    Image(systemName: "arrow.up.right").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: hovering && url != nil, inset: 0))
        .disabled(url == nil)
        .onHover { hovering = $0 }
        .padding(.horizontal, -6)
        .help(url.map { "Open \($0.host() ?? "stream")" } ?? "")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([platform, name, detail.replacingOccurrences(of: " · ", with: ", ")]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(url == nil ? "" : "Opens in your browser")
        .accessibilityAction { if let url { NSWorkspace.shared.open(url) } }
    }
}

/// Official broadcasters (US), linked to each service's own watch page.
private struct BroadcasterList: View {
    let broadcasters: [Broadcaster]

    var body: some View {
        StackColumn(spacing: 2) {
            ForEach(broadcasters) { b in
                StreamRow(name: b.name, detail: kind(b.kind), url: b.url, highlight: false, nameLines: 2) {
                    Image(systemName: symbol(b.kind)).font(.system(size: 11)).foregroundStyle(.secondary).frame(width: 16)
                }
            }
        }
    }

    private func kind(_ kind: Broadcaster.Kind) -> String {
        switch kind {
        case .tv: "TV"
        case .streaming: "Streaming"
        case .subscription: "Subscription"
        case .radio: "Radio"
        }
    }

    private func symbol(_ kind: Broadcaster.Kind) -> String {
        switch kind {
        case .tv: "tv"
        case .streaming, .subscription: "play.rectangle"
        case .radio: "radio"
        }
    }
}

// MARK: - Rosters

/// The two lineups side by side: flag, nickname, real name; the coach below.
private struct RosterColumns: View {
    let top: GameDetail.Roster
    let bottom: GameDetail.Roster
    let topTeam: Competitor?
    let bottomTeam: Competitor?
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            column(top, team: topTeam)
            Rectangle().fill(Viz.grid).frame(width: 0.5).frame(maxHeight: .infinity).stackIn()
            column(bottom, team: bottomTeam)
        }
        // Each player row is its own entrance unit.
        .containerValue(\.stacksOwnRows, true)
    }

    private func column(_ roster: GameDetail.Roster, team: Competitor?) -> some View {
        StackColumn(spacing: 7) {
            HStack(spacing: 6) {
                LogoView(url: team?.logo, darkURL: team?.darkLogo, size: 14)
                Text(team?.name ?? "").font(.system(size: 11, weight: .semibold)).lineLimit(1)
            }
            .padding(.bottom, 2)
            if roster.isEmpty {
                Text("Lineup not available.").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            ForEach(roster.players) { player(row: $0) }
            if let coach = roster.coach {
                VStack(alignment: .leading, spacing: 7) {
                    Divider()
                    HStack(spacing: 6) {
                        Text(coach.flag ?? "").font(.system(size: 12)).frame(width: 16)
                        VStack(alignment: .leading, spacing: 0) {
                            // Drawn in caps, read as written ("Coach").
                            Text("Coach").textCase(.uppercase).font(.system(size: 9.5, weight: .semibold)).tracking(0.4)
                                .foregroundStyle(.secondary)
                            Text(coach.nickname).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                .help([coach.nickname, coach.realName].compactMap { $0 }.joined(separator: " — "))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Coach, \(coach.nickname)")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A player opens their page (bo3.gg's, by slug): the whole row is the link.
    private func player(row p: GameDetail.Player) -> some View {
        let ref = p.slug.map { Profile.PlayerRef(source: .counterStrike(slug: $0), id: String(p.id), name: p.nickname, photo: p.photo) }
        let open = navigator.flatMap { nav in ref.map { r in { nav.open(r) } } }
        return HStack(spacing: 6) {
            Text(p.flag ?? "").font(.system(size: 12)).frame(width: 16)
            VStack(alignment: .leading, spacing: 0) {
                Text(p.nickname).font(.system(size: 12, weight: .medium)).lineLimit(1)
                if let real = p.realName {
                    Text(real).font(.system(size: 9.5)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .help(open == nil ? [p.nickname, p.realName].compactMap { $0 }.joined(separator: " — ") : "")
        .profileRowLink(help: "Open \(p.nickname)", action: open)
        .contextMenu { if let ref, open != nil { GoToPlayerItem(player: ref, via: navigator) } }
    }
}

// MARK: - Climbing

/// World Climbing's stream for this round (live, or counting down), plus the channel.
private struct ClimbingWatch: View {
    let broadcast: ClimbingBroadcast?
    let final: Bool

    var body: some View {
        StackColumn(spacing: 2) {
            if let broadcast, !final {
                StreamRow(name: broadcast.title, detail: status(broadcast), url: broadcast.url,
                          highlight: broadcast.isLive, tint: .red) {
                    Image(systemName: "play.rectangle.fill").font(.system(size: 12)).foregroundStyle(.red).frame(width: 16)
                }
            }
            StreamRow(name: "World Climbing on YouTube", detail: final ? "Replays" : "All streams",
                      url: ClimbingBroadcast.channelURL, highlight: false) {
                Image(systemName: "play.rectangle").font(.system(size: 12)).foregroundStyle(.secondary).frame(width: 16)
            }
        }
    }

    private func status(_ b: ClimbingBroadcast) -> String {
        if b.isLive { return "Live now" }
        guard let start = b.start else { return "Time TBA" }
        return Countdown.text(to: start).map { "Starts \($0)" } ?? When.dayAndTime(start)
    }
}

/// Top 12, plus any athletes from the user's countries placed lower, highlighted.
/// Live, rows glide to their new places; each move shows ▲2 / ▼1 for the
/// moment's hold, and a row that moved up washes once in the accent.
struct RankingList: View {
    let athletes: [GameDetail.Athlete]
    let countries: Set<String>
    var shift: RankShift? = nil
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationLevel) private var level
    @Environment(\.celebrationClock) private var clock
    /// The chips on show (athlete ID → places), cleared after the hold.
    @State private var chips: [Int: Int] = [:]
    /// Per athlete, bumped each time they move up: their row's wash plays once.
    @State private var washes: [Int: Int] = [:]

    private var top: [GameDetail.Athlete] { Array(athletes.prefix(12)) }
    private var yoursBelow: [GameDetail.Athlete] {
        athletes.dropFirst(12).filter { $0.country.map(countries.contains) ?? false }
    }

    var body: some View {
        StackColumn(spacing: 5) {
            ForEach(top) { row($0) }
            if !yoursBelow.isEmpty {
                HStack(spacing: 6) {
                    Text("Your countries").font(.system(size: 9.5, weight: .semibold)).foregroundStyle(.secondary)
                    Rectangle().fill(Viz.grid).frame(height: 0.5)
                }
                .padding(.vertical, 3)
                ForEach(yoursBelow) { row($0) }
            }
        }
        // Positions jump with Reduce Motion; otherwise rows glide.
        .animation(reduceMotion ? nil : Motion.travel, value: athletes.map(\.id))
        .task(id: shift?.id ?? 0) {
            // No shift (the round's no longer live): chips from the last one go.
            guard let shift, !shift.deltas.isEmpty else {
                if !chips.isEmpty { withAnimation(Motion.exit) { chips = [:] } }
                return
            }
            chips = shift.deltas
            for (id, delta) in shift.deltas where delta > 0 { washes[id, default: 0] += 1 }
            // Held like a moment (4 s), then out quickly.
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            withAnimation(Motion.exit) { chips = [:] }
        }
    }

    /// On the harness's frozen clock, the shift as it first shows.
    private var shownChips: [Int: Int] {
        if case .frozen = clock { return shift?.deltas ?? [:] }
        return chips
    }

    private func wash(_ id: Int) -> Int {
        if case .frozen = clock { return (shift?.deltas[id] ?? 0) > 0 ? 1 : 0 }
        return washes[id] ?? 0
    }

    private func row(_ a: GameDetail.Athlete) -> some View {
        let yours = a.country.map(countries.contains) ?? false
        let country = a.country.map(TeamCatalog.countryName)
        let athlete = Profile.PlayerRef(source: .ifsc, id: String(a.id), name: a.name, country: a.country)
        return HStack(spacing: 8) {
            Text(a.rank.map(String.init) ?? "–")
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(a.rank.map { $0 <= 3 } == true ? .primary : .secondary)
                .frame(width: 18, alignment: .trailing)
            // Flags carry the color on climbing pages.
            Text(Flag.emoji(ioc: a.country) ?? "")
                .font(.system(size: 13))
                .frame(width: 18)
                .help(country ?? "")
            PlayerNameLink(player: athlete) {
                Text(a.name).font(.system(size: 12, weight: yours ? .semibold : .regular)).lineLimit(1)
            }
            // After the name, so nothing else in the row moves when it comes and goes.
            if let delta = shownChips[a.id] {
                // A rank chip isn't a celebration: the house chip, not the bouncy pop.
                DeltaChip(delta: delta)
                    .transition(Motion.chip(reduceMotion: reduceMotion))
            }
            Spacer()
            if let score = a.score {
                Text(score).font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(yours ? Viz.highlight : .clear))
        .background {
            // Moved up: the accent washes in and out once (EventRow's flash timings).
            let peak = level == .off ? 0.0 : 1.0
            OneShot(trigger: wash(a.id)) { Celebrate.pill(peak: peak, fadeOut: reduceMotion ? 0.3 : 1.2) } content: { o in
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color.accentColor.opacity(0.10 * o))
            }
        }
        .padding(.horizontal, -6)
        // A click on the name opens the climber's page; anywhere else pins them
        // on the wall or scorecard (again, or Esc, unpins). The row reads the
        // focus itself, so a hover re-runs rows, not the list.
        .linkedRow(Focus(athlete: a.id), litBy: { $0?.athlete == a.id }, pinnable: true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([a.rank.map { Ordinal.string($0) }, a.name, country, a.score.map { "score \($0)" },
                             yours ? "Your country" : nil].compactMap { $0 }.joined(separator: ", "))
        .showOnChartAction(Focus(athlete: a.id))
        // A double click anywhere (or the menu) opens their page too, as Finder opens what a click selects.
        .playerPageLink(athlete)
    }
}

/// Keeps DetailView's event current without making the page observe the
/// store: this modifier's body is what re-runs on every poll, and it writes
/// the page's state only when the event (or the table's live games) changed.
private struct LiveEventSync: ViewModifier {
    let snapshot: Event
    let league: League?
    @Binding var live: Event
    @Binding var leagueLive: [Event]
    /// While every score feed is failing, when the scores last updated.
    @Binding var staleSince: Date?
    @Environment(ScoreStore.self) private var store

    func body(content: Content) -> some View {
        let current = store.current(snapshot)
        let inLeague = league.map { store.liveEvents(in: $0) } ?? []
        let stale = store.allFailed ? store.lastUpdated : nil
        content
            .onChange(of: current, initial: true) { _, new in if live != new { live = new } }
            .onChange(of: inLeague, initial: true) { _, new in if leagueLive != new { leagueLive = new } }
            .onChange(of: stale, initial: true) { _, new in
                guard staleSince != new else { return }
                withAnimation(Motion.fade) { staleSince = new }
            }
    }
}
