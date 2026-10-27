import AppKit
import SwiftUI

// Shared pieces every page builds from, so the same thing looks, moves and
// reads aloud the same everywhere: page titles and headers, section titles,
// the live status line, the possession ball, section links, error and
// loading states, the hero wash, and the page's on-screen state.

// MARK: - Is this page on screen?

private struct PageLiveKey: EnvironmentKey {
    static let defaultValue = true
}

private struct PanelOpenKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// This page is on screen: the page on top, with the panel open. False
    /// for Scores while another page covers it, and for every page while the
    /// panel is closed but kept built for reopening. Clocks, pulses, flashes
    /// and other tickers run only while it's true. Default true (previews,
    /// the render harness).
    var pageLive: Bool {
        get { self[PageLiveKey.self] }
        set { self[PageLiveKey.self] = newValue }
    }

    /// The panel is on screen. Default true.
    var panelOpen: Bool {
        get { self[PanelOpenKey.self] }
        set { self[PanelOpenKey.self] = newValue }
    }
}

extension View {
    /// Keyboard focus for a page's own key handling (arrows, Return, Space):
    /// taken when the page comes on screen, and again each time it comes back
    /// (Back to Scores, reopening the panel). Scores stays built, disabled,
    /// under other pages, which drops its focus; without this nothing had
    /// focus after Back until a click.
    ///
    ///     @FocusState private var focused: Bool
    ///     … .focusable().focused($focused).keyFocusWhenLive($focused)
    func keyFocusWhenLive(_ focus: FocusState<Bool>.Binding, enabled: Bool = true) -> some View {
        modifier(KeyFocusWhenLive(focus: focus, enabled: enabled))
    }
}

private struct KeyFocusWhenLive: ViewModifier {
    let focus: FocusState<Bool>.Binding
    let enabled: Bool
    @Environment(\.pageLive) private var live

    func body(content: Content) -> some View {
        content.task(id: live && enabled) {
            guard live && enabled else { return }
            // After the update that re-enabled the page: a disabled view can't take focus.
            await Task.yield()
            focus.wrappedValue = true
        }
    }
}

/// VoiceOver announcements ("Goal. Saka, 23rd minute."), spoken only while
/// the panel is on screen: pages stay built for a few minutes after it
/// closes, and a VoiceOver user in another app shouldn't hear them.
@MainActor
enum Announcer {
    /// Kept by RootView from the panel's state. True until the panel says otherwise.
    static var panelOpen = true

    static func announce(_ text: String) {
        guard panelOpen, !text.isEmpty else { return }
        AccessibilityNotification.Announcement(text).post()
    }
}

// MARK: - Page header

extension View {
    /// One header inset for every page (10pt sides, 8pt top and bottom), so
    /// moving between pages never shifts the header's buttons. `PageHeader`
    /// applies it; a hand-built header row (Scores) puts it on its row, and a
    /// leading `PageTitle` then lands on the 14pt content gutter.
    func pageHeader() -> some View {
        padding(.horizontal, 10).padding(.vertical, 8)
    }
}

/// A page's header bar: Back on the leading side, the page's title centered
/// on the panel, buttons on the trailing side, with `pageHeader()`'s inset.
/// The title stays centered when it fits between the two sides; otherwise it
/// moves into the room between them and truncates, so it never runs into a
/// button (a long team name in Back, a long league name in the title).
///
///     PageHeader(league.name, symbol: league.sport.symbol) {
///         BackButton(title: backTitle, action: onBack)
///     } trailing: {
///         IconButton(symbol: "safari", label: "Open in Browser") { … }
///     }
///     .stackIn()
///     .pageChrome()
struct PageHeader<Leading: View, Trailing: View>: View {
    let title: String
    var symbol: String? = nil
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    init(_ title: String, symbol: String? = nil, @ViewBuilder leading: () -> Leading, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.symbol = symbol
        self.leading = leading()
        self.trailing = trailing()
    }

    var body: some View {
        TitleBarLayout {
            HStack(spacing: 6) { leading }
            PageTitle(centered: title, symbol: symbol)
            HStack(spacing: 6) { trailing }
        }
        .pageHeader()
    }
}

extension PageHeader where Trailing == EmptyView {
    init(_ title: String, symbol: String? = nil, @ViewBuilder leading: () -> Leading) {
        self.init(title, symbol: symbol, leading: leading) { EmptyView() }
    }
}

