import AppKit
import SwiftUI

// Game-page modules: each block of a match page folds in place to its header
// and one live glance line, and can be hidden on a sport's pages from its
// header's menu. Both are remembered per page and module type, app-wide
// ("nba.liveView", "soccer.pitch"): never per game (too fiddly), never global
// (someone may love baseball's theater but not the NBA's). A module folded
// live stays folded in a final, where it exists: the key has no state in it.
//
// The keys are shared with the web port (settings.ts): `foldedModules` and
// `hiddenModules`, each a list of "<page>.<module>", where <page> is the web's
// `pageKind` and <module> its `Section` (the Mac's `DetailView.Section` names).

// MARK: - Keys

/// Which game page an event gets (the web's `pageKind`, data/sections.ts).
/// The WNBA reads the NBA's feed on the web; on the Mac it has the generic page.
enum PageKind: String, CaseIterable {
    case nba, soccer, baseball, football, espn, counterStrike, climbing

    static func of(_ ref: EventRef?) -> PageKind? {
        switch ref {
        case let .espn(path, _, sport)?:
            switch sport {
            case .soccer: .soccer
            case .baseball: .baseball
            case .football: .football
            case .basketball where path == NBADetail.path: .nba
            default: .espn
            }
        case .counterStrike?: .counterStrike
        case .climbing?: .climbing
        case nil: nil
        }
    }

    /// As the menus say it: "Hide Shot Chart on NBA Pages".
    var name: String {
        switch self {
        case .nba: "NBA"
        case .soccer: "Soccer"
        case .baseball: "Baseball"
        case .football: "Football"
        case .espn: "Basketball"
        case .counterStrike: "CS2"
        case .climbing: "Climbing"
        }
    }
}

/// Where folded and hidden modules are kept, and what each is called there.
/// One place, so the web port (settings.ts) reads and writes the same.
enum ModuleKeys {
    /// UserDefaults keys (the web's settings keys): each a list of module keys.
    static let folded = "foldedModules"
    static let hidden = "hiddenModules"

    /// "nba.liveView", "soccer.pitch", "baseball.atBat": the page, then the module.
    static func key(_ kind: PageKind, _ section: DetailView.Section) -> String {
        "\(kind.rawValue).\(sectionID(section))"
    }
}

/// Folded and hidden modules, app-wide. Nothing is either by default: a key
/// missing from both means shown and open. (pure; tested)
struct ModuleLayout: Equatable {
    var folded: Set<String> = []
    var hidden: Set<String> = []

    func isFolded(_ section: DetailView.Section, on kind: PageKind?) -> Bool {
        kind.map { folded.contains(ModuleKeys.key($0, section)) } ?? false
    }

    func isHidden(_ section: DetailView.Section, on kind: PageKind?) -> Bool {
        kind.map { hidden.contains(ModuleKeys.key($0, section)) } ?? false
    }

    mutating func fold(_ section: DetailView.Section, on kind: PageKind?, _ on: Bool) {
        guard let kind else { return }
        let key = ModuleKeys.key(kind, section)
        if on { folded.insert(key) } else { folded.remove(key) }
    }

    mutating func hide(_ section: DetailView.Section, on kind: PageKind?, _ on: Bool) {
        guard let kind else { return }
        let key = ModuleKeys.key(kind, section)
        if on { hidden.insert(key) } else { hidden.remove(key) }
    }

    /// The Customize sheet's Restore Defaults: everything on that sport's
    /// pages shows again (folds are left as they are; other sports untouched).
    mutating func showAll(on kind: PageKind) {
        hidden = hidden.filter { !$0.hasPrefix(kind.rawValue + ".") }
    }

    /// The page's sections without the hidden ones, in order: what the
    /// layout (one column or `wideArrangement`) places.
    func shown(_ sections: [DetailView.Section], on kind: PageKind?) -> [DetailView.Section] {
        sections.filter { !isHidden($0, on: kind) }
    }

    /// The sections this page would show but doesn't: the page's end names them.
    func hiddenHere(_ sections: [DetailView.Section], on kind: PageKind?) -> [DetailView.Section] {
        sections.filter { isHidden($0, on: kind) }
    }
}

