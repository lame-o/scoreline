import Accessibility
import AppKit
import SwiftUI

// The Win Probability section, grown up: Polymarket's market as a live line
// (a tug-of-war, the top team up, the bottom team down; soccer's three
// outcomes as a 100% stack), ESPN's model as the gray reference line and
// DraftKings' pregame line as a diamond at the left edge. The line glides to
// each new value and the end carries a dot and a badge (Liveline's feel, in
// the app's own type and colors); pointing anywhere reads every series at
// that minute, with the nearest play. It redraws on change and for the half
// second a value glides, and is still in between: the pulse is Core
// Animation's, not a redraw loop.

// MARK: - Style

enum OddsStyle {
    /// The edge labels' column at the left.
    static let gutter: CGFloat = 30
    /// Room above 100% and below 0%, so the end dot and the badge stay whole.
    static let inset: CGFloat = 10
    /// The period names under the plot.
    static let axis: CGFloat = 15
    static let badgeHeight: CGFloat = 18
    static let badgeFont = Font.system(size: 10.5, weight: .semibold, design: .rounded).monospacedDigit()
    /// From the dot's center to the badge's body: the dot (4), a gap (3) and the tail (4).
    static let badgeOffset: CGFloat = 11
    static let badgePadding: CGFloat = 7
    static let dot: CGFloat = 8
    static let ring: CGFloat = 2
    static let line: CGFloat = 2
    static let glide: TimeInterval = 0.5
    /// The pulse: from the dot to this, every `pulsePeriod`.
    static let pulse: CGFloat = 22
    static let pulsePeriod: CFTimeInterval = 1.6
    /// How long the momentum chevron stays after the last change.
    static let momentum: Duration = .seconds(5)
    /// The tooltip's widest: at the narrowest page it always fits beside the crosshair.
    static let tooltipWidth: CGFloat = 140

    static func plotHeight(_ width: WidthClass) -> CGFloat { width >= .large ? 150 : 124 }

    /// Each mode's own steps (never an automatic flip).
    static func glow(_ scheme: ColorScheme) -> Double { scheme == .dark ? 0.35 : 0.18 }
    static func area(_ scheme: ColorScheme) -> Double { scheme == .dark ? 0.14 : 0.10 }
    static func band(_ scheme: ColorScheme) -> Double { scheme == .dark ? 0.26 : 0.22 }
    /// Secondary ink at about 45%: a reference, under the market.
    static func espn(_ scheme: ColorScheme) -> Color { Color.primary.opacity(scheme == .dark ? 0.32 : 0.28) }

    /// The badge's width for the widest value it can show ("MIN 100%"), so its
    /// room at the right never changes as the value does.
    static func badgeWidth(_ names: [String]) -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 10.5, weight: .semibold)
        let widest = names.map { ("\($0) 100%" as NSString).size(withAttributes: [.font: font]).width }.max() ?? 40
        return (widest + badgePadding * 2).rounded(.up)
    }

    /// White or near-black type on a team's color, whichever reads (the scoring slide's rule).
    static func ink(on color: Color) -> Color {
        guard let lab = OKLab(NSColor(color)) else { return .white }
        return SlidePaint.lightInk(on: lab) ? .white : Color(white: 0.08)
    }
}

/// Which stretch of the game the chart shows.
enum OddsWindow: String, CaseIterable, Identifiable {
    case game, recent
    var id: String { rawValue }
    var label: String { self == .game ? "Game" : "10 min" }
}

// MARK: - Data

/// One moment of soccer's stack.
struct OddsStackPoint: Equatable {
    let t: Date
    let split: OddsSplit
}

/// What the plot draws, worked out once per change of the feed or the page:
/// the series (US: the top team's line; soccer: the stack), ESPN's line, the
/// span of time shown. The last point is the live end (the head), drawn and
/// glided separately from the rest.
struct OddsChartData: Equatable {
    var revision: Int
    var threeWay: Bool
    var line: [OddsPoint] = []
    var stack: [OddsStackPoint] = []
    var espn: [OddsPoint] = []
    var draftKings: OddsSplit?
    var periods: [OddsPeriod] = []
    var domain: ClosedRange<Date>
    var live: Bool
    var final: Bool

    var head: OddsPoint? { line.last }
    var stackHead: OddsStackPoint? { stack.last }
    var headTime: Date? { threeWay ? stack.last?.t : line.last?.t }
    var isEmpty: Bool { threeWay ? stack.isEmpty : line.isEmpty }

    /// The time shown (pure; tested). Live: from the first play (or the
    /// scheduled start) to the newest point; final: to the last play; before
    /// the game: the market's last day. The 10 min window slides with the newest point.
    static func domain(state: EventState, window: OddsWindow, start: Date, end: Date?, first: Date?, last: Date?, now: Date) -> ClosedRange<Date> {
        let newest = last ?? now
        switch state {
        case .scheduled:
            let from = max(first ?? now - 86_400, now - 86_400)
            return from...max(newest, from + 60)
        case .final:
            let to = max(end ?? newest, start + 60)
            return start...to
        case .live:
            if window == .recent { return (newest - 600)...newest }
            return start...max(newest, start + 60)
        }
    }

    @MainActor
    static func make(feed: OddsFeed, baseline: OddsBaseline, state: EventState, window: OddsWindow, eventStart: Date,
                     now: Date = .now) -> OddsChartData? {
        guard let market = feed.market else { return nil }
        var data = OddsChartData(revision: feed.revision, threeWay: market.threeWay, domain: now...now, live: state == .live,
                                 final: state == .final)
        let start = baseline.start ?? eventStart
        if market.threeWay {
            data.stack = OddsSeries.stacked(top: feed.series[.top] ?? [], draw: feed.series[.draw] ?? [],
                                            bottom: feed.series[.bottom] ?? []).map { OddsStackPoint(t: $0.t, split: $0.split) }
        } else {
            data.line = feed.series[.top] ?? []
        }
        let times = market.threeWay ? data.stack.map(\.t) : data.line.map(\.t)
        data.domain = domain(state: state, window: window, start: start, end: state == .final ? baseline.end : nil,
                             first: times.first, last: times.last, now: now)
        // The end of a finished game is its last play: nothing after the buzzer.
        if state == .final {
            data.line = data.line.filter { $0.t <= data.domain.upperBound }
            data.stack = data.stack.filter { $0.t <= data.domain.upperBound }
        }
        data.espn = state == .scheduled ? [] : baseline.espn
        data.draftKings = window == .recent ? nil : baseline.draftKings
        data.periods = state == .scheduled ? [] : baseline.periods
        return data
    }
}

// MARK: - Geometry

/// Where everything sits in the plot (pure; tested): time across, the top
/// team's chance up (soccer: the stack's share down from the top), with room
/// at the right for the badge and above and below for the dot.
struct OddsLayout: Equatable {
    /// The plot's area: the edge labels' gutter left of it, the badge's room right of it.
    let plot: CGRect
    /// The whole drawing area (the axis band below `plotHeight` excluded).
    let bounds: CGRect
    let domain: ClosedRange<Date>
    let badgeWidth: CGFloat

    init(size: CGSize, plotHeight: CGFloat, domain: ClosedRange<Date>, badgeWidth: CGFloat) {
        self.domain = domain
        self.badgeWidth = badgeWidth
        bounds = CGRect(x: 0, y: 0, width: size.width, height: plotHeight)
        let right = OddsStyle.badgeOffset + badgeWidth + 2
        plot = CGRect(x: OddsStyle.gutter, y: OddsStyle.inset, width: max(size.width - OddsStyle.gutter - right, 1),
                      height: max(plotHeight - OddsStyle.inset * 2, 1))
    }

