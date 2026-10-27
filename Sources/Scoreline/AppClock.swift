import Foundation

/// The time the live path reads: when a reading was taken, how far a game
/// clock has run since, what's on now, how soon to poll again. Always the
/// system clock, except in Scoreline Studio (the launch-video build, compiled
/// with -D STUDIO), which replays recorded games on a virtual clock that can
/// run faster than real time. Animations keep real time either way.
enum AppClock {
    #if STUDIO
    /// Virtual time: `start` + (real time − `launch`) × `speed`.
    nonisolated(unsafe) static var start = Date()
    nonisolated(unsafe) static var launch = Date()
    nonisolated(unsafe) static var speed = 1.0

    static var now: Date { time(at: Date()) }
    /// The virtual time at a real one (a TimelineView's frame date).
    static func time(at real: Date) -> Date { start + real.timeIntervalSince(launch) * speed }
    /// Real seconds for something done every `seconds` of game time (polls, a clock's tick).
    static func interval(_ seconds: Double) -> Double { seconds / speed }
    #else
    static var now: Date { Date() }
    static func time(at real: Date) -> Date { real }
    static func interval(_ seconds: Double) -> Double { seconds }
    #endif
}
