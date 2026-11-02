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

/// Which stretch of the game the charts show: all of it, the last 10 minutes
/// (live), or one period, zoomed by clicking its label.
enum OddsWindow: Hashable, Identifiable {
    case game, recent
    case period(Int)

    /// What the window control offers.
    static let choices: [OddsWindow] = [.game, .recent]

    var id: Self { self }
    var label: String { self == .recent ? "10 min" : "Game" }

    var period: Int? {
        if case let .period(number) = self { return number }
        return nil
    }

    /// Only a live game has a last 10 minutes; before the game, no periods.
    func effective(in state: EventState) -> OddsWindow {
        switch (self, state) {
        case (_, .scheduled), (.recent, .final): .game
        default: self
        }
    }
}

// MARK: - Data

/// Every outcome's chance at one moment.
struct OddsSplitPoint: Equatable {
    let t: Date
    let split: OddsSplit
    /// One of the outcomes hasn't been observed for a while: no reading, and the line breaks here.
    var unobserved = false
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
    /// Where a live game has got to: the lines end here, inside the domain.
    var now: Date? = nil
    /// Showing one period, not the game.
    var zoomed = false
    /// The lines' live end is on the chart (not when zoomed to an earlier period).
    var endVisible = true

    var head: OddsSplitPoint? { points.last }
    var isEmpty: Bool { points.isEmpty }

    /// The split in effect at `t` (before the first point, the first's). (pure)
    func split(at t: Date) -> OddsSplit? {
        guard let first = points.first else { return nil }
        return OddsSeries.last(points, atOrBefore: t, time: \.t)?.split ?? first.split
    }

    /// The historical sample behind a reading: never a price from the future,
    /// and none across a stretch nobody observed.
    func observedPoint(at t: Date) -> OddsSplitPoint? {
        guard let sample = OddsSeries.last(points, atOrBefore: t, time: \.t), !sample.unobserved,
              t.timeIntervalSince(sample.t) <= OddsSeries.gap else { return nil }
        return sample
    }

