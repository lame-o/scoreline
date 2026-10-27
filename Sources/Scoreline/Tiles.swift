import AppKit
import SwiftUI

// A tile is a miniature of the match page's hero: crests facing each other,
// the score between them, and on live tiles each half on its team's color.
// Large tiles carry the game's situation in a strip; small ones are dense.

extension VerticalAlignment {
    private enum CrestCenter: AlignmentID {
        static func defaultValue(in d: ViewDimensions) -> CGFloat { d[VerticalAlignment.center] }
    }
    /// Through the crests' centers, so the score sits level with them.
    static let crestCenter = VerticalAlignment(CrestCenter.self)
}

// MARK: - Event tile

struct EventTile: View {
    /// For actions (menu, VoiceOver) only; the body never reads it, so a tile
    /// redraws only when its inputs change.
    @Environment(ScoreStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    let event: Event
    let size: TileSize
    let league: League?
    var highlighted = false
    /// The arrow keys put the highlight here (it then wears the accent).
    var keyboard = false
    var pinned = false
    /// Followed competitor IDs in this game.
    var followed: Set<String> = []
    var coStreaming = false
    /// Climbing: World Climbing's YouTube stream is live.
    var streaming = false
    /// Climbing: the user's countries (IOC).
    var countries: [String] = []
    /// Crests that travel in from the tier's collapsed preview.
    var logoMatches: Set<String> = []
    /// Set when the tile appears because its tier was just expanded: crests
    /// travel in and settle to size; everything else reveals after this delay.
    var revealDelay: Double? = nil
    var onHover: (Bool) -> Void = { _ in }
    var onSelect: (Event) -> Void = { _ in }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var revealed = false

    private var shown: Bool { revealDelay == nil || revealed }

    enum Presentation { case live, nextUp, small, liveSmall }

    var presentation: Presentation {
        switch (size, event.state) {
        case (.large, .live): .live
        case (.large, _): .nextUp
        case (.small, .live): .liveSmall
        case (.small, _): .small
        }
    }

    var body: some View {
        content
        .padding(size == .large ? TileMetrics.padLarge : TileMetrics.padSmall)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background {
            if presentation == .live, let wash {
                TileWash(left: wash.left, right: wash.right, intensity: wash.intensity).opacity(shown ? 1 : 0)
            }
        }
        .modifier(TilePress(highlighted: highlighted, keyboard: keyboard, shown: shown) { onSelect(event) })
        .onAppear {
            guard let delay = revealDelay, !revealed else { return }
            withAnimation((reduceMotion ? Motion.exit : Motion.reveal).delay(reduceMotion ? 0 : delay)) { revealed = true }
        }
        .onHover(perform: onHover)
        .contextMenu { EventContextMenu(event: event) }
        .modifier(OptionalHelp(text: size == .small ? tooltip : nil))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isButton)
        // VoiceOver's press opens the game, as a button's would.
        .accessibilityAction { onSelect(event) }
        .accessibilityAction(named: pinned ? "Remove from Menu Bar" : "Show in Menu Bar") { store.togglePin(event) }
        .accessibilityActions {
            ForEach(RowActions.actions(event, store: store, following: { followed.contains($0.id ?? "") },
                                       navigator: navigator)) { action in
                Button(action.name, action: action.perform)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch event.content {
        case let .match(top, bottom):
            switch presentation {
            case .live: liveLarge(top, bottom)
            case .nextUp: nextUpLarge(top, bottom)
            case .small, .liveSmall: small(top, bottom)
            }
        case let .field(title, summary):
            FieldTileContent(event: event, title: title, summary: summary, presentation: presentation,
                             header: TileHeader(event: event, league: league, large: size == .large, pinned: pinned,
                                                coStreaming: coStreaming, streaming: streaming),
                             countries: countries)
                .reveal(shown, reduceMotion: reduceMotion)
        }
    }

    private var header: some View {
        TileHeader(event: event, league: league, large: size == .large, pinned: pinned, coStreaming: coStreaming,
                   streaming: streaming)
            .reveal(shown, reduceMotion: reduceMotion)
    }

    private var crests: FaceOffCrests {
        FaceOffCrests(matches: logoMatches, settling: revealDelay != nil && !reduceMotion)
    }

    // MARK: Large, live

    private func liveLarge(_ top: Competitor, _ bottom: Competitor) -> some View {
        let palette = self.palette(top, bottom)
        let strip = TileStripView(event: event, top: top, bottom: bottom, palette: palette, countries: countries)
        return VStack(spacing: 0) {
            header
            Spacer(minLength: 4)
            FaceOff(top: top, bottom: bottom, large: true, followed: followed, ball: ball(top, bottom), crests: crests,
                    textShown: shown) {
                TileScore(top: top.score, bottom: bottom.score, style: .forLarge(top.score, bottom.score), live: true,
                          pops: TileScore.pops(league?.sport))
            }
            Spacer(minLength: 4)
            Group {
                if strip.hasStrip {
                    strip.frame(height: TileMetrics.stripHeight)
                }
                if let line = liveText {
                    DetailLine(text: line).padding(.top, strip.hasStrip ? 3 : 0)
                }
            }
            .reveal(shown, reduceMotion: reduceMotion)
        }
    }

    /// The strip's words: the sport's live text, then the row's live line, then the caption.
    private var liveText: String? {
        switch event.snapshot {
        case let .baseball(state)?:
            let matchup = [state.batter.map { "\($0) batting" }, state.pitcher.map { "\($0) pitching" }].compactMap { $0 }
            if !matchup.isEmpty { return matchup.joined(separator: " · ") }
        case let .soccer(marks)?:
            if let goal = MatchMark.lastGoalLine(marks) { return goal }
            return event.caption
        case let .basketball(lastPlay)?:
            return event.liveLine ?? lastPlay ?? event.caption
        case .counterStrike?:
            return event.caption
        default: break
        }
        return event.liveLine ?? event.caption
    }

    // MARK: Large, next up

    private func nextUpLarge(_ top: Competitor, _ bottom: Competitor) -> some View {
        VStack(spacing: 0) {
            header
            Spacer(minLength: 4)
            FaceOff(top: top, bottom: bottom, large: true, followed: followed, records: true, crests: crests, textShown: shown) {
                NextUpCountdown(start: event.start, field: false, delayed: event.detail == "Delayed")
            }
            Spacer(minLength: 4)
            if let caption = event.caption, !caption.isEmpty {
                DetailLine(text: caption).reveal(shown, reduceMotion: reduceMotion)
            }
        }
    }

    // MARK: Small

    private func small(_ top: Competitor, _ bottom: Competitor) -> some View {
        let dimTop = event.stepsBack(top), dimBottom = event.stepsBack(bottom)
        let base: BaseState? = if case let .baseball(state)? = event.snapshot { state } else { nil }
        return VStack(spacing: 0) {
            header
            Spacer(minLength: 2)
            FaceOff(top: top, bottom: bottom, large: false, followed: followed, dimTop: dimTop, dimBottom: dimBottom,
                    ball: ball(top, bottom), bases: presentation == .liveSmall ? base : nil, crests: crests, textShown: shown) {
                SmallCenter(event: event, top: top, bottom: bottom, pops: league?.sport != .basketball,
                            dimTop: dimTop, dimBottom: dimBottom)
            }
        }
    }

    // MARK: Pieces

    private func ball(_ top: Competitor, _ bottom: Competitor) -> GameDetail.Side? {
        guard event.state == .live, let possession = event.possession else { return nil }
        return possession == top.id ? .top : possession == bottom.id ? .bottom : nil
    }

    private func palette(_ top: Competitor, _ bottom: Competitor) -> TeamPalette {
        league?.id == "nba" ? .nba(top: top, bottom: bottom, scheme: colorScheme)
            : TeamPalette(top: top.color, bottom: bottom.color, scheme: colorScheme)
    }

    /// Team colors, or for climbing the flag of whoever the round is about.
    private var wash: (left: Color, right: Color, intensity: Double)? {
        switch event.content {
        case let .match(top, bottom):
            let p = palette(top, bottom)
            return (p.top, p.bottom, 1)
        case .field:
            if case let .climbing(wall)? = event.snapshot, let flag = FlagPalette.colors(ioc: wall.country) {
                return (flag.0, flag.1, 0.85)
            }
            return (.accentColor, .accentColor, 0.6)
        }
    }

    private var tooltip: String {
        switch event.content {
        case let .match(top, bottom):
            return ["\(top.name) vs \(bottom.name)", event.state == .live ? event.liveLine : nil, event.caption]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        case let .field(title, summary):
            return [title, summary, event.caption].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
    }

    /// The list row's words: the game ("Arsenal 2, Chelsea 1, 67th minute"),
    /// its marks, the situation, the league, what the strip shows, the caption.
    private var accessibilityLabel: String {
        // Football's strip reads the down and distance; baseball's, the count
        // and runners: the live line would say it twice.
        let stripSaysIt = switch event.snapshot {
        case .football?, .baseball?: true
        default: false
        }
        var parts = [event.spokenSummary]
        if case let .field(_, summary) = event.content, !summary.isEmpty { parts.append(summary) }
        if pinned { parts.append("In menu bar") }
        for team in event.competitors where followed.contains(team.id ?? "") { parts.append("Following \(team.name)") }
        if streaming { parts.append("Live on YouTube") }
        if coStreaming { parts.append("\(store.coStreamerName) is co-streaming") }
        if !stripSaysIt, event.state == .live, let line = event.liveLine, !line.isEmpty { parts.append(line) }
        if let league { parts.append(league.name) }
        if let strip = TileStripView.meaning(of: event) { parts.append(strip) }
        if let caption = event.caption, !caption.isEmpty { parts.append(caption) }
        return parts.joined(separator: ", ")
    }
}

/// A tile redraws only when what it shows changes (closures don't count).
extension EventTile: @MainActor Equatable {
    static func == (a: EventTile, b: EventTile) -> Bool {
        a.event == b.event && a.size == b.size && a.league?.id == b.league?.id && a.highlighted == b.highlighted
            && a.keyboard == b.keyboard && a.pinned == b.pinned && a.followed == b.followed && a.coStreaming == b.coStreaming
            && a.streaming == b.streaming && a.countries == b.countries && a.logoMatches == b.logoMatches
            && a.revealDelay == b.revealDelay
    }
}

private struct OptionalHelp: ViewModifier {
    let text: String?
    func body(content: Content) -> some View {
        if let text { content.help(text) } else { content }
    }
}

// MARK: - Header

/// Sport glyph and league, then accessories and the status. The league
/// label gives way first; the status never truncates.
struct TileHeader: View {
    @Environment(ScoreStore.self) private var store
    let event: Event
    let league: League?
    let large: Bool
    var pinned = false
    var coStreaming = false
    var streaming = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: league?.sport.symbol ?? "sportscourt")
                .font(.system(size: 9.5, weight: .semibold))
                .frame(width: 12)
            // The label leaves whole rather than as "COLLE…": the sport's
            // glyph still says what it is.
            ViewThatFits(in: .horizontal) {
                if large { label(league?.name) }
                label(league?.shortName)
                Color.clear.frame(width: 0, height: 0)
            }
            Spacer(minLength: 4)
            HStack(spacing: 4) {
                if coStreaming {
                    CoStreamIcon(size: 12).help("\(store.coStreamerName) is co-streaming")
                }
                if streaming {
                    Image(systemName: "play.rectangle.fill").font(.system(size: 10)).foregroundStyle(.red)
                        .help("Streaming on YouTube")
                }
                if pinned {
                    Image(systemName: "pin.fill").font(.system(size: 8.5)).foregroundStyle(.tertiary)
                        .help("Shown in menu bar")
                }
                TileStatus(event: event, large: large)
            }
            .fixedSize()
            .layoutPriority(1)
        }
        .foregroundStyle(.secondary)
        .frame(height: 13)
    }