/// Leading, title, trailing: the title centered on the bar when it clears
/// both sides by `gap`, else centered in the room between them, truncated to
/// fit (a navigation bar's rule).
struct TitleBarLayout: Layout {
    var gap: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let width = proposal.width ?? sizes.reduce(0) { $0 + $1.width } + 2 * gap
        return CGSize(width: width, height: sizes.map(\.height).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 3 else { return }
        let leading = subviews[0].sizeThatFits(.unspecified), trailing = subviews[2].sizeThatFits(.unspecified)
        let title = subviews[1].sizeThatFits(.unspecified)
        subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.midY), anchor: .leading, proposal: ProposedViewSize(leading))
        subviews[2].place(at: CGPoint(x: bounds.maxX, y: bounds.midY), anchor: .trailing, proposal: ProposedViewSize(trailing))
        let frame = Self.titleFrame(width: title.width, in: bounds.minX...bounds.maxX,
                                    leading: leading.width, trailing: trailing.width, gap: gap)
        subviews[1].place(at: CGPoint(x: frame.lowerBound, y: bounds.midY), anchor: .leading,
                          proposal: ProposedViewSize(width: frame.upperBound - frame.lowerBound, height: title.height))
    }

    /// Where the title goes, horizontally (pure; tested).
    static func titleFrame(width: CGFloat, in bar: ClosedRange<CGFloat>, leading: CGFloat, trailing: CGFloat,
                           gap: CGFloat) -> ClosedRange<CGFloat> {
        let left = bar.lowerBound + (leading > 0 ? leading + gap : 0)
        let right = max(bar.upperBound - (trailing > 0 ? trailing + gap : 0), left)
        let mid = (bar.lowerBound + bar.upperBound) / 2
        let w = min(width, right - left)
        let x = min(max(mid - w / 2, left), right - w)
        return x...(x + w)
    }

    func explicitAlignment(of guide: HorizontalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }

    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }
}

/// A page's title, as its top heading. VoiceOver moves to it when the page
/// comes on screen (a page change, Back, reopening the panel), so focus is
/// never left on a page that just went away.
///
/// Use it leading in a hand-built header row (Scores: `PageTitle("Scores")`
/// inside `pageHeader()`, on the 14pt gutter). A centered title comes from
/// `PageHeader`, which keeps it clear of the buttons.
struct PageTitle: View {
    let title: String
    var symbol: String? = nil
    private var centered = false
    @AccessibilityFocusState private var voiceOverFocus: Bool
    @Environment(\.pageLive) private var live

    init(_ title: String, symbol: String? = nil) {
        self.title = title
        self.symbol = symbol
    }

    /// `PageHeader`'s centered title: no gutter inset.
    fileprivate init(centered title: String, symbol: String?) {
        self.title = title
        self.symbol = symbol
        centered = true
    }

    var body: some View {
        HStack(spacing: 5) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityHeading(.h1)
        .accessibilityFocused($voiceOverFocus)
        .padding(.leading, centered ? 0 : 4)
        // The header around it is a drag handle for the panel.
        .allowsHitTesting(false)
        .task(id: live) {
            guard live else { return }
            // Once the page is in the accessibility tree.
            try? await Task.sleep(for: .milliseconds(100))
            voiceOverFocus = true
        }
    }
}

// MARK: - Section title

/// A section's title row: small caps, secondary, a heading VoiceOver's rotor
/// finds. The caps are drawn (`textCase`), so it's read as written.
///
/// `accessory` is the section's state at the trailing edge (Live, Final, a
/// source) and is read with the title ("Timeline, Live"). `trailing` holds
/// controls (a `SectionLink`), which stay their own elements.
///
///     SectionTitle("Timeline", accessory: .live)
///     SectionTitle("Upcoming") { SectionLink("Full Schedule") { … } }
struct SectionTitle<Trailing: View>: View {
    let title: String
    var accessory: SectionAccessory? = nil
    @ViewBuilder var trailing: Trailing

    init(_ title: String, accessory: SectionAccessory? = nil, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.accessory = accessory
        self.trailing = trailing()
    }

