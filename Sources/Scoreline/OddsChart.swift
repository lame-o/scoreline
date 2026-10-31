import Accessibility
import AppKit
import SwiftUI

// The Win Probability section, following Polymarket: one line per outcome on
// a fixed 0–100% scale, each in its team's color (soccer's draw in a neutral
// that recedes toward the surface), each ending in a dot and a label that
// dodges its neighbors as a cluster. The legend above is every outcome's
// chance, with ESPN's model and DraftKings' pregame line as one muted line of
// numbers under it; pointing reads that minute into the legend, the sources
// line and the footer, so nothing covers the lines.
//
// Every line is live while the market is (Liveline's feel, in the app's own
// type and colors): a new value glides its end in, on one 0.5 s clock for
// every line, then the timeline pauses; every end pulses on one shared phase
// (Core Animation, not a redraw loop), and the outcome that just moved gets
// one brighter beat. The still layer (the grid, the lines up to their newest
// points) redraws when the data does, never for a glide, a pulse or a scrub.

// MARK: - Style

enum OddsStyle {
    /// The 0/50/100 labels' column at the left.
    static let gutter: CGFloat = 30
    /// Room above 100% and below 0%, so the end dots stay whole.
    static let inset: CGFloat = 10
    /// The period names under the plot.
    static let axis: CGFloat = 15
    static let dot: CGFloat = 8
    /// A final's ends: smaller, as nothing more is coming.
    static let finalDot: CGFloat = 6
    static let line: CGFloat = 2
    static let glide: TimeInterval = 0.5
    /// The pulse: from the dot to this, every `pulsePeriod`.
    static let pulse: CGFloat = 22
    static let pulsePeriod: CFTimeInterval = 1.6
    /// From an end dot's center to its label: the dot, then room for a leader.
    static let labelGap: CGFloat = 13
    /// One label's line: dodged labels keep their centers this far apart.
    static let labelHeight: CGFloat = 13
    static let labelFont = Font.system(size: 10.5, weight: .semibold).monospacedDigit()
    /// Team lines keep at least this much OKLCH chroma.
    static let chroma = 0.10

    static func plotHeight(_ width: WidthClass) -> CGFloat { width >= .large ? 150 : 124 }
    static func dot(final: Bool) -> CGFloat { final ? finalDot : dot }

    /// The end labels' column, sized for the widest label it can show ("Draw
    /// 100%"), so the plot's width never changes as the values do.
    static func labelWidth(_ names: [String]) -> CGFloat {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 10.5, weight: .semibold)
        let widest = names.map { ("\($0) 100%" as NSString).size(withAttributes: [.font: font]).width }.max() ?? 40
        return widest.rounded(.up) + 1
    }

    /// Soccer's draw is "neither team", so it recedes toward the surface: each
    /// mode's own step, validated on the chart well (light #aeaeae, dark #5d5d5d).
    static func draw(_ scheme: ColorScheme) -> Color { Color(.sRGB, white: (scheme == .dark ? 93 : 174) / 255.0) }

    /// A team's line: its palette color, held to at least 0.10 chroma (City's
    /// sky blue, toned for the light panel, reads gray at 0.07). Exactly 0.10,
    /// no more: any further and City's sky blue on dark falls under ΔE 15
    /// from Brighton's blue. A color shown honestly as gray stays gray. (pure; tested)
    static func line(_ color: Color) -> Color {
        guard color != Viz.neutral, let lab = OKLab(NSColor(color)), lab.chroma >= 0.03, lab.chroma < chroma else { return color }
        return Color(nsColor: OKLab(l: lab.l, chroma: chroma, hue: lab.hue).nsColor)
    }
}

/// Which stretch of the game the chart shows.
enum OddsWindow: String, CaseIterable, Identifiable {
    case game, recent
    var id: String { rawValue }
    var label: String { self == .game ? "Game" : "10 min" }
}

// MARK: - Data

/// Every outcome's chance at one moment.
struct OddsSplitPoint: Equatable {
    let t: Date
    let split: OddsSplit
}

/// One outcome's line: what it's called and its color.
struct OddsLine: Equatable, Identifiable {
    let outcome: OddsMarket.Outcome
    let name: String
    let color: Color
    var id: OddsMarket.Outcome { outcome }

    /// The order they're drawn in: the draw beneath the teams, the top team over all.
    static func drawn(_ lines: [OddsLine]) -> [OddsLine] {
        let rank: [OddsMarket.Outcome: Int] = [.draw: 0, .bottom: 1, .top: 2]
        return lines.sorted { rank[$0.outcome, default: 0] < rank[$1.outcome, default: 0] }
    }
}

/// What the plot draws, worked out once per change of the feed or the page:
/// every outcome's chance over time (US: the top team's price and its
/// complement; soccer: the three, normalized), ESPN's line for the readings,
/// the span of time shown. The last point is the live end, drawn and glided
/// apart from the rest.
struct OddsChartData: Equatable {
    var revision: Int
    var threeWay: Bool
    var points: [OddsSplitPoint] = []
    var espn: [OddsPoint] = []
    var periods: [OddsPeriod] = []
    var domain: ClosedRange<Date>
    var live: Bool
    var final: Bool

    var head: OddsSplitPoint? { points.last }
    var isEmpty: Bool { points.isEmpty }

    /// The split in effect at `t` (before the first point, the first's). (pure)
    func split(at t: Date) -> OddsSplit? {
        guard let first = points.first else { return nil }
        var lo = 0, hi = points.count - 1, found: Int?
        while lo <= hi {
            let mid = (lo + hi) / 2
            if points[mid].t <= t { found = mid; lo = mid + 1 } else { hi = mid - 1 }
        }
        return found.map { points[$0].split } ?? first.split
    }

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
            data.points = OddsSeries.stacked(top: feed.series[.top] ?? [], draw: feed.series[.draw] ?? [],
                                             bottom: feed.series[.bottom] ?? []).map { OddsSplitPoint(t: $0.t, split: $0.split) }
        } else {
            data.points = (feed.series[.top] ?? []).map { OddsSplitPoint(t: $0.t, split: OddsSplit(top: $0.p, draw: nil, bottom: 1 - $0.p)) }
        }
        data.domain = domain(state: state, window: window, start: start, end: state == .final ? baseline.end : nil,
                             first: data.points.first?.t, last: data.points.last?.t, now: now)
        // The end of a finished game is its last play: nothing after the buzzer.
        if state == .final { data.points = data.points.filter { $0.t <= data.domain.upperBound } }
        data.espn = state == .scheduled ? [] : baseline.espn
        data.periods = state == .scheduled ? [] : baseline.periods
        return data
    }
}

