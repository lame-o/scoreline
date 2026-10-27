import Foundation
import SwiftUI

// LS (wave 2): the tiles' live-motion rules that aren't visual.
extension ScorelineTests {
    static func tilesMotion() {
        print("\nTiles motion")
        // Which tiles pop: sports whose every score is a score-tier moment.
        check(TileScore.pops(.football) && TileScore.pops(.soccer) && TileScore.pops(.baseball) && TileScore.pops(.esports),
              "a touchdown, a goal, a run, a CS2 map: the scorer's number pops")
        check(!TileScore.pops(.basketball), "a basket is routine: basketball tiles only flash")
        check(!TileScore.pops(nil), "no league, no pop")

        // The flash, as the harness's frozen clock draws it: the row flash's timings.
        check(TileFlash.level(at: 0) == 0, "the flash starts from nothing")
        check(abs(TileFlash.level(at: 1.0) - 1) < 0.001, "holds fully on through 1.6s")
        check(TileFlash.level(at: 3.0) < 0.001, "and is gone after the 1.2s decay")
        check(TileFlash.level(at: 1.0, reduceMotion: true) > 0.99 && TileFlash.level(at: 2.1, reduceMotion: true) < 0.001,
              "with Reduce Motion it decays in 0.3s")

        // Countdowns tick on shared boundaries, so every clock on the page lands in one frame.
        let start = Date(timeIntervalSinceReferenceDate: 100_000)
        func entries(from t: Double, _ n: Int) -> [Double] {
            let it = CountdownSchedule(start: start).entries(from: Date(timeIntervalSinceReferenceDate: t), mode: .normal)
            return (0..<n).compactMap { _ in it.next()?.timeIntervalSinceReferenceDate }
        }
        let far = entries(from: 100_000 - 7200 + 0.4, 3)
        check(far.count == 3 && far.dropFirst().allSatisfy { $0.truncatingRemainder(dividingBy: 30) == 0 },
              "more than an hour out, it ticks on the half minute")
        let near = entries(from: 100_000 - 600 + 0.37, 3)
        check(near.count == 3 && near.dropFirst().allSatisfy { $0 == $0.rounded() }, "in the last hour, on whole seconds")
        let edge = entries(from: 100_000 - 3600 - 10.2, 4)
        check(edge.contains { abs($0 - (100_000 - 3600 + 0.01)) < 0.001 }, "and it switches to seconds right at the hour")
    }
}