    private var span: TimeInterval { max(domain.upperBound.timeIntervalSince(domain.lowerBound), 1) }

    func x(_ t: Date) -> CGFloat { plot.minX + plot.width * CGFloat(t.timeIntervalSince(domain.lowerBound) / span) }
    /// The top team's chance: 100% at the top, 0% at the bottom.
    func y(_ p: Double) -> CGFloat { plot.minY + plot.height * CGFloat(1 - min(max(p, 0), 1)) }
    /// A share of the stack, from the top.
    func depth(_ share: Double) -> CGFloat { plot.minY + plot.height * CGFloat(min(max(share, 0), 1)) }
    var midY: CGFloat { y(0.5) }

    /// The two sides of the tug-of-war, split exactly at 50%: above it the
    /// line wears the top team's color, below it the bottom team's.
    var halves: (top: CGRect, bottom: CGRect) {
        let wide = bounds.insetBy(dx: -4, dy: -12)
        return (CGRect(x: wide.minX, y: wide.minY, width: wide.width, height: midY - wide.minY),
                CGRect(x: wide.minX, y: midY, width: wide.width, height: wide.maxY - midY))
    }

    func time(at x: CGFloat) -> Date { domain.lowerBound + TimeInterval((x - plot.minX) / plot.width) * span }

    /// The scrub's moment: the nearest whole minute, kept within the data.
    func snap(x: CGFloat, within data: ClosedRange<Date>) -> Date {
        let t = time(at: x).timeIntervalSince1970
        let minute = Date(timeIntervalSince1970: (t / 60).rounded() * 60)
        return min(max(minute, data.lowerBound), data.upperBound)
    }

    /// The badge's body beside a dot: to its right, centered on it, kept
    /// inside the drawing area at the top and bottom (its tail still points at the dot).
    func badge(at dot: CGPoint) -> CGRect {
        let h = OddsStyle.badgeHeight
        let y = min(max(dot.y - h / 2, bounds.minY + 1), bounds.maxY - h - 1)
        return CGRect(x: dot.x + OddsStyle.badgeOffset, y: y, width: badgeWidth, height: h)
    }
}

/// A value easing to the next, Liveline's way: 8% of the remaining distance
/// a frame (at 60 fps), scaled to land exactly at `OddsStyle.glide`. (pure; tested)
struct OddsGlide: Equatable {
    var from: OddsSplit
    var to: OddsSplit
    var start: Date

    static func progress(_ elapsed: TimeInterval) -> Double {
        guard elapsed > 0 else { return 0 }
        let frames = 60 * OddsStyle.glide
        return min(1, (1 - pow(0.92, 60 * elapsed)) / (1 - pow(0.92, frames)))
    }

    func value(at t: Date) -> OddsSplit {
        let k = Self.progress(t.timeIntervalSince(start))
        func mix(_ a: Double, _ b: Double) -> Double { a + (b - a) * k }
        return OddsSplit(top: mix(from.top, to.top), draw: to.draw.map { mix(from.draw ?? $0, $0) }, bottom: mix(from.bottom, to.bottom))
    }

    func done(at t: Date) -> Bool { t.timeIntervalSince(start) >= OddsStyle.glide }
}

#if DEBUG
/// The render harness: on screen without a scroll view, a scrub moment, the
/// momentum chevron, and the pulse as a still ring (ImageRenderer can't draw
/// AppKit layers).
struct OddsHarness {
    var moment: Date?
    var rising: OddsMarket.Outcome?
    /// The pulse's phase (0…1) to draw, or nil for none.
    var pulse: Double?
    var window: OddsWindow?
    /// Stills (ImageRenderer): likenesses for the AppKit pieces. Off for the
    /// live window the performance check hosts (the real pulse and control).
    var stills = true
}

private struct OddsHarnessKey: EnvironmentKey {
    static let defaultValue: OddsHarness? = nil
}

private struct OddsPreviewKey: EnvironmentKey {
    static let defaultValue: OddsFeed? = nil
}

extension EnvironmentValues {
    var oddsHarness: OddsHarness? {
        get { self[OddsHarnessKey.self] }
        set { self[OddsHarnessKey.self] = newValue }
    }

    /// The render harness: the game page's market, prepared.
    var oddsPreview: OddsFeed? {
        get { self[OddsPreviewKey.self] }
        set { self[OddsPreviewKey.self] = newValue }
    }
}
#endif

// MARK: - Section

/// The grown-up Win Probability section for a game Polymarket lists.
struct OddsSection: View {
    let feed: OddsFeed
    let baseline: OddsBaseline
    let event: Event
    let names: (top: String, bottom: String)
    let spoken: SpokenTeams
    let palette: TeamPalette
    /// ESPN's number for the header when its series is empty (the NBA's pregame predictor).
    var espnNow: Double? = nil
    @Environment(\.pageLive) private var pageLive
    @State private var window = OddsWindow.game
    @State private var onScreen = false
    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    private var visible: Bool { onScreen || harness != nil }
    #else
    private var visible: Bool { onScreen }
    #endif

    private var live: Bool { event.state == .live }
    private var final: Bool { event.state == .final }
    private var threeWay: Bool { feed.market?.threeWay ?? false }

    var body: some View {
        OddsSectionChrome(title: final ? "How the Odds Moved" : "Win Probability", caption: caption(names.top, names.bottom),
                          accessory: live ? .live : final ? .final : nil, spokenCaption: caption(spoken.top, spoken.bottom)) {
            if live { windowControl }
        } content: {
            VStack(alignment: .leading, spacing: 10) {
                OddsHeader(feed: feed, baseline: baseline, names: names, palette: palette, state: event.state,
                           espnNow: baseline.espn.last?.p ?? espnNow)
                OddsPlot(feed: feed, baseline: baseline, state: event.state, window: live ? shownWindow : .game, eventStart: event.start,
                         names: names, spoken: spoken, palette: palette, pulsing: live && visible && pageLive)
                OddsFooter(feed: feed, baseline: baseline, names: names, palette: palette, live: live, ticking: visible && pageLive)
            }
        }
        // Tracking follows the chart on and off screen (and the page with the panel).
        .onScrollVisibilityChange(threshold: 0.05) { visible in
            onScreen = visible
            feed.show(visible && pageLive, event: event)
        }
        .onChange(of: pageLive) { _, live in feed.show(onScreen && live, event: event) }
        .onChange(of: event.state) { _, _ in if onScreen && pageLive { feed.show(true, event: event) } }
        .onDisappear { feed.stop() }
    }

    private var picker: some View {
        Picker("Window", selection: $window) {
            ForEach(OddsWindow.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlSize(.small)
        .fixedSize()
        .help("The whole game, or the last 10 minutes tick by tick")
    }

    #if DEBUG
    private var shownWindow: OddsWindow { harness?.window ?? window }
    /// ImageRenderer can't draw AppKit controls: the harness draws a likeness.
    @ViewBuilder
    private var windowControl: some View {
        if harness?.stills == true {
            HStack(spacing: 0) {
                ForEach(OddsWindow.allCases) { w in
                    Text(w.label).font(.system(size: 11)).padding(.horizontal, 9).padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 4).fill(w == shownWindow ? Color.primary.opacity(0.16) : .clear))
                }
            }
            .padding(1.5)
            .background(RoundedRectangle(cornerRadius: 5.5).fill(Color.primary.opacity(0.06)))
        } else {
            picker
        }
    }
    #else
    private var shownWindow: OddsWindow { window }
    private var windowControl: some View { picker }
    #endif