    private func label(_ text: String?) -> some View {
        Text(text ?? "")
            .textCase(.uppercase)
            .font(.system(size: large ? 10.5 : 9.5, weight: .semibold))
            .tracking(large ? 0.5 : 0.4)
            .lineLimit(1)
            .fixedSize()
    }
}

/// Live: the pulsing dot and the ticking clock (the rows' own pieces).
/// Scheduled and final follow the list's status rules so both views agree.
struct TileStatus: View {
    let event: Event
    let large: Bool
    /// The scores can't be refreshed: the live dot holds still.
    @Environment(\.listStale) private var stale

    var body: some View {
        switch event.state {
        case .live:
            LiveStatus(event, size: large ? 11 : 10.5, animated: !stale)
        case .scheduled:
            TimelineView(.periodic(from: Date(timeIntervalSinceReferenceDate: 0), by: 30)) { context in
                if let text = Self.scheduledText(event: event, large: large, now: context.date) {
                    Text(text)
                        .font(.system(size: large ? 10.5 : 10).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        case .final:
            Text(Self.finalText(event))
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .help(Spoken.status(event.detail ?? "Final"))
        }
    }

    /// Next-up (large): "Today 5:20 PM". Small: the time when it's under 3h
    /// away (the countdown is the center), else the day ("Tomorrow"), none
    /// for today (the time is the center). A delayed game shows its listed
    /// time beside "Delayed" in the center.
    static func scheduledText(event: Event, large: Bool, now: Date) -> String? {
        if large { return When.dayAndTime(event.start, now: now) }
        if RowStatus.delayed(event, now: now) { return RowStatus.time(event.start) }
        guard event.start >= now else { return nil }
        if event.start.timeIntervalSince(now) < 3 * 3600 { return event.start.formatted(date: .omitted, time: .shortened) }
        return When.day(event.start, now: now)
    }

    /// A postponed game says so in the center; the header doesn't repeat it.
    static func finalText(_ event: Event) -> String {
        if case .match = event.content, event.competitors.allSatisfy({ $0.score == nil }) { return "" }
        return event.detail ?? "Final"
    }
}

// MARK: - Face-off

/// Crests facing each other with the center between them. Large: each crest
/// centered over its name in equal columns (the hero's arrangement). Small:
/// crests at the edges and names under them, free to use the room under the
/// center; full names when both fit, abbreviations otherwise (both sides
/// always use the same form).
struct FaceOff<Center: View>: View {
    let top: Competitor
    let bottom: Competitor
    let large: Bool
    var followed: Set<String> = []
    var dimTop = false
    var dimBottom = false
    var ball: GameDetail.Side? = nil
    /// Live-small baseball: a tiny diamond after the left team's name.
    var bases: BaseState? = nil
    /// Next up: season records under the names.
    var records = false
    var crests = FaceOffCrests()
    /// False while the tier is expanding: only the crests show, traveling in.
    var textShown = true
    @ViewBuilder let center: Center
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Large: whether each full name fits its column. Both sides use the same
    /// form, so one long name puts both on their abbreviations.
    @State private var fits = (top: true, bottom: true)

    var body: some View {
        if large {
            let full = fits.top && fits.bottom
            HStack(alignment: .crestCenter, spacing: 6) {
                column(top, dimmed: dimTop, hasBall: ball == .top, full: full)
                    .onGeometryChange(for: Bool.self) { LargeName.fits(top, ball: ball == .top, followed: followed, in: $0.size.width) }
                        action: { fits.top = $0 }
                center
                    .fixedSize()
                    .layoutPriority(1)
                    .reveal(textShown, reduceMotion: reduceMotion)
                column(bottom, dimmed: dimBottom, hasBall: ball == .bottom, full: full)
                    .onGeometryChange(for: Bool.self) { LargeName.fits(bottom, ball: ball == .bottom, followed: followed, in: $0.size.width) }
                        action: { fits.bottom = $0 }
            }
            .frame(maxWidth: TileMetrics.faceOffMax)
            .frame(maxWidth: .infinity)
        } else {
            VStack(spacing: 2) {
                // Narrowest small tile (488pt panel, 3 columns): 150.7 wide, so
                // 28 + 3 + center ≤ 68.7 + 3 + 28 inside 10pt padding.
                HStack(spacing: 0) {
                    crest(top)
                    Spacer(minLength: 3)
                    center
                        .fixedSize()
                        .layoutPriority(1)
                        .reveal(textShown, reduceMotion: reduceMotion)
                    Spacer(minLength: 3)
                    crest(bottom)
                }
                ViewThatFits(in: .horizontal) {
                    names(full: true)
                    names(full: false)
                }
                .reveal(textShown, reduceMotion: reduceMotion)
            }
        }
    }

    /// Always opaque, so it can travel in from the collapsed preview.
    private func crest(_ c: Competitor) -> some View {
        let size = large ? TileMetrics.crestLarge : TileMetrics.crestSmall
        return LogoView(url: c.logo, darkURL: c.darkLogo, size: size)
            .modifier(CrestSettle(from: 14 / size, active: crests.settling))
            .matchedLogo(crests.matchID(c))
            .alignmentGuide(.crestCenter) { $0[VerticalAlignment.center] }
    }

    private func column(_ c: Competitor, dimmed: Bool, hasBall: Bool, full: Bool) -> some View {
        VStack(spacing: 3) {
            crest(c)
            Group {
                nameLine(c, names: full, hasBall: hasBall, bases: nil)
                    .foregroundStyle(dimmed ? .secondary : .primary)
                if records, let record = c.record {
                    Text(RowText.record(record))
                        .font(.system(size: 10).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .reveal(textShown, reduceMotion: reduceMotion)
        }
        .frame(maxWidth: .infinity)
    }

    /// Short names center under their crest; longer ones grow inward from the edge.
    private func names(full: Bool) -> some View {
        HStack(spacing: 0) {
            nameLine(top, names: full, hasBall: ball == .top, bases: bases)
                .foregroundStyle(dimTop ? .secondary : .primary)
                .frame(minWidth: TileMetrics.crestSmall)
            Spacer(minLength: 10)
            nameLine(bottom, names: full, hasBall: ball == .bottom, bases: nil)
                .foregroundStyle(dimBottom ? .secondary : .primary)
                .frame(minWidth: TileMetrics.crestSmall)
        }
    }

    private func nameLine(_ c: Competitor, names: Bool, hasBall: Bool, bases: BaseState?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            if let rank = c.rank {
                Text("\(rank)")
                    .font(.system(size: large ? 10 : 9, weight: .semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Text(names ? c.name : c.abbreviation)
                .font(.system(size: large ? 11.5 : 10, weight: .medium))
                .lineLimit(1)
            if let bases {
                MiniBases(state: bases)
            }
            if hasBall {
                PossessionGlyph().accessibilityHidden(true)
            }
            if followed.contains(c.id ?? "") {
                Image(systemName: "star.fill")
                    .font(.system(size: 7.5))
                    .foregroundStyle(.yellow)
                    .transition(Motion.chip(reduceMotion: reduceMotion))
                    .accessibilityHidden(true)
            }
        }
        // The ball changing hands: the glyph moves to the other name.
        .animation(reduceMotion ? Motion.fade : Motion.quick, value: hasBall)
    }
}

/// Whether a large tile's full name line fits its column: measured from the
/// text (rank, name, ball, star), never by laying out both forms. Only a
/// change of answer re-renders the face-off.
enum LargeName {
    private static let name = NSFont.systemFont(ofSize: 11.5, weight: .medium)
    private static let rank = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .semibold)

    static func fits(_ c: Competitor, ball: Bool, followed: Set<String>, in width: CGFloat) -> Bool {
        func w(_ s: String, _ f: NSFont) -> CGFloat { ceil((s as NSString).size(withAttributes: [.font: f]).width) }
        var used = w(c.name, name)
        if let r = c.rank { used += w("\(r)", rank) + 3 }
        if ball { used += 9 + 3 }
        if followed.contains(c.id ?? "") { used += 8 + 3 }
        return used <= width
    }
}

/// Which crests carry a link to the tier's collapsed preview.
struct FaceOffCrests {
    var matches: Set<String> = []
    /// Expanding: crests grow from the preview's 14pt as they travel.
    var settling = false

    func matchID(_ c: Competitor) -> String? { matches.first { $0.hasSuffix("|\(c.id ?? c.name)") } }
}

/// The preview's crests are 14pt; a tile's are 28 or 34. Arriving from the
/// preview, a crest starts at the preview's size and settles to its own on
/// the travel spring (the link itself moves position only).
private struct CrestSettle: ViewModifier {
    let from: CGFloat
    let active: Bool
    @State private var settled = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(active && !settled ? from : 1)
            .onAppear {
                guard active, !settled else { return }
                withAnimation(Motion.travel.delay(0.04)) { settled = true }
            }
    }
}

// MARK: - Centers

/// The score between the crests. Digits roll; a scorer's number flashes.
struct TileScore: View {
    enum Style {
        case large, small
        /// Three-digit scores in a large tile ("148–150"): a size down and
        /// closer, so the names beside them keep their room.
        case largeTight
        /// Three-digit scores in a small tile: smaller, unspaced ("112–108"
        /// is 68pt, so it fits the narrowest small tile).
        case smallTight

        var size: CGFloat {
            switch self {
            case .large: 28
            case .largeTight: 24
            case .small: 20
            case .smallTight: 15
            }
        }

        var spacing: CGFloat {
            switch self {
            case .large: 6
            case .largeTight: 3
            case .small: 2
            case .smallTight: 0
            }
        }

        /// By digit count, whatever the sport.
        static func forLarge(_ top: String?, _ bottom: String?) -> Style { digits(top, bottom) >= 3 ? .largeTight : .large }
        static func forSmall(_ top: String?, _ bottom: String?) -> Style { digits(top, bottom) >= 3 ? .smallTight : .small }

        private static func digits(_ top: String?, _ bottom: String?) -> Int { max(top?.count ?? 0, bottom?.count ?? 0) }
    }

    let top: String?
    let bottom: String?
    let style: Style
    var dimTop = false
    var dimBottom = false
    var live = false
    /// The scorer's number pops (celebrations §2.9, Full only) as well as
    /// flashing. Every score in these sports is a score-tier moment; a
    /// basketball basket is routine, so it only flashes.
    var pops = false

    /// Sports whose every score is a score-tier moment (a touchdown or field
    /// goal, a goal, a run, a CS2 map). Not basketball: 13 NBA tiles popping
    /// every 20 seconds would be the opposite of a calm board.
    static func pops(_ sport: Sport?) -> Bool { sport != nil && sport != .basketball }

    var body: some View {
        HStack(spacing: style.spacing) {
            ScoreDigits(value: top, dimmed: dimTop, live: live, pops: pops)
            Text("–").foregroundStyle(.tertiary)
            ScoreDigits(value: bottom, dimmed: dimBottom, live: live, pops: pops)
        }
        .font(.system(size: style.size, weight: .semibold, design: .rounded).monospacedDigit())
        .fixedSize()
    }
}

/// The tiles' "this just changed" highlight, timed like the list row's flash
/// (`EventRow.flash`): in with `Motion.fade`, hold, then a slow decay. The
/// digit flash and the touchdown end zone share it.
enum TileFlash {
    static let hold: Duration = .seconds(1.6)
    /// Deliberately slow (`Motion.decay`): ambient, decaying on its own, not a
    /// response to the user. A plain `Motion.fade` with Reduce Motion.
    static func decay(reduceMotion: Bool = false) -> Animation { reduceMotion ? Motion.fade : Motion.decay }

    /// The flash's level `t` seconds after it starts, for the harness's frozen clock.
    static func level(at t: Double, reduceMotion: Bool = false) -> Double {
        KeyframeTimeline(initialValue: 0.0) { Celebrate.pill(peak: 1, fadeOut: reduceMotion ? 0.15 : 1.2) }.value(time: t)
    }
}

/// One side's number. When it changes while live, a soft red pill behind it
/// fades in, holds, and decays on its own (the row flash's timings).
struct DigitFlash: ViewModifier {
    let value: String?
    let live: Bool
    @State private var flashing = false
    @State private var token = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationClock) private var clock
    /// Flashes only on screen: under another page, or with the panel closed, the number just changes.
    @Environment(\.pageLive) private var pageLive

    /// The pill's opacity: the live state, or under the harness's frozen
    /// clock the flash `t` seconds in (once a change has happened).
    private var level: Double {
        if case let .frozen(t) = clock { return token > 0 ? TileFlash.level(at: t, reduceMotion: reduceMotion) : 0 }
        return flashing ? 1 : 0
    }

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.red.opacity(0.14 * level))
                    .padding(.horizontal, -6)
                    .padding(.vertical, -2)
            }
            .onChange(of: value) { old, new in
                guard live, pageLive, old != nil, new != old else { return }
                token += 1
                let mine = token
                withAnimation(Motion.fade) { flashing = true }
                Task {
                    try? await Task.sleep(for: TileFlash.hold)
                    guard mine == token else { return }
                    withAnimation(TileFlash.decay(reduceMotion: reduceMotion)) { flashing = false }
                }
            }
    }
}

/// One side's number. A final never changes, so it's plain text: the roll,
/// flash and pop machinery is built only for live scores.
private struct ScoreDigits: View {
    let value: String?
    let dimmed: Bool
    let live: Bool
    var pops = false

    var body: some View {
        if live {
            LiveDigits(value: value, dimmed: dimmed, pops: pops)
        } else {
            Text(value ?? "–").foregroundStyle(dimmed ? .secondary : .primary)
        }
    }
}

/// A live number: digits roll; a change flashes; a rise pops (where scores
/// are score-tier moments).
private struct LiveDigits: View {
    let value: String?
    let dimmed: Bool
    let pops: Bool
    /// Counts the scorer's rises: each one pops the number once.
    @State private var pop = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let digits = Text(value ?? "–")
            .foregroundStyle(dimmed ? .secondary : .primary)
            .contentTransition(.numericText(value: Double(value ?? "") ?? 0))
            .animation(reduceMotion ? nil : Motion.quick, value: value)
        Group {
            // The number pops inside its flash; the pill stays put (the hero's
            // order). `scorePop` is Full only and still with Reduce Motion,
            // where the flash's fade carries the moment.
            if pops { digits.scorePop(pop) } else { digits }
        }
        .modifier(DigitFlash(value: value, live: true))
        .onChange(of: value) { old, new in
            // Only a rise is a score: a correction downward just rolls back.
            guard pops, let was = old.flatMap(Double.init), let now = new.flatMap(Double.init), now > was else { return }
            pop += 1
        }
    }
}

/// A small tile's center, by state (the list's status rules).
private struct SmallCenter: View {
    let event: Event
    let top: Competitor
    let bottom: Competitor
    /// Every score is a score-tier moment here (not basketball's).
    let pops: Bool
    var dimTop = false
    var dimBottom = false

