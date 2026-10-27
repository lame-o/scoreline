import SwiftUI

// The docked scorebar: as a match page scrolls, the hero card tucks under the
// header and, at the same scroll offsets, a compact live scoreboard settles in
// just below it, the way a large title becomes the inline title. Everything is
// driven by the page's quantized dock progress (never by timers), so it's
// continuous, reversible and can't fall out of sync with the scroll.
//
// The bar is an overlay on the page's scroll view: it never changes the page's
// measured height, so the panel's auto-height never sees it. It shows the
// score, the clock and one per-sport live detail (possession, bases and outs,
// the CS2 round, the climber on the wall). The scoreboard's beats play on
// whichever surface is visible (hero or bar), never both; the possession toss
// and the news line play only when the chart that owns the moment can't be
// seen, so one moment is celebrated in one place.

// MARK: - Rules (pure, tested)

enum DockRules {
    /// Which scoreboard owns the beats (digit pop, pill, glint).
    enum Surface: Equatable, Sendable { case hero, bar }

    /// The bar's dock progress for a scroll offset: 0 until a quarter of the
    /// hero has slid under the header, 1 three quarters of its height later,
    /// in steps of 1/64 (`PageGeometry.dockStep`).
    static func progress(offset: CGFloat, heroMinY: CGFloat, heroHeight: CGFloat) -> Double {
        Double(PageGeometry.dockStep(hero: CGRect(x: 0, y: heroMinY, width: 1, height: heroHeight), offset: offset)) / 64
    }

    static func surface(p: Double) -> Surface { p >= 0.5 ? .bar : .hero }

    static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let t = min(max((x - a) / (b - a), 0), 1)
        return t * t * (3 - 2 * t)
    }

    // The bar, from p (spec §2.4). Opacity ramps over 0.35…0.9 rather than
    // the spec's 0.45…1: the hero has faded out by p ≈ 0.45, and the spec's
    // ramp left a stretch (p 0.39…0.56) where neither scoreboard showed, with
    // the bar taking over the beats at 0.5 while all but invisible.
    static func barOpacity(_ p: Double) -> Double { p <= 0 ? 0 : smoothstep(0.35, 0.9, p) }
    static func barScale(_ p: Double) -> CGFloat { 0.96 + 0.04 * CGFloat(min(max(p, 0), 1)) }
    static func barOffset(_ p: Double) -> CGFloat { -6 * (1 - CGFloat(min(max(p, 0), 1))) }

    /// The hero tucking under the header (spec §2.3), from its frame in the
    /// scroll view: shrinks 6% toward its top edge and fades.
    static func heroTuck(minY: CGFloat, height: CGFloat) -> (scale: CGFloat, opacity: Double) {
        guard height > 0 else { return (1, 1) }
        let t = min(max(-minY / (0.75 * height), 0), 1)
        let s = min(max((Double(t) - 0.35) / 0.45, 0), 1)
        return (1 - 0.06 * t, 1 - s * s * (3 - 2 * s))
    }

    // MARK: Possession

    /// How the bar's possession glyph moves when the ball changes hands.
    enum PossessionMotion: Equatable, Sendable {
        /// An instant swap (first data, a non-live game, a catch-up, a live resize).
        case none
        /// Reduce Motion: the old glyph fades out, the new one fades in.
        case fade
        /// Glides across (spring 0.4, no bounce).
        case glide
        /// Tossed across on an arc `rise` points high, spinning a turn and a
        /// quarter and landing with a small knock (each optional by level).
        case toss(rise: CGFloat, spins: Bool, knocks: Bool)
    }

    /// The football is tossed only for a turnover whose field can't be seen
    /// (the field plays its own turnover beat when it can); any other change of
    /// possession glides.
    static func shouldToss(change: (from: GameDetail.Side?, to: GameDetail.Side?),
                           moment: (kind: LiveMoment.Kind, age: TimeInterval)?,
                           fieldVisibility: PageGeometry.Visibility?,
                           level: CelebrationLevel, reduceMotion: Bool,
                           live: Bool = true, catchUp: Bool = false, resizing: Bool = false) -> PossessionMotion {
        guard let from = change.from, let to = change.to, from != to else { return .none }
        guard live, !catchUp, !resizing else { return .none }
        if reduceMotion { return .fade }
        let turnover = moment.map { $0.kind == .turnover && $0.age <= 2 } ?? false
        guard turnover, fieldVisibility != .visible else { return .glide }
        switch level {
        case .full: return .toss(rise: 12, spins: true, knocks: true)
        case .subtle: return .toss(rise: 6, spins: false, knocks: false)
        case .off: return .glide
        }
    }

    // MARK: News line

    /// The section that shows (and captions) a chart's moments.
    static func section(for chart: LiveMoment.Chart) -> DetailView.Section {
        switch chart {
        case .field: .field
        case .pitch: .pitch
        case .plate: .atPlate
        case .spray: .battedBalls
        case .rounds: .rounds
        case .wall: .wall
        case .ascent: .ascent
        case .boulder: .scorecard
        case .court: .court
        }
    }

    /// The moment the bar's status slot shows instead of the clock: a captioned
    /// moment whose caption can't be seen. A chart in view (or with its lower
    /// part, where the caption sits, in view) keeps its own caption.
    static func newsLine(moment: LiveMoment?, chartVisibility: PageGeometry.Visibility?) -> LiveMoment? {
        guard let moment, moment.captioned else { return nil }
        switch chartVisibility {
        case .visible?, .partial(.above)?: return nil
        default: return moment
        }
    }

    /// Climbing: a climber passed someone while the ascent is out of view: the
    /// bar's place pill pops and shows the places gained.
    static func passBeat(moment: LiveMoment?, ascentVisibility: PageGeometry.Visibility?) -> Int? {
        guard let moment, moment.kind == .passed, ascentVisibility != .visible else { return nil }
        return max(moment.targets.count, 1)
    }

    // MARK: Width tiers

    /// How much per-sport detail fits beside the score.
    enum AccessoryTier: Int, Comparable, Sendable {
        /// Nothing beyond the common row.
        case none
        /// One glyph: possession, mini bases, a red card.
        case glyph
        /// A short text: "3rd & 7", the count, "R17", CLUTCH.
        case text
        /// Fuller text: "3rd & 7 at SF 25", red-card counts, the place pill.
        case full
        static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }
    }

    /// At 340 a three-digit score on both sides leaves no room for the
    /// accessory: it drops before anything truncates.
    static func accessoryTier(widthClass: WidthClass, topDigits: Int, bottomDigits: Int) -> AccessoryTier {
        switch widthClass {
        case .compact: topDigits >= 3 && bottomDigits >= 3 ? .none : .glyph
        case .medium: .text
        case .large, .xlarge: .full
        }
    }

    // MARK: Small formats

    /// ESPN's inning in two characters: "Top 7th" → "▲7", "Bot 7th" → "▼7",
    /// "Mid 7th" → "Mid 7", "End 7th" → "End 7".
    static func inning(_ text: String?) -> String? {
        guard let text else { return nil }
        let words = text.split(separator: " ")
        guard words.count >= 2, let n = Int(words[1].filter(\.isNumber)) else { return text }
        switch words[0].lowercased() {
        case "top": return "▲\(n)"
        case "bot", "bottom": return "▼\(n)"
        case "mid": return "Mid \(n)"
        case "end": return "End \(n)"
        default: return text
        }
    }

    /// "3rd & 7 at SF 25" → ("3rd & 7", "at SF 25").
    static func downAndSpot(_ text: String?) -> (down: String, spot: String?)? {
        guard let text, !text.isEmpty else { return nil }
        guard let range = text.range(of: " at ") else { return (text, nil) }
        return (String(text[..<range.lowerBound]), "at " + text[range.upperBound...])
    }

    /// One chip at a time, by priority: CLUTCH, 2-MIN DRILL, MAP POINT, then a run.
    static func chip(clutch: Bool, twoMinuteDrill: Bool, mapPoint: Bool, run: String?) -> DockBar.Chip? {
        if clutch { return .state("CLUTCH") }
        if twoMinuteDrill { return .state("2-MIN DRILL") }
        if mapPoint { return .state("MAP POINT") }
        return run.map(DockBar.Chip.run)
    }
}

