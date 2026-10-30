import SwiftUI

// A play replayed under its row (Replays.swift says which plays can): the
// row's hover glyph, the click that opens and closes it, and the well itself.

// MARK: - Rows

extension View {
    /// A list row whose play can replay in the isometric view: a click opens
    /// it under the row (closing any other row's), a click again or Esc
    /// closes it. Wear it outside the row's `linkedRow`, whose click pins the
    /// play on the charts at the same time. A row whose play can't replay is
    /// left exactly as it is.
    func replayRow(_ row: ReplayRow) -> some View {
        modifier(ReplayRowModifier(row: row))
    }
}

private struct ReplayRowModifier: ViewModifier {
    let row: ReplayRow
    @Environment(PageReplays.self) private var replays: PageReplays?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if let replays, let replay = replays.plays[row.play] {
            let open = replays.open == row
            VStack(alignment: .leading, spacing: 0) {
                content
                    .simultaneousGesture(TapGesture().onEnded { toggle(replays) })
                    .accessibilityAction(named: open ? "Close Replay" : "Watch Replay") { toggle(replays) }
                if open {
                    ReplayWell(replay: replay, context: replays.context, section: row.section)
                        .padding(.top, 8)
                        .padding(.bottom, 4)
                        // Unfolds as the space under the row opens, and folds away the same way (a fade with Reduce Motion).
                        .transition(reduceMotion ? .opacity
                            : .asymmetric(insertion: .modifier(active: Unfold(progress: 0), identity: Unfold(progress: 1)),
                                          removal: .modifier(active: Unfold(progress: 0), identity: Unfold(progress: 1))))
                }
            }
        } else {
            content
        }
    }

    /// Opening travels like a group opening in the lists; closing is quicker. Reduce Motion: a short fade, no spring.
    private func toggle(_ replays: PageReplays) {
        let opening = replays.open != row
        withAnimation(reduceMotion ? Motion.fade : opening ? Motion.travel : Motion.standard) { replays.toggle(row) }
    }
}

/// The well revealed from its top as the space under the row opens (and
/// hidden the same way as it closes), opaque before it's all there.
private struct Unfold: ViewModifier, Animatable {
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func body(content: Content) -> some View {
        content
            .mask(alignment: .top) { Rectangle().scaleEffect(x: 1, y: max(progress, 0), anchor: .top) }
            .opacity(min(max(progress * 1.6, 0), 1))
    }
}

/// A line of the plays list: a play that can replay is a row like a key
/// moment's (the hover wash, the glyph, the click); any other stays plain text.
struct RecentPlayRow: View {
    let play: GameDetail.RecentPlay
    @Environment(PageReplays.self) private var replays: PageReplays?

    var body: some View {
        let text = Text(play.text).font(.system(size: 11.5)).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        if let id = play.id, replays?.plays[id] != nil {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                text.frame(maxWidth: .infinity, alignment: .leading)
                ReplayGlyph(play: id)
            }
            .linkedRow(Focus(play: id), litBy: { $0?.matches(play: id) ?? false }, pinnable: true)
            .replayRow(ReplayRow(section: .plays, play: id))
        } else {
            text
        }
    }
}

/// The play glyph at a replayable row's trailing edge, while the pointer's
/// on the row. Lists in a sport with an isometric view keep its place on
/// every row, so the columns stay put whether a row replays or not.
struct ReplayGlyph: View {
    let play: String?
    @Environment(PageReplays.self) private var replays: PageReplays?
    @Environment(\.rowHovered) private var hovered