extension DetailView {
    /// A module's name in its menu, the Customize sheet and the page's end:
    /// the same whatever the game's state ("Win Probability", not "How the
    /// Odds Moved"), so the sheet's list reads the same on every game.
    static func moduleName(_ section: Section, on kind: PageKind?) -> String {
        switch section {
        case .liveView: "Live View"
        case .field: "Field"
        case .atPlate: "At the Plate"
        case .atBat: "This At-Bat"
        case .pitch: "Pitch"
        case .timeline: "Timeline"
        case .table: kind == .nba ? "Standings" : kind == .soccer ? "Table" : "Conference"
        case .maps: "Maps"
        case .rounds: "Rounds"
        case .rosters: "Rosters"
        case .winProbability: "Win Probability"
        case .linescore: kind == .baseball ? "Score by Inning" : kind == .nba || kind == .football || kind == .espn ? "Score by Quarter" : "Score by Period"
        case .moments: kind == .soccer ? "Key Events" : kind == .nba ? "Key Plays" : "Scoring"
        case .stats: "Team Stats"
        case .plays: "Latest"
        case .battedBalls: "Balls in Play"
        case .wall: "High Points"
        case .scorecard: "Scorecard"
        case .climbingWatch, .streams: "Watch"
        case .results: "Results"
        case .startlist: "Starting Order"
        case .ascent: "On the Wall"
        case .whereToWatch: "Where to Watch"
        case .bracket: "Bracket"
        case .court: "Shot Chart"
        case .flow: "Game Flow"
        case .leaders: "Leaders"
        case .box: "Box Score"
        case .injuries: "Injury Report"
        }
    }

    /// Every module a sport's pages can show, for the Customize sheet: the
    /// live page's order first, then what only the final or the preview has.
    /// `liveOnly`: never on a final or a preview. (pure; tested)
    static func modules(for ref: EventRef?) -> [(section: Section, liveOnly: Bool)] {
        let live = order(ref, .live), final = order(ref, .final), scheduled = order(ref, .scheduled)
        var all: [Section] = []
        for section in live + final + scheduled where !all.contains(section) { all.append(section) }
        return all.map { ($0, live.contains($0) && !final.contains($0) && !scheduled.contains($0)) }
    }
}

// MARK: - Glance

/// A folded module's one line: the value first, then what it is, in the
/// module's own terms ("GSW +5 · 9 lead changes · 6 ties"). Built from the
/// same data as the module, so it updates live. (pure; tested)
struct ModuleGlance: Equatable {
    /// One side's chance: a dot in its color, the name, the number.
    struct Part: Equatable {
        var color: Color
        var name: String
        var value: String
    }

    enum Line: Equatable {
        case text(lead: String, detail: String)
        case parts([Part])
    }

    var line: Line

    /// What VoiceOver reads as the folded header's value.
    var spoken: String {
        switch line {
        case let .text(lead, detail): [lead, detail].filter { !$0.isEmpty }.joined(separator: ", ")
        case let .parts(parts): parts.map { "\($0.name) \($0.value)" }.joined(separator: ", ")
        }
    }

    static func text(_ lead: String, _ detail: String = "") -> ModuleGlance {
        ModuleGlance(line: .text(lead: lead, detail: detail))
    }

    // MARK: Plays

    /// A plays-list line ("Q4 2:30  Stephen Curry makes…", "67'  Corner…"):
    /// its time leads, the play follows. A line without one is all detail.
    static func play(_ line: String) -> ModuleGlance {
        guard let gap = line.range(of: "  ") else { return text("", line) }
        let lead = line[..<gap.lowerBound].trimmingCharacters(in: .whitespaces)
        let rest = line[gap.upperBound...].trimmingCharacters(in: .whitespaces)
        return lead.isEmpty ? text("", rest) : text(lead, rest)
    }

    /// Key events (soccer: the newest goal, else the newest event), key
    /// plays and scoring: the newest, its time first.
    static func newest(_ moments: [GameDetail.Moment], soccer: Bool) -> ModuleGlance? {
        let goals = moments.filter { $0.kind == .goal || $0.kind == .ownGoal }
        guard let m = (soccer ? goals.last : nil) ?? moments.last else { return nil }
        var what = MomentList.headline(m)
        if soccer {
            switch m.kind {
            case .goal, .ownGoal: what = "Goal! " + what
            case .red: what = "Red card: " + what
            case .yellow: what = "Yellow card: " + what
            default: break
            }
        }
        if let score = m.score, !score.isEmpty { what += ", \(score)" }
        return text(m.clock, what)
    }