// MARK: - What the bar shows

/// Everything the bar draws, as a value: built from the page's event, detail
/// and live lanes (`DockBar.make`), so the bar can be rendered and tested on
/// its own.
struct DockBar: Equatable {
    enum Phase: Equatable { case live, final, upcoming }

    struct Team: Equatable {
        let competitor: Competitor
        let score: String?
        /// A final's loser: secondary, as in the hero.
        let dimmed: Bool
        /// For the score pill.
        let color: Color
        /// Soccer red cards.
        var redCards = 0
    }

    enum Status: Equatable {
        /// The ticking clock (or the inning, the minute) in red.
        case live(clock: GameClock?, fallback: String)
        /// CS2: the map being played and its round score.
        case liveText(String)
        case final(String)
        case upcoming(start: Date, hasTeams: Bool)
        /// Postponed, cancelled, delayed: the source's words.
        case note(String)
    }

    /// The per-sport detail beside the score (live only).
    enum Detail: Equatable {
        case none
        case football(down: String?, spot: String?, redZone: Bool)
        case baseball(BaseState)
        case cs(round: Int?)
    }

    /// Climbing: who's on the wall (or up next, or the winner).
    struct Climber: Equatable {
        /// "Up next", "Winner"; nil while someone climbs.
        var prefix: String?
        let flag: String?
        let name: String
        /// Lead: the high point ("28+", "Top").
        var height: String?
        /// Lead: where that puts them now.
        var place: Int?
        /// Boulder: the problem they're on ("B3") and their tally ("2T 3Z").
        var boulder: String?
        var tally: String?
    }

    enum Chip: Equatable {
        case state(String)
        case run(String)
    }

    var phase: Phase
    var top: Team?
    var bottom: Team?
    /// Climbing pages (no teams): the round's title, and the climber line.
    var title: String = ""
    var climber: Climber?
    var status: Status
    var detail: Detail = .none
    /// The sport has possession (football, NBA): the glyph's symbol.
    var possessionSymbol: String?
    var possession: GameDetail.Side?
    /// NBA: a shot in the air (the glyph dims, still the shooting team's ball).
    var possessionInAir = false
    var chip: Chip?
    var coStream = false
    /// Live, but refreshes are failing: the dot holds still, as the hero's does.
    var stale = false

    var digits: (top: Int, bottom: Int) {
        (top?.score?.filter(\.isNumber).count ?? 0, bottom?.score?.filter(\.isNumber).count ?? 0)
    }
}

/// What the page knows, for `DockBar.make`.
struct DockInputs {
    var event: Event
    var detail: GameDetail?
    var colors: (top: Color, bottom: Color)
    /// The hero's numbers (the lane's, while it's ahead).
    var scores: (top: String?, bottom: String?)
    var football: GameDetail.Football?
    /// Football or NBA, live: the team with the ball.
    var possession: GameDetail.Side?
    var possessionInAir = false
    var clock: GameClock?
    var clockFallback: String = "Live"
    var baseball: GameDetail.Baseball?
    var clutch = false
    var twoMinuteDrill = false
    /// NBA: ESPN's scoring run while one is on ("10–2 run", `BasketballFeed.runs`).
    var run: String?
    var coStreaming = false
    /// Refreshes failing on a live game (the hero says "Can't connect").
    var stale = false
}

@MainActor
extension DockBar {
    static func make(_ i: DockInputs) -> DockBar {
        let e = i.event
        let live = e.state == .live
        let phase: Phase = e.state == .live ? .live : e.state == .final ? .final : .upcoming
        var bar = DockBar(phase: phase, status: status(i))
        switch e.content {
        case let .match(top, bottom):
            let reds = live ? redCards(i.detail) : (0, 0)
            bar.top = Team(competitor: top, score: i.scores.top ?? top.score, dimmed: e.stepsBack(top),
                           color: i.colors.top, redCards: reds.0)
            bar.bottom = Team(competitor: bottom, score: i.scores.bottom ?? bottom.score,
                              dimmed: e.stepsBack(bottom), color: i.colors.bottom, redCards: reds.1)
        case let .field(title, _):
            bar.title = title
            bar.climber = climber(i.detail, state: e.state)
        }
        guard live else { return bar }
        bar.stale = i.stale
        switch e.ref {
        case .espn(_, _, .football)?:
            bar.possessionSymbol = "football.fill"
            bar.possession = i.possession
            let split = DockRules.downAndSpot(i.football?.downDistance)
            bar.detail = .football(down: split?.down, spot: split?.spot, redZone: i.football?.redZone ?? false)
        case let .espn(path, _, .basketball)? where path == NBADetail.path:
            bar.possessionSymbol = "basketball.fill"
            bar.possession = i.possession
            bar.possessionInAir = i.possessionInAir
        case .espn(_, _, .baseball)?:
            if let b = i.baseball {
                bar.detail = .baseball(BaseState(onFirst: b.onFirst, onSecond: b.onSecond, onThird: b.onThird, balls: b.balls,
                                                 strikes: b.strikes, outs: b.outs, batter: b.batter, pitcher: b.pitcher))
            }
        case .counterStrike?:
            if let cs = i.detail?.csLive, !cs.mapEnded { bar.detail = .cs(round: cs.round) }
        default:
            break
        }
        let mapPoint: Bool = {
            guard case .counterStrike? = e.ref, let cs = i.detail?.csLive, !cs.mapEnded else { return false }
            return MatchRules.mapPoint(top: cs.topScore, bottom: cs.bottomScore) != nil
        }()
        bar.chip = DockRules.chip(clutch: i.clutch, twoMinuteDrill: i.twoMinuteDrill, mapPoint: mapPoint, run: i.run)
        bar.coStream = i.coStreaming
        return bar
    }

