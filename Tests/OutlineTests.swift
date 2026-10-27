import Foundation

// Long lists as an outline: how the team picker groups and orders a list,
// which groups start open (and are remembered), what the arrow keys stop on
// when groups are collapsed, and where "Show All" takes over. Checked
// without views.

extension ScorelineTests {
    static func outline() {
        print("\nLong lists (outline)")
        outlineGrouping()
        outlineExpansion()
        outlineKeyboard()
        outlineShowAll()
        outlineStandings()
    }

    private static func team(_ id: String, _ name: String, _ group: String? = nil) -> TeamOption {
        TeamOption(id: id, name: name, logo: nil, group: group)
    }

    /// 30 teams in three conferences, in the standings' order (Sun Belt first).
    private static var college: [TeamOption] {
        let sunBelt = (1...8).map { team("sb\($0)", "Sun Belt Team \($0)", "Sun Belt") }
        let sec = ["Texas", "Alabama", "Georgia", "LSU", "Auburn", "Florida", "Ole Miss", "Missouri", "Tennessee", "Kentucky", "Oklahoma"]
            .map { team("sec-\($0)", $0, "SEC") }
        let acc = ["Miami", "Clemson", "Duke", "Pittsburgh", "Louisville", "SMU", "Stanford", "Virginia", "NC State", "Syracuse", "California"]
            .map { team("acc-\($0)", $0, "ACC") }
        return CollegeConferences.byConference(sunBelt + sec + acc)
    }

    // MARK: Grouping and order

    private static func outlineGrouping() {
        check(CollegeConferences.order(["American", "ACC", "Big 12", "Big Ten", "CUSA", "FBS Indep.", "SEC", "Sun Belt", "ACC"])
              == ["SEC", "Big Ten", "ACC", "Big 12", "American", "CUSA", "FBS Indep.", "Sun Belt"],
              "conferences: the Power Four first, in their usual order, then the rest as the standings give them")
        let ordered = CollegeConferences.byConference([team("z", "Zeta", "MAC"), team("u", "Unaffiliated"), team("b", "Beta", "SEC"),
                                                      team("a", "Alpha", "MAC"), team("c", "Ceta", "SEC")])
        check(ordered.map(\.id) == ["b", "c", "a", "z", "u"], "teams by conference, alphabetical within; no conference last",
              "\(ordered.map(\.id))")

        let sections = PickOutline.sections(college, query: "", picks: ["sec-Texas"])
        check(sections.map(\.id) == ["selected", "conf:SEC", "conf:ACC", "conf:Sun Belt"],
              "picker: Selected on top, then one group per conference, Power first", "\(sections.map(\.id))")
        check(sections.first?.kind == .plain && sections.dropFirst().allSatisfy { $0.kind == .disclosure },
              "picker: Selected stays open; conferences are collapsible")
        let sec = sections.first { $0.id == "conf:SEC" }
        check(sec?.options.count == 11 && sec?.options.contains { $0.id == "sec-Texas" } == true,
              "a conference stays whole: a picked team is in Selected and in its conference (SEC · 11)")
        check(sec?.options.map(\.name) == sec?.options.map(\.name).sorted(), "teams alphabetical within a conference")

        let search = PickOutline.sections(college, query: "mi", picks: ["sec-Texas"])
        check(search.map(\.id) == ["matches"] && search.first?.kind == .plain, "searching: one flat list of matches, no groups")
        check(search.first?.options.map(\.name) == ["Miami", "Missouri", "Ole Miss"],
              "searching: matches across every conference, alphabetical", "\(search.first?.options.map(\.name) ?? [])")
        check(PickOutline.sections(college, query: "zzz", picks: []).isEmpty, "searching: nothing matches, no sections")

        let nfl = (1...24).map { team("t\($0)", String(format: "Team %02d", $0)) }
        let short = PickOutline.sections(nfl, query: "", picks: ["t3"])
        check(short.map(\.id) == ["selected", "all"] && short.allSatisfy { $0.kind == .plain } && short[1].title == "All Teams"
              && short[1].options.count == 23, "24 or fewer: Selected and the rest in full, as before")
        let none = PickOutline.sections(nfl, query: "", picks: [])
        check(none.count == 1 && none[0].title == "Teams" && none[0].options.count == 24, "24 or fewer, nothing picked: one list")
        let smallGroups = PickOutline.sections(Array(college.prefix(20)), query: "", picks: [])
        check(smallGroups.count == 1 && smallGroups[0].kind == .plain, "a short list stays one list even with groups")
    }

    // MARK: Which groups start open

