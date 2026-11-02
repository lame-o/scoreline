import AppKit
import SwiftUI

// The pages clicked for real: offscreen windows, synthesized events, nothing on
// the user's screen and the real mouse untouched. This app has shipped dead
// buttons before; a click here goes the whole way through AppKit and SwiftUI.

/// Competition data for the offline suite, from the recorded season files.
enum CompetitionRoutes {
    /// Only while the pages are clicked: the rest of the suite replays its own recordings.
    nonisolated(unsafe) static var enabled = false
    private static let seasons: [String: [Int: String]] = [
        "eng.league_cup": [2026: "carabao-2026", 2025: "carabao-2025"],
        "eng.fa": [2026: "fa-cup-2026", 2025: "fa-cup-2025"],
        "uefa.champions": [2026: "champions-2026", 2025: "champions-2025"],
        "usa.1": [2025: "mls-2025"],
        "eng.1": [2026: "premier-league-2026"],
    ]
    private static let teams = """
    {"sports":[{"leagues":[{"teams":[{"team":{"id":"364","displayName":"Liverpool","logos":[]}},
    {"team":{"id":"363","displayName":"Chelsea","logos":[]}},{"team":{"id":"359","displayName":"Arsenal","logos":[]}}]}]}]}
    """

    private static func file(_ name: String) -> JSON {
        JSON(data: (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("competitions/\(name).json"))) ?? Data())
    }

    private static func data(_ value: Any?) -> Data? {
        value.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
    }

    static func response(for url: URL) -> Data? {
        let path = url.path()
        guard enabled, let slug = seasons.keys.first(where: { path.contains("/soccer/\($0)/") || path.contains("/leagues/\($0)/") }) else {
            return nil
        }
        let years = seasons[slug] ?? [:]
        let current = years.keys.max() ?? 2026
        if path.hasSuffix("/teams") { return Data(teams.utf8) }
        if path.hasSuffix("/scoreboard") {
            let query = url.query() ?? ""
            guard let dates = query.firstMatch(of: #/dates=(\d{4})/#).flatMap({ Int($0.1) }) else {
                return data(file(years[current] ?? "")["info"].raw)
            }
            // A board's calendar year holds the end of one season and the start of the next.
            let games = [years[dates], years[dates - 1]].compactMap { $0 }.flatMap { file($0)["board"]["events"].array.compactMap(\.raw) }
            return data(["events": games])
        }
        if let year = path.firstMatch(of: #/\/seasons\/(\d{4})/#).flatMap({ Int($0.1) }) {
            return years[year].flatMap { data(file($0)["season"].raw) }
        }
        if path.hasSuffix("/seasons") { return data(file("carabao-seasons").raw) }
        return nil
    }
}

/// A page in a borderless window, driven by synthesized events and read through
/// the accessibility tree SwiftUI builds for it, as VoiceOver would.
@MainActor
final class OffscreenPage {
    private final class Window: NSWindow {
        override var canBecomeKey: Bool { true }
    }

    let window: NSWindow