extension OddsSplit {
    /// The outcomes it splits, in the legend's order.
    var outcomes: [OddsMarket.Outcome] { draw == nil ? [.top, .bottom] : [.top, .draw, .bottom] }

    /// Each outcome's whole percent, always summing to 100: largest remainder,
    /// ties to the bigger chance, so two-way the trailing side is exactly 100
    /// minus the leader (never 98 + 3, or 53 + 48). Never 0 or 100 while it's
    /// undecided: those are for the final whistle. (pure; tested)
    func percents(final: Bool = false) -> [OddsMarket.Outcome: Int] {
        let shares = outcomes.map { max(share($0), 0) }
        let total = shares.reduce(0, +)
        let exact = shares.map { total > 0 ? $0 / total * 100 : 100 / Double(shares.count) }
        var whole = exact.map { Int($0.rounded(.down)) }
        let remainders = zip(exact, whole).map { $0 - Double($1) }
        let order = exact.indices.sorted { a, b in
            if abs(remainders[a] - remainders[b]) > 1e-9 { return remainders[a] > remainders[b] }
            return exact[a] != exact[b] ? exact[a] > exact[b] : a < b
        }
        for i in order.prefix(max(100 - whole.reduce(0, +), 0)) { whole[i] += 1 }
        if !final {
            // Held off 0 and 100; what that adds comes off the biggest.
            whole = whole.map { min(max($0, 1), 99) }
            while whole.reduce(0, +) > 100, let i = whole.indices.max(by: { whole[$0] < whole[$1] }) { whole[i] -= 1 }
        }
        return Dictionary(uniqueKeysWithValues: zip(outcomes, whole))
    }
}

// MARK: - Geometry

/// Where everything sits in the plot (pure; tested): time across, a chance up
/// (100% at the top), with the end labels' column at the right and room above
/// and below for the dots.
struct OddsLayout: Equatable {
    /// The plot's area: the 0/50/100 gutter left of it, the end labels' column right of it.
    let plot: CGRect
    /// The whole drawing area (the axis band below `plotHeight` excluded).
    let bounds: CGRect
    let domain: ClosedRange<Date>
    let labelWidth: CGFloat

    init(size: CGSize, plotHeight: CGFloat, domain: ClosedRange<Date>, labelWidth: CGFloat) {
        self.domain = domain
        self.labelWidth = labelWidth
        bounds = CGRect(x: 0, y: 0, width: size.width, height: plotHeight)
        let right = OddsStyle.labelGap + labelWidth + 4
        plot = CGRect(x: OddsStyle.gutter, y: OddsStyle.inset, width: max(size.width - OddsStyle.gutter - right, 1),
                      height: max(plotHeight - OddsStyle.inset * 2, 1))
    }

    private var span: TimeInterval { max(domain.upperBound.timeIntervalSince(domain.lowerBound), 1) }

    func x(_ t: Date) -> CGFloat { plot.minX + plot.width * CGFloat(t.timeIntervalSince(domain.lowerBound) / span) }
    /// A chance: 100% at the top, 0% at the bottom.
    func y(_ p: Double) -> CGFloat { plot.minY + plot.height * CGFloat(1 - min(max(p, 0), 1)) }

    func time(at x: CGFloat) -> Date { domain.lowerBound + TimeInterval((x - plot.minX) / plot.width) * span }

    /// The scrub's moment: the nearest whole minute, kept within the data.
    func snap(x: CGFloat, within data: ClosedRange<Date>) -> Date {
        let t = time(at: x).timeIntervalSince1970
        let minute = Date(timeIntervalSince1970: (t / 60).rounded() * 60)
        return min(max(minute, data.lowerBound), data.upperBound)
    }

    /// Where an outcome's line ends: at the plot's right edge (a final's last
    /// price holds to its last play).
    func end(_ split: OddsSplit, _ outcome: OddsMarket.Outcome) -> CGPoint {
        CGPoint(x: plot.maxX, y: y(split.share(outcome)))
    }

    /// The end labels' leading edge.
    var labelX: CGFloat { plot.maxX + OddsStyle.labelGap }

    /// Every end's label, beside its dot, then dodged, kept whole inside the drawing area.
    func endLabels(_ split: OddsSplit, outcomes: [OddsMarket.Outcome]) -> [OddsEndLabel] {
        let dots = outcomes.map { end(split, $0) }
        let half = OddsStyle.labelHeight / 2
        let ys = Self.dodge(dots.map(\.y), gap: OddsStyle.labelHeight, within: (bounds.minY + half)...(bounds.maxY - half))
        return outcomes.indices.map { OddsEndLabel(outcome: outcomes[$0], dot: dots[$0], y: ys[$0]) }
    }

    /// Label centers after dodging (pure; tested): labels that would overlap
    /// merge into a cluster centered on their lines' mean, `gap` apart in their
    /// lines' order (a tie keeps the given order), held within `range`.
    static func dodge(_ ideal: [CGFloat], gap: CGFloat, within range: ClosedRange<CGFloat>) -> [CGFloat] {
        struct Cluster {
            var members: [Int]
            var top: CGFloat
        }
        func cluster(_ members: [Int]) -> Cluster {
            let mean = members.enumerated().map { ideal[$0.element] - CGFloat($0.offset) * gap }.reduce(0, +) / CGFloat(members.count)
            let height = CGFloat(members.count - 1) * gap
            return Cluster(members: members, top: min(max(mean, range.lowerBound), range.upperBound - height))
        }
        let order = ideal.indices.sorted { ideal[$0] != ideal[$1] ? ideal[$0] < ideal[$1] : $0 < $1 }
        var clusters = order.map { cluster([$0]) }
        var i = 0
        while i + 1 < clusters.count {
            let a = clusters[i], b = clusters[i + 1]
            if a.top + CGFloat(a.members.count) * gap > b.top + 0.01 {
                clusters.replaceSubrange(i...(i + 1), with: [cluster(a.members + b.members)])
                // Re-centered, it may now reach the cluster above.
                i = max(i - 1, 0)
            } else {
                i += 1
            }
        }
        var placed = ideal
        for c in clusters { for (k, m) in c.members.enumerated() { placed[m] = c.top + CGFloat(k) * gap } }
        return placed
    }
}