    static var font: Font { .system(size: 10.5, weight: .semibold) }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title)
                .textCase(.uppercase)
                .font(Self.font)
                .tracking(0.5)
                .foregroundStyle(.secondary)
                .accessibilityLabel(spoken)
                .accessibilityAddTraits(.isHeader)
                .accessibilityHeading(.h2)
            Spacer(minLength: 4)
            accessoryView.accessibilityHidden(true)
            trailing
        }
    }

    private var spoken: String {
        switch accessory {
        case .live: "\(title), Live"
        case .final: "\(title), Final"
        case let .text(text): "\(title), \(text)"
        case nil: title
        }
    }

    @ViewBuilder
    private var accessoryView: some View {
        switch accessory {
        case .live:
            // The dot is an AppKit layer with no text baseline; as an overlay
            // it can't pull "Live" off the title's baseline.
            Text("Live").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(.red)
                .padding(.leading, 10)
                .overlay(alignment: .leading) { LiveDot() }
        case .final:
            Text("Final").font(.system(size: 10.5)).foregroundStyle(.secondary)
        case let .text(text):
            Text(text).font(.system(size: 10.5)).foregroundStyle(.secondary)
        case nil:
            EmptyView()
        }
    }
}

extension SectionTitle where Trailing == EmptyView {
    init(_ title: String, accessory: SectionAccessory? = nil) {
        self.init(title, accessory: accessory) { EmptyView() }
    }
}

/// A section's quiet text link at its trailing edge: "Schedule ›", "Show All ›",
/// "Bracket ›". One style everywhere: 10.5 semibold, secondary, brighter at
/// once on hover.
struct SectionLink: View {
    let title: String
    var symbol = "chevron.right"
    var help: String? = nil
    let action: () -> Void
    @State private var hovering = false

    init(_ title: String, symbol: String = "chevron.right", help: String? = nil, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.help = help
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 2) {
                Text(title)
                Image(systemName: symbol).font(Glyph.link).accessibilityHidden(true)
            }
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(hovering ? .primary : .secondary)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help ?? title)
        .accessibilityLabel(title)
    }
}

/// The few glyph sizes chevrons and markers come in.
enum Glyph {
    /// A section's expand/collapse chevron.
    static let disclosure = Font.system(size: 9, weight: .bold)
    /// The chevron after a text link ("Schedule ›").
    static let link = Font.system(size: 8.5, weight: .semibold)
    /// A row's trailing chevron (opens a page).
    static let row = Font.system(size: 9, weight: .semibold)
}

// MARK: - Live

/// The live status line: the pulsing dot and the ticking clock, in red. One
/// component for rows, schedules and the team and player pages' live strips.
///
///     LiveStatus(event)                       // clock, else the source's detail, else "Live"
///     LiveStatus(clock: nil, fallback: "Live", size: 10.5)
///     LiveStatus(event, animated: !stale)     // data can't refresh: the dot holds still
struct LiveStatus: View {
    let clock: GameClock?
    var fallback = "Live"
    var size: CGFloat = 11
    /// False while the data is stale: the dot holds still (`LiveDot(animated:)`).
    var animated = true

    init(clock: GameClock?, fallback: String = "Live", size: CGFloat = 11, animated: Bool = true) {
        self.clock = clock
        self.fallback = fallback
        self.size = size
        self.animated = animated
    }

    init(_ event: Event, size: CGFloat = 11, animated: Bool = true) {
        self.init(clock: event.clock, fallback: event.detail ?? "Live", size: size, animated: animated)
    }

    var body: some View {
        HStack(spacing: 4) {
            LiveDot(animated: animated)
            LiveClockText(clock: clock, fallback: fallback)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .font(.system(size: size, weight: .semibold).monospacedDigit())
        .foregroundStyle(.red)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Live, \(Spoken.status(clock?.text(at: AppClock.now) ?? fallback))")
    }
}

/// Gentle "breathing" dot. The pulse is a Core Animation layer animation, so it
/// runs in the window server rather than re-rendering SwiftUI every frame. It
/// pulses only while its page is on screen (`\.pageLive`) and the data is
/// fresh (`animated`); static with Reduce Motion.
struct LiveDot: View {
    /// False while the data is stale (refreshes failing): the dot holds still.
    var animated = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.pageLive) private var pageLive