    private static func status(_ i: DockInputs) -> Status {
        let e = i.event
        switch e.state {
        case .live:
            if case .counterStrike? = e.ref, let cs = i.detail?.csLive, !cs.mapEnded {
                return .liveText([cs.mapName, "\(cs.topScore)–\(cs.bottomScore)"].compactMap { $0 }.joined(separator: " "))
            }
            if case .espn(_, _, .baseball)? = e.ref { return .live(clock: nil, fallback: DockRules.inning(i.clockFallback) ?? i.clockFallback) }
            return .live(clock: i.clock, fallback: i.clockFallback)
        case .final:
            return .final(finalText(e.detail))
        case .scheduled:
            if let detail = e.detail, ["postpon", "cancel", "suspend", "delay"].contains(where: detail.lowercased().contains) {
                return .note(detail)
            }
            return .upcoming(start: e.start, hasTeams: !e.competitors.isEmpty)
        }
    }

    /// A final's status in words while they're short ("Full time", "Final,
    /// overtime"), else the source's compact form ("AET", "Final/2OT"): the
    /// bar has a third of the hero's room. (pure; tested)
    static func finalText(_ detail: String?) -> String {
        let raw = detail ?? "Final"
        let words = Spoken.status(raw)
        return words.count <= 15 ? words : raw
    }

    private static func redCards(_ d: GameDetail?) -> (Int, Int) {
        let reds = d?.moments.filter { $0.kind == .red } ?? []
        return (reds.filter { $0.side == .top }.count, reds.filter { $0.side == .bottom }.count)
    }

    /// The climber line: on the wall now, else up next, else the round's winner.
    static func climber(_ d: GameDetail?, state: EventState) -> Climber? {
        guard let d else { return nil }
        if state == .live {
            for route in d.wall {
                guard let c = route.climbers.first(where: \.onWall) else { continue }
                let done = route.climbers.filter { !$0.onWall && $0.id != c.id }
                return Climber(flag: c.flag ?? Flag.emoji(ioc: c.country), name: MatchMark.surname(c.name), height: c.label,
                               place: LeadAscentView.place(of: c.height, top: c.top, among: done))
            }
            if let card = d.boulders.first(where: \.onWall) {
                let on = card.problems.firstIndex(where: \.active)
                let name = on.map { d.boulderProblems.indices.contains($0) ? d.boulderProblems[$0] : "\($0 + 1)" }
                let tops = card.problems.filter { $0.reach == .top }.count
                let zones = card.problems.filter { $0.reach == .top || $0.reach == .zone }.count
                return Climber(flag: card.flag ?? Flag.emoji(ioc: card.country), name: MatchMark.surname(card.name),
                               boulder: name.map { "B\($0)" }, tally: "\(tops)T \(zones)Z")
            }
            if let next = d.upNext {
                return Climber(prefix: "Up next", flag: next.flag, name: MatchMark.surname(next.name))
            }
        }
        if state == .final || MatchRules.decided(d.wall), let winner = d.ranking.first(where: { $0.rank == 1 }) {
            return Climber(prefix: "Winner", flag: Flag.emoji(ioc: winner.country), name: MatchMark.surname(winner.name))
        }
        return nil
    }
}

// MARK: - Harness hooks

#if DEBUG
private struct DockProgressOverrideKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

extension EnvironmentValues {
    /// Harness only: freezes the dock progress the bar and the scoreboard
    /// gates read, instead of the page's scroll. Compiled out of release, so
    /// the views that read it read a constant there.
    var dockProgressOverride: Double? {
        get { self[DockProgressOverrideKey.self] }
        set { self[DockProgressOverrideKey.self] = newValue }
    }
}
#endif

extension View {
    /// Liquid Glass for the page's floating surfaces (the bar, the peek, the
    /// hero card). In a DEBUG render harness Liquid Glass can't be captured
    /// offscreen, so `\.glassStandIn` swaps in a stand-in plate (window color
    /// for regular glass, a faint fill for clear) with a hairline.
    func floatingGlass(in shape: some Shape, clear: Bool = false, interactive: Bool = true) -> some View {
        modifier(FloatingGlass(shape: AnyShape(shape), clear: clear, interactive: interactive))
    }
}

private struct FloatingGlass: ViewModifier {
    let shape: AnyShape
    let clear: Bool
    let interactive: Bool
    #if DEBUG
    @Environment(\.glassStandIn) private var standIn
    #endif

    @ViewBuilder func body(content: Content) -> some View {
        #if DEBUG
        if standIn {
            content
                .background(shape.fill(clear ? Color.primary.opacity(0.05) : Color(nsColor: .windowBackgroundColor).opacity(0.8)))
                .overlay(shape.stroke(Color.primary.opacity(clear ? 0.10 : 0.14), lineWidth: 0.5))
        } else {
            content.glass(in: shape, interactive: interactive, clear: clear)
        }
        #else
        content.glass(in: shape, interactive: interactive, clear: clear)
        #endif
    }
}

#if DEBUG
private struct GlassStandInKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Harness only: a stand-in plate where Liquid Glass would be.
    var glassStandIn: Bool {
        get { self[GlassStandInKey.self] }
        set { self[GlassStandInKey.self] = newValue }
    }
}

/// What a match page owns, handed to the render harness when it appears.
struct PageProbe {
    let geometry: PageGeometry
    let linked: LinkedFocus
    let peek: PeekController
    let stage: NBAStage
    let moments: MomentCenter
}

private struct PageProbeKey: EnvironmentKey {
    static let defaultValue: ((PageProbe) -> Void)? = nil
}

extension EnvironmentValues {
    var pageProbe: ((PageProbe) -> Void)? {
        get { self[PageProbeKey.self] }
        set { self[PageProbeKey.self] = newValue }
    }
}
#endif

// MARK: - Scoreboard gate