/// One end's label: where its line ends, and its center after dodging.
struct OddsEndLabel: Equatable {
    let outcome: OddsMarket.Outcome
    let dot: CGPoint
    let y: CGFloat
    /// Moved off its line: a hairline leads back to it.
    var displaced: Bool { abs(y - dot.y) > 2 }
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

/// When the ends move, and which one beats. (pure; tested)
enum OddsMotion {
    /// Every end is live (pulsing, beating) while the market streams and the
    /// chart is seen; a final, a market not streaming yet, a hidden chart or
    /// Reduce Motion keep still dots.
    static func live(final: Bool, streaming: Bool, seen: Bool, reduceMotion: Bool) -> Bool {
        !final && streaming && seen && !reduceMotion
    }

    /// The outcome that just moved, for its brighter beat: the biggest change
    /// (to a hundredth of a point), a tie to the one that rose. Two-way, the
    /// side gaining.
    static func mover(from old: OddsSplit, to new: OddsSplit) -> OddsMarket.Outcome? {
        let changes = new.outcomes.map { ($0, ((new.share($0) - old.share($0)) * 10_000).rounded()) }
        guard let best = changes.max(by: { (abs($0.1), $0.1) < (abs($1.1), $1.1) }), best.1 != 0 else { return nil }
        return best.0
    }

    /// When a beat asked for at `t` plays: the next beat of the shared pulse
    /// (every pulse breathes from `epoch`), so dots never fall out of step.
    static func beat(after t: CFTimeInterval, epoch: CFTimeInterval) -> CFTimeInterval {
        epoch + (max(t - epoch, 0) / OddsStyle.pulsePeriod).rounded(.up) * OddsStyle.pulsePeriod
    }
}

#if DEBUG
/// The render harness: on screen without a scroll view, a scrub moment, and
/// the pulses as still rings (ImageRenderer can't draw AppKit layers).
struct OddsHarness {
    var moment: Date?
    /// The pulses' phase (0…1, the ring's growth) to draw, or nil for none.
    var pulse: Double?
    /// The outcome whose dot shows its brighter beat (at `pulse`'s phase).
    var beat: OddsMarket.Outcome?
    var window: OddsWindow?
    /// Stills (ImageRenderer): likenesses for the AppKit pieces. Off for the
    /// live window the performance check hosts (the real pulses and control).
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

// MARK: - Pointing

/// The minute being read, shared by the scrub (which sets it) and the legend,
/// the sources line and the footer (which read it). An object of its own, so
/// a move re-renders only those readers, never the section or the plot.
@MainActor
@Observable
final class OddsPointer {
    private(set) var moment: Date?
    /// Whether a minute is being read: flips only as reading starts and ends
    /// (the live ends step back).
    private(set) var active = false

    func read(_ t: Date?) {
        if moment != t { moment = t }
        if active != (t != nil) { active = t != nil }
    }
}

/// Hands its content the minute being read (the render harness's, when it sets one).
struct OddsMoment<Content: View>: View {
    let pointer: OddsPointer
    @ViewBuilder let content: (Date?) -> Content
    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    var body: some View { content(harness?.moment ?? pointer.moment) }
    #else
    var body: some View { content(pointer.moment) }
    #endif
}

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
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var window = OddsWindow.game
    @State private var onScreen = false
    @State private var pointer = OddsPointer()
    /// On a match page: folded, the header says each side's chance.
    @Environment(\.moduleChrome) private var module
    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    private var visible: Bool { onScreen || harness != nil }
    #else
    private var visible: Bool { onScreen }
    #endif

    private var live: Bool { event.state == .live }
    private var final: Bool { event.state == .final }
    private var threeWay: Bool { feed.market?.threeWay ?? false }
    /// The market's channel is open (before the game too): its lines are live.
    private var streaming: Bool { feed.connection == .live || feed.connection == .polling }

