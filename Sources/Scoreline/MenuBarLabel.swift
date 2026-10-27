import AppKit
import SwiftUI

/// Icon at rest; a live count when games are on; the score itself when a pinned
/// or followed game is playing — a Live Activity for the menu bar.
struct MenuBarLabel: View {
    let store: ScoreStore

    var body: some View {
        if let event = store.menuBarEvent {
            // Text only: menu bar space is scarce, and a wide item gets pushed
            // behind the notch on notched displays.
            Text(Self.text(for: event))
                .monospacedDigit()
                .accessibilityLabel(event.spokenSummary)
        } else if store.liveCount > 0 && store.showLiveCount {
            HStack(spacing: 3) {
                Image(systemName: "sportscourt.fill")
                Text("\(store.liveCount)").monospacedDigit()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.liveLabel(store.liveCount))
        } else {
            Image(systemName: "sportscourt")
                .accessibilityLabel("Scoreline")
        }
    }

    /// "Scoreline, 1 game in progress" / "Scoreline, 3 games in progress".
    static func liveLabel(_ count: Int) -> String {
        "Scoreline, \(plural(count, "game")) in progress"
    }

    /// The most the item may take: past this, a notched display hides it.
    static let budget: CGFloat = 150

    /// "ARS 2–1 CHE · 67'", or just "POR 148–150 MIN" when the status would
    /// take the line past `budget` ("POR 148–150 MIN · 0:03 4OT" is 190pt).
    /// ESPN's "3:10 - 2nd" reads "3:10 2nd" here.
    static func text(for event: Event, width: (String) -> CGFloat = Self.width) -> String {
        let line = event.scoreLine(abbreviated: true)
        let status: String
        switch event.state {
        case .live: status = event.detail ?? ""
        case .final: status = event.detail ?? "Final"
        case .scheduled: status = event.start.formatted(date: .omitted, time: .shortened)
        }
        let tidy = status.replacingOccurrences(of: " - ", with: " ")
        guard !tidy.isEmpty else { return line }
        let full = "\(line) · \(tidy)"
        return width(full) <= budget ? full : line
    }

    /// The label's width in the menu bar's type (13pt, tabular digits).
    static func width(_ text: String) -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
        return (text as NSString).size(withAttributes: [.font: font]).width
    }
}
