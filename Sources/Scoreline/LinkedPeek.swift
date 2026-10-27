import AppKit
import SwiftUI

// The peek: when a hover or a pin lights something in a chart that's out of
// view, a small live copy of that chart, showing the same highlight, docks at
// the edge of the viewport on the side the chart is on. It waits for hover
// intent, then follows the pointer at once; it never covers the row under the
// pointer (it takes the other edge, its chevron still pointing at the chart);
// it holds while the pointer is on it; a click pins the focus and scrolls to
// the real chart. On a two-column page it's the chart at full size in its own
// column, docked only while it's needed. A short viewport gets a one-line
// readout pill instead.
//
// Nothing here draws a chart: the host lays out the page's own chart views
// (the same initializers, the same LinkedFocus) in a peek environment.

// MARK: - Router (pure, tested)

/// What the page has that a focus can land on, by section.
struct PeekInputs {
    /// A mark a focus can match, with its readout.
    struct Mark {
        var id: String
        var period: Int? = nil
        var side: GameDetail.Side? = nil
        var player: String? = nil
        var lead: String = ""
        var detail: String = ""
    }

    /// The sections on the page right now.
    var shown: Set<DetailView.Section> = []
    /// Soccer: the pitch's shots, cards and (live) recent actions, by play ID.
    var pitch: [Mark] = []
    /// Soccer: the timeline's goals and cards.
    var timeline: [Mark] = []
    /// Baseball: balls in play.
    var balls: [Mark] = []
    /// NBA: every shot on the court.
    var shots: [Mark] = []
    /// NBA: the game flow's scoring points.
    var flow: [Mark] = []
    /// NBA: player names by athlete ID.
    var names: [String: String] = [:]
    /// NBA: a player's shooting as the court's footer says it (the box
    /// score's line: "6 of 13, 3 of 8 from three"), by athlete ID.
    var lines: [String: String] = [:]
    /// The linescore: period headers and each team's row, with names.
    var linescore: (headers: [String], top: [String], bottom: [String], names: (top: String, bottom: String))? = nil
    /// Climbing: who's on the ascent route, the wall's routes, the scorecard (athlete ID as `id`).
    var ascent: [Mark] = []
    var wall: [Mark] = []
    var cards: [Mark] = []
}

enum PeekRouter {
    /// Sections whose rows point at a chart elsewhere on the page. Hovering a
    /// chart's own marks never peeks: its footer already reads them out.
    static let sources: Set<DetailView.Section> = [.moments, .linescore, .box, .leaders, .results, .startlist]

    /// The section that will actually light something for `focus`, by the
    /// sport's priority, or nil (never a guess). `source` is the section
    /// under the pointer, when known (a pin has none).
    static func target(for focus: Focus, sport ref: EventRef?, state: EventState, inputs: PeekInputs,
                       source: DetailView.Section? = nil) -> DetailView.Section? {
        if let source, !sources.contains(source) { return nil }
        func shown(_ s: DetailView.Section) -> Bool { inputs.shown.contains(s) && s != source }
        switch ref {
        case .espn(_, _, .soccer)?:
            guard let play = focus.play else { return nil }
            if shown(.pitch), inputs.pitch.contains(where: { $0.id == play }) { return .pitch }
            if shown(.timeline), inputs.timeline.contains(where: { $0.id == play }) { return .timeline }
            return nil
        case .espn(_, _, .baseball)?:
            if shown(.battedBalls), inputs.balls.contains(where: { focus.matches(play: $0.id, period: $0.period, side: $0.side) }) {
                return .battedBalls
            }
            if shown(.linescore), focus.period != nil { return .linescore }
            return nil
        case let .espn(path, _, .basketball)? where path == NBADetail.path:
            if shown(.court), inputs.shots.contains(where: { lights($0, focus) }) { return .court }
            if shown(.flow), let play = focus.play, inputs.flow.contains(where: { $0.id == play }) || focus.period != nil {
                return .flow
            }
            return nil
        case .espn(_, _, .football)?:
            return shown(.linescore) && focus.period != nil ? .linescore : nil
        case .climbing?:
            guard let id = focus.athlete.map(String.init) else { return nil }
            if shown(.ascent), inputs.ascent.contains(where: { $0.id == id }) { return .ascent }
            if shown(.wall), inputs.wall.contains(where: { $0.id == id }) { return .wall }
            if shown(.scorecard), inputs.cards.contains(where: { $0.id == id }) { return .scorecard }
            return nil
        default:
            return nil
        }
    }