    var body: some View {
        let data = OddsChartData.make(feed: feed, baseline: baseline, state: event.state, window: live ? shownWindow : .game,
                                      eventStart: event.start)
        let lines = self.lines
        OddsSectionChrome(title: final ? "How the Odds Moved" : "Win Probability", caption: caption, accessory: accessory,
                          glance: glance) {
            if live { windowControl }
        } content: {
            VStack(alignment: .leading, spacing: 0) {
                OddsHeader(data: data, latest: data?.head?.split ?? feed.latest, lines: lines, baseline: baseline, names: names,
                           state: event.state, espnNow: baseline.espn.last?.p ?? espnNow, pointer: pointer)
                OddsPlot(data: data, lines: lines, pointer: pointer, spoken: spoken,
                         live: OddsMotion.live(final: final, streaming: streaming, seen: visible && pageLive, reduceMotion: reduceMotion))
                    .padding(.top, 8)
                OddsFooter(feed: feed, data: data, baseline: baseline, pointer: pointer, live: live, ticking: visible && pageLive)
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

    /// Folded, the legend in a line: each side's chance, keyed by its color (the feed stays live while the header's on screen).
    private var glance: ModuleGlance? {
        guard module?.folded == true, let split = feed.latest else { return nil }
        return ModuleGlance.chances(split, final: final, top: (OddsStyle.line(palette.top), names.top),
                                    draw: threeWay ? OddsStyle.draw(scheme) : nil, bottom: (OddsStyle.line(palette.bottom), names.bottom))
    }

    /// Each outcome's line, in the legend's order: team lines held to their
    /// chroma floor, the draw receding.
    private var lines: [OddsLine] {
        var lines = [OddsLine(outcome: .top, name: names.top, color: OddsStyle.line(palette.top))]
        if threeWay { lines.append(OddsLine(outcome: .draw, name: "Draw", color: OddsStyle.draw(scheme))) }
        lines.append(OddsLine(outcome: .bottom, name: names.bottom, color: OddsStyle.line(palette.bottom)))
        return lines
    }

    private var caption: String {
        let what = threeWay ? "a line per outcome" : "a line per team"
        if final { return "Polymarket's market through the game, \(what)." }
        if live { return "Polymarket's live market, \(what)." }
        return "Polymarket's market over the last day, \(what)."
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
    /// (Stills draw the Live mark in the window control's likeness; folded, that goes, so the mark is the header's own.)
    private var accessory: SectionAccessory? {
        live ? (harness?.stills == true && module?.folded != true ? nil : .live) : final ? .final : nil
    }
    /// ImageRenderer can't draw AppKit controls (or the live dot's layer): the harness draws likenesses.
    @ViewBuilder
    private var windowControl: some View {
        if harness?.stills == true {
            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Circle().fill(.red).frame(width: 6, height: 6)
                    Text("Live").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(.red)
                }
                HStack(spacing: 0) {
                    ForEach(OddsWindow.allCases) { w in
                        Text(w.label).font(.system(size: 11)).padding(.horizontal, 9).padding(.vertical, 2)
                            .background(RoundedRectangle(cornerRadius: 4).fill(w == shownWindow ? Color.primary.opacity(0.16) : .clear))
                    }
                }
                .padding(1.5)
                .background(RoundedRectangle(cornerRadius: 5.5).fill(Color.primary.opacity(0.06)))
            }
        } else {
            picker
        }
    }
    #else
    private var shownWindow: OddsWindow { window }
    private var accessory: SectionAccessory? { live ? .live : final ? .final : nil }
    private var windowControl: some View { picker }
    #endif
}

/// A titled block like `DetailSection`, with a control at the title's trailing edge.
struct OddsSectionChrome<Trailing: View, Content: View>: View {
    let title: String
    var caption: String? = nil
    var accessory: SectionAccessory? = nil
    var spokenCaption: String? = nil
    /// Folded (on a match page), each side's chance.
    var glance: ModuleGlance? = nil
    @ViewBuilder let trailing: Trailing
    @ViewBuilder let content: Content
    @Environment(\.moduleChrome) private var module

    var body: some View {
        StackColumn(spacing: 8) {
            if let module {
                // Folded, the plot (and its scrub) leaves; the header stays, so the feed stays live for the glance.
                ModuleHeader(title: title, caption: caption, spokenCaption: spokenCaption, accessory: accessory, glance: glance,
                             chrome: module) { trailing }
                if !module.folded {
                    content.environment(\.moduleChrome, nil).transition(module.motion.content)
                }
            } else {
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
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, ModuleChrome.headerInset(folded: module?.folded == true))
        .containerValue(\.stacksOwnRows, true)
    }
}

// MARK: - Header

/// The legend is the header: each outcome's chance, big (a dot for identity,
/// the name in secondary ink, the number in primary), with ESPN's model and
/// DraftKings' pregame line as one muted line of numbers under it. Pointing,
/// both read that minute.
struct OddsHeader: View {
    let data: OddsChartData?
    /// The newest split (the market's listed one until its prices land).
    let latest: OddsSplit?
    let lines: [OddsLine]
    let baseline: OddsBaseline
    let names: (top: String, bottom: String)
    let state: EventState
    var espnNow: Double?
    let pointer: OddsPointer
    @Environment(\.spokenTeams) private var teams
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        OddsMoment(pointer: pointer) { moment in
            content(moment.flatMap { t in data.flatMap { OddsReading.at(t, data: $0, baseline: baseline) } })
        }
    }

    private func content(_ reading: OddsReading?) -> some View {
        let split = reading?.split ?? latest
        let percents = split?.percents(final: state == .final && reading == nil)
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 14) {
                // Rolling to a new value; pointing, the minute's values just appear.
                ForEach(lines) { line in item(line, percents?[line.outcome], rolls: reading == nil && !reduceMotion) }
                Spacer(minLength: 0)
            }
            sources(reading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spokenText(percents, reading))
    }

    private func item(_ line: OddsLine, _ value: Int?, rolls: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Circle().fill(line.color).frame(width: 7, height: 7).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 0.5 }
            Text(line.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            Text(value.map { "\($0)%" } ?? "–")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.primary)
                .contentTransition(.numericText(value: Double(value ?? 0)))
                .animation(rolls ? Motion.quick : nil, value: value)
        }
        .fixedSize()
    }

    @ViewBuilder
    private func sources(_ reading: OddsReading?) -> some View {
        let lines = muted
        if !lines.isEmpty {
            Group {
                if let reading {
                    Text(pointed(reading)).lineLimit(1).truncationMode(.tail)
                } else {
                    // The longest wording that fits on one line (a wrap would orphan a source).
                    ViewThatFits(in: .horizontal) {
                        ForEach(lines, id: \.self) { line in Text(line).fixedSize() }
                        Text(lines.last ?? "").lineLimit(1).truncationMode(.tail)
                    }
                }
            }
            .font(Viz.note)
            .foregroundStyle(.secondary)
        }
    }

