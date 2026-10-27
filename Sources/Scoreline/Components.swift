import SwiftUI

enum Metrics {
    static let width: CGFloat = 340
    /// The panel's full height: short pages shrink to fit, longer ones scroll.
    static let panelHeight: CGFloat = 540
    /// The panel fits its page, between these.
    static let minPanelHeight: CGFloat = 220
    /// Never taller than the panel's full height (or the screen, on a small display).
    static let statusWidth: CGFloat = 70
    static let gutter: CGFloat = 14
    /// The glass hero card on match, team and player pages.
    static let heroRadius: CGFloat = 18
}

/// The house motion tokens. Rules: springs never bounce (except `pop`, for
/// celebrations); exits are faster than entrances; keyboard actions never
/// animate (wrap them in a transaction with `disablesAnimations`); with
/// Reduce Motion, anything that moves becomes a gentle fade (`fade`), never
/// nothing.
enum Motion {
    /// Critically damped: settles without overshoot. Used for state changes the
    /// system initiates (page switches, collapsing sections).
    static let standard = Animation.spring(duration: 0.3, bounce: 0)
    static let quick = Animation.spring(duration: 0.2, bounce: 0)
    /// `standard` for rows moving within a list (reorder, remove); a short
    /// fade with Reduce Motion. For actions outside a view's environment
    /// (context menus, drops).
    static var rearrange: Animation {
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? fade : standard
    }
    /// Something traveling across the panel (crests flying between a collapsed
    /// preview and their rows). Apple's reposition spring: damping 1, response 0.4.
    static let travel = Animation.spring(duration: 0.4, bounce: 0)
    /// Text arriving: Emil Kowalski's strong ease-out.
    static let reveal = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.25)
    /// Leaving is faster than arriving.
    static let exit = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.12)
    /// Gap between staggered rows.
    static let stagger = 0.04
    /// The page entrance cascade (`stackIn()`): each 48pt down a block waits
    /// this much longer (and up to this much across)…
    static let stackStep = 0.02
    /// …and no block waits longer than this, so a page settles in about
    /// `stackCap` + `reveal` (0.37s) however tall it is.
    static let stackCap = 0.12
    /// Small fades (hairlines, focus rings, logos loading). Strong ease-out.
    static let fade = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.15)
    /// Press feedback: 100–160ms band, strong ease-out.
    static let press = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.12)
    /// An ambient "this just changed" highlight decaying on its own (a row's
    /// score flash): deliberately slow, and gentle. Not a response to the user.
    /// With Reduce Motion use `fade`.
    static let decay = Animation.easeOut(duration: 1.2)
    /// A change of light across a surface (a climber's wash taking a new
    /// color): ease-in-out, because it's already on screen.
    static let light = Animation.timingCurve(0.77, 0, 0.175, 1, duration: 0.9)
    /// A short sweep arriving (a glint landing): the house ease-out at 0.22s.
    static let sweepIn = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.22)
    /// The tail of a keyframe track that settles in place.
    static let settle = UnitCurve.easeInOut
    /// Badge pop-in: never from nothing (92%, not 0 or 80%). Leaves faster
    /// than it came, as a plain fade on `exit`.
    static var badgeTransition: AnyTransition {
        .asymmetric(insertion: .scale(scale: 0.92).combined(with: .opacity), removal: .opacity.animation(exit))
    }

    /// A state chip or badge (MAP POINT, RED ZONE, a rank delta) arriving on
    /// its own: 92% to full on `quick`, leaving on `exit`. Carries its own
    /// animations, so it needs no `withAnimation`. Reduce Motion: a fade in.
    static func chip(reduceMotion: Bool) -> AnyTransition {
        .asymmetric(insertion: (reduceMotion ? AnyTransition.opacity : .scale(scale: 0.92).combined(with: .opacity))
                        .animation(reduceMotion ? fade : quick),
                    removal: .opacity.animation(exit))
    }
    /// A new live row (a goal, a play): slides in like the stacking entrance,
    /// leaves faster than it came.
    static var arrive: AnyTransition {
        .asymmetric(insertion: AnyTransition.opacity.combined(with: .offset(x: -10)).animation(reveal),
                    removal: .opacity.animation(exit))
    }
}