    init<Content: View>(width: CGFloat = 600, height: CGFloat = 800, dark: Bool = false, @ViewBuilder content: () -> Content) {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        let frame = NSRect(x: -20_000, y: 0, width: width, height: height)
        window = Window(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.backgroundColor = dark ? NSColor(white: 0.12, alpha: 1) : NSColor(white: 0.96, alpha: 1)
        window.contentView = NSHostingView(rootView: content().frame(width: width, height: height, alignment: .top))
        window.orderFrontRegardless()
        window.makeKey()
    }

    func close() {
        window.orderOut(nil)
        window.contentView = nil
    }

    /// The suite runs without an app run loop: SwiftUI only updates, and a page's tasks only run, while this turns one.
    func settle(_ seconds: Double = 0.25) async {
        RunLoop.main.run(until: Date().addingTimeInterval(seconds))
    }

    // MARK: Reading

    private func elements(in root: Any, into found: inout [NSAccessibilityElementProtocol], depth: Int = 0) {
        guard depth < 40, let protocolElement = root as? NSAccessibilityElementProtocol else { return }
        found.append(protocolElement)
        guard let parent = root as? NSObject, parent.responds(to: #selector(NSAccessibilityProtocol.accessibilityChildren)),
              let children = parent.perform(#selector(NSAccessibilityProtocol.accessibilityChildren))?.takeUnretainedValue() as? [Any] else { return }
        for child in children { elements(in: child, into: &found, depth: depth + 1) }
    }

    private func text(of element: Any) -> String {
        guard let object = element as? NSObject else { return "" }
        var parts: [String] = []
        for selector in [#selector(NSAccessibilityProtocol.accessibilityLabel), #selector(NSAccessibilityProtocol.accessibilityTitle)] where object.responds(to: selector) {
            if let text = object.perform(selector)?.takeUnretainedValue() as? String { parts.append(text) }
        }
        if object.responds(to: #selector(NSAccessibilityProtocol.accessibilityValue)),
           let value = object.perform(#selector(NSAccessibilityProtocol.accessibilityValue))?.takeUnretainedValue() as? String { parts.append(value) }
        return parts.joined(separator: " ")
    }

    private var all: [NSAccessibilityElementProtocol] {
        var found: [NSAccessibilityElementProtocol] = []
        if let view = window.contentView { elements(in: view, into: &found) }
        return found
    }

    /// The element named exactly `label`, else the innermost whose words contain it.
    private func element(_ label: String) -> NSAccessibilityElementProtocol? {
        let elements = all
        return elements.last { text(of: $0) == label } ?? elements.last { text(of: $0).localizedCaseInsensitiveContains(label) }
    }

    func has(_ label: String) -> Bool { element(label) != nil }

    /// Waits for something to appear: a page loads what it shows.
    @discardableResult
    func wait(for label: String, timeout: Double = 4) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if has(label) { return true }
            await settle(0.05)
        }
        return false
    }

    /// Every label in the page, for a failing check to show.
    var labels: String { all.map { text(of: $0) }.filter { !$0.isEmpty }.joined(separator: " | ") }

    // MARK: Acting

    private func center(of element: NSAccessibilityElementProtocol) -> NSPoint? {
        let frame = element.accessibilityFrame()
        guard frame.width > 0, frame.height > 0 else { return nil }
        return window.convertPoint(fromScreen: NSPoint(x: frame.midX, y: frame.midY))
    }

    /// A real click on whatever `label` names: down and up, through the window.
    @discardableResult
    func click(_ label: String) async -> Bool {
        guard let element = element(label), let point = center(of: element) else { return false }
        await click(at: point)
        return true
    }

    func click(at point: NSPoint) async {
        func event(_ type: NSEvent.EventType) -> NSEvent? {
            NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
        }
        guard let down = event(.leftMouseDown), let up = event(.leftMouseUp) else { return }
        // The release goes in the queue first: an AppKit control (a segmented
        // picker) tracks the press in a loop that reads it from there.
        NSApp.postEvent(up, atStart: false)
        window.sendEvent(down)
        await settle(0.03)
        if let release = NSApp.nextEvent(matching: .leftMouseUp, until: .distantPast, inMode: .default, dequeue: true) {
            window.sendEvent(release)
        }
        await settle(0.2)
    }

    /// Points at what `label` names, through the hosting view, as the pointer entering it would.
    func hover(_ label: String) async {
        guard let element = element(label), let point = center(of: element), let view = window.contentView else { return }
        for type in [NSEvent.EventType.mouseEntered, .mouseMoved] {
            let event: NSEvent? = if type == .mouseEntered {
                NSEvent.enterExitEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                       windowNumber: window.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil)
            } else {
                NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0)
            }
            if let event { if type == .mouseEntered { view.mouseEntered(with: event) } else { view.mouseMoved(with: event) } }
        }
        await settle(0.1)
    }

    /// What's on screen now, as an image.
    func image() -> NSBitmapImageRep? {
        guard let view = window.contentView, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return nil }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        return bitmap
    }
}

extension ScorelineTests {
    private static func isolatedStore(_ set: (UserDefaults) -> Void = { _ in }) -> ScoreStore {
        let defaults = UserDefaults(suiteName: "io.github.lame-o.Scoreline.interactions.\(UUID().uuidString)")!
        defaults.set(false, forKey: "showCoStream")
        defaults.set([String](), forKey: "enabledLeagues")
        set(defaults)
        return ScoreStore(defaults: defaults)
    }