    /// The muted line's wordings, longest first: "For GSW: ESPN 41% · DraftKings
    /// 42% before tip-off", then shorter. A final looks back at where it
    /// began: "GSW at tip-off: Polymarket 43% · ESPN 24% · DraftKings 42%".
    private var muted: [String] {
        let pregame = OddsBaseline.pregame(baseline.sport)
        let dk = baseline.draftKings
        if let dk, dk.draw != nil {
            let p = dk.percents()
            let split = "\(names.top) \(p[.top] ?? 0)% · Draw \(p[.draw] ?? 0)% · \(names.bottom) \(p[.bottom] ?? 0)%"
            return ["DraftKings \(pregame): " + split, "DraftKings: " + split]
        }
        if state == .final {
            var parts: [String] = []
            if let start = baseline.start, let pm = data?.split(at: start) {
                parts.append("Polymarket \(OddsSeries.percent(pm.top))%")
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

    /// Pointing: ESPN's model at that minute; without it, what doesn't change
    /// with the minute (DraftKings before the game), never today's ESPN.
    private func pointed(_ reading: OddsReading) -> String {
        if let espn = reading.espn { return "ESPN's model had \(names.top) at \(OddsSeries.percent(espn))% here" }
        if let dk = baseline.draftKings {
            return dk.draw != nil ? muted[0] : "For \(names.top): DraftKings \(OddsSeries.percent(dk.top))% \(OddsBaseline.pregame(baseline.sport))"
        }
        return "Polymarket at this minute"
    }

    private func spokenText(_ percents: [OddsMarket.Outcome: Int]?, _ reading: OddsReading?) -> String {
        let top = teams?.top ?? names.top, bottom = teams?.bottom ?? names.bottom
        guard let percents else { return "Polymarket odds loading." }
        var text = "Polymarket\(reading == nil ? "" : " at this minute"): \(top) \(percents[.top] ?? 0) percent"
        if let draw = percents[.draw] { text += ", draw \(draw) percent" }
        text += ", \(bottom) \(percents[.bottom] ?? 0) percent."
        if let line = reading.map(pointed) ?? muted.first {
            text += " " + line.replacingOccurrences(of: names.top, with: top).replacingOccurrences(of: names.bottom, with: bottom) + "."
        }
        return text
    }
}

// MARK: - Plot

/// The plot in its well: the still layer (the grid, the lines), the live ends
/// (glide, pulse, labels), and the scrub over both.
struct OddsPlot: View {
    let data: OddsChartData?
    /// In the legend's order.
    let lines: [OddsLine]
    let pointer: OddsPointer
    let spoken: SpokenTeams
    /// The market streams and the chart is seen: the ends pulse and beat.
    let live: Bool
    @Environment(\.widthClass) private var widthClass
    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    private var reading: Bool { harness?.moment != nil || pointer.active }
    #else
    private var reading: Bool { pointer.active }
    #endif

    var body: some View {
        let plotHeight = OddsStyle.plotHeight(widthClass)
        let labelWidth = OddsStyle.labelWidth(lines.map(\.name))
        GeometryReader { geo in
            if let data {
                let layout = OddsLayout(size: geo.size, plotHeight: plotHeight, domain: data.domain, labelWidth: labelWidth)
                ZStack(alignment: .topLeading) {
                    // Until the market's prices land, the frame is already the chart: the grid.
                    OddsStill(data: data, layout: layout, lines: OddsLine.drawn(lines))
                        .equatable()
                        .drawingGroup()
                    axisLabels(data, layout, plotHeight: plotHeight)
                    if !data.isEmpty {
                        // While a minute is being read, the live ends step back (the legend has the floor).
                        OddsHead(data: data, layout: layout, lines: lines, live: live)
                            .opacity(reading ? 0.25 : 1)
                            .transition(.opacity)
                        OddsScrub(data: data, layout: layout, lines: lines, pointer: pointer)
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

    /// 0, 50 and 100% in the gutter (recessive, like the grid), and the
    /// periods under the plot, centered on each one's span.
    @ViewBuilder
    private func axisLabels(_ data: OddsChartData, _ layout: OddsLayout, plotHeight: CGFloat) -> some View {
        ForEach([1.0, 0.5, 0.0], id: \.self) { p in
            Text("\(Int(p * 100))%").font(Viz.tick).foregroundStyle(.tertiary).fixedSize()
                .frame(width: OddsStyle.gutter - 5, alignment: .trailing)
                .position(x: (OddsStyle.gutter - 5) / 2, y: layout.y(p))
        }
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
        guard let head = data.head else { return "Win probability chart." }
        let p = head.split.percents(final: data.final)
        if data.threeWay {
            return "Polymarket's chances: \(spoken.top) \(p[.top] ?? 0) percent, draw \(p[.draw] ?? 0) percent, \(spoken.bottom) \(p[.bottom] ?? 0) percent."
        }
        var text = "Polymarket gives \(spoken.top) \(p[.top] ?? 0) percent"
        if let first = data.points.first(where: { $0.t >= data.domain.lowerBound }) ?? data.points.first {
            text += ", from \(OddsSeries.percent(first.split.top)) percent at the start"
        }
        if let espn = data.espn.last { text += ". ESPN's model: \(OddsSeries.percent(espn.p, final: data.final)) percent" }
        return text + "."
    }
}

// MARK: Still layer

/// Everything that moves only when data does: the grid and every line up to
/// its newest point. Equatable, so a glide, a pulse or a scrub never redraws it.
struct OddsStill: View, Equatable {
    let data: OddsChartData
    let layout: OddsLayout
    /// In drawing order.
    let lines: [OddsLine]

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
            drawLines(context)
        }
    }

    /// Hairlines at 0, 25, 50, 75 and 100%, and the period dividers: recessive, under everything.
    private func drawGrid(_ context: GraphicsContext) {
        let plot = layout.plot
        var grid = Path()
        for p in [0, 0.25, 0.5, 0.75, 1.0] {
            grid.move(to: CGPoint(x: plot.minX, y: layout.y(p)))
            grid.addLine(to: CGPoint(x: plot.maxX, y: layout.y(p)))
        }
        for period in data.periods.dropFirst() {
            let x = layout.x(period.start)
            guard x > plot.minX + 1, x < plot.maxX - 1 else { continue }
            grid.move(to: CGPoint(x: x, y: plot.minY - 4))
            grid.addLine(to: CGPoint(x: x, y: plot.maxY + 4))
        }
        context.stroke(grid, with: .color(Viz.grid), lineWidth: 0.5)
    }

    /// The points to draw: from the one in effect at the left edge up to the
    /// one before the newest (the live ends draw the last stretch).
    static func visible<T>(_ points: [T], time: (T) -> Date, domain: ClosedRange<Date>) -> ArraySlice<T> {
        guard points.count > 1 else { return [] }
        let body = points.dropLast()
        let firstInside = body.firstIndex { time($0) >= domain.lowerBound } ?? body.endIndex
        return body[max(body.startIndex, firstInside - 1)...]
    }

    /// Every outcome's line, stopping short of every end dot (the dots need the room).
    private func drawLines(_ context: GraphicsContext) {
        let points = Self.visible(data.points, time: \.t, domain: data.domain)
        guard points.count > 1, let head = data.head else { return }
        var clip = context
        clip.clip(to: Path(CGRect(x: layout.plot.minX, y: layout.bounds.minY - 4, width: layout.plot.width + 1, height: layout.bounds.height + 8)))
        let radius = OddsStyle.dot(final: data.final) / 2 + 2
        let cleared = clip.clearing(lines.map { Clearance(layout.end(head.split, $0.outcome), radius: radius) })
        let style = StrokeStyle(lineWidth: OddsStyle.line, lineCap: .round, lineJoin: .round)
        for line in lines {
            var path = Path()
            for (i, p) in points.enumerated() {
                let point = CGPoint(x: layout.x(p.t), y: layout.y(p.split.share(line.outcome)))
                if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
            }
            cleared.stroke(path, with: .color(line.color), style: style)
        }
    }
}

// MARK: Live ends

/// Each line's newest value: its last stretch, its dot and its label. A new
/// value glides in (one 0.5 s clock for every line, then the timeline
/// pauses); while the market is live and the chart seen, every dot pulses
/// (Core Animation, one shared phase) and the outcome that just moved gets
/// one brighter beat. Labels show the new value at once, rolling to it.
/// Reduce Motion: still dots, and values just change.
struct OddsHead: View {
    let data: OddsChartData
    let layout: OddsLayout
    /// In the legend's order.
    let lines: [OddsLine]
    let live: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var glide: OddsGlide?
    /// The lines a glide moves: their pulses wait, hidden, at the dot's target.
    @State private var moving: Set<OddsMarket.Outcome> = []
    /// Ticks per outcome: each bump makes that dot's next beat the bright one.
    @State private var beats: [OddsMarket.Outcome: Int] = [:]

    #if DEBUG
    /// The performance check: how often the live ends draw.
    nonisolated(unsafe) static var frames = 0
    #endif

    private var target: OddsSplit? { data.head?.split }

    var body: some View {
        let percents = target?.percents(final: data.final)
        ZStack(alignment: .topLeading) {
            timeline(percents)
            // Outside the timeline: a glide never moves an AppKit view.
            if live, let target {
                ForEach(lines) { line in
                    pulse(line)
                        .frame(width: OddsStyle.pulse, height: OddsStyle.pulse)
                        .position(layout.end(target, line.outcome))
                        .opacity(glide != nil && moving.contains(line.outcome) ? 0 : 1)
                }
            }
        }
        .allowsHitTesting(false)
        .onChange(of: target) { old, new in moved(from: old, to: new) }
    }

    private func timeline(_ percents: [OddsMarket.Outcome: Int]?) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: glide == nil)) { context in
            let shown = glide.map { $0.done(at: context.date) ? $0.to : $0.value(at: context.date) } ?? target
            if let shown {
                let labels = layout.endLabels(shown, outcomes: lines.map(\.outcome))
                ZStack(alignment: .topLeading) {
                    Canvas { ctx, _ in
                        #if DEBUG
                        Self.frames += 1
                        #endif
                        draw(ctx, shown: shown, labels: labels)
                    }
                    ForEach(labels, id: \.outcome) { label in
                        endLabel(label.outcome, percents?[label.outcome])
                            .position(x: layout.labelX + layout.labelWidth / 2, y: label.y)
                    }
                }
            }
        }
    }

    /// The name in secondary ink, the chance in primary.
    private func endLabel(_ outcome: OddsMarket.Outcome, _ value: Int?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(lines.first { $0.outcome == outcome }?.name ?? "").foregroundStyle(.secondary)
            Text(value.map { "\($0)%" } ?? "–")
                .foregroundStyle(.primary)
                .contentTransition(.numericText(value: Double(value ?? 0)))
                .animation(reduceMotion ? nil : Motion.quick, value: value)
        }
        .font(OddsStyle.labelFont)
        .fixedSize()
        .frame(width: layout.labelWidth, alignment: .leading)
    }

    private func moved(from old: OddsSplit?, to new: OddsSplit?) {
        guard let old, let new, !data.final else { glide = nil; moving = []; return }
        // From what's on screen now, so a value arriving mid-glide never jumps.
        let from = glide.map { $0.value(at: .now) } ?? old
        let travel = Set(new.outcomes.filter { abs(layout.y(new.share($0)) - layout.y(from.share($0))) >= 1 })
        // Most ticks move every dot less than a point: nothing to see glide, so no frames for it.
        if !reduceMotion, glide != nil || !travel.isEmpty {
            let next = OddsGlide(from: from, to: new, start: .now)
            moving = glide == nil ? travel : moving.union(travel)
            glide = next
            Task {
                try? await Task.sleep(for: .seconds(OddsStyle.glide + 0.02))
                if glide == next { glide = nil; moving = [] }
            }
        }
        if live, let mover = OddsMotion.mover(from: old, to: new) { beats[mover, default: 0] += 1 }
    }

    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    @ViewBuilder
    private func pulse(_ line: OddsLine) -> some View {
        if let harness, harness.stills {
            if let phase = harness.pulse { OddsPulse.likeness(line.color, phase: phase, bright: harness.beat == line.outcome) }
        } else {
            livePulse(line)
        }
    }
    #else
    private func pulse(_ line: OddsLine) -> some View { livePulse(line) }
    #endif

    /// A beat on a dot that's still gliding waits for it to land.
    private func livePulse(_ line: OddsLine) -> OddsPulse {
        OddsPulse(color: line.color, beat: beats[line.outcome] ?? 0,
                  delay: glide != nil && moving.contains(line.outcome) ? OddsStyle.glide : 0)
    }

    private func draw(_ ctx: GraphicsContext, shown: OddsSplit, labels: [OddsEndLabel]) {
        guard let head = data.head else { return }
        let r = OddsStyle.dot(final: data.final) / 2
        let drawn = OddsLine.drawn(lines)
        let ends = drawn.map { layout.end(shown, $0.outcome) }
        let style = StrokeStyle(lineWidth: OddsStyle.line, lineCap: .round, lineJoin: .round)
        // The last stretch of every line, from the newest point before it, stopping short of every dot.
        var clip = ctx
        clip.clip(to: Path(CGRect(x: layout.plot.minX, y: layout.bounds.minY - 4, width: layout.plot.width + 1, height: layout.bounds.height + 8)))
        let cleared = clip.clearing(ends.map { Clearance($0, radius: r + 2) })
        let previous = data.points.count > 1 ? data.points[data.points.count - 2] : nil
        for (line, end) in zip(drawn, ends) {
            var path = Path()
            let last = CGPoint(x: layout.x(head.t), y: end.y)
            if let previous {
                path.move(to: CGPoint(x: layout.x(previous.t), y: layout.y(previous.split.share(line.outcome))))
                path.addLine(to: last)
            } else {
                path.move(to: last)
            }
            path.addLine(to: end)
            cleared.stroke(path, with: .color(line.color), style: style)
        }
        // A label moved off its line keeps a hairline back to it.
        var leaders = Path()
        for label in labels where label.displaced {
            leaders.move(to: CGPoint(x: label.dot.x + r + 2.5, y: label.dot.y))
            leaders.addLine(to: CGPoint(x: layout.labelX - 2, y: label.y))
        }
        ctx.stroke(leaders, with: .color(Color.primary.opacity(0.3)), lineWidth: 0.75)
        // The dots, each clearing a ring in the ones beneath it.
        ctx.draw(Array(zip(drawn, ends)), clearance: { Clearance($0.1, radius: r + 1.5) }) { dot, context in
            context.fill(Path(ellipseIn: CGRect(x: dot.1.x - r, y: dot.1.y - r, width: r * 2, height: r * 2)), with: .color(dot.0.color))
        }
    }
}

/// A live end's pulse: a ring growing from the dot to 22pt and fading, every
/// 1.6 s, on one clock for every pulse (dots breathe together, never out of
/// step). A tick makes the next ring the bright one: stronger, with a faint
/// fill. A Core Animation layer: the window server draws it, SwiftUI never
/// re-renders for it. Only while the market is live, on screen and in a shown panel.
struct OddsPulse: NSViewRepresentable {
    let color: Color
    /// Bumped by each tick this outcome moved on: its next beat is the bright one.
    var beat = 0
    /// Until its dot lands (a glide in flight): the beat waits for it.
    var delay: TimeInterval = 0

    /// The shared clock every pulse's cycle starts on.
    static let epoch = CACurrentMediaTime()

    final class Coordinator {
        var beat = 0
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

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
        let cycle = CAAnimationGroup()
        cycle.animations = [Self.ring(opacity: 0.7)]
        cycle.duration = OddsStyle.pulsePeriod
        cycle.repeatCount = .infinity
        cycle.beginTime = Self.epoch
        cycle.isRemovedOnCompletion = false
        ring.add(cycle, forKey: "pulse")
        // Appearing isn't a tick.
        context.coordinator.beat = beat
        return view
    }

    /// One ring: from the dot, out and fading, over 1.1 s.
    private static func ring(opacity: Float) -> CAAnimationGroup {
        let grow = CABasicAnimation(keyPath: "transform.scale")
        grow.fromValue = OddsStyle.dot / OddsStyle.pulse
        grow.toValue = 1
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = opacity
        fade.toValue = 0
        let group = CAAnimationGroup()
        group.animations = [grow, fade]
        group.duration = 1.1
        group.timingFunction = CAMediaTimingFunction(controlPoints: 0.23, 1, 0.32, 1)
        return group
    }

    /// Runs when the live ends change (never per glide frame): a new color, or a tick's beat.
    func updateNSView(_ view: NSView, context: Context) {
        guard let ring = view.layer?.sublayers?.first(where: { $0.name == "ring" }) as? CAShapeLayer else { return }
        let ns = NSColor(color)
        if ring.strokeColor.map({ $0 != ns.cgColor }) ?? true {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            ring.strokeColor = ns.cgColor
            CATransaction.commit()
        }
        guard context.coordinator.beat != beat else { return }
        context.coordinator.beat = beat
        // The next ring after the dot lands, on the shared phase, drawn over the regular one.
        let bright = Self.ring(opacity: 1)
        let width = CABasicAnimation(keyPath: "lineWidth")
        width.fromValue = 2.5
        width.toValue = 1.5
        let fill = CABasicAnimation(keyPath: "fillColor")
        fill.fromValue = ns.withAlphaComponent(0.3).cgColor
        fill.toValue = ns.withAlphaComponent(0).cgColor
        bright.animations = (bright.animations ?? []) + [width, fill]
        bright.beginTime = OddsMotion.beat(after: CACurrentMediaTime() + delay, epoch: Self.epoch)
        ring.add(bright, forKey: "beat")
    }

    #if DEBUG
    /// ImageRenderer can't draw the layer: the ring at a phase of its growth, as a still.
    static func likeness(_ color: Color, phase: Double, bright: Bool) -> some View {
        let start = OddsStyle.dot / OddsStyle.pulse
        return ZStack {
            Circle().fill(color.opacity(bright ? 0.3 : 0))
            Circle().inset(by: 0.75).stroke(color, lineWidth: bright ? 2.5 - phase : 1.5)
        }
        .scaleEffect(start + (1 - start) * phase)
        .opacity((bright ? 1 : 0.7) * (1 - phase))
    }
    #endif
}

// MARK: Scrub

/// Pointing (or keyboard focus, then ← →) snaps a 1pt crosshair to the
/// nearest minute, with a dot on every line there; the legend, the sources
/// line and the footer read that minute, so nothing covers the lines. A move
/// re-renders only the crosshair and those readers.
struct OddsScrub: View {
    let data: OddsChartData
    let layout: OddsLayout
    let lines: [OddsLine]
    let pointer: OddsPointer
    @FocusState private var focused: Bool

    private var dataRange: ClosedRange<Date>? {
        guard let last = data.points.last?.t else { return nil }
        let first = max(data.points.first?.t ?? last, data.domain.lowerBound)
        return min(first, last)...last
    }

    var body: some View {
        OddsMoment(pointer: pointer) { moment in
            if let moment, let split = data.split(at: moment) { crosshair(moment, split) }
        }
        .frame(width: layout.bounds.width, height: layout.bounds.height + OddsStyle.axis, alignment: .topLeading)
        .contentShape(Rectangle())
        .onContinuousHover { phase in
            guard let range = dataRange else { return }
            switch phase {
            case let .active(location):
                pointer.read(layout.snap(x: location.x, within: range))
            case .ended:
                if !focused { pointer.read(nil) }
            }
        }
        // Keyboard focus (Tab, with keyboard navigation on), never a click: a click shouldn't pin the scrub.
        .focusable(interactions: .activate)
        .focusEffectDisabled()
        .focused($focused)
        .onChange(of: focused) { _, on in pointer.read(on ? dataRange?.upperBound : nil) }
        .onKeyPress(.leftArrow) { step(-1) }
        .onKeyPress(.rightArrow) { step(1) }
        .onKeyPress(.escape) {
            guard pointer.moment != nil else { return .ignored }
            pointer.read(nil)
            return .handled
        }
    }

    private func step(_ minutes: Double) -> KeyPress.Result {
        guard let range = dataRange else { return .ignored }
        let from = pointer.moment ?? range.upperBound
        let t = Date(timeIntervalSince1970: ((from.timeIntervalSince1970 / 60).rounded() + minutes) * 60)
        pointer.read(min(max(t, range.lowerBound), range.upperBound))
        return .handled
    }

    private func crosshair(_ t: Date, _ split: OddsSplit) -> some View {
        Canvas { ctx, _ in
            let x = layout.x(t)
            var rule = Path()
            rule.move(to: CGPoint(x: x, y: layout.plot.minY - 6))
            rule.addLine(to: CGPoint(x: x, y: layout.plot.maxY + 6))
            ctx.stroke(rule, with: .color(Viz.reference), lineWidth: 1)
            for line in OddsLine.drawn(lines) {
                let p = CGPoint(x: x, y: layout.y(split.share(line.outcome)))
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 3.5, y: p.y - 3.5, width: 7, height: 7)), with: .color(line.color))
            }
        }
        .allowsHitTesting(false)
    }
}