    private static func outlineExpansion() {
        check(Outline.startsExpanded(remembered: nil, members: ["a", "b"], mine: ["b"]), "a group holding one of your teams starts open")
        check(!Outline.startsExpanded(remembered: nil, members: ["a", "b"], mine: ["c"]), "other groups start collapsed")
        check(!Outline.startsExpanded(remembered: false, members: ["a", "b"], mine: ["b"])
              && Outline.startsExpanded(remembered: true, members: ["a"], mine: []),
              "this session's choice wins over the default, either way")

        let scope = "tests.outline"
        DisclosureMemory.forget(scope)
        let groups = DisclosureGroups()
        let sections = PickOutline.sections(college, query: "", picks: ["sec-Texas"])
        let prepare: (DisclosureGroups) -> Void = { g in
            g.prepare(scope: scope, sections.filter { $0.kind == .disclosure }.map { (id: $0.id, members: $0.options.map(\.id)) },
                      mine: ["sec-Texas", "acc-Duke"])
        }
        prepare(groups)
        check(groups.expanded == ["conf:SEC", "conf:ACC"], "picked (Texas) and followed (Duke) teams open their conferences",
              "\(groups.expanded.sorted())")
        groups.set("conf:SEC", open: false, style: .keyboard, reduceMotion: false)
        groups.toggle("conf:Sun Belt", style: .keyboard, reduceMotion: false)
        check(groups.expanded == ["conf:ACC", "conf:Sun Belt"], "keyboard toggles apply at once")
        let again = DisclosureGroups()
        prepare(again)
        check(again.expanded == ["conf:ACC", "conf:Sun Belt"], "reopening the page finds groups as they were left this session",
              "\(again.expanded.sorted())")
        let flag = again.flag("conf:ACC")
        prepare(again)
        check(again.flag("conf:ACC") === flag, "preparing again keeps each group's flag (its views stay put)")
        DisclosureMemory.forget(scope)
    }

    // MARK: Keyboard

    private static func outlineKeyboard() {
        let sections = [Outline.Section(id: "selected", kind: .plain, items: ["a"]),
                        Outline.Section(id: "conf:SEC", kind: .disclosure, items: ["x", "y"]),
                        Outline.Section(id: "conf:Big Ten", kind: .disclosure, items: ["m", "n"])]
        let stops = Outline.stops(sections, expanded: ["conf:Big Ten"])
        check(stops == [.row("selected", "a"), .header("conf:SEC"), .header("conf:Big Ten"), .row("conf:Big Ten", "m"), .row("conf:Big Ten", "n")],
              "↑/↓ stop on visible rows and every header; a collapsed group's rows are skipped", "\(stops)")
        check(Outline.step(from: nil, by: 1, in: stops) == .row("selected", "a") && Outline.step(from: nil, by: -1, in: stops) == .row("conf:Big Ten", "n"),
              "nothing highlighted: ↓ starts at the top, ↑ at the bottom")
        check(Outline.step(from: .header("conf:SEC"), by: 1, in: stops) == .header("conf:Big Ten"),
              "↓ from a collapsed header goes straight to the next header")
        check(Outline.step(from: .row("conf:Big Ten", "n"), by: 1, in: stops) == .row("conf:Big Ten", "n")
              && Outline.step(from: .row("selected", "a"), by: -1, in: stops) == .row("selected", "a"), "the ends hold")
        check(Outline.step(from: .row("conf:SEC", "y"), by: 1, in: stops) == .header("conf:Big Ten"),
              "a highlight left in a group that collapsed moves on from its header")

        check(Outline.right(from: .header("conf:SEC"), sections: sections, expanded: ["conf:Big Ten"]) == .expand("conf:SEC"),
              "→ on a collapsed header expands it")
        check(Outline.right(from: .header("conf:Big Ten"), sections: sections, expanded: ["conf:Big Ten"]) == .highlight(.row("conf:Big Ten", "m")),
              "→ on an open header steps to its first row")
        check(Outline.right(from: .row("conf:Big Ten", "m"), sections: sections, expanded: ["conf:Big Ten"]) == nil,
              "→ on a row does nothing (the key passes on)")
        check(Outline.left(from: .header("conf:Big Ten"), sections: sections, expanded: ["conf:Big Ten"]) == .collapse("conf:Big Ten"),
              "← on an open header collapses it")
        check(Outline.left(from: .header("conf:SEC"), sections: sections, expanded: []) == nil, "← on a collapsed header does nothing")
        check(Outline.left(from: .row("conf:Big Ten", "n"), sections: sections, expanded: ["conf:Big Ten"]) == .highlight(.header("conf:Big Ten")),
              "← on a row in a group goes up to its header")
        check(Outline.left(from: .row("selected", "a"), sections: sections, expanded: []) == nil, "← in Selected does nothing")

        let stopsAll: [Outline.Stop] = [.header("conf:Sun Belt"), .row("conf:Sun Belt", "espn-ncaaf-256"), .more("all")]
        check(stopsAll.allSatisfy { Outline.Stop(key: $0.key) == $0 } && Outline.Stop(key: "x|y") == nil && Outline.Stop(key: nil) == nil,
              "a stop survives its highlight key")
    }

