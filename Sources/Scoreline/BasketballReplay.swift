import AppKit
import SwiftUI

// NBA court, live and in replay: the last plays trailing to the ball (with an
// arrow for who has it), a scrubber that replays the game shot by shot, and a
// player picked from the box score or leaders. One small observable carries
// the replay time and the picked player to every NBA view on the page.

// MARK: - Stage

/// The NBA page's shared replay and picked player. The court's scrubber and
/// the game flow write the replay time; box-score rows and leaders pick a
/// player. While a replay plays, views compute its time from the frame's date
/// (`time(at:)`), so nothing here changes per frame.
@MainActor
@Observable
final class NBAStage {
    /// The player picked from the box score or leaders (ESPN athlete ID): the
    /// court shows only their shots.
    private(set) var pinned: String?
    /// A paused replay's game second (nil while not replaying, or while playing).
    private(set) var paused: Double?
    /// A replay running.
    private(set) var playback: Playback?
    @ObservationIgnored private var finish: Task<Void, Never>?

    struct Playback: Equatable {
        let from: Double
        let started: Date
        /// Where it stops: the end of a final, or "now" in a live game.
        let end: Double
        /// Game seconds per second.
        let rate: Double

        func time(at date: Date) -> Double { min(from + max(0, date.timeIntervalSince(started)) * rate, end) }
    }

    /// Game seconds per second of replay: regulation in 24 seconds.
    nonisolated static let rate = 2880.0 / 24

    var replaying: Bool { paused != nil || playback != nil }
    var playing: Bool { playback != nil }

    /// The replay's game second at a frame's date (nil: not replaying).
    func time(at date: Date) -> Double? { playback?.time(at: date) ?? paused }

    /// Picks a player, or clears them if they're already picked.
    func togglePin(_ player: String?) {
        withAnimation(Motion.fade) { pinned = player == nil || pinned == player ? nil : player }
    }

    func unpin() {
        guard pinned != nil else { return }
        withAnimation(Motion.fade) { pinned = nil }
    }

    /// Holds the replay at `t`; at or past `end` there's nothing to replay, so
    /// it's the whole game (or live) again.
    func seek(_ t: Double, end: Double) {
        finish?.cancel()
        playback = nil
        paused = t >= end ? nil : max(0, t)
    }

    /// Runs the replay from `from` to `end`, then hands back to the whole game.
    func play(from: Double, end: Double, rate: Double = NBAStage.rate) {
        guard end - from > 1, rate > 0 else { return }
        finish?.cancel()
        paused = nil
        let run = Playback(from: from, started: .now, end: end, rate: rate)
        playback = run
        finish = Task { [weak self] in
            try? await Task.sleep(for: .seconds((end - from) / rate))
            guard !Task.isCancelled, let self, self.playback == run else { return }
            withAnimation(Motion.fade) { self.playback = nil }
        }
    }

    func pause(at date: Date = .now) {
        guard let run = playback else { return }
        finish?.cancel()
        paused = run.time(at: date)
        playback = nil
    }

    /// Back to the whole game (or live).
    func exit() {
        finish?.cancel()
        playback = nil
        paused = nil
    }

    func reset() {
        exit()
        pinned = nil
    }
}

// MARK: - Scene

/// What the court shows at a moment: the shots so far, the last few plays
/// trailing to the ball, who has it, and the score. A pure function of the
/// plays and the time, so a replay frame costs one pass over the plays.
struct CourtScene {
    enum Style: Equatable {
        /// Every shot at full strength: a final, or one player's shots.
        case chart
        /// The last plays trail to the ball; earlier shots step back.
        case trail
        /// A replay running: each shot lands as its time comes, then steps back.
        case playing
    }

    var style: Style
    /// The shots to draw (up to the replay time; one player's, if picked).
    var shots: [GameDetail.Shot]
    /// The last plays with a place on the court, oldest first.
    var trail: [GameDetail.CourtPlay] = []
    /// Who has the ball after the trail's last play (nil: unknown, or a shot in the air).
    var possession: GameDetail.Side? = nil
    /// The possession arrow: who has it, or whose shot is in the air.
    var ball = NBADetail.Ball()
    /// The shot to draw larger: the newest, in a replay or for a picked player live.
    var newest: GameDetail.Shot? = nil
    /// The newest play with a place on the court (the footer's line).
    var latest: GameDetail.CourtPlay? = nil
    /// The score at the time shown.
    var score: (top: Int, bottom: Int)? = nil

