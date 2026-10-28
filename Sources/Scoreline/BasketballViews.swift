import AppKit
import SwiftUI

// NBA pages: the court, the game flow, leaders, the box score, the injury
// report and conference standings. Same ink, type and linked hover as every
// other chart; team colors for marks only.

// MARK: - Team colors

extension TeamPalette {
    /// NBA teams share a lot of navy, purple, black and red. On NBA pages, when
    /// the two colors as shown are hard to tell apart (Lakers and Jazz purple;
    /// Pacers navy beside Nets black, or beside the gray the Nets' black
    /// becomes on a dark panel), a team wears its second color: the home team
    /// first, if its second color is vivid and separates them.
    static func nba(top: Competitor?, bottom: Competitor?, scheme: ColorScheme) -> TeamPalette {
        let palette = TeamPalette(top: top?.color, bottom: bottom?.color, scheme: scheme)
        // Each color on its own: the pair's palette may already have grayed
        // out a near-twin, which would hide the clash.
        let own = (TeamPalette(top: top?.color, bottom: nil, scheme: scheme).top,
                   TeamPalette(top: bottom?.color, bottom: nil, scheme: scheme).top)
        guard difference(own.0, own.1) < 0.45 else { return palette }
        for swapBottom in [true, false] {
            guard let alternate = swapBottom ? bottom?.alternateColor : top?.alternateColor,
                  vivid(alternate, scheme: scheme) else { continue }
            let swapped = swapBottom ? TeamPalette(top: top?.color, bottom: alternate, scheme: scheme)
                                     : TeamPalette(top: alternate, bottom: bottom?.color, scheme: scheme)
            if difference(swapped.top, swapped.bottom) >= 0.45 { return swapped }
        }
        return palette
    }

    /// How different two palette colors look (sum of RGB differences; gray for neutral).
    static func difference(_ a: Color, _ b: Color) -> CGFloat {
        let (x, y) = (components(a), components(b))
        return abs(x.r - y.r) + abs(x.g - y.g) + abs(x.b - y.b)
    }

    private static func components(_ color: Color) -> (r: CGFloat, g: CGFloat, b: CGFloat) {
        guard color != Viz.neutral, let c = NSColor(color).usingColorSpace(.sRGB) else { return (0.5, 0.5, 0.5) }
        return (c.redComponent, c.greenComponent, c.blueComponent)
    }

    /// How far a color is from gray (0 = gray).
    static func chroma(_ color: Color) -> CGFloat {
        let c = components(color)
        return max(c.r, c.g, c.b) - min(c.r, c.g, c.b)
    }

    /// A team color that stays clearly colored once adjusted for the panel.
    private static func vivid(_ hex: String, scheme: ColorScheme) -> Bool {
        let adjusted = TeamPalette(top: hex, bottom: nil, scheme: scheme).top
        return adjusted != Viz.neutral && chroma(adjusted) >= 0.3
    }
}

// MARK: - Court