    // MARK: Show All

    private static func outlineShowAll() {
        check(Outline.visibleCount(24, showingAll: false) == 24 && Outline.visibleCount(25, showingAll: false) == 12
              && Outline.visibleCount(60, showingAll: false) == 12 && Outline.visibleCount(60, showingAll: true) == 60,
              "a flat list over 24 shows its first 12; 24 or fewer show in full")
        let ranked = (1...60).map { team("cs-\($0)", "Team \($0)") }
        let cs = PickOutline.sections(ranked, query: "", picks: ["cs-8"])
        check(cs.map(\.id) == ["selected", "all"] && cs[1].kind == .capped && cs[1].options.count == 59
              && cs[1].options.prefix(3).map(\.id) == ["cs-1", "cs-2", "cs-3"], "CS2: Selected, then the ranking in rank order, capped")
        let stops = Outline.stops(cs.map(\.outline), expanded: [])
        check(stops.count == 1 + 12 + 1 && stops.last == .more("all") && stops[12] == .row("all", "cs-13"),
              "↑/↓ reach the first 12 and then Show All", "\(stops.count)")
        let all = Outline.stops(cs.map(\.outline), expanded: [], showingAll: ["all"])
        check(all.count == 1 + 59 && !all.contains(.more("all")), "after Show All, every row and no Show All")
        let twentyFive = PickOutline.sections(Array(ranked.prefix(25)), query: "", picks: [])
        check(twentyFive.first?.kind == .capped, "25 is long enough to cap")
        let nations = TeamCatalog.climbingNations.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            .map { team("country-\($0.code)", $0.name) }
        let climbing = PickOutline.sections(nations, query: "", picks: [], noun: "Countries", symbol: "flag")
        check(climbing.first?.kind == (nations.count > 24 ? .capped : .plain) && climbing.first?.title == "Countries"
              && climbing.first?.options.first?.name == "Australia", "climbing: countries alphabetical, capped when over 24")
    }

    // MARK: Standings

    private static func outlineStandings() {
        func entry(_ id: String, _ name: String, total: String, conf: String) -> [String: Any] {
            ["team": ["id": id, "location": name],
             "stats": [["type": "total", "displayValue": total], ["type": "vsconf", "displayValue": conf]]]
        }
        let json = JSON(["children": [
            ["shortName": "SEC", "standings": ["entries": [entry("1", "Texas", total: "7-0", conf: "4-0"), entry("2", "LSU", total: "5-2", conf: "2-2")]]],
            ["shortName": "Sun Belt", "children": [
                ["name": "Sun Belt - East", "standings": ["entries": [entry("3", "James Madison", total: "7-1", conf: "4-1")]]],
                ["name": "Sun Belt - West", "standings": ["entries": [entry("4", "Louisiana Tech", total: "5-2", conf: "3-0")]]],
            ]],
            ["shortName": "FBS Indep.", "standings": ["entries": [entry("5", "Notre Dame", total: "6-1", conf: "0-0")]]],
        ]] as [String: Any])
        let rows = Standings.college(json, path: "football/college-football")
        check(rows.map(\.group) == ["SEC", "SEC", "Sun Belt · East", "Sun Belt · West", "FBS Indep."]
              && rows.map(\.parentGroup) == [nil, nil, "Sun Belt", "Sun Belt", nil],
              "divisions keep their own tables and carry their conference", "\(rows.map(\.parentGroup))")
        let options = CollegeConferences.byConference(rows.map { TeamOption(id: $0.id, name: $0.name, logo: $0.logo, group: $0.parentGroup ?? $0.group) })
        check(Set(options.compactMap(\.group)) == ["SEC", "Sun Belt", "FBS Indep."], "the picker lists a division's teams under its conference")

        check(ConferenceLeaderLine.kind(rows[0]) == .leader && ConferenceLeaderLine.kind(rows[4]) == .bestRecord,
              "a collapsed conference names its leader; independents their best record")
        let unplayed = StandingsRow(id: "x", group: "SEC", name: "X", abbreviation: "X", logo: nil, rank: 1, played: 0, wins: 0, draws: 0,
                                    losses: 0, goalDifference: 0, goalsFor: 0, points: 0, overall: "0-0", conference: "0-0")
        check(ConferenceLeaderLine.kind(unplayed) == .none, "before any games, no leader")
        check(ConferenceLeaderLine.spoken(rows[0], rank: 3) == "leader Texas, ranked 3, 7 wins, 0 losses, 4 wins, 0 losses in conference",
              "the leader line reads in words", ConferenceLeaderLine.spoken(rows[0], rank: 3))
    }
}