    /// Whether a court shot lights for a focus (`CourtView.lit`): one play;
    /// else a player's shots; else a period's (for one team, if given).
    private static func lights(_ shot: PeekInputs.Mark, _ focus: Focus) -> Bool {
        if let play = focus.play { return shot.id == play }
        if let player = focus.player { return shot.player == player }
        if let period = focus.period { return shot.period == period && (focus.side == nil || shot.side == focus.side) }
        return false
    }

    /// The target chart's readout for a focus, as its footer would say it:
    /// the value first, then what it was. For the short-viewport pill.
    static func readout(for focus: Focus, target: DetailView.Section, inputs: PeekInputs) -> (lead: String, detail: String)? {
        func mark(_ marks: [PeekInputs.Mark], _ id: String?) -> (lead: String, detail: String)? {
            guard let id, let m = marks.first(where: { $0.id == id }) else { return nil }
            return (m.lead, m.detail)
        }
        switch target {
        case .pitch: return mark(inputs.pitch, focus.play)
        case .timeline: return mark(inputs.timeline, focus.play)
        case .battedBalls:
            guard let ball = inputs.balls.first(where: { focus.matches(play: $0.id, period: $0.period, side: $0.side) }) else { return nil }
            let count = inputs.balls.filter { focus.matches(play: $0.id, period: $0.period, side: $0.side) }.count
            return focus.play == nil ? (periodName(focus.period, baseball: true), "\(count) in play") : (ball.lead, ball.detail)
        case .court:
            let lit = inputs.shots.filter { lights($0, focus) }
            if focus.play != nil { return lit.first.map { ($0.lead, $0.detail) } }
            let made = lit.filter { $0.lead.hasPrefix("Made") }.count
            let line = "\(made) of \(plural(lit.count, "shot"))"
            if let player = focus.player { return (inputs.names[player] ?? "Player", inputs.lines[player] ?? line) }
            return (periodName(focus.period, baseball: false), line)
        case .flow:
            return mark(inputs.flow, focus.play) ?? focus.period.map { (periodName($0, baseball: false), "") }
        case .linescore:
            guard let line = inputs.linescore, let period = focus.period, period >= 1, period <= line.top.count else { return nil }
            let header = line.headers.indices.contains(period - 1) ? line.headers[period - 1] : "\(period)"
            let top = line.top.indices.contains(period - 1) ? line.top[period - 1] : "–"
            let bottom = line.bottom.indices.contains(period - 1) ? line.bottom[period - 1] : "–"
            return (Int(header) != nil ? periodName(period, baseball: inputs.linescore?.headers.contains("R") ?? false) : header,
                    "\(line.names.top) \(top) · \(line.names.bottom) \(bottom)")
        case .ascent: return mark(inputs.ascent, focus.athlete.map(String.init))
        case .wall: return mark(inputs.wall, focus.athlete.map(String.init))
        case .scorecard: return mark(inputs.cards, focus.athlete.map(String.init))
        default: return nil
        }
    }

    /// "7th inning"; "Q3", "OT", "2OT" (one rule with every other surface).
    private static func periodName(_ period: Int?, baseball: Bool) -> String {
        guard let period else { return "" }
        return baseball ? "\(Ordinal.string(period)) inning" : Period.label(period, sport: .basketball)
    }
}

// MARK: - Timing (state machine, tested)

/// The peek's clock: real time in the app, a hand-moved one in tests.
struct PeekClock {
    var now: () -> ContinuousClock.Instant
    /// Runs `action` after `delay`; returns a cancel.
    var after: (Duration, @escaping @MainActor () -> Void) -> () -> Void

    @MainActor static var live: PeekClock {
        PeekClock(now: { .now }, after: { delay, action in
            let task = Task { @MainActor in
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { return }
                action()
            }
            return { task.cancel() }
        })
    }
}

/// When the peek shows, where it docks and when it goes. Inputs come from the
/// host on every change; timers are owned here and cancelled on every state
/// change, never stacked.
///
/// idle → pending (260ms of intent, not restarted as the pointer crosses rows)
/// → showing → (focus gone for 220ms, the chart in view, no target) → idle.
/// A pin shows at once, and so does anything after the first peek of a hover.
@MainActor
@Observable
final class PeekController {
    enum Dock: Equatable, Sendable { case top, bottom }