extension View {
    /// Text that rises 4pt as it fades in. With Reduce Motion it only fades.
    /// (No blur: a blur is an offscreen pass per text, every frame, for every
    /// row arriving at once.)
    func reveal(_ shown: Bool, reduceMotion: Bool) -> some View {
        opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 4)
    }
}

/// Header-row icon button: a Liquid Glass circle that responds to hover and
/// press (macOS 26), or a toolbar-style hover tint on older systems.
///
///     IconButton(symbol: "calendar", label: "Schedule", shortcut: "⌘U") { … }
///
/// VoiceOver says `label`; the tooltip adds the shortcut ("Schedule (⌘U)").
struct IconButton: View {
    let symbol: String
    /// What the button does, in Title Case ("Open in Browser").
    let label: String
    /// Shown in the tooltip only, never spoken ("⌘U").
    var shortcut: String? = nil
    /// Each increment turns the symbol once (a click's feedback). Never a
    /// continuous spin: that redrew the whole window for seconds after every
    /// background poll.
    var turns = 0
    var active = false
    let action: () -> Void
    @State private var hovering = false

    private var help: String { shortcut.map { "\(label) (\($0))" } ?? label }

    var body: some View {
        let icon = Image(systemName: symbol)
            .font(.system(size: 12, weight: .medium))
            .symbolEffect(.rotate, value: turns)
            .contentTransition(.symbolEffect(.replace))
        Group {
            if GlassSupport.available {
                Button(action: action) {
                    icon.frame(width: 28, height: 28).contentShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(active ? Color.accentColor : .primary.opacity(0.75))
                .glass(in: Circle(), interactive: true)
            } else {
                Button(action: action) {
                    icon.frame(width: 24, height: 22).contentShape(Rectangle())
                }
                .buttonStyle(PressableStyle(hovering: hovering, cornerRadius: 5))
                .foregroundStyle(active ? Color.accentColor : .secondary)
                .onHover { hovering = $0 }
            }
        }
        .help(help)
        .accessibilityLabel(label)
    }
}

/// "‹ Scores" — a glass capsule that pops back to the previous page.
/// Esc and ⌘[ both trigger it. A long title (a team or player name) truncates
/// rather than running into the page title.
struct BackButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: "chevron.left").font(.system(size: 11, weight: .semibold))
                CappedWidth(width: 120) {
                    Text(title).font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .padding(.leading, 9).padding(.trailing, 11)
            .frame(height: 28)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassCapsule(interactive: true)
        .keyboardShortcut(.cancelAction)
        .background { ShortcutButton(key: "[", action: action) }
        .help("Back to \(title) (⌘[)")
        .accessibilityLabel("Back to \(title)")
    }
}

/// Offers its content at most `width` and takes the content's own size: a
/// short title stays short (a `frame(maxWidth:)` would stretch it to the cap),
/// a long one truncates at the cap.
struct CappedWidth: Layout {
    let width: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        return child.sizeThatFits(ProposedViewSize(width: min(proposal.width ?? width, width), height: proposal.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: bounds.height))
    }
}

/// Background tint for hover/selection, darker while pressed, with a subtle press-in.
/// Hover changes are instant (they happen constantly); the press eases.
struct PressableStyle: ButtonStyle {
    var hovering: Bool
    var cornerRadius: CGFloat = 6
    var pressScale: CGFloat = 0.97
    @Environment(\.colorSchemeContrast) private var contrast

    func makeBody(configuration: Configuration) -> some View {
        let strong = contrast == .increased
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.primary.opacity(configuration.isPressed ? (strong ? 0.18 : 0.12) : hovering ? (strong ? 0.12 : 0.07) : 0))
            )
            .scaleEffect(configuration.isPressed ? pressScale : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

struct EmptyState<Actions: View>: View {
    let symbol: String
    let title: String
    let message: String
    @ViewBuilder let actions: Actions

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 26, weight: .light))
                .foregroundStyle(.tertiary)
                .padding(.bottom, 4)
            Text(title).font(.system(size: 13, weight: .semibold))
            Text(message)
                .font(.system(size: 11.5))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                // A wide panel doesn't make a short message one long line.
                .frame(maxWidth: 300)
            actions.padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 36)
        .stackIn()
    }
}

extension EmptyState where Actions == EmptyView {
    init(symbol: String, title: String, message: String) {
        self.init(symbol: symbol, title: title, message: message) { EmptyView() }
    }
}