    // MARK: Charts

    /// Field goals and threes, each made of attempted.
    struct Shooting: Equatable {
        var made = 0, attempts = 0, threesMade = 0, threesAttempted = 0

        var percent: Int { attempts > 0 ? Int((Double(made) / Double(attempts) * 100).rounded()) : 0 }

        /// From the box score's totals ("38-82", "14-33"), when it has them.
        init?(fg: String?, threes: String?) {
            guard let fg = fg.flatMap(CourtView.made) else { return nil }
            made = fg.made
            attempts = fg.attempts
            let three = threes.flatMap(CourtView.made)
            threesMade = three?.made ?? 0
            threesAttempted = three?.attempts ?? 0
        }

        /// Counted from the shots on the chart, one side's.
        init(_ shots: [GameDetail.Shot], side: GameDetail.Side) {
            for shot in shots where shot.side == side {
                attempts += 1
                if shot.made { made += 1 }
                if shot.value == 3 {
                    threesAttempted += 1
                    if shot.made { threesMade += 1 }
                }
            }
        }

        init(made: Int, attempts: Int, threesMade: Int, threesAttempted: Int) {
            self.made = made
            self.attempts = attempts
            self.threesMade = threesMade
            self.threesAttempted = threesAttempted
        }
    }

    /// The shot chart: "GSW 46% FG", then "14 of 33 from three · MIN 43%, 11 of 31".
    static func shooting(top: Shooting, bottom: Shooting, names: (top: String, bottom: String)) -> ModuleGlance {
        guard top.attempts + bottom.attempts > 0 else { return text("", "No shots yet") }
        return text("\(names.top) \(top.percent)% FG",
                    "\(top.threesMade) of \(top.threesAttempted) from three · \(names.bottom) \(bottom.percent)%, "
                        + "\(bottom.threesMade) of \(bottom.threesAttempted)")
    }

    /// The game flow: who leads and by how much, then the lead changes and ties.
    static func flow(_ points: [GameDetail.FlowPoint], names: (top: String, bottom: String)) -> ModuleGlance? {
        guard let last = points.last else { return nil }
        let margin = last.top - last.bottom
        let lead = margin == 0 ? "Tied \(last.top)–\(last.bottom)" : "\(margin > 0 ? names.top : names.bottom) +\(abs(margin))"
        let counted = flowCounts(points)
        let changes = counted.changes == 0 ? "No lead changes" : counted.changes == 1 ? "1 lead change" : "\(counted.changes) lead changes"
        let ties = counted.ties == 0 ? nil : counted.ties == 1 ? "1 tie" : "\(counted.ties) ties"
        return text(lead, [changes, ties].compactMap { $0 }.joined(separator: " · "))
    }

    /// Lead changes (the leader switching sides) and ties (the score drawing
    /// level after a lead), as ESPN counts them; 0–0 at tip-off isn't a tie.
    static func flowCounts(_ points: [GameDetail.FlowPoint]) -> (changes: Int, ties: Int) {
        var changes = 0, ties = 0
        var leader = 0, previous = 0
        for p in points {
            let sign = (p.top - p.bottom).signum()
            if sign == 0, previous != 0 { ties += 1 }
            if sign != 0 {
                if leader != 0, sign != leader { changes += 1 }
                leader = sign
            }
            previous = sign
        }
        return (changes, ties)
    }

    /// The line score: the latest period, then its score ("Q4", "GSW 27–21 MIN this quarter").
    static func linescore(headers: [String], top: [String], bottom: [String], names: (top: String, bottom: String),
                          baseball: Bool, live: Bool) -> ModuleGlance? {
        let totals: Set<String> = ["T", "R", "H", "E"]
        let periods = headers.indices.filter { !totals.contains(headers[$0]) && $0 < top.count && $0 < bottom.count }
        guard let i = periods.last(where: { !top[$0].isEmpty || !bottom[$0].isEmpty }) else { return nil }
        let header = headers[i]
        let label: String
        if let n = Int(header) {
            label = baseball ? Ordinal.string(n) : n <= 4 ? "Q\(n)" : n == 5 ? "OT" : "OT\(n - 4)"
        } else {
            label = header
        }
        let t = top[i].isEmpty ? "0" : top[i], b = bottom[i].isEmpty ? "0" : bottom[i]
        return text(label, "\(names.top) \(t)–\(b) \(names.bottom)" + (live ? (baseball ? " this inning" : " this quarter") : ""))
    }

