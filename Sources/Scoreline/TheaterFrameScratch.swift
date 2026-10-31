import Foundation

// The theater's frame path, measured (CHOREOGRAPHY §8.5): the bench
// (Tests/TheaterBench.swift) times every frame's sampling and posing and its
// Canvas, and counts the allocations in each. The count comes from libmalloc's
// logger hook, which the bench installs; nothing here runs in the app.

#if BENCH
import Darwin

/// Time and allocations inside a theater's drawing: a Canvas opens a probe
/// at its top and closes it at its end; the bench reads what it recorded.
enum TheaterProbe {
    /// Allocations counted while `counting` (the bench's malloc logger bumps it).
    nonisolated(unsafe) static var allocations = 0
    nonisolated(unsafe) static var counting = false
    /// Each Canvas drawn while `recording`: its seconds and allocations.
    nonisolated(unsafe) static var recording = false
    nonisolated(unsafe) static var canvases: [(seconds: Double, allocations: Int)] = []

    struct Mark {
        let start: UInt64
        let allocations: Int
    }

    static func open() -> Mark? {
        guard recording else { return nil }
        let mark = Mark(start: clock_gettime_nsec_np(CLOCK_UPTIME_RAW), allocations: allocations)
        counting = true
        return mark
    }

    static func close(_ mark: Mark?) {
        guard let mark else { return }
        let end = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
        counting = false
        canvases.append((Double(end - mark.start) / 1e9, allocations - mark.allocations))
    }

    /// Runs `body` counting its allocations; returns its seconds and the count.
    static func measure<T>(_ body: () -> T) -> (value: T, seconds: Double, allocations: Int) {
        let before = allocations
        let start = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
        counting = true
        let value = body()
        counting = false
        let end = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
        return (value, Double(end - start) / 1e9, allocations - before)
    }

    /// Installs the malloc logger once (it counts allocations while `counting`).
    static func install() {
        guard !installed else { return }
        installed = true
        guard let symbol = dlsym(dlopen(nil, RTLD_NOW), "malloc_logger") else { return }
        symbol.assumingMemoryBound(to: Optional<Logger>.self).pointee = { type, _, _, _, _, _ in
            // MALLOC_LOG_TYPE_ALLOCATE
            if TheaterProbe.counting, type & 2 != 0 { TheaterProbe.allocations &+= 1 }
        }
    }

    private typealias Logger = @convention(c) (UInt32, UInt, UInt, UInt, UInt, UInt32) -> Void
    nonisolated(unsafe) private static var installed = false
}
#endif