/// A live game's clock: ticks every second between readings while it's
/// running, and holds when it's stopped (a timeout, half-time). It only
/// ticks while its page is on screen (`\.pageLive`): a hidden Scores page or
/// a closed panel kept alive for reopening shows the reading, unticking.
struct LiveClockText: View {
    let clock: GameClock?
    let fallback: String
    @Environment(\.pageLive) private var pageLive

    var body: some View {
        if let clock, clock.running, pageLive {
            // Aligned to whole seconds, so every clock on screen ticks in the same frame.
            TimelineView(.periodic(from: Date(timeIntervalSinceReferenceDate: 0), by: 1)) { context in
                Text(clock.text(at: context.date))
            }
        } else if let clock, clock.running {
            Text(clock.text(at: .now))
        } else {
            Text(fallback)
        }
    }
}

// MARK: - Page size

/// A page's natural height, assembled from its parts as they lay out: its
/// fixed chrome (header, footer) plus its scrolling content at full height,
/// as if nothing had to scroll. Neither depends on the panel's own height, so
/// resizing the panel can't feed back into it.
///
/// A plain reference, deliberately not observable: nothing renders from it,
/// a report re-runs no body, and `onChange` fires only when the total (or the
/// loading flag) actually moves. (It replaced three preference keys whose
/// combining cost about 5% of opening a match.)
@MainActor
final class PageSize {
    /// One per reporter: a header, a footer, a scroll view, a loading flag.
    final class Token {}

    /// Set by `SizedPage` on every render (a page replaced in place, a
    /// schedule's new scope, keeps the same `SizedPage`).
    var onChange: (_ height: CGFloat, _ loading: Bool) -> Void = { _, _ in }

    /// Each value keeps its token alive, so an identifier is never reused while listed.
    private var chrome: [ObjectIdentifier: (token: Token, height: CGFloat)] = [:]
    /// The active scroll view's content (last active reporter wins).
    private var content: (token: Token, height: CGFloat)?
    private var loading: [ObjectIdentifier: Token] = [:]
    private var last: (height: CGFloat, loading: Bool)?

    func chrome(_ height: CGFloat?, for token: Token) {
        chrome[ObjectIdentifier(token)] = height.map { (token, $0) }
        report()
    }

    /// The scroll content's full height, or nil when it stops sizing the
    /// panel (inactive, gone). Only the current owner can clear it.
    func content(_ height: CGFloat?, for token: Token) {
        if let height {
            content = (token, height)
        } else if content?.token === token {
            content = nil
        }
        report()
    }

    /// A loading flag changed: reports (a page that just stopped loading may
    /// now shrink the panel).
    func loading(_ on: Bool, for token: Token) {
        note(loading: on, for: token)
        report()
    }

    /// Records a loading flag without reporting. `pageLoading` calls this
    /// from its body, which runs before layout, so the first content report
    /// already knows the page is loading (a spinner never shrinks the panel).
    func note(loading on: Bool, for token: Token) {
        loading[ObjectIdentifier(token)] = on ? token : nil
    }

    private func report() {
        let fixed = chrome.values.reduce(0) { $0 + $1.height }
        // A page without its scroll content (a skeleton, an error, a page
        // hidden under another) holds the panel's size. The next full report
        // always goes through, whatever was reported before.
        guard let content, fixed > 0 else {
            last = nil
            return
        }
        let next = (height: (fixed + content.height).rounded(), loading: !loading.isEmpty)
        if let last, last.height == next.height, last.loading == next.loading { return }
        last = next
        onChange(next.height, next.loading)
    }
}

private struct PageSizeKey: EnvironmentKey {
    static let defaultValue: PageSize? = nil
}

private struct PageContentActiveKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// The page's size, set by `SizedPage` (nil outside one: nothing reports).
    fileprivate var pageSize: PageSize? {
        get { self[PageSizeKey.self] }
        set { self[PageSizeKey.self] = newValue }
    }

    /// False for scrolling content that shouldn't size the panel (see `pageContentInactive`).
    fileprivate var pageContentActive: Bool {
        get { self[PageContentActiveKey.self] }
        set { self[PageContentActiveKey.self] = newValue }
    }
}

extension View {
    /// Marks a page's fixed header or footer, so the panel can fit the page.
    /// A drag on it moves the panel; its buttons still click.
    func pageChrome() -> some View { modifier(PageChromeReporter()) }