    /// The leaders: the game's top scorer, then the other side's.
    static func leaders(_ lines: [GameDetail.LeaderLine]) -> ModuleGlance? {
        guard let line = lines.first else { return nil }
        let both = [line.top, line.bottom].compactMap { $0 }.sorted { (Double($0.value) ?? 0) > (Double($1.value) ?? 0) }
        guard let first = both.first else { return nil }
        return text("\(surname(first.name)) \(first.value)", both.dropFirst().map { "\(surname($0.name)) \($0.value)" }.joined(separator: " · "))
    }

    /// The box score: live, who's on the floor (the side shown first); else its starters.
    static func box(_ players: [GameDetail.BoxPlayer], live: Bool) -> ModuleGlance? {
        let five = players.filter { live ? $0.onCourt : $0.starter }
        guard !five.isEmpty else { return nil }
        return text(live ? "On court" : "Starters", five.map { surname($0.name) }.joined(separator: ", "))
    }

    /// Team stats: the first three, as the bars list them.
    static func stats(_ stats: [GameDetail.Stat]) -> ModuleGlance? {
        guard let first = stats.first else { return nil }
        func pair(_ s: GameDetail.Stat) -> String { "\(s.label) \(s.top)–\(s.bottom)" }
        return text(pair(first), stats.dropFirst().prefix(2).map(pair).joined(separator: " · "))
    }

    /// A table: where each team stands, the higher first ("GSW 3rd", "MIN 7th").
    static func standings(_ places: [(name: String, rank: Int)]) -> ModuleGlance? {
        let sorted = places.sorted { $0.rank < $1.rank }
        guard let first = sorted.first else { return nil }
        return text("\(first.name) \(Ordinal.string(first.rank))",
                    sorted.dropFirst().map { "\($0.name) \(Ordinal.string($0.rank))" }.joined(separator: " · "))
    }

    /// Who's out ("3 out", "Kuminga, Moody, Reid"), else how many are listed.
    static func injuries(_ list: [GameDetail.Injury]) -> ModuleGlance? {
        guard !list.isEmpty else { return nil }
        let out = list.filter { $0.status.lowercased().hasPrefix("out") }
        let named = out.isEmpty ? list : out
        return text(out.isEmpty ? "\(list.count) listed" : "\(out.count) out", named.map { surname($0.name) }.joined(separator: ", "))
    }

    /// Where to watch: the first broadcaster, then the rest ("ESPN", "and Prime Video").
    static func broadcasters(_ names: [String]) -> ModuleGlance? {
        guard let first = names.first else { return nil }
        let rest = names.count == 2 ? "and \(names[1])" : names.count > 2 ? "and \(names.count - 1) more" : ""
        return text(first, rest)
    }

    /// This at-bat: the newest pitch ("Pitch 3", "97 mph four-seam, foul").
    static func atBat(_ pitches: [GameDetail.Pitch]) -> ModuleGlance {
        guard let p = pitches.max(by: { $0.number < $1.number }) else { return text("", "Waiting for the first pitch") }
        let kind = p.type.flatMap { GameDetail.Pitch.names[$0] }?.lowercased() ?? p.typeName?.lowercased()
        let result: String = switch (p.result, p.strike) {
        case (.ball, _): "ball"
        case (.inPlay, _): "in play"
        case (.strike, .called?): "called strike"
        case (.strike, .swinging?): "swinging strike"
        case (.strike, .foul?): "foul"
        case (.strike, .foulTip?): "foul tip"
        case (.strike, nil): "strike"
        }
        let pitch = [p.mph.map { "\($0) mph" }, kind].compactMap { $0 }.joined(separator: " ")
        return text("Pitch \(p.number)", pitch.isEmpty ? result : "\(pitch), \(result)")
    }