    /// How many plays trail the ball.
    static let trailLength = 8

    /// `time`: the replay's game second (nil: the whole game, or live now).
    static func make(shots allShots: [GameDetail.Shot], plays: [GameDetail.CourtPlay], time: Double?, live: Bool,
                     playing: Bool, pinned: String?) -> CourtScene {
        let upTo = time.map { plays.prefix(NBADetail.count(plays, through: $0)) } ?? plays[...]
        var shots: [GameDetail.Shot]
        if plays.isEmpty {
            shots = time.map { t in allShots.filter { ($0.elapsed ?? 0) <= t } } ?? allShots
        } else {
            shots = upTo.compactMap(GameDetail.Shot.init)
        }
        if let pinned { shots = shots.filter { $0.player == pinned } }
        let style: Style = playing ? .playing
            : pinned != nil || plays.isEmpty || (time == nil && !live) ? .chart : .trail
        var scene = CourtScene(style: style, shots: shots)
        if style == .trail {
            scene.trail = Array(upTo.filter { $0.positioned }.suffix(trailLength))
            scene.possession = NBADetail.possession(upTo)
            scene.ball = NBADetail.ball(upTo)
        }
        scene.latest = pinned == nil ? upTo.last { $0.positioned } : nil
        if time != nil || (live && pinned != nil) { scene.newest = shots.last }
        if let last = upTo.last {
            scene.score = (last.top, last.bottom)
        } else if time != nil {
            scene.score = (0, 0)
        }
        return scene
    }
}

extension GameDetail.Shot {
    /// A shot play as a shot-chart mark.
    init?(_ play: GameDetail.CourtPlay) {
        guard case let .shot(made, value) = play.kind, let x = play.x, let y = play.y else { return nil }
        self.init(id: play.id, x: x, y: y, made: made, value: value, side: play.side, player: play.player,
                  period: play.period, clock: play.clock, text: play.text, elapsed: play.elapsed,
                  typeID: play.typeID, blocker: made ? nil : play.other)
    }
}

// MARK: - Scrubber

/// A compact replay control under the court: play/pause, then a track over
/// game time with quarter ticks, then the score where the thumb is. Drag or
/// click anywhere on it to hold the replay there; at the end (or past "now"
/// in a live game) it's the whole game again. Pointing reads out the time and
/// score in the chart's footer. No keyboard shortcuts of its own: it never
/// takes keys the panel uses.
struct ReplayScrubber: View {
    /// The track's span: regulation, plus any overtime.
    let length: Double
    /// How far the replay reaches: the end of a final, now in a live game.
    let end: Double
    let live: Bool
    /// The replay's game second (nil: not replaying; the thumb rests at `end`).
    let time: Double?
    let playing: Bool
    /// "LAL 78–71" at the thumb.
    let score: String
    var onSeek: (Double) -> Void
    var onPlayPause: () -> Void
    /// The game second under the pointer, for the footer readout.
    @Binding var hover: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var periods: Int { max(4, Int(((length - 2880) / 300).rounded()) + 4) }