    /// Scrolling content that mustn't size the panel: a view switch's
    /// outgoing view while it fades, or a page hidden under another (Scores).
    /// Inactive anywhere above means inactive: an inner `false` can't wake
    /// content an outer `true` put to sleep.
    func pageContentInactive(_ inactive: Bool = true) -> some View {
        modifier(PageContentGate(inactive: inactive))
    }

    /// While true, the panel keeps its size instead of shrinking to fit a
    /// spinner; it resizes once the content lands.
    func pageLoading(_ loading: Bool) -> some View { modifier(PageLoadingReporter(loading: loading)) }
}

private struct PageContentGate: ViewModifier {
    let inactive: Bool
    @Environment(\.pageContentActive) private var outer

    func body(content: Content) -> some View {
        content.environment(\.pageContentActive, outer && !inactive)
    }
}

private struct PageChromeReporter: ViewModifier {
    @Environment(\.pageSize) private var size
    @State private var token = PageSize.Token()

    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            // Grab a header or footer bar to move the panel; its buttons still click.
            .gesture(WindowDragGesture())
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { size?.chrome($0, for: token) }
            .onDisappear { size?.chrome(nil, for: token) }
    }
}

private struct PageLoadingReporter: ViewModifier {
    let loading: Bool
    @Environment(\.pageSize) private var size
    @State private var token = PageSize.Token()

    func body(content: Content) -> some View {
        // Before layout: the same pass's content report already knows.
        size?.note(loading: loading, for: token)
        return content
            .onChange(of: loading) { _, now in size?.loading(now, for: token) }
            .onDisappear { size?.loading(false, for: token) }
    }
}

/// Measures a page's natural height (see `PageSize`) and reports it to
/// `onChange` as the page lays out: on first layout, and whenever the total
/// or the loading flag changes.
struct SizedPage<Content: View>: View {
    let onChange: (_ height: CGFloat, _ loading: Bool) -> Void
    @ViewBuilder let content: Content
    @State private var size = PageSize()

    var body: some View {
        // Every render: a page replaced in place reports for the page it is now.
        size.onChange = onChange
        return content.environment(\.pageSize, size)
    }
}

/// The panel's content fills the window, pinned to the top. The window does
/// the moving (PanelController animates its height on the display's clock),
/// so each frame lays out once, at the window's size.
struct PanelFrame: ViewModifier {
    func body(content: Content) -> some View {
        content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

#if DEBUG
/// Harness only: scrolls a page without a scroll view, which ImageRenderer
/// can't draw (`PageScrollView` draws its content at `offset` instead).
/// Only the views that read the offset re-render as it moves, as on a real
/// scroll, so a harness can time scrolling and count body runs.
@MainActor
@Observable
final class HarnessScroll {
    private(set) var offset: CGFloat = 0
    /// The page's geometry and viewport, once it has laid out.
    @ObservationIgnored var geometry: PageGeometry?
    @ObservationIgnored var viewport: CGSize = .zero

    /// Moves to `y` and reports it to the page's geometry, as a scroll does.
    func scroll(to y: CGFloat) {
        if offset != y { offset = y }
        guard let geometry else { return }
        geometry.apply(geometry.state(for: CGRect(origin: CGPoint(x: 0, y: y), size: viewport)))
    }
}

private struct HarnessScrollKey: EnvironmentKey {
    static let defaultValue: HarnessScroll? = nil
}

extension EnvironmentValues {
    var harnessScroll: HarnessScroll? {
        get { self[HarnessScrollKey.self] }
        set { self[HarnessScrollKey.self] = newValue }
    }
}
#endif

/// Where each page was scrolled to, so going back to it (or reopening the
/// panel on it) lands exactly where you left off.
@MainActor
final class ScrollMemory {
    var offsets: [String: CGFloat] = [:]
}

private struct ScrollMemoryKey: EnvironmentKey {
    static let defaultValue: ScrollMemory? = nil
}

private struct ScrollKeyKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    /// The panel's scroll memory, shared by every page.
    var scrollMemory: ScrollMemory? {
        get { self[ScrollMemoryKey.self] }
        set { self[ScrollMemoryKey.self] = newValue }
    }

    /// The page this scroll view belongs to, as the memory knows it.
    var scrollKey: String? {
        get { self[ScrollKeyKey.self] }
        set { self[ScrollKeyKey.self] = newValue }
    }
}

/// The scrolling body of a page: fills the space between header and footer.
/// Content dissolves under the edges (macOS 26 soft scroll edge) or, on older
/// systems, a hairline appears only while content is scrolled underneath.
/// It reports its content's full height to the page's `SizedPage`, and
/// remembers where it was scrolled to (`\.scrollKey`).
///
///     PageScrollView(keyboardScrolls: true) { … }
///
/// `keyboardScrolls` makes the page operable without a pointer: it takes
/// keyboard focus when the page comes on screen, and ↑ ↓ (a line), Page Up,
/// Page Down, Space and ⇧Space (a screen), Home and End scroll it, instantly.
/// Leave it off on pages with their own key handling (Scores, Schedule).
struct PageScrollView<Content: View>: View {
    let keyboardScrolls: Bool
    let content: Content
    @State private var edges = Edges()
    @Environment(\.scrollMemory) private var memory
    @Environment(\.scrollKey) private var key
    @Environment(\.pageContentActive) private var contentActive
    @Environment(\.pageSize) private var size
    @State private var token = PageSize.Token()
    /// Match pages track where their sections are (for the chart peek and the
    /// docked scorebar); other pages leave this nil.
    @Environment(\.pageGeometry) private var geometry
    @State private var position = ScrollPosition(edge: .top)
    /// Content height, viewport and offset as last measured. A reference:
    /// nothing renders from them, so measuring re-runs no body.
    @State private var metrics = ScrollMetrics()
    /// A remembered offset waiting for the page's content to be tall enough.
    @State private var pendingRestore: CGFloat?
    /// Whether the memory has been read for this appearance. The first
    /// geometry callbacks (offset 0) arrive before onAppear and would
    /// otherwise overwrite what's remembered.
    @State private var began = false
    @FocusState private var keyFocus: Bool
    #if DEBUG
    @Environment(\.harnessScroll) private var harness
    #endif

