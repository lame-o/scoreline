import SwiftUI

/// Where a page's sections are relative to what's on screen, and how far its
/// hero has slid under the header. The linked-chart peek asks "is that chart
/// out of view, and which way?"; the docked scorebar asks "how far has the
/// hero gone?".
///
/// Scrolling never writes state per frame. Sections report their frames in
/// content coordinates (which don't change as the page scrolls), and
/// `PageScrollView` turns each scroll position into a small value (which
/// sections are hidden, a 1/64 dock step) inside a geometry transform; only a
/// change in that value is written here.
@MainActor
@Observable
final class PageGeometry {
    /// The coordinate space of a page's scroll content.
    nonisolated static let space = "PageGeometry.content"

    enum Edge: Equatable, Sendable { case above, below }

    /// Visible at 60% or more, hidden at 40% or less: hysteresis without memory.
    enum Visibility: Equatable, Sendable {
        case visible
        case partial(Edge)
        case hidden(Edge)

        var isHidden: Bool { if case .hidden = self { true } else { false } }
    }

    /// Sections by ID. Only sections that report a frame are listed.
    private(set) var visibility: [String: Visibility] = [:]
    /// 0 while the hero is in view, 1 once it has slid under the header;
    /// in steps of 1/64.
    private(set) var dockProgress: Double = 0
    /// The scroll viewport's size (changes with the panel, never with scrolling).
    private(set) var viewport: CGSize = .zero

    /// Folded modules (match pages): only their header is on the page, so
    /// their content (a theater, a chart) is never in view, wherever the
    /// header is. Written when the page's folds change, never on scroll.
    private(set) var folded: Set<String> = []
    /// Section frames in content coordinates.
    @ObservationIgnored private(set) var frames: [String: CGRect] = [:]
    /// Rows a page scrolls to (`pageAnchor`), in content coordinates. Not
    /// sections: scrolling never looks at them.
    @ObservationIgnored private(set) var anchors: [String: CGRect] = [:]
    /// The visible part of the content, as of the last scroll.
    @ObservationIgnored private var visibleRect: CGRect = .zero
    /// Set by `PageScrollView`: scrolls the content to an offset, with an
    /// animation (nil: at once).
    @ObservationIgnored var scrollHandler: ((CGFloat, Animation?) -> Void)?
    /// The scroll content's height, as last laid out.
    @ObservationIgnored private(set) var contentHeight: CGFloat = 0
    /// While set, the page's height stops resizing the panel (a module drag
    /// folds the page for a moment: the panel mustn't shrink under the pointer).
    @ObservationIgnored var holdsSize = false
    /// Called after a section reports a new frame (a module drag waits for the folded page's layout).
    @ObservationIgnored var framesChanged: (() -> Void)?
    #if DEBUG
    /// The viewport in the window (SwiftUI's global space): the interaction harness aims its clicks with it.
    @ObservationIgnored var viewportFrame: CGRect = .zero
    #endif

    /// The hero's section ID, which drives `dockProgress`.
    nonisolated static let hero = "hero"
    /// Height of the docked scorebar plus its gap: the top of the viewport it covers once docked.
    nonisolated static let dockInset: CGFloat = 48

    // MARK: Scrolling

    /// Brings a section's top to `topInset` below the viewport's top.
    func scroll(toSection id: String, topInset: CGFloat = 8, animated: Bool) {
        guard let frame = frames[id] else { return }
        scroll(toY: max(0, frame.minY - topInset), animated: animated)
    }

    func scroll(toY y: CGFloat, animated: Bool) { scrollHandler?(y, animated ? Motion.travel : nil) }

    /// The same, on a given animation (a drop settling on `standard`).
    func scroll(toY y: CGFloat, animation: Animation?) { scrollHandler?(y, animation) }

    /// The visible part of the content, as of the last scroll.
    var visible: CGRect { visibleRect }

    /// Brings a row's top to `topInset` below the viewport's top (a mark
    /// clicked in a docked bar: its row lands just under the bar).
    func scroll(toAnchor id: String, topInset: CGFloat, animated: Bool) {
        guard let frame = anchors[id] else { return }
        scroll(toY: max(0, frame.minY - topInset), animated: animated)
    }

    /// The least scroll that shows a row whole, below `topInset` (the arrow
    /// keys' highlight, clear of a docked bar); nothing when it already shows.
    func reveal(anchor id: String, topInset: CGFloat, animated: Bool) {
        guard let frame = anchors[id], let y = Self.reveal(frame, visible: visibleRect, topInset: topInset) else { return }
        scroll(toY: y, animated: animated)
    }

    // MARK: Reports (from PageScrollView and pageSection)

    struct State: Equatable {
        var visibility: [String: Visibility]
        var dockStep: Int
    }

    func report(frame: CGRect, for id: String) {
        guard frames[id] != frame else { return }
        frames[id] = frame
        apply(state(for: visibleRect))
        framesChanged?()
    }

    /// A section left the page (hidden, or nothing to show): it's in view nowhere.
    func forget(_ id: String) {
        guard frames.removeValue(forKey: id) != nil else { return }
        apply(state(for: visibleRect))
    }

    func setFolded(_ ids: Set<String>) {
        if folded != ids { folded = ids }
    }

