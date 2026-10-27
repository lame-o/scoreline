import SwiftUI

// The landing page's two arrangements of the same games, and the header
// control that switches between them.

enum LandingView: String, CaseIterable, Sendable {
    case list, tiles

    var title: String {
        switch self {
        case .list: "List"
        case .tiles: "Tiles"
        }
    }

    var symbol: String {
        switch self {
        case .list: "list.bullet"
        case .tiles: "square.grid.2x2"
        }
    }

    /// ⌘1, ⌘2: left to right, the Finder's view-mode convention.
    var key: KeyEquivalent {
        switch self {
        case .list: "1"
        case .tiles: "2"
        }
    }
}

/// Keyboard-initiated changes ask the panel to resize instantly instead of
/// springing. (Window agent hand-off W-T1: `RootView` provides one and its
/// `fit()` treats `now < snapUntil` like its own keyboard navigation.)
@MainActor
@Observable
final class PanelMotion {
    var snapUntil: Date?

    func snapNextResize() { snapUntil = Date().addingTimeInterval(0.3) }
    var snapping: Bool { snapUntil.map { Date() < $0 } ?? false }
}

/// Two-segment glass capsule in the header's glass cluster: List | Tiles.
/// It reports picks; the page owns the change and its transaction (a click
/// fades the content and stacks the new one in; ⌘1/⌘2 are instant, and an
/// instant transaction also stops the indicator's slide).
struct ViewSwitcher: View {
    let selection: LandingView
    /// The view picked, and whether a key press picked it.
    let onSelect: (LandingView, _ keyboard: Bool) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var hovered: LandingView?

    private static let segment: CGFloat = 28

    var body: some View {
        HStack(spacing: 0) {
            ForEach(LandingView.allCases, id: \.self) { view in
                Button {
                    guard view != selection else { return }
                    onSelect(view, NSApp.currentEvent?.type == .keyDown)
                } label: {
                    Image(systemName: view.symbol)
                        .font(.system(size: 12, weight: .medium))
                        // Hover is instant: it happens constantly.
                        .foregroundStyle(.primary.opacity(view == selection ? 1 : hovered == view ? 0.8 : 0.55))
                        .frame(width: Self.segment, height: Self.segment)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .keyboardShortcut(view.key)
                .onHover { inside in hovered = inside ? view : (hovered == view ? nil : hovered) }
                .help("\(view.title) (⌘\(view == .list ? 1 : 2))")
            }
        }
        .padding(.horizontal, 2)
        .background(alignment: .leading) {
            // A plain fill, not glass on glass.
            Capsule()
                .fill(Color.primary.opacity(contrast == .increased ? 0.2 : 0.12))
                .overlay {
                    if contrast == .increased { Capsule().strokeBorder(Color.primary.opacity(0.3), lineWidth: 0.5) }
                }
                .frame(width: 26, height: 24)
                .padding(.leading, 3)
                .offset(x: selection == .tiles ? Self.segment : 0)
                .animation(reduceMotion ? nil : Motion.quick, value: selection)
        }
        .frame(width: 60, height: 28)
        .glassCapsule()
        .accessibilityRepresentation {
            Picker("View", selection: Binding(get: { selection }, set: { onSelect($0, false) })) {
                ForEach(LandingView.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
        }
    }
}