    var body: some View {
        switch event.state {
        case .live, .final:
            if top.score == nil && bottom.score == nil && RowText.unplayed(event) {
                // Postponed or cancelled: the detail says which.
                Text(event.detail ?? "Postponed")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            } else {
                // A played final the source sent without numbers shows "–", never a bare status.
                TileScore(top: top.score, bottom: bottom.score, style: .forSmall(top.score, bottom.score),
                          dimTop: dimTop, dimBottom: dimBottom, live: event.state == .live, pops: pops)
            }
        case .scheduled:
            TimelineView(.periodic(from: Date(timeIntervalSinceReferenceDate: 0), by: 30)) { context in
                let now = context.date
                if RowStatus.delayed(event, now: now) {
                    Text("Delayed")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.orange)
                } else if event.start < now {
                    // Two short lines, so it fits between two crests in the narrowest tile.
                    Text(event.competitors.isEmpty ? "Time TBA" : "Starting soon")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .frame(maxWidth: 60)
                } else if event.start.timeIntervalSince(now) < 3 * 3600, let countdown = Countdown.text(to: event.start, from: now) {
                    Text(countdown)
                        .font(.system(size: 12, weight: .semibold).monospacedDigit())
                        .foregroundStyle(Color.accentColor)
                } else {
                    Text(event.start.formatted(date: .omitted, time: .shortened))
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                }
            }
        }
    }
}

