import Foundation
import SwiftUI

// The docked bars beyond the match page (a player's name bar, the season
// pages' strip): how far their heroes dock as the page scrolls, what the bars
// say, the strip's marks, scrolling a row to just under a bar, and the hero
// photo's rules (the hero's size from the first frame, never a swap).

extension ScorelineTests {
    static func dockPages() {
        print("\nDocked bars: player and season pages")
        func rosters(_ name: String) -> Data {
            (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/rosters/\(name).json"))) ?? Data()
        }

        // MARK: Dock progress

        // A player's hero (6pt down, 104 tall) and a season card (4pt down, 149 tall), as the pages lay them out.
        let player = { (y: CGFloat) in DockRules.progress(offset: y, heroMinY: 6, heroHeight: 104) }
        check(player(0) == 0 && player(6 + 26) == 0, "player: nothing docks until a quarter of the hero is under the header")
        check(player(69) == 0.5 && player(6 + 26 + 74) == 1 && player(900) == 1,
              "player: half docked at 69pt, fully docked three quarters of the hero later, and stays", "\(player(69))")
        let card = { (y: CGFloat) in DockRules.progress(offset: y, heroMinY: 4, heroHeight: 149) }
        check(card(41) == 0 && abs(card(95) - 0.5) <= 1.0 / 64 && card(150) == 1,
              "season card: starts at a quarter of the card, half at 95pt, docked by the card's bottom edge", "\(card(95))")
        for (name, minY, height) in [("player", CGFloat(6), CGFloat(104)), ("season", 4, 149), ("season, one lane", 4, 117)] {
            let samples = stride(from: CGFloat(0), through: 260, by: 0.5).map { DockRules.progress(offset: $0, heroMinY: minY, heroHeight: height) }
            check(zip(samples, samples.dropFirst()).allSatisfy { $0 <= $1 } && samples.allSatisfy { ($0 * 64).rounded() == $0 * 64 }
                  && Set(samples).count <= 65,
                  "\(name): monotonic and quantized to 1/64 (at most 65 values: a dock step, never a frame, re-renders the bar)")
            // The hero's tuck, from its frame in the viewport, against the bar.
            let shown = stride(from: CGFloat(0), through: 260, by: 0.5).map { y -> Double in
                let p = DockRules.progress(offset: y, heroMinY: minY, heroHeight: height)
                return max(DockRules.heroTuck(minY: minY - y, height: height).opacity, DockRules.barOpacity(p))
            }
            check(shown.allSatisfy { $0 > 0.04 }, "\(name): the hero or its bar is always showing", "\(shown.min() ?? 0)")
            let handOff = stride(from: CGFloat(0), through: 260, by: 0.5).filter {
                DockRules.surface(p: DockRules.progress(offset: $0, heroMinY: minY, heroHeight: height)) == .bar
            }.first.map { DockRules.heroTuck(minY: minY - $0, height: height).opacity } ?? 1
            check(handOff < 0.15, "\(name): when the bar takes over (half docked), the hero has all but faded", "\(handOff)")
        }

        // MARK: Player bar

        let lakers = Profile.TeamRef(id: "espn-basketball-13", name: "Lakers", abbreviation: "LAL")
        var bio = Profile.Bio(name: "LeBron James")
        bio.positionAbbreviation = "F"
        bio.position = "Forward"
        check(PlayerDock.detail(sport: .basketball, bio: bio, team: lakers, loaded: true) == "LAL · F", "player bar: team and position, abbreviated")
        var free = Profile.Bio(name: "Someone")
        check(PlayerDock.detail(sport: .football, bio: free, team: nil, loaded: false) == nil
              && PlayerDock.detail(sport: .football, bio: free, team: nil, loaded: true) == "Free agent",
              "no team: nothing while loading, then \"Free agent\"")
        free.active = false
        check(PlayerDock.detail(sport: .football, bio: free, team: nil, loaded: true) == "Retired", "inactive: \"Retired\"")
        var climber = Profile.Bio(name: "Janja Garnbret")
        climber.country = "SLO"
        climber.nationality = "Slovenia"
        check(PlayerDock.detail(sport: .climbing, bio: climber, team: nil, loaded: true) == "\(Flag.emoji(ioc: "SLO") ?? "") Slovenia",
              "climbers: flag and country")
        check(PlayerDock.detail(sport: .esports, bio: Profile.Bio(name: "ZywOo"), team: Profile.TeamRef(id: "cs-667", name: "Vitality"),
                                loaded: true) == "Vitality", "CS2: the team")
        let tiles = [Profile.StatTile(label: "PTS", value: "27.4"), Profile.StatTile(label: "REB", value: "8.1")]
        check(PlayerDock.stat(tiles)?.label == "PTS" && PlayerDock.stat([]) == nil, "the bar's stat is the season's lead tile")
        let bar = PlayerDockBar(name: "LeBron James", photo: nil, crop: .cutout, tint: .blue, detail: "LAL · F", stat: tiles[0], photoSize: 76)
        let changed = PlayerDockBar(name: "LeBron James", photo: nil, crop: .cutout, tint: .blue, detail: "LAL · F", stat: tiles[1], photoSize: 76)
        check(bar == PlayerDockBar(name: "LeBron James", photo: nil, crop: .cutout, tint: .blue, detail: "LAL · F", stat: tiles[0], photoSize: 76)
              && bar != changed, "the player bar is equal while what it shows is (its body skips dock steps)")

        // MARK: Season card and bar

        func event(_ id: String, _ m: Int, _ d0: Int, _ d1: Int, lanes: [String] = ["boulder"], status: SeasonEvent.Status = .finished) -> SeasonEvent {
            SeasonEvent(id: id, kind: .climbing(Int(id.dropFirst(1)) ?? 0), name: id, shortName: id.uppercased(),
                        startDay: DayKey(year: 2026, month: m, day: d0), endDay: DayKey(year: 2026, month: m, day: d1),
                        lanes: lanes, status: status)
        }
        let season = [event("e3", 6, 10, 12, lanes: ["lead"]), event("e1", 4, 9, 11), event("e2", 4, 11, 13, lanes: ["lead", "speed"]),
                      event("e4", 9, 20, 28, lanes: ["lead", "boulder", "speed"], status: .upcoming)]
        let axis = SeasonAxis(events: season, lanes: [], today: DayKey(year: 2026, month: 7, day: 1), next: "e4", selected: nil,
                              readouts: ["e1": "E1 · Apr 9–11", "e4": "E4 · Sep 20–28"], resting: "e4")
        check(axis.readout(hovered: "e1") == "E1 · Apr 9–11" && axis.readout(hovered: nil) == "E4 · Sep 20–28"
              && axis.readout(hovered: "nope") == "E4 · Sep 20–28",
              "readout: the one under the pointer, else the resting one (what's live or next, the latest result)")
        var quiet = axis
        quiet.resting = nil
        check(quiet.readout(hovered: nil) == nil, "readout: nothing hovered and nothing resting says nothing")
        let summary = SeasonSummary(headline: "Next: E4", subline: "Sep 20–28 · in 81 days")
        check(SeasonDock.line(summary, hovered: nil, axis: axis) == ("Next: E4", "Sep 20–28 · in 81 days")
              && SeasonDock.line(summary, hovered: "e1", axis: axis) == ("E1 · Apr 9–11", nil),
              "the bar's line: the headline and subline, or the hovered competition's readout alone")

        let domain = SeasonTimeline.domain(season)
        let marks = SeasonDock.strip(season, domain: domain, width: 300)
        check(marks.map(\.event) == ["e1", "e2", "e3", "e4"], "strip: one mark per competition, whatever its disciplines, in date order",
              "\(marks.map(\.event))")
        check(marks.allSatisfy { $0.rect.width >= 4 && $0.rect.minY >= 0 && $0.rect.maxY <= SeasonDock.stripHeight && $0.rect.maxX <= 300 + 4 }
              && zip(marks, marks.dropFirst()).allSatisfy { $1.rect.minX >= $0.rect.maxX + 1.5 - 0.001 },
              "strip: marks at least 4pt wide, inside the strip, and clear of each other (overlapping dates step aside)")
        check(marks[3].rect.width > marks[0].rect.width, "strip: a nine-day competition is longer than a three-day one")
        check(SeasonTimeline.hit(marks, at: CGPoint(x: marks[2].rect.midX, y: 5)) == "e3"
              && SeasonTimeline.hit(marks, at: CGPoint(x: marks[3].rect.maxX + 40, y: 5)) == nil,
              "strip: the timeline's hit rule finds the mark under the pointer, nothing far from one")
        let seasonBar = SeasonDockBar(summary: summary, axis: axis, hover: HighlightState(), actions: SeasonDockActions())
        check(seasonBar == seasonBar && seasonBar != SeasonDockBar(summary: summary, axis: axis, hover: HighlightState(), actions: seasonBar.actions),
              "the season bar is equal while its inputs are (its body skips dock steps; hovering re-runs only its readers)")

        // MARK: Summaries

        let today = DayKey(year: 2026, month: 10, day: 26)
        check(SeasonSummary.when(today, today: today) == "starts today" && SeasonSummary.when(today.adding(days: 1), today: today) == "starts tomorrow"
              && SeasonSummary.when(today.adding(days: 3), today: today).hasPrefix("starts ")
              && SeasonSummary.when(today.adding(days: 12), today: today) == "in 12 days",
              "when: today, tomorrow, a weekday within the week, else in days")
        var santiago = event("e9", 10, 23, 25, lanes: ["lead"], status: .live)
        santiago.countryCode = "CL"
        let live = SeasonSummary.climbing(live: santiago, next: nil, previousSeasonOver: nil, today: today)
        check(live.live && live.headline == "Live now · 🇨🇱 E9" && live.subline == "Oct 23–25 · Lead",
              "climbing card, live: the dot, the competition, its dates and disciplines", "\(live)")
        let tokyo = SeasonEvent(id: "t", kind: .climbing(1544), name: "Tokyo", shortName: "Tokyo", countryCode: "JP",
                            startDay: DayKey(year: 2027, month: 4, day: 9), endDay: DayKey(year: 2027, month: 4, day: 11),
                            lanes: ["boulder"], status: .upcoming)
        let between = SeasonSummary.climbing(live: nil, next: tokyo, previousSeasonOver: "2026", today: today)
        check(!between.live && between.headline == "2026 season complete" && between.subline == "2027 starts Apr 9 in Tokyo · 165 days",
              "climbing card, between seasons: the last one's done, when the next starts", "\(between)")
        let next = SeasonSummary.climbing(live: nil, next: tokyo, previousSeasonOver: nil, today: today)
        check(next.headline == "Next: 🇯🇵 Tokyo" && next.subline == "Apr 9–11 · in 165 days", "climbing card: what's next, and when", "\(next)")
        check(SeasonSummary.climbing(live: nil, next: nil, previousSeasonOver: nil, today: today).headline == "Season complete",
              "climbing card: nothing left")
        check(SeasonSummary.results(season: "2026", finished: 10, total: 10) == SeasonSummary(headline: "2026 season complete", subline: "10 competitions")
              && SeasonSummary.results(season: "2026", finished: 7, total: 10).subline == "7 of 10 competitions finished",
              "results card: the season done (and how many), or how far along")
        var beijing = SeasonEvent(id: "cs-1", kind: .tournament(slug: "iem-beijing-2026"), name: "IEM Beijing", shortName: "IEM Beijing",
                                  startDay: DayKey(year: 2026, month: 11, day: 2), endDay: DayKey(year: 2026, month: 11, day: 7),
                                  lanes: ["s"], status: .upcoming)
        beijing.prize = 1_250_000
        check(SeasonSummary.tournaments(next: beijing, today: today) == SeasonSummary(headline: "Next: IEM Beijing", subline: "Nov 2–7 · in 7 days · $1.25M")
              && SeasonSummary.tournaments(next: nil, today: today).headline == "No S-tier tournaments ahead",
              "CS2 card: the next S-tier tournament, when and for how much")
        beijing.status = .live
        let match = Event(id: "m", content: .match(top: comp("cs-793", "G2"), bottom: comp("cs-667", "Vitality")), state: .live, start: .now,
                          detail: nil, caption: nil, link: nil)
        let underway = SeasonSummary.tournaments(live: beijing, match: match)
        check(underway.live && underway.headline == "Live now · IEM Beijing" && underway.subline == "Live: G2 v Vitality" && underway.sublineLive,
              "CS2 card, underway: the tournament, and its live match in red", "\(underway)")
        check(SeasonSummary.tournaments(live: beijing, match: nil).subline == "Nov 2–7 · $1.25M" && !SeasonSummary.tournaments(live: beijing, match: nil).sublineLive,
              "CS2 card, underway between matches: its dates and prize")
        let finished = SeasonSummary.tournamentResults([beijing, event("e1", 5, 3, 9)])
        check(finished.headline == "2 S-tier tournaments" && finished.subline == "Since May 2026"
              && SeasonSummary.tournamentResults([beijing]).headline == "1 S-tier tournament"
              && SeasonSummary.tournamentResults([]).headline == "No S-tier results yet",
              "CS2 results card: how many, since when", "\(finished)")

        // MARK: Rows under the bar

        let viewport = CGRect(x: 0, y: 300, width: 340, height: 440)
        let row = { (y: CGFloat) in CGRect(x: 0, y: y, width: 340, height: 44) }
        check(PageGeometry.reveal(row(330), visible: viewport, topInset: SeasonDock.reserve) == 330 - SeasonDock.reserve,
              "a highlighted row under the docked bar scrolls to just below it")
        check(PageGeometry.reveal(row(720), visible: viewport, topInset: SeasonDock.reserve) == 720 + 44 - 440,
              "a row below the viewport scrolls up the least, to its bottom edge")
        check(PageGeometry.reveal(row(500), visible: viewport, topInset: SeasonDock.reserve) == nil, "a row in view doesn't scroll")
        check(PageGeometry.reveal(row(20), visible: viewport.offsetBy(dx: 0, dy: -290), topInset: SeasonDock.reserve) == 0,
              "never above the top")
        let geometry = PageGeometry()
        var scrolledTo: CGFloat?
        geometry.scrollHandler = { y, _ in scrolledTo = y }
        geometry.report(anchor: row(812), for: "ifsc-1489")
        geometry.scroll(toAnchor: "ifsc-1489", topInset: SeasonDock.reserve, animated: false)
        check(scrolledTo == 812 - SeasonDock.reserve && geometry.frames.isEmpty,
              "a mark clicked in the bar brings its row up to just under the bar; rows aren't sections (scrolling never visits them)")

        // MARK: Hero photo

        let small = PhotoURL.espn(path: "basketball/nba", id: "1966", size: .small)
        let hero = PhotoURL.espn(path: "basketball/nba", id: "1966", size: .hero)
        let fromRow = Profile.PlayerRef(source: .espn(path: "basketball/nba"), id: "1966", name: "LeBron James", photo: small)
        check(HeroPhoto.url(for: fromRow) == hero && hero != small && hero?.absoluteString.contains("w=260&h=190") == true,
              "a row's link hands over the 96×70 headshot; the hero asks for its own 260×190 from the first frame")
        let athlete = ESPNProfiles.athlete(rosters("espn_ath_nba_1966"), path: "basketball/nba")
        check(athlete?.bio.photo != nil && athlete?.bio.photo == HeroPhoto.url(for: fromRow),
              "the bio's photo, when it lands, is the very same URL: same image, same framing, nothing to swap")
        check(HeroPhoto.url(for: Profile.PlayerRef(source: .espn(path: "basketball/nba"), id: "1966", name: "LeBron James")) == hero,
              "a link without a photo (a box score) still gets the hero's headshot from the ID")
        let soccer = Profile.PlayerRef(source: .espn(path: "soccer/eng.1"), id: "1", name: "Bukayo Saka")
        check(HeroPhoto.url(for: soccer) == nil, "soccer without a photo: no headshot to ask for (most have none); wait for the bio")
        let fotmob = URL(string: "https://images.fotmob.com/image_resources/playerimages/961995.png")!
        var fotmobRef = soccer
        fotmobRef.photo = fotmob
        check(HeroPhoto.url(for: fotmobRef) == fotmob, "a FotMob face crop is used as it is (one size, the one the page settles on)")
        let vitality = BO3Profiles.team(rosters("bo3_team_vitality"), ref: Profile.TeamRef(id: "cs-667", name: "Vitality", league: "cs2"))
        let zywooRow = vitality?.players.first { $0.ref.name == "ZywOo" }?.ref
        let zywoo = BO3Profiles.player(rosters("bo3_player_zywoo"))
        check(zywooRow?.photo?.query()?.contains("w=96") == true && zywooRow.flatMap(HeroPhoto.url(for:)) == zywoo?.bio.photo
              && zywoo?.bio.photo?.query()?.contains("w=240") == true,
              "CS2: the roster's 96px thumbnail becomes bo3.gg's 240px, the bio's own URL")
        let original = URL(string: "https://files.bo3.gg/uploads/image/12345/original/zywoo.png")!
        check(HeroPhoto.url(for: Profile.PlayerRef(source: .counterStrike(slug: "zywoo"), id: "1", name: "ZywOo", photo: original))
              == URL(string: "https://image-proxy.bo3.gg/uploads/image/12345/original/zywoo.png?w=240&h=240"),
              "CS2 from a match page (the original): the same 240px proxy")
        let ifscPhoto = URL(string: "https://ifsc.results.info/athletes/1147/photo.jpg")!
        check(HeroPhoto.url(for: Profile.PlayerRef(source: .ifsc, id: "1147", name: "Janja Garnbret", photo: ifscPhoto)) == ifscPhoto
              && HeroPhoto.url(for: Profile.PlayerRef(source: .ifsc, id: "1147", name: "Janja Garnbret")) == nil,
              "IFSC: as given; links carry none, so the monogram waits for the bio")

        // The no-swap rule, step by step.
        var cache: Set<URL> = []
        let cached = { (url: URL) in cache.contains(url) }
        let other = URL(string: "https://example.com/other-crop.png")!
        var shown = HeroPhoto.initial(ref: fromRow, bio: nil, isCached: cached)
        check(shown == hero, "first visit: the hero's size, never the row's blurry one")
        cache.insert(hero!)
        shown = HeroPhoto.next(current: shown, proposed: other, isCached: cached)
        check(shown == hero, "once a photo is on screen, a different URL from the bio doesn't replace it: the face never moves")
        shown = HeroPhoto.next(current: shown, proposed: nil, isCached: cached)
        check(shown == hero, "nor does a bio without a photo take it away")
        cache = []
        check(HeroPhoto.next(current: hero, proposed: other, isCached: cached) == other,
              "while only the monogram shows, the bio's photo is asked for instead")
        check(HeroPhoto.next(current: hero, proposed: nil, isCached: cached) == hero, "and with none from the bio, the link's keeps loading")
        cache = [other]
        check(HeroPhoto.initial(ref: fromRow, bio: other, isCached: cached) == other,
              "a later visit: a sharp image already decoded (the bio's) draws on the first frame")
        cache = []
        check(HeroPhoto.initial(ref: soccer, bio: other, isCached: cached) == other && HeroPhoto.initial(ref: soccer, bio: nil, isCached: cached) == nil,
              "no link photo: the bio's, else the monogram")
        check(HeroPhoto.pixels(fromRow) == 221 && HeroPhoto.pixels(Profile.PlayerRef(source: .ifsc, id: "1147", name: "Janja Garnbret")) == 152
              && PlayerPhoto.pixels(size: HeroPhoto.size, crop: .cutout) == HeroPhoto.pixels(fromRow),
              "the hero decodes at 221px (cutouts) and 152px (portraits); the bar and a hover's prefetch ask for the same, so all share one image")
    }
}