    struct Presentation: Equatable {
        var section: DetailView.Section
        /// The viewport edge it's docked at.
        var dock: Dock
        /// Where the real chart is: the chevron's direction.
        var points: PageGeometry.Edge
    }

    struct Input: Equatable {
        /// What charts show: the hover, else the pin.
        var focus: Focus?
        /// Nothing hovered: the focus is a pin.
        var pinned = false
        var target: DetailView.Section?
        var visibility: PageGeometry.Visibility?
        /// The pointer is on the peek.
        var held = false
        /// Live resize or the page's entrance.
        var blocked = false
    }

    static let intent: Duration = .milliseconds(260)
    static let grace: Duration = .milliseconds(220)

    private(set) var presented: Presentation?
    /// Bumped when a clicked peek's chart arrives in view: its border flashes once.
    private(set) var arrivals: [DetailView.Section: Int] = [:]

    @ObservationIgnored var clock = PeekClock.live
    /// Whether the pointer is in a dock edge's band (the peek's height plus 12pt).
    @ObservationIgnored var pointerInBand: (Dock) -> Bool = { _ in false }
    /// The page section under the pointer (set by the sections' hover).
    @ObservationIgnored private(set) var pointerSection: DetailView.Section?
    @ObservationIgnored private(set) var input = Input()
    @ObservationIgnored private var pendingSince: ContinuousClock.Instant?
    @ObservationIgnored private var intentTimer: (() -> Void)?
    @ObservationIgnored private var graceTimer: (() -> Void)?
    /// A peek has shown during this hover: the next one needs no wait.
    @ObservationIgnored private var warm = false
    @ObservationIgnored private var lastFocus: Focus?
    @ObservationIgnored private var awaiting: DetailView.Section?
    /// The page's focus right now (the host is gone while nothing is
    /// focused, so a waiting timer asks rather than trusting its last input).
    @ObservationIgnored private var liveFocus: (() -> Focus?)?

    /// Something is focused again after nothing was (the host appears): a
    /// fresh hover waits for intent again.
    func begin(liveFocus: @escaping () -> Focus?) {
        self.liveFocus = liveFocus
        guard presented == nil else { return }
        cancelIntent()
        cancelGrace()
        pendingSince = nil
        lastFocus = nil
        warm = false
    }

    func update(_ next: Input) {
        input = next
        evaluate()
    }

    func pointer(_ section: DetailView.Section, inside: Bool) {
        if inside { pointerSection = section } else if pointerSection == section { pointerSection = nil }
    }

    /// The peek was clicked: flash the chart once it's in view.
    func expectArrival(_ section: DetailView.Section) { awaiting = section }

    private func evaluate() {
        let i = input
        if i.blocked {
            cancelIntent()
            cancelGrace()
            pendingSince = nil
            // At once, no exit: the panel is being resized.
            if presented != nil {
                var instant = Transaction()
                instant.disablesAnimations = true
                withTransaction(instant) { presented = nil }
            }
            return
        }
        guard let focus = i.focus else {
            cancelIntent()
            pendingSince = nil
            guard presented != nil else {
                warm = false
                cancelGrace()
                return
            }
            // Crossing the gap between rows doesn't flicker; the peek under the pointer stays.
            if i.held { cancelGrace(); return }
            if graceTimer == nil {
                graceTimer = clock.after(Self.grace) { [weak self] in self?.graceEnded() }
            }
            return
        }
        cancelGrace()
        let focusChanged = focus != lastFocus
        lastFocus = focus
        guard let target = i.target, let visibility = i.visibility else {
            cancelIntent()
            pendingSince = nil
            hide()
            return
        }
        switch visibility {
        case .visible:
            cancelIntent()
            pendingSince = nil
            hide()
            if awaiting == target {
                arrivals[target, default: 0] += 1
                awaiting = nil
            }
        case .partial:
            // 40–60% in view: keep doing whatever it was doing (hysteresis).
            if let p = presented, p.section != target {
                presented = Presentation(section: target, dock: p.dock, points: p.points)
            }
        case let .hidden(edge):
            if let p = presented {
                // The same chart: the highlight inside updates; nothing re-enters.
                // The edge is chosen again only for a new focus or a new side.
                guard p.section != target || p.points != edge || focusChanged else { return }
                let dock = focusChanged || p.points != edge ? chooseDock(edge) : p.dock
                presented = Presentation(section: target, dock: dock, points: edge)
            } else if i.pinned || warm {
                show(target, edge)
            } else if let since = pendingSince {
                if clock.now() - since >= Self.intent { show(target, edge) }
            } else {
                pendingSince = clock.now()
                intentTimer = clock.after(Self.intent) { [weak self] in
                    guard let self else { return }
                    intentTimer = nil
                    // Left before it showed (the host is gone): nothing to show.
                    if let liveFocus, liveFocus() == nil {
                        pendingSince = nil
                        input = Input()
                        return
                    }
                    evaluate()
                }
            }
        }
    }