    var body: some View {
        HStack(spacing: 8) {
            // With Reduce Motion the replay still plays, as steps: the court
            // redraws twice a second and shots fade in where they land (no ball travel).
            Button(action: onPlayPause) {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 22, height: 22)
                    .contentShape(Circle())
            }
            .buttonStyle(ScrubberButtonStyle())
            .help(playing ? "Pause the replay" : time == nil ? "Replay the game" : "Resume the replay")
            .accessibilityLabel(playing ? "Pause replay" : time == nil ? "Replay the game" : "Resume replay")
            track
            Text(score)
                .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .foregroundStyle(time == nil ? .secondary : .primary)
                .lineLimit(1)
                // Room for "UTAH 132–123", so the track never shifts as the score changes.
                .frame(minWidth: 80, minHeight: 22, alignment: .trailing)
                .fixedSize()
                .contentTransition(.numericText())
                .accessibilityHidden(true)
        }
    }

    private var track: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let x = { (t: Double) -> CGFloat in w * CGFloat(min(max(t / max(length, 1), 0), 1)) }
            let thumb = time ?? end
            ZStack(alignment: .topLeading) {
                Canvas { context, size in
                    let mid: CGFloat = 11
                    // The game so far, and what's still to come in a live game.
                    context.fill(Path(roundedRect: CGRect(x: 0, y: mid - 1.5, width: size.width, height: 3), cornerRadius: 1.5),
                                 with: .color(Color.primary.opacity(0.10)))
                    context.fill(Path(roundedRect: CGRect(x: 0, y: mid - 1.5, width: x(end), height: 3), cornerRadius: 1.5),
                                 with: .color(Color.primary.opacity(0.16)))
                    context.fill(Path(roundedRect: CGRect(x: 0, y: mid - 1.5, width: x(thumb), height: 3), cornerRadius: 1.5),
                                 with: .color(Viz.neutral))
                    // Quarter ticks, crossing the track.
                    var ticks = Path()
                    for period in 2...periods {
                        let px = x(NBADetail.periodStart(period))
                        ticks.move(to: CGPoint(x: px, y: mid - 4))
                        ticks.addLine(to: CGPoint(x: px, y: mid + 4))
                    }
                    context.stroke(ticks, with: .color(Viz.reference), lineWidth: 1)
                    if let hover {
                        var rule = Path()
                        rule.move(to: CGPoint(x: x(hover), y: mid - 6))
                        rule.addLine(to: CGPoint(x: x(hover), y: mid + 6))
                        context.stroke(rule, with: .color(Color.primary.opacity(0.5)), lineWidth: 1)
                    }
                    // Live: the red "now" dot at the live edge (the app's live mark).
                    if live {
                        let r: CGFloat = time == nil ? 4 : 3
                        context.fill(Path(ellipseIn: CGRect(x: x(end) - r, y: mid - r, width: r * 2, height: r * 2)), with: .color(.red))
                    }
                    if !(live && time == nil) {
                        let r: CGFloat = 4.5
                        context.fill(Path(ellipseIn: CGRect(x: x(thumb) - r, y: mid - r, width: r * 2, height: r * 2)),
                                     with: .color(.primary))
                    }
                }
                .frame(height: 22)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                // Within a few points of the end is the end: the whole game, or live.
                let px = min(max(value.location.x, 0), w)
                onSeek(px >= x(end) - 3 ? end : Double(px / max(w, 1)) * length)
            })
            .onContinuousHover { phase in
                if case let .active(location) = phase, w > 0 {
                    let t = min(Double(location.x / w) * length, end)
                    hover = max(0, t)
                } else {
                    hover = nil
                }
            }
        }
        .frame(height: 22)
        .accessibilityElement()
        .accessibilityLabel("Replay")
        .accessibilityValue(time.map { "\(NBADetail.clockLabel(at: $0)), \(score)" } ?? (live ? "Live, \(score)" : "Whole game, \(score)"))
        .accessibilityAdjustableAction { direction in
            let step = 60.0
            let from = time ?? end
            switch direction {
            case .increment: onSeek(min(from + step, end))
            case .decrement: onSeek(max(from - step, 0))
            @unknown default: break
            }
        }
    }
}

/// The play button's feel: a faint disc on hover (at once, the house rule),
/// a press that gives (0.97, like every other button).
private struct ScrubberButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Hovered { hovering in
            configuration.label
                .background(Circle().fill(Color.primary.opacity(configuration.isPressed ? 0.14 : hovering ? 0.08 : 0)))
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(Motion.press, value: configuration.isPressed)
        }
    }

    private struct Hovered<Content: View>: View {
        @ViewBuilder let content: (Bool) -> Content
        @State private var hovering = false
        var body: some View {
            content(hovering)
                .onHover { hovering = $0 }
        }
    }
}

// MARK: - Ball

