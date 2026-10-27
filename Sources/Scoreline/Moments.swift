import SwiftUI

// Live moments: when a new play arrives on a live match page, the chart it
// belongs to says what just happened with a small, transient animation of the
// event's own mark (the ball hopping on a pass, a shot's path drawing to the
// goal), and a caption under the chart for the ones that matter. One moment at
// a time; nothing replays what was already on screen.

/// Something that just happened, ready for its chart to show.
struct LiveMoment: Equatable, Identifiable {
    /// How much it matters: scores hold longest and are announced; routine
    /// plays only animate their mark.
    enum Tier: Int, Comparable {
        case routine = 1, swing, score
        static func < (a: Tier, b: Tier) -> Bool { a.rawValue < b.rawValue }
    }

    /// The chart that shows it (and captions it).
    enum Chart: Hashable { case field, pitch, plate, spray, rounds, wall, ascent, boulder, court }

    enum Kind: Equatable {
        // Football
        case touchdown, fieldGoal, fieldGoalMissed, turnover, safety, sack, passComplete, passIncomplete, rush, penalty
        // Soccer
        case goal, shotSaved, shotBlocked, shotWide, card(red: Bool)
        // Baseball
        case homeRun, runScored, hit, outInPlay, strikeout, walk
        // CS2
        case mapWon, roundWon
        // Climbing
        case top, passed, finished, zone
        // Basketball
        case made(value: Int), missed, run, leadChange, periodEnd
        // Baseball (new)
        case doublePlay
        // Basketball (new): the blocker or stealer is the moment's first target.
        case block, steal
    }

    /// What makes a moment more than its kind. "Decisive" is an accent on a
    /// score, not a fourth tier, so the single slot's rules stay the same.
    struct Accents: OptionSet, Equatable {
        let rawValue: Int
        /// Game-winner, walk-off, series or final won: gold, and a bigger burst.
        static let decisive = Accents(rawValue: 1 << 0)
        /// Football: a pass or rush of 20+ yards.
        static let bigPlay = Accents(rawValue: 1 << 1)
        static let dunk = Accents(rawValue: 1 << 2)
        static let andOne = Accents(rawValue: 1 << 3)
        /// Basketball: made with the clock at a second or less.
        static let buzzer = Accents(rawValue: 1 << 4)
        /// The shooter's last 3+ attempts all went in (count in `streak`).
        static let onFire = Accents(rawValue: 1 << 5)
        /// Basketball: last 5 minutes, within 5.
        static let clutch = Accents(rawValue: 1 << 6)
        /// Soccer: xG 0.3 or more, not scored.
        static let bigChance = Accents(rawValue: 1 << 7)
        static let woodwork = Accents(rawValue: 1 << 8)
        static let grandSlam = Accents(rawValue: 1 << 9)
        /// Boulder: topped on the first attempt.
        static let flash = Accents(rawValue: 1 << 10)
        static let newLeader = Accents(rawValue: 1 << 11)
        /// Climbing final: into the top three for the first time this climb.
        static let podium = Accents(rawValue: 1 << 12)
        /// Baseball: a triple (the play theater's banner brings confetti).
        static let triple = Accents(rawValue: 1 << 13)
    }

    let id: String
    let chart: Chart
    let tier: Tier
    let kind: Kind
    /// The outcome first ("Touchdown", "Round 14").
    let lead: String
    /// The play as the source tells it.
    let detail: String
    var side: GameDetail.Side? = nil
    var accents: Accents = []
    /// Consecutive makes (on fire), or rounds (a CS2 streak).
    var streak: Int? = nil
    /// Marks the moment touches beyond its own: every climber passed (lowest
    /// first), the blocker, the stealer.
    var targets: [String] = []
    /// From...to: climbing heights for a pass; game seconds for an NBA run.
    var span: ClosedRange<Double>? = nil
    /// Set by MomentCenter: a particle burst (confetti, fireworks) may play,
    /// because none has on this page in the last 10 seconds.
    var burst = false

    /// Routine moments animate without a caption.
    var captioned: Bool { tier >= .swing }
    var decisive: Bool { accents.contains(.decisive) }
}

/// The page's single moment slot.
@MainActor
@Observable
final class MomentCenter {
    private(set) var current: LiveMoment?
    /// Play IDs already shown (or on screen when the page opened), at the
    /// tier they were shown: a play edited into something bigger is news again.
    @ObservationIgnored private var seen: [String: LiveMoment.Tier] = [:]
    @ObservationIgnored private var hold: Task<Void, Never>?
    /// When this page last played a particle burst (confetti or fireworks).
    @ObservationIgnored private var lastBurst: ContinuousClock.Instant?
    /// The page's clock (tests move it by hand).
    @ObservationIgnored var now: () -> ContinuousClock.Instant = { ContinuousClock.now }