    /// How much of a section's content is on screen: its `visibility`, except
    /// that a folded section's content is hidden even with its header in view
    /// (the theater stops drawing, a moment's owner isn't seen, the peek shows
    /// the chart). The docked bar's news line reads plain `visibility`: a
    /// folded header in view carries the moment in its glance.
    func contentVisibility(_ id: String) -> Visibility? {
        Self.contentVisibility(visibility[id], folded: folded.contains(id))
    }

    func report(anchor frame: CGRect, for id: String) {
        if anchors[id] != frame { anchors[id] = frame }
    }

    func report(viewport size: CGSize) {
        if viewport != size { viewport = size }
    }

    func report(contentHeight height: CGFloat) { contentHeight = height }

    /// What a scroll position means. Pure apart from reading `frames`; called
    /// from the scroll geometry transform on every scroll.
    func state(for visible: CGRect) -> State {
        visibleRect = visible
        let step = frames[Self.hero].map { Self.dockStep(hero: $0, offset: visible.minY) } ?? 0
        // Once docked, the bar covers the top of the viewport.
        let inset = step >= 32 ? Self.dockInset : 0
        var map: [String: Visibility] = [:]
        for (id, frame) in frames where id != Self.hero {
            map[id] = Self.visibility(frame: frame, visible: visible, topInset: inset)
        }
        return State(visibility: map, dockStep: step)
    }

    func apply(_ state: State) {
        if visibility != state.visibility { visibility = state.visibility }
        let progress = Double(state.dockStep) / 64
        if dockProgress != progress { dockProgress = progress }
    }

    // MARK: Math (pure, tested)

    /// How much of a section is on screen. A section taller than the viewport
    /// counts as fully visible while it fills it (you're inside it).
    nonisolated static func visibility(frame: CGRect, visible: CGRect, topInset: CGFloat) -> Visibility {
        var visible = visible
        visible.origin.y += topInset
        visible.size.height = max(visible.height - topInset, 0)
        guard frame.height > 0, visible.height > 0 else { return .visible }
        let shown = max(0, min(frame.maxY, visible.maxY) - max(frame.minY, visible.minY))
        let fraction = shown / min(frame.height, visible.height)
        let edge: Edge = frame.midY < visible.midY ? .above : .below
        if fraction >= 0.6 { return .visible }
        if fraction <= 0.4 { return .hidden(edge) }
        return .partial(edge)
    }

    /// A section's content, folded or not: folded, hidden on the side its header is (below when in view).
    nonisolated static func contentVisibility(_ visibility: Visibility?, folded: Bool) -> Visibility? {
        guard folded else { return visibility }
        switch visibility {
        case let .hidden(edge)?, let .partial(edge)?: return .hidden(edge)
        case .visible?, nil: return .hidden(.below)
        }
    }

    /// Where to scroll so a row shows whole below `topInset`: its top just
    /// under the inset when it's above that, its bottom at the viewport's
    /// bottom when it's below; nil when it already shows.
    nonisolated static func reveal(_ frame: CGRect, visible: CGRect, topInset: CGFloat) -> CGFloat? {
        if frame.minY < visible.minY + topInset { return max(0, frame.minY - topInset) }
        if frame.maxY > visible.maxY { return max(0, frame.maxY - visible.height) }
        return nil
    }

    /// The hero docks once a quarter of it has slid under the header, over
    /// the next three quarters of its height: 0...64.
    nonisolated static func dockStep(hero: CGRect, offset y: CGFloat) -> Int {
        let start = hero.minY + 0.25 * hero.height
        let travel = max(0.75 * hero.height - 4, 24)
        let p = min(max((y - start) / travel, 0), 1)
        return Int((p * 64).rounded())
    }
}

private struct PageGeometryKey: EnvironmentKey {
    static let defaultValue: PageGeometry? = nil
}

extension EnvironmentValues {
    /// The page's geometry, when the page tracks it (match, player and season
    /// pages). Other pages leave it nil and their scroll views do nothing extra.
    var pageGeometry: PageGeometry? {
        get { self[PageGeometryKey.self] }
        set { self[PageGeometryKey.self] = newValue }
    }
}

extension View {
    /// Reports this section's frame to the page's geometry under `id`. Frames
    /// are in content coordinates, so this fires on layout changes, not scrolling.
    func pageSection(_ id: String) -> some View { modifier(PageSection(id: id)) }

    /// Reports this row's frame under `id`, so the page can scroll to it
    /// (`scroll(toAnchor:)`, `reveal(anchor:)`). Fires on layout changes, not scrolling.
    func pageAnchor(_ id: String) -> some View { modifier(PageAnchor(id: id)) }
}

private struct PageAnchor: ViewModifier {
    let id: String
    @Environment(\.pageGeometry) private var geometry

    func body(content: Content) -> some View {
        if let geometry {
            content.onGeometryChange(for: CGRect.self) { $0.frame(in: .named(PageGeometry.space)) } action: { frame in
                geometry.report(anchor: frame, for: id)
            }
        } else {
            content
        }
    }
}

private struct PageSection: ViewModifier {
    let id: String
    @Environment(\.pageGeometry) private var geometry

    func body(content: Content) -> some View {
        if let geometry {
            content.onGeometryChange(for: CGRect.self) { $0.frame(in: .named(PageGeometry.space)) } action: { frame in
                geometry.report(frame: frame, for: id)
            }
            // Hidden from its menu (or with nothing left to show), its last frame mustn't read as in view.
            .onDisappear { geometry.forget(id) }
        } else {
            content
        }
    }
}