    /// At the plate: the outs, then the runners and the matchup.
    static func atPlate(outs: Int, bases: [Bool], batter: String?, pitcher: String?) -> ModuleGlance {
        let on = bases.indices.filter { bases[$0] }.map { Ordinal.string($0 + 1) }
        let runners = on.count == 3 ? "Bases loaded" : on.isEmpty ? "Bases empty"
            : on.count == 1 ? "Runner on \(on[0])" : "Runners on \(on.joined(separator: " and "))"
        let matchup = batter.flatMap { b in pitcher.map { "\(surname(b)) vs. \(surname($0))" } }
        return text(outs == 1 ? "1 out" : "\(outs) outs", [runners, matchup].compactMap { $0 }.joined(separator: " · "))
    }

    /// The field: who has the ball, the down, and the drive so far.
    static func field(possession: String?, downDistance: String?, plays: Int) -> ModuleGlance {
        let drive = plays > 0 ? (plays == 1 ? "1 play this drive" : "\(plays) plays this drive") : nil
        guard let possession else { return text(downDistance ?? "", drive ?? "") }
        return text("\(possession) ball", [downDistance, drive].compactMap { $0 }.joined(separator: " · "))
    }

    /// Soccer's shot map: shots, then shots on target.
    static func shotMap(_ shots: [PitchAction], names: (top: String, bottom: String)) -> ModuleGlance {
        func count(_ side: GameDetail.Side, onTarget: Bool) -> Int {
            shots.filter { $0.side == side && (!onTarget || $0.kind == .goal || $0.shot == .saved) }.count
        }
        return text("Shots \(count(.top, onTarget: false))–\(count(.bottom, onTarget: false))",
                    "On target \(count(.top, onTarget: true))–\(count(.bottom, onTarget: true))")
    }

    /// The soccer timeline: the score, then each goal's minute and scorer.
    static func timeline(_ moments: [GameDetail.Moment], score: String?) -> ModuleGlance? {
        let goals = moments.filter { $0.kind == .goal || $0.kind == .ownGoal }
        let detail = goals.isEmpty ? "No goals yet" : goals.map { "\($0.clock) \(MomentList.headline($0))" }.joined(separator: " · ")
        return text(score ?? "", detail)
    }

    /// Each side's chance, keyed by its color ("GSW 96%", "MIN 4%"); a draw between.
    static func chances(_ split: OddsSplit, final: Bool, top: (Color, String), draw: Color?, bottom: (Color, String)) -> ModuleGlance {
        let percents = split.percents(final: final)
        var parts = [Part(color: top.0, name: top.1, value: percents[.top].map { "\($0)%" } ?? "–")]
        if split.draw != nil, let draw {
            parts.append(Part(color: draw, name: "Draw", value: percents[.draw].map { "\($0)%" } ?? "–"))
        }
        parts.append(Part(color: bottom.0, name: bottom.1, value: percents[.bottom].map { "\($0)%" } ?? "–"))
        return ModuleGlance(line: .parts(parts))
    }

    /// "Stephen Curry" → "Curry"; "Jaime Jaquez Jr." → "Jaquez".
    static func surname(_ name: String) -> String {
        let suffixes: Set<String> = ["Jr.", "Jr", "Sr.", "Sr", "II", "III", "IV", "V"]
        let words = name.split(separator: " ").map(String.init)
        return words.last { !suffixes.contains($0) } ?? name
    }
}

// MARK: - The header's chrome

/// How a fold's change animates: a click springs (house tokens), Reduce
/// Motion only cross-fades, a keyboard toggle is instant (house rule).
enum FoldMotion: Equatable {
    case animated, fade, instant

    /// The module's content arriving and leaving.
    var content: AnyTransition {
        switch self {
        case .instant: .identity
        case .fade: .opacity.animation(Motion.fade)
        // Opening: a 4pt rise with `reveal`; closing: faster, on `exit`.
        case .animated: .asymmetric(insertion: .opacity.combined(with: .offset(y: 4)).animation(Motion.reveal),
                                    removal: .opacity.animation(Motion.exit))
        }
    }