    var body: some View {
        if let replays, replays.supported {
            let shows = hovered && play.map { replays.plays[$0] != nil && replays.open?.play != $0 } == true
            Image(systemName: "play.fill")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(.secondary)
                // Hover is instant, as a row's wash is.
                .opacity(shows ? 1 : 0)
                .frame(width: 10)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - The well

/// A play replayed in the isometric view, under its row: the sport's own
/// frame, script, stamp, celebration and names, on a clock of its own
/// (nothing it does reaches the theater above, which carries on). It plays
/// once from its start, holds as it ended, and the control in the corner
/// plays it again. A TimelineView only while it plays and its list is on
/// screen. The game's turn of the field for the play's period, as live; no
/// heartbeat and no scoring slide: it's a replay. With Reduce Motion it
/// opens on how the play ended, and the control plays it.
struct ReplayWell: View {
    let replay: PlayReplay
    let context: ReplayContext
    /// The list it's in, for whether it's on screen.
    let section: DetailView.Section
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationClock) private var clock
    @Environment(\.pageGeometry) private var geometry
    /// When it began playing; nil, held as it ended (Reduce Motion, before the control is pressed).
    @State private var start: Date?
    @State private var done = false
    @State private var scripts = ReplayScripts()
    /// Who the pointer's over (the name over him), and while his tag fades in or out.
    @State private var pointer = TheaterPointer()
    @State private var fading = false
    /// The viewer's turn of the field for this game (the theater's; only read here).
    @AppStorage private var flipped: Bool

    init(replay: PlayReplay, context: ReplayContext, section: DetailView.Section) {
        self.replay = replay
        self.context = context
        self.section = section
        _flipped = AppStorage(wrappedValue: false, TheaterOrientation.key(context.eventID))
    }

    /// Half as tall as wide, up to this: the theaters' own well.
    static let maxHeight: CGFloat = 320
    /// Where the open well is, so the page can bring it into view.
    static let anchor = "replay.well"

    private var palette: TeamPalette {
        context.nba ? .nba(top: context.top, bottom: context.bottom, scheme: scheme)
            : TeamPalette(top: context.top?.color, bottom: context.bottom?.color, scheme: scheme)
    }

    private var seen: Bool { geometry.map { $0.contentVisibility(sectionID(section)).map { !$0.isHidden } ?? true } ?? true }

    /// Seconds since it began (the harness's frozen clock: its time); infinity while held.
    private func elapsed(at date: Date) -> Double {
        if case let .frozen(t) = clock { return t }
        guard let start, !done else { return .infinity }
        return date.timeIntervalSince(start)
    }

    private var playing: Bool { clock == .live && start != nil && !done }

    /// Played through (or not begun: Reduce Motion): it holds as it ended, with the control.
    private func held(_ order: ReplayClock) -> Bool {
        if case let .frozen(t) = clock { return t >= order.end }
        return start == nil || done
    }

    var body: some View {
        let takes = scripts.takes(replay.scene, flipped: flipped, lineups: context.lineups, topIsHome: context.topIsHome)
        let order = ReplayClock(lengths: takes.map(\.duration))
        let ink = TheaterInk(scheme)
        let labels = TheaterLabels.make(kits: context.kits, scheme: scheme, teams: context.teams)
        let dressed = TheaterTeams.dressed(context.kits, palette: palette, scheme: scheme)
        let corner = takes.first?.corner ?? .trailing
        TheaterWell(cap: Self.maxHeight) {
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    Group {
                        if (playing && seen) || fading {
                            TimelineView(.animation) { context in
                                picture(takes, order, at: context.date, size: geo.size, ink: ink, labels: labels, dressed: dressed, corner: corner)
                            }
                        } else {
                            picture(takes, order, at: .now, size: geo.size, ink: ink, labels: labels, dressed: dressed, corner: corner)
                        }
                    }
                    .accessibilityHidden(true)
                    if let first = takes.first {
                        celebration(first, size: geo.size, dressed: dressed)
                            .accessibilityHidden(true)
                    }
                }
                .overlay(alignment: corner == .leading ? .bottomLeading : .bottomTrailing) {
                    if held(order) {
                        ReplayAgainButton { replayAgain() }
                            .padding(6)
                            .transition(.opacity.animation(Motion.fade))
                    }
                }
                .theaterPointer($pointer, cast: cast(takes, order)) { point in figure(at: point, takes, order, size: geo.size) }
            }
        }
        .vizWell(padding: 0)
        .pageAnchor(Self.anchor)
        .theaterFading(pointer, $fading)
        .onAppear {
            if start == nil, !reduceMotion, clock == .live { start = .now }
        }
        // Brought into view once it has opened, below a docked scorebar, if it isn't already.
        .task {
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 200 : 420))
            guard !Task.isCancelled else { return }
            geometry?.reveal(anchor: Self.anchor, topInset: PageGeometry.dockInset + 8, animated: !reduceMotion)
        }
        // Played through: it holds as it ended, with the control to play it again.
        .task(id: start) {
            guard let start, clock == .live else { return }
            let wait = start.addingTimeInterval(order.end + 0.05).timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard !Task.isCancelled, self.start == start else { return }
            withAnimation(Motion.fade) { done = true }
        }
    }

    private func replayAgain() {
        done = false
        start = .now
    }

    /// The take on screen at a date, and its time.
    private func now(_ takes: [ReplayTake], _ order: ReplayClock, at date: Date) -> (take: ReplayTake, t: Double, index: Int)? {
        guard !takes.isEmpty else { return nil }
        let p = order.position(elapsed(at: date))
        return (takes[p.take], p.t.isInfinite ? takes[p.take].ended : p.t, p.take)
    }

    // MARK: Frames

    @ViewBuilder
    private func picture(_ takes: [ReplayTake], _ order: ReplayClock, at date: Date, size: CGSize, ink: TheaterInk, labels: TheaterLabels,
                         dressed: (top: Uniform, bottom: Uniform), corner: HorizontalEdge) -> some View {
        if let shown = now(takes, order, at: date) {
            let t = shown.t
            let cast = cast(shown.take)
            let tags = { (status: TheaterStatus) in
                TheaterTags(cast: cast, labels: labels, pointer: pointer, at: date, reduceMotion: reduceMotion, status: status.tag, flip: false,
                            heartbeat: corner)
            }
            switch shown.take {
            case let .baseball(play, script):
                let teams = play.batting == .bottom ? TheaterTeams(batting: dressed.bottom, fielding: dressed.top)
                    : TheaterTeams(batting: dressed.top, fielding: dressed.bottom)
                // A replay says nothing in the tag: its headline and mark tell it.
                let status = TheaterStatus()
                DiamondFrame(scene: play, script: script, t: t, teams: teams, ink: ink, size: size, status: status, tags: tags(status))
            case let .football(scene, script):
                let offense = scene.offense ?? .top
                let teams = offense == .top ? FootballTeams(offense: dressed.top, defense: dressed.bottom)
                    : FootballTeams(offense: dressed.bottom, defense: dressed.top)
                let banner = script.banner.map { t >= $0.at - 0.3 && t < $0.until + 0.3 } ?? false
                let status = banner ? TheaterStatus() : FootballStatus.replay(scene, script: script, t: t, names: footballNames)
                ZStack(alignment: .topLeading) {
                    FootballFrame(scene: scene, script: script, t: t, teams: teams, ink: ink, size: size, zones: zones(offense), tags: tags(status))
                        .equatable()
                    TheaterStatusTag(status: status, height: size.height).padding(.top, 8)
                }
            case let .basketball(scene, script):
                let side = script.side ?? .top
                let teams = side == .top ? BasketballTeams(offense: dressed.top, defense: dressed.bottom)
                    : BasketballTeams(offense: dressed.bottom, defense: dressed.top)
                // A marquee replay's tag says nothing (BasketballStatus.during).
                let status = TheaterStatus()
                ZStack(alignment: .topLeading) {
                    BasketballFrame(scene: scene, script: script, t: t, teams: teams, ink: ink, size: size, paint: paint, tags: tags(status))
                        .equatable()
                    TheaterStatusTag(status: status, height: size.height).padding(.top, 8)
                }
            case let .soccer(scene, script):
                let teams = scene.side == .top ? SoccerTeams(attacking: dressed.top, defending: dressed.bottom)
                    : SoccerTeams(attacking: dressed.bottom, defending: dressed.top)
                let banner = script.banners.contains { t >= $0.at - 0.3 && t < $0.until + 0.3 }
                let status = banner || t >= script.stamp ? TheaterStatus() : SoccerStatus.replay(scene, names: soccerNames)
                ZStack(alignment: .topLeading) {
                    SoccerFrame(scene: scene, script: script, t: t, teams: teams, ink: ink, size: size, tags: tags(status))
                        .equatable()
                    TheaterStatusTag(status: status, height: size.height).padding(.top, 8)
                }
            }
        }
    }

    /// The play's celebration (its moment as the live lane offered it), from when it began.
    @ViewBuilder
    private func celebration(_ take: ReplayTake, size: CGSize, dressed: (top: Uniform, bottom: Uniform)) -> some View {
        switch take {
        case let .baseball(play, script):
            TheaterCelebration(play: play, script: script, size: size, color: (play.batting == .bottom ? dressed.bottom : dressed.top).accent,
                               start: start, replayed: replay.moment)
        case let .football(scene, script):
            let offense = scene.offense == .bottom ? (dressed.bottom, dressed.top) : (dressed.top, dressed.bottom)
            FootballCelebrationStage(play: scene, script: script, size: size, colors: (offense.0.accent, offense.1.accent), start: start,
                                     replayed: replay.moment)
        case let .basketball(scene, script):
            let offense = script.side == .bottom ? (dressed.bottom, dressed.top) : (dressed.top, dressed.bottom)
            BasketballCelebrationStage(play: scene, script: script, size: size, colors: (offense.0.accent, offense.1.accent), start: start,
                                       replayed: replay.moment)
        case let .soccer(scene, script):
            SoccerCelebration(scene: scene, script: script, size: size, color: (scene.side == .bottom ? dressed.bottom : dressed.top).accent,
                              start: start, replayed: replay.moment)
        }
    }

    // MARK: Names

    private var footballNames: FootballStatus.Names {
        FootballStatus.Names(top: context.teams.top, bottom: context.teams.bottom, topColor: context.kits.top.color,
                             bottomColor: context.kits.bottom.color)
    }

    private var soccerNames: SoccerStatus.Names {
        SoccerStatus.Names(top: context.teams.top, bottom: context.teams.bottom, topColor: context.kits.top.color,
                           bottomColor: context.kits.bottom.color)
    }

    /// The end zones: the offense's own nearest the camera, the one it attacks at the far end.
    private func zones(_ offense: GameDetail.Side) -> GridironLayer.Zones {
        let top = GridironLayer.EndZone(color: TheaterTeams.solid(palette.top, scheme), name: context.codes.top.uppercased())
        let bottom = GridironLayer.EndZone(color: TheaterTeams.solid(palette.bottom, scheme), name: context.codes.bottom.uppercased())
        return offense == .top ? GridironLayer.Zones(near: top, far: bottom) : GridironLayer.Zones(near: bottom, far: top)
    }

    /// The paint in the home team's color, its name at center court.
    private var paint: HoopsCourtLayer.Paint {
        HoopsCourtLayer.Paint(color: TheaterTeams.solid(context.topIsHome ? palette.top : palette.bottom, scheme),
                              name: (context.topIsHome ? context.codes.top : context.codes.bottom).uppercased())
    }

    /// Who each figure is in a take, as the live stage names them.
    private func cast(_ take: ReplayTake) -> TheaterCast {
        switch take {
        case let .baseball(play, script):
            let side = play.batting ?? .top
            return script.cast(play, beat: nil, batting: side, fielders: context.fielders, people: context.people, numbers: context.numbers,
                               now: BaseballNow(side: side), scope: "replay|\(play.id)")
        case let .football(scene, script):
            return script.cast(scene, offense: scene.offense ?? .top, people: context.people, scope: "replay|\(scene.id)|\(flipped)")
        case let .basketball(scene, script):
            return script.cast(scene, people: context.people, scope: "replay|\(scene.id)|\(flipped)")
        case let .soccer(scene, script):
            return script.cast(attacking: scene.side, lineups: context.lineups.mapValues { $0.on(at: scene.clock) }, people: context.people,
                               key: scene.shooterCredit?.athlete, scope: "replay|\(SoccerTheater.key(scene))|\(flipped)")
        }
    }

    private func cast(_ takes: [ReplayTake], _ order: ReplayClock) -> TheaterCast {
        now(takes, order, at: .now).map { cast($0.take) } ?? TheaterCast()
    }

    /// The figure under the pointer in the frame on screen.
    private func figure(at point: CGPoint, _ takes: [ReplayTake], _ order: ReplayClock, size: CGSize) -> Int? {
        guard let shown = now(takes, order, at: .now) else { return nil }
        let t = shown.t
        let spots: TheaterSpots = switch shown.take {
        case let .baseball(_, script): PlayFrame.spots(script, at: t, size: size)
        case let .football(_, script): FootballFrame.spots(script, at: t, size: size)
        case let .basketball(_, script): BasketballFrame.spots(script, at: t, size: size)
        case let .soccer(_, script): SoccerFrame.spots(script, at: t, size: size)
        }
        return TheaterTags.hit(spots.figures, at: point)
    }
}