/// Which scoreboard is on screen, written by the bar's host only when it
/// flips (at half docked), so the hero's beats and clock read one coarse
/// value instead of every 1/64 dock step.
@MainActor
@Observable
final class ScoreboardSurface {
    var current: DockRules.Surface = .hero
}

private struct ScoreboardSurfaceKey: EnvironmentKey {
    static let defaultValue: ScoreboardSurface? = nil
}

extension EnvironmentValues {
    var scoreboardSurface: ScoreboardSurface? {
        get { self[ScoreboardSurfaceKey.self] }
        set { self[ScoreboardSurfaceKey.self] = newValue }
    }
}

/// Hands its content whether the hero is the scoreboard on screen, so the
/// hero's ticking clocks stop while it's tucked under the bar.
struct WhileHeroShows<Content: View>: View {
    @ViewBuilder let content: (Bool) -> Content
    @Environment(\.scoreboardSurface) private var surface
    #if DEBUG
    @Environment(\.dockProgressOverride) private var override
    #else
    private let override: Double? = nil
    #endif

    var body: some View {
        content((override.map(DockRules.surface(p:)) ?? surface?.current ?? .hero) == .hero)
    }
}

extension View {
    /// The scoreboard's beat on one surface: the digit pop and the scorer's
    /// pill play here only while this surface is the one on screen (the hero
    /// until the bar is half docked, then the bar). The other surface gets the
    /// same trigger and renders it as nothing, so a surface flipping never
    /// fires a spurious pop. Reads the dock progress itself, so the page
    /// around it never re-renders as it scrolls.
    func scoreboardBeat(_ trigger: Int, color: Color, on surface: DockRules.Surface) -> some View {
        modifier(ScoreboardBeat(trigger: trigger, color: color, surface: surface))
    }

    /// The decisive glint, on this surface only while it's the one on screen.
    func scoreboardGlint(_ trigger: Int, in shape: some Shape, on surface: DockRules.Surface) -> some View {
        modifier(ScoreboardGlint(trigger: trigger, shape: AnyShape(shape), surface: surface))
    }
}

extension View {
    /// The hero tucking under the header as the page scrolls (spec §2.3): it
    /// shrinks 6% toward its top edge and fades, as a transform of its own
    /// frame in the scroll view. No state and no body re-runs: SwiftUI applies
    /// it as the frame moves. Opacity only with Reduce Motion.
    func heroTuck() -> some View { modifier(HeroTuck()) }
}

private struct HeroTuck: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let reduceMotion = reduceMotion
        content.visualEffect { content, proxy in
            let frame = proxy.frame(in: .scrollView(axis: .vertical))
            let tuck = DockRules.heroTuck(minY: frame.minY, height: frame.height)
            return content
                .scaleEffect(reduceMotion ? 1 : tuck.scale, anchor: .top)
                .opacity(tuck.opacity)
        }
    }
}

private struct ScoreboardBeat: ViewModifier {
    let trigger: Int
    let color: Color
    let surface: DockRules.Surface
    @Environment(\.scoreboardSurface) private var current
    #if DEBUG
    @Environment(\.dockProgressOverride) private var override
    #else
    private let override: Double? = nil
    #endif

    func body(content: Content) -> some View {
        let on = (override.map(DockRules.surface(p:)) ?? current?.current ?? .hero) == surface
        content
            .scorePop(trigger, scale: on ? 1.12 : 1)
            .scorePill(trigger, color: on ? color : .clear)
    }
}

private struct ScoreboardGlint: ViewModifier {
    let trigger: Int
    let shape: AnyShape
    let surface: DockRules.Surface
    @Environment(\.scoreboardSurface) private var current
    #if DEBUG
    @Environment(\.dockProgressOverride) private var override
    #else
    private let override: Double? = nil
    #endif

    func body(content: Content) -> some View {
        let on = (override.map(DockRules.surface(p:)) ?? current?.current ?? .hero) == surface
        content.glint(trigger, in: shape, active: on)
    }
}

// MARK: - Host

/// The bar over the page's scroll view, driven by the page's dock progress.
/// It isn't in the hierarchy at all until the hero starts to tuck away (p > 0).
/// This view re-renders once per dock step (1/64) while the hero is tucking;
/// it only moves the bar (transforms and opacity), and the bar itself is
/// `Equatable`, so its body doesn't run again unless what it shows changes.
struct DockedScorebarHost: View {
    let bar: DockBar
    let beats: HeroBeats
    let moments: MomentCenter
    /// "Show in Menu Bar", as in the header.
    var pinEvent: Event? = nil
    var pinned = false
    @Environment(\.pageGeometry) private var geometry
    @Environment(\.scoreboardSurface) private var surfaceState
    #if DEBUG
    @Environment(\.dockProgressOverride) private var override
    #else
    private let override: Double? = nil
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.panelResizing) private var resizing
    @Environment(\.celebrationLevel) private var level
    @Environment(\.widthClass) private var widthClass
    /// The football in flight between the teams, if a toss or glide is playing.
    @State private var flight: PossessionToss.Flight?
    /// Bumped as a toss lands: the glyph's knock.
    @State private var landings = 0
    @State private var passPops = 0
    /// The moment on show and when it first arrived (a toss needs a turnover
    /// from the last two seconds).
    @State private var seen: (id: String, at: Date)?
    @State private var appeared = Date.distantPast

    var body: some View {
        let p = override ?? geometry?.dockProgress ?? 0
        let surface = DockRules.surface(p: p)
        ZStack(alignment: .top) {
            if p > 0 {
                DockedBarContent(bar: bar, beats: beats, moments: moments, surface: surface, flight: flight, landings: landings,
                                 passPops: passPops,
                                 tier: DockRules.accessoryTier(widthClass: widthClass, topDigits: bar.digits.top,
                                                               bottomDigits: bar.digits.bottom),
                                 pinEvent: pinEvent, pinned: pinned, ticking: DockRules.barOpacity(p) > 0, quiet: resizing)
                    .equatable()
                    // The motion is the scroll: transforms and opacity only,
                    // never interpolated on a timer. Opacity only with Reduce Motion.
                    .scaleEffect(reduceMotion ? 1 : DockRules.barScale(p), anchor: .top)
                    .offset(y: reduceMotion ? 0 : DockRules.barOffset(p))
                    .opacity(DockRules.barOpacity(p))
                    .allowsHitTesting(p >= 0.5)
                    .transaction(value: p) { $0.animation = nil }
            }
        }
        .padding(.top, 4)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, alignment: .top)
        .onAppear { appeared = .now }
        // The hero's beats and clock follow the surface: written only when it flips.
        .onChange(of: surface, initial: true) { _, now in
            if surfaceState?.current != now { surfaceState?.current = now }
        }
        .onChange(of: moments.current?.id) { _, _ in
            noteMoment()
            let pass = DockRules.passBeat(moment: moments.current, ascentVisibility: geometry?.visibility[sectionID(.ascent)])
            if let pass, pass > 0 { passPops += 1 }
        }
        .onChange(of: bar.possession) { old, new in possessionChanged(from: old, to: new, p: p) }
    }

    private func noteMoment() {
        guard let m = moments.current else { return }
        if seen?.id != m.id { seen = (m.id, .now) }
    }

    private func possessionChanged(from old: GameDetail.Side?, to new: GameDetail.Side?, p: Double) {
        noteMoment()
        guard p > 0, let old, let new else { return }
        let moment = moments.current.flatMap { m in seen.map { (kind: m.kind, age: Date.now.timeIntervalSince($0.at)) } }
        let motion = DockRules.shouldToss(change: (old, new), moment: moment,
                                          fieldVisibility: geometry?.visibility[sectionID(.field)],
                                          level: level, reduceMotion: reduceMotion, live: bar.phase == .live,
                                          catchUp: Date.now.timeIntervalSince(appeared) < 1.5, resizing: resizing)
        switch motion {
        case .glide, .toss:
            let next = PossessionToss.Flight(id: (flight?.id ?? 0) + 1, from: old, to: new, motion: motion, start: .now)
            flight = next
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(PossessionToss.duration(motion)))
                guard flight?.id == next.id else { return }
                flight = nil
                if case .toss(_, _, true) = motion { landings += 1 }
            }
        case .fade, .none:
            flight = nil
        }
    }
}