    var body: some View {
        PulsingDotLayer(animated: animated && pageLive && !reduceMotion)
            .frame(width: 6, height: 6)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// An AppKit view drawn among SwiftUI content that never takes the pointer:
/// clicks, scrolls and hover go to whatever is under it. An `NSView` in a
/// representable is otherwise hit-tested over its whole frame, even beneath
/// an `allowsHitTesting(false)` sibling.
final class PassThroughView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

private struct PulsingDotLayer: NSViewRepresentable {
    let animated: Bool

    func makeNSView(context: Context) -> NSView {
        // Never a target: the row under the dot keeps its hover and click.
        let view = PassThroughView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.systemRed.cgColor
        view.layer?.cornerRadius = 3
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        guard let layer = view.layer else { return }
        layer.backgroundColor = NSColor.systemRed.cgColor
        if animated, layer.animation(forKey: "pulse") == nil {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.4
            pulse.duration = 1.1
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            pulse.isRemovedOnCompletion = false
            // Every dot on screen pulses in phase: start on the shared 2.2s
            // cycle (1.1s each way) instead of whenever this one appeared.
            let now = CACurrentMediaTime()
            pulse.beginTime = layer.convertTime(now - now.truncatingRemainder(dividingBy: 2.2), from: nil)
            pulse.fillMode = .backwards
            layer.add(pulse, forKey: "pulse")
        } else if !animated {
            layer.removeAnimation(forKey: "pulse")
        }
    }
}

/// The ball beside the team that has it (football; basketball where the
/// feed says). One size on every surface, secondary, faded while a pass or
/// kick is in the air. It carries its own transition: changing hands, it
/// leaves one name quickly and arrives at the other, never teleports.
///
///     if hasBall { PossessionGlyph() }
struct PossessionGlyph: View {
    var symbol = "football.fill"
    var inAir = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 8))
            .foregroundStyle(.secondary)
            .opacity(inAir ? Viz.receded : 1)
            .help("Has the ball")
            .accessibilityLabel("Has the ball")
            .transition(Motion.chip(reduceMotion: reduceMotion))
    }
}

// MARK: - Status column

private struct StatusColumnWidthKey: EnvironmentKey {
    static let defaultValue = Metrics.statusWidth
}

extension EnvironmentValues {
    /// The width a section's rows give their status (see `StatusColumn`).
    /// Default `Metrics.statusWidth` (70pt).
    var statusColumnWidth: CGFloat {
        get { self[StatusColumnWidthKey.self] }
        set { self[StatusColumnWidthKey.self] = newValue }
    }
}

/// One status width per section, so every row's score sits in the same
/// column whatever its status says ("0:03 - 4OT", "120'+3'", "Rain Delay").
/// The section measures its widest status once (text measurement, no
/// preference passes) and hands the width down; each row's status fills it.
///
///     // the section
///     .environment(\.statusColumnWidth, StatusColumn.width(for: section.events))
///     // the row
///     statusView.statusColumn()
enum StatusColumn {
    /// Never narrower (what rows were designed at), never wider (the names need the room).
    static let range: ClosedRange<CGFloat> = Metrics.statusWidth...96
    /// The status line's type: 11pt semibold, tabular digits.
    static let fontSize: CGFloat = 11

    /// The width these status texts need, clamped to `range`. `live` texts
    /// get room for the dot before them.
    static func width(for texts: some Sequence<(text: String, live: Bool)>) -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: .semibold)
        let widest = texts.reduce(CGFloat(0)) { widest, item in
            let w = (item.text as NSString).size(withAttributes: [.font: font]).width + (item.live ? 10 : 0)
            return max(widest, w)
        }
        return min(max(widest.rounded(.up), range.lowerBound), range.upperBound)
    }

    /// The width a section of events needs: each row's first status line
    /// (the live clock or detail, the final's detail, a start time or
    /// "Starting soon"/"Delayed").
    static func width(for events: [Event]) -> CGFloat {
        width(for: events.map { event -> (text: String, live: Bool) in
            switch event.state {
            case .live: (event.clock?.display ?? event.detail ?? "Live", true)
            case .final: (event.detail ?? "Final", false)
            case .scheduled: (event.detail == "Delayed" ? "Delayed"
                              : event.start < AppClock.now ? "Starting soon"
                              : event.start.formatted(date: .omitted, time: .shortened), false)
            }
        })
    }
}

extension View {
    /// A row's status, trailing in its section's shared column
    /// (`\.statusColumnWidth`). Past the width, text scales down a little
    /// (to 80%) before it truncates, one line per text.
    func statusColumn() -> some View { modifier(StatusColumnFrame()) }
}

