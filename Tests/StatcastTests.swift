import Foundation

// MLB's Statcast feed (Tests/Fixtures/statcast-849804.json: World Series Game 3,
// trimmed with Statcast.fields): at-bats and their batted balls, each pitch's
// flight landing where Statcast measured it crossing the plate, ESPN's results
// matched to their at-bats, and the ESPN game found in MLB's schedule.

extension ScorelineTests {
    static func statcast() {
        print("\nStatcast")
        let dir = FixtureProtocol.directory
        guard let feed = try? Data(contentsOf: dir.appendingPathComponent("statcast-849804.json")),
              let schedule = try? Data(contentsOf: dir.appendingPathComponent("statcast-schedule-20261026.json")) else {
            return check(false, "Statcast fixtures load")
        }
        let atBats = Statcast.atBats(JSON(data: feed))
        check(atBats.count == 76 && atBats.first?.inning == 1 && atBats.first?.top == true, "every at-bat of the game, in order", "\(atBats.count)")

        let chourio = atBats.first { $0.batter == "Jackson Chourio" && $0.batted != nil }
        check(chourio?.batted?.launchSpeed == 104.4 && chourio?.batted?.launchAngle == 12 && chourio?.batted?.distance == 273
              && chourio?.batted?.trajectory == "line_drive",
              "a batted ball: exit velocity, launch angle, distance, trajectory", "\(String(describing: chourio?.batted))")
        check(chourio?.batted?.line == "104.4 MPH · 12° · 273 FT", "the readout line", chourio?.batted?.line ?? "-")

        // Every measured pitch, flown from release, crosses the plate where Statcast says (within an inch).
        let pitches = atBats.flatMap(\.pitches)
        let off = pitches.compactMap { p -> Double? in
            guard let t = p.plateTime else { return nil }
            let at = p.position(at: t)
            return max(abs(at.x - p.plate.x), abs(at.z - p.plate.y))
        }
        check(pitches.count > 250 && off.count == pitches.count && (off.max() ?? 1) < 1.0 / 12,
              "each pitch's flight lands on its measured plate location", "\(pitches.count) pitches, worst \(off.max() ?? -1) ft")
        check(pitches.allSatisfy { ($0.plateTime ?? 0) > 0.3 && ($0.plateTime ?? 1) < 0.6 }, "release to plate takes 0.3–0.6 s")

        // ESPN's "Turang grounded out to shortstop." in the top of the 1st.
        let turang = Statcast.match(inning: 1, top: true, surname: "Turang", in: atBats)
        check(turang?.batted?.launchSpeed == 67 && turang?.batted?.trajectory == "ground_ball", "an ESPN result finds its at-bat by half-inning and surname")
        check(Statcast.match(inning: 1, top: true, surname: "Diaz", in: atBats) == nil
              && Statcast.match(inning: 1, top: false, surname: "Díaz", in: atBats)?.batter == "Yandy Díaz"
              && Statcast.match(inning: 1, top: false, surname: "diaz", in: atBats)?.batter == "Yandy Díaz",
              "the right half-inning only, accents and case aside")

        check(Statcast.game(in: JSON(data: schedule), teams: ["Brewers", "Rays"]) == 849804
              && Statcast.game(in: JSON(data: schedule), teams: ["Brewers", "Dodgers"]) == nil,
              "the ESPN game in MLB's schedule, by both teams")
        let night = ISO8601DateFormatter().date(from: "2026-10-27T02:10:00Z")!
        check(Statcast.scheduleURL(for: night)?.absoluteString.hasSuffix("date=2026-10-26") == true,
              "a late game is on its Eastern date in MLB's schedule")
    }
}