    init(keyboardScrolls: Bool = false, @ViewBuilder content: () -> Content) {
        self.keyboardScrolls = keyboardScrolls
        self.content = content()
    }

    private struct Edges: Equatable {
        var top = false
        var bottom = false
    }

    @MainActor private final class ScrollMetrics {
        var content: CGFloat?
        var viewport: CGFloat = 0
        var offset: CGFloat = 0
    }

    @ViewBuilder var body: some View {
        #if DEBUG
        if let harness { harnessBody(harness) } else { scrolling }
        #else
        scrolling
        #endif
    }

    private var scrolling: some View {
        ScrollView {
            content.frame(maxWidth: .infinity, alignment: .leading)
                // Section frames are measured here: content coordinates don't
                // change as the page scrolls.
                .coordinateSpace(name: PageGeometry.space)
                // Its own height, which doesn't depend on how tall the panel is.
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                    metrics.content = height
                    if contentActive { size?.content(height, for: token) }
                    begin()
                    restoreIfReady()
                }
        }
        .scrollPosition($position)
        // Each scroll position becomes a small value (hidden sections, a dock
        // step); only a change in it is written, never every frame.
        .onScrollGeometryChange(for: PageGeometry.State?.self) { geo in
            geometry?.state(for: geo.visibleRect)
        } action: { _, state in
            if let state { geometry?.apply(state) }
        }
        .onScrollGeometryChange(for: CGSize.self) { $0.containerSize } action: { _, size in
            metrics.viewport = size.height
            geometry?.report(viewport: size)
        }
        .onAppear { registerScrolling() }
        // Remember where this page is, as it scrolls (but not while a restore
        // is still waiting, or the wait would overwrite what it's waiting for).
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y } action: { _, offset in
            metrics.offset = offset
            begin()
            guard pendingRestore == nil, let key, let memory else { return }
            memory.offsets[key] = max(offset, 0)
        }
        .onAppear { begin() }
        .scrollBounceBehavior(.basedOnSize)
        .softScrollEdges()
        .onScrollGeometryChange(for: Edges.self) { geo in
            Edges(top: geo.contentOffset.y > 1,
                  bottom: geo.contentOffset.y + geo.containerSize.height < geo.contentSize.height - 1)
        } action: { _, new in
            withAnimation(Motion.fade) { edges = new }
        }
        // Sizes the panel only while active: a page coming back on top
        // (Back to Scores) reports again, so the panel re-fits it.
        .onChange(of: contentActive) { _, active in size?.content(active ? metrics.content : nil, for: token) }
        .onDisappear { size?.content(nil, for: token) }
        .focusable(keyboardScrolls)
        .focusEffectDisabled()
        .focused($keyFocus)
        .keyFocusWhenLive($keyFocus, enabled: keyboardScrolls)
        .onKeyPress(keys: [.upArrow, .downArrow, .pageUp, .pageDown, .space, .home, .end]) { press in
            keyboardScrolls ? scroll(for: press) : .ignored
        }
        // Fills the page between its header and footer.
        .frame(maxHeight: .infinity)
        // On macOS 26 the soft scroll edge does this job; hairlines are the fallback.
        .overlay(alignment: .top) { Divider().padding(.horizontal, 12).opacity(edges.top && !GlassSupport.available ? 1 : 0) }
        .overlay(alignment: .bottom) { Divider().padding(.horizontal, 12).opacity(edges.bottom && !GlassSupport.available ? 1 : 0) }
    }

    #if DEBUG
    /// The harness's stand-in: the content at its full height, drawn at the
    /// harness's offset and clipped to the viewport (ImageRenderer can't draw
    /// a scroll view). The page's geometry goes to the harness, which reports
    /// each offset to it as a scroll would.
    private func harnessBody(_ harness: HarnessScroll) -> some View {
        content.frame(maxWidth: .infinity, alignment: .leading)
            .coordinateSpace(name: PageGeometry.space)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                metrics.content = height
                if contentActive { size?.content(height, for: token) }
            }
            .offset(y: -harness.offset)
            .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
            .clipped()
            .onGeometryChange(for: CGSize.self) { $0.size } action: { viewport in
                harness.viewport = viewport
                harness.geometry = geometry
                geometry?.report(viewport: viewport)
            }
    }
    #endif

    /// A key's scroll: a line is 40pt, a screen the viewport less 60pt (some
    /// context stays in view). Never animated: keyboard actions are instant.
    private func scroll(for press: KeyPress) -> KeyPress.Result {
        let line: CGFloat = 40
        let screen = max(metrics.viewport - 60, line)
        let bottom = max((metrics.content ?? 0) - metrics.viewport, 0)
        let target: CGFloat
        switch press.key {
        case .downArrow: target = metrics.offset + line
        case .upArrow: target = metrics.offset - line
        case .pageDown: target = metrics.offset + screen
        case .pageUp: target = metrics.offset - screen
        case .space: target = metrics.offset + (press.modifiers.contains(.shift) ? -screen : screen)
        case .home: target = 0
        case .end: target = bottom
        default: return .ignored
        }
        let y = min(max(target, 0), bottom)
        // At an end there's nothing to do, but the key was still ours (no beep).
        guard abs(y - metrics.offset) > 0.5 else { return .handled }
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { position.scrollTo(y: y) }
        return .handled
    }

    /// Lets the page's geometry scroll this view: a peek's click, the docked
    /// scorebar's back-to-top. Instant when not animated (keyboard, Reduce Motion).
    private func registerScrolling() {
        guard let geometry else { return }
        let position = $position
        geometry.scrollHandler = { y, animated in
            var transaction = Transaction(animation: animated ? Motion.travel : nil)
            transaction.disablesAnimations = !animated
            withTransaction(transaction) { position.wrappedValue.scrollTo(y: y) }
        }
    }

    /// Reads the remembered offset, once, before anything can overwrite it.
    private func begin() {
        guard !began else { return }
        began = true
        guard let key, let saved = memory?.offsets[key], saved > 1 else { return }
        pendingRestore = saved
        // Content that never grows that tall (the data changed): stop waiting.
        Task {
            try? await Task.sleep(for: .seconds(2))
            pendingRestore = nil
        }
    }

    /// Jumps (never animates) to the remembered offset once there's content
    /// to stand on; a page still loading gets there as it fills in.
    private func restoreIfReady() {
        guard let saved = pendingRestore, let height = metrics.content, height > 0 else { return }
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { position.scrollTo(y: min(saved, height)) }
        if height >= saved { pendingRestore = nil }
    }
}