    /// The caption and the glance trading places.
    var swap: AnyTransition {
        switch self {
        case .instant: .identity
        case .fade: .opacity.animation(Motion.fade)
        case .animated: .asymmetric(insertion: .opacity.animation(Motion.fade), removal: .opacity.animation(Motion.exit))
        }
    }
}

/// What a module's header can do.
enum ModuleAction {
    /// The header clicked (⌥: every module on the page follows it, Finder's convention).
    case toggle(all: Bool)
    /// ← folds, → unfolds.
    case fold(Bool)
    case hide
    case customize
}

/// A page section as a module: set by the match page on each section, read
/// by its chrome (`DetailSection`, `OddsSectionChrome`). Nil elsewhere, where
/// sections are plain.
struct ModuleChrome {
    /// "Shot Chart": its name in the menu.
    var name: String
    /// "NBA": the pages hiding it applies to.
    var page: String
    var folded: Bool
    /// Folded, the line under the header (nil: the caption, quietly).
    var glance: ModuleGlance?
    /// The chart whose live moments this module captions: folded, the glance carries them.
    var moment: LiveMoment.Chart?
    var motion: FoldMotion = .animated
    /// Folded, the content stays (laid out, unseen, out of the focus order)
    /// instead of leaving: the Live View's theater keeps its running order
    /// and clocks, exactly as when it's scrolled away.
    var keepsAlive = false
    /// `keyboard`: from a key, so it doesn't animate.
    var act: @MainActor (ModuleAction, _ keyboard: Bool) -> Void
}

private struct ModuleChromeKey: EnvironmentKey {
    static let defaultValue: ModuleChrome? = nil
}

extension EnvironmentValues {
    var moduleChrome: ModuleChrome? {
        get { self[ModuleChromeKey.self] }
        set { self[ModuleChromeKey.self] = newValue }
    }
}

/// A module's header: a disclosure button over its title row and its caption
/// (or, folded, its glance). Pointing lifts it (a 6% wash, at once; it fades
/// out over 0.15 s) and shows the chevron at its trailing edge; folded, the
/// chevron stays, as the module's state. Space or Return toggles, ← folds,
/// → unfolds, ⌥-click folds or unfolds every module on the page. The context
/// menu collapses, hides the module on the sport's pages, or customizes them.
/// VoiceOver: "Shot Chart, collapsed", with the glance as its value; still a
/// heading, so the rotor lists folded modules.
struct ModuleHeader<Trailing: View>: View {
    let title: String
    var caption: String? = nil
    var spokenCaption: String? = nil
    var accessory: SectionAccessory? = nil
    /// The module's own glance (the odds chart's), over the chrome's.
    var glance: ModuleGlance? = nil
    let chrome: ModuleChrome
    @ViewBuilder var trailing: Trailing
    @State private var hovering = false

    private var folded: Bool { chrome.folded }

    var body: some View {
        VStack(alignment: .leading, spacing: folded ? 3 : 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                SectionTitle(title, accessory: accessory)
                    .accessibilityHidden(true)
                    .allowsHitTesting(false)
                // A control in the title row (the odds window) belongs to the content: folded, it goes with it.
                if !folded { trailing.transition(chrome.motion.swap) }
                chevron
            }
            if folded {
                GlanceLine(glance: glance ?? chrome.glance, fallback: caption, chart: chrome.moment)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .transition(chrome.motion.swap)
            } else if let caption {
                Text(caption)
                    .font(Viz.note)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    // A spanning section's caption still reads as one comfortable line.
                    .readableWidth()
                    .accessibilityLabel(spokenCaption ?? caption)
                    .allowsHitTesting(false)
                    .transition(chrome.motion.swap)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(Color.primary.opacity(hovering ? 0.06 : 0))
                // The lift is instant; it fades out.
                .animation(hovering ? nil : Motion.fade, value: hovering)
        }
        // Under the title and glance, so a click anywhere on them is the disclosure's;
        // a control in the title row stays its own.
        .background { button }
        .onHover { hovering = $0 }
        .contextMenu { menu }
        .padding(.horizontal, -6)
        .padding(.vertical, -4)
    }