/// The ball at the newest play. It glides from play to play (one spring per
/// new play; nothing runs between them). Who has it is the possession arrow's
/// job, at center court: one indicator, where nothing else is drawn. While a
/// shot story carries the ball to the rim, this one steps aside.
struct CourtBall: View {
    let point: CGPoint
    /// Glide to new spots (off while scrubbing, and with Reduce Motion).
    var glides = true

    var body: some View {
        ZStack {
            // A thin panel-colored ring keeps the ball off the trail beneath
            // (no blend-mode knockout: it would punch through the glass).
            Circle()
                .fill(Color(nsColor: .windowBackgroundColor))
                .frame(width: 10, height: 10)
            Circle()
                .fill(Color.primary)
                .frame(width: 7, height: 7)
        }
        .position(point)
        .animation(glides ? Motion.travel : nil, value: point)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Picked player

/// The picked player in a chart's footer: a quiet chip with their name and a
/// clear button, then their line, and (when the page can open one) a quiet
/// "Profile ›" link at the end. Where room is short the first name goes
/// (the surname stays), then the replay's moment, then the threes; then the
/// line truncates, never the name.
/// In the linked peek the chip is text only (no ×) and there's no link.
struct PinnedPlayerLine: View {
    let name: String
    let line: String
    /// The line without the threes ("9 of 16, 25 PTS"), for where it doesn't fit.
    var shortLine: String? = nil
    /// In a replay, the moment the line is as of ("Q3 6:00"): shown where it fits.
    var when: String? = nil
    /// Straight makes, live: `NBADetail.fireStreak` or more puts a flame by the name.
    var streak = 0
    /// Opens the player's page. Nil: no link.
    var onProfile: (() -> Void)? = nil
    /// Clears the pick (the chip's ×). Nil: the chip is just the name.
    var onClear: (() -> Void)?

    init(name: String, line: String, shortLine: String? = nil, when: String? = nil, streak: Int = 0,
         onProfile: (() -> Void)? = nil, onClear: (() -> Void)?) {
        self.name = name
        self.line = line
        self.shortLine = shortLine
        self.when = when
        self.streak = streak
        self.onProfile = onProfile
        self.onClear = onClear
    }

    var body: some View {
        let short = NBADetail.lastName(name)
        HStack(spacing: 6) {
            ViewThatFits(in: .horizontal) {
                if let when {
                    row(name, line + " · " + when).fixedSize()
                    if short != name { row(short, line + " · " + when).fixedSize() }
                }
                row(name, line).fixedSize()
                if short != name { row(short, line).fixedSize() }
                if let shortLine {
                    row(name, shortLine).fixedSize()
                    if short != name { row(short, shortLine).fixedSize() }
                }
                row(short, shortLine ?? line)
            }
            if let onProfile {
                Spacer(minLength: 6)
                ProfileLink(name: name, action: onProfile)
            }
        }
        .padding(.top, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ name: String, _ line: String) -> some View {
        HStack(spacing: 6) {
            HStack(spacing: 3) {
                Text(name).font(.system(size: 10.5, weight: .semibold)).lineLimit(1)
                if streak >= NBADetail.fireStreak { StreakFlame(help: "\(streak) straight makes") }
                if let onClear {
                    Button(action: onClear) {
                        Image(systemName: "xmark")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(.secondary)
                            .frame(width: 12, height: 12)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .help("Show every player")
                    .accessibilityLabel("Show every player")
                }
            }
            .padding(.leading, 7)
            .padding(.trailing, onClear == nil ? 7 : 3)
            .padding(.vertical, 2)
            .background(Capsule().fill(Viz.highlight))
            .overlay(Capsule().strokeBorder(Color.accentColor.opacity(0.25), lineWidth: 0.5))
            .fixedSize()
            .layoutPriority(1)
            Text(line)
                .font(.system(size: 10.5).monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }
}

/// The picked player's quiet link to their page ("Profile ›"): secondary,
/// brighter on hover, like a tier header's "Schedule ›".
struct ProfileLink: View {
    let name: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 2) {
                Text("Profile")
                Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold))
            }
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(hovering ? .primary : .secondary)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Hover is instant (the house rule), as in `SectionLink`.
        .onHover { hovering = $0 }
        .fixedSize()
        .help("Open \(name)'s player page")
        .accessibilityLabel("\(name), player page")
    }
}