    private func caption(_ top: String, _ bottom: String) -> String {
        let espn = baseline.espn.isEmpty ? "" : " against ESPN's model"
        if threeWay {
            return final ? "How Polymarket's market saw it: \(top) win, draw or \(bottom) win."
                : "Polymarket's \(live ? "live " : "")market: \(top) win, draw or \(bottom) win."
        }
        if final { return "Polymarket's market through the game\(espn). \(top) above the line, \(bottom) below." }
        if live { return "Polymarket's live market\(espn). \(top) above the line, \(bottom) below." }
        return "Polymarket's market over the last day. \(top) above the line, \(bottom) below."
    }
}

/// A titled block like `DetailSection`, with a control at the title's trailing edge.
struct OddsSectionChrome<Trailing: View, Content: View>: View {
    let title: String
    var caption: String? = nil
    var accessory: SectionAccessory? = nil
    var spokenCaption: String? = nil
    @ViewBuilder let trailing: Trailing
    @ViewBuilder let content: Content

    var body: some View {
        StackColumn(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                SectionTitle(title, accessory: accessory) { trailing }
                if let caption {
                    Text(caption)
                        .font(Viz.note)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .readableWidth()
                        .accessibilityLabel(spokenCaption ?? caption)
                }
            }
            content
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 16)
        .containerValue(\.stacksOwnRows, true)
    }
}

// MARK: - Header

/// Each side and its Polymarket chance, big, with ESPN's and DraftKings'
/// numbers for the top team in one muted line under them. Colored dots carry
/// identity; the text wears text ink.
struct OddsHeader: View {
    let feed: OddsFeed
    let baseline: OddsBaseline
    let names: (top: String, bottom: String)
    let palette: TeamPalette
    let state: EventState
    var espnNow: Double?
    @Environment(\.spokenTeams) private var teams

    var body: some View {
        let split = feed.latest
        let final = state == .final
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                side(names.top, split?.top, palette.top, final: final, trailing: false)
                Spacer(minLength: 8)
                if let draw = split?.draw {
                    side("Draw", draw, Viz.neutral, final: final, trailing: false)
                    Spacer(minLength: 8)
                }
                side(names.bottom, split?.bottom, palette.bottom, final: final, trailing: true)
            }
            let lines = muted
            if !lines.isEmpty {
                // The longest wording that fits on one line (a wrap would orphan a source).
                ViewThatFits(in: .horizontal) {
                    ForEach(lines, id: \.self) { line in Text(line).fixedSize() }
                    Text(lines.last ?? "").lineLimit(1).truncationMode(.tail)
                }
                .font(Viz.note)
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenText(split))
    }

    private func side(_ name: String, _ share: Double?, _ color: Color, final: Bool, trailing: Bool) -> some View {
        let value = share.map { OddsSeries.percent($0, final: final) }
        return HStack(alignment: .firstTextBaseline, spacing: 5) {
            if !trailing { Circle().fill(color).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 0.5 } }
            if trailing { percent(value) }
            Text(name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            if !trailing { percent(value) }
            if trailing { Circle().fill(color).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 0.5 } }
        }
        .fixedSize()
    }

    private func percent(_ value: Int?) -> some View {
        Text(value.map { "\($0)%" } ?? "–")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(.primary)
            .contentTransition(.numericText(value: Double(value ?? 0)))
            .animation(Motion.quick, value: value)
    }

    /// The muted line's wordings, longest first: "For GSW: ESPN 41% · DraftKings
    /// 42% before tip-off", then shorter. A final looks back at where it
    /// began: "GSW at tip-off: Polymarket 43% · ESPN 24% · DraftKings 42%".
    private var muted: [String] {
        let pregame = OddsBaseline.pregame(baseline.sport)
        let dk = baseline.draftKings
        if let dk, let draw = dk.draw {
            let split = "\(names.top) \(OddsSeries.percent(dk.top))% · Draw \(OddsSeries.percent(draw))% · \(names.bottom) \(OddsSeries.percent(dk.bottom))%"
            return ["DraftKings \(pregame): " + split, "DraftKings: " + split]
        }
        if state == .final {
            var parts: [String] = []
            if let start = baseline.start, let pm = feed.series[.top].flatMap({ OddsSeries.value($0, at: start) ?? $0.first?.p }) {
                parts.append("Polymarket \(OddsSeries.percent(pm))%")
            }
            let espn = baseline.espn.first.map { "ESPN \(OddsSeries.percent($0.p))%" }
            let book = dk.map { "DraftKings \(OddsSeries.percent($0.top))%" }
            let lead = "\(names.top) \(pregame.replacingOccurrences(of: "before ", with: "at ")): "
            let full = parts + [espn, book].compactMap { $0 }
            guard !full.isEmpty else { return [] }
            return [full, parts + [book].compactMap { $0 }, parts].filter { !$0.isEmpty }.map { lead + $0.joined(separator: " · ") }
        }
        let espn = espnNow.map { "ESPN \(OddsSeries.percent($0))%" }
        let book = dk.map { "DraftKings \(OddsSeries.percent($0.top))%" }
        let parts = [espn, book].compactMap { $0 }
        guard !parts.isEmpty else { return [] }
        let short = "For \(names.top): " + parts.joined(separator: " · ")
        return dk == nil ? [short] : [short + " \(pregame)", short]
    }

    private func spokenText(_ split: OddsSplit?) -> String {
        let top = teams?.top ?? names.top, bottom = teams?.bottom ?? names.bottom
        guard let split else { return "Polymarket odds loading." }
        var text = "Polymarket: \(top) \(OddsSeries.percent(split.top, final: state == .final)) percent"
        if let draw = split.draw { text += ", draw \(OddsSeries.percent(draw)) percent" }
        text += ", \(bottom) \(OddsSeries.percent(split.bottom, final: state == .final)) percent."
        if let line = muted.first { text += " " + line.replacingOccurrences(of: names.top, with: top).replacingOccurrences(of: names.bottom, with: bottom) + "." }
        return text
    }
}

// MARK: - Plot

/// The plot in its well: the still layer (the series, ESPN, DraftKings, the
/// grid), the live end (glides, pulses), and the scrub over both.
struct OddsPlot: View {
    let feed: OddsFeed
    let baseline: OddsBaseline
    let state: EventState
    let window: OddsWindow
    let eventStart: Date
    let names: (top: String, bottom: String)
    let spoken: SpokenTeams
    let palette: TeamPalette
    let pulsing: Bool
    @Environment(\.widthClass) private var widthClass
    @Environment(\.colorScheme) private var scheme
    @State private var scrubbing = false

    var body: some View {
        let plotHeight = OddsStyle.plotHeight(widthClass)
        let data = OddsChartData.make(feed: feed, baseline: baseline, state: state, window: window, eventStart: eventStart)
        // A final has no live end to label: the game takes the badge's room.
        let badgeWidth = data?.final == true ? 0 : OddsStyle.badgeWidth([names.top, names.bottom, "Draw"])
        GeometryReader { geo in
            if let data {
                let layout = OddsLayout(size: geo.size, plotHeight: plotHeight, domain: data.domain, badgeWidth: badgeWidth)
                ZStack(alignment: .topLeading) {
                    // Until the market's prices land, the frame is already the chart:
                    // the midline, ESPN's line, DraftKings' diamond.
                    OddsStill(data: data, layout: layout, top: palette.top, bottom: palette.bottom, scheme: scheme)
                        .equatable()
                        .drawingGroup()
                    axisLabels(data, layout, plotHeight: plotHeight)
                    if !data.isEmpty {
                        // While a minute is being read, the live end steps back (the tooltip has the floor).
                        OddsHead(data: data, layout: layout, names: names, top: palette.top, bottom: palette.bottom, pulsing: pulsing)
                            .opacity(scrubbing ? 0.25 : 1)
                            .transition(.opacity)
                        OddsScrub(data: data, layout: layout, baseline: baseline, names: names, top: palette.top, bottom: palette.bottom,
                                  scrubbing: $scrubbing)
                    }
                }
                .animation(Motion.fade, value: data.isEmpty)
            }
        }
        .frame(height: plotHeight + OddsStyle.axis)
        .vizWell(padding: 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary(data))
        .accessibilityChartDescriptor(OddsChartDescriptor(data: data, top: spoken.top, bottom: spoken.bottom))
    }