/// A full court, side on: every field-goal attempt where it was taken, makes
/// filled in the team's color and misses as rings. The top team shoots at the
/// right basket. Live, the last plays trail to the ball, with an arrow for who
/// has it. Under the court a scrubber replays the game shot by shot; a player
/// picked in the box score or leaders narrows it to their shots. A shot, a
/// quarter's cell, a player's row or a moment in the game flow lights the
/// shots it means; the newest shot flies in live.
///
/// In the linked peek (`\.chartPeek`) it's the court alone at the width it's
/// given: no scrubber, footer or shooting line; a picked player is named as
/// text (no ×), and a replay says where it is.
struct CourtView: View {
    let shots: [GameDetail.Shot]
    let palette: TeamPalette
    let topName: String
    let bottomName: String
    /// Box score lines by athlete ID, for a player's shooting line.
    var players: [String: GameDetail.BoxPlayer] = [:]
    /// Names by athlete ID for players the box score doesn't list yet.
    var names: [String: String] = [:]
    var live = false
    /// Every play in game order: the live trail, who has the ball, and the
    /// replay. Without them the court is the shot chart alone (and `shots` it).
    var plays: [GameDetail.CourtPlay] = []
    /// Game seconds played, while live: the replay reaches this far.
    var now: Double? = nil
    /// Moments to treat as already shown (previews and the render harness:
    /// an edit of one of them plays only what it added).
    var shownBefore: [LiveMoment] = []
    /// Opens a player's page (ESPN athlete ID): the picked player's quiet
    /// "Profile ›" link under the court. Nil: no link.
    var onOpenProfile: ((String) -> Void)? = nil
    /// Bursts for its moments (off while the play theater above it shows
    /// them: one celebration per moment). Its shot stories play either way.
    var celebrates = true
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(NBAStage.self) private var pageStage: NBAStage?
    /// Inside the linked peek: the court alone (see the type's note).
    @Environment(\.chartPeek) private var peek
    /// The live lane, for players on fire and the run's name (optional: the court works without it).
    @Environment(BasketballFeed.self) private var feed: BasketballFeed?
    @Environment(\.widthClass) private var widthClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationLevel) private var level
    /// Full team names, for what VoiceOver says (the court draws short ones).
    @Environment(\.spokenTeams) private var teams
    @Environment(\.celebrationClock) private var clock
    /// The court's own replay and pick when the page doesn't share one.
    @State private var ownStage = NBAStage()
    /// The game second under the pointer on the scrubber.
    @State private var scrubHover: Double?
    /// What the court remembers of recent moments (not observed: remembering
    /// one never redraws the court).
    @State private var memory = CourtMemory()
    /// The shot story that has handed its shot back to the chart.
    @State private var landed: String?

    /// Court feet: x along the court (0…94), y across it (0…50).
    static let length = 94.0
    static let width = 50.0
    /// The court fills the width until it's this tall, then centres with its footer.
    static let maxPlotHeight: CGFloat = 280

    /// A shot's spot in court feet. ESPN measures every shot out from the
    /// shooter's own rim; the top team shoots at the right basket.
    static func spot(_ shot: GameDetail.Shot) -> CGPoint { court(x: shot.x, y: shot.y, attacking: shot.side) }

    /// ESPN's half-court feet (toward `attacking`'s basket) as court feet.
    static func court(x: Double, y: Double, attacking side: GameDetail.Side?) -> CGPoint {
        let p = side == .bottom ? CGPoint(x: 4 + y, y: 50 - x) : CGPoint(x: 90 - y, y: x)
        return CGPoint(x: min(max(p.x, 0), length), y: min(max(p.y, 0), width))
    }

    /// The rim a team shoots at, in court feet.
    static func rim(for side: GameDetail.Side?) -> CGPoint {
        side == .bottom ? CGPoint(x: 5, y: 25) : CGPoint(x: 89, y: 25)
    }

    /// Where a play happened, in court feet (a jump ball at center court).
    static func point(_ play: GameDetail.CourtPlay) -> CGPoint? {
        if play.kind == .jumpBall { return CGPoint(x: length / 2, y: width / 2) }
        guard let spot = play.spot, let side = play.attacking else { return nil }
        return court(x: spot.x, y: spot.y, attacking: side)
    }

    /// Where the ball ended up after a play: at the rim for a shot or free
    /// throw (it went there, in or not), except a blocked shot, which never
    /// got there (the shot story stuffs it 60% of the way); else where it happened.
    static func ballPoint(_ play: GameDetail.CourtPlay) -> CGPoint? {
        switch play.kind {
        case .shot(made: false, _) where play.other != nil:
            guard let spot = point(play), let rim = play.attacking.map(rim(for:)) else { return nil }
            return CGPoint(x: spot.x + (rim.x - spot.x) * ShotArc.blockReach, y: spot.y + (rim.y - spot.y) * ShotArc.blockReach)
        case .shot, .freeThrow: return play.attacking.map(rim(for:))
        default: return point(play)
        }
    }

    /// The shots a focus means: one play; else a player's; else a stretch of
    /// game time (a run: the running team's shots in it); else a quarter's
    /// (for one team, if given).
    static func lit(_ shots: [GameDetail.Shot], by focus: Focus?) -> [GameDetail.Shot] {
        guard let focus else { return [] }
        if let play = focus.play { return shots.filter { $0.id == play } }
        if let player = focus.player { return shots.filter { $0.player == player } }
        if let span = focus.span {
            return shots.filter { shot in shot.elapsed.map(span.contains) == true && (focus.side == nil || shot.side == focus.side) }
        }
        if let period = focus.period { return shots.filter { $0.period == period && (focus.side == nil || $0.side == focus.side) } }
        return []
    }

    /// Which way a buzzer-beater's confetti flies from the rim: up, leaning
    /// into the court (straight up, half of it would leave the well).
    static func confettiDirection(_ side: GameDetail.Side?) -> Angle { .degrees(side == .bottom ? -70 : -110) }

    /// A team's backboard line, in court feet (CourtMarkings' hoop).
    static func backboard(for side: GameDetail.Side?) -> [CGPoint] {
        let x = side == .bottom ? 4.0 : 90.0
        return [CGPoint(x: x, y: 22), CGPoint(x: x, y: 28)]
    }

    private var stage: NBAStage { pageStage ?? ownStage }
    private var moment: LiveMoment? { momentFor(.court, in: moments) }

    /// Regulation, plus any overtime played (or started, live).
    private var periods: Int {
        let byPlays = max(plays.last?.period ?? 1, shots.last?.period ?? 1)
        let byClock = now.map { t in (1...14).last { NBADetail.periodStart($0) < t } ?? 1 } ?? 1
        return max(4, byPlays, byClock)
    }
    private var gameLength: Double { NBADetail.periodStart(periods + 1) }
    /// How far a replay reaches: the whole game once it's over, now while it's on.
    private var replayEnd: Double {
        guard live else { return gameLength }
        return min(max(now ?? 0, plays.last?.elapsed ?? 0), gameLength)
    }
    private var replayable: Bool { plays.count > 1 }

    var body: some View {
        let stage = stage
        // Read here, so a seek, a pick or play/pause renders the court again;
        // while a replay plays, the timeline hands each frame its time (and
        // stops ticking the moment it's paused or done).
        let paused = stage.paused, playback = stage.playback, pinned = stage.pinned
        // Reduce Motion: the replay steps twice a second instead of running.
        TimelineView(.animation(minimumInterval: reduceMotion ? 0.5 : nil, paused: playback == nil)) { context in
            let time = playback?.time(at: context.date) ?? paused
            let scene = CourtScene.make(shots: shots, plays: plays, time: time, live: live,
                                        playing: playback != nil, pinned: pinned)
            VStack(alignment: .leading, spacing: 0) {
                plot(scene, time: time, pinned: pinned)
                    .aspectRatio(Self.length / Self.width, contentMode: .fit)
                    .vizWell()
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(accessibilityText(scene, time: time, pinned: pinned))
                if peek {
                    peekLine(scene, time: time, pinned: pinned)
                } else {
                    if replayable {
                        ReplayScrubber(length: gameLength, end: replayEnd, live: live, time: time, playing: playback != nil,
                                       score: score(scene.score), onSeek: { stage.seek($0, end: replayEnd) },
                                       onPlayPause: { playPause(time: time) }, hover: $scrubHover)
                            .padding(.top, 8)
                    }
                    ChartFooter(readout: readout(scene), moment: time == nil && pinned == nil ? moment : nil) {
                        footer(scene, time: time, pinned: pinned)
                    }
                }
            }
        }
        // Chart, scrubber and footer are one unit: past the height cap it
        // stops growing and centres.
        .chartUnit(aspect: Self.length / Self.width, maxHeight: Self.maxPlotHeight)
        .onChange(of: moment) { _, moment in remember(moment) }
    }

    /// A moment as it arrives: the first version of each play is kept (an
    /// edit plays only what it adds); one that lands while the court is
    /// replaying, narrowed to a player or pointed at never celebrates.
    private func remember(_ moment: LiveMoment?) {
        guard let moment else { return }
        memory.remember(moment, quiet: stage.replaying || stage.pinned != nil || linked?.focus != nil)
    }

    /// What the court tells for the page's moment (never in a replay or for one player).
    private func story(_ scene: CourtScene, time: Double?, pinned: String?) -> CourtStory? {
        guard time == nil, pinned == nil, let moment, !memory.quiet.contains(moment.id) else { return nil }
        let first = memory.shown.first { $0.id == moment.id } ?? shownBefore.first { $0.id == moment.id }
        return CourtStory.make(moment, first: first, shots: scene.shots)
    }

    /// The render harness's clock (nil: live).
    private var frozen: Double? {
        if case let .frozen(t) = clock { return t }
        return nil
    }

    /// Where a story is: still playing, and holding its shot (and the ball)
    /// back from the chart. While it holds them, it draws them.
    private func phase(_ story: CourtStory?) -> (playing: Bool, holding: Bool) {
        guard let story, let kind = story.kind else { return (false, false) }
        let playing = frozen.map { $0 < ShotArc.duration(kind, reduceMotion: reduceMotion) } ?? (landed != story.key)
        return (playing, playing && story.holdsShot)
    }

    private func playPause(time: Double?) {
        if stage.playing { return stage.pause() }
        // From where it's held; from tip-off when it isn't, or when it's at the end.
        let from = time.flatMap { $0 < replayEnd - 1 ? $0 : nil } ?? 0
        stage.play(from: from, end: replayEnd)
    }

    // MARK: Plot

    private func plot(_ scene: CourtScene, time: Double?, pinned: String?) -> some View {
        GeometryReader { geo in
            let scale = geo.size.width / Self.length
            let point = { (p: CGPoint) in CGPoint(x: p.x * scale, y: p.y * scale) }
            let focus = linked?.focus
            let lit = Self.lit(scene.shots, by: focus)
            // A play on the trail that isn't a shot (a steal, a foul), pointed at.
            let litPlay = focus?.play.flatMap { id in lit.isEmpty ? scene.trail.last { $0.id == id && !$0.isShot } : nil }
            let dimmed = !lit.isEmpty || litPlay != nil
            // The live moment's story; never in a replay or for one player.
            let story = story(scene, time: time, pinned: pinned)
            let phase = phase(story)
            // While its story draws a shot the chart holds it back (pointing wins: then the chart shows it plainly).
            let held = focus == nil && phase.holding ? story?.shot?.id : nil
            let ballAway = focus == nil && phase.holding
            let targets = hoverTargets(scene)
            ZStack(alignment: .topLeading) {
                CourtMarkings()
                Canvas { context, _ in
                    drawShots(scene, time: time, skip: held, in: context, point: point)
                    drawTrail(scene, skip: held, in: context, point: point)
                }
                .opacity(dimmed ? Viz.receded : 1)
                if !lit.isEmpty || litPlay != nil {
                    let single = focus?.play != nil
                    Canvas { context, _ in
                        for made in [false, true] {
                            for shot in lit where shot.made == made {
                                draw(shot, at: point(Self.spot(shot)), in: context, emphasized: single)
                            }
                        }
                        if let play = litPlay, let p = Self.point(play) {
                            drawPlay(play, at: point(p), alpha: 1, in: context)
                            ring(at: point(p), radius: 7, in: context)
                        }
                    }
                    .transition(.opacity)
                }
                if scene.shots.isEmpty, live || pinned != nil {
                    Text(pinned == nil ? "Shots appear here as they're taken." : "No shots yet.")
                        .font(Viz.note).foregroundStyle(.secondary)
                        .frame(width: geo.size.width, height: geo.size.height)
                }
            }
            .compositingGroup()
            // The live layer sits outside the group, so the shots' Canvas
            // isn't redrawn on each frame of a story or a burst.
            .overlay(alignment: .topLeading) {
                live(scene, story: story, playing: phase.playing, ballAway: ballAway, time: time, size: geo.size, point: point,
                     dimmed: dimmed, pointing: focus != nil)
                    // A replay never celebrates (a live moment landing mid-replay included); nor does
                    // the court while the theater above it does.
                    .environment(\.celebrationLevel, time != nil || !celebrates ? .off : level)
            }
            .contentShape(Rectangle())
            .linkedMarks(targets.map { HoverMark(point($0.point)) }) { index in targets[index].focus }
        }
    }

    /// Over the court: the ball, the shot's story, the possession arrow, a
    /// steal's ping, and the celebration stage at the rim (topmost). The ball
    /// lives here too: it glides and fades, and inside the chart's group each
    /// of those frames would redraw every shot.
    private func live(_ scene: CourtScene, story: CourtStory?, playing: Bool, ballAway: Bool, time: Double?, size: CGSize,
                      point: @escaping (CGPoint) -> CGPoint, dimmed: Bool, pointing: Bool) -> some View {
        let center = point(CGPoint(x: Self.length / 2, y: Self.width / 2))
        return ZStack(alignment: .topLeading) {
            if let last = scene.trail.last, let ball = Self.ballPoint(last) {
                // Steps aside while a story carries the ball to the rim.
                CourtBall(point: point(ball), glides: time == nil && !reduceMotion)
                    // Hidden outright while its story draws it (fading it would be per-frame work).
                    .opacity(ballAway ? 0 : dimmed ? Viz.receded : 1)
                    .transition(.opacity)
            }
            if let story, let kind = story.kind, let shot = story.shot, playing {
                let key = story.key
                ShotArc(kind: kind, made: shot.made, spot: point(Self.spot(shot)), rim: point(Self.rim(for: shot.side)),
                        color: color(shot.side), blocker: color(shot.side?.opponent),
                        backboard: Self.backboard(for: shot.side).map(point), seed: Celebration.seed(key),
                        rest: rest(for: shot, in: scene, point: point), lands: story.lands,
                        ball: story.holdsShot ? scene.trail.last.flatMap(Self.ballPoint).map(point) : nil,
                        onFinish: { landed = key })
                    .id(key)
                    // Pointing at the chart takes over; it stays mounted so it plays once.
                    .opacity(pointing ? 0 : 1)
            }
            if let side = scene.ball.side {
                chevron(side, inAir: scene.ball.inAir, story: story, dimmed: dimmed)
                    .position(center)
                    .transition(.opacity)
            }
            if let story, story.moment.kind == .steal {
                ClockedPing(color: color(story.side), diameter: 14)
                    .position(center)
                    .id(story.key)
            }
            if let story {
                CelebrationStage(moment: story.moment, origin: point(Self.rim(for: story.side)), size: size,
                                 colors: .team(color(story.side)), direction: Self.confettiDirection(story.side),
                                 wellInset: 10, effects: story.effects)
                    .id(story.key)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    /// The possession arrow at center court. A change sweeps it around
    /// (a steal snaps); after a shot it waits until the ball is through or off
    /// the rim. It dims while a shot is in the air.
    private func chevron(_ side: GameDetail.Side, inAir: Bool, story: CourtStory?, dimmed: Bool) -> some View {
        let wait = story.flatMap { s in s.holdsShot ? s.kind.map { ShotArc.throughTime($0, reduceMotion: reduceMotion) } : nil } ?? 0
        let snap = story?.moment.kind == .steal
        let sweep = reduceMotion ? Motion.fade : (snap ? Motion.quick : Motion.standard).delay(wait)
        // The harness's clock: the sweep and the dimming as they are t seconds in.
        var angle: Angle?
        var tint = color(side)
        var air = inAir ? Viz.receded : 1
        if let t = frozen, let story, let index = plays.firstIndex(where: { $0.id == story.moment.id }) {
            let before = NBADetail.ball(plays[..<index])
            if let from = before.side, from != side {
                let u = reduceMotion ? Motion.curve.value(at: min(max(t / 0.15, 0), 1))
                    : Spring(duration: snap ? 0.2 : 0.3, bounce: 0).value(target: 1.0, time: max(0, t - wait))
                // Settled is exactly at rest (a spring only approaches its target).
                if u < 0.999 {
                    if !reduceMotion {
                        angle = .degrees(PossessionChevron.angle(from).degrees
                                         + (PossessionChevron.angle(side).degrees - PossessionChevron.angle(from).degrees) * u)
                    }
                    tint = color(from).mix(with: color(side), by: u)
                }
            }
            if before.inAir != inAir {
                let u = Motion.curve.value(at: min(max((t - wait) / 0.15, 0), 1))
                let a = before.inAir ? Viz.receded : 1
                air = a + (air - a) * u
            }
        }
        return PossessionChevron(side: side, color: tint, angle: angle)
            .opacity(air * (dimmed ? Viz.receded : 1))
            .animation(sweep, value: side)
            .animation(Motion.fade.delay(wait), value: inAir)
            .contentShape(Rectangle())
            .help("\(name(side)) \(inAir ? "shot in the air" : "ball") · attacking \(side == .top ? "→" : "←")")
            .accessibilityHidden(true)
    }

    /// How the chart draws a shot at rest, so its story ends on exactly that.
    private func rest(for shot: GameDetail.Shot, in scene: CourtScene, point: (CGPoint) -> CGPoint) -> ShotArc.Rest {
        guard let index = scene.trail.firstIndex(where: { $0.id == shot.id }) else {
            // Off the trail: with the rest of the shots (stepped back behind a trail).
            return ShotArc.Rest(grow: 1, alpha: scene.style == .trail ? Viz.receded : 1, end: nil)
        }
        let play = scene.trail[index]
        let alpha = 0.5 + 0.5 * Double(index + 1) / Double(max(scene.trail.count, 1))
        let newestShot = scene.trail.last { $0.isShot }?.id
        let end = Self.ballPoint(play)
        return ShotArc.Rest(grow: play.id == newestShot ? 1.3 : 1, alpha: alpha,
                            end: end != Self.point(play) ? end.map(point) : nil)
    }

    /// What can be pointed at: the shots drawn, and the trail's other plays.
    private func hoverTargets(_ scene: CourtScene) -> [(point: CGPoint, focus: Focus)] {
        var targets = scene.shots.map { shot in
            (Self.spot(shot), Focus(play: shot.id, period: shot.period, side: shot.side, player: shot.player))
        }
        for play in scene.trail where !play.isShot {
            if let p = Self.point(play) { targets.append((p, Focus(play: play.id, period: play.period, side: play.side, player: play.player))) }
        }
        return targets
    }

    /// The shot chart beneath. Full strength on its own; behind a trail the
    /// earlier shots step back; in a running replay each shot lands at full
    /// strength and steps back over the next two seconds.
    private func drawShots(_ scene: CourtScene, time: Double?, skip: String?, in context: GraphicsContext,
                           point: (CGPoint) -> CGPoint) {
        let onTrail = Set(scene.trail.map(\.id))
        let newest = scene.newest?.id
        for made in [false, true] {
            for shot in scene.shots where shot.made == made && shot.id != newest && !onTrail.contains(shot.id) && shot.id != skip {
                var c = context
                switch scene.style {
                case .chart: break
                case .trail: c.opacity = Viz.receded
                case .playing:
                    // Real seconds since it landed in the replay.
                    let age = max(0, ((time ?? 0) - (shot.elapsed ?? 0)) / NBAStage.rate)
                    c.opacity = max(Viz.receded, 1 - (1 - Viz.receded) * min(age / 2, 1))
                }
                draw(shot, at: point(Self.spot(shot)), in: c)
            }
        }
        // The newest shot of a replay (or a picked player's, live): larger, ringed.
        if let shot = scene.newest, !onTrail.contains(shot.id) || scene.style != .trail {
            let c = point(Self.spot(shot))
            draw(shot, at: c, in: context, emphasized: false, grow: 1.4)
            ring(at: c, radius: 6.5, in: context, opacity: 0.6)
        }
    }

    /// The last plays, oldest faintest (never fainter than the shots behind
    /// them): each shot's path to the rim, the ball's way from one play to the
    /// next within a half (a trip up the court is a change of possession, not
    /// a line worth drawing), and each play's mark.
    private func drawTrail(_ scene: CourtScene, skip: String?, in context: GraphicsContext, point: (CGPoint) -> CGPoint) {
        let count = scene.trail.count
        let midcourt = point(CGPoint(x: Self.length / 2, y: 0)).x
        let newestShot = scene.trail.last { $0.isShot }?.id
        var previousEnd: CGPoint?
        for (index, play) in scene.trail.enumerated() {
            let alpha = 0.5 + 0.5 * Double(index + 1) / Double(max(count, 1))
            guard let spot = Self.point(play).map(point) else { continue }
            let end = Self.ballPoint(play).map(point) ?? spot
            if let from = previousEnd, hypot(from.x - spot.x, from.y - spot.y) > 1,
               (from.x < midcourt) == (spot.x < midcourt) {
                var path = Path()
                path.move(to: from)
                path.addLine(to: spot)
                context.stroke(path, with: .color(Color.primary.opacity(0.28 * alpha)),
                               style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [2, 2.5]))
            }
            previousEnd = end
            guard play.id != skip else { continue }
            if end != spot { CourtInk.trailLine(from: spot, to: end, color: color(play.side), alpha: alpha, in: context) }
            drawPlay(play, at: spot, alpha: alpha, grow: play.id == newestShot ? 1.3 : 1, in: context)
        }
    }

    /// A trail play's mark: shots as the chart draws them, free throws
    /// smaller, a turnover as a cross, a foul as a small square, a rebound
    /// or jump ball as a dot.
    private func drawPlay(_ play: GameDetail.CourtPlay, at c: CGPoint, alpha: Double, grow: CGFloat = 1, in context: GraphicsContext) {
        var context = context
        context.opacity = alpha
        let ink = color(play.side)
        switch play.kind {
        case let .shot(made, value):
            draw(GameDetail.Shot(id: play.id, x: 0, y: 0, made: made, value: value, side: play.side, player: nil,
                                 period: nil, clock: "", text: "", elapsed: nil), at: c, in: context, grow: grow)
        case let .freeThrow(made, _, _):
            let rect = CGRect(x: c.x - 2, y: c.y - 2, width: 4, height: 4)
            if made { context.fill(Path(ellipseIn: rect), with: .color(ink)) } else {
                context.stroke(Path(ellipseIn: rect), with: .color(ink), lineWidth: 1)
            }
        case .turnover:
            var cross = Path()
            let r: CGFloat = 2.6
            cross.move(to: CGPoint(x: c.x - r, y: c.y - r)); cross.addLine(to: CGPoint(x: c.x + r, y: c.y + r))
            cross.move(to: CGPoint(x: c.x - r, y: c.y + r)); cross.addLine(to: CGPoint(x: c.x + r, y: c.y - r))
            context.stroke(cross, with: .color(ink), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
        case .foul:
            context.stroke(Path(CGRect(x: c.x - 2, y: c.y - 2, width: 4, height: 4)), with: .color(ink), lineWidth: 1)
        case .rebound, .jumpBall, .periodEnd:
            context.fill(Path(ellipseIn: CGRect(x: c.x - 1.75, y: c.y - 1.75, width: 3.5, height: 3.5)), with: .color(ink))
        }
    }

    private func ring(at c: CGPoint, radius r: CGFloat, in context: GraphicsContext, opacity: Double = 1) {
        context.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                       with: .color(Color.primary.opacity(opacity)), lineWidth: 1)
    }

    private func color(_ side: GameDetail.Side?) -> Color {
        switch side {
        case .top?: palette.top
        case .bottom?: palette.bottom
        case nil: Viz.neutral
        }
    }
    private func name(_ side: GameDetail.Side) -> String { side == .top ? topName : bottomName }

    private func draw(_ shot: GameDetail.Shot, at c: CGPoint, in context: GraphicsContext, emphasized: Bool = false,
                      grow: CGFloat? = nil) {
        CourtInk.shot(made: shot.made, at: c, color: color(shot.side), grow: grow ?? (emphasized ? 1.5 : 1), in: context)
        if emphasized { ring(at: c, radius: 7.5, in: context) }
    }

    // MARK: Footer

    /// The legend, with a line above it: the picked player's shooting (and
    /// their profile link), or (live and in a replay) the newest play.
    @ViewBuilder
    private func footer(_ scene: CourtScene, time: Double?, pinned: String?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let pinned {
                PinnedPlayerLine(name: playerName(pinned), line: pinnedLine(pinned, time: time),
                                 shortLine: pinnedShortLine(pinned, time: time),
                                 when: time.map { NBADetail.clockLabel(at: $0) }, streak: streak(pinned, time: time),
                                 onProfile: onOpenProfile.map { open in { open(pinned) } }) { stage.unpin() }
            } else if live || time != nil, let latest = scene.latest {
                (Text(NBADetail.clockLabel(period: latest.period, clock: latest.clock)).fontWeight(.semibold)
                    + Text("  " + NBADetail.plain(latest.text).replacingOccurrences(of: "-foot ", with: "-ft ")))
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.top, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            VizLegend {
                LegendItem(label: "\(topName) →") { Circle().fill(palette.top).frame(width: 7, height: 7) }
                LegendItem(label: "← \(bottomName)") { Circle().fill(palette.bottom).frame(width: 7, height: 7) }
                LegendItem(label: "Made") { Circle().fill(Viz.neutral).frame(width: 7, height: 7) }
                LegendItem(label: "Missed") { Circle().strokeBorder(Viz.neutral, lineWidth: 1.25).frame(width: 7, height: 7) }
                if scene.style == .trail {
                    LegendItem(label: "Turnover") {
                        Image(systemName: "xmark").font(.system(size: 6.5, weight: .bold)).foregroundStyle(Viz.neutral)
                    }
                }
                // Wider: each team's shooting, from the shots shown.
                if widthClass >= .large, pinned == nil {
                    ForEach([GameDetail.Side.top, .bottom], id: \.self) { side in
                        let mine = scene.shots.filter { $0.side == side }
                        let made = mine.filter(\.made).count
                        Text("\(name(side)) \(made)/\(mine.count)\(mine.isEmpty ? "" : " · \(Int((Double(made) / Double(mine.count) * 100).rounded()))%")")
                            .font(Viz.legend.monospacedDigit()).foregroundStyle(.secondary).fixedSize()
                    }
                }
            }
        }
    }

    /// The peek's one line under the court: the picked player, as text; else
    /// in a replay, where it is ("Replay  Q3 6:00 · LAL 78–71"), so a court
    /// with fewer shots than the page's never looks wrong. Live, nothing.
    @ViewBuilder
    private func peekLine(_ scene: CourtScene, time: Double?, pinned: String?) -> some View {
        if let pinned {
            PinnedPlayerLine(name: playerName(pinned), line: pinnedLine(pinned, time: time),
                             shortLine: pinnedShortLine(pinned, time: time),
                             when: time.map { NBADetail.clockLabel(at: $0) }, streak: streak(pinned, time: time), onClear: nil)
        } else if let time {
            (Text("Replay").fontWeight(.semibold).foregroundStyle(.primary)
                + Text("  \(NBADetail.clockLabel(at: time)) · \(score(scene.score))").foregroundStyle(.secondary))
                .font(.system(size: 10.5).monospacedDigit())
                .lineLimit(1)
                .truncationMode(.tail)
                .padding(.top, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// A picked player's straight makes, live (not in a replay).
    private func streak(_ player: String, time: Double?) -> Int {
        live && time == nil && feed?.playing == true ? feed?.streaks[player] ?? 0 : 0
    }

    private func playerName(_ id: String) -> String { players[id]?.name ?? names[id] ?? "Player" }

    /// "9 of 16, 3 of 7 from three, 25 PTS": the box score's line, or the
    /// plays' up to the replay's moment.
    private func pinnedLine(_ id: String, time: Double?) -> String {
        let n = pinnedNumbers(id, time: time)
        return "\(Self.shooting(n.fg, threes: n.threes)), \(n.points) PTS"
    }

    /// "9 of 16, 25 PTS", for where the whole line doesn't fit (nil when it's no shorter).
    private func pinnedShortLine(_ id: String, time: Double?) -> String? {
        let n = pinnedNumbers(id, time: time)
        guard n.threes.attempts > 0, n.fg.attempts > 0 else { return nil }
        return "\(n.fg.made) of \(n.fg.attempts), \(n.points) PTS"
    }

    private func pinnedNumbers(_ id: String, time: Double?)
        -> (fg: (made: Int, attempts: Int), threes: (made: Int, attempts: Int), points: Int) {
        if time == nil, let box = players[id], let fg = Self.made(box.fieldGoals) {
            return (fg, Self.made(box.threes) ?? (0, 0), box.points)
        }
        let upTo = time.map { plays.prefix(NBADetail.count(plays, through: $0)) } ?? plays[...]
        let line = NBADetail.line(for: id, in: upTo)
        return (line.fg, line.threes, line.points)
    }

    /// "LAL 78–71" at the scrubber's thumb.
    private func score(_ score: (top: Int, bottom: Int)?) -> String {
        guard let score else { return "" }
        return NBADetail.scoreLine(top: score.top, bottom: score.bottom, topName: topName, bottomName: bottomName)
    }

    // MARK: Text

    /// The scrubber's time and score; else the pointed-at shot or play; a
    /// player's or a quarter's shooting.
    private func readout(_ scene: CourtScene) -> (lead: String, detail: String)? {
        if let t = scrubHover {
            // Value first, as on Game Flow: the score, then when.
            let upTo = plays.prefix(NBADetail.count(plays, through: t))
            return (score(upTo.last.map { ($0.top, $0.bottom) } ?? (0, 0)), NBADetail.clockLabel(at: t))
        }
        guard let focus = linked?.focus else { return nil }
        if let id = focus.play {
            // Value first ("Made 3"), then when and what.
            if let shot = scene.shots.first(where: { $0.id == id }) ?? shots.first(where: { $0.id == id }) {
                let shooter = shot.player.flatMap { players[$0]?.name ?? names[$0] }
                return ("\(shot.made ? "Made" : "Missed") \(shot.value)",
                        "\(NBADetail.clockLabel(period: shot.period, clock: shot.clock)) · \(NBADetail.shotText(shot.text, shooter: shooter))")
            }
            if let play = scene.trail.last(where: { $0.id == id }) {
                return (play.label, "\(NBADetail.clockLabel(period: play.period, clock: play.clock)) · \(NBADetail.short(play.text))")
            }
            return nil
        }
        if let player = focus.player {
            let name = playerName(player)
            if let box = players[player], let fg = Self.made(box.fieldGoals) {
                return (name, Self.shooting(fg, threes: Self.made(box.threes) ?? (0, 0)))
            }
            return (name, Self.shooting(shots.filter { $0.player == player }))
        }
        if let span = focus.span {
            // A run on the game flow: its baskets, and when.
            let mine = Self.lit(scene.shots, by: focus)
            let run = feed?.runs.first { $0.span == span }
            let lead = run.map { "\(name($0.team)) \($0.label)" } ?? focus.side.map { "\(name($0)) run" } ?? "Run"
            return (lead, "\(mine.filter(\.made).count) of \(mine.count) · \(NBADetail.spanLabel(span))")
        }
        if let period = focus.period {
            let label = NBADetail.periodName(period)
            if let side = focus.side {
                return (label, "\(name(side)) " + Self.shooting(scene.shots.filter { $0.period == period && $0.side == side }))
            }
            let both = [GameDetail.Side.top, .bottom].map { side in
                let mine = scene.shots.filter { $0.period == period && $0.side == side }
                return "\(name(side)) \(mine.filter(\.made).count) of \(mine.count)"
            }
            return (label, both.joined(separator: " · "))
        }
        return nil
    }

    /// "9-16" → (9, 16).
    static func made(_ text: String) -> (made: Int, attempts: Int)? {
        let parts = text.split(separator: "-").compactMap { Int($0) }
        return parts.count == 2 ? (parts[0], parts[1]) : nil
    }

    /// "9 of 16, 3 of 7 from three".
    static func shooting(_ fg: (made: Int, attempts: Int), threes: (made: Int, attempts: Int)) -> String {
        guard fg.attempts > 0 else { return "No shots yet" }
        let line = "\(fg.made) of \(fg.attempts)"
        return threes.attempts > 0 ? "\(line), \(threes.made) of \(threes.attempts) from three" : line
    }

    static func shooting(_ shots: [GameDetail.Shot]) -> String {
        let threes = shots.filter { $0.value == 3 }
        return shooting((shots.filter(\.made).count, shots.count), threes: (threes.filter(\.made).count, threes.count))
    }

    private func accessibilityText(_ scene: CourtScene, time: Double?, pinned: String?) -> String {
        if let pinned {
            return "Shot chart, \(playerName(pinned)) only: \(pinnedLine(pinned, time: time))."
        }
        let spoken = { (side: GameDetail.Side) in (side == .top ? self.teams?.top : self.teams?.bottom) ?? self.name(side) }
        var parts = [GameDetail.Side.top, .bottom].map { side in
            "\(spoken(side)): \(Self.shooting(scene.shots.filter { $0.side == side }))"
        }
        if let time { parts.insert("Replay at \(NBADetail.clockLabel(at: time)), \(score(scene.score))", at: 0) }
        if let latest = scene.latest, live || time != nil { parts.append("Latest: \(NBADetail.plain(latest.text))") }
        if let side = scene.ball.side { parts.append(scene.ball.inAir ? "\(spoken(side)) shot, ball in the air" : "\(spoken(side)) ball") }
        return "Shot chart. " + parts.joined(separator: ". ") + "."
    }
}

/// The court's memory of recent moments: the first version of each play
/// shown (an edit then plays only what it added), and those that arrived
/// while it was replaying, narrowed or pointed at (never celebrated). A plain
/// object, deliberately unobserved: writing to it never redraws the court.
final class CourtMemory {
    private(set) var shown: [LiveMoment] = []
    private(set) var quiet: Set<String> = []

    func remember(_ moment: LiveMoment, quiet isQuiet: Bool) {
        if !shown.contains(where: { $0.id == moment.id }) {
            shown.append(moment)
            if shown.count > 16 { shown.removeFirst(shown.count - 16) }
        }
        if isQuiet {
            if quiet.count > 32 { quiet = [] }
            quiet.insert(moment.id)
        }
    }
}

/// Court lines to scale (94 × 50 ft), in the shared marking ink: keys, free-
/// throw circles, the three-point line (22 ft in the corners, 23.75 ft around
/// the arc), restricted areas, center circle; rims and backboards a step stronger.
private struct CourtMarkings: View {
    var body: some View {
        Canvas { context, size in
            let s = size.width / CourtView.length
            func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x * s, y: y * s) }
            var lines = Path()
            lines.addRect(CGRect(x: 0.5, y: 0.5, width: size.width - 1, height: size.height - 1))
            lines.move(to: p(47, 0)); lines.addLine(to: p(47, 50))
            lines.addEllipse(in: CGRect(x: (47 - 6) * s, y: (25 - 6) * s, width: 12 * s, height: 12 * s))
            var dashed = Path()
            var hoops = Path()
            var rims = Path()
            var paint = Path()
            let corner = (23.75 * 23.75 - 22 * 22).squareRoot()
            for (baseline, dir) in [(0.0, 1.0), (94.0, -1.0)] {
                let rim = baseline + dir * 5
                let toCenter = dir > 0
                // The key: 16 ft wide, 19 ft to the free-throw line.
                let key = CGRect(x: min(baseline, baseline + dir * 19) * s, y: 17 * s, width: 19 * s, height: 16 * s)
                lines.addRect(key)
                paint.addRect(key)
                // Free-throw circle: solid toward half court, dashed inside the key.
                let ft = p(baseline + dir * 19, 25)
                lines.move(to: p(baseline + dir * 19, 19))
                lines.addArc(center: ft, radius: 6 * s, startAngle: .degrees(toCenter ? -90 : 90),
                             endAngle: .degrees(toCenter ? 90 : 270), clockwise: false)
                dashed.move(to: p(baseline + dir * 19, 31))
                dashed.addArc(center: ft, radius: 6 * s, startAngle: .degrees(toCenter ? 90 : -90),
                              endAngle: .degrees(toCenter ? 270 : 90), clockwise: false)
                // Three-point line: straight along the corners, then the arc.
                let join = rim + dir * corner
                lines.move(to: p(baseline, 3)); lines.addLine(to: p(join, 3))
                lines.addArc(center: p(rim, 25), radius: 23.75 * s,
                             startAngle: .radians(atan2(-22, join - rim)), endAngle: .radians(atan2(22, join - rim)),
                             clockwise: !toCenter)
                lines.addLine(to: p(baseline, 47))
                // Restricted area: 4 ft around the rim.
                lines.move(to: p(rim, 21))
                lines.addArc(center: p(rim, 25), radius: 4 * s, startAngle: .degrees(toCenter ? -90 : 90),
                             endAngle: .degrees(toCenter ? 90 : 270), clockwise: false)
                // Backboard (4 ft in) and rim (18 in across).
                hoops.move(to: p(baseline + dir * 4, 22)); hoops.addLine(to: p(baseline + dir * 4, 28))
                rims.addEllipse(in: CGRect(x: (rim - 0.75) * s, y: (25 - 0.75) * s, width: 1.5 * s, height: 1.5 * s))
            }
            context.fill(paint, with: .color(Viz.track))
            context.stroke(lines, with: .color(Viz.markings), lineWidth: 1)
            context.stroke(dashed, with: .color(Viz.markings), style: StrokeStyle(lineWidth: 1, dash: [2, 2.5]))
            context.stroke(hoops, with: .color(Viz.reference), lineWidth: 1.5)
            context.stroke(rims, with: .color(Viz.reference), lineWidth: 1)
        }
    }
}

// MARK: - Game flow

/// The score margin through the game as a step line: above the middle while
/// the top team leads, below while the bottom team does, each side filled
/// faintly in its team's color. Quarters are marked; pointing reads out the
/// score at that moment and lights the basket on the court. In the linked
/// peek it's the plot alone (no footer).
struct GameFlowView: View {
    let flow: [GameDetail.FlowPoint]
    let palette: TeamPalette
    let topName: String
    let bottomName: String
    /// Game seconds played, while live: the line runs to here.
    var now: Double? = nil
    var final = false
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    /// The page's replay: the line draws up to its time, with a cursor.
    @Environment(NBAStage.self) private var stage: NBAStage?
    /// The live lane: ESPN's scoring run while one is on.
    @Environment(BasketballFeed.self) private var feed: BasketballFeed?
    @Environment(\.widthClass) private var widthClass
    @Environment(\.celebrationLevel) private var level
    @Environment(\.chartPeek) private var peek
    @Environment(\.spokenTeams) private var teams
    @State private var hovered: Focus?

    /// Nil: 96 at compact and medium, 128 from large up (time gains from
    /// width, so the plot never caps; height steps once).
    var plotHeight: CGFloat? = nil
    private var height: CGFloat { plotHeight ?? (widthClass >= .large ? 128 : 96) }
    private static let gutter: CGFloat = 30
    private static let trailing: CGFloat = 18

    /// The names under the plot and where they center: each quarter in its
    /// own; each overtime in its own while every one has room for its name
    /// (and 6pt around it), else one name over them all ("4OT", as the final
    /// says it). (pure; tested)
    static func periodLabels(periods: Int, x: (Double) -> CGFloat) -> [PeriodLabel] {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .medium)
        func mid(_ p: Int) -> CGFloat { (x(NBADetail.periodStart(p)) + x(NBADetail.periodStart(p + 1))) / 2 }
        func room(_ p: Int) -> CGFloat { x(NBADetail.periodStart(p + 1)) - x(NBADetail.periodStart(p)) }
        let quarters = (1...min(periods, 4)).map { PeriodLabel(text: NBADetail.periodName($0), x: mid($0)) }
        guard periods > 4 else { return quarters }
        let overtimes = Array(5...periods)
        let fit = overtimes.allSatisfy { p in
            (NBADetail.periodName(p) as NSString).size(withAttributes: [.font: font]).width + 6 <= room(p)
        }
        if fit { return quarters + overtimes.map { PeriodLabel(text: NBADetail.periodName($0), x: mid($0)) } }
        let span = (x(NBADetail.periodStart(5)) + x(NBADetail.periodStart(periods + 1))) / 2
        return quarters + [PeriodLabel(text: Period.overtime(periods - 4), x: span)]
    }

    struct PeriodLabel: Hashable {
        let text: String
        let x: CGFloat
    }

    /// Regulation, plus any overtime played.
    private var periods: Int {
        // At exactly 48:00 it's still the fourth: overtime shows once it starts.
        let byClock = now.map { t in (1...10).last { NBADetail.periodStart($0) < t } ?? 1 } ?? 1
        return max(4, flow.map(\.period).max() ?? 1, byClock)
    }
    private var length: Double { NBADetail.periodStart(periods + 1) }
    /// Where the line stops: the end of a finished game, now in a live one.
    private var lineEnd: Double {
        if final { return length }
        return min(max(now ?? 0, flow.last?.elapsed ?? 0), length)
    }
    /// The margin the chart spans each way: at least 10, in fives.
    private var extent: Double {
        let largest = Double(flow.map { abs($0.margin) }.max() ?? 0)
        return max(10, (largest / 5).rounded(.up) * 5)
    }

    var body: some View {
        // Read here so a seek re-renders the chart; while a replay plays the
        // timeline hands each frame its time, and stops when it's paused.
        let paused = stage?.paused, playback = stage?.playback
        TimelineView(.animation(minimumInterval: nil, paused: playback == nil)) { context in
            let replay = playback?.time(at: context.date) ?? paused
            chart(replay: replay.map { min($0, lineEnd) })
                // A replay never celebrates.
                .environment(\.celebrationLevel, replay != nil ? .off : level)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// ESPN's run while it's on (live, not in a replay).
    private func activeRun(replay: Double?) -> BasketballFeed.Run? {
        guard replay == nil, !final, now != nil, feed?.playing == true else { return nil }
        return feed?.runs.first
    }

    private func chart(replay: Double?) -> some View {
        let plotHeight = height
        let run = activeRun(replay: replay)
        return VStack(alignment: .leading, spacing: 0) {
            GeometryReader { geo in
                let w = geo.size.width - Self.gutter - Self.trailing
                let x = { (t: Double) -> CGFloat in Self.gutter + w * CGFloat(min(max(t / length, 0), 1)) }
                let mid = plotHeight / 2
                let reach = mid - 4
                let y = { (m: Int) -> CGFloat in mid - CGFloat(Double(m) / (extent * 1.06)) * reach }
                // The pointed-at point (or quarter, or run): read in the small
                // layers that change with it, so a hover never redraws the line.
                let target = { (focus: Focus?) in focus?.play.flatMap { id in flow.first { $0.id == id && $0.id != "tip" } } }
                ZStack(alignment: .topLeading) {
                    if let run {
                        // The run: its team's color, faintly, from its first basket to now.
                        let teamColor = run.team == .top ? palette.top : palette.bottom
                        Rectangle().fill(teamColor.opacity(0.10))
                            .frame(width: max(x(lineEnd) - x(run.start), 1), height: plotHeight)
                            .offset(x: x(run.start))
                            .transition(.opacity)
                    }
                    FocusReader { focus in
                        let pointed = target(focus) != nil
                        ZStack(alignment: .topLeading) {
                            if !pointed, let band = focus?.period {
                                Rectangle().fill(Color.primary.opacity(0.06))
                                    .frame(width: x(NBADetail.periodStart(band + 1)) - x(NBADetail.periodStart(band)), height: plotHeight)
                                    .offset(x: x(NBADetail.periodStart(band)))
                                    .transition(.opacity)
                            }
                            // A stretch of game time pointed at (a run), shaded like a quarter.
                            if !pointed, let span = focus?.span {
                                Rectangle().fill(Color.primary.opacity(0.06))
                                    .frame(width: max(x(max(span.upperBound, run.map { _ in lineEnd } ?? span.upperBound)) - x(span.lowerBound), 1),
                                           height: plotHeight)
                                    .offset(x: x(span.lowerBound))
                                    .transition(.opacity)
                            }
                        }
                    }
                    Canvas { context, size in
                        drawGrid(context, size: size, plotHeight: plotHeight, x: x, y: y)
                        if let replay {
                            // The rest of the game, faintly, so the replay has its place.
                            drawLine(context, size: size, to: lineEnd, ghost: true, x: x, y: y)
                            drawLine(context, size: size, to: replay, ghost: false, x: x, y: y)
                            let margin = flow.last { $0.elapsed <= replay }?.margin ?? 0
                            var rule = Path()
                            rule.move(to: CGPoint(x: x(replay), y: 0))
                            rule.addLine(to: CGPoint(x: x(replay), y: plotHeight))
                            context.stroke(rule, with: .color(Viz.reference), lineWidth: 1)
                            let r: CGFloat = 3
                            context.fill(Path(ellipseIn: CGRect(x: x(replay) - r, y: y(margin) - r, width: r * 2, height: r * 2)),
                                         with: .color(.primary))
                        } else {
                            drawLine(context, size: size, to: lineEnd, ghost: false, x: x, y: y)
                        }
                        if !final, let now, let last = flow.last {
                            let r: CGFloat = replay == nil ? 3 : 2.5
                            context.fill(Path(ellipseIn: CGRect(x: x(min(now, length)) - r, y: y(last.margin) - r, width: r * 2, height: r * 2)),
                                         with: .color(.red))
                        }
                    }
                    Text(topName).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                        .position(x: Self.gutter / 2 - 2, y: mid / 2)
                    Text(bottomName).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                        .position(x: Self.gutter / 2 - 2, y: mid + mid / 2)
                    FocusReader { focus in
                        if let target = target(focus) {
                            let p = CGPoint(x: x(target.elapsed), y: y(target.margin))
                            Canvas { context, size in
                                var rule = Path()
                                rule.move(to: CGPoint(x: p.x, y: 0))
                                rule.addLine(to: CGPoint(x: p.x, y: size.height))
                                context.stroke(rule, with: .color(Viz.reference), lineWidth: 1)
                                let rect = CGRect(x: p.x - 3.5, y: p.y - 3.5, width: 7, height: 7)
                                context.fill(Path(ellipseIn: rect), with: .color(.primary))
                            }
                            .frame(height: plotHeight)
                            .transition(.opacity)
                        }
                    }
                    if let run {
                        // A direct label at the band's end, on the edge away from the line,
                        // just inside the span's gridlines (on them it would be struck through).
                        let below = (flow.last?.margin ?? 0) > 0
                        let edge = below ? y(-Int(extent)) - 8 : y(Int(extent)) + 8
                        Text(run.label)
                            .font(Viz.tick).fontWeight(.semibold)
                            .foregroundStyle(.secondary)
                            .contentTransition(.numericText())
                            .animation(Motion.quick, value: run.label)
                            .fixedSize()
                            .frame(width: max(x(lineEnd) - 3, 0), alignment: .trailing)
                            .position(x: max(x(lineEnd) - 3, 0) / 2, y: edge)
                            .transition(.opacity)
                            .accessibilityHidden(true)
                    }
                    // A period's end pings at the line's end; so do runs and lead changes at Off (their sparks are a celebration).
                    if replay == nil, let moment = momentFor(.court, in: moments), let last = flow.last,
                       moment.kind == .periodEnd || (level == .off && [.run, .leadChange].contains(moment.kind)) {
                        MomentPing(color: moment.side.map { $0 == .top ? palette.top : palette.bottom } ?? .primary)
                            .position(x: x(lineEnd), y: y(last.margin))
                            .id(moment.id)
                    }
                    // Period names under the plot, centered in each (several
                    // short overtimes share one name, so none run together).
                    ForEach(Self.periodLabels(periods: periods, x: x), id: \.text) { label in
                        Text(label.text).font(Viz.tick).foregroundStyle(.secondary).fixedSize()
                            .position(x: label.x, y: plotHeight + 9)
                    }
                }
                .compositingGroup()
                // Sparks where the lead changed hands (or at the run's edge), outside the group.
                .overlay(alignment: .topLeading) {
                    if replay == nil, let beat = beat(x: x, y: y) {
                        CelebrationStage(moment: beat.moment, origin: beat.origin, size: geo.size, colors: .team(beat.color),
                                         wellInset: 8, effects: [.sparks(rays: 4, length: 9)])
                            .id("\(beat.moment.id)-flow")
                    }
                }
                .contentShape(Rectangle())
                .onContinuousHover { phase in hover(phase, x: x, w: w, run: run) }
                // A click holds the court's replay at that moment.
                .onTapGesture { location in
                    guard let stage, w > 0 else { return }
                    let t = Double((location.x - Self.gutter) / w) * length
                    guard t >= 0 else { return }
                    stage.seek(min(t, lineEnd), end: lineEnd)
                }
            }
            .frame(height: plotHeight + 16)
            .vizWell(padding: 8)

            // The footer reads the focus itself: a hover re-runs the footer, not the chart.
            if !peek { FocusReader { focus in footer(focus) } }
        }
    }

    /// The legend, or the pointed-at score, under the plot.
    private func footer(_ focus: Focus?) -> some View {
        ChartFooter(readout: readout(focus)) {
            VizLegend {
                LegendItem(label: "\(topName) leads") {
                    RoundedRectangle(cornerRadius: 1.5).fill(palette.top.opacity(0.3))
                        .overlay(alignment: .top) { Rectangle().fill(palette.top).frame(height: 1.25) }
                        .frame(width: 10, height: 8)
                }
                LegendItem(label: "\(bottomName) leads") {
                    RoundedRectangle(cornerRadius: 1.5).fill(palette.bottom.opacity(0.3))
                        .overlay(alignment: .bottom) { Rectangle().fill(palette.bottom).frame(height: 1.25) }
                        .frame(width: 10, height: 8)
                }
                if !final, now != nil {
                    LegendItem(label: "Now") { Circle().fill(.red).frame(width: 6, height: 6) }
                }
                // Wider: the game's story in numbers. Live, at every width, the
                // lead changes and ties so far, rolling as they rise.
                if widthClass >= .large, flow.count > 1 {
                    Text(summary).font(Viz.legend.monospacedDigit()).foregroundStyle(.secondary).fixedSize()
                        .contentTransition(.numericText())
                        .animation(Motion.quick, value: summary)
                        .widthDetail(.vertical)
                } else if !final, now != nil, flow.count > 1 {
                    Text(ticker).font(Viz.legend.monospacedDigit()).foregroundStyle(.secondary).fixedSize()
                        .contentTransition(.numericText())
                        .animation(Motion.quick, value: ticker)
                }
            }
        }
    }

    private func drawGrid(_ context: GraphicsContext, size: CGSize, plotHeight: CGFloat, x: (Double) -> CGFloat, y: (Int) -> CGFloat) {
        var dividers = Path()
        for period in 2...periods {
            dividers.move(to: CGPoint(x: x(NBADetail.periodStart(period)), y: 0))
            dividers.addLine(to: CGPoint(x: x(NBADetail.periodStart(period)), y: plotHeight))
        }
        context.stroke(dividers, with: .color(Viz.grid), lineWidth: 0.5)
        // The span each way, faintly, numbered at the right edge.
        let tick = Int(extent)
        var grid = Path()
        for m in [tick, -tick] {
            grid.move(to: CGPoint(x: Self.gutter, y: y(m)))
            grid.addLine(to: CGPoint(x: size.width - Self.trailing, y: y(m)))
            context.draw(Text("\(tick)").font(Viz.tick).foregroundStyle(.tertiary),
                         at: CGPoint(x: size.width, y: y(m)), anchor: .trailing)
        }
        context.stroke(grid, with: .color(Viz.grid), style: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
    }

    /// The step line to game second `end`, each side washed in its team's
    /// color; a ghost is the bare line, faint (the part of a game a replay hasn't reached).
    private func drawLine(_ context: GraphicsContext, size: CGSize, to end: Double, ghost: Bool,
                          x: (Double) -> CGFloat, y: (Int) -> CGFloat) {
        let zero = y(0)
        var line = Path()
        var area = Path()
        line.move(to: CGPoint(x: x(0), y: zero))
        area.move(to: CGPoint(x: x(0), y: zero))
        var last = 0
        for point in flow.dropFirst() where point.elapsed <= end {
            line.addLine(to: CGPoint(x: x(point.elapsed), y: y(last)))
            line.addLine(to: CGPoint(x: x(point.elapsed), y: y(point.margin)))
            area.addLine(to: CGPoint(x: x(point.elapsed), y: y(last)))
            area.addLine(to: CGPoint(x: x(point.elapsed), y: y(point.margin)))
            last = point.margin
        }
        line.addLine(to: CGPoint(x: x(end), y: y(last)))
        area.addLine(to: CGPoint(x: x(end), y: y(last)))
        area.addLine(to: CGPoint(x: x(end), y: zero))
        area.closeSubpath()
        if ghost {
            context.stroke(line, with: .color(Color.primary.opacity(0.14)), style: StrokeStyle(lineWidth: 1, lineJoin: .round))
            return
        }
        for (side, clip) in [(GameDetail.Side.top, CGRect(x: 0, y: 0, width: size.width, height: zero)),
                             (.bottom, CGRect(x: 0, y: zero, width: size.width, height: size.height - zero))] {
            var c = context
            c.clip(to: Path(clip))
            let color = side == .top ? palette.top : palette.bottom
            c.fill(area, with: .color(color.opacity(0.3)))
            c.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: 1.25, lineJoin: .round))
        }
        var baseline = Path()
        baseline.move(to: CGPoint(x: Self.gutter, y: zero))
        baseline.addLine(to: CGPoint(x: size.width - Self.trailing, y: zero))
        context.stroke(baseline, with: .color(Viz.baseline), lineWidth: 1)
    }

    /// The flow's beat for the page's moment: sparks at the zero crossing in
    /// the new leader's color when the lead changed hands late, or at the
    /// band's edge when a run reached a milestone. (A buzzer-beater that flips
    /// the lead outranks the lead change as a moment; it still sparks here.)
    private func beat(x: (Double) -> CGFloat, y: (Int) -> CGFloat) -> (moment: LiveMoment, origin: CGPoint, color: Color)? {
        guard let moment = momentFor(.court, in: moments) else { return nil }
        if let index = flow.firstIndex(where: { $0.id == moment.id }), index > 0, flow[index].margin != 0,
           moment.kind == .leadChange || (moment.tier == .score && flow[index].period >= 4),
           let before = flow[..<index].last(where: { $0.margin != 0 }), before.margin.signum() != flow[index].margin.signum() {
            let point = flow[index]
            return (moment, CGPoint(x: x(point.elapsed), y: y(0)), point.margin > 0 ? palette.top : palette.bottom)
        }
        if moment.kind == .run, let last = flow.last {
            return (moment, CGPoint(x: x(lineEnd), y: y(last.margin)), moment.side == .bottom ? palette.bottom : palette.top)
        }
        return nil
    }

    /// The score in effect where the pointer is (the basket that made it);
    /// on a run's band, the run (the court lights its baskets).
    private func hover(_ phase: HoverPhase, x: (Double) -> CGFloat, w: CGFloat, run: BasketballFeed.Run?) {
        guard let linked else { return }
        func leave() {
            if let hovered { linked.hover(hovered, false) }
            hovered = nil
        }
        guard case let .active(location) = phase, w > 0 else { return leave() }
        let t = Double((location.x - Self.gutter) / w) * length
        let next: Focus
        if let run, t >= run.start, t <= lineEnd + 30 {
            next = Focus(side: run.team, span: run.span)
        } else {
            guard t >= 0, t <= lineEnd + 30, let index = flow.lastIndex(where: { $0.elapsed <= t }), index > 0 else { return leave() }
            let point = flow[index]
            next = Focus(play: point.id, period: point.period, side: point.scorer)
        }
        guard next != hovered else { return }
        linked.hover(next, true)
        hovered = next
    }

    /// Value first: "LAL +4", then "88–84 · Q3 4:12" (the leader's score
    /// first); on a run, "LAL 12–0 run", then when.
    private func readout(_ focus: Focus?) -> (lead: String, detail: String)? {
        if let focus, focus.play == nil, let span = focus.span {
            let run = feed?.runs.first { $0.span == span }
            let team = (run?.team ?? focus.side).map { $0 == .top ? topName : bottomName }
            return ([team, run?.label ?? "Run"].compactMap { $0 }.joined(separator: " "), NBADetail.spanLabel(span))
        }
        guard let id = focus?.play, let point = flow.first(where: { $0.id == id && $0.id != "tip" }) else { return nil }
        return Self.readout(point, topName, bottomName)
    }

    static func readout(_ p: GameDetail.FlowPoint, _ topName: String, _ bottomName: String) -> (lead: String, detail: String) {
        let when = NBADetail.clockLabel(period: p.period, clock: p.clock)
        if p.top == p.bottom { return ("Tied", "\(p.top)–\(p.bottom) · \(when)") }
        let (name, high, low) = p.top > p.bottom ? (topName, p.top, p.bottom) : (bottomName, p.bottom, p.top)
        return ("\(name) +\(high - low)", "\(high)–\(low) · \(when)")
    }

    /// Lead changes, ties and each side's largest lead (a tie isn't a change).
    static func story(_ flow: [GameDetail.FlowPoint]) -> (changes: Int, ties: Int, top: Int, bottom: Int) {
        var leader = 0, changes = 0, ties = 0
        for p in flow.dropFirst() {
            if p.margin == 0 {
                if leader != 0 { ties += 1 }
                continue
            }
            if leader != 0, p.margin.signum() != leader { changes += 1 }
            leader = p.margin.signum()
        }
        return (changes, ties, max(flow.map(\.margin).max() ?? 0, 0), max(-(flow.map(\.margin).min() ?? 0), 0))
    }

    /// "Lead changes 9 · Ties 4".
    private var ticker: String {
        let s = Self.story(flow)
        return "Lead changes \(s.changes) · Ties \(s.ties)"
    }

    /// "Lead changes 9 · Ties 4 · Largest lead LAL +15".
    private var summary: String {
        let s = Self.story(flow)
        let largest = s.top >= s.bottom ? "\(topName) +\(s.top)" : "\(bottomName) +\(s.bottom)"
        return "Lead changes \(s.changes) · Ties \(s.ties) · Largest lead \(largest)"
    }

    private var accessibilityText: String {
        let s = Self.story(flow)
        return "Game flow. Largest lead: \(teams?.top ?? topName) \(s.top), \(teams?.bottom ?? bottomName) \(s.bottom). "
            + "\(plural(s.changes, "lead change"))."
    }
}

// MARK: - Leaders

/// Points, rebounds and assists: each team's leader face to face, top team
/// left, with the higher number in full ink. Pointing at a player lights
/// their shots.
struct LeadersView: View {
    let lines: [GameDetail.LeaderLine]
    /// Clicking a leader picks them for the court (again to clear).
    @Environment(NBAStage.self) private var stage: NBAStage?
    /// Live: who's on fire.
    @Environment(BasketballFeed.self) private var feed: BasketballFeed?

    /// A leader's straight makes while the game is on (3+ shows a flame).
    private func streak(_ player: String?) -> Int {
        guard let player, feed?.playing == true else { return 0 }
        return feed?.streaks[player] ?? 0
    }

    var body: some View {
        StackColumn(spacing: 8) {
            ForEach(lines) { line in
                HStack(spacing: 4) {
                    cell(line.top, against: line.bottom, trailing: false)
                    Text(line.category)
                        .font(.system(size: 9.5, weight: .semibold)).tracking(0.4)
                        .foregroundStyle(.secondary)
                        .frame(width: 30)
                    cell(line.bottom, against: line.top, trailing: true)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilityText(line))
            }
        }
    }

    @ViewBuilder
    private func cell(_ leader: GameDetail.Leader?, against other: GameDetail.Leader?, trailing: Bool) -> some View {
        if let leader {
            let leads = (Double(leader.value) ?? 0) >= (Double(other?.value ?? "") ?? 0)
            let picked = leader.player != nil && stage?.pinned == leader.player
            Button { if let player = leader.player { stage?.togglePin(player) } } label: {
                HStack(spacing: 7) {
                    if trailing { value(leader.value, leads: leads) } else { Headshot(url: leader.headshot, size: 28) }
                    VStack(alignment: trailing ? .trailing : .leading, spacing: 0) {
                        let hot = streak(leader.player)
                        HStack(spacing: 3) {
                            // "C. Cunningham" where it fits, "Cunningham" where it doesn't.
                            // A click on the name opens their page; anywhere else picks them.
                            PlayerNameLink(espn: (leader.player, leader.name, leader.headshot)) {
                                PlayerName(name: leader.name)
                                    .font(.system(size: 11.5, weight: .medium))
                            }
                            if hot >= NBADetail.fireStreak {
                                StreakFlame(help: "\(hot) straight makes")
                                    .transition(StreakFlame.arrival)
                            }
                        }
                        .animation(Motion.quick, value: hot >= NBADetail.fireStreak)
                        if let detail = leader.detail {
                            Text(detail).font(.system(size: 9.5).monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
                    if trailing { Headshot(url: leader.headshot, size: 28) } else { value(leader.value, leads: leads) }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(picked ? Viz.highlight : .clear)
                .padding(.horizontal, -6).padding(.vertical, -2))
            // The cell reads the focus itself: a hover re-runs the cells it
            // lights, not the leaders around them.
            .linkedRow(Focus(player: leader.player), litBy: { [player = leader.player] in player != nil && $0?.player == player })
            .help(stage == nil || leader.player == nil ? "" : picked ? "Show every player on the court" : "Show only \(leader.name)'s shots on the court")
            .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
            // VoiceOver: "Show on Shot Chart", pinned and scrolled to (the peek's equivalent).
            .showOnChartAction(Focus(player: leader.player))
            // A double click anywhere, or "Go to …", opens their page too.
            .playerPageLink(id: leader.player, name: leader.name, photo: leader.headshot)
            .frame(maxWidth: .infinity)
        } else {
            Text("–").font(.system(size: 11.5)).foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, alignment: trailing ? .trailing : .leading)
        }
    }

    private func value(_ text: String, leads: Bool) -> some View {
        Text(text)
            .font(.system(size: 15, weight: .semibold, design: .rounded).monospacedDigit())
            .foregroundStyle(leads ? .primary : .secondary)
            .contentTransition(.numericText(value: Double(text) ?? 0))
    }

    private func accessibilityText(_ line: GameDetail.LeaderLine) -> String {
        let parts = [line.top, line.bottom].compactMap { $0 }.map { leader in
            let hot = streak(leader.player)
            return "\(leader.name) \(leader.value)" + (hot >= NBADetail.fireStreak ? ", \(hot) straight makes" : "")
        }
        return "\(line.category): " + parts.joined(separator: ", ")
    }
}

/// A player's name where room is short: whole where it fits ("C. Cunningham"),
/// else the surname ("Cunningham"), and only then truncated. The box score at
/// the large width (FT, STL and BLK join and the name column drops to about
/// 80pt), leaders, and the picked player's chip all use it. Font and weight
/// come from outside, so both forms measure alike.
struct PlayerName: View {
    let name: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            Text(name).fixedSize()
            Text(NBADetail.lastName(name)).lineLimit(1).truncationMode(.tail)
        }
    }
}

/// A player's headshot, cropped to a circle (ESPN's are wider than tall, on
/// transparent ground), over a faint disc.
struct Headshot: View {
    let url: URL?
    var size: CGFloat = 28
    @State private var loaded: NSImage?

    /// Decoded wide enough that the height fills the circle at 2×.
    private var pixels: Int { Int((size * 2 * 1.45).rounded(.up)) }

    var body: some View {
        let image = loaded ?? ImageCache.shared.cached(url, pixels: pixels)
        ZStack {
            Circle().fill(Color.primary.opacity(0.07))
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .transition(.opacity)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.45))
                    .foregroundStyle(.quaternary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .animation(Motion.fade, value: loaded != nil)
        .task(id: url) {
            guard let url, ImageCache.shared.cached(url, pixels: pixels) == nil else { return }
            loaded = await ImageCache.shared.image(for: url, pixels: pixels)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Box score

/// One team at a time: starters, then the bench by minutes, the team's line,
/// then who hasn't played, in one line. Team highs in semibold; live, a dot
/// marks the five on court. Wider layouts add columns (FG and 3PT, then FT,
/// STL and BLK, then TO and PF). Pointing at a player lights their shots;
/// clicking picks them for the court (again to clear).
struct BoxScoreView: View {
    let top: [GameDetail.BoxPlayer]
    let bottom: [GameDetail.BoxPlayer]
    let topName: String
    let bottomName: String
    /// Each team's totals, keyed like a player's line.
    var topTotals: [String: String] = [:]
    var bottomTotals: [String: String] = [:]
    var live = false
    @State private var selection: GameDetail.Side
    @Environment(NBAStage.self) private var stage: NBAStage?
    /// Live: who's on fire.
    @Environment(BasketballFeed.self) private var feed: BasketballFeed?
    @Environment(\.widthClass) private var widthClass
    /// Read once here for every cell's transition (see `cellTransition`).
    @Environment(\.panelGrowth) private var growth
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(top: [GameDetail.BoxPlayer], bottom: [GameDetail.BoxPlayer], topName: String, bottomName: String,
         topTotals: [String: String] = [:], bottomTotals: [String: String] = [:], live: Bool = false,
         initial: GameDetail.Side = .top) {
        self.top = top
        self.bottom = bottom
        self.topName = topName
        self.bottomName = bottomName
        self.topTotals = topTotals
        self.bottomTotals = bottomTotals
        self.live = live
        _selection = State(initialValue: initial)
    }

    struct Column: Equatable {
        let label: String
        let width: CGFloat
        let help: String
        /// The narrowest layout that shows it.
        let from: WidthClass
    }

    /// Every column in reading order; a layout shows those it's wide enough
    /// for, so a column never moves when others join (the player column keeps
    /// at least 96pt at each step).
    static let allColumns: [Column] = [
        Column(label: "MIN", width: 28, help: "Minutes", from: .compact),
        Column(label: "PTS", width: 26, help: "Points", from: .compact),
        Column(label: "FG", width: 40, help: "Field goals made–attempted", from: .medium),
        Column(label: "3PT", width: 36, help: "Three-pointers made–attempted", from: .medium),
        Column(label: "FT", width: 36, help: "Free throws made–attempted", from: .large),
        Column(label: "REB", width: 26, help: "Rebounds", from: .compact),
        Column(label: "AST", width: 26, help: "Assists", from: .compact),
        Column(label: "STL", width: 26, help: "Steals", from: .large),
        Column(label: "BLK", width: 26, help: "Blocks", from: .large),
        Column(label: "TO", width: 24, help: "Turnovers", from: .xlarge),
        Column(label: "PF", width: 24, help: "Personal fouls", from: .xlarge),
        Column(label: "+/-", width: 30, help: "Plus-minus", from: .compact),
    ]

    static func columns(for width: WidthClass) -> [Column] { allColumns.filter { $0.from <= width } }

    /// Stats with a team high to set in semibold.
    private static let ranked: Set<String> = ["PTS", "REB", "AST", "STL", "BLK"]

    var body: some View {
        let columns = Self.columns(for: widthClass)
        let players = selection == .top ? top : bottom
        let played = players.filter(\.played)
        // Just after tip-off ESPN may not have flagged the starters yet.
        let starters = played.filter(\.starter)
        let bench = played.filter { !$0.starter }
        // Nor is "on court" right until five are marked.
        let floor = live && played.filter(\.onCourt).count == 5
        let out = players.filter { !$0.played }
        var highs: [String: Int] = [:]
        for label in Self.ranked { highs[label] = played.compactMap { Int($0.stats[label] ?? "") }.max() ?? 0 }
        let transition = cellTransition
        return VStack(alignment: .leading, spacing: 8) {
            Picker("Team", selection: $selection) {
                Text(topName).tag(GameDetail.Side.top)
                Text(bottomName).tag(GameDetail.Side.bottom)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.small)
            .fixedSize()
            VStack(alignment: .leading, spacing: 0) {
                header(columns)
                ForEach(starters) { row($0, columns: columns, highs: highs, floor: floor, transition: transition) }
                if !bench.isEmpty, !starters.isEmpty {
                    // Drawn in caps, read as written ("Bench").
                    Text("Bench")
                        .textCase(.uppercase)
                        .font(.system(size: 9.5, weight: .semibold)).tracking(0.4)
                        .foregroundStyle(.secondary)
                        .padding(.top, 7)
                        .padding(.bottom, 2)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityHeading(.h3)
                }
                ForEach(bench) { row($0, columns: columns, highs: highs, floor: floor, transition: transition) }
                let totals = selection == .top ? topTotals : bottomTotals
                if !totals.isEmpty, !played.isEmpty { totalsRow(totals, columns: columns, transition: transition) }
                if !out.isEmpty {
                    Text(Self.notPlayed(out, live: live))
                        .font(Viz.note)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }
            }
            .id(selection)
        }
    }

    private func header(_ columns: [Column]) -> some View {
        HStack(spacing: 6) {
            Text("Player").textCase(.uppercase)
            Spacer(minLength: 4)
            ForEach(columns, id: \.label) { column in
                Text(column.label).frame(width: column.width, alignment: .trailing).help(column.help).widthDetail()
            }
        }
        .font(.system(size: 9.5, weight: .semibold))
        .foregroundStyle(.secondary)
        .padding(.bottom, 3)
        .accessibilityHidden(true)
    }

    /// How a column's cells come and go when the width class changes: the
    /// header's `widthDetail()` motion (slide in from the edge being pulled,
    /// fade with Reduce Motion), built once per table and applied to each cell
    /// as a plain transition, instead of one `WidthDetail` modifier (with its
    /// own environment reads) per cell — about a hundred in a full box score.
    private var cellTransition: AnyTransition {
        guard !reduceMotion else { return AnyTransition.opacity.animation(Motion.fade) }
        let insertion = AnyTransition.opacity.combined(with: .offset(x: 10))
            .animation(Motion.reveal.delay(growth == .wider ? 0.14 : 0))
        let removal = AnyTransition.opacity.combined(with: .offset(x: 8)).animation(Motion.exit)
        return .asymmetric(insertion: insertion, removal: removal)
    }

    /// The team's line, closing the table (no minutes or plus-minus).
    private func totalsRow(_ totals: [String: String], columns: [Column], transition: AnyTransition) -> some View {
        HStack(spacing: 6) {
            Text("Team")
            Spacer(minLength: 4)
            ForEach(columns, id: \.label) { column in
                Text(["MIN", "+/-"].contains(column.label) ? "" : totals[column.label] ?? "–")
                    .frame(width: column.width, alignment: .trailing)
                    .transition(transition)
            }
        }
        .font(.system(size: 11.5, weight: .semibold).monospacedDigit())
        .padding(.top, 5)
        .padding(.bottom, 1)
        .overlay(alignment: .top) { Rectangle().fill(Viz.grid).frame(height: 0.5).padding(.top, 2) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Team: " + Self.spoken(totals, columns: columns.filter { !["MIN", "+/-"].contains($0.label) }))
    }

    private func row(_ p: GameDetail.BoxPlayer, columns: [Column], highs: [String: Int], floor: Bool,
                     transition: AnyTransition) -> some View {
        let onCourt = floor && p.onCourt
        let picked = stage?.pinned == p.id
        let hot = live && feed?.playing == true ? feed?.streaks[p.id] ?? 0 : 0
        let onFire = hot >= NBADetail.fireStreak
        return Button {
            stage?.togglePin(p.id)
        } label: {
            HStack(spacing: 6) {
                HStack(spacing: 5) {
                    if live {
                        // Secondary, never red: red already means "live".
                        Circle().fill(onCourt ? Color.secondary : .clear).frame(width: 5, height: 5)
                            .help(onCourt ? "On court" : "")
                    }
                    // A click on the name opens their page; anywhere else picks them.
                    PlayerNameLink(espn: (p.id, p.name, nil)) {
                        PlayerName(name: p.name).fontWeight(picked ? .semibold : .regular)
                    }
                    if onFire {
                        StreakFlame(help: "\(hot) straight makes")
                            .padding(.leading, -2)
                            .transition(StreakFlame.arrival)
                    }
                }
                .animation(Motion.quick, value: onFire)
                Spacer(minLength: 4)
                ForEach(columns, id: \.label) { column in
                    cell(p, column, highs: highs).transition(transition)
                }
            }
            .font(.system(size: 11.5).monospacedDigit())
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // A picked player keeps the selection wash (the accent's), under the hover ghost.
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(picked ? Viz.highlight : .clear)
            .padding(.horizontal, -6).padding(.vertical, -2))
        // The row reads the focus itself: pointing anywhere on the page
        // re-runs the rows it lights, never the whole box score.
        .linkedRow(Focus(player: p.id), litBy: { [id = p.id] in $0?.player == id })
        .help(stage == nil ? "" : picked ? "Show every player on the court" : "Show only \(p.name)'s shots on the court")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(p.name)\(onCourt ? ", on court" : "")\(onFire ? ", \(hot) straight makes" : ""): \(p.minutes) minutes, "
                            + Self.spoken(p.stats, columns: columns.filter { $0.label != "MIN" }))
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
        // VoiceOver: "Show on Shot Chart", pinned and scrolled to (the peek's equivalent).
        .showOnChartAction(Focus(player: p.id))
        .accessibilityHint(stage == nil ? "" : picked ? "Shows every player on the court" : "Shows only this player's shots on the court")
        // A double click anywhere, or "Go to …", opens their page too.
        .playerPageLink(id: p.id, name: p.name)
    }

    @ViewBuilder
    private func cell(_ p: GameDetail.BoxPlayer, _ column: Column, highs: [String: Int]) -> some View {
        let text = p.stats[column.label] ?? ""
        switch column.label {
        case "MIN":
            Text(text).foregroundStyle(.secondary).frame(width: column.width, alignment: .trailing)
        case "+/-":
            Text(Self.signed(text)).foregroundStyle(.secondary).frame(width: column.width, alignment: .trailing)
        case let label where Self.ranked.contains(label):
            let value = Int(text) ?? 0
            let high = highs[label] ?? 0
            Text("\(value)")
                .fontWeight(value == high && high > 0 && ["PTS", "REB", "AST"].contains(label) ? .semibold : .regular)
                .frame(width: column.width, alignment: .trailing)
                .contentTransition(.numericText(value: Double(value)))
        default:
            Text(text.isEmpty ? "–" : text).frame(width: column.width, alignment: .trailing)
        }
    }

    /// A row read aloud: "12 points, 4 of 9 field goals, …, plus-minus +3".
    static func spoken(_ stats: [String: String], columns: [Column]) -> String {
        columns.compactMap { column -> String? in
            guard let value = stats[column.label], !value.isEmpty else { return nil }
            switch column.label {
            case "FG", "3PT", "FT":
                let parts = value.split(separator: "-")
                let name = column.label == "FG" ? "field goals" : column.label == "3PT" ? "threes" : "free throws"
                return parts.count == 2 ? "\(parts[0]) of \(parts[1]) \(name)" : nil
            case "+/-": return "plus-minus \(value)"
            default: return "\(value) \(column.help.lowercased())"
            }
        }.joined(separator: ", ")
    }

    /// "+9", "−15" (a real minus sign), "0".
    static func signed(_ text: String) -> String {
        text.hasPrefix("-") ? "−" + text.dropFirst() : text
    }

    /// Live: "Not in yet: A, B". After: "DNP: A, B · Coach's decision", one clause per reason.
    static func notPlayed(_ players: [GameDetail.BoxPlayer], live: Bool) -> String {
        if live { return "Not in yet: " + players.map(\.name).joined(separator: ", ") }
        var groups: [(reason: String, names: [String])] = []
        for p in players {
            let reason = p.didNotPlay ?? "Coach's decision"
            if let i = groups.firstIndex(where: { $0.reason == reason }) { groups[i].names.append(p.name) } else { groups.append((reason, [p.name])) }
        }
        return "DNP: " + groups.map { "\($0.names.joined(separator: ", ")) · \($0.reason)" }.joined(separator: "; ")
    }
}

// MARK: - Injuries

/// ESPN's current injury report, team by team: who, what, and their status.
struct InjuryReport: View {
    let injuries: [GameDetail.Injury]
    let topTeam: Competitor?
    let bottomTeam: Competitor?

    var body: some View {
        StackColumn(spacing: 12) {
            group(.top, team: topTeam)
            group(.bottom, team: bottomTeam)
        }
    }

    private func group(_ side: GameDetail.Side, team: Competitor?) -> some View {
        let list = injuries.filter { $0.side == side }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                LogoView(url: team?.logo, darkURL: team?.darkLogo, size: 14)
                Text(team?.name ?? "").font(.system(size: 11, weight: .semibold)).lineLimit(1)
            }
            if list.isEmpty {
                Text("No injuries reported.").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            ForEach(list) { injury in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(injury.name).font(.system(size: 12)).lineLimit(1)
                        if let detail = Self.detail(injury) {
                            Text(detail).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 6)
                    Text(injury.status)
                        .font(.system(size: 11, weight: injury.status.hasPrefix("Out") ? .semibold : .regular))
                        .foregroundStyle(injury.status.hasPrefix("Out") ? .primary : .secondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel([injury.name, injury.status, Self.detail(injury)].compactMap { $0 }.joined(separator: ", "))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// "Left ankle sprain · Expected back Oct 27".
    static func detail(_ injury: GameDetail.Injury) -> String? {
        var parts = [injury.detail].compactMap { $0 }
        if let back = injury.returnDate, back > Calendar.current.startOfDay(for: .now) {
            parts.append("Expected back \(back.formatted(.dateTime.month(.abbreviated).day()))")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - Standings

/// NBA conference standings by seed, re-ranked live: rows glide to where
/// they'd be if live scores held, with movement arrows against the official
/// seeding. Hairlines mark the play-in (7–10) and the lottery (11–15).
struct NBAStandingsTable: View {
    let rows: [NBAStandings.LiveRow]
    var highlight: Set<String> = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let grouped = Set(rows.compactMap(\.row.group)).count > 1
        StackColumn {
            header
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, r in
                let previous = index > 0 ? rows[index - 1] : nil
                let sameGroup = previous?.row.group == r.row.group
                if grouped, !sameGroup, let group = r.row.group {
                    Text(group)
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6)
                        .padding(.top, index == 0 ? 2 : 12)
                        .padding(.bottom, 3)
                        .accessibilityAddTraits(.isHeader)
                } else if let previous, sameGroup {
                    if previous.liveRank + 1 < r.liveRank {
                        // Rows skipped (a window around two teams): mark the gap.
                        Image(systemName: "ellipsis")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 10)
                            .help("Teams in between hidden")
                            .accessibilityHidden(true)
                    } else if previous.liveRank == 6 {
                        zone("Play-in", help: "Seeds 7–10 play in for the last four playoff places")
                    } else if previous.liveRank == 10 {
                        zone("Lottery", help: "Seeds 11–15 miss the postseason")
                    }
                }
                row(r)
            }
        }
        // Rows glide to their new places when live results change the order.
        .animation(reduceMotion ? nil : Motion.travel, value: rows.map(\.id))
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text("#").frame(width: 30, alignment: .leading).help("Seed")
            Text("Team")
            Spacer()
            Text("W-L").frame(width: 40, alignment: .trailing).help("Wins and losses")
            Text("PCT").frame(width: 36, alignment: .trailing).help("Win percentage")
            Text("GB").frame(width: 28, alignment: .trailing).help("Games behind the conference leader")
        }
        .font(.system(size: 9.5, weight: .semibold))
        .foregroundStyle(.secondary)
        .padding(.horizontal, 6)
        .padding(.bottom, 4)
        .accessibilityHidden(true)
    }

    /// A labeled hairline where a zone begins.
    private func zone(_ label: String, help: String) -> some View {
        HStack(spacing: 6) {
            Text(label).font(Viz.tick).foregroundStyle(.tertiary).fixedSize()
            Rectangle().fill(Viz.markings).frame(height: 0.5)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .help(help)
        .accessibilityHidden(true)
    }

    private func row(_ r: NBAStandings.LiveRow) -> some View {
        let mine = highlight.contains(r.id)
        return HStack(spacing: 6) {
            HStack(spacing: 2) {
                Text("\(r.liveRank)").font(.system(size: 11, weight: .semibold).monospacedDigit())
                if r.movement != 0 {
                    Image(systemName: r.movement > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
                        .font(.system(size: 6))
                        .foregroundStyle(r.movement > 0 ? .green : .red)
                        .help(r.movement > 0 ? "Up \(r.movement) from the official seeding" : "Down \(-r.movement) from the official seeding")
                }
            }
            .frame(width: 30, alignment: .leading)
            LogoView(url: r.row.logo, size: 15)
            Text(r.row.name).font(.system(size: 12, weight: mine ? .semibold : .regular)).lineLimit(1)
            if let score = r.liveScore {
                HStack(spacing: 3) {
                    LiveDot()
                    Text(score).font(.system(size: 9.5, weight: .semibold).monospacedDigit()).foregroundStyle(.red)
                }
                .help("Playing now")
            }
            Spacer(minLength: 4)
            Text("\(r.wins)-\(r.losses)").fontWeight(.semibold).frame(width: 40, alignment: .trailing)
                .contentTransition(.numericText())
            Text(r.percentText).foregroundStyle(.secondary).frame(width: 36, alignment: .trailing)
            Text(r.gamesBehind).foregroundStyle(.secondary).frame(width: 28, alignment: .trailing)
        }
        .font(.system(size: 11.5).monospacedDigit())
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(mine ? Viz.highlight : .clear))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(r))
        // The row opens the team's page (hover fill, click, "Go to …").
        .teamRowLink(id: r.id, name: r.row.name, logo: r.row.logo, abbreviation: r.row.abbreviation)
    }

    private func accessibilityText(_ r: NBAStandings.LiveRow) -> String {
        var parts = ["\(Ordinal.string(r.liveRank)), \(r.row.name)", "\(r.wins) and \(r.losses)",
                     r.gamesBehind == "–" ? "leads the conference" : "\(r.gamesBehind) games behind"]
        if let score = r.liveScore { parts.append("playing now, \(score)") }
        if r.movement != 0 { parts.append(r.movement > 0 ? "up \(r.movement)" : "down \(-r.movement)") }
        return parts.joined(separator: ", ")
    }
}
