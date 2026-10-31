import SwiftUI

// How far behind live the game page is (BROADCAST §2: the presentation
// clock's current delay), shown only on hover over the live indicator — the
// hero's red dot and clock, the docked bar's — and given to VoiceOver as the
// hero's value. At rest the dot stays clean: no number on the page.
//
// The card is the house's floating glass (the peek pill's type and material),
// anchored under the indicator. Motion, Emil's and Apple's way: it waits for
// the pointer to settle (80 ms, as linked hover does), then grows out of the
// indicator — 0.97 → 1 with a 2 pt drop, on `Motion.fade` — and leaves faster
// than it came (`Motion.exit`), a plain fade. With Reduce Motion, a fade in.

/// The readout: the delay rounded to 5 s, and a quieter note while the clock
/// is catching up or waiting on the feed. (pure; tested)
struct BehindLive: Equatable, Sendable {
    /// Seconds behind live, rounded to 5 (never under 5).
    let seconds: Int
    /// "Catching up", "Waiting for the feed", or nil.
    let note: String?

    init(seconds: Int, note: String? = nil) {
        self.seconds = seconds
        self.note = note
    }

    /// From the clock's current delay and regime.
    init(delay: Double, regime: PresentationClock.Regime) {
        seconds = max(5, Int((delay / 5).rounded()) * 5)
        switch regime {
        case .catchingUp: note = "Catching up"
        case .stalled: note = "Waiting for the feed"
        default: note = nil
        }
    }

    /// "About 55 s behind live", "About 1 min 40 s behind live".
    var text: String { "About \(Self.duration(seconds, short: true)) behind live" }

    /// VoiceOver's: the same, in words ("About 55 seconds behind live, catching up").
    var spoken: String {
        "About \(Self.duration(seconds, short: false)) behind live" + (note.map { ", \($0.lowercased())" } ?? "")
    }

    static func duration(_ seconds: Int, short: Bool) -> String {
        let m = seconds / 60, s = seconds % 60
        func unit(_ n: Int, _ abbreviation: String, _ word: String) -> String {
            short ? "\(n) \(abbreviation)" : "\(n) \(word)\(n == 1 ? "" : "s")"
        }
        if m == 0 { return unit(s, "s", "second") }
        return s == 0 ? unit(m, "min", "minute") : "\(unit(m, "min", "minute")) \(unit(s, "s", "second"))"
    }
}

/// The card: one line, and the note under it in secondary.
struct BehindLiveCard: View {
    let behind: BehindLive

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(behind.text)
                .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                .foregroundStyle(.primary)
            if let note = behind.note {
                Text(note).font(.system(size: 10)).foregroundStyle(.secondary)
            }
        }
        .lineLimit(1)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .floatingGlass(in: RoundedRectangle(cornerRadius: 9, style: .continuous), interactive: false)
    }
}

extension View {
    /// The live indicator's hover: while the pointer rests on it, it offers the
    /// readout to the nearest `behindLiveHost()` above it, which draws the card
    /// under it (`alignment`: centered under the hero's, trailing under the
    /// bar's). Nil (not broadcasting): no hover, nothing changes.
    /// `below`: the gap from the indicator's bottom to the card's top.
    func behindLiveHover(_ behind: BehindLive?, alignment: HorizontalAlignment = .center, below: CGFloat = 6, id: String) -> some View {
        modifier(BehindLiveHover(behind: behind, alignment: alignment, below: below, id: id))
    }

    /// Draws the live indicator's card, outside any glass container below it
    /// (inside one, the card's glass would blend into the hero's, and the
    /// container's later shapes would cover it), as the hero's slide is drawn.
    func behindLiveHost() -> some View { modifier(BehindLiveHost()) }
}

/// Where the card goes: under the indicator, aligned to it.
struct BehindLiveSpot {
    let anchor: Anchor<CGRect>
    let behind: BehindLive
    let alignment: HorizontalAlignment
    let below: CGFloat
}

private struct BehindLiveSpotKey: PreferenceKey {
    static var defaultValue: BehindLiveSpot? { nil }
    static func reduce(value: inout BehindLiveSpot?, nextValue: () -> BehindLiveSpot?) {
        if let next = nextValue() { value = next }
    }
}

private struct BehindLiveHover: ViewModifier {
    let behind: BehindLive?
    let alignment: HorizontalAlignment
    let below: CGFloat
    let id: String
    @State private var shown = false
    @State private var intent: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .contentShape(Rectangle())
            .onHover { inside in hover(inside) }
            .anchorPreference(key: BehindLiveSpotKey.self, value: .bounds) { anchor in
                guard shown, let behind else { return nil }
                return BehindLiveSpot(anchor: anchor, behind: behind, alignment: alignment, below: below)
            }
            #if DEBUG
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { BehindLiveFrames.frames[id] = $0 }
            .onChange(of: shown) { _, now in BehindLiveFrames.shown[id] = now }
            #endif
    }

    private func hover(_ inside: Bool) {
        intent?.cancel()
        intent = nil
        guard inside else {
            shown = false
            return
        }
        guard behind != nil, !shown else { return }
        // Wait for the pointer to settle, so sweeping across the page doesn't flash it.
        intent = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(80))
            guard !Task.isCancelled else { return }
            shown = true
        }
    }
}

private struct BehindLiveHost: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.celebrationClock) private var clock

    func body(content: Content) -> some View {
        content.overlayPreferenceValue(BehindLiveSpotKey.self) { spot in
            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    Color.clear
                    if let spot {
                        let rect = proxy[spot.anchor]
                        BehindLiveCard(behind: spot.behind)
                            .fixedSize()
                            // Its top `below` under the indicator, centered on it or flush with its trailing edge.
                            .alignmentGuide(.leading) { d in
                                -(spot.alignment == .trailing ? rect.maxX - d.width : spot.alignment == .leading ? rect.minX : rect.midX - d.width / 2)
                            }
                            .alignmentGuide(.top) { _ in -(rect.maxY + spot.below) }
                            .transition(transition(spot.alignment))
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private func transition(_ alignment: HorizontalAlignment) -> AnyTransition {
        // The render harness's frozen clock: the settled frame (its windows don't run animations).
        guard clock == .live else { return .identity }
        let x: CGFloat = alignment == .leading ? 0 : alignment == .trailing ? 1 : 0.5
        let insertion = reduceMotion ? AnyTransition.opacity
            : AnyTransition.opacity.combined(with: .scale(scale: 0.97, anchor: UnitPoint(x: x, y: 0))).combined(with: .offset(y: -2))
        return .asymmetric(insertion: insertion.animation(Motion.fade), removal: .opacity.animation(Motion.exit))
    }
}

#if DEBUG
/// The live indicators' frames in their window (top-left points), for the render harness's synthesized hover.
@MainActor enum BehindLiveFrames {
    static var frames: [String: CGRect] = [:]
    /// Whether each one's card is up (the hover reached it).
    static var shown: [String: Bool] = [:]
}
#endif
