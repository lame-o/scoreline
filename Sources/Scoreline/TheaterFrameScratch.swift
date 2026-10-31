import Foundation

// The game as one broadcast, part 13: the frame path (CHOREOGRAPHY §5.7, §8).
//
// A frame samples the plan chain into a scratch object the view holds and
// never observes: buffers sized once (32 figures: football's 22 and its staff),
// refilled each frame without allocating. The painter reads it.
//
// And the frame path, measured (§8.5): the bench (Tests/TheaterBench.swift)
// times every frame's sampling and posing and its Canvas, and counts the
// allocations in each. The count comes from libmalloc's logger hook, which the
// bench installs; nothing in that part runs in the app.

/// What one frame draws at p, refilled every frame (never observed).
final class FrameScratch {
    struct Actor {
        var id: ActorID
        /// Its track in the plan.
        var track: Int
        var position: SIMD2<Double>
        var opacity: Double
        var motion: RigMotion
        /// The clip that poses him and his figure in it, at its time.
        var placement: Int
        var figure: Int
        var clipTime: Double
        /// While he travels from one clip to the next: the one he leaves, and how far the blend is (1: all the new one's).
        var previousPlacement = -1
        var previousFigure = -1
        var previousTime = 0.0
        var blend = 1.0
    }

    enum Ball: Equatable {
        case none
        /// In a clip (it says where and whose).
        case clip(Int)
        /// In a man's hands across a splice.
        case held(ActorID)
        /// Passed between clips.
        case free(SIMD3<Double>)
    }

    static let capacity = 32

    var p: PTime = 0
    /// The chain's plan (−1: nothing yet), and the placement covering p in it.
    var plan = -1
    var placement = -1
    /// x, y of the ground center, log span, yaw.
    var camera = SIMD4<Double>(0, 0, 0, 0)
    var actors = ContiguousArray<Actor>()
    var ball = Ball.none
    /// Depth order for the painter (insertion sort into this buffer).
    var order = ContiguousArray<Int>()

    init() {
        actors.reserveCapacity(Self.capacity)
        order.reserveCapacity(Self.capacity)
    }

    /// The actors far to near by `depth` (larger first), into `order`: insertion sort, no allocation.
    func sortByDepth(_ depth: (Actor) -> Double) {
        order.removeAll(keepingCapacity: true)
        for i in actors.indices {
            let d = depth(actors[i])
            var j = order.count
            order.append(i)
            while j > 0, depth(actors[order[j - 1]]) < d {
                order[j] = order[j - 1]
                j -= 1
            }
            order[j] = i
        }
    }
}

#if BENCH

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