    static func competitionInteractions() async {
        print("\nCompetition pages, clicked")
        CompetitionRoutes.enabled = true
        defer { CompetitionRoutes.enabled = false }
        await competitionPageClicks()
        await sportsClicks()
        await leagueClicks()
        await followingClicks()
        await momentClicks()
        await heroClicks()
    }

    private static func competitionPageClicks() async {
        let store = isolatedStore()
        let schedule = ScheduleStore(cache: ScheduleCache(directory: nil))
        var opened: Event?
        var settings: League?
        let ref = CompetitionRef(slug: "eng.league_cup", name: "Carabao Cup", year: 2026, highlight: ["364", "363"])
        let page = OffscreenPage {
            CompetitionPage(ref: ref, backTitle: "Match", onBack: {}, onOpen: { opened = $0 }, onOpenSettings: { settings = $0 })
                .environment(store)
                .environment(\.scheduleStore, schedule)
        }
        defer { page.close() }
        check(await page.wait(for: "Carabao Cup"), "a competition's page loads", page.labels)
        check(page.has("Fourth Round: Liverpool 1, Chelsea 1"), "it opens on the bracket, with the match it came from", page.labels)
        check(page.has("Semifinals: draw pending"), "undrawn places read as such to VoiceOver")

        // A cell opens its game.
        check(await page.click("Fourth Round: Liverpool 1, Chelsea 1"), "a bracket cell can be clicked")
        check(opened?.competitors.contains { $0.name == "Liverpool" } == true, "and opens the game", String(describing: opened?.competitors.map(\.name)))
        if case let .espn(path, _, _)? = opened?.ref { check(path == "soccer/eng.league_cup", "in its competition") } else { check(false, "in its competition") }
        opened = nil
        await page.click("Semifinals: draw pending")
        check(opened == nil, "an undrawn place opens nothing")

        // The switch and the rounds.
        check(await page.click("Fixtures"), "the Fixtures tab can be clicked")
        check(await page.wait(for: "Quarterfinals"), "Fixtures shows the rounds", page.labels)
        check(await page.click("Semifinals"), "a round's chip can be clicked")
        check(await page.wait(for: "Not Drawn Yet"), "an undrawn round says so", page.labels)
        await page.click("Fourth Round")
        check(await page.wait(for: "Liverpool"), "a played round lists its games", page.labels)
        await page.click("Liverpool")
        check(opened?.competitors.contains { $0.name == "Liverpool" } == true, "a fixture row opens its game", String(describing: opened?.id))

        // Follow and scope, from the header.
        check(!store.isEnabled(League.with(id: "eng.league_cup")!), "not followed to start with")
        await page.click("Follow Carabao Cup")
        check(store.isEnabled(League.with(id: "eng.league_cup")!), "the star follows it")
        check(await page.wait(for: "Unfollow Carabao Cup"), "and says so")
        await page.click("Choose Teams")
        check(settings?.id == "eng.league_cup", "the settings button opens its teams")
    }

    private static func sportsClicks() async {
        let store = isolatedStore { $0.set(["eng.1"], forKey: "enabledLeagues") }
        let schedule = ScheduleStore(cache: ScheduleCache(directory: nil))
        var sport: Sport?, following = false, league: League?, team: Profile.TeamRef?
        let root = OffscreenPage {
            SportsPage(onBack: {}, onOpenSport: { sport = $0 }, onFollowing: { following = true }, onOpenLeague: { league = $0 })
                .environment(store)
                .environment(\.scheduleStore, schedule)
        }
        check(await root.wait(for: "Soccer"), "Sports lists the sports", root.labels)
        await root.click("Football")
        check(sport == .football, "a sport's row opens it")
        await root.click("Following")
        check(following, "Following is one click away")
        root.close()

        let soccer = OffscreenPage {
            SportPage(sport: .soccer, onBack: {}, onOpenLeague: { league = $0 }, onOpenTeam: { team = $0 })
                .environment(store)
                .environment(\.scheduleStore, schedule)
        }
        defer { soccer.close() }
        check(await soccer.wait(for: "Carabao Cup"), "a sport lists its cups", soccer.labels)
        check(soccer.has("Leagues") && soccer.has("Cups") && soccer.has("Tournaments") && soccer.has("Teams"), "under Leagues, Cups, Tournaments and Teams", soccer.labels)
        await soccer.click("Follow FA Cup")
        check(store.isEnabled(League.with(id: "eng.fa")!) && league == nil, "the star follows, and doesn't open")
        check(await soccer.wait(for: "Unfollow FA Cup"), "and fills")
        await soccer.click("Copa del Rey")
        check(league?.id == "esp.copa_del_rey", "the row opens, and doesn't follow", String(describing: league?.id))
        check(!store.isEnabled(League.with(id: "esp.copa_del_rey")!), "opening a competition never follows it")
        _ = team
    }