// MARK: - Stacking entrance

/// An entrance in progress: a click-driven page entrance, or the first data
/// replacing a placeholder. Blocks rendering within the window assemble top to
/// bottom, left to right; anything later appears in place, because data being
/// read must not move for style. Panel opens and keyboard navigation have none.
struct StackArrival: Equatable {
    enum Style { case stack, fade }
    var date = Date()
    var style: Style
    /// Coordinate space whose top-left is delay zero.
    var space = StackSpace.name

    /// Data arriving on a page: stacks if the page was clicked into, fades if
    /// it was reached by keyboard (keyboard actions never slide things).
    static func data(in space: String, page: StackArrival?) -> StackArrival {
        StackArrival(style: page == nil ? .fade : .stack, space: space)
    }
}

private struct StackArrivalKey: EnvironmentKey {
    static let defaultValue: StackArrival? = nil
}

extension EnvironmentValues {
    var stackArrival: StackArrival? {
        get { self[StackArrivalKey.self] }
        set { self[StackArrivalKey.self] = newValue }
    }
}

/// Slides a block in from the left (10pt) and fades it, delayed by its
/// position: `Motion.stackStep` per 48pt down and up to one step across,
/// capped at `Motion.stackCap`. Reduce
/// Motion: a plain fade, no slide, no stagger.
struct StackIn: ViewModifier {
    var slides = true
    @Environment(\.stackArrival) private var arrival
    @Environment(\.panelResizing) private var resizing
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var latch = Latch()
    @State private var shown = false

