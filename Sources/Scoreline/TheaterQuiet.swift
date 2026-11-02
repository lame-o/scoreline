import Foundation

// A stoppage's quiet. The isometric views never freeze during a live game, and
// they never announce the same thing twice: once a timeout, a TV break or a
// half has walked everyone where they're going, it holds there, with a man
// shifting his feet, a knee taken, a hand up for the bench. Sparse beats, cheap
// to draw, seeded from the stoppage so it's the same every time, nobody still
// for long, and everyone back where he was by the loop's end, so round it goes
// with no seam and nobody walking off again.

struct TheaterQuiet: Equatable {
    enum Beat: Equatable {
        /// A few steps off (`toward`: each axis in -1...1, the sport's scale to apply) and, at `back`, back where he was.
        case step(man: Int, at: Double, toward: CGPoint, back: Double)
        /// On a knee for a while.
        case knee(man: Int, at: Double, until: Double)
        /// A hand up: a word to the bench.
        case gesture(man: Int, at: Double, until: Double)
    }

    /// In the order they happen.
    var beats: [Beat] = []
    var period = 0.0

    /// How long a step takes.
    static let stride = 1.2
    /// A loop's length, long enough that it doesn't read as one.
    static let length = 48.0
    /// Between one beat and the next: nothing's still past about 8 s, the loop's seam included.
    static let gap = 3.5...5.5

    /// `men`: who's there to move. `poses`: the sport can put a man on a knee or
    /// a hand up (else every beat is a step). Empty with nobody to move. (pure; tested)
    static func make(men: [Int], from start: Double, length: Double = TheaterQuiet.length, poses: Bool = true, random: inout SplitMix64) -> TheaterQuiet {
        guard !men.isEmpty else { return TheaterQuiet() }
        var times: [Double] = []
        var t = start + random.in(0.5...1.5)
        while t + 2 * stride + 1 < start + length {
            times.append(t)
            t += random.in(gap)
        }
        // A small crew can't have two of its men away at once.
        let away = men.count >= 4 ? 2 : 1
        var free = Dictionary(uniqueKeysWithValues: men.map { ($0, start) })
        var beats: [Beat] = []
        for (k, at) in times.enumerated() {
            let ready = men.filter { (free[$0] ?? start) <= at }
            guard !ready.isEmpty else { continue }
            let man = ready[min(Int(random.in(0...1) * Double(ready.count)), ready.count - 1)]
            let until = k + away < times.count ? times[k + away] : at + stride + 0.2
            let roll = random.in(0...1)
            if poses, roll < 0.2 {
                let down = at + random.in(0.8...1.2)
                beats.append(.gesture(man: man, at: at, until: down))
                free[man] = down + 0.5
            } else if poses, roll < 0.4 {
                beats.append(.knee(man: man, at: at, until: until))
                free[man] = until + 0.5
            } else {
                beats.append(.step(man: man, at: at, toward: CGPoint(x: random.in(-1...1), y: random.in(-1...1)), back: until))
                free[man] = until + stride
            }
        }
        return TheaterQuiet(beats: beats, period: length)
    }
}
