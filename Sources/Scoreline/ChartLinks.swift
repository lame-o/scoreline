import SwiftUI

// A row's "Show on {chart}" for VoiceOver: the section that lights a focus
// (a play, a player, a period, a climber), so the action can pin it and bring
// that chart into view. Pure routing, tested; the page builds the inputs.

/// What the page has that a focus can land on, by section.
struct ChartLinkInputs {
    /// A mark a focus can match.
    struct Mark {
        var id: String
        var period: Int? = nil
        var side: GameDetail.Side? = nil
        var player: String? = nil
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
    /// Climbing: who's on the ascent route, the wall's routes, the scorecard (athlete ID as `id`).
    var ascent: [Mark] = []
    var wall: [Mark] = []
    var cards: [Mark] = []
}

enum ChartLinks {
    /// The section that will actually light something for `focus`, by the
    /// sport's priority, or nil (never a guess).
    static func target(for focus: Focus, sport ref: EventRef?, inputs: ChartLinkInputs) -> DetailView.Section? {
        func shown(_ s: DetailView.Section) -> Bool { inputs.shown.contains(s) }
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
    private static func lights(_ shot: ChartLinkInputs.Mark, _ focus: Focus) -> Bool {
        if let play = focus.play { return shot.id == play }
        if let player = focus.player { return shot.player == player }
        if let period = focus.period { return shot.period == period && (focus.side == nil || shot.side == focus.side) }
        return false
    }
}

// MARK: - The action

/// What a row's "Show on {chart}" action does: the page knows which chart a
/// focus lights, and pins and scrolls to it.
struct ShowOnChartAction {
    let title: (Focus) -> String?
    let perform: (Focus) -> Void
}

private struct ShowOnChartKey: EnvironmentKey {
    /// Computed: a stored default of a non-Sendable type is shared mutable state.
    static var defaultValue: ShowOnChartAction? { nil }
}

extension EnvironmentValues {
    var showOnChart: ShowOnChartAction? {
        get { self[ShowOnChartKey.self] }
        set { self[ShowOnChartKey.self] = newValue }
    }
}

extension View {
    /// VoiceOver's way from a row to the chart it lights: "Show on Shot
    /// Chart" pins this row's focus and brings the chart into view.
    func showOnChartAction(_ focus: Focus) -> some View { modifier(ShowOnChart(focus: focus)) }
}

private struct ShowOnChart: ViewModifier {
    let focus: Focus
    @Environment(\.showOnChart) private var show

    func body(content: Content) -> some View {
        content.accessibilityActions {
            if let show, let title = show.title(focus) {
                Button("Show on \(title)") { show.perform(focus) }
            }
        }
    }
}