    /// Edge names at the left (text ink, never the team color) and the
    /// periods under the plot, centered on each one's span.
    @ViewBuilder
    private func axisLabels(_ data: OddsChartData, _ layout: OddsLayout, plotHeight: CGFloat) -> some View {
        Text(names.top).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).fixedSize()
            .position(x: OddsStyle.gutter / 2 - 2, y: layout.plot.minY + 6)
        Text(names.bottom).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).fixedSize()
            .position(x: OddsStyle.gutter / 2 - 2, y: layout.plot.maxY - 6)
        let labels = data.periods.isEmpty ? Self.hourLabels(layout) : Self.periodLabels(data.periods, layout: layout)
        ForEach(labels, id: \.x) { label in
            Text(label.label).font(Viz.tick).foregroundStyle(.secondary).fixedSize()
                .position(x: label.x, y: plotHeight + 8)
        }
    }

    /// Before the game (no periods): the wall clock, on whole hours spaced at
    /// least 56pt apart ("5 PM"), none within 14pt of the plot's ends. (pure; tested)
    static func hourLabels(_ layout: OddsLayout, calendar: Calendar = .current) -> [PeriodLabel] {
        let span = layout.domain.upperBound.timeIntervalSince(layout.domain.lowerBound)
        guard span > 0, layout.plot.width > 0 else { return [] }
        let perHour = layout.plot.width * 3600 / CGFloat(span)
        guard let step = [1, 2, 3, 6, 12].first(where: { CGFloat($0) * perHour >= 56 }) else { return [] }
        var labels: [PeriodLabel] = []
        guard var hour = calendar.nextDate(after: layout.domain.lowerBound, matching: DateComponents(minute: 0, second: 0),
                                           matchingPolicy: .nextTime) else { return [] }
        while hour <= layout.domain.upperBound {
            let x = layout.x(hour)
            if calendar.component(.hour, from: hour) % step == 0, x >= layout.plot.minX + 14, x <= layout.plot.maxX - 14 {
                labels.append(PeriodLabel(label: hour.formatted(.dateTime.hour()), x: x))
            }
            hour += 3600
        }
        return labels
    }

    struct PeriodLabel: Equatable {
        let label: String
        let x: CGFloat
    }

    /// Each period's name at the middle of its visible span, when it fits
    /// there (with 4pt either side); several overtimes share one. (pure; tested)
    static func periodLabels(_ periods: [OddsPeriod], layout: OddsLayout) -> [PeriodLabel] {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .medium)
        var out: [PeriodLabel] = []
        for (i, period) in periods.enumerated() {
            let end = i + 1 < periods.count ? max(period.end, periods[i + 1].start - 1) : period.end
            let a = max(layout.x(period.start), layout.plot.minX), b = min(layout.x(end), layout.plot.maxX)
            guard b > a, !out.contains(where: { $0.label == period.label }) else { continue }
            let width = (period.label as NSString).size(withAttributes: [.font: font]).width
            guard b - a >= width + 8 || periods.count == 1 else { continue }
            out.append(PeriodLabel(label: period.label, x: (a + b) / 2))
        }
        return out
    }

    private func summary(_ data: OddsChartData?) -> String {
        guard let data else { return "Win probability chart, loading." }
        if data.threeWay, let s = data.stackHead?.split {
            return "Polymarket's chances: \(spoken.top) \(OddsSeries.percent(s.top)) percent, draw \(OddsSeries.percent(s.draw ?? 0)) percent, \(spoken.bottom) \(OddsSeries.percent(s.bottom)) percent."
        }
        guard let head = data.head else { return "Win probability chart." }
        var text = "Polymarket gives \(spoken.top) \(OddsSeries.percent(head.p, final: data.final)) percent"
        if let first = data.line.first(where: { $0.t >= data.domain.lowerBound }) ?? data.line.first {
            text += ", from \(OddsSeries.percent(first.p)) percent at the start"
        }
        if let espn = data.espn.last { text += ". ESPN's model: \(OddsSeries.percent(espn.p, final: data.final)) percent" }
        if let dk = data.draftKings { text += ". DraftKings before the game: \(OddsSeries.percent(dk.top)) percent" }
        return text + "."
    }
}

// MARK: Still layer

/// Everything that moves only when data does: the grid, ESPN's line,
/// DraftKings' diamond, the series up to its newest point. Equatable, so a
/// glide or a scrub never redraws it.
struct OddsStill: View, Equatable {
    let data: OddsChartData
    let layout: OddsLayout
    let top: Color
    let bottom: Color
    let scheme: ColorScheme

    #if DEBUG
    /// The performance check: how often the still layer draws.
    nonisolated(unsafe) static var draws = 0
    #endif

    var body: some View {
        Canvas { context, _ in
            #if DEBUG
            Self.draws += 1
            #endif
            drawGrid(context)
            if data.threeWay { drawStack(context) } else { drawLine(context) }
            drawDraftKings(context)
        }
    }

    /// Period dividers at about 30% of the midline's ink; the midline.
    private func drawGrid(_ context: GraphicsContext) {
        let plot = layout.plot
        var dividers = Path()
        for period in data.periods.dropFirst() {
            let x = layout.x(period.start)
            guard x > plot.minX + 1, x < plot.maxX - 1 else { continue }
            dividers.move(to: CGPoint(x: x, y: plot.minY - 4))
            dividers.addLine(to: CGPoint(x: x, y: plot.maxY + 4))
        }
        context.stroke(dividers, with: .color(Viz.grid), lineWidth: 0.5)
        guard !data.threeWay else { return }
        var mid = Path()
        mid.move(to: CGPoint(x: plot.minX, y: layout.midY))
        mid.addLine(to: CGPoint(x: plot.maxX, y: layout.midY))
        context.stroke(mid, with: .color(Viz.reference), lineWidth: 1)
    }

    /// Room around DraftKings' marks and the live end: the lines under them stop short.
    private var rooms: [Clearance] {
        var rooms: [Clearance] = []
        if let dk = data.draftKings {
            for y in OddsDiamonds.positions(dk, threeWay: data.threeWay, layout: layout) {
                rooms.append(Clearance(CGPoint(x: layout.plot.minX, y: y), radius: OddsStyle.dot / 2 + OddsStyle.ring + 1))
            }
        }
        if !data.threeWay, let head = data.head {
            rooms.append(Clearance(CGPoint(x: layout.x(head.t), y: layout.y(head.p)), radius: OddsStyle.dot / 2 + OddsStyle.ring))
        }
        return rooms
    }

    /// The points to draw: from the one in effect at the left edge up to the
    /// one before the newest (the live end draws the last stretch).
    static func visible<T>(_ points: [T], time: (T) -> Date, domain: ClosedRange<Date>, last: Bool = false) -> ArraySlice<T> {
        guard points.count > (last ? 0 : 1) else { return [] }
        let body = last ? points[...] : points.dropLast()
        let firstInside = body.firstIndex { time($0) >= domain.lowerBound } ?? body.endIndex
        let from = max(body.startIndex, firstInside - 1)
        return body[from...]
    }