    private static let hold: Duration = .seconds(4)
    private static let scoreHold: Duration = .seconds(6)

    /// New events from one update. The most important wins the slot (the
    /// newest breaks ties); a catch-up burst plays only its newest score, or
    /// nothing; a lesser event never interrupts a greater one. Nothing queues:
    /// a late moment would lie about "now".
    func offer(_ batch: [LiveMoment]) {
        let fresh = batch.filter { moment in seen[moment.id].map { moment.tier > $0 } ?? true }
        for moment in fresh { seen[moment.id] = moment.tier }
        guard !fresh.isEmpty else { return }
        // At equal tier, decisive beats non-decisive, then the newest wins.
        let catchUp = fresh.filter(\.captioned).count > 3
        let candidate: LiveMoment? = catchUp
            ? fresh.last { $0.tier == .score && $0.decisive } ?? fresh.last { $0.tier == .score }
            : fresh.enumerated().max { a, b in
                if a.element.tier != b.element.tier { return a.element.tier < b.element.tier }
                if a.element.decisive != b.element.decisive { return !a.element.decisive }
                return a.offset < b.offset
            }?.element
        guard let candidate else { return }
        if let current, candidate.tier < current.tier
            || (candidate.tier == current.tier && current.decisive && !candidate.decisive) { return }
        // A catch-up is old news by the time it lands: it may show, but it never bursts.
        show(candidate, mayBurst: !catchUp)
    }

    /// A score taken back (overturned on review): if it's showing, it goes.
    func retract(_ ids: [String]) {
        guard let current, ids.contains(current.id) else { return }
        hold?.cancel()
        hold = nil
        withAnimation(Motion.exit) { self.current = nil }
    }

    /// Already on screen: never news.
    func remember(_ ids: some Sequence<String>) {
        for id in ids { seen[id] = .score }
    }

    func clear() {
        hold?.cancel()
        hold = nil
        current = nil
    }

    private func show(_ offered: LiveMoment, mayBurst: Bool = true) {
        hold?.cancel()
        // At most one particle burst every 10 s per page; a second score inside
        // the window gets the calmer substitute (sparks).
        var moment = offered
        if Celebration.wantsBurst(moment) {
            let time = now()
            moment.burst = mayBurst && (lastBurst.map { time - $0 >= Celebrate.cooldown } ?? true)
            if moment.burst { lastBurst = time }
        }
        withAnimation(Motion.reveal) { current = moment }
        // Same call as the visual, so sound and picture start together (opt-in, off by default).
        CelebrationSound.play(for: moment)
        if moment.tier == .score {
            Announcer.announce("\(moment.lead). \(moment.detail)")
        }
        let duration = moment.tier == .score ? Self.scoreHold : Self.hold
        hold = Task { [weak self] in
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled, let self, self.current?.id == moment.id else { return }
            withAnimation(Motion.exit) { self.current = nil }
        }
    }
}

extension Motion {
    /// Rings and settling washes: the house ease-out, stretched to read once.
    static let ping = Animation.timingCurve(0.23, 1, 0.32, 1, duration: 0.6)
}

/// One stroke ring that grows and fades, once: "here".
struct MomentPing: View {
    let color: Color
    var diameter: CGFloat = 12
    var reach: CGFloat = 1.8
    @State private var fired = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .strokeBorder(color, lineWidth: 1.5)
            .frame(width: diameter, height: diameter)
            .scaleEffect(fired ? reach : 0.6)
            .opacity(fired ? 0 : (reduceMotion ? 0 : 0.9))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { withAnimation(Motion.ping) { fired = true } }
    }
}

extension View {
    /// The moment for this chart, if the page is showing one.
    func momentFor(_ chart: LiveMoment.Chart, in center: MomentCenter?) -> LiveMoment? {
        center?.current?.chart == chart ? center?.current : nil
    }
}

/// The caption line for a moment: a red dot (live), the outcome, then the play.
/// The same type as a chart's hover readout, in the same place.
struct MomentCaption: View {
    let moment: LiveMoment
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(.red).frame(width: 5, height: 5)
            (Text(moment.lead).fontWeight(.semibold).foregroundStyle(.primary)
                + Text(moment.detail.isEmpty ? "" : "  \(moment.detail)").foregroundStyle(.secondary))
                .font(.system(size: 10.5).monospacedDigit())
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.top, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .id(moment.id)
        // Rises 4pt into place, like the app's other arriving text; leaves faster.
        .transition(.asymmetric(insertion: (reduceMotion ? AnyTransition.opacity : AnyTransition.opacity.combined(with: .offset(y: 4)))
                                    .animation(reduceMotion ? Motion.fade : Motion.reveal),
                                removal: .opacity.animation(Motion.exit)))
    }
}