    /// Whether this block is part of an entrance is decided once, at first
    /// render, and never revisited.
    private final class Latch { var animates: Bool? }

    private static let window: TimeInterval = 0.35

    func body(content: Content) -> some View {
        let animates: Bool = latch.animates ?? {
            // Nothing enters while the user is dragging an edge of the panel.
            let value = !resizing && (arrival.map { Date().timeIntervalSince($0.date) < Self.window } ?? false)
            latch.animates = value
            return value
        }()
        let stacking = arrival?.style == .stack && !reduceMotion
        let visible = shown || !animates
        // Position matters only until the entrance starts: after that (and for
        // blocks that never animate) the tracker reports a constant, so rows
        // moving in an expand or a scroll don't update it every frame.
        let space = arrival?.space ?? StackSpace.name
        let tracking = animates && !shown
        content
            .opacity(visible ? 1 : 0)
            .offset(x: visible || !stacking || !slides ? 0 : -10)
            .onGeometryChange(for: CGPoint.self, of: { tracking ? $0.frame(in: .named(space)).origin : .zero }) { origin in
                guard animates, !shown else { return }
                let delay = stacking ? Self.delay(at: origin) : 0
                withAnimation((stacking ? Motion.reveal : Motion.fade).delay(delay)) { shown = true }
            }
    }
}

extension StackIn {
    /// A block's wait in the cascade, by where it sits in the entrance's space.
    static func delay(at origin: CGPoint) -> Double {
        let down = origin.y / 48 * Motion.stackStep
        let across = min(origin.x / Metrics.compactWidth, 1) * Motion.stackStep
        return min(max(down + across, 0), Motion.stackCap)
    }
}

enum StackSpace { static let name = "stackPage" }

extension View {
    /// Joins the current entrance as one unit. `slides: false` fades only
    /// (backgrounds like the hero wash).
    func stackIn(slides: Bool = true) -> some View { modifier(StackIn(slides: slides)) }
}

private struct StacksOwnRowsKey: ContainerValueKey {
    static let defaultValue = false
}

extension ContainerValues {
    /// Set by `StackColumn`, so an enclosing column treats its rows, not the
    /// column itself, as the units.
    var stacksOwnRows: Bool {
        get { self[StacksOwnRowsKey.self] }
        set { self[StacksOwnRowsKey.self] = newValue }
    }
}

/// A column whose direct children each join the entrance: rows without their
/// own background (table rows, events, players) cascade one by one.
struct StackColumn<Content: View>: View {
    var alignment: HorizontalAlignment = .leading
    var spacing: CGFloat = 0
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: alignment, spacing: spacing) {
            ForEach(subviews: content) { subview in
                if subview.containerValues.stacksOwnRows {
                    subview
                } else {
                    subview.stackIn()
                }
            }
        }
        .containerValue(\.stacksOwnRows, true)
    }
}