/// Next up: "in 2h 26m" refreshed every 30s; inside the last hour, the
/// detail hero's ticking "Starts in 14:33" (the only tile that ticks seconds).
struct NextUpCountdown: View {
    let start: Date
    let field: Bool
    /// The source says the start is delayed: past it, "Delayed" in orange.
    var delayed = false

    var body: some View {
        TimelineView(CountdownSchedule(start: start)) { context in
            Text(text(now: context.date))
                .font(.system(size: 15, weight: .semibold).monospacedDigit())
                .foregroundStyle(delayed && start <= context.date ? Color.orange : Color.accentColor)
        }
    }

    private func text(now: Date) -> String {
        let seconds = start.timeIntervalSince(now)
        if delayed && seconds <= 0 { return "Delayed" }
        if seconds <= 0 { return field ? "Up next" : "Starting soon" }
        if seconds < 3600, let clock = Countdown.clock(to: start, from: now) { return "Starts in \(clock)" }
        return Countdown.text(to: start, from: now) ?? When.dayAndTime(start, now: now)
    }
}

/// Every 30 seconds until the last hour, then every second until the start.
/// Steps land on whole 30s and whole seconds, so every clock on the page
/// ticks in the same frame (one commit, not one per clock).
struct CountdownSchedule: TimelineSchedule {
    let start: Date