    private func show(_ target: DetailView.Section, _ edge: PageGeometry.Edge) {
        cancelIntent()
        pendingSince = nil
        warm = true
        presented = Presentation(section: target, dock: chooseDock(edge), points: edge)
    }

    private func hide() {
        if presented != nil { presented = nil }
    }

    private func graceEnded() {
        graceTimer = nil
        guard input.focus == nil, !input.held else { return }
        hide()
        warm = false
    }

    /// The chart's own side, unless the pointer is in that edge's band (the
    /// peek would cover the row being read): then the other edge.
    private func chooseDock(_ edge: PageGeometry.Edge) -> Dock {
        let preferred: Dock = edge == .above ? .top : .bottom
        return pointerInBand(preferred) ? (preferred == .top ? .bottom : .top) : preferred
    }

    private func cancelIntent() {
        intentTimer?()
        intentTimer = nil
    }

    private func cancelGrace() {
        graceTimer?()
        graceTimer = nil
    }
}

// MARK: - Layout and motion

enum PeekLayout {
    enum Mode: Equatable { case compact, column, pill }

    /// Under 360pt tall a chart would cover too much: a readout pill.
    static func mode(viewport: CGSize, split: Bool) -> Mode {
        viewport.height < 360 ? .pill : split ? .column : .compact
    }

    /// A compact peek's plot height: at most 150, never a third of the viewport.
    static func plotHeight(_ viewport: CGSize) -> CGFloat { min(150, 0.32 * viewport.height) }

    /// Header and the plate's insets around the chart.
    static let chrome: CGFloat = 32

    /// The most a compact peek's chart may take: the plot plus a footer line
    /// once charts drop their footers in a peek (`\.chartPeek`); until then a
    /// little more, so a chart's own footer isn't cut mid-line.
    static func chartCap(_ viewport: CGSize) -> CGFloat { max(plotHeight(viewport) + 24, 0.42 * viewport.height) }

    /// Compact width: the chart's aspect at the plot height (full width
    /// without one), at least 180, inside the viewport's 10pt margins.
    static func compactWidth(_ viewport: CGSize, aspect: CGFloat?) -> CGFloat {
        let full = max(viewport.width - 20, 0)
        guard let aspect else { return full }
        return min(full, max(180, plotHeight(viewport) * aspect + 20))
    }

    /// The tallest the card gets, for the pointer band.
    static func height(_ viewport: CGSize, mode: Mode) -> CGFloat {
        switch mode {
        case .compact: plotHeight(viewport) + chrome
        case .column: 0.45 * viewport.height + chrome
        case .pill: 26
        }
    }
}

enum PeekMotion {
    /// Enter: 12pt from the docked edge on `Motion.standard`; opacity and
    /// 0.97 → 1 scale on `Motion.fade`. A plain fade with Reduce Motion.
    /// Exit: faster than the entrance (`Motion.exit`), 8pt toward the edge.
    /// (Sampled frame by frame in the tests.)
    static func transition(_ dock: PeekController.Dock, reduceMotion: Bool) -> AnyTransition {
        let sign: CGFloat = dock == .top ? -1 : 1
        if reduceMotion {
            return .asymmetric(insertion: AnyTransition.opacity.animation(Motion.fade), removal: .opacity.animation(Motion.exit))
        }
        let anchor: UnitPoint = dock == .top ? .top : .bottom
        let insertion = AnyTransition.offset(y: 12 * sign).animation(Motion.standard)
            .combined(with: AnyTransition.opacity.combined(with: .scale(scale: 0.97, anchor: anchor)).animation(Motion.fade))
        let removal = AnyTransition.opacity.combined(with: .offset(y: 8 * sign)).animation(Motion.exit)
        return .asymmetric(insertion: insertion, removal: removal)
    }