/// Row inside a list: the whole row is the hit target; hover and press show as
/// an inset rounded highlight (the Control Center list look). No scaling —
/// macOS list rows highlight rather than shrink.
///
/// `keyboard`: the highlight was moved by the arrow keys, not the pointer. It
/// then wears the accent (a fill and a hairline ring), strong enough to track
/// while the pointer's gray wash stays quiet. Increase Contrast doubles the wash.
struct ListRowStyle: ButtonStyle {
    var hovering: Bool
    var inset: CGFloat = 4
    var keyboard = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .contentShape(Rectangle())
            .background(RowHighlight(pressed: configuration.isPressed, hovering: hovering, keyboard: keyboard)
                .padding(.horizontal, inset)
                .padding(.vertical, 1))
    }
}

private struct RowHighlight: View {
    let pressed: Bool
    let hovering: Bool
    let keyboard: Bool
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        let strong = contrast == .increased
        if hovering && keyboard && !pressed {
            shape.fill(Color.accentColor.opacity(strong ? 0.24 : 0.16))
                .overlay(shape.strokeBorder(Color.accentColor.opacity(strong ? 0.8 : 0.5), lineWidth: 1))
        } else {
            shape.fill(Color.primary.opacity(pressed ? (strong ? 0.18 : 0.11) : hovering ? (strong ? 0.12 : 0.06) : 0))
        }
    }
}

/// Invisible button that adds a second keyboard shortcut (e.g. ⌘[ for Back).
struct ShortcutButton: View {
    let key: KeyEquivalent
    var modifiers: EventModifiers = .command
    let action: () -> Void

    var body: some View {
        Button("", action: action)
            .keyboardShortcut(key, modifiers: modifiers)
            .frame(width: 0, height: 0)
            .opacity(0)
            .accessibilityHidden(true)
    }
}

/// A small-caps group label with a glyph ("⚽ SOCCER"), as a heading: VoiceOver's
/// heading rotor finds it, and reads the title as written ("Soccer"), not
/// letter-cased: the caps are drawn (`textCase`), never baked into the string.
struct GroupLabel: View {
    let title: String
    let symbol: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 9.5, weight: .semibold))
                .frame(width: 12)
                .accessibilityHidden(true)
            Text(title)
                .textCase(.uppercase)
                .font(.system(size: 10.5, weight: .semibold))
                .tracking(0.5)
        }
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityHeading(.h2)
    }
}

/// Inset grouped container (System Settings style) with hairlines between rows.
struct GroupBox<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        VStack(spacing: 0) {
            Group(subviews: content) { subviews in
                // Stable identities, so reorders move rows and removals remove the right one.
                ForEach(subviews) { subview in
                    if subview.id != subviews.first?.id { Divider().padding(.leading, 12) }
                    subview
                }
            }
        }
        // Breathing room so inset row highlights don't touch the box edge.
        .padding(.vertical, 3)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.primary.opacity(contrast == .increased ? 0.08 : 0.045))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Color.primary.opacity(contrast == .increased ? 0.25 : 0.06))
        )
        .padding(.horizontal, 12)
    }
}

struct ToggleRow: View {
    let title: String
    var subtitle: String?
    @Binding var isOn: Bool

    var body: some View {
        // Label leading, switch trailing — the System Settings layout.
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 13))
                if let subtitle {
                    Text(subtitle).font(.system(size: 11)).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Toggle(title, isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
        }
        .accessibilityElement(children: .combine)
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
    }
}

// MARK: - Logo travel

private struct LogoNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
    /// Shared by a section's collapsed preview and its rows, so a team's crest
    /// travels between the two when the section expands or collapses.
    var logoNamespace: Namespace.ID? {
        get { self[LogoNamespaceKey.self] }
        set { self[LogoNamespaceKey.self] = newValue }
    }
}

private struct MatchedLogo: ViewModifier {
    let id: String?
    @Environment(\.logoNamespace) private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if let id, let namespace, !reduceMotion {
            // Position only: the crest glides into place and settles from its
            // preview size (14pt) to its row size (16pt) without stretching.
            content.matchedGeometryEffect(id: id, in: namespace, properties: .position)
        } else {
            content
        }
    }
}

extension View {
    func matchedLogo(_ id: String?) -> some View { modifier(MatchedLogo(id: id)) }
}

/// Identity of a team's crest within a section: "eng.1|espn-soccer-364".
func logoMatchID(section: String, _ competitor: Competitor) -> String {
    "\(section)|\(competitor.id ?? competitor.name)"
}