private struct StatusColumnFrame: ViewModifier {
    @Environment(\.statusColumnWidth) private var width

    func body(content: Content) -> some View {
        content
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(width: width, alignment: .trailing)
    }
}

// MARK: - Error and loading

/// The words for a load that failed, the same on every page.
enum ErrorCopy {
    /// "Can't Load Team"
    static func title(_ subject: String) -> String { "Can't Load \(subject)" }
    /// For a page that only retries when asked.
    static let message = "Check your internet connection and try again."
    /// For a page whose store really does retry on its own (Scores).
    static let automaticMessage = "Check your internet connection. Scoreline will try again automatically."
    static let retry = "Try Again"
    /// A section inside a page that keeps working: "Couldn't load Premier League. Trying again shortly."
    static func inline(_ subject: String) -> String { "Couldn't load \(subject). Trying again shortly." }
}

/// A page whose data couldn't load: what failed, what to do, and Try Again.
///
///     ErrorState("Team") { Task { await load(force: true) } }
///     ErrorState("Scores", retriesAutomatically: true) { store.startPolling() }
struct ErrorState: View {
    let subject: String
    var symbol = "wifi.slash"
    var retriesAutomatically = false
    let retry: () -> Void

    init(_ subject: String, symbol: String = "wifi.slash", retriesAutomatically: Bool = false, retry: @escaping () -> Void) {
        self.subject = subject
        self.symbol = symbol
        self.retriesAutomatically = retriesAutomatically
        self.retry = retry
    }

    var body: some View {
        EmptyState(symbol: symbol, title: ErrorCopy.title(subject),
                   message: retriesAutomatically ? ErrorCopy.automaticMessage : ErrorCopy.message) {
            Button(ErrorCopy.retry, action: retry).controlSize(.small)
        }
    }
}

extension View {
    /// Turns `show` on only if loading lasts past 300ms (a fast load never
    /// flashes a spinner), fading in; off at once when loading ends. Tied to
    /// the view, so it never outlives the page or a new load.
    ///
    ///     @State private var showSpinner = false
    ///     … .delayedSpinner(while: data == nil && !failed, show: $showSpinner)
    ///     … if showSpinner { PageSpinner("Loading table") }
    func delayedSpinner(while loading: Bool, show: Binding<Bool>) -> some View {
        task(id: loading) {
            guard loading else {
                show.wrappedValue = false
                return
            }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            withAnimation(Motion.fade) { show.wrappedValue = true }
        }
    }
}

/// A page's loading spinner, centered in its content, with a spoken label
/// ("Loading table"). Leaves on `exit` when the content lands.
struct PageSpinner: View {
    let label: String

    init(_ label: String) { self.label = label }

    var body: some View {
        ProgressView()
            .controlSize(.small)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 40)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .transition(.opacity.animation(Motion.exit))
    }
}

// MARK: - Hero wash

/// Team-colored gradient behind a page's header (match, team and player
/// pages), melting into the panel below. A soft base layer of window color
/// sits underneath, so the glass hero card refracts the team colors, never
/// the desktop behind the panel. Its strength is `Viz.washStrength`.
struct HeroWash: View {
    let left: Color
    let right: Color
    var intensity: Double = 1
    /// A score's pulse, 0 at rest and up to 1 (`WashPulse`): that side's stop
    /// lifts by up to 35% (0.60 → 0.81; 0.40 → 0.54 for pale colors), a slow
    /// change of light, not a flash.
    var boost: (left: Double, right: Double) = (0, 0)
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        let fade = LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black.opacity(0.75), location: 0.45),
                                          .init(color: .black.opacity(0.25), location: 0.75), .init(color: .clear, location: 1)],
                                  startPoint: .top, endPoint: .bottom)
        ZStack {
            Color(nsColor: .windowBackgroundColor).opacity(reduceTransparency ? 0.9 : 0.55)
            LinearGradient(colors: [left.opacity(Viz.washStrength(left, intensity: intensity) * (1 + 0.35 * boost.left)),
                                    left.opacity(0.12 * intensity), right.opacity(0.12 * intensity),
                                    right.opacity(Viz.washStrength(right, intensity: intensity) * (1 + 0.35 * boost.right))],
                           startPoint: .leading, endPoint: .trailing)
        }
        .mask(fade)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