    private func drawLine(_ context: GraphicsContext) {
        let plot = layout.plot
        var clip = context
        clip.clip(to: Path(CGRect(x: plot.minX, y: layout.bounds.minY - 12, width: plot.width + 1, height: layout.bounds.height + 24)))
        let cleared = clip.clearing(rooms)

        // ESPN's model: the reference, under everything of Polymarket's.
        let espn = Self.visible(data.espn, time: \.t, domain: data.domain, last: true)
        if espn.count > 1 {
            var path = Path()
            for (i, p) in espn.enumerated() {
                let point = CGPoint(x: layout.x(p.t), y: layout.y(p.p))
                if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            cleared.stroke(path, with: .color(OddsStyle.espn(scheme)), style: StrokeStyle(lineWidth: OddsStyle.line, lineCap: .round, lineJoin: .round))
        }

        let points = Self.visible(data.line, time: \.t, domain: data.domain)
        guard points.count > 0 else { return }
        var line = Path(), area = Path()
        for (i, p) in points.enumerated() {
            let point = CGPoint(x: layout.x(p.t), y: layout.y(p.p))
            if i == 0 {
                line.move(to: point)
                area.move(to: CGPoint(x: point.x, y: layout.midY))
                area.addLine(to: point)
            } else {
                line.addLine(to: point)
                area.addLine(to: point)
            }
        }
        // The live end joins this stretch: the head layer draws from the last point here.
        if let head = data.head {
            area.addLine(to: CGPoint(x: layout.x(head.t), y: layout.y(head.p)))
            area.addLine(to: CGPoint(x: layout.x(head.t), y: layout.midY))
        }
        area.closeSubpath()

        let halves = layout.halves
        for (rect, color) in [(halves.top, top), (halves.bottom, bottom)] {
            var side = clip
            side.clip(to: Path(rect))
            side.fill(area, with: .color(color.opacity(OddsStyle.area(scheme))))
            // A soft glow of the line's own color under it.
            side.drawLayer { glow in
                glow.addFilter(.blur(radius: 6))
                glow.stroke(line, with: .color(color.opacity(OddsStyle.glow(scheme))),
                            style: StrokeStyle(lineWidth: OddsStyle.line + 1, lineCap: .round, lineJoin: .round))
            }
            var stroke = cleared
            stroke.clip(to: Path(rect))
            stroke.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: OddsStyle.line, lineCap: .round, lineJoin: .round))
        }
    }

    /// Soccer: the three chances stacked to 100%, top win over the draw over
    /// bottom win, 2pt of surface between the bands.
    private func drawStack(_ context: GraphicsContext) {
        let plot = layout.plot
        var clip = context
        clip.clip(to: Path(CGRect(x: plot.minX, y: plot.minY, width: plot.width + 1, height: plot.height)))
        var points = Array(Self.visible(data.stack, time: \.t, domain: data.domain))
        if let head = data.stackHead, !points.isEmpty { points.append(head) }
        guard points.count > 1 else { return }
        let gap: CGFloat = 1
        func band(_ upper: (OddsSplit) -> CGFloat, _ lower: (OddsSplit) -> CGFloat) -> Path {
            var path = Path()
            path.move(to: CGPoint(x: layout.x(points[0].t), y: upper(points[0].split)))
            for p in points.dropFirst() { path.addLine(to: CGPoint(x: layout.x(p.t), y: upper(p.split))) }
            for p in points.reversed() { path.addLine(to: CGPoint(x: layout.x(p.t), y: max(lower(p.split), upper(p.split)))) }
            path.closeSubpath()
            return path
        }
        let b1 = { (s: OddsSplit) in layout.depth(s.top) }
        let b2 = { (s: OddsSplit) in layout.depth(s.top + (s.draw ?? 0)) }
        let fill = OddsStyle.band(scheme)
        clip.fill(band({ _ in plot.minY }, { b1($0) - gap }), with: .color(top.opacity(fill)))
        clip.fill(band({ b1($0) + gap }, { b2($0) - gap }), with: .color(Color.primary.opacity(fill * 0.55)))
        clip.fill(band({ b2($0) + gap }, { _ in plot.maxY }), with: .color(bottom.opacity(fill)))
        // Each team's edge as a line in its color: the stack reads like the
        // tug-of-war's line, the draw the space between the two.
        func edge(_ y: (OddsSplit) -> CGFloat) -> Path {
            var path = Path()
            for (i, p) in points.enumerated() {
                let point = CGPoint(x: layout.x(p.t), y: y(p.split))
                if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            return path
        }
        let style = StrokeStyle(lineWidth: OddsStyle.line, lineCap: .round, lineJoin: .round)
        let cleared = clip.clearing(rooms)
        cleared.stroke(edge { b1($0) - gap }, with: .color(top), style: style)
        cleared.stroke(edge { b2($0) + gap }, with: .color(bottom), style: style)
    }

    /// "Where the books opened": a diamond at the left edge (soccer: one per
    /// outcome, at the middle of where its band would be), with a short
    /// hairline into the plot.
    private func drawDraftKings(_ context: GraphicsContext) {
        guard let dk = data.draftKings else { return }
        let x = layout.plot.minX
        for y in OddsDiamonds.positions(dk, threeWay: data.threeWay, layout: layout) {
            if !data.threeWay {
                var stub = Path()
                stub.move(to: CGPoint(x: x + OddsStyle.dot / 2 + OddsStyle.ring + 1, y: y))
                stub.addLine(to: CGPoint(x: x + 24, y: y))
                context.stroke(stub, with: .color(Viz.reference), lineWidth: 1)
            }
            context.fill(OddsDiamonds.path(at: CGPoint(x: x, y: y)), with: .color(Viz.neutral))
        }
    }
}

/// DraftKings' marks: an 8pt diamond.
enum OddsDiamonds {
    static func path(at c: CGPoint, size: CGFloat = OddsStyle.dot) -> Path {
        let r = size / 2 * 1.1
        var p = Path()
        p.move(to: CGPoint(x: c.x, y: c.y - r))
        p.addLine(to: CGPoint(x: c.x + r, y: c.y))
        p.addLine(to: CGPoint(x: c.x, y: c.y + r))
        p.addLine(to: CGPoint(x: c.x - r, y: c.y))
        p.closeSubpath()
        return p
    }

    /// Where the diamonds sit: the top team's chance on the tug-of-war; soccer,
    /// the middle of each outcome's band as DraftKings splits it.
    static func positions(_ dk: OddsSplit, threeWay: Bool, layout: OddsLayout) -> [CGFloat] {
        guard threeWay, let draw = dk.draw else { return [layout.y(dk.top)] }
        return [layout.depth(dk.top / 2), layout.depth(dk.top + draw / 2), layout.depth(dk.top + draw + dk.bottom / 2)]
    }
}

// MARK: Live end

/// The newest value: the last stretch of the line, the dot and the badge. A
/// new value glides in (0.5 s, then the timeline pauses); while live and on
/// screen a ring pulses from the dot (Core Animation), and a chevron says who
/// is gaining for a few seconds after a move. Reduce Motion: it all just updates.
struct OddsHead: View {
    let data: OddsChartData
    let layout: OddsLayout
    let names: (top: String, bottom: String)
    let top: Color
    let bottom: Color
    let pulsing: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @State private var glide: OddsGlide?
    @State private var rising: OddsMarket.Outcome?
    @State private var momentumTask: Task<Void, Never>?

    #if DEBUG
    /// The performance check: how often the live end draws.
    nonisolated(unsafe) static var frames = 0
    #endif