/// The replay's control, in the corner the live theater's heartbeat takes,
/// in the turn control's look: plays it again.
private struct ReplayAgainButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.counterclockwise")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .frame(width: 22, height: 22)
                .background(Circle().fill(.black.opacity(0.4)))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help("Replay")
        .accessibilityLabel("Replay the play")
    }
}

// MARK: - Takes

/// One take of a replay: the scene as drawn, and its script.
enum ReplayTake {
    case baseball(PlayScene, PlayScript)
    case football(FootballScene, FootballScript)
    case basketball(BasketballScene, BasketballScript)
    /// The moment turned round for the half (or the viewer's turn).
    case soccer(SoccerScene, SoccerScript)

    var duration: Double {
        switch self {
        case let .baseball(_, s): s.duration
        case let .football(_, s): s.duration
        case let .basketball(_, s): s.duration
        case let .soccer(_, s): s.duration
        }
    }

    /// The time it holds at once played through: how the live theater draws
    /// a play that has ended (infinity); a basketball replay's last frame,
    /// where everyone still stands (its men fade out by infinity).
    var ended: Double {
        if case let .basketball(_, s) = self { return s.duration }
        return .infinity
    }

    /// The corner the live theater keeps its heartbeat in: the replay control's.
    var corner: HorizontalEdge {
        if case let .soccer(_, s) = self, s.cornerRight { return .leading }
        return .trailing
    }

