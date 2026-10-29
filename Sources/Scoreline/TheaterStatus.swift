import SwiftUI

// What every isometric view says between plays, so a live game never looks
// frozen when nothing is being replayed: a broadcast tag for the state of
// play (SPURS BALL, TIMEOUT · JAZZ, END OF 3RD, MOUND VISIT, VAR CHECK), the
// heartbeat that says the feed is live and when it last spoke, and the
// control that turns the court or field round to match the viewer's TV. Each
// sport's theater decides what its status says from its feed; this file
// draws it the same way everywhere, in the scoring slide's broadcast type.

// MARK: - Status

/// The state of play a theater shows between (and during) plays.
struct TheaterStatus: Equatable {
    /// What's happening now, in a few words ("TIMEOUT · JAZZ", "SPURS BALL");
    /// nil when play is on and there's nothing to say.
    var tag: String?
    /// The tag's color: a team's (hex) for its ball, its timeout, its change;
    /// nil for the game's own moments (the end of a period, a review).
    var tint: String?
    /// When the feed last brought anything: the heartbeat counts from here.
    var updated: Date?

    init(tag: String? = nil, tint: String? = nil, updated: Date? = nil) {
        self.tag = tag
        self.tint = tint
        self.updated = updated
    }
}

/// The status tag, at the theater's top leading corner: square at the edge it
/// sits on, its far end cut on the type's lean, in the team's color (or near
/// black for the game's own), SF Pro Condensed Black slanted 12°, as the
/// scoring slide's kicker. Changes cross-fade; nil fades it away.
struct TheaterStatusTag: View {
    let status: TheaterStatus
    /// The well's height: the type is sized from it.
    let height: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static func size(for height: CGFloat) -> CGFloat { min(max(height * 0.052, 10), 14) }

    var body: some View {
        let size = Self.size(for: height)
        ZStack(alignment: .topLeading) {
            if let tag = status.tag {
                let paint = status.tint.map { SlidePaint.team($0, alternate: nil) }
                Text(tag)
                    .font(.system(size: size, weight: .black).width(.condensed))
                    .tracking(size * 0.06)
                    .textCase(.uppercase)
                    .foregroundStyle(paint?.ink ?? .white)
                    .lineLimit(1)
                    .oblique()
                    .padding(.leading, size * 0.75)
                    .padding(.trailing, size * 1.6 * SlideMetrics.lean + size * 0.7)
                    .frame(height: size * 1.6)
                    .background(CutShape(enters: .leading).fill(paint?.slabColor ?? Color(white: 0.06).opacity(0.88)))
                    .id(tag)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .offset(x: -8)))
                    .accessibilityLabel(tag.capitalized)
            }
        }
        .animation(reduceMotion ? Motion.fade : .easeOut(duration: 0.2), value: status.tag)
        .allowsHitTesting(false)
    }
}

/// The heartbeat, small at the theater's bottom trailing corner: the live dot
/// and how long since the feed last brought anything ("Live · 4s"), ticking
/// once a second only while it's on screen. Past a minute of silence it
/// says so ("Waiting for ESPN · 2m"), which is the honest state of a stoppage.
struct TheaterHeartbeat: View {
    let updated: Date?
    let source: String

    var body: some View {
        if let updated {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let seconds = max(Int(context.date.timeIntervalSince(updated)), 0)
                HStack(spacing: 4) {
                    Circle().fill(Color.red).frame(width: 5, height: 5)
                    Text(Self.label(seconds: seconds, source: source))
                        .font(.system(size: 9.5, weight: .semibold).monospacedDigit())
                        .foregroundStyle(.white.opacity(0.72))
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2.5)
                .background(Capsule().fill(.black.opacity(0.35)))
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    /// "Live · 4s", "Live · 45s", then "Waiting for ESPN · 2m". (pure; tested)
    static func label(seconds: Int, source: String) -> String {
        if seconds < 60 { return "Live · \(seconds)s" }
        return "Waiting for \(source) · \(seconds / 60)m"
    }
}

// MARK: - Orientation

/// Which way a theater faces for one game. Each sport has its own default
/// (which basket or end zone a team attacks in each half or quarter); TV
/// broadcasts don't all agree, so the viewer can turn it round once to match
/// theirs, remembered for that game, and the halves still swap on their own.
enum TheaterOrientation {
    static func key(_ eventID: String) -> String { "theaterFlip.\(eventID)" }

    static func flipped(_ eventID: String, defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: key(eventID))
    }
}

/// The control that turns the court round to match the TV: a small round
/// button at the theater's top trailing corner, shown while the pointer is
/// over the theater (and always to VoiceOver).
struct TheaterFlipButton: View {
    let eventID: String
    /// "court", "field" or "pitch", for its help and its label.
    let surface: String
    @AppStorage private var flipped: Bool

    init(eventID: String, surface: String) {
        self.eventID = eventID
        self.surface = surface
        _flipped = AppStorage(wrappedValue: false, TheaterOrientation.key(eventID))
    }

    var body: some View {
        Button {
            flipped.toggle()
        } label: {
            Image(systemName: "arrow.left.arrow.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .frame(width: 22, height: 22)
                .background(Circle().fill(.black.opacity(0.4)))
        }
        .buttonStyle(.plain)
        .help("Turn the \(surface) around to match your TV")
        .accessibilityLabel("Turn the \(surface) around")
        .accessibilityValue(flipped ? "Turned" : "As ESPN draws it")
    }
}