    /// The arrival flash on the real chart: accent 0.5 → 0 over `Motion.ping`'s 0.6 s.
    @KeyframesBuilder<Double>
    static func flash() -> some Keyframes<Double> {
        KeyframeTrack {
            MoveKeyframe(0.5)
            LinearKeyframe(0, duration: 0.6, timingCurve: Motion.curve)
        }
    }
}

// MARK: - Host

/// An overlay on the match page's scroll view: the peek card (or pill) while
/// one is presented, nothing otherwise. It reads the page's focus, geometry
/// and pin, and asks the page for the route and the chart.
struct LinkedPeekHost<Content: View>: View {
    let controller: PeekController
    /// The section a focus lights (`PeekRouter.target`), given the section under the pointer.
    let route: (Focus, DetailView.Section?) -> DetailView.Section?
    let readout: (Focus, DetailView.Section) -> (lead: String, detail: String)?
    let title: (DetailView.Section) -> String
    /// The chart's width-to-height ratio; nil for full-width charts.
    let aspect: (DetailView.Section) -> CGFloat?
    /// The page's chart for a section, for a focus (row excerpts filter by it).
    @ViewBuilder let content: (DetailView.Section, Focus?) -> Content

    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @Environment(NBAStage.self) private var stage: NBAStage?
    @Environment(\.pageGeometry) private var geometry
    @Environment(\.panelResizing) private var resizing
    @Environment(\.panelLayout) private var layout
    @Environment(\.stackArrival) private var arrival
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scoreboardSurface) private var surface
    @State private var hovering = false
    @State private var probe = PointerProbe.Box()

    var body: some View {
        let hovered = linked?.hovered
        let focus = hovered ?? linked?.pinned ?? stage?.pinned.map { Focus(player: $0) }
        // Nothing pointed at or pinned, and nothing on show: nothing installed.
        if focus == nil, controller.presented == nil {
            EmptyView()
        } else {
            active(focus: focus, hovered: hovered)
        }
    }

    @ViewBuilder
    private func active(focus: Focus?, hovered: Focus?) -> some View {
        let input = input(focus: focus, hovered: hovered)
        Color.clear
            .allowsHitTesting(false)
            .overlay {
                if let p = controller.presented, let geometry {
                    card(p, geometry, focus: focus)
                }
            }
            // Where the pointer is, read only when the peek picks an edge.
            .background { PointerProbe(box: probe).allowsHitTesting(false) }
            .onAppear {
                let linked = linked, stage = stage, probe = probe, geometry = geometry
                controller.begin { linked?.hovered ?? linked?.pinned ?? stage?.pinned.map { Focus(player: $0) } }
                controller.pointerInBand = { dock in
                    guard let geometry, let y = PointerProbe.pointerY(probe) else { return false }
                    let viewport = geometry.viewport
                    let band = PeekLayout.height(viewport, mode: PeekLayout.mode(viewport: viewport, split: probe.split)) + 12
                    return dock == .top ? y < band : y > viewport.height - band
                }
                controller.update(input)
            }
            .onChange(of: input) { _, next in controller.update(next) }
            .onChange(of: layout.split, initial: true) { _, split in probe.split = split }
    }

    private func input(focus: Focus?, hovered: Focus?) -> PeekController.Input {
        let blocked = resizing || (arrival.map { Date().timeIntervalSince($0.date) < 0.35 } ?? false)
        guard let focus else { return PeekController.Input(held: hovering, blocked: blocked) }
        let target = route(focus, hovered != nil ? controller.pointerSection : nil)
        return PeekController.Input(focus: focus, pinned: hovered == nil, target: target,
                                    visibility: target.flatMap { geometry?.visibility[sectionID($0)] },
                                    held: hovering, blocked: blocked)
    }

    private var isPinned: Bool { linked?.pinned != nil || stage?.pinned != nil }

    @ViewBuilder
    private func card(_ p: PeekController.Presentation, _ g: PageGeometry, focus: Focus?) -> some View {
        let viewport = g.viewport
        let mode = PeekLayout.mode(viewport: viewport, split: layout.split)
        // Below the docked scorebar once it's there.
        let topInset: CGFloat = 6 + (surface?.current == .bar ? DockedScorebar.height + 4 : 0)
        let section = g.frames[sectionID(p.section)]
        let alignment: Alignment = switch (mode, p.dock) {
        case (.column, .top): .topLeading
        case (.column, .bottom): .bottomLeading
        case (_, .top): .topTrailing
        case (_, .bottom): .bottomTrailing
        }
        Group {
            switch mode {
            case .pill:
                PeekPill(points: p.points, readout: focus.flatMap { readout($0, p.section) } ?? (title(p.section), ""))
            case .compact:
                PeekCard(title: title(p.section), points: p.points, pinned: isPinned, onUnpin: unpin) {
                    chart(p.section, focus: focus, width: PeekLayout.compactWidth(viewport, aspect: aspect(p.section)) - 20,
                          maxHeight: PeekLayout.chartCap(viewport), widthClass: .compact)
                }
                .frame(width: PeekLayout.compactWidth(viewport, aspect: aspect(p.section)))
            case .column:
                let width = max((section?.width ?? viewport.width / 2) - 2 * Metrics.gutter, 180)
                PeekCard(title: title(p.section), points: p.points, pinned: isPinned, onUnpin: unpin) {
                    chart(p.section, focus: focus, width: width - 20, maxHeight: 0.45 * viewport.height, widthClass: layout.column)
                }
                .frame(width: width)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { click(p, focus: focus) }
        .onHover { inside in
            hovering = inside
            linked?.hold(inside)
        }
        // Removed under the pointer (clicked, or its chart scrolled into view),
        // the card never hears the pointer leave: let go of the hold here, or
        // the page's hover could never clear again.
        .onDisappear {
            guard hovering else { return }
            hovering = false
            linked?.hold(false)
        }
        .help("Show the \(title(p.section))")
        .padding(.top, p.dock == .top ? topInset : 0)
        .padding(.bottom, p.dock == .bottom ? 6 : 0)
        .padding(.leading, mode == .column ? (section?.minX ?? 0) + Metrics.gutter : 0)
        .padding(.trailing, mode == .column ? 0 : 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
        .animation(reduceMotion ? nil : Motion.quick, value: topInset)
        // A new edge is a new peek: out at the old edge, in at the new one.
        .id(p.dock)
        .transition(PeekMotion.transition(p.dock, reduceMotion: reduceMotion))
        // VoiceOver users don't hover: the rows carry "Show on …" instead.
        .accessibilityHidden(true)
    }

    /// The page's chart in the peek's environment: same focus and NBA stage,
    /// no moments, celebrations, entrances or hit targets.
    private func chart(_ section: DetailView.Section, focus: Focus?, width: CGFloat, maxHeight: CGFloat,
                       widthClass: WidthClass) -> some View {
        content(section, focus)
            .id(section)
            .transition(.opacity.animation(Motion.fade))
            // Laid out at its own height for the width (charts size from
            // width), never squeezed into a shorter proposal; a cap clips the rest.
            .frame(width: width)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxHeight: maxHeight, alignment: .top)
            .clipped()
            // A new section's chart resizes the card; with Reduce Motion it just changes.
            .animation(reduceMotion ? nil : Motion.quick, value: section)
            .environment(\.chartPeek, true)
            .environment(\.celebrationLevel, .off)
            .environment(PeekInert.moments)
            .environment(\.stackArrival, nil)
            .environment(\.panelResizing, false)
            .environment(\.widthClass, widthClass)
            .allowsHitTesting(false)
    }

    private func click(_ p: PeekController.Presentation, focus: Focus?) {
        // A hover-only focus is pinned, so the highlight survives the scroll.
        if let hovered = linked?.hovered {
            if let player = hovered.player, p.section == .court, let stage {
                if stage.pinned != player { stage.togglePin(player) }
            } else {
                linked?.pin(hovered)
            }
        }
        controller.expectArrival(p.section)
        geometry?.scroll(toSection: sectionID(p.section), topInset: PageGeometry.dockInset + 8, animated: !reduceMotion)
    }

    private func unpin() {
        if linked?.unpin() != true { stage?.unpin() }
    }
}

@MainActor
enum PeekInert {
    /// A moment center nothing offers to: no captions or moment animations in a peek.
    static let moments = MomentCenter()
}

/// The compact (or column) peek: regular glass with a solid plate under the
/// chart (charts drawn straight on glass wash out), a header naming the chart
/// with a chevron toward it, and an unpin chip while pinned.
struct PeekCard<Chart: View>: View {
    let title: String
    let points: PageGeometry.Edge
    let pinned: Bool
    var onUnpin: () -> Void = {}
    @ViewBuilder let chart: Chart
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: points == .above ? "chevron.up" : "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                Text(title).textCase(.uppercase)
                    .font(.system(size: 9.5, weight: .semibold))
                    .tracking(0.5)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if pinned {
                    Button(action: onUnpin) {
                        Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                            .frame(width: 14, height: 14)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .help("Unpin")
                }
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 9)
            .frame(height: 22)
            chart
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color(nsColor: .windowBackgroundColor)))
                .overlay {
                    if contrast == .increased {
                        RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.primary.opacity(0.25), lineWidth: 0.5)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 4)
        }
        .floatingGlass(in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A short viewport's peek: the chevron and the chart's readout in a capsule.
struct PeekPill: View {
    let points: PageGeometry.Edge
    let readout: (lead: String, detail: String)

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: points == .above ? "chevron.up" : "chevron.down")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
            (Text(readout.lead).fontWeight(.semibold).foregroundStyle(.primary)
                + Text(readout.detail.isEmpty ? "" : "  \(readout.detail)").foregroundStyle(.secondary))
                .font(.system(size: 10.5).monospacedDigit())
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .frame(height: 26)
        .floatingGlass(in: Capsule())
    }
}