    private var target: OddsSplit? {
        if data.threeWay { return data.stackHead?.split }
        return data.head.map { OddsSplit(top: $0.p, draw: nil, bottom: 1 - $0.p) }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            timeline
            // Outside the timeline: a glide never moves an AppKit view. It waits at the dot's target, hidden until the dot arrives.
            if pulsing && !reduceMotion, let target {
                pulse(color(target.leader))
                    .frame(width: OddsStyle.pulse, height: OddsStyle.pulse)
                    .position(dotPoint(target))
                    .opacity(glide == nil ? 1 : 0)
            }
        }
        .allowsHitTesting(false)
        .onChange(of: target) { old, new in moved(from: old, to: new) }
    }

    private var timeline: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: glide == nil)) { context in
            let shown = glide.map { $0.done(at: context.date) ? $0.to : $0.value(at: context.date) } ?? target
            if let shown {
                let dot = dotPoint(shown)
                let leader = leader(shown)
                ZStack(alignment: .topLeading) {
                    Canvas { ctx, _ in
                        #if DEBUG
                        Self.frames += 1
                        #endif
                        draw(ctx, shown: shown, dot: dot, leader: leader)
                    }
                    if let rising = shownRising {
                        Image(systemName: rising == .bottom ? "chevron.down" : "chevron.up")
                            .font(.system(size: 7, weight: .heavy))
                            .foregroundStyle(color(rising))
                            .position(x: dot.x, y: rising == .bottom ? dot.y + 11 : dot.y - 11)
                            .transition(.opacity)
                    }
                }
                .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: rising)
            }
        }
    }

    private func moved(from old: OddsSplit?, to new: OddsSplit?) {
        guard let old, let new, !data.final else { glide = nil; return }
        // From what's on screen now, so a value arriving mid-glide never jumps.
        let from = glide.map { $0.value(at: .now) } ?? old
        // Most ticks move the dot less than a point: nothing to see glide, so no frames for it.
        let distance = max(abs(layout.y(new.top) - layout.y(from.top)), abs(layout.depth(new.top + (new.draw ?? 0)) - layout.depth(from.top + (from.draw ?? 0))))
        if !reduceMotion, distance >= 1 {
            let next = OddsGlide(from: from, to: new, start: .now)
            glide = next
            Task {
                try? await Task.sleep(for: .seconds(OddsStyle.glide + 0.02))
                if glide == next { glide = nil }
            }
        }
        // Who's gaining: the outcome whose chance rose the most.
        let gains: [(OddsMarket.Outcome, Double)] = [(.top, new.top - old.top), (.bottom, new.bottom - old.bottom)]
            + (new.draw.map { [(.draw, $0 - (old.draw ?? $0))] } ?? [])
        guard let best = gains.max(by: { $0.1 < $1.1 }), best.1 >= 0.002 else { return }
        rising = best.0
        momentumTask?.cancel()
        momentumTask = Task {
            try? await Task.sleep(for: OddsStyle.momentum)
            guard !Task.isCancelled else { return }
            rising = nil
        }
    }

    private func leader(_ s: OddsSplit) -> OddsMarket.Outcome { s.leader }

    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    private var shownRising: OddsMarket.Outcome? { harness?.rising ?? rising }
    @ViewBuilder
    private func pulse(_ color: Color) -> some View {
        if let harness, harness.stills {
            if let phase = harness.pulse {
                Circle().stroke(color, lineWidth: 1.5)
                    .scaleEffect(OddsStyle.dot / OddsStyle.pulse + (1 - OddsStyle.dot / OddsStyle.pulse) * phase)
                    .opacity(0.7 * (1 - phase))
            }
        } else {
            OddsPulse(color: color)
        }
    }
    #else
    private var shownRising: OddsMarket.Outcome? { rising }
    private func pulse(_ color: Color) -> some View { OddsPulse(color: color) }
    #endif

    private func color(_ outcome: OddsMarket.Outcome) -> Color {
        switch outcome {
        case .top: top
        case .draw: Viz.neutral
        case .bottom: bottom
        }
    }

    private func dotPoint(_ s: OddsSplit) -> CGPoint {
        let x = layout.x(data.headTime ?? layout.domain.upperBound)
        if data.threeWay {
            let draw = s.draw ?? 0
            let y: CGFloat = switch s.leader {
            case .top: layout.depth(s.top / 2)
            case .draw: layout.depth(s.top + draw / 2)
            case .bottom: layout.depth(s.top + draw + s.bottom / 2)
            }
            return CGPoint(x: x, y: y)
        }
        return CGPoint(x: x, y: layout.y(s.top))
    }

    private func draw(_ ctx: GraphicsContext, shown: OddsSplit, dot: CGPoint, leader: OddsMarket.Outcome) {
        let room = Clearance(dot, radius: OddsStyle.dot / 2 + OddsStyle.ring)
        // The last stretch of the line, from the newest point before it.
        if !data.threeWay, data.line.count > 1 {
            let previous = data.line[data.line.count - 2]
            var path = Path()
            path.move(to: CGPoint(x: layout.x(previous.t), y: layout.y(previous.p)))
            path.addLine(to: dot)
            let cleared = ctx.clearing([room])
            let halves = layout.halves
            for (rect, color) in [(halves.top, top), (halves.bottom, bottom)] {
                var side = cleared
                side.clip(to: Path(rect))
                side.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: OddsStyle.line, lineCap: .round, lineJoin: .round))
            }
        }
        // The dot, in the leading side's color (a three-way final ends on its bands alone).
        if data.threeWay && data.final { return }
        let r = OddsStyle.dot / 2
        ctx.fill(Path(ellipseIn: CGRect(x: dot.x - r, y: dot.y - r, width: r * 2, height: r * 2)), with: .color(color(leader)))
        // The badge: a pill beside the dot with a tail pointing at it (live and before the game; a final's header says it).
        guard !data.final else { return }
        let frame = layout.badge(at: dot)
        let fill = color(leader)
        ctx.fill(OddsBadge.path(frame, pointingAt: dot), with: .color(fill))
        let name = leader == .top ? names.top : leader == .bottom ? names.bottom : "Draw"
        let label = Text("\(name) \(OddsSeries.percent(shown.share(leader), final: data.final))%")
            .font(OddsStyle.badgeFont)
            .foregroundStyle(OddsStyle.ink(on: fill))
        ctx.draw(label, at: CGPoint(x: frame.midX, y: frame.midY), anchor: .center)
    }
}

/// The badge's shape: a capsule with a small tail on its left edge, pointing
/// at the dot (its tip clamped to the capsule's straight edge when the badge
/// is held inside the plot at the top or bottom).
enum OddsBadge {
    static func path(_ frame: CGRect, pointingAt dot: CGPoint) -> Path {
        var p = Path(roundedRect: frame, cornerRadius: frame.height / 2, style: .continuous)
        let r = frame.height / 2
        let y = min(max(dot.y, frame.minY + r * 0.6), frame.maxY - r * 0.6)
        var tail = Path()
        tail.move(to: CGPoint(x: frame.minX + r * 0.6, y: y - 3.5))
        tail.addLine(to: CGPoint(x: frame.minX - 4, y: y))
        tail.addLine(to: CGPoint(x: frame.minX + r * 0.6, y: y + 3.5))
        tail.closeSubpath()
        p.addPath(tail)
        return p
    }
}

/// The live end's pulse: a ring growing from the dot to 22pt and fading,
/// every 1.6 s. A Core Animation layer: the window server draws it, SwiftUI
/// never re-renders for it. Only while live, on screen and in a shown panel.
struct OddsPulse: NSViewRepresentable {
    let color: Color