    private var button: some View {
        Button {
            let event = NSApp.currentEvent
            chrome.act(.toggle(all: event?.modifierFlags.contains(.option) == true), event?.type == .keyDown)
        } label: {
            Color.clear.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onKeyPress(keys: [.space, .return, .leftArrow, .rightArrow]) { press in
            switch press.key {
            case .leftArrow: chrome.act(.fold(true), true)
            case .rightArrow: chrome.act(.fold(false), true)
            default: chrome.act(.toggle(all: press.modifiers.contains(.option)), true)
            }
            return .handled
        }
        .help(folded ? "Expand \(chrome.name)" : "Collapse \(chrome.name)")
        .accessibilityLabel(Self.spoken(title, folded: folded))
        .accessibilityValue(folded ? (glance ?? chrome.glance)?.spoken ?? caption ?? "" : Self.spoken(accessory))
        .accessibilityAddTraits(.isHeader)
        .accessibilityHeading(.h2)
        .accessibilityHint(folded ? "Expands the section" : "Collapses the section")
    }

    /// "Shot Chart, collapsed". (pure; tested)
    static func spoken(_ title: String, folded: Bool) -> String { "\(title), \(folded ? "collapsed" : "expanded")" }

    private static func spoken(_ accessory: SectionAccessory?) -> String {
        switch accessory {
        case .live: "Live"
        case .final: "Final"
        case let .text(text): text
        case let .count(balls, strikes): "\(balls) and \(strikes)"
        case nil: ""
        }
    }

    /// Down while open (shown on hover, like a sidebar section's); right while
    /// folded (always shown: it's the module's state). Turns on `quick`.
    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(Glyph.disclosure)
            .foregroundStyle(hovering ? .primary : .secondary)
            .rotationEffect(.degrees(folded ? 0 : 90))
            .animation(chrome.motion == .animated ? Motion.quick : nil, value: folded)
            .frame(width: 12)
            .opacity(folded || hovering ? 1 : 0)
            .animation(hovering ? nil : Motion.fade, value: hovering)
            .accessibilityHidden(true)
            .allowsHitTesting(false)
    }

    @ViewBuilder
    private var menu: some View {
        Button(folded ? "Expand \(chrome.name)" : "Collapse \(chrome.name)") { chrome.act(.toggle(all: false), false) }
        Divider()
        Button("Hide \(chrome.name) on \(chrome.page) Pages") { chrome.act(.hide, false) }
        Button("Customize \(chrome.page) Pages…") { chrome.act(.customize, false) }
    }
}

/// A folded module's line: the moment its chart is captioning, while it's
/// news (so a folded chart in view carries it, not the docked bar); else its
/// glance; else its caption, quietly. Numbers roll as they change, like the hero's.
struct GlanceLine: View {
    let glance: ModuleGlance?
    var fallback: String? = nil
    var chart: LiveMoment.Chart? = nil
    @Environment(MomentCenter.self) private var moments: MomentCenter?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let font = Font.system(size: 11.5).monospacedDigit()

    var body: some View {
        let moment = chart.flatMap { c in moments?.current.flatMap { $0.chart == c && $0.captioned ? $0 : nil } }
        Group {
            if let moment {
                HStack(spacing: 5) {
                    Circle().fill(.red).frame(width: 5, height: 5)
                    lead(moment.lead, moment.detail)
                }
                .id(moment.id)
                .transition(.opacity.animation(reduceMotion ? Motion.fade : Motion.reveal))
            } else if let glance {
                switch glance.line {
                case let .text(lead, detail): self.lead(lead, detail)
                case let .parts(parts): self.parts(parts)
                }
            } else if let fallback {
                Text(fallback).font(Viz.note).foregroundStyle(.secondary).lineLimit(1).truncationMode(.tail)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(reduceMotion ? nil : Motion.quick, value: glance)
    }

    private func lead(_ lead: String, _ detail: String) -> some View {
        Group {
            if lead.isEmpty {
                Text(detail).foregroundStyle(.primary)
            } else {
                Text(lead).fontWeight(.semibold).foregroundStyle(.primary)
                    + Text(detail.isEmpty ? "" : "  \(detail)").foregroundStyle(.secondary)
            }
        }
        .font(Self.font)
        .lineLimit(1)
        .truncationMode(.tail)
        .contentTransition(.numericText())
    }

    private func parts(_ parts: [ModuleGlance.Part]) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            ForEach(parts.indices, id: \.self) { i in
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Circle().fill(parts[i].color).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 0.5 }
                    Text(parts[i].name).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(.secondary)
                    Text(parts[i].value).font(.system(size: 11.5, weight: .semibold).monospacedDigit()).foregroundStyle(.primary)
                        .contentTransition(.numericText())
                }
                .fixedSize()
            }
        }
    }
}