    /// Where the drawn lines are at `t`, for the crosshair's dots: between two
    /// samples, on the segment joining them; nothing where the line is broken.
    func drawn(at t: Date) -> OddsSplit? {
        var lo = 0, hi = points.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if points[mid].t <= t { lo = mid + 1 } else { hi = mid }
        }
        guard lo > 0, !points[lo - 1].unobserved else { return nil }
        let a = points[lo - 1]
        guard lo < points.count else { return t.timeIntervalSince(a.t) <= OddsSeries.gap ? a.split : nil }
        let b = points[lo]
        let span = b.t.timeIntervalSince(a.t)
        guard !b.unobserved, span <= OddsSeries.gap, span > 0 else { return nil }
        let k = t.timeIntervalSince(a.t) / span
        func mix(_ x: Double, _ y: Double) -> Double { x + (y - x) * k }
        return OddsSplit(top: mix(a.split.top, b.split.top), draw: b.split.draw.map { mix(a.split.draw ?? $0, $0) },
                         bottom: mix(a.split.bottom, b.split.bottom))
    }

    /// Only Latest and the exact end of a finished game may display 0/100.
    /// An earlier inspected quote keeps its in-game cap even after the game
    /// finishes. This changes rounding, never the observed price or its time.
    func usesFinalPercentages(at moment: Date?) -> Bool {
        final && (moment == nil || (moment == domain.upperBound && endVisible))
    }

    /// Before the game: the market's last day, from its first point within it. (pure; tested)
    static func pregameDomain(first: Date?, last: Date?, now: Date) -> ClosedRange<Date> {
        let from = max(first ?? now - 86_400, now - 86_400)
        return from...max(last ?? now, from + 60)
    }

    /// The market as it stood at `until` (each tick at its own time): what the page shows while it broadcasts. (pure; tested)
    static func shown(_ points: [OddsPoint], until: Date?) -> [OddsPoint] {
        guard let until else { return points }
        return Array(points[..<(points.firstIndex { $0.t > until } ?? points.endIndex)])
    }

    /// `until`: while the page broadcasts, p: the market as it stood then (no tick after it).
    @MainActor
    static func make(feed: OddsFeed, baseline: OddsBaseline, history: MatchHistory, state: EventState, window: OddsWindow, eventStart: Date,
                     now: Date = .now, until: Date? = nil) -> OddsChartData? {
        guard let market = feed.market else { return nil }
        let now = until ?? now
        var data = OddsChartData(revision: feed.revision, threeWay: market.threeWay, domain: now...now, live: state == .live,
                                 final: state == .final)
        func shown(_ outcome: OddsMarket.Outcome) -> [OddsPoint] { Self.shown(feed.series[outcome] ?? [], until: until) }
        if market.threeWay {
            data.points = OddsSeries.stacked(top: shown(.top), draw: shown(.draw), bottom: shown(.bottom))
        } else {
            data.points = shown(.top).map { OddsSplitPoint(t: $0.t, split: OddsSplit(top: $0.p, draw: nil, bottom: 1 - $0.p)) }
        }
        guard state != .scheduled else {
            data.domain = pregameDomain(first: data.points.first?.t, last: data.points.last?.t, now: now)
            return data
        }
        let visible = history.shown(until: until)
        let latest = data.points.last?.t
        let whole = visible.domain(state: state, window: .game, eventStart: eventStart, latest: latest, until: until)
        data.domain = visible.domain(state: state, window: window, eventStart: eventStart, latest: latest, until: until)
        data.zoomed = window.period != nil
        if state == .live {
            let edge = visible.now(eventStart: eventStart, latest: latest, until: until)
            data.now = edge
            data.endVisible = data.domain.contains(edge)
        } else {
            data.endVisible = data.domain.upperBound >= whole.upperBound
        }
        // The end of a finished game is its last play: nothing after the buzzer.
        if state == .final { data.points = Array(data.points[..<(data.points.firstIndex { $0.t > whole.upperBound } ?? data.points.endIndex)]) }
        data.espn = Self.shown(baseline.espn, until: until)
        data.periods = visible.periods
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
    /// Where a live game has got to; nothing to read past it. Nil: the lines end at the right edge.
    let now: Date?

    init(size: CGSize, plotHeight: CGFloat, domain: ClosedRange<Date>, labelWidth: CGFloat, now: Date? = nil) {
        self.domain = domain
        self.labelWidth = labelWidth
        self.now = now
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

    /// Inspection uses whole seconds inside the plot, but its edges retain
    /// the exact domain bounds. Rounding a fractional final whistle down must
    /// not make the final reading unreachable at the chart's right edge.
    func inspectionTime(at x: CGFloat) -> Date {
        if x <= plot.minX { return domain.lowerBound }
        if x >= endX { return readable.upperBound }
        let rounded = Date(timeIntervalSince1970: time(at: x).timeIntervalSince1970.rounded())
        return min(max(rounded, readable.lowerBound), readable.upperBound)
    }

    /// What can be read: the domain, up to where the game has got to.
    var readable: ClosedRange<Date> {
        domain.lowerBound...max(domain.lowerBound, min(domain.upperBound, now ?? domain.upperBound))
    }

    /// Where the lines end: at now, or at the plot's right edge (a final's
    /// last price holds to its last play).
    var endX: CGFloat { now.map { min(max(x($0), plot.minX), plot.maxX) } ?? plot.maxX }

    /// Where an outcome's line ends.
    func end(_ split: OddsSplit, _ outcome: OddsMarket.Outcome) -> CGPoint {
        CGPoint(x: endX, y: y(split.share(outcome)))
    }

    /// The end labels' leading edge, just past the dots; the column at the
    /// plot's right keeps them whole when the lines reach it.
    var labelX: CGFloat { endX + OddsStyle.labelGap }

    /// Every end's label, beside its dot, then dodged, kept whole inside the drawing area.
    func endLabels(_ split: OddsSplit, outcomes: [OddsMarket.Outcome], order: [OddsMarket.Outcome]? = nil) -> [OddsEndLabel] {
        let fixedOrder = order.flatMap { $0.count == outcomes.count && Set($0) == Set(outcomes) ? $0 : nil }
        let arranged = fixedOrder ?? outcomes
        let dots = arranged.map { end(split, $0) }
        let half = OddsStyle.labelHeight / 2
        let ys = Self.dodge(dots.map(\.y), gap: OddsStyle.labelHeight, within: (bounds.minY + half)...(bounds.maxY - half),
                            preservingOrder: fixedOrder != nil)
        let labels = arranged.indices.map { OddsEndLabel(outcome: arranged[$0], dot: dots[$0], y: ys[$0]) }
        return outcomes.compactMap { outcome in labels.first { $0.outcome == outcome } }
    }

    /// Label centers after dodging (pure; tested): labels that would overlap
    /// merge into a cluster centered on their lines' mean, `gap` apart in their
    /// lines' order (a tie keeps the given order), held within `range`.
    static func dodge(_ ideal: [CGFloat], gap: CGFloat, within range: ClosedRange<CGFloat>, preservingOrder: Bool = false) -> [CGFloat] {
        struct Cluster {
            var members: [Int]
            var top: CGFloat
        }
        func cluster(_ members: [Int]) -> Cluster {
            let mean = members.enumerated().map { ideal[$0.element] - CGFloat($0.offset) * gap }.reduce(0, +) / CGFloat(members.count)
            let height = CGFloat(members.count - 1) * gap
            return Cluster(members: members, top: min(max(mean, range.lowerBound), range.upperBound - height))
        }
        let order = preservingOrder ? Array(ideal.indices) : ideal.indices.sorted { ideal[$0] != ideal[$1] ? ideal[$0] < ideal[$1] : $0 < $1 }
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

/// End labels keep their outcome identity through a close race. A real
/// crossing changes their order only after the dots are a label-height
/// apart; a one-tick wobble around 50/50 never flips the names back and forth.
enum OddsEndOrder {
    static func next(_ previous: [OddsMarket.Outcome], split: OddsSplit, outcomes: [OddsMarket.Outcome],
                     layout: OddsLayout) -> [OddsMarket.Outcome] {
        guard previous.count == outcomes.count, Set(previous) == Set(outcomes) else {
            return layout.endLabels(split, outcomes: outcomes).sorted { $0.y < $1.y }.map(\.outcome)
        }
        var order = previous
        for _ in 0..<order.count {
            for i in 0..<max(order.count - 1, 0) {
                let a = layout.y(split.share(order[i])), b = layout.y(split.share(order[i + 1]))
                if a - b > OddsStyle.labelHeight { order.swapAt(i, i + 1) }
            }
        }
        return order
    }

    /// A leader is only useful when its origin is unambiguous. Crossing
    /// leaders or two almost coincident dots look like a line joining teams.
    /// The name's outcome color carries identity in those cases.
    static func leaders(_ labels: [OddsEndLabel]) -> [OddsEndLabel] {
        labels.filter { label in
            label.displaced && !labels.contains { other in
                other.outcome != label.outcome &&
                    (abs(other.dot.y - label.dot.y) < OddsStyle.dot + 2 ||
                     (other.dot.y - label.dot.y) * (other.y - label.y) < 0)
            }
        }
    }

    /// During a genuine reorder, names dissolve before their glyphs collide,
    /// then return in the new order. The outcome dots remain visible throughout.
    static func opacity(_ label: OddsEndLabel, among labels: [OddsEndLabel]) -> Double {
        let distance = labels.filter { $0.outcome != label.outcome }.map { abs($0.y - label.y) }.min() ?? .infinity
        return Double(min(max((distance - OddsStyle.labelHeight * 0.65) / (OddsStyle.labelHeight * 0.35), 0), 1))
    }
}

/// Geometry for a label transition, keyed by outcome rather than vertical
/// rank. A new quote starts from the current centers, even mid-transition.
struct OddsLabelGlide: Equatable {
    let from: [OddsMarket.Outcome: CGFloat]
    let to: [OddsMarket.Outcome: CGFloat]
    let start: Date

    init(from: [OddsEndLabel], to: [OddsEndLabel], start: Date) {
        self.from = Dictionary(uniqueKeysWithValues: from.map { ($0.outcome, $0.y) })
        self.to = Dictionary(uniqueKeysWithValues: to.map { ($0.outcome, $0.y) })
        self.start = start
    }

    func labels(at time: Date, dots: [OddsEndLabel]) -> [OddsEndLabel] {
        let k = OddsGlide.progress(time.timeIntervalSince(start))
        return dots.map { label in
            let a = from[label.outcome] ?? label.y, b = to[label.outcome] ?? label.y
            return OddsEndLabel(outcome: label.outcome, dot: label.dot, y: a + (b - a) * k)
        }
    }
}

/// Only the transient final connector, never historical samples. When a
/// quote interrupts a glide, the displayed dot can still be behind the
/// preceding recorded price. Connecting back to it invents a hook/spike.
/// Keep that tiny connector absent until the dot enters its true segment.
enum OddsTail {
    static func connector(previous: OddsSplitPoint?, head: OddsSplitPoint, shown: OddsSplit,
                          outcome: OddsMarket.Outcome, layout: OddsLayout) -> [CGPoint] {
        let end = layout.end(shown, outcome)
        let last = CGPoint(x: layout.x(head.t), y: end.y)
        // The market hasn't been heard for a while: no line claims it held.
        let tail = layout.now.map { $0.timeIntervalSince(head.t) <= OddsSeries.gap } ?? true ? [last, end] : [last]
        guard let previous, !head.unobserved, head.t.timeIntervalSince(previous.t) <= OddsSeries.gap else { return tail }
        let a = previous.split.share(outcome), b = head.split.share(outcome), p = shown.share(outcome)
        guard p >= min(a, b) - 1e-9, p <= max(a, b) + 1e-9 else { return [] }
        return [CGPoint(x: layout.x(previous.t), y: layout.y(a))] + tail
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

/// The moment being read, shared by both modules' scrubs (which set it) and
/// the legend, the sources line and the footer (which read it). An object of
/// its own, so a move re-renders only those readers, never the section or the
/// plot.
///
/// Four things can ask for a reading, and the first with an answer wins, as
/// `LinkedFocus` puts the hover over the pin: a row or mark the page links to,
/// the pointer over a chart, the keyboard's reading, the pin. Each has its own
/// state and its own end: the pointer leaving a chart clears the pointer's
/// reading, whatever has keyboard focus.
@MainActor
@Observable
final class OddsPointer {
    private(set) var moment: Date?
    /// Whether anything is being read: flips only as reading starts and ends
    /// (the live ends step back).
    private(set) var active = false
    /// What a click holds while the live feed continues to arrive, and the play it's on.
    private(set) var held: Date?
    private(set) var heldPlay: String?
    /// The two independent modules always inspect the same stretch of time.
    var window = OddsWindow.game

    @ObservationIgnored private var hovered: Date?
    @ObservationIgnored private var linked: Date?
    @ObservationIgnored private var keyed: Date?

    var pinned: Bool { held != nil }

    private func settle() {
        let reading = linked ?? hovered ?? keyed ?? held
        if moment != reading { moment = reading }
        if active != (reading != nil) { active = reading != nil }
    }

    /// The pointer over a chart; nil as it leaves.
    func hover(_ t: Date?) {
        hovered = t
        settle()
    }

    /// A row or mark in focus somewhere on the page.
    func link(_ t: Date?) {
        linked = t
        settle()
    }

    /// The keyboard's reading; nil as the chart loses focus.
    func key(_ t: Date?) {
        keyed = t
        settle()
    }

    func pin(_ t: Date?, play: String? = nil) {
        if held != t { held = t }
        if heldPlay != play { heldPlay = t == nil ? nil : play }
        settle()
    }

    /// Holds a moment, the same pin the page's rows make when it's a play's.
    func hold(_ t: Date, play: String?, linked focus: LinkedFocus?) {
        keyed = nil
        if let play { focus?.pin(Focus(play: play)) } else { focus?.unpin() }
        pin(t, play: play)
    }

    /// A click, like `LinkedFocus.togglePin`: holds it; again on the same play
    /// or spot lets go. Elsewhere, the pin moves.
    func toggle(_ t: Date, play: String?, within range: ClosedRange<Date>, linked focus: LinkedFocus?) {
        let reach = range.upperBound.timeIntervalSince(range.lowerBound) * 0.01
        let same = play != nil ? heldPlay == play : heldPlay == nil && held.map { abs($0.timeIntervalSince(t)) <= reach } == true
        if same { clear(linked: focus) } else { hold(t, play: play, linked: focus) }
    }

    /// Back to the latest.
    func clear(linked focus: LinkedFocus? = nil) {
        keyed = nil
        focus?.unpin()
        pin(nil)
    }

    /// One step in time, a fraction of what's shown: the pin moves, or the keyboard's reading does.
    func step(_ fraction: Double, within range: ClosedRange<Date>, linked focus: LinkedFocus?) {
        let span = range.upperBound.timeIntervalSince(range.lowerBound)
        let t = min(max((moment ?? range.upperBound) + span * fraction, range.lowerBound), range.upperBound)
        if pinned { hold(t, play: nil, linked: focus) } else { key(t) }
    }

    /// Shows one period, or with nil the whole game. A pin outside what's shown goes.
    func zoom(to period: Int?, span: ClosedRange<Date>?) {
        window = period.map(OddsWindow.period) ?? .game
        keyed = nil
        if let span, let held, !span.contains(held) { pin(nil) } else { settle() }
    }

    /// Esc: a held reading goes first, then the zoom. Whether there was anything to undo.
    func back(linked focus: LinkedFocus?) -> Bool {
        if keyed != nil || pinned {
            clear(linked: focus)
            return true
        }
        guard window.period != nil else { return false }
        window = .game
        return true
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
    /// While the page broadcasts (BROADCAST §3): its presentation clock. The
    /// market is shown up to p (each tick at its own time ≤ p, so the line
    /// moves with the basket, not 50 s before it), redrawn when p reaches the
    /// next tick: scheduled, never polled.
    var presentation: PresentationClock? = nil
    let history: MatchHistory
    let marks: [TimelineMark]
    let pointer: OddsPointer
    @Environment(\.pageLive) private var pageLive
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(LinkedFocus.self) private var linked: LinkedFocus?
    @State private var onScreen = false
    /// On a match page: folded, the header says each side's chance.
    @Environment(\.moduleChrome) private var module
    #if DEBUG
    @Environment(\.oddsHarness) private var harness
    private var onScreenLive: Bool { (onScreen || harness != nil) && pageLive }
    #else
    private var onScreenLive: Bool { onScreen && pageLive }
    #endif

    private var live: Bool { event.state == .live }
    private var final: Bool { event.state == .final }
    private var threeWay: Bool { feed.market?.threeWay ?? false }
    /// The market's channel is open (before the game too): its lines are live.
    private var streaming: Bool { feed.connection == .live || feed.connection == .polling }

    var body: some View {
        Group {
            if let clock = presentation {
                TimelineView(.explicit(Self.schedule(feed: feed, clock: clock, now: Date()))) { context in
                    section(until: Date(timeIntervalSince1970: clock.p(at: context.date.timeIntervalSince1970)))
                }
            } else {
                section(until: nil)
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

    private func section(until: Date?) -> some View {
        let data = OddsChartData.make(feed: feed, baseline: baseline, history: history, state: event.state,
                                      window: shownWindow.effective(in: event.state), eventStart: event.start, until: until)
        let lines = self.lines
        let latest = until == nil ? data?.head?.split ?? feed.latest : data?.head?.split
        return OddsSectionChrome(title: final ? "How the Odds Moved" : "Win Probability", caption: caption, accessory: accessory,
                                 glance: glance(latest)) {
            if data?.zoomed == true {
                WholeGameLink(pointer: pointer)
            } else if live {
                windowControl
            }
        } content: {
            VStack(alignment: .leading, spacing: 0) {
                OddsHeader(data: data, latest: latest, lines: lines, baseline: baseline, names: names,
                           state: event.state, espnNow: baseline.espn.last?.p ?? espnNow, pointer: pointer, marks: marks)
                OddsPlot(data: data, lines: lines, pointer: pointer, marks: marks, spoken: spoken,
                         live: OddsMotion.live(final: final, streaming: streaming, seen: onScreenLive, reduceMotion: reduceMotion))
                    .padding(.top, 8)
                OddsFooter(feed: feed, data: data, baseline: baseline, pointer: pointer, marks: marks, names: names, live: live,
                           ticking: onScreenLive)
                SectionReplay(section: .winProbability)
            }
        }
    }

    /// Redraw when the broadcast reaches a quote, and every so often besides,
    /// so a quiet market's line and fill keep reaching now. Unreachable future
    /// times remain gated by the presentation clock's plan. (pure; tested)
    static func schedule(_ ticks: [Date], clock: PresentationClock, now: Date) -> [Date] {
        let t = now.timeIntervalSince1970
        let p = clock.p(at: t)
        let pending = ticks.map(\.timeIntervalSince1970).filter { $0 > p }.sorted().prefix(240)
        return [now] + pending.compactMap { clock.wall(reaching: $0, after: t).map { Date(timeIntervalSince1970: $0 + 0.01) } }
    }

    /// The modules' redraws while they broadcast: each tick reached, and a steady beat for the now line.
    static func schedule(feed: OddsFeed, clock: PresentationClock, now: Date) -> [Date] {
        let p = Date(timeIntervalSince1970: clock.p(at: now.timeIntervalSince1970))
        let reached = schedule(feed.ticks(after: p), clock: clock, now: now)
        let beat = stride(from: 15.0, through: 3600, by: 15).map { now + $0 }
        return Array(Set(reached + beat)).sorted()
    }

    /// Folded, the legend in a line: each side's chance, keyed by its color (the feed stays live while the header's on screen).
    private func glance(_ latest: OddsSplit?) -> ModuleGlance? {
        guard module?.folded == true, let split = latest else { return nil }
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
        Picker("Window", selection: Binding(get: { pointer.window }, set: { pointer.window = $0; pointer.clear(linked: linked) })) {
            ForEach(OddsWindow.choices) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlSize(.small)
        .fixedSize()
        .help("The whole game, or the last 10 minutes tick by tick")
    }

    #if DEBUG
    private var shownWindow: OddsWindow { harness?.window ?? pointer.window }
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
                    ForEach(OddsWindow.choices) { w in
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
    private var shownWindow: OddsWindow { pointer.window }
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
    var marks: [TimelineMark] = []
    @Environment(\.spokenTeams) private var teams
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        OddsMoment(pointer: pointer) { moment in
            content(moment.flatMap { t in data.flatMap { OddsReading.at(t, data: $0, baseline: baseline, marks: marks) } })
        }
    }

    private func content(_ reading: OddsReading?) -> some View {
        let split = reading == nil ? latest : reading?.split
        let finalPercentages = data?.usesFinalPercentages(at: reading?.t) ?? (state == .final && reading == nil)
        let percents = split?.percents(final: finalPercentages)
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

    /// The muted line. While reading a moment, today's ESPN number would be
    /// the wrong game: only what doesn't change with the moment stays, and the
    /// line keeps its place so the plot never moves.
    @ViewBuilder
    private func sources(_ reading: OddsReading?) -> some View {
        // Shorter wordings can come out the same: one view each.
        var seen = Set<String>()
        let lines = (reading == nil ? muted : pregameOnly).filter { seen.insert($0).inserted }
        if !lines.isEmpty {
            // The longest wording that fits on one line (a wrap would orphan a source).
            ViewThatFits(in: .horizontal) {
                ForEach(lines, id: \.self) { line in Text(line).fixedSize() }
                Text(lines.last ?? "").lineLimit(1).truncationMode(.tail)
            }
            .font(Viz.note)
            .foregroundStyle(.secondary)
        } else {
            Text(" ").font(Viz.note).accessibilityHidden(true)
        }
    }

    /// DraftKings before the game, for the top team (soccer: each outcome's).
    private var pregameOnly: [String] {
        guard let dk = baseline.draftKings else { return [] }
        return dk.draw != nil ? muted : ["For \(names.top): DraftKings \(OddsSeries.percent(dk.top))% \(OddsBaseline.pregame(baseline.sport))"]
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

    private func spokenText(_ percents: [OddsMarket.Outcome: Int]?, _ reading: OddsReading?) -> String {
        let top = teams?.top ?? names.top, bottom = teams?.bottom ?? names.bottom
        guard let percents else { return reading == nil ? "Polymarket odds loading." : "No odds at this moment." }
        var text = "Polymarket\(reading == nil ? "" : " at this moment"): \(top) \(percents[.top] ?? 0) percent"
        if let draw = percents[.draw] { text += ", draw \(draw) percent" }
        text += ", \(bottom) \(percents[.bottom] ?? 0) percent."
        if let espn = reading?.espn {
            text += " ESPN's model: \(OddsSeries.percent(espn)) percent for \(top)."
        } else if reading == nil, let line = muted.first {
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
    var marks: [TimelineMark] = []
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
                ZoomingDomain(data.domain) { domain in
                    let layout = OddsLayout(size: geo.size, plotHeight: plotHeight, domain: domain, labelWidth: labelWidth, now: data.now)
                    ZStack(alignment: .topLeading) {
                        // Until the market's prices land, the frame is already the chart: the grid.
                        OddsStill(data: data, layout: layout, lines: OddsLine.drawn(lines))
                            .equatable()
                            .drawingGroup()
                        axisLabels(data, layout, plotHeight: plotHeight)
                            .accessibilityHidden(true)
                        if !data.isEmpty {
                            if data.endVisible {
                                // While a minute is being read, the live ends step back (the legend has the floor).
                                OddsHead(data: data, layout: layout, lines: lines, live: live)
                                    .opacity(reading ? 0.25 : 1)
                                    .transition(.opacity)
                                    .accessibilityHidden(true)
                            }
                            OddsScrub(data: data, layout: layout, lines: lines, marks: marks, pointer: pointer)
                        }
                        PeriodRow(spans: TimelinePeriod.spans(data.periods, layout: layout, runsOn: data.now != nil),
                                  zoomed: data.zoomed, pointer: pointer)
                            .frame(width: layout.bounds.width, height: OddsStyle.axis)
                            .offset(y: plotHeight)
                    }
                }
                .animation(Motion.fade, value: data.isEmpty)
            }
        }
        .frame(height: plotHeight + OddsStyle.axis)
        .vizWell(padding: 8)
        .accessibilityElement(children: .contain)
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
        ForEach(labels, id: \.label) { label in
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

    /// The points to draw: from the one in effect at the left edge to the one
    /// past the right edge, or to the one before the newest (the live ends
    /// draw the last stretch).
    static func visible<T>(_ points: [T], time: (T) -> Date, domain: ClosedRange<Date>, endVisible: Bool = true) -> ArraySlice<T> {
        guard points.count > 1 else { return [] }
        let body = endVisible ? points.dropLast() : points[...]
        let firstInside = body.firstIndex { time($0) >= domain.lowerBound } ?? body.endIndex
        let firstPast = body.firstIndex { time($0) > domain.upperBound }.map { $0 + 1 } ?? body.endIndex
        return body[max(body.startIndex, firstInside - 1)..<firstPast]
    }

    /// Every outcome's line, stopping short of every end dot (the dots need the room).
    private func drawLines(_ context: GraphicsContext) {
        let points = Self.visible(data.points, time: \.t, domain: layout.domain, endVisible: data.endVisible)
        guard points.count > 1, let head = data.head else { return }
        var clip = context
        clip.clip(to: Path(CGRect(x: layout.plot.minX, y: layout.bounds.minY - 4, width: layout.plot.width + 1, height: layout.bounds.height + 8)))
        let radius = OddsStyle.dot(final: data.final) / 2 + 2
        let cleared = data.endVisible ? clip.clearing(lines.map { Clearance(layout.end(head.split, $0.outcome), radius: radius) }) : clip
        let style = StrokeStyle(lineWidth: OddsStyle.line, lineCap: .round, lineJoin: .round)
        for line in lines {
            var path = Path()
            var previous: OddsSplitPoint?
            for p in points where !p.unobserved {
                let point = CGPoint(x: layout.x(p.t), y: layout.y(p.split.share(line.outcome)))
                // Samples a gap apart: nobody saw what happened between, so nothing's drawn.
                if let previous, p.t.timeIntervalSince(previous.t) <= OddsSeries.gap { path.addLine(to: point) } else { path.move(to: point) }
                previous = p
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
    @State private var labelGlide: OddsLabelGlide?
    @State private var labelOrder: [OddsMarket.Outcome] = []
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
        .onChange(of: layout.plot) { _, _ in labelGlide = nil }
        .onChange(of: reduceMotion) { _, reduce in
            if reduce { glide = nil; labelGlide = nil; moving = [] }
        }
    }

    private func timeline(_ percents: [OddsMarket.Outcome: Int]?) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: glide == nil)) { context in
            let shown = glide.map { $0.done(at: context.date) ? $0.to : $0.value(at: context.date) } ?? target
            if let shown {
                let ordered = layout.endLabels(shown, outcomes: lines.map(\.outcome), order: labelOrder.isEmpty ? nil : labelOrder)
                let labels = labelGlide?.labels(at: context.date, dots: ordered) ?? ordered
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
                            .opacity(OddsEndOrder.opacity(label, among: labels))
                    }
                }
            }
        }
    }

    /// Outcome-colored names remain identifiable when near-tie leaders recede.
    private func endLabel(_ outcome: OddsMarket.Outcome, _ value: Int?) -> some View {
        let line = lines.first { $0.outcome == outcome }
        return HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(line?.name ?? "").foregroundStyle(line?.color ?? .secondary)
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
        guard let old, let new, !data.final else { glide = nil; labelGlide = nil; labelOrder = []; moving = []; return }
        let now = Date.now
        // From what's on screen now, so a value arriving mid-glide never jumps.
        let from = glide.map { $0.value(at: now) } ?? old
        let outcomes = lines.map(\.outcome)
        let oldOrder = labelOrder.isEmpty ? OddsEndOrder.next([], split: old, outcomes: outcomes, layout: layout) : labelOrder
        let dots = layout.endLabels(from, outcomes: outcomes, order: oldOrder)
        let fromLabels = labelGlide?.labels(at: now, dots: dots) ?? dots
        let order = OddsEndOrder.next(oldOrder, split: new, outcomes: outcomes, layout: layout)
        let toLabels = layout.endLabels(new, outcomes: outcomes, order: order)
        labelOrder = order
        let travel = Set(new.outcomes.filter { abs(layout.y(new.share($0)) - layout.y(from.share($0))) >= 1 })
        // Most ticks move every dot less than a point: nothing to see glide, so no frames for it.
        if !reduceMotion, glide != nil || !travel.isEmpty {
            let next = OddsGlide(from: from, to: new, start: now)
            labelGlide = OddsLabelGlide(from: fromLabels, to: toLabels, start: now)
            moving = glide == nil ? travel : moving.union(travel)
            glide = next
            Task {
                try? await Task.sleep(for: .seconds(OddsStyle.glide + 0.02))
                if glide == next { glide = nil; labelGlide = nil; moving = [] }
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
        for line in drawn {
            let points = OddsTail.connector(previous: previous, head: head, shown: shown, outcome: line.outcome, layout: layout)
            guard let first = points.first else { continue }
            var path = Path()
            path.move(to: first)
            for point in points.dropFirst() { path.addLine(to: point) }
            cleared.stroke(path, with: .color(line.color), style: style)
        }
        // Each leader belongs to one outcome; never join ambiguous crossings.
        for label in OddsEndOrder.leaders(labels) {
            guard let line = lines.first(where: { $0.outcome == label.outcome }) else { continue }
            var leader = Path()
            leader.move(to: CGPoint(x: label.dot.x + r + 2.5, y: label.dot.y))
            leader.addLine(to: CGPoint(x: layout.labelX - 2, y: label.y))
            ctx.stroke(leader, with: .color(line.color.opacity(0.45 * OddsEndOrder.opacity(label, among: labels))), lineWidth: 0.75)
        }
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

/// Pointing (or keyboard focus, then ← →) moves a 1pt crosshair, with a dot on
/// every line at it; near a key play, it snaps there. The legend, sources line
/// and footer read that moment, so nothing covers the lines. A move re-renders
/// only the crosshair and those readers.
struct OddsScrub: View {
    let data: OddsChartData
    let layout: OddsLayout
    let lines: [OddsLine]
    let marks: [TimelineMark]
    let pointer: OddsPointer

    var body: some View {
        // The key plays, as columns: a click or a hover near one takes the play.
        let placed = marks.filter { mark in mark.t.map { layout.domain.contains($0) } == true }
        let columns = placed.map { HoverMark(from: CGPoint(x: layout.x($0.t ?? layout.domain.lowerBound), y: layout.plot.minY),
                                             to: CGPoint(x: layout.x($0.t ?? layout.domain.lowerBound), y: layout.plot.maxY)) }
        ZStack(alignment: .topLeading) {
            Color.clear
            OddsMoment(pointer: pointer) { moment in
                if let moment, layout.domain.contains(moment) {
                    crosshair(moment, data.drawn(at: moment))
                }
            }
            // Inspection is drawn above the stable input surface. It
            // must never become the mouse's new hit-test target.
            .allowsHitTesting(false)
        }
        .frame(width: layout.bounds.width, height: layout.bounds.height, alignment: .topLeading)
        .contentShape(Rectangle())
        .linkedMarks(columns) { Focus(play: placed[$0].id) }
        .modifier(MatchInspection(layout: layout, marks: marks, pointer: pointer) { location in
            nearest(columns, to: location).map { placed[$0] }
        })
        .accessibilityLabel("Inspect win probability")
        .modifier(OddsScrubAccessibility(data: data, lines: lines, pointer: pointer))
        .accessibilityHint("Left and right arrows move through the game. Option with an arrow moves between key plays. Return holds a moment. Escape returns to the latest.")
        .modifier(MatchInspectionActions(marks: marks, range: layout.readable, pointer: pointer))
    }

    private func crosshair(_ t: Date, _ split: OddsSplit?) -> some View {
        Canvas { ctx, _ in
            let x = layout.x(t)
            var rule = Path()
            rule.move(to: CGPoint(x: x, y: layout.plot.minY - 6))
            rule.addLine(to: CGPoint(x: x, y: layout.plot.maxY + 6))
            ctx.stroke(rule, with: .color(Viz.reference), lineWidth: 1)
            guard let split else { return }
            for line in OddsLine.drawn(lines) {
                let y = layout.y(split.share(line.outcome))
                ctx.fill(Path(ellipseIn: CGRect(x: x - 3.5, y: y - 3.5, width: 7, height: 7)), with: .color(line.color))
            }
        }
        .allowsHitTesting(false)
    }
}

/// Only this leaf observes the current reading. Reading it in OddsScrub.body
/// rebuilds the hover responder whenever that responder changes the pointer;
/// macOS can then send ended/active again without the mouse moving.
private struct OddsScrubAccessibility: ViewModifier {
    let data: OddsChartData
    let lines: [OddsLine]
    let pointer: OddsPointer

    func body(content: Content) -> some View {
        content.accessibilityValue(reading)
    }

    private var reading: String {
        let moment = pointer.moment ?? data.now ?? data.domain.upperBound
        let time = moment.formatted(.dateTime.hour().minute())
        let state = pointer.pinned ? "Held" : pointer.active ? "" : "Latest"
        let lead = [state, time].filter { !$0.isEmpty }.joined(separator: ", ")
        guard let sample = data.observedPoint(at: moment) else { return "\(lead). No odds at this moment." }
        let percentages = sample.split.percents(final: data.usesFinalPercentages(at: pointer.moment))
        let values = lines.map { "\($0.name), \(percentages[$0.outcome] ?? 0) percent" }.joined(separator: ". ")
        return "\(lead). \(values)."
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

    static func at(_ t: Date, data: OddsChartData, baseline: OddsBaseline, marks: [TimelineMark] = []) -> OddsReading? {
        let espn = (baseline.start.map { t >= $0 } ?? false) ? OddsSeries.value(data.espn, at: t) : nil
        // The key plays at this instant, by name; else the last play before
        // it. Never an upcoming play as if it had already happened.
        let exact = marks.filter { $0.t == t }
        let play = exact.first.map { first in
            OddsPlay(t: t, period: first.moment.period ?? 0, clock: baseline.play(atOrBefore: t)?.clock ?? first.moment.clock,
                     text: exact.map { MomentList.headline($0.moment) }.joined(separator: " · "))
        } ?? baseline.play(atOrBefore: t)
        return OddsReading(t: t, split: data.observedPoint(at: t)?.split, espn: data.espn.isEmpty ? nil : espn, play: play)
    }

    /// "Q3 4:12 · GSW 62% · ESPN 58%": where in the game, and each source's
    /// chance for the top team. Before the game, the wall time.
    func lead(top: String, final: Bool, now: Date = .now) -> String {
        let when = play.flatMap { $0.clock.isEmpty ? nil : MomentList.shortClock($0.clock) }
            ?? (Calendar.current.isDate(t, inSameDayAs: now) ? t.formatted(date: .omitted, time: .shortened)
                : t.formatted(.dateTime.weekday(.abbreviated).hour().minute()))
        let percent = split?.percents(final: final)[.top].map { "\(top) \($0)%" }
        let model = espn.map { "ESPN \(OddsSeries.percent($0, final: final))%" }
        return ([when, percent, model] as [String?]).compactMap { $0 }.joined(separator: " · ")
    }
}

// MARK: - Footer

/// Where it comes from: freshness while live, the money traded, and the
/// market on Polymarket. Pointing, it names that moment instead
/// (`ChartFooter`, as every chart in the app reads out). Held, the row also
/// offers the play's replay and the way through the key plays and back.
struct OddsFooter: View {
    let feed: OddsFeed
    let data: OddsChartData?
    let baseline: OddsBaseline
    let pointer: OddsPointer
    var marks: [TimelineMark] = []
    let names: (top: String, bottom: String)
    let live: Bool
    /// The freshness ticks once a second only while the chart is on screen.
    let ticking: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            OddsMoment(pointer: pointer) { moment in
                let reading = moment.flatMap { t in data.flatMap { OddsReading.at(t, data: $0, baseline: baseline, marks: marks) } }
                ChartFooter(readout: reading.map { reading in
                    (lead: reading.lead(top: names.top, final: data?.usesFinalPercentages(at: reading.t) ?? false),
                     detail: reading.split == nil ? "No odds at this moment" : reading.play?.text ?? "")
                }) {
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
            MatchPinControls(marks: marks, range: data?.domain, pointer: pointer, section: .winProbability)
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