    func makeNSView(context: Context) -> NSView {
        let view = PassThroughView()
        view.wantsLayer = true
        let size = OddsStyle.pulse
        let ring = CAShapeLayer()
        ring.name = "ring"
        ring.fillColor = nil
        ring.lineWidth = 1.5
        ring.opacity = 0
        ring.frame = CGRect(x: 0, y: 0, width: size, height: size)
        ring.path = CGPath(ellipseIn: CGRect(x: 0.75, y: 0.75, width: size - 1.5, height: size - 1.5), transform: nil)
        view.layer?.addSublayer(ring)
        let grow = CABasicAnimation(keyPath: "transform.scale")
        grow.fromValue = OddsStyle.dot / size
        grow.toValue = 1
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0.7
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [grow, fade]
        group.duration = 1.1
        group.timingFunction = CAMediaTimingFunction(controlPoints: 0.23, 1, 0.32, 1)
        let cycle = CAAnimationGroup()
        cycle.animations = [group]
        cycle.duration = OddsStyle.pulsePeriod
        cycle.repeatCount = .infinity
        cycle.isRemovedOnCompletion = false
        ring.add(cycle, forKey: "pulse")
        return view
    }

    /// Runs on every frame the dot glides (it moves the view): only a new color touches the layer.
    func updateNSView(_ view: NSView, context: Context) {
        guard let ring = view.layer?.sublayers?.first(where: { $0.name == "ring" }) as? CAShapeLayer else { return }
        let stroke = NSColor(color).cgColor
        guard ring.strokeColor.map({ $0 != stroke }) ?? true else { return }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        ring.strokeColor = stroke
        CATransaction.commit()
    }
}

// MARK: Scrub

/// Pointing (or keyboard focus, then ← →) snaps a 1pt crosshair to the
/// nearest minute and reads every series there in one tooltip, values first:
/// "MIN 62%  Polymarket", "MIN 58%  ESPN", the game clock and the wall time,
/// and the nearest play. Only this layer re-renders on a move.
struct OddsScrub: View {
    let data: OddsChartData
    let layout: OddsLayout
    let baseline: OddsBaseline
    let names: (top: String, bottom: String)
    let top: Color
    let bottom: Color
    @Binding var scrubbing: Bool
    @State private var moment: Date?
    @FocusState private var focused: Bool
    @Environment(\.colorScheme) private var scheme

    private var dataRange: ClosedRange<Date>? {
        let times = data.threeWay ? data.stack.map(\.t) : data.line.map(\.t)
        guard let last = times.last else { return nil }
        let first = max(times.first ?? last, data.domain.lowerBound)
        return min(first, last)...last
    }

    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    private var shownMoment: Date? { harness?.moment ?? moment }
    #else
    private var shownMoment: Date? { moment }
    #endif

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let moment = shownMoment, let reading = OddsReading.at(moment, data: data, baseline: baseline) {
                crosshair(reading)
                OddsTooltip(reading: reading, names: names, top: top, bottom: bottom, threeWay: data.threeWay)
                    .fixedSize()
                    .modifier(OddsTooltipPlacement(x: layout.x(reading.t), layout: layout,
                                                   below: reading.split.map { layout.y($0.top) < layout.bounds.midY } ?? false))
            }
        }
        .frame(width: layout.bounds.width, height: layout.bounds.height + OddsStyle.axis, alignment: .topLeading)
        .contentShape(Rectangle())
        .onContinuousHover { phase in
            guard let range = dataRange else { return }
            switch phase {
            case let .active(location):
                let next = layout.snap(x: location.x, within: range)
                if next != moment { moment = next }
            case .ended:
                if !focused { moment = nil }
            }
        }
        // Keyboard focus (Tab, with keyboard navigation on), never a click: a click shouldn't pin the scrub.
        .focusable(interactions: .activate)
        .focusEffectDisabled()
        .focused($focused)
        .onChange(of: focused) { _, on in moment = on ? dataRange?.upperBound : nil }
        .onKeyPress(.leftArrow) { step(-1) }
        .onKeyPress(.rightArrow) { step(1) }
        .onKeyPress(.escape) {
            guard moment != nil else { return .ignored }
            moment = nil
            return .handled
        }
        .onChange(of: shownMoment != nil, initial: true) { _, on in if scrubbing != on { scrubbing = on } }
    }

    private func step(_ minutes: Double) -> KeyPress.Result {
        guard let range = dataRange else { return .ignored }
        let from = moment ?? range.upperBound
        let t = Date(timeIntervalSince1970: ((from.timeIntervalSince1970 / 60).rounded() + minutes) * 60)
        moment = min(max(t, range.lowerBound), range.upperBound)
        return .handled
    }

    private func crosshair(_ r: OddsReading) -> some View {
        Canvas { ctx, _ in
            let x = layout.x(r.t)
            var rule = Path()
            rule.move(to: CGPoint(x: x, y: layout.plot.minY - 6))
            rule.addLine(to: CGPoint(x: x, y: layout.plot.maxY + 6))
            ctx.stroke(rule, with: .color(Viz.reference), lineWidth: 1)
            if let espn = r.espn, !data.threeWay {
                let p = CGPoint(x: x, y: layout.y(espn))
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 3, y: p.y - 3, width: 6, height: 6)), with: .color(OddsStyle.espn(scheme)))
            }
            if let s = r.split, !data.threeWay {
                let p = CGPoint(x: x, y: layout.y(s.top))
                let color = s.top >= 0.5 ? top : bottom
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 3.5, y: p.y - 3.5, width: 7, height: 7)), with: .color(color))
            }
        }
        .allowsHitTesting(false)
    }
}

/// Every series at one moment, for the tooltip. (pure; tested)
struct OddsReading: Equatable {
    let t: Date
    /// Polymarket's chances then.
    let split: OddsSplit?
    /// ESPN's chance for the top team then.
    let espn: Double?
    let play: OddsPlay?

    static func at(_ t: Date, data: OddsChartData, baseline: OddsBaseline) -> OddsReading? {
        let split: OddsSplit?
        if data.threeWay {
            let i = OddsSeries.index(data.stack.map(\.t), atOrBefore: t) ?? (data.stack.isEmpty ? nil : 0)
            split = i.map { data.stack[$0].split }
        } else {
            let p = OddsSeries.value(data.line, at: t) ?? data.line.first?.p
            split = p.map { OddsSplit(top: $0, draw: nil, bottom: 1 - $0) }
        }
        guard split != nil else { return nil }
        let espn = (baseline.start.map { t >= $0 } ?? false) ? baseline.espn(at: t) : nil
        // The nearest play, if one is near (not across halftime's gap).
        let play = baseline.play(near: t).flatMap { abs($0.t.timeIntervalSince(t)) <= 150 ? $0 : nil }
        return OddsReading(t: t, split: split, espn: data.espn.isEmpty ? nil : espn, play: play)
    }

    /// "Q3 4:12 · 9:41 PM"; before the game, the wall time alone (with the day when it isn't today).
    func when(now: Date = .now) -> String {
        let time = Calendar.current.isDate(t, inSameDayAs: now)
            ? t.formatted(date: .omitted, time: .shortened)
            : t.formatted(.dateTime.weekday(.abbreviated).hour().minute())
        guard let clock = play?.clock, !clock.isEmpty else { return time }
        return "\(clock) · \(time)"
    }
}