/// A page section's ID in `PageGeometry` ("court", "box", …).
func sectionID(_ section: DetailView.Section) -> String { String(describing: section) }

/// The bar's inputs that come from the moment on show and whether its chart
/// is in view (the news line, the climbing pass beat). Its own view, so only
/// it re-renders when a section crosses a visibility threshold.
private struct DockedBarContent: View {
    let bar: DockBar
    let beats: HeroBeats
    let moments: MomentCenter
    let surface: DockRules.Surface
    let flight: PossessionToss.Flight?
    let landings: Int
    let passPops: Int
    let tier: DockRules.AccessoryTier
    let pinEvent: Event?
    let pinned: Bool
    let ticking: Bool
    /// Live resize: the news line yields.
    let quiet: Bool
    @Environment(\.pageGeometry) private var geometry

    var body: some View {
        let m = moments.current
        let news = quiet ? nil : m.flatMap { DockRules.newsLine(moment: $0, chartVisibility: geometry?.visibility[sectionID(DockRules.section(for: $0.chart))]) }
        let pass = DockRules.passBeat(moment: m, ascentVisibility: geometry?.visibility[sectionID(.ascent)])
        DockedScorebar(bar: bar, surface: surface, beats: beats, news: news, passDelta: pass, passPops: passPops,
                       flight: flight, landings: landings, tier: tier, pinEvent: pinEvent, pinned: pinned, ticking: ticking)
            .equatable()
    }
}

/// Isolated to the main actor, like the view (no `assumeIsolated` hop).
extension DockedBarContent: @MainActor Equatable {
    static func == (a: Self, b: Self) -> Bool {
        a.bar == b.bar && a.beats == b.beats && a.moments === b.moments && a.surface == b.surface && a.flight == b.flight
            && a.landings == b.landings && a.passPops == b.passPops && a.tier == b.tier && a.pinEvent?.id == b.pinEvent?.id
            && a.pinned == b.pinned && a.ticking == b.ticking && a.quiet == b.quiet
    }
}

// MARK: - The bar

struct DockedScorebar: View {
    let bar: DockBar
    var surface: DockRules.Surface = .bar
    var beats = HeroBeats()
    /// A captioned moment whose chart is out of view: shown instead of the clock.
    var news: LiveMoment? = nil
    /// Climbing: places gained by a pass whose chart is out of view.
    var passDelta: Int? = nil
    var passPops = 0
    var flight: PossessionToss.Flight? = nil
    var landings = 0
    var tier: DockRules.AccessoryTier = .glyph
    /// The page's event, for "Show in Menu Bar" in the bar's menu.
    var pinEvent: Event? = nil
    var pinned = false
    /// The bar can be seen: an upcoming game's countdown ticks only then.
    var ticking = true
    /// Harness only, on the frozen clock: the news line arriving or leaving.
    var newsPhase: NewsPhase? = nil

    enum NewsPhase: Equatable {
        case arriving(LiveMoment)
        case leaving(LiveMoment)
    }

