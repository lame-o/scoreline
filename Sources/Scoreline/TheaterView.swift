import SwiftUI

// The game as one broadcast, part 15: the theater's view (CHOREOGRAPHY §5.6.7,
// §5.7, §10). One shell for every sport.
//
// It draws only what's seen, only as often as it moves: the plan's frame
// tiers (60 while anything is quick, decisive or the camera moves; 30 while it
// merely moves; nothing while nothing does) drive the TimelineView's schedule,
// and a folded or scrolled-away theater draws no frames at all (the clock and
// the plan carry on). Each frame reads the theater's time from the presentation
// clock, samples the chain into a scratch the view holds and never observes
// (no allocation, no invalidation), and hands it to the sport's painter.
//
// Reduce Motion: the same clock and the same plan, shown as key states (each
// clip's decisive moment and its end), each crossfading into the next over a
// quarter second on the house ease-out: no travel, no camera moves.

/// When the theater's frames come: by the plan's tiers on its own time, mapped to wall time.
struct TheaterSchedule: TimelineSchedule, Sendable {
    let tiers: [FrameTier]
    let time: TheaterTime
    let clock: PresentationClock
    /// Draw at all (seen, live): otherwise one frame, then nothing.
    let running: Bool

    func entries(from startDate: Date, mode: TimelineScheduleMode) -> Entries {
        Entries(date: startDate, schedule: self, low: mode == .lowFrequency)
    }

    struct Entries: Sequence, IteratorProtocol, Sendable {
        var date: Date
        let schedule: TheaterSchedule
        let low: Bool
        var first = true

        mutating func next() -> Date? {
            if first {
                first = false
                return date
            }
            guard schedule.running else { return nil }
            let wall = date.timeIntervalSince1970
            let T = schedule.time.at(wall, clock: schedule.clock)
            guard let tier = Self.tier(schedule.tiers, at: T) else { return nil }
            let step: Double
            if tier.fps == 0 || low {
                // Still: wake at the next tier that moves (or a second from now, low frequency).
                guard let moving = schedule.tiers.first(where: { $0.from > T && $0.fps > 0 }) else { return nil }
                step = low ? Swift.max(moving.from - T, 1) : Swift.max(moving.from - T, 1.0 / 60)
            } else {
                step = 1 / Double(tier.fps)
            }
            date = date.addingTimeInterval(step)
            return date
        }

        static func tier(_ tiers: [FrameTier], at T: PTime) -> FrameTier? {
            guard !tiers.isEmpty else { return nil }
            var lo = 0, hi = tiers.count - 1
            if T < tiers[0].from { return tiers[0] }
            while lo < hi {
                let mid = (lo + hi + 1) / 2
                if tiers[mid].from <= T { lo = mid } else { hi = mid - 1 }
            }
            return tiers[lo]
        }
    }
}

/// The key states Reduce Motion shows: each clip's decisive moment and its end, on the theater's time.
enum TheaterKeyStates {
    static func keys<Clip: TheaterClip>(_ plan: Plan<Clip>) -> [PTime] {
        var keys: [PTime] = [plan.start]
        for p in plan.placements {
            if let d = p.clip.decisive { keys.append(p.offset + d) }
            keys.append(p.offset + p.clip.length)
        }
        return keys.sorted()
    }

    /// The key state shown at T, the one before it, and how far the crossfade between them is (1: done).
    static func shown(_ keys: [PTime], at T: PTime) -> (now: PTime, before: PTime?, fade: Double) {
        guard let k = keys.lastIndex(where: { $0 <= T }) else { return (T, nil, 1) }
        let fade = min(max((T - keys[k]) / 0.25, 0), 1)
        return (keys[k], k > 0 ? keys[k - 1] : nil, TheaterCurve.out(fade))
    }
}

#if DEBUG
/// What a directed theater drew in a frame, for the offscreen check: the theater's time, the clock's p, the play in
/// charge and whether its decisive moment has been reached (the frame the score lands with).
struct TheaterFrameReport: Equatable {
    var wall: PTime
    var T: PTime
    var p: PTime
    var play: String?
    var clipTime: Double
    var decisive: Double?
    var reached: Bool { decisive.map { clipTime >= $0 - 1e-6 } ?? false }
}

private struct TheaterFrameProbeKey: EnvironmentKey {
    static let defaultValue: ((TheaterFrameReport) -> Void)? = nil
}

extension EnvironmentValues {
    /// The offscreen check's hook: each directed frame reports what it drew.
    var theaterFrameProbe: ((TheaterFrameReport) -> Void)? {
        get { self[TheaterFrameProbeKey.self] }
        set { self[TheaterFrameProbeKey.self] = newValue }
    }
}
#endif