/// The tooltip's card: the moment, each series (a line key, the value in
/// strong ink, the source in secondary), then the play.
struct OddsTooltip: View {
    let reading: OddsReading
    let names: (top: String, bottom: String)
    let top: Color
    let bottom: Color
    let threeWay: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(reading.when())
                .font(.system(size: 9.5, weight: .medium).monospacedDigit())
                .foregroundStyle(.secondary)
            if let s = reading.split {
                if threeWay {
                    // One source (the caption and legend say Polymarket): the three values alone.
                    row(top, "\(names.top) \(OddsSeries.percent(s.top))%", "")
                    row(Viz.neutral, "Draw \(OddsSeries.percent(s.draw ?? 0))%", "")
                    row(bottom, "\(names.bottom) \(OddsSeries.percent(s.bottom))%", "")
                } else {
                    // Both rows for the side Polymarket favored then.
                    let leadsTop = s.top >= 0.5
                    let name = leadsTop ? names.top : names.bottom
                    row(leadsTop ? top : bottom, "\(name) \(OddsSeries.percent(leadsTop ? s.top : s.bottom))%", "Polymarket")
                    if let espn = reading.espn {
                        row(OddsStyle.espn(scheme), "\(name) \(OddsSeries.percent(leadsTop ? espn : 1 - espn))%", "ESPN")
                    }
                }
            }
            if let play = reading.play?.text, !play.isEmpty {
                Text(play)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .frame(maxWidth: OddsStyle.tooltipWidth - 16, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 1)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(scheme == .dark ? Color(white: 0.15).opacity(0.97) : Color.white.opacity(0.97))
                .shadow(color: .black.opacity(scheme == .dark ? 0.35 : 0.12), radius: 6, y: 2)
        }
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.primary.opacity(0.10), lineWidth: 0.5))
        .allowsHitTesting(false)
    }

    private func row(_ key: Color, _ value: String, _ source: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Capsule().fill(key).frame(width: 10, height: 2).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 3 }
            Text(value).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(.primary)
            if !source.isEmpty { Text(source).font(.system(size: 10)).foregroundStyle(.secondary) }
        }
    }
}

/// Puts the tooltip beside the crosshair (right of it, or left near the right
/// edge), at the top of the plot, or the bottom when the line is up there.
private struct OddsTooltipPlacement: ViewModifier {
    let x: CGFloat
    let layout: OddsLayout
    let below: Bool

    func body(content: Content) -> some View {
        content.alignmentGuide(.leading) { d in
            let right = x + 10, left = x - 10 - d.width
            let fitsRight = right + d.width <= layout.bounds.maxX
            return -(fitsRight ? right : max(left, layout.bounds.minX))
        }
        .alignmentGuide(.top) { d in
            -(below ? layout.plot.maxY - d.height + 4 : layout.plot.minY - 4)
        }
    }
}

// MARK: - Footer

/// The legend (line keys for Polymarket and ESPN, the diamond for
/// DraftKings), then where it comes from: freshness while live, the money
/// traded, and the market on Polymarket.
struct OddsFooter: View {
    let feed: OddsFeed
    let baseline: OddsBaseline
    let names: (top: String, bottom: String)
    let palette: TeamPalette
    let live: Bool
    /// The freshness ticks once a second only while the chart is on screen.
    let ticking: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let threeWay = feed.market?.threeWay ?? false
        VStack(alignment: .leading, spacing: 4) {
            VizLegend {
                if threeWay {
                    LegendItem(label: "\(names.top) win") { band(palette.top) }
                    LegendItem(label: "Draw") { band(Viz.neutral) }
                    LegendItem(label: "\(names.bottom) win") { band(palette.bottom) }
                } else {
                    LegendItem(label: "Polymarket") {
                        HStack(spacing: 0) {
                            Rectangle().fill(palette.top).frame(width: 6, height: 2)
                            Rectangle().fill(palette.bottom).frame(width: 6, height: 2)
                        }
                        .clipShape(Capsule())
                    }
                    if !baseline.espn.isEmpty {
                        LegendItem(label: "ESPN") { Capsule().fill(OddsStyle.espn(scheme)).frame(width: 12, height: 2) }
                    }
                }
                if baseline.draftKings != nil {
                    LegendItem(label: "DraftKings") { Canvas { ctx, size in
                        ctx.fill(OddsDiamonds.path(at: CGPoint(x: size.width / 2, y: size.height / 2), size: 7), with: .color(Viz.neutral))
                    }.frame(width: 9, height: 9) }
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                OddsFreshness(feed: feed, live: live, ticking: ticking, volume: feed.market?.volume)
                Spacer(minLength: 8)
                if let link = feed.market?.link {
                    SectionLink("Polymarket", symbol: "arrow.up.right", help: "Open this market on Polymarket") {
                        NSWorkspace.shared.open(link)
                    }
                }
            }
        }
    }

    private func band(_ color: Color) -> some View {
        RoundedRectangle(cornerRadius: 1.5).fill(color.opacity(0.45)).frame(width: 10, height: 8)
    }
}

/// "Live · 4s · $4.1M traded" (TheaterHeartbeat's wording), or just the
/// money once it's over. Ticks once a second only while live and on screen.
struct OddsFreshness: View {
    let feed: OddsFeed
    let live: Bool
    let ticking: Bool
    let volume: Double?

    var body: some View {
        let traded = volume.map { "\(OddsSeries.dollars($0)) traded" }
        Group {
            if live, ticking, let heard = feed.heard {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let seconds = max(Int(context.date.timeIntervalSince(heard)), 0)
                    Text([TheaterHeartbeat.label(seconds: seconds, source: "Polymarket"), traded].compactMap { $0 }.joined(separator: " · "))
                }
            } else {
                Text(traded ?? "")
            }
        }
        .font(Viz.legend.monospacedDigit())
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
}

// MARK: - Accessibility

/// The chart as data for VoiceOver's audio graph: the top team's chance from
/// Polymarket and from ESPN, by minute of the game.
struct OddsChartDescriptor: AXChartDescriptorRepresentable {
    let data: OddsChartData?
    let top: String
    let bottom: String

    func makeChartDescriptor() -> AXChartDescriptor {
        let start = data?.domain.lowerBound ?? .now
        let minutes = max((data?.domain.upperBound.timeIntervalSince(start) ?? 60) / 60, 1)
        let x = AXNumericDataAxisDescriptor(title: "Minutes", range: 0...minutes, gridlinePositions: []) { "\(Int($0)) minutes in" }
        let y = AXNumericDataAxisDescriptor(title: "\(top)'s chance", range: 0...100, gridlinePositions: [50]) { "\(Int($0.rounded())) percent" }
        func series(_ name: String, _ points: [OddsPoint]) -> AXDataSeriesDescriptor {
            let inside = points.filter { $0.t >= start }
            let step = max(inside.count / 120, 1)
            let thinned = stride(from: 0, to: inside.count, by: step).map { inside[$0] }
            return AXDataSeriesDescriptor(name: name, isContinuous: true, dataPoints: thinned.map {
                AXDataPoint(x: $0.t.timeIntervalSince(start) / 60, y: $0.p * 100)
            })
        }
        var all: [AXDataSeriesDescriptor] = []
        if let data {
            if data.threeWay {
                all.append(series("Polymarket, \(top) win", data.stack.map { OddsPoint(t: $0.t, p: $0.split.top) }))
                all.append(series("Polymarket, draw", data.stack.map { OddsPoint(t: $0.t, p: $0.split.draw ?? 0) }))
                all.append(series("Polymarket, \(bottom) win", data.stack.map { OddsPoint(t: $0.t, p: $0.split.bottom) }))
            } else {
                all.append(series("Polymarket", data.line))
                if !data.espn.isEmpty { all.append(series("ESPN", data.espn)) }
            }
        }
        return AXChartDescriptor(title: "Win probability", summary: nil, xAxis: x, yAxis: y, additionalAxes: [], series: all)
    }
}