    private static func leagueClicks() async {
        let league = League.with(id: "eng.1")!
        let store = isolatedStore {
            $0.set(["eng.1"], forKey: "enabledLeagues")
            $0.set(["eng.1": ["espn-soccer-363"]], forKey: "teamFilters")
        }
        var openedTeam: Profile.TeamRef?
        let navigator = ProfileNavigator(openTeam: { openedTeam = $0 })
        let page = OffscreenPage {
            LeagueSettingsView(league: league, backTitle: "Scores", onBack: {})
                .environment(store)
                .environment(navigator)
        }
        defer { page.close() }
        check(await page.wait(for: "Liverpool"), "a competition lists its teams in one list", page.labels)
        check(!page.has("Selected Teams, selected") && store.picks(for: league).count == 1, "parked picks stay parked while every match shows")
        await page.click("Liverpool")
        check(openedTeam?.id == "espn-soccer-364" && store.picks(for: league) == ["espn-soccer-363"], "with every match showing, a row opens its team", String(describing: openedTeam?.id))
        await page.click("Follow Arsenal")
        check(store.followed.map(\.id) == ["espn-soccer-359"], "the star follows a team, whichever mode", String(describing: store.followed.map(\.id)))
        check(store.picks(for: league) == ["espn-soccer-363"], "and doesn't pick it")
        check(await page.click("Selected Teams"), "Selected Teams can be chosen")
        check(store.isFilterOn(league), "and turns the filter on")
        await page.settle()
        openedTeam = nil
        await page.click("Liverpool")
        check(store.picks(for: league) == ["espn-soccer-363", "espn-soccer-364"] && openedTeam == nil, "now a row picks", String(describing: store.picks(for: league)))
        await page.click("Follow Chelsea")
        check(store.followed.count == 2 && store.picks(for: league).count == 2, "and the star still only follows")
    }

    private static func followingClicks() async {
        let store = isolatedStore {
            $0.set(["eng.1"], forKey: "enabledLeagues")
            $0.set(try? JSONEncoder().encode([FollowedTeam(id: "espn-baseball-25", name: "San Diego Padres", logo: nil)]), forKey: "followedTeams")
        }
        var sports = false
        let page = OffscreenPage {
            FollowingPage(onBack: {}, onOpenLeague: { _ in }, onSports: { sports = true })
                .environment(store)
        }
        defer { page.close() }
        check(await page.wait(for: "San Diego Padres"), "Following lists teams", page.labels)
        await page.click("Turn off alerts for San Diego Padres")
        check(store.mutedTeams == ["espn-baseball-25"], "the bell mutes one team")
        await page.click("Turn on alerts for San Diego Padres")
        check(store.mutedTeams.isEmpty, "and turns it back on")
        await page.click("Add Competitions")
        check(sports, "Add Competitions goes to Sports")
        await page.click("Unfollow San Diego Padres")
        check(store.followed.isEmpty, "the minus unfollows")
    }