    func entries(from startDate: Date, mode: TimelineScheduleMode) -> AnyIterator<Date> {
        var next = startDate
        return AnyIterator {
            let current = next
            let remaining = start.timeIntervalSince(current)
            // Past the start: one entry a minute is plenty ("Starting soon").
            let step: Double = remaining <= 0 ? 60 : remaining < 3600 ? 1 : 30
            let t = current.timeIntervalSinceReferenceDate
            var following = (t / step).rounded(.down) * step + step
            // Switch to seconds right at the last hour.
            if remaining >= 3600 { following = min(following, start.timeIntervalSinceReferenceDate - 3600 + 0.01) }
            next = Date(timeIntervalSinceReferenceDate: following)
            return current
        }
    }
}

/// One line under a large tile: the situation, last goal, last play.
struct DetailLine: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(text)
            .font(.system(size: 10.5).monospacedDigit())
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentTransition(.opacity)
            .animation(reduceMotion ? nil : Motion.fade, value: text)
    }
}

// MARK: - Field events (climbing)

private struct FieldTileContent: View {
    let event: Event
    let title: String
    let summary: String
    let presentation: EventTile.Presentation
    let header: TileHeader
    let countries: [String]

    private var wall: WallState? {
        if case let .climbing(wall)? = event.snapshot { return wall }
        return nil
    }