    /// A replay's takes, scripted as the live theaters script them: the
    /// play's (and a touchdown's try after it), facing the way the game's
    /// turn of the field puts it for the play's period. (pure; tested)
    static func takes(_ scene: PlayReplay.Scene, flipped: Bool, lineups: [GameDetail.Side: SoccerLineup], topIsHome: Bool) -> [ReplayTake] {
        switch scene {
        case let .baseball(play, rest):
            return [.baseball(play, PlayScript(play, rest: rest))]
        case let .football(snap):
            return ([snap] + [snap.conversion].compactMap { $0 }).map { s in
                .football(s, FootballScript(s, yaw: FieldFacing.yaw(s.offense, period: s.period, flipped: flipped)))
            }
        case let .basketball(play):
            let ends = HoopsEnds(period: play.period, topIsHome: topIsHome, flipped: flipped)
            return [.basketball(play, BasketballScript(play, right: ends.right(play.offense)))]
        case let .soccer(moment):
            let drawn = PitchFacing.homeAttacksRight(period: moment.period, flipped: flipped) ? moment : moment.turned()
            return [.soccer(drawn, SoccerScript(drawn, lineups: lineups))]
        }
    }
}

/// The takes last built (a reference: keeping them redraws nothing), until
/// the play, the turn of the field or the lineups change.
@MainActor
private final class ReplayScripts {
    private struct Key: Equatable {
        let scene: PlayReplay.Scene
        let flipped: Bool
        let lineups: [GameDetail.Side: SoccerLineup]
        let topIsHome: Bool
    }

    private var key: Key?
    private var built: [ReplayTake] = []

    func takes(_ scene: PlayReplay.Scene, flipped: Bool, lineups: [GameDetail.Side: SoccerLineup], topIsHome: Bool) -> [ReplayTake] {
        let next = Key(scene: scene, flipped: flipped, lineups: lineups, topIsHome: topIsHome)
        if next != key {
            key = next
            built = ReplayTake.takes(scene, flipped: flipped, lineups: lineups, topIsHome: topIsHome)
        }
        return built
    }
}