extension View {
    /// A module's content that stays when folded (the Live View's theater):
    /// laid out at its own size but shown at none, unseen, out of the focus
    /// order and the accessibility tree, with no frames drawn (the theater
    /// reads its section's folded state as scrolled away).
    func foldKeptAlive(_ folded: Bool) -> some View {
        frame(height: folded ? 0 : nil, alignment: .top)
            .clipped()
            .opacity(folded ? 0 : 1)
            // The section's spacing above it goes with it.
            .padding(.top, folded ? -8 : 0)
            .allowsHitTesting(!folded)
            .disabled(folded)
            .accessibilityHidden(folded)
    }
}

// MARK: - Hidden modules

/// The page's end, when the sport hides some of what it would show: the
/// modules by name, and one click to show them again.
struct HiddenModulesLine: View {
    let names: [String]
    let page: String
    let show: () -> Void

    /// "Hidden on NBA pages: Shot Chart, Live View". (pure; tested)
    static func text(_ names: [String], page: String) -> String {
        "Hidden on \(page) pages: \(names.joined(separator: ", "))"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "eye.slash").font(.system(size: 10)).foregroundStyle(.tertiary).accessibilityHidden(true)
            Text(Self.text(names, page: page)).font(Viz.note).foregroundStyle(.secondary).lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 6)
            SectionLink("Show", help: "Show \(names.joined(separator: " and ")) on \(page) pages") { show() }
        }
        .readableWidth()
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 18)
    }
}

// MARK: - Customize

/// A sport's game pages, show or hide each module (no reordering: the
/// per-state plans and the split page's pairs are designed). Over the page,
/// like a sheet, inside the panel.
struct CustomizeModulesSheet: View {
    struct Row: Identifiable {
        let section: DetailView.Section
        let name: String
        let liveOnly: Bool
        var id: String { sectionID(section) }
    }

    let page: String
    let rows: [Row]
    let isShown: (DetailView.Section) -> Bool
    let setShown: (DetailView.Section, Bool) -> Void
    let restore: () -> Void
    let done: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(page) Game Pages").font(.system(size: 13, weight: .semibold))
                .accessibilityAddTraits(.isHeader)
            Text("What shows on every \(page) game.")
                .font(.system(size: 11)).foregroundStyle(.secondary).padding(.top, 2).padding(.bottom, 8)
            ForEach(rows.indices, id: \.self) { i in
                let row = rows[i]
                Toggle(isOn: Binding(get: { isShown(row.section) }, set: { setShown(row.section, $0) })) {
                    HStack {
                        Text(row.name).font(.system(size: 12.5)).foregroundStyle(isShown(row.section) ? .primary : .secondary)
                        Spacer()
                        if row.liveOnly { Text("Live").font(.system(size: 10)).foregroundStyle(.tertiary).accessibilityHidden(true) }
                    }
                }
                .toggleStyle(ModuleCheckbox())
                .frame(height: 24)
                if i < rows.count - 1 { Divider().opacity(0.5).padding(.leading, 21) }
            }
            HStack {
                Button("Restore Defaults", action: restore)
                    .buttonStyle(.plain)
                    .font(.system(size: 11.5))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: done) {
                    Text("Done").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 4)
                        .background(Capsule().fill(Color.accentColor))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.defaultAction)
            }
            .padding(.top, 10)
        }
        .padding(14)
        .frame(width: 262)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(scheme == .dark ? Color(white: 0.17) : .white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.3), radius: 18, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}

/// A checkbox drawn in SwiftUI (the sheet renders in the harness, which can't
/// draw AppKit controls). The whole row toggles; VoiceOver hears a checkbox.
struct ModuleCheckbox: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            HStack(spacing: 8) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: 13))
                    .foregroundStyle(configuration.isOn ? Color.accentColor : .secondary)
                configuration.label
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isToggle)
        .accessibilityValue(configuration.isOn ? "Shown" : "Hidden")
    }
}