    private static func momentClicks() async {
        // One goal ESPN placed, one it didn't: the first replays, the second has no click to promise.
        let event = Event(id: "espn-1", content: .match(top: comp("espn-soccer-364", "Liverpool"), bottom: comp("espn-soccer-363", "Chelsea")),
                          state: .final, start: .now, detail: "FT", caption: nil, link: nil, ref: .espn(path: "soccer/eng.league_cup", id: "1", sport: .soccer))
        let goals = JSON(data: (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("competitions/cup-goals.json"))) ?? Data())["items"].array
        let replay = Replays.soccer(goals, at: 0, homeTeamID: "364", keepers: [:])
        let replays = PageReplays(event)
        let located = GameDetail.Moment(id: "located", kind: .goal, clock: "40'", text: "Located Goal", side: .top)
        let unlocated = GameDetail.Moment(id: "unlocated", kind: .goal, clock: "55'", text: "Unlocated Goal", side: .bottom)
        replays.preview(plays: replay.map { ["located": $0] } ?? [:], context: ReplayContext(eventID: event.id), open: nil)
        let linked = LinkedFocus()
        let page = OffscreenPage {
            MomentList(moments: [located, unlocated], topName: "LIV", bottomName: "CHE", palette: TeamPalette(top: nil, bottom: nil, scheme: .light))
                .padding(16)
                .environment(replays)
                .environment(linked)
                .environment(isolatedStore())
        }
        defer { page.close() }
        check(await page.wait(for: "Unlocated Goal"), "key events list both goals", page.labels)
        let resting = page.image()?.tiffRepresentation
        await page.hover("Unlocated Goal")
        check(page.image()?.tiffRepresentation == resting, "a goal with no location doesn't answer the pointer")
        await page.hover("Located Goal")
        check(page.image()?.tiffRepresentation != resting, "a goal with one does: the wash, and the play glyph")
        await page.click("Unlocated Goal")
        check(replays.open == nil && linked.pinned == nil, "a goal with no location: a click does nothing, and nothing promised it")
        await page.click("Located Goal")
        check(replays.open?.play == "located", "a goal with one opens its replay under the row")
    }

    private static func heroClicks() async {
        let store = isolatedStore()
        let event = Event(id: "espn-401915382", content: .match(top: comp("espn-soccer-436", "Fenerbahce"), bottom: comp("espn-soccer-364", "Liverpool")),
                          state: .scheduled, start: .now.addingTimeInterval(86_400), detail: nil, caption: nil, link: nil,
                          // How a team's page used to open it: through the team's domestic league.
                          ref: .espn(path: "soccer/eng.1", id: "401915382", sport: .soccer))
        var detail = GameDetail()
        detail.competition = MatchCompetition(JSON(data: (try? Data(contentsOf: FixtureProtocol.directory.appendingPathComponent("competitions/summary-ucl.json"))) ?? Data()))
        var ref: CompetitionRef?
        let page = OffscreenPage(height: 500) {
            DetailView(snapshot: event, onBack: {}, backTitle: "Scores", preloaded: detail, onOpenCompetition: { ref = $0 })
                .environment(store)
        }
        defer { page.close() }
        check(await page.wait(for: "Champions League · League Phase"), "the hero names the match's real competition", page.labels)
        await page.click("Champions League · League Phase")
        check(ref?.slug == "uefa.champions" && ref?.highlight == ["436", "364"], "and its caption opens that competition, with the match's teams", String(describing: ref))
    }

    // MARK: - The contact sheet

    /// Every page in light and dark on live data, then one sheet of them all.
    static func renderCompetitions(to directory: String) async {
        try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let schedule = ScheduleStore(cache: ScheduleCache(directory: nil))
        let store = isolatedStore {
            $0.set(["ifsc", "eng.1", "uefa.champions", "mlb", "cs2", "nfl", "nba", "usa.1"], forKey: "enabledLeagues")
            $0.set(["mlb", "uefa.champions", "ifsc"], forKey: "filteredLeagues")
            $0.set(["eng.1": ["espn-soccer-382", "espn-soccer-363", "espn-soccer-364", "espn-soccer-360", "espn-soccer-359"],
                    "mlb": ["espn-baseball-8", "espn-baseball-25", "espn-baseball-19"],
                    "uefa.champions": ["espn-soccer-132", "espn-soccer-360", "espn-soccer-382", "espn-soccer-364", "espn-soccer-359", "espn-soccer-86", "espn-soccer-83", "espn-soccer-160"]], forKey: "teamFilters")
            $0.set(try? JSONEncoder().encode([FollowedTeam(id: "espn-baseball-25", name: "San Diego Padres", logo: nil)]), forKey: "followedTeams")
        }
        @MainActor func competition(_ slug: String, _ name: String, year: Int? = nil, highlight: Set<String> = []) -> AnyView {
            AnyView(CompetitionPage(ref: CompetitionRef(slug: slug, name: name, year: year, highlight: highlight), backTitle: "Scores", onBack: {}, onOpen: { _ in }))
        }
        let summary = (try? await JSON.fetch(URL.api("https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event=401921842"))) ?? JSON(nil)
        var detail = GameDetail()
        detail.competition = MatchCompetition(summary)
        let hero = Event(id: "espn-401921842", content: .match(top: comp("espn-soccer-364", "Liverpool", "1"), bottom: comp("espn-soccer-363", "Chelsea", "1")),
                         state: .final, start: .now, detail: "Pens", caption: nil, link: nil, ref: .espn(path: "soccer/eng.league_cup", id: "401921842", sport: .soccer))
        let pages: [(String, CGFloat, () -> AnyView, Double)] = [
            ("carabao-bracket", 720, { competition("eng.league_cup", "Carabao Cup", highlight: ["364", "363"]) }, 3),
            ("carabao-finished", 720, { competition("eng.league_cup", "Carabao Cup", year: 2025) }, 3),
            ("premier-league", 720, { competition("eng.1", "Premier League") }, 4),
            ("champions-league", 720, { competition("uefa.champions", "Champions League") }, 4),
            ("sports", 720, { AnyView(SportsPage(onBack: {}, onOpenSport: { _ in }, onFollowing: {}, onOpenLeague: { _ in })) }, 2),
            ("sport-soccer", 720, { AnyView(SportPage(sport: .soccer, onBack: {}, onOpenLeague: { _ in })) }, 3),
            ("sport-esports", 720, { AnyView(SportPage(sport: .esports, onBack: {}, onOpenLeague: { _ in })) }, 3),
            ("following", 720, { AnyView(FollowingPage(onBack: {}, onOpenLeague: { _ in }, onSports: {})) }, 2),
            ("league-selected", 720, { AnyView(LeagueSettingsView(league: League.with(id: "uefa.champions")!, backTitle: "Sports", onBack: {})) }, 3),
            ("match-hero", 420, { AnyView(DetailView(snapshot: hero, onBack: {}, backTitle: "Scores", preloaded: detail)) }, 2),
        ]
        var images: [(name: String, dark: Bool, image: NSBitmapImageRep)] = []
        for (name, height, build, wait) in pages {
            for dark in [false, true] {
                let page = OffscreenPage(width: 420, height: height, dark: dark) {
                    build()
                        .environment(store)
                        .environment(\.scheduleStore, schedule)
                        .environment(\.colorScheme, dark ? .dark : .light)
                }
                try? await Task.sleep(for: .seconds(wait))
                if let image = page.image() {
                    images.append((name, dark, image))
                    let path = URL(fileURLWithPath: directory).appendingPathComponent("\(name)-\(dark ? "dark" : "light").png")
                    try? image.representation(using: .png, properties: [:])?.write(to: path)
                    print("Rendered \(path.lastPathComponent)")
                }
                page.close()
            }
        }
        sheet(images, to: URL(fileURLWithPath: directory).appendingPathComponent("sheet.png"))
    }

    private static func sheet(_ images: [(name: String, dark: Bool, image: NSBitmapImageRep)], to url: URL) {
        let scale: CGFloat = 0.5, gap: CGFloat = 16, label: CGFloat = 20, columns = 6
        guard let first = images.first else { return }
        let cell = CGSize(width: CGFloat(first.image.pixelsWide) * scale, height: 720 * (CGFloat(first.image.pixelsWide) / 420) * scale)
        let rows = Int((Double(images.count) / Double(columns)).rounded(.up))
        let size = CGSize(width: CGFloat(columns) * (cell.width + gap) + gap, height: CGFloat(rows) * (cell.height + label + gap) + gap)
        let canvas = NSImage(size: size)
        canvas.lockFocus()
        NSColor(white: 0.5, alpha: 1).setFill()
        NSRect(origin: .zero, size: size).fill()
        for (index, item) in images.enumerated() {
            let x = gap + CGFloat(index % columns) * (cell.width + gap)
            let y = size.height - CGFloat(index / columns + 1) * (cell.height + label + gap)
            let height = CGFloat(item.image.pixelsHigh) * scale
            item.image.draw(in: NSRect(x: x, y: y + cell.height - height, width: CGFloat(item.image.pixelsWide) * scale, height: height))
            NSString(string: "\(item.name) \(item.dark ? "dark" : "light")").draw(at: NSPoint(x: x, y: y + cell.height + 3),
                withAttributes: [.font: NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: NSColor.white])
        }
        canvas.unlockFocus()
        if let data = canvas.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data) {
            try? bitmap.representation(using: .png, properties: [:])?.write(to: url)
            print("Sheet: \(url.lastPathComponent)")
        }
    }
}