    /// "Semi-final · Keqiao 2026".
    private var subtitle: String {
        if case let .climbing(_, _, _, round, eventName, _)? = event.ref {
            return [round, eventName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        }
        return summary
    }

    var body: some View {
        switch presentation {
        case .live, .nextUp:
            VStack(alignment: .leading, spacing: 0) {
                header
                Spacer(minLength: 4)
                HStack(spacing: 10) {
                    Image(systemName: Sport.climbing.symbol)
                        .font(.system(size: 22, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: TileMetrics.crestLarge, height: TileMetrics.crestLarge)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                        Text(subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    if presentation == .nextUp { NextUpCountdown(start: event.start, field: true) }
                }
                Spacer(minLength: 4)
                if presentation == .live, let wall {
                    WallStrip(state: wall, countries: countries)
                        .frame(height: TileMetrics.stripHeight)
                }
                if let line = detail { DetailLine(text: line).padding(.top, wall == nil ? 0 : 3) }
            }
        case .small, .liveSmall:
            VStack(alignment: .leading, spacing: 0) {
                header
                Spacer(minLength: 2)
                Text(title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                Text(smallLine)
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Lead: who leads the route. Otherwise the summary and caption, less
    /// what the subtitle already says (the round, the event).
    private var detail: String? {
        if presentation == .live, case let .lead(_, leader?, _)? = wall?.phase {
            return "Leader " + [leader.athlete.flag, leader.athlete.name, leader.label].compactMap { $0 }.joined(separator: " ")
        }
        guard case let .climbing(_, _, _, round, eventName, _)? = event.ref else { return summary.isEmpty ? event.caption : summary }
        func trimmed(_ text: String?, dropping prefix: String?) -> String? {
            guard var text, !text.isEmpty else { return nil }
            if let prefix, !prefix.isEmpty, text.hasPrefix(prefix) {
                text = String(text.dropFirst(prefix.count)).trimmingCharacters(in: CharacterSet(charactersIn: " ·"))
            }
            return text.isEmpty ? nil : text
        }
        return trimmed(summary, dropping: round) ?? trimmed(event.caption, dropping: eventName)
    }

    /// Live and small: who's climbing, when known; else the summary.
    private var smallLine: String {
        if presentation == .liveSmall, let wall {
            switch wall.phase {
            case let .lead(climber, _, _):
                return [climber.athlete.flag, climber.athlete.name, climber.label].compactMap { $0 }.joined(separator: " ")
            case let .boulder(athlete, _, active):
                return [athlete.flag, athlete.name].compactMap { $0 }.joined(separator: " ") + (active.map { " · B\($0 + 1)" } ?? "")
            case let .upNext(athlete):
                return "Up next " + [athlete.flag, athlete.name].compactMap { $0 }.joined(separator: " ")
            }
        }
        return summary.isEmpty ? (event.caption ?? "") : summary
    }
}

// MARK: - Surface

/// Team colors meeting in the middle, fading downward so the strip stays
/// calm. A gradient only: no base layer, no blur, no glow.
struct TileWash: View {
    let left: Color
    let right: Color
    var intensity: Double = 1

    /// 30% of the hero wash (0.18, 0.12 for pale colors): a tile is small and there are many of them.
    private func strength(_ color: Color) -> Double { Viz.washStrength(color, intensity: intensity) * 0.3 }

    var body: some View {
        LinearGradient(colors: [left.opacity(strength(left)), left.opacity(0.04 * intensity),
                                right.opacity(0.04 * intensity), right.opacity(strength(right))],
                       startPoint: .leading, endPoint: .trailing)
            .mask(LinearGradient(colors: [.black, .black.opacity(0.4)], startPoint: .top, endPoint: .bottom))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// A tile is pressed and clicked like a button: the surface darkens and
/// shrinks a notch while pressed, and a release that hasn't wandered opens
/// the game (a press that drifts off isn't a click, as a button cancels when
/// the pointer leaves). It isn't a `Button`: tiles never take keyboard focus
/// (the board handles the keys), and a Button's focus, shortcut and style
/// machinery was the largest single part of building a tile (8.6% of the
/// board, measured). VoiceOver's press is the tile's default action.
private struct TilePress: ViewModifier {
    let highlighted: Bool
    let keyboard: Bool
    /// False while the tier expands: the surface fades in with the text.
    let shown: Bool
    let action: () -> Void
    @GestureState private var pressed = false

    func body(content: Content) -> some View {
        TileSurface(pressed: pressed, highlighted: highlighted, keyboard: keyboard, shown: shown) { content }
            .gesture(DragGesture(minimumDistance: 0)
                .updating($pressed) { value, state, _ in state = Self.isClick(value.translation) }
                .onEnded { value in if Self.isClick(value.translation) { action() } })
            // As a button does: the first click on an inactive panel still opens the game.
            .allowsWindowActivationEvents()
    }

    static func isClick(_ travel: CGSize) -> Bool { abs(travel.width) < 6 && abs(travel.height) < 6 }
}

/// Plain content surface (not glass: glass never stacks on glass). Hover and
/// keyboard highlight are instant; the press eases in and out. The arrow
/// keys' highlight wears the accent (the list rows' rule), strong enough to
/// follow; the pointer's stays a quiet gray.
private struct TileSurface<Label: View>: View {
    let pressed: Bool
    let highlighted: Bool
    let keyboard: Bool
    let shown: Bool
    @ViewBuilder let label: Label
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: TileMetrics.radius, style: .continuous)
        let strong = contrast == .increased
        let accent = highlighted && keyboard && !pressed
        label
            .background(shape.fill(accent ? Color.accentColor.opacity(strong ? 0.22 : 0.14)
                                   : Color.primary.opacity(pressed ? 0.11 : highlighted ? (strong ? 0.12 : 0.075) : 0.045))
                .opacity(shown ? 1 : 0))
            .clipShape(shape)
            .overlay(shape.strokeBorder(accent ? Color.accentColor.opacity(strong ? 0.8 : 0.5)
                                        : Color.primary.opacity(strong ? 0.20 : 0.08), lineWidth: accent ? 1 : 0.5)
                .opacity(shown ? 1 : 0))
            .contentShape(shape)
            // One notch gentler than the list's 0.97: tiles are bigger.
            .scaleEffect(pressed ? 0.98 : 1)
            .animation(Motion.press, value: pressed)
    }
}

// MARK: - Shared with rows

/// The game's context menu, the same for rows and tiles.
struct EventContextMenu: View {
    @Environment(ScoreStore.self) private var store
    let event: Event

    var body: some View {
        let pinned = store.pinnedID == event.id
        if let link = event.link {
            Button("Open in Browser", systemImage: "safari") { NSWorkspace.shared.open(link) }
            Divider()
        }
        if let broadcast = store.broadcast(for: event) {
            Button(broadcast.isLive ? "Watch Live on YouTube" : "Open Stream on YouTube", systemImage: "play.rectangle") {
                NSWorkspace.shared.open(broadcast.url)
            }
            Divider()
        }
        Button(pinned ? "Remove from Menu Bar" : "Show in Menu Bar",
               systemImage: pinned ? "pin.slash" : "pin") { store.togglePin(event) }
        let followable = event.competitors.filter { $0.id != nil }
        if !followable.isEmpty {
            Divider()
            ForEach(followable, id: \.self) { team in
                let following = store.isFollowing(team)
                Button(following ? "Unfollow \(team.name)" : "Follow \(team.name)",
                       systemImage: following ? "star.slash" : "star") { store.toggleFollow(team) }
            }
            Divider()
            // "Go to Arsenal": the team's page, for the sports that have them (Music's wording).
            ForEach(followable, id: \.self) { team in
                GoToTeamItem(team: Profile.TeamRef(team, league: league))
            }
            // The panel's root opens it (rows and tiles have no navigation of their own).
            ForEach(followable, id: \.self) { team in
                Button("\(team.name) Schedule", systemImage: "calendar") {
                    if let id = team.id { ScheduleStore.shared.openRequest = .team(ScheduleTeamRef(id: id, name: team.name, logo: team.logo)) }
                }
            }
        }
        Divider()
        Button("Copy Score", systemImage: "doc.on.doc") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(event.statusLine, forType: .string)
        }
    }

    /// The game's league ("eng.1"): a soccer team's page needs its domestic league.
    private var league: String? {
        if let id = store.leagueByEvent[event.id] { return id }
        if case let .espn(path, _, _)? = event.ref { return Profile.TeamRef.league(forPath: path) }
        return nil
    }
}

extension Event {
    /// "Arsenal 2–1 Chelsea (67')", for Copy Score.
    var statusLine: String {
        let line = scoreLine(abbreviated: false)
        switch state {
        case .live: return "\(line) (\(detail ?? "Live"))"
        case .final: return "\(line) (\(detail ?? "Final"))"
        case .scheduled: return "\(line), \(When.dayAndTime(start))"
        }
    }
}