/// The pointer's place in the peek host, read at decision time (no
/// per-move tracking).
struct PointerProbe: NSViewRepresentable {
    final class Box {
        weak var view: NSView?
        var split = false
    }

    let box: Box

    func makeNSView(context: Context) -> NSView {
        // Spans the whole scroll view: it must never take a click, scroll or hover.
        let view = PassThroughView()
        box.view = view
        return view
    }

    func updateNSView(_ view: NSView, context: Context) { box.view = view }

    /// The pointer's y from the host's top, while it's over the host (a
    /// pointer elsewhere is in no band).
    @MainActor static func pointerY(_ box: Box) -> CGFloat? {
        guard let view = box.view, let window = view.window else { return nil }
        let p = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
        guard view.bounds.contains(p) else { return nil }
        return view.isFlipped ? p.y : view.bounds.height - p.y
    }
}

// MARK: - The real chart's arrival flash

/// The clicked peek's chart, arriving in view: its border flashes the accent
/// once (color only, so it plays with Reduce Motion too).
struct PeekArrivalFlash: View {
    let controller: PeekController
    let section: DetailView.Section

    var body: some View {
        OneShot(trigger: controller.arrivals[section] ?? 0) { PeekMotion.flash() } content: { o in
            if o > 0.001 {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(o), lineWidth: 1.5)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Accessibility: "Show on …"

/// What a row's "Show on {chart}" action does: the page knows which chart a
/// focus lights, and pins and scrolls to it.
struct PeekShowAction {
    let title: (Focus) -> String?
    let perform: (Focus) -> Void
}

private struct PeekShowKey: EnvironmentKey {
    /// Computed: a stored default of a non-Sendable type is shared mutable state.
    static var defaultValue: PeekShowAction? { nil }
}

extension EnvironmentValues {
    var peekShow: PeekShowAction? {
        get { self[PeekShowKey.self] }
        set { self[PeekShowKey.self] = newValue }
    }
}

extension View {
    /// VoiceOver's way to the correlation the peek shows: "Show on Shot
    /// Chart" pins this row's focus and brings the chart into view.
    func showOnChartAction(_ focus: Focus) -> some View { modifier(ShowOnChart(focus: focus)) }
}

private struct ShowOnChart: ViewModifier {
    let focus: Focus
    @Environment(\.peekShow) private var show

    func body(content: Content) -> some View {
        content.accessibilityActions {
            if let show, let title = show.title(focus) {
                Button("Show on \(title)") { show.perform(focus) }
            }
        }
    }
}