    @Environment(ScoreStore.self) private var store: ScoreStore?
    @Environment(\.pageGeometry) private var geometry
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.celebrationClock) private var clock
    @Environment(\.panelResizing) private var resizing
    /// Each possession slot's center, in the bar's own coordinates.
    @State private var slots: [GameDetail.Side: CGPoint] = [:]

    static let height: CGFloat = 40
    /// Read in a geometry transform, which runs off the main actor.
    nonisolated private static let space = "DockedScorebar"
    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: 14, style: .continuous) }

    var body: some View {
        // Back to the top: the hero again (animated; instant with Reduce Motion).
        Button { geometry?.scroll(toY: 0, animated: !reduceMotion) } label: {
            HStack(spacing: 8) {
                lead.fixedSize().layoutPriority(2)
                accessories
                    .frame(maxWidth: .infinity, alignment: .trailing)
                statusSlot.layoutPriority(1)
            }
            .padding(.horizontal, 12)
            .frame(height: Self.height)
            // A wide panel keeps the bar's content one centered group, like the hero's.
            .frame(maxWidth: Metrics.readableWidth)
            .frame(maxWidth: .infinity)
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        // Regular glass: content scrolls under it, and clear glass would show text through.
        .floatingGlass(in: shape)
        .overlay {
            if contrast == .increased { shape.strokeBorder(Color.primary.opacity(0.25), lineWidth: 0.5) }
        }
        // The decisive glint, only while the bar owns the scoreboard.
        .glint(beats.glints, in: shape, active: surface == .bar)
        .overlay(alignment: .topLeading) { tossLayer }
        .coordinateSpace(name: Self.space)
        // Tier changes slide in from the edge being pulled; nothing animates mid-drag.
        .animation(resizing ? nil : (reduceMotion ? Motion.fade : Motion.standard), value: tier)
        .contextMenu { menu }
        .help("Back to top")
        // The hero stays the canonical element: no duplicate reading.
        .accessibilityHidden(true)
    }

    // MARK: Lead: teams and score, or the climber

    @ViewBuilder private var lead: some View {
        if let top = bar.top, let bottom = bar.bottom {
            HStack(spacing: 6) {
                team(top, side: .top)
                scores(top, bottom)
                team(bottom, side: .bottom)
            }
        } else if let c = bar.climber {
            climberLine(c)
        } else {
            Text(bar.title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
        }
    }

    private func team(_ t: DockBar.Team, side: GameDetail.Side) -> some View {
        HStack(spacing: 4) {
            if side == .bottom { slot(side, team: t) }
            if side == .top { LogoView(url: t.competitor.logo, darkURL: t.competitor.darkLogo, size: 18) }
            if let rank = t.competitor.rank {
                Text("\(rank)").font(.system(size: 9.5, weight: .semibold).monospacedDigit()).foregroundStyle(.secondary)
            }
            Text(t.competitor.abbreviation).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            if side == .bottom { LogoView(url: t.competitor.logo, darkURL: t.competitor.darkLogo, size: 18) }
            if side == .top { slot(side, team: t) }
        }
    }

    /// Where the team's possession glyph (or soccer red card) sits. The slot
    /// keeps its width whoever has the ball, so nothing moves when it changes hands.
    @ViewBuilder private func slot(_ side: GameDetail.Side, team: DockBar.Team) -> some View {
        if bar.possessionSymbol != nil, tier >= .glyph {
            // The new owner's glyph is mounted (hidden) while the ball is in
            // the air, so its landing knock plays as it appears.
            ZStack {
                if bar.possession == side {
                    possessionGlyph(side).opacity(inFlight ? 0 : (frozenFade(side) ?? 1))
                } else if let fading = frozenFade(side) {
                    possessionGlyph(side).opacity(fading)
                }
            }
                .frame(width: 10, height: 12)
                .onGeometryChange(for: CGPoint.self) { proxy in
                    let f = proxy.frame(in: .named(Self.space))
                    return CGPoint(x: f.midX, y: f.midY)
                } action: { slots[side] = $0 }
        } else if team.redCards > 0, tier >= .glyph {
            RedCardMark(count: tier >= .full ? team.redCards : (team.redCards > 1 ? team.redCards : 0))
                .transition(Motion.chip(reduceMotion: reduceMotion))
        }
    }

    /// The ball is between the teams (a toss or a glide): neither slot shows it.
    private var inFlight: Bool {
        guard let flight, PossessionToss.travels(flight.motion) else { return false }
        if case let .frozen(t) = clock { return t < PossessionToss.duration(flight.motion) }
        return true
    }

    /// Reduce Motion's crossfade (out with `Motion.exit`, in with `Motion.fade`)
    /// sampled on the harness's frozen clock; live, the glyph's transitions play it.
    private func frozenFade(_ side: GameDetail.Side) -> Double? {
        guard case let .frozen(t) = clock, let flight, flight.motion == .fade else { return nil }
        if side == flight.to { return Motion.curve.value(at: min(max(t / 0.15, 0), 1)) }
        if side == flight.from { return 1 - Motion.curve.value(at: min(max(t / 0.12, 0), 1)) }
        return nil
    }

    @ViewBuilder private func possessionGlyph(_ side: GameDetail.Side) -> some View {
        let landed = flight.map { PossessionToss.knocks($0.motion) } ?? false
        Image(systemName: bar.possessionSymbol ?? "football.fill")
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
            .opacity(bar.possessionInAir ? Viz.receded : 1)
            .knock(landings + (landed && clock != .live ? 1 : 0), amplitude: 2, dip: 1.5, axis: .vertical)
            .environment(\.celebrationClock, landingClock)
            .transition(glyphTransition)
    }

    /// The landing knock starts as the toss ends.
    private var landingClock: CelebrationClock {
        guard let flight else { return clock }
        return clock.delayed(by: PossessionToss.duration(flight.motion))
    }

    /// Reduce Motion crossfades the glyph between the teams; otherwise it
    /// lands from the toss (no fade) or pops in as possession first appears.
    private var glyphTransition: AnyTransition {
        if reduceMotion {
            return .asymmetric(insertion: AnyTransition.opacity.animation(Motion.fade), removal: .opacity.animation(Motion.exit))
        }
        return .asymmetric(insertion: Motion.badgeTransition.animation(Motion.quick), removal: .identity)
    }

    private func scores(_ top: DockBar.Team, _ bottom: DockBar.Team) -> some View {
        HStack(spacing: 5) {
            if bar.phase == .upcoming || (top.score == nil && bottom.score == nil) {
                Text("vs").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
            } else {
                score(top, side: .top)
                Text("–").foregroundStyle(.tertiary)
                score(bottom, side: .bottom)
            }
        }
        .font(.system(size: 17, weight: .semibold, design: .rounded).monospacedDigit())
    }

    private func score(_ t: DockBar.Team, side: GameDetail.Side) -> some View {
        Text(t.score ?? "–")
            .foregroundStyle(t.dimmed ? .secondary : .primary)
            .contentTransition(.numericText(value: Double(t.score ?? "") ?? 0))
            .animation(reduceMotion ? nil : Motion.quick, value: t.score)
            .scorePop(beats.pops(side), scale: surface == .bar ? 1.12 : 1)
            .scorePill(beats.pops(side), color: surface == .bar ? t.color : .clear)
    }

    private func climberLine(_ c: DockBar.Climber) -> some View {
        HStack(spacing: 5) {
            if let prefix = c.prefix {
                Text(prefix).font(.system(size: 11)).foregroundStyle(.secondary)
                Text("·").foregroundStyle(.tertiary)
            }
            if let flag = c.flag { Text(flag).font(.system(size: 14)) }
            Text(c.name).font(.system(size: 12, weight: .semibold)).lineLimit(1)
            if let height = c.height {
                Text("·").foregroundStyle(.tertiary)
                Text(height).font(.system(size: 15, weight: .semibold).monospacedDigit())
                    .contentTransition(.numericText())
                    .animation(reduceMotion ? nil : Motion.quick, value: height)
            }
            if let boulder = c.boulder {
                Text("·").foregroundStyle(.tertiary)
                Text(boulder).font(.system(size: 12, weight: .medium).monospacedDigit())
            }
            if let tally = c.tally, tier >= .text {
                Text("·").foregroundStyle(.tertiary)
                Text(tally).font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
            }
            if let place = c.place, tier >= .full || passDelta != nil {
                placePill(place)
            }
        }
    }

    /// "3rd", popping (and showing the places gained) when a pass happened off screen.
    private func placePill(_ place: Int) -> some View {
        HStack(spacing: 3) {
            Text(Ordinal.string(place))
                .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .padding(.horizontal, 6).padding(.vertical, 1.5)
                .background(Capsule().fill(Color.primary.opacity(0.08)))
                .scorePop(passPops)
            if let delta = passDelta {
                DeltaChip(delta: delta)
                    .transition(Motion.chip(reduceMotion: reduceMotion))
            }
        }
    }

    // MARK: Accessories (live only), by tier

    @ViewBuilder private var accessories: some View {
        if bar.phase == .live {
            ViewThatFits(in: .horizontal) {
                accessoryRow(full: true, chip: true)
                accessoryRow(full: false, chip: true)
                accessoryRow(full: false, chip: false, text: false).fixedSize()
                Color.clear.frame(width: 0, height: 0)
            }
            .transition(.opacity.animation(Motion.exit))
        }
    }

    private func accessoryRow(full: Bool, chip: Bool, text: Bool = true) -> some View {
        HStack(spacing: 6) {
            detail(full: full && tier >= .full, text: text && tier >= .text)
            if chip, let c = bar.chip, tier >= .text { chipView(c) }
            if bar.coStream, tier >= .text { CoStreamIcon(size: 12).allowsHitTesting(false) }
        }
        .fixedSize()
    }

    @ViewBuilder private func detail(full: Bool, text: Bool) -> some View {
        switch bar.detail {
        case let .football(down, spot, redZone):
            if text, let down {
                Text(full ? [down, spot].compactMap { $0 }.joined(separator: " ") : down)
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .foregroundStyle(redZone ? Color.red : .secondary)
            }
        case let .baseball(state):
            if tier >= .glyph {
                HStack(spacing: 5) {
                    // The tile's 13 × 9 bases, a touch larger on the bar's glass.
                    MiniBases(state: state).scaleEffect(1.25).frame(width: 17, height: 12)
                    OutDots(outs: state.outs)
                    if text {
                        Text("\(state.balls)–\(state.strikes)").font(.system(size: 11, weight: .medium).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        case let .cs(round):
            if text, let round {
                Text("R\(round)").font(.system(size: 11, weight: .medium).monospacedDigit()).foregroundStyle(.secondary)
            }
        case .none:
            EmptyView()
        }
    }

    @ViewBuilder private func chipView(_ chip: DockBar.Chip) -> some View {
        switch chip {
        case let .state(text):
            StateChip(text: text)
                .transition(Motion.chip(reduceMotion: reduceMotion))
        case let .run(text):
            Text(text).font(.system(size: 10.5, weight: .semibold).monospacedDigit()).foregroundStyle(Celebrate.ember)
                .transition(Motion.chip(reduceMotion: reduceMotion))
        }
    }

    // MARK: Status slot: the clock, or the news line

    @ViewBuilder private var statusSlot: some View {
        if case let .frozen(t) = clock, let newsPhase {
            frozenNews(newsPhase, t: t)
        } else {
            ZStack(alignment: .trailing) {
                if let news {
                    newsLine(news)
                        .id(news.id)
                        .transition(arriving)
                } else {
                    status.fixedSize().transition(arriving)
                }
            }
        }
    }

    /// Rises 4pt with `Motion.reveal`, leaves with `Motion.exit`; a fade with Reduce Motion.
    private var arriving: AnyTransition {
        .asymmetric(insertion: (reduceMotion ? AnyTransition.opacity : AnyTransition.opacity.combined(with: .offset(y: 4)))
                        .animation(reduceMotion ? Motion.fade : Motion.reveal),
                    removal: .opacity.animation(Motion.exit))
    }

    /// The same transition sampled at the harness's frozen clock.
    @ViewBuilder private func frozenNews(_ phase: NewsPhase, t: Double) -> some View {
        switch phase {
        case let .arriving(m):
            let rise = Motion.curve.value(at: min(max(t / (reduceMotion ? 0.15 : 0.25), 0), 1))
            let out = Motion.curve.value(at: min(max(t / 0.12, 0), 1))
            ZStack(alignment: .trailing) {
                status.fixedSize().opacity(1 - out)
                newsLine(m).opacity(rise).offset(y: reduceMotion ? 0 : 4 * (1 - rise))
            }
        case let .leaving(m):
            let rise = Motion.curve.value(at: min(max(t / (reduceMotion ? 0.15 : 0.25), 0), 1))
            let out = Motion.curve.value(at: min(max(t / 0.12, 0), 1))
            ZStack(alignment: .trailing) {
                newsLine(m).opacity(1 - out)
                status.fixedSize().opacity(rise).offset(y: reduceMotion ? 0 : 4 * (1 - rise))
            }
        }
    }

    /// `MomentCaption`'s type: a red dot, the outcome, then (with room) the play.
    private func newsLine(_ m: LiveMoment) -> some View {
        HStack(spacing: 5) {
            Circle().fill(.red).frame(width: 5, height: 5)
            (Text(m.lead).fontWeight(.semibold).foregroundStyle(.primary)
                + Text(tier >= .full && !m.detail.isEmpty ? "  \(m.detail)" : "").foregroundStyle(.secondary))
                .font(.system(size: 10.5).monospacedDigit())
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    @ViewBuilder private var status: some View {
        switch bar.status {
        case let .live(clock, fallback):
            HStack(spacing: 4) {
                LiveDot(animated: !bar.stale)
                LiveClockText(clock: clock, fallback: fallback)
            }
            .font(.system(size: 11, weight: .semibold).monospacedDigit())
            .foregroundStyle(.red)
        case let .liveText(text):
            HStack(spacing: 4) {
                LiveDot(animated: !bar.stale)
                Text(text).contentTransition(.numericText())
            }
            .font(.system(size: 11, weight: .semibold).monospacedDigit())
            .foregroundStyle(.red)
        case let .final(text):
            Text(text).font(.system(size: 11)).foregroundStyle(.secondary)
        case let .upcoming(start, hasTeams):
            // Ticks once a second only while the bar can be seen.
            if ticking {
                // On the shared whole-second grid: ticks in the same frame as the hero's clock.
                TimelineView(.periodic(from: Date(timeIntervalSinceReferenceDate: 0), by: 1)) { context in
                    countdown(start, hasTeams: hasTeams, now: context.date)
                }
            } else {
                countdown(start, hasTeams: hasTeams, now: .now)
            }
        case let .note(text):
            Text(text).font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func countdown(_ start: Date, hasTeams: Bool, now: Date) -> some View {
        if let clock = Countdown.clock(to: start, from: now) {
            Text("Starts in \(clock)").font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color.accentColor)
        } else {
            // The hero's words for a start that has passed.
            Text(start < now ? (hasTeams ? "Starting soon" : "Time TBA") : When.dayAndTime(start, now: now))
                .font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
        }
    }

    // MARK: Toss

    @ViewBuilder private var tossLayer: some View {
        if let flight, PossessionToss.travels(flight.motion), let a = slots[flight.from], let b = slots[flight.to],
           let symbol = bar.possessionSymbol {
            if case let .frozen(t) = clock, t >= PossessionToss.duration(flight.motion) {
                EmptyView()
            } else {
                PossessionToss(flight: flight, from: a, to: b, symbol: symbol)
            }
        }
    }

    // MARK: Menu

    @ViewBuilder private var menu: some View {
        if let store {
            ForEach([bar.top, bar.bottom].compactMap { $0?.competitor }.filter { $0.id != nil }, id: \.key) { c in
                Button(store.isFollowing(c) ? "Unfollow \(c.name)" : "Follow \(c.name)",
                       systemImage: store.isFollowing(c) ? "star.slash" : "star") { store.toggleFollow(c) }
            }
        }
        if let pinEvent, let store {
            Divider()
            Button(pinned ? "Remove from Menu Bar" : "Show in Menu Bar", systemImage: pinned ? "pin.slash" : "pin") {
                store.togglePin(pinEvent)
            }
        }
    }
}

/// Only what it shows: no closures among its inputs, so a re-render of its
/// host (every dock step) doesn't run this body again. Isolated to the main
/// actor, like the view.
extension DockedScorebar: @MainActor Equatable {
    static func == (a: Self, b: Self) -> Bool {
        a.bar == b.bar && a.surface == b.surface && a.beats == b.beats && a.news == b.news && a.passDelta == b.passDelta
            && a.passPops == b.passPops && a.flight == b.flight && a.landings == b.landings && a.tier == b.tier
            && a.pinEvent?.id == b.pinEvent?.id && a.pinned == b.pinned && a.ticking == b.ticking && a.newsPhase == b.newsPhase
    }
}

/// Outs as three 4pt dots (filled = out).
private struct OutDots: View {
    let outs: Int

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<3, id: \.self) { i in
                // Empty outs match MiniBases' empty bases (Viz.track vanishes on glass).
                Circle().fill(Color.primary.opacity(i < outs ? 0.75 : 0.18)).frame(width: 4, height: 4)
            }
        }
        .accessibilityHidden(true)
    }
}

/// A red card: 5 × 7, with the count when there's more than one.
private struct RedCardMark: View {
    let count: Int

    var body: some View {
        HStack(spacing: 2) {
            RoundedRectangle(cornerRadius: 1, style: .continuous).fill(.red).frame(width: 5, height: 7)
            if count > 1 { Text("\(count)").font(.system(size: 9, weight: .semibold).monospacedDigit()).foregroundStyle(.secondary) }
        }
    }
}

// MARK: - The possession toss

/// The ball changing hands across the bar: tossed on a low arc (a turnover
/// off screen), or gliding (any other change). One glyph that changes owner:
/// the old side's glyph is gone from the start, the new side's appears as it
/// lands. Drawn on the frozen clock for the harness, on `TimelineView` live,
/// and only while it plays.
struct PossessionToss: View {
    struct Flight: Equatable {
        let id: Int
        let from: GameDetail.Side
        let to: GameDetail.Side
        let motion: DockRules.PossessionMotion
        let start: Date
    }

    struct Value: Equatable {
        var progress: Double = 0
        var spin: Double = 0
    }

    let flight: Flight
    let from: CGPoint
    let to: CGPoint
    let symbol: String
    @Environment(\.celebrationClock) private var clock

    /// Toss: 0.5 s on `Celebrate.sweepCurve` (on-screen movement eases in and
    /// out). Glide: `Motion.travel`'s spring.
    static func duration(_ motion: DockRules.PossessionMotion) -> Double {
        if case .toss = motion { return 0.5 }
        return 0.45
    }

    /// A toss or a glide draws the ball between the slots; a fade doesn't.
    static func travels(_ motion: DockRules.PossessionMotion) -> Bool {
        switch motion {
        case .toss, .glide: true
        case .fade, .none: false
        }
    }

    static func knocks(_ motion: DockRules.PossessionMotion) -> Bool {
        if case .toss(_, _, true) = motion { return true }
        return false
    }

    static func timeline(_ motion: DockRules.PossessionMotion) -> KeyframeTimeline<Value> {
        KeyframeTimeline(initialValue: Value()) {
            KeyframeTrack(\.progress) {
                if case .toss = motion {
                    LinearKeyframe(1, duration: 0.5, timingCurve: Celebrate.sweepCurve)
                } else {
                    SpringKeyframe(1, duration: 0.41, spring: Spring(duration: 0.4, bounce: 0))
                    LinearKeyframe(1, duration: 0.04)
                }
            }
            KeyframeTrack(\.spin) {
                // A spiral and a quarter, on linear time.
                if case .toss(_, true, _) = motion {
                    LinearKeyframe(450, duration: 0.5)
                } else {
                    LinearKeyframe(0, duration: 0.45)
                }
            }
        }
    }

    /// Where the ball is at progress `s`: `FlightArc`'s curve between the two
    /// slots, flattened so its apex rises `rise` points (the default bow would
    /// throw it 40pt across a 200pt bar). A glide rises nothing.
    static func point(_ s: Double, from a: CGPoint, to b: CGPoint, rise: CGFloat) -> CGPoint {
        let arc = FlightArc(from: a, to: b)
        let line = CGPoint(x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s)
        let natural = min(0.22 * hypot(b.x - a.x, b.y - a.y), 40)
        guard natural > 0, rise > 0 else { return line }
        // A quad curve's apex reaches half its bow.
        let k = 2 * rise / natural
        let p = arc.point(at: s)
        return CGPoint(x: line.x + (p.x - line.x) * k, y: line.y + (p.y - line.y) * k)
    }

    var body: some View {
        switch clock {
        case let .frozen(t):
            ball(Self.timeline(flight.motion).value(time: max(t, 0)))
        case .live:
            TimelineView(.animation) { context in
                ball(Self.timeline(flight.motion).value(time: context.date.timeIntervalSince(flight.start)))
            }
        }
    }

    private func ball(_ v: Value) -> some View {
        let rise: CGFloat = if case let .toss(r, _, _) = flight.motion { r } else { 0 }
        return Image(systemName: symbol)
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
            .rotationEffect(.degrees(v.spin))
            .position(Self.point(v.progress, from: from, to: to, rise: rise))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