/// Every source at one moment, for the readers. (pure; tested)
struct OddsReading: Equatable {
    let t: Date
    /// Polymarket's chances then.
    let split: OddsSplit?
    /// ESPN's chance for the top team then.
    let espn: Double?
    let play: OddsPlay?

    static func at(_ t: Date, data: OddsChartData, baseline: OddsBaseline) -> OddsReading? {
        guard let split = data.split(at: t) else { return nil }
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

// MARK: - Footer

/// Where it comes from: freshness while live, the money traded, and the
/// market on Polymarket. Pointing, it names that minute's clock and play
/// instead (`ChartFooter`, as every chart in the app reads out).
struct OddsFooter: View {
    let feed: OddsFeed
    let data: OddsChartData?
    let baseline: OddsBaseline
    let pointer: OddsPointer
    let live: Bool
    /// The freshness ticks once a second only while the chart is on screen.
    let ticking: Bool

    var body: some View {
        OddsMoment(pointer: pointer) { moment in
            let reading = moment.flatMap { t in data.flatMap { OddsReading.at(t, data: $0, baseline: baseline) } }
            ChartFooter(readout: reading.map { (lead: $0.when(), detail: $0.play?.text ?? "") }) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    OddsFreshness(feed: feed, live: live, ticking: ticking, volume: feed.market?.volume)
                    Spacer(minLength: 8)
                    if let link = feed.market?.link {
                        SectionLink("Polymarket", symbol: "arrow.up.right", help: "Open this market on Polymarket") {
                            NSWorkspace.shared.open(link)
                        }
                    }
                }
                .padding(.top, 8)
            }
        }
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

/// The chart as data for VoiceOver's audio graph, by minute of the game: the
/// top team's chance from Polymarket and from ESPN (soccer: each outcome's).
struct OddsChartDescriptor: AXChartDescriptorRepresentable {
    let data: OddsChartData?
    let top: String
    let bottom: String

    func makeChartDescriptor() -> AXChartDescriptor {
        let start = data?.domain.lowerBound ?? .now
        let minutes = max((data?.domain.upperBound.timeIntervalSince(start) ?? 60) / 60, 1)
        let threeWay = data?.threeWay ?? false
        let x = AXNumericDataAxisDescriptor(title: "Minutes", range: 0...minutes, gridlinePositions: []) { "\(Int($0)) minutes in" }
        let y = AXNumericDataAxisDescriptor(title: threeWay ? "Chance" : "\(top)'s chance", range: 0...100,
                                            gridlinePositions: [50]) { "\(Int($0.rounded())) percent" }
        func series(_ name: String, _ points: [OddsPoint]) -> AXDataSeriesDescriptor {
            let inside = points.filter { $0.t >= start }
            let step = max(inside.count / 120, 1)
            let thinned = stride(from: 0, to: inside.count, by: step).map { inside[$0] }
            return AXDataSeriesDescriptor(name: name, isContinuous: true, dataPoints: thinned.map {
                AXDataPoint(x: $0.t.timeIntervalSince(start) / 60, y: $0.p * 100)
            })
        }
        func share(_ outcome: OddsMarket.Outcome) -> [OddsPoint] {
            (data?.points ?? []).map { OddsPoint(t: $0.t, p: $0.split.share(outcome)) }
        }
        var all: [AXDataSeriesDescriptor] = []
        if let data {
            if threeWay {
                all.append(series("Polymarket, \(top) win", share(.top)))
                all.append(series("Polymarket, draw", share(.draw)))
                all.append(series("Polymarket, \(bottom) win", share(.bottom)))
            } else {
                all.append(series("Polymarket", share(.top)))
                if !data.espn.isEmpty { all.append(series("ESPN", data.espn)) }
            }
        }
        return AXChartDescriptor(title: "Win probability", summary: nil, xAxis: x, yAxis: y, additionalAxes: [], series: all)
    }
}
