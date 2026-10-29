import Foundation

// Live odds, checked on real captures (Tests/Fixtures/odds, trimmed): GSW
// 119–114 at MIN on 28 Oct (ESPN 401909888, Polymarket nba-gsw-min-2026-10-28,
// the day's listing and GSW's price history) and Man Utd 0–3 Bournemouth on
// 25 Oct (ESPN 401879252, epl-mun-bou-2026-10-25, three Yes tokens), plus real
// frames from the CLOB market channel. Finding the market, DraftKings without
// the vig, ESPN's model on the wall clock, the displayed price, the series
// cap, and the chart's geometry.

extension ScorelineTests {
    static func odds() {
        print("\nOdds")
        func json(_ name: String) -> JSON {
            JSON(data: (try? Data(contentsOf: URL(fileURLWithPath: "Tests/Fixtures/odds/\(name)"))) ?? Data())
        }
        func near(_ a: Double?, _ b: Double, _ tolerance: Double = 0.001) -> Bool { a.map { abs($0 - b) <= tolerance } ?? false }
        func date(_ s: String) -> Date { DateParser.parse(s) ?? .distantPast }

        // MARK: ESPN's side (GSW, id 9, visiting: the top team)

        let nba = OddsBaseline.parse(json("espn-nba-401909888.json"), sport: .basketball, topID: "9", bottomID: "16")
        check(nba.topNames == ["Warriors", "Golden State Warriors", "Golden State"] && nba.bottomNames.contains("Timberwolves"),
              "ESPN's names for each side", "\(nba.topNames) \(nba.bottomNames)")
        check(near(DraftKings.implied(-155), 0.6078) && near(DraftKings.implied(130), 0.4348) && DraftKings.implied(0) == nil,
              "implied chance: −ml/(−ml+100) for favorites, 100/(ml+100) for underdogs")
        check(near(nba.draftKings?.top, 0.4170) && near(nba.draftKings?.bottom, 0.5830) && nba.draftKings?.draw == nil,
              "DraftKings GSW +130 / MIN −155 → 42% / 58% with the vig removed", "\(String(describing: nba.draftKings))")
        check(nba.espn.count == 552, "every play's ESPN chance placed", "\(nba.espn.count)")
        check(zip(nba.espn, nba.espn.dropFirst()).allSatisfy { $0.t <= $1.t },
              "on the wall clock, time never runs backwards (14 of ESPN's wallclocks do)")
        check(nba.espn.first?.t == date("2026-10-29T00:10:41Z") && near(nba.espn.first?.p, 0.236),
              "tip-off at 00:10:41Z: ESPN gave GSW 24% (MIN home 76.4%)", "\(String(describing: nba.espn.first))")
        // ESPN lists winprobability by sequence: its last entry (815, MIN 11.2%) isn't the last play.
        let naive = json("espn-nba-401909888.json")["winprobability"].array.last?["homeWinPercentage"].double
        check(near(nba.espn.last?.p, 1) && near(naive, 0.112), "joined by play: the final play says GSW 100%, not sequence 815's 89%")
        check(nba.periods.map(\.label) == ["Q1", "Q2", "Q3", "Q4"] && nba.periods.first?.start == date("2026-10-29T00:10:41Z")
              && nba.periods.last?.end == date("2026-10-29T02:43:59Z") && nba.periods[2].start == date("2026-10-29T01:28:59Z"),
              "periods on the wall clock, halftime's 15 minutes between Q2 and Q3", "\(nba.periods.map(\.label))")
        let somePlay = nba.plays[200]
        check(nba.play(near: somePlay.t + 4).map { abs($0.t.timeIntervalSince(somePlay.t)) <= 4 } ?? false
              && somePlay.clock.hasPrefix("Q") && !somePlay.text.contains("assists)"),
              "the nearest play to a moment, with its clock (\"\(somePlay.clock)\")")

        check(!nba.plays.contains { $0.text.contains("enters the game") || $0.text.lowercased().contains("timeout") }
              && nba.plays.contains { $0.text.contains("makes") },
              "the scrub names plays worth naming: shots, fouls, turnovers, not substitutions or timeouts")

        // MARK: Finding the market

        let listing = Polymarket.events(json("pm-nba-events-2026-10-28.json"))
        check(listing.count == 24 && listing.filter { OddsMatch.isMain($0.slug) }.count == 12,
              "the day's listing: 12 games and 12 sub-events", "\(listing.count)")
        check(OddsMatch.isMain("nba-gsw-min-2026-10-28") && !OddsMatch.isMain("nba-gsw-min-2026-10-28-exact-margin")
              && !OddsMatch.isMain("epl-mun-bou-2026-10-25-halftime-result"), "sub-event slugs are skipped")
        let tip = date("2026-10-29T00:00Z")
        let found = OddsMatch.event(in: listing, start: tip, top: nba.topNames, bottom: nba.bottomNames)
        check(found?.0.slug == "nba-gsw-min-2026-10-28" && found?.topIsFirst == true,
              "GSW at MIN found by name (ESPN says GS, Polymarket gsw), not its exact-margin twin", "\(String(describing: found?.0.slug))")
        let lakers = ["Lakers", "Los Angeles Lakers", "Los Angeles"]
        check(OddsMatch.event(in: listing, start: tip, top: lakers, bottom: nba.bottomNames) == nil,
              "a near miss (Lakers at Minnesota, at GSW–MIN's time): one right team isn't a match")
        check(OddsMatch.event(in: listing, start: tip + 7 * 3600, top: nba.topNames, bottom: nba.bottomNames) == nil,
              "the right teams seven hours away aren't a match")
        let clippers = OddsMatch.event(in: listing, start: date("2026-10-29T02:30Z"), top: lakers,
                                       bottom: ["Clippers", "LA Clippers", "LA"])
        check(clippers?.0.slug == "nba-lal-lac-2026-10-28", "Lakers–Clippers, though both are Los Angeles")
        if let gsw = listing.first(where: { $0.slug == "nba-gsw-min-2026-10-28" }) {
            let twin = PolyEvent(id: "x", slug: "nba-gsw-min-2026-10-28", start: gsw.start + 1800, teams: gsw.teams)
            check(OddsMatch.event(in: [gsw, twin], start: tip, top: nba.topNames, bottom: nba.bottomNames) == nil,
                  "two candidates half an hour apart (a doubleheader): no guess")
        }
        check(OddsMatch.score("Manchester City FC", ["Man Utd", "Manchester United"]) == 0
              && OddsMatch.score("Real Madrid CF", ["Atlético", "Atlético Madrid"]) == 0, "City isn't United; Real isn't Atlético")
        check(OddsMatch.score("Club Atlético de Madrid", ["Atlético", "Atlético Madrid"]) >= 2
              && OddsMatch.score("FC Bayern München", ["Bayern", "Bayern Munich"]) >= 1
              && OddsMatch.score("Como 1907", ["Como"]) == 3 && OddsMatch.score("Hamburger SV", ["Hamburg", "Hamburg SV"]) >= 1
              && OddsMatch.score("Los Angeles Galaxy", ["LA Galaxy"]) == 3,
              "official names meet ESPN's (Atlético, Bayern München, Como 1907, Hamburger SV, LA Galaxy)")
        check(OddsMatch.tokens("FK Bodø/Glimt") == ["bodo", "glimt"] && OddsMatch.tokens("Brighton & Hove Albion FC") == ["brighton", "and", "hove", "albion"],
              "names to words: accents and ø folded, club affixes dropped", "\(OddsMatch.tokens("FK Bodø/Glimt"))")
        check(Polymarket.listingURL(series: 10345, day: "2026-10-28")?.absoluteString.contains("include_markets=false") == true
              && OddsLeague.day(date("2026-10-29T00:00Z")) == "2026-10-28" && OddsLeague.series(for: .espn(path: "basketball/nba", id: "1", sport: .basketball)) == 10345,
              "a game files under its New York date; the listing leaves the markets out")

        if let event = found?.0 {
            let urls = Polymarket.marketsURL(event, closed: true)?.absoluteString ?? ""
            check(urls.contains("slug=nba-gsw-min-2026-10-28&") && urls.contains("slug=nba-gsw-min-2026-10-28-gsw") && urls.hasSuffix("closed=true"),
                  "the moneyline by slug, in one request")
            let market = Polymarket.market(json("pm-nba-gsw-min-market.json").array, event: event, start: event.start,
                                           top: nba.topNames, bottom: nba.bottomNames)
            check(market?.tokens.map(\.outcome) == [.top] && market?.tokens.first?.id.hasPrefix("4142481181") == true
                  && market?.closed == true && market?.threeWay == false,
                  "GSW's token, placed by its outcome name (\"Warriors\")")
            check(near(market?.snapshot?.top, 0.9995) && market?.link?.absoluteString == "https://polymarket.com/event/nba-gsw-min-2026-10-28",
                  "the listed price (bid 0.999, ask 1: the midpoint) and the link")
            check(market?.slugs == ["nba-gsw-min-2026-10-28"] && near(market?.volume, 3_121_974.877, 1)
                  && OddsSeries.dollars(market?.volume ?? 0) == "$3.1M",
                  "the moneyline's own volume: \"$3.1M traded\"")

            // A live game's market re-read for its volume stays the same market: the chart keeps its line.
            if let market {
                let feed = OddsFeed()
                feed.adopt(market)
                let revision = feed.revision
                var reread = market
                reread.volume = 4_000_000
                feed.adopt(reread)
                check(feed.revision == revision && feed.market?.volume == 4_000_000, "a re-read market updates in place")
                let other = OddsMarket(eventID: "2", slug: "nba-lal-lac-2026-10-28", tokens: [.init(id: "x", outcome: .top)], start: market.start)
                feed.adopt(other)
                check(feed.revision == revision + 1 && feed.series.isEmpty, "another market starts over")
                feed.adopt(nil)
                check(feed.market == nil && !feed.isTracking, "no market: nothing tracked")
            }
        }

        // MARK: History and the series

        let history = Polymarket.history(json("pm-nba-gsw-min-history.json"))
        check(history.count == 377 && near(history.first?.p, 0.395) && near(history.last?.p, 0.9995),
              "GSW's history: 377 points, 39.5% to 99.95%")
        check(near(OddsSeries.value(history, at: date("2026-10-29T00:10:41Z")), 0.425),
              "Polymarket had GSW at 42.5% at tip-off")

        let base = date("2026-10-29T00:00Z")
        let ticks = (0..<2000).map { OddsPoint(t: base + Double($0) * 7.2, p: 0.5 + 0.4 * sin(Double($0) / 50)) }
        let now = ticks.last!.t
        let compacted = OddsSeries.compact(ticks, now: now)
        let recent = ticks.filter { $0.t >= now - OddsSeries.raw }
        check(compacted.count <= OddsSeries.cap && zip(compacted, compacted.dropFirst()).allSatisfy { $0.t < $1.t }
              && compacted.last == ticks.last && recent.allSatisfy { r in compacted.contains(r) },
              "2,000 ticks → at most 600 points: the last 10 minutes as they came, older ones a minute each", "\(compacted.count)")
        let day = (0..<3000).map { OddsPoint(t: base + Double($0) * 60, p: 0.5) }
        check(OddsSeries.compact(day, now: day.last!.t).count == OddsSeries.cap, "a long market thinned evenly to the cap")
        check(OddsSeries.percent(0.998) == 99 && OddsSeries.percent(0.998, final: true) == 100 && OddsSeries.percent(0.003) == 1,
              "never 0% or 100% until it's over")
        check(OddsSeries.dollars(4_125_763) == "$4.1M" && OddsSeries.dollars(850_000) == "$850K", "money traded, compact")

        // MARK: The displayed price

        check(near(OddsQuote(bid: 0.28, ask: 0.29, last: 0.30).displayed, 0.285), "a 1¢ spread: the midpoint")
        check(near(OddsQuote(bid: 0.20, ask: 0.40, last: 0.33).displayed, 0.33), "wider than 10¢: the last trade")
        check(near(OddsQuote(bid: 0.30, ask: 0.40, last: 0.33).displayed, 0.35), "exactly 10¢ is still the midpoint (in tenths of a cent)")
        check(near(OddsQuote(bid: nil, ask: 0.50, last: 0.48).displayed, 0.48) && OddsQuote(bid: 0.3, ask: nil, last: nil).displayed == nil,
              "one side of the book missing: the last trade, or nothing")

        let frames = json("pm-ws-frames.json")
        let book = OddsFrame.parse(frames["bookArray"].string ?? "")
        let memphis = "106276744878539450078764807876981394100253045031785691396751308869542735250182"
        check(book.count == 3 && book.first.map { $0.asset == memphis && $0.update == .book(bid: 0.28, ask: 0.29, last: 0.28) } == true,
              "the first frame: an array of books, best bid the highest and best ask the lowest (they come in opposite orders)")
        let change = OddsFrame.parse(frames["price_change"].string ?? "")
        check(change.count == 2 && change[0].update == .best(bid: 0.28, ask: 0.29), "price_change: each asset's best bid and ask")
        let trade = OddsFrame.parse(frames["last_trade_price"].string ?? "")
        check(trade.first?.update == .trade(0.29) && OddsFrame.parse("PONG").isEmpty, "last_trade_price; the PONG is nothing")
        var quote = OddsQuote()
        for (_, u) in book.prefix(1) + trade { OddsFrame.apply(u, to: &quote) }
        check(near(quote.displayed, 0.285) && quote.last == 0.29, "a book then a trade: still the midpoint")

        // MARK: Soccer: Man Utd (home, top) 0–3 Bournemouth

        let epl = OddsBaseline.parse(json("espn-epl-401879252.json"), sport: .soccer, topID: "360", bottomID: "349")
        check(near(epl.draftKings?.top, 0.3876) && near(epl.draftKings?.draw, 0.2791) && near(epl.draftKings?.bottom, 0.3333),
              "DraftKings MAN +145, draw +240, BOU +185 → 39% / 28% / 33%", "\(String(describing: epl.draftKings))")
        check(epl.espn.isEmpty && epl.periods.map(\.label) == ["1st", "2nd"] && epl.plays.contains { $0.clock == "38'" },
              "no ESPN model for soccer; halves on the wall clock; minutes as clocks", "\(epl.periods.map(\.label))")
        let eplListing = Polymarket.events(json("pm-epl-events-2026-10-25.json"))
        let mun = OddsMatch.event(in: eplListing, start: date("2026-10-25T14:00Z"), top: epl.topNames, bottom: epl.bottomNames)
        check(mun?.0.slug == "epl-mun-bou-2026-10-25" && mun?.topIsFirst == true,
              "Man Utd v Bournemouth: \"Manchester United FC\" and \"AFC Bournemouth\", three games at the same kickoff, five sub-events each")
        if let event = mun?.0 {
            let market = Polymarket.market(json("pm-epl-mun-bou-markets.json").array, event: event, start: event.start,
                                           top: epl.topNames, bottom: epl.bottomNames)
            check(market?.slugs.count == 3 && Polymarket.marketsURL(slugs: market?.slugs ?? [], closed: false)?.absoluteString
                      .hasSuffix("slug=epl-mun-bou-2026-10-25-bou&closed=false") == true, "soccer's three markets re-read by their slugs")
            check(market?.threeWay == true && market?.tokens.map(\.outcome) == [.top, .draw, .bottom]
                  && market?.tokens.first?.id.hasPrefix("512055838002") == true && market?.tokens.last?.id.hasPrefix("714638348210") == true,
                  "three Yes tokens, each placed by its title")
            let h = json("pm-epl-mun-bou-history.json")
            // The fixture keeps each token's points bare, as `history` holds them.
            let series = (market?.tokens ?? []).map { Polymarket.history(JSON(["history": h[$0.id].raw ?? []])) }
            if series.count == 3 {
                let stacked = OddsSeries.stacked(top: series[0], draw: series[1], bottom: series[2])
                let kickoff = stacked.last { $0.t <= date("2026-10-25T14:00:42Z") }?.split
                check(stacked.allSatisfy { abs($0.split.top + ($0.split.draw ?? 0) + $0.split.bottom - 1) < 1e-9 }
                      && near(kickoff?.top, 0.385 / 0.995, 0.002) && near(stacked.last?.split.bottom, 0.999, 0.002),
                      "the stack sums to 100% everywhere: MUN 39% at kickoff, BOU ~100% at the end")
            }
        }

        check(OddsBaseline.soccerLine("Goal! Manchester United 0, Bournemouth 2. Marcus Tavernier (Bournemouth) left footed shot from the centre of the box to the bottom left corner.")
              == "Goal! Marcus Tavernier (Bournemouth), 0–2"
              && OddsBaseline.soccerLine("Attempt missed. Rayan (Bournemouth) right footed shot from outside the box misses to the right.")
              == "Attempt missed. Rayan (Bournemouth)",
              "soccer commentary, short: a goal as the scoreboard says it, else who and what")

        // MARK: The chart's geometry

        let domain = date("2026-10-29T00:10:41Z")...date("2026-10-29T02:43:59Z")
        let badge = OddsStyle.badgeWidth(["GSW", "MIN", "Draw"])
        for width in [296.0, 620.0] {
            let layout = OddsLayout(size: CGSize(width: width, height: 139), plotHeight: 124, domain: domain, badgeWidth: badge)
            let halves = layout.halves
            check(layout.midY == layout.y(0.5) && halves.top.maxY == layout.midY && halves.bottom.minY == layout.midY
                  && layout.y(1) == layout.plot.minY && layout.y(0) == layout.plot.maxY,
                  "\(Int(width))pt: the line changes color exactly at 50%")
            let clear = [0, 0.001, 0.5, 0.999, 1].allSatisfy { p in
                let frame = layout.badge(at: CGPoint(x: layout.x(domain.upperBound), y: layout.y(p)))
                return frame.minX >= 0 && frame.maxX <= width && frame.minY >= 0 && frame.maxY <= 124
            }
            check(clear, "\(Int(width))pt: the badge never clips, at 0%, 50% and 100% at the live end")
            let minute = date("2026-10-29T01:41:00Z")
            check(layout.snap(x: layout.x(minute + 29), within: domain) == minute
                  && layout.snap(x: layout.x(minute + 31), within: domain) == minute + 60
                  && layout.snap(x: -50, within: domain) == domain.lowerBound,
                  "\(Int(width))pt: the scrub snaps to the nearest minute, within the data")
            check(OddsPlot.periodLabels(nba.periods, layout: layout).map(\.label) == ["Q1", "Q2", "Q3", "Q4"],
                  "\(Int(width))pt: every quarter named under its own span")
        }
        let pregameSpan = date("2026-10-28T20:00Z")...date("2026-10-29T00:10Z")
        let pregame = OddsLayout(size: CGSize(width: 296, height: 139), plotHeight: 124, domain: pregameSpan, badgeWidth: badge)
        let hours = OddsPlot.hourLabels(pregame)
        check(!hours.isEmpty && zip(hours, hours.dropFirst()).allSatisfy { $1.x - $0.x >= 56 }
              && hours.allSatisfy { $0.x >= pregame.plot.minX + 14 && $0.x <= pregame.plot.maxX - 14 },
              "before the game: whole hours under the axis, 56pt apart at least", "\(hours.map(\.label))")
        check(OddsGlide.progress(0) == 0 && OddsGlide.progress(OddsStyle.glide) == 1 && OddsGlide.progress(1) == 1
              && OddsGlide.progress(0.1) < OddsGlide.progress(0.2) && OddsGlide.progress(0.1) > 0.4,
              "the glide eases out (8% a frame) and lands at exactly 0.5 s")
        let live = OddsChartData.domain(state: .live, window: .recent, start: domain.lowerBound, end: nil,
                                        first: domain.lowerBound, last: domain.upperBound, now: domain.upperBound)
        let final = OddsChartData.domain(state: .final, window: .game, start: domain.lowerBound, end: domain.upperBound,
                                         first: domain.lowerBound - 1800, last: domain.upperBound + 900, now: .now)
        check(live.upperBound == domain.upperBound && live.upperBound.timeIntervalSince(live.lowerBound) == 600 && final == domain,
              "10 min slides with the newest point; a final runs from tip-off to the last play")
        let data = OddsChartData(revision: 1, threeWay: false, line: history, espn: nba.espn, draftKings: nba.draftKings,
                                 periods: nba.periods, domain: domain, live: false, final: true)
        let reading = OddsReading.at(somePlay.t + 10, data: data, baseline: nba)
        check(reading?.split != nil && reading?.espn != nil && reading?.play != nil && (reading?.when().contains(" · ") ?? false),
              "a reading lists Polymarket, ESPN, the clock and wall time, and the nearest play", "\(String(describing: reading?.when()))")
    }
}
