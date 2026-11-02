import SwiftUI

/// The timeline and odds remain independent, movable modules. They share
/// only inspection state, chronology, domain and plot insets.
struct MatchTimelineSection: View {
    let history: MatchHistory
    let baseline: OddsBaseline?
    let feed: OddsFeed
    let event: Event
    let names: (top: String, bottom: String)
    let palette: TeamPalette
    let pointer: OddsPointer
    var presentation: PresentationClock? = nil
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?

    var body: some View {
        Group {
            if let clock = presentation {
                TimelineView(.explicit(OddsSection.schedule(feed.series.values.joined().map(\.t), clock: clock, now: Date()))) { context in
                    content(until: Date(timeIntervalSince1970: clock.p(at: context.date.timeIntervalSince1970)))
                }
            } else {
                content(until: nil)
            }
        }
    }

    private func content(until: Date?) -> some View {
        let shown = history.shown(until: until)
        let window: OddsWindow = event.state == .live ? pointer.window : .game
        let data = baseline.flatMap {
            OddsChartData.make(feed: feed, baseline: $0, state: event.state, window: window,
                               eventStart: event.start, until: until, history: history)
        }
        let domain = data?.domain ?? shown.domain(state: event.state, window: window, eventStart: event.start, until: until)
        let lineNames = [names.top, names.bottom] + (feed.market?.threeWay == true ? ["Draw"] : [])
        return MatchTimeline(history: shown, domain: domain, names: names, palette: palette, pointer: pointer,
                             labelWidth: OddsStyle.labelWidth(lineNames), final: event.state == .final)
            .background {
                if shown.sport == .soccer, let linked {
                    MatchFocusLink(history: shown, domain: domain, pointer: pointer, linked: linked)
                }
            }
    }
}
