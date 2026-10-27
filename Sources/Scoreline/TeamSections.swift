import SwiftUI

// The Team page's sections: next game, roster (grouped per sport, with an NFL
// depth-chart view), leaders, injuries, transactions, CS2 titles, and the
// shared stat tiles.

// MARK: - Live

/// A team or player page's game in progress: the score line and the rows'
/// live status (dot and ticking clock), opening the match.
struct LiveStrip: View {
    let event: Event
    let open: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                Text(event.scoreLine(abbreviated: true)).font(.system(size: 12, weight: .semibold).monospacedDigit())
                LiveStatus(event)
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: hovering, inset: 0))
        .onHover { hovering = $0 }
        .padding(.horizontal, 10)
        .help("Open the match")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Live: \(event.spokenScore), \(event.spokenStatus)")
        .accessibilityHint(LinkHint.match)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { open() }
    }
}

// MARK: - Next game

struct NextGameRow: View {
    let game: Profile.GameRef
    let team: Profile.TeamRef
    /// ESPN path, to open the match page.
    let path: String?
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    @Environment(ScoreStore.self) private var scores: ScoreStore?

    /// The scores list's copy of a live game, for its ticking clock.
    private var liveEvent: Event? {
        guard game.state == .live else { return nil }
        let id = game.slug.map { "cs-\($0)" } ?? "espn-\(game.id)"
        return scores?.sections.lazy.flatMap(\.events).first { $0.id == id }
    }

    var body: some View {
        RowLink(help: "Open the match", hint: LinkHint.match, action: open) { hovering in
            HStack(spacing: 10) {
                if let opponent = game.opponent { TeamCrest(team: opponent, size: 22) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 12.5, weight: .medium)).lineLimit(1).linkName(hovering)
                    Text(subtitle).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 6)
                trailing
            }
        }
        .contextMenu { if let opponent = game.opponent { GoToTeamItem(team: opponent) } }
    }

    private var title: String {
        guard let opponent = game.opponent else { return "TBD" }
        return "\(game.home ? "vs" : "at") \(opponent.name)"
    }

    private var subtitle: String {
        [When.dayAndTime(game.date), game.network, game.competition].compactMap { $0 }.joined(separator: " · ")
    }

    @ViewBuilder
    private var trailing: some View {
        switch game.state {
        case .final:
            if let a = game.teamScore, let b = game.opponentScore {
                (Text(game.result ?? "").fontWeight(.semibold) + Text(" \(a)–\(b)"))
                    .font(.system(size: 12).monospacedDigit())
            }
        case .live:
            LiveStatus(clock: liveEvent?.clock, fallback: liveEvent?.detail ?? "Live")
        case .scheduled:
            TimelineView(.periodic(from: .now, by: 60)) { context in
                if let text = Countdown.text(to: game.date, from: context.date) {
                    Text(text).font(.system(size: 11, weight: .semibold).monospacedDigit()).foregroundStyle(Color.accentColor)
                }
            }
        }
    }

    private func open() {
        guard let navigator, let opponent = game.opponent else { return }
        func competitor(_ t: Profile.TeamRef, score: String?) -> Competitor {
            Competitor(id: t.id, name: t.name, abbreviation: t.abbreviation ?? t.name, score: score, logo: t.logo,
                       isWinner: false, color: t.color)
        }
        let us = competitor(team, score: game.teamScore), them = competitor(opponent, score: game.opponentScore)
        let soccer = team.sport == .soccer
        // House order: soccer home on top; everyone else away on top.
        let (top, bottom) = soccer == game.home ? (us, them) : (them, us)
        let ref: EventRef? = if let slug = game.slug {
            .counterStrike(slug: slug, tournament: game.competition)
        } else if let path, let sport = team.sport {
            .espn(path: path, id: game.id, sport: sport)
        } else { nil }
        guard let ref else { return }
        navigator.open(Event(id: game.slug.map { "cs-\($0)" } ?? "espn-\(game.id)", content: .match(top: top, bottom: bottom),
                             state: game.state, start: game.date, detail: game.state == .final ? "Final" : nil,
                             caption: game.competition, link: nil, ref: ref))
    }
}

// MARK: - Roster

struct ProfileRosterColumn: Equatable {
    let key: String
    let label: String
    let width: CGFloat
    let from: WidthClass
}

enum ProfileRosterColumns {
    /// Columns per sport and group; a column never moves when others join.
    static func columns(sport: Sport, group: Profile.RosterGroup.Kind) -> [ProfileRosterColumn] {
        switch sport {
        case .basketball:
            [.init(key: "PTS", label: "PTS", width: 30, from: .compact), .init(key: "REB", label: "REB", width: 30, from: .compact),
             .init(key: "AST", label: "AST", width: 30, from: .compact), .init(key: "MIN", label: "MIN", width: 32, from: .medium),
             .init(key: "FG%", label: "FG%", width: 36, from: .large)]
        case .baseball where [.rotation, .bullpen].contains(group):
            [.init(key: "ERA", label: "ERA", width: 36, from: .compact), .init(key: "K", label: "K", width: 30, from: .compact),
             .init(key: group == .bullpen ? "SV" : "W", label: group == .bullpen ? "SV" : "W", width: 28, from: .medium),
             .init(key: "WHIP", label: "WHIP", width: 38, from: .large)]
        case .baseball:
            [.init(key: "AVG", label: "AVG", width: 38, from: .compact), .init(key: "HR", label: "HR", width: 28, from: .compact),
             .init(key: "RBI", label: "RBI", width: 30, from: .medium), .init(key: "OPS", label: "OPS", width: 38, from: .large)]
        case .soccer where group == .goalkeepers:
            [.init(key: "appearances", label: "APP", width: 30, from: .compact), .init(key: "saves", label: "SV", width: 28, from: .compact),
             .init(key: "goalsConceded", label: "GA", width: 28, from: .compact), .init(key: "age", label: "AGE", width: 30, from: .medium)]
        case .soccer:
            [.init(key: "appearances", label: "APP", width: 30, from: .compact), .init(key: "totalGoals", label: "G", width: 24, from: .compact),
             .init(key: "goalAssists", label: "A", width: 24, from: .compact), .init(key: "age", label: "AGE", width: 30, from: .medium),
             .init(key: "totalShots", label: "SHOTS", width: 38, from: .large)]
        case .esports:
            group == .players ? [.init(key: "RATING", label: "RATING", width: 44, from: .compact),
                                 .init(key: "age", label: "AGE", width: 30, from: .medium)] : []
        default:
            []
        }
    }

    /// Football: one stat line by position instead of columns ("1,474 yds · 9 TD").
    static func statLine(_ p: Profile.RosterPlayer) -> String? {
        let s = p.stats
        func line(_ a: String?, _ unitA: String, _ b: String?, _ unitB: String) -> String? {
            guard let a else { return nil }
            return [a + " " + unitA, b.flatMap { $0 == "0" ? nil : $0 + " " + unitB }].compactMap { $0 }.joined(separator: " · ")
        }
        switch p.position ?? "" {
        case "QB": return line(s["PYDS"], "yds", s["PTD"], "TD")
        case "RB", "FB": return line(s["RYDS"], "yds", s["RTD"], "TD")
        case "WR", "TE": return line(s["REC"], "rec", s["RECYDS"], "yds")
        case "PK", "K", "P", "LS", "OT", "G", "C", "OL": return nil
        default: return line(s["TOT"], "tkl", s["SACK"], "sk")
        }
    }
}

struct RosterSection: View {
    let groups: [Profile.RosterGroup]
    let sport: Sport
    let depthChart: Profile.DepthChart?
    let tint: Color
    let sessionKey: String
    let store: ProfileStore
    /// 2 when the roster spans a split panel: its groups (and depth-chart
    /// units) go two-up, each into the shorter column, in order.
    var columns = 1
    @Environment(\.widthClass) private var widthClass

    private var session: ProfileStore.PageSession { store.session[sessionKey] ?? .init() }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if depthChart != nil {
                Picker("View", selection: Binding(get: { session.depthChart }, set: { store.session[sessionKey, default: .init()].depthChart = $0 })) {
                    Text("Roster").tag(false)
                    Text("Depth Chart").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.small)
                .fixedSize()
                .padding(.bottom, 4)
            }
            if session.depthChart, let depthChart {
                let players = Dictionary(groups.flatMap(\.players).map { ($0.ref.id, $0) }, uniquingKeysWith: { a, _ in a })
                TwoUp(sizes: depthChart.units.map { $0.slots.count + 1 }, columns: columns) { indices in
                    DepthChartView(chart: Profile.DepthChart(units: indices.map { depthChart.units[$0] }), players: players)
                }
            } else {
                TwoUp(sizes: groups.map(size), columns: columns) { indices in
                    // A long roster builds lazily: offscreen rows (and their photos) wait until scrolled to.
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(indices.map { groups[$0] }) { group in groupView(group) }
                    }
                }
            }
        }
    }

    private func collapsed(_ group: Profile.RosterGroup) -> Bool {
        group.collapsedByDefault && !session.expanded.contains(group.kind.rawValue)
    }

    /// Rows a group takes (its header counts as one), for balancing columns.
    private func size(_ group: Profile.RosterGroup) -> Int { collapsed(group) ? 2 : group.players.count + 1 }

    @ViewBuilder
    private func groupView(_ group: Profile.RosterGroup) -> some View {
        // Who's out has no line to show: their group says why.
        let columns = group.kind == .out ? []
            : ProfileRosterColumns.columns(sport: sport, group: group.kind).filter { $0.from <= widthClass }
        let collapsed = collapsed(group)
        ProfileGroupHeader(title: group.title, columns: collapsed ? [] : columns.map { ($0.label, $0.width) })
        if collapsed {
            ProfileMoreButton(title: "Show \(plural(group.players.count, "player"))") {
                store.session[sessionKey, default: .init()].expanded.insert(group.kind.rawValue)
            }
        } else {
            ForEach(group.players) { player in
                RosterRow(player: player, columns: columns, tint: tint, sport: sport, group: group.kind)
            }
        }
    }
}

/// Blocks in one column, or two side by side with each block placed in the
/// shorter column so far (`GroupPlacement`: by row count, never measured, so
/// nothing moves as data refreshes).
private struct TwoUp<Column: View>: View {
    let sizes: [Int]
    let columns: Int
    @ViewBuilder let column: ([Int]) -> Column

    var body: some View {
        if columns < 2 {
            column(Array(sizes.indices))
        } else {
            HStack(alignment: .top, spacing: 20) {
                ForEach(Array(GroupPlacement.columns(for: sizes, columns: columns).enumerated()), id: \.offset) { _, indices in
                    column(indices).frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
        }
    }
}

struct RosterRow: View {
    let player: Profile.RosterPlayer
    let columns: [ProfileRosterColumn]
    let tint: Color
    let sport: Sport
    let group: Profile.RosterGroup.Kind
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    var body: some View {
        RowLink(help: "Go to \(player.ref.name)", hint: LinkHint.player, action: { navigator?.open(player.ref) },
                onDwell: { ProfileStore.shared.prefetch(player.ref) }) { hovering in
            HStack(spacing: 9) {
                PlayerPhoto(url: player.ref.photo, name: player.ref.name, tint: tint, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(player.ref.name)
                        .font(.system(size: 12.5, weight: .medium))
                        .lineLimit(1)
                        .linkName(hovering)
                    subtitle
                        .font(.system(size: 10.5))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if sport == .football, let line = ProfileRosterColumns.statLine(player) {
                    Text(line).font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
                }
                ForEach(columns, id: \.key) { column in
                    Text(value(column.key))
                        .font(.system(size: 11.5).monospacedDigit())
                        .foregroundStyle(value(column.key) == "–" ? .tertiary : .primary)
                        .frame(width: column.width, alignment: .trailing)
                        .widthDetail()
                }
            }
        }
        .contextMenu { GoToPlayerItem(player: player.ref) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(LinkHint.player)
        .accessibilityAddTraits(.isLink)
        // The merged element keeps the row's press: VoiceOver opens the page.
        .accessibilityAction { navigator?.open(player.ref) }
    }

    private func value(_ key: String) -> String {
        if key == "age" { return player.age.map(String.init) ?? "–" }
        return player.stats[key] ?? "–"
    }

    /// "#77 · Guard", "#14 · QB · Sophomore", "#7 · England"; injuries lead.
    private var subtitle: Text {
        var parts: [String] = []
        if let jersey = player.jersey { parts.append("#\(jersey)") }
        switch sport {
        case .esports: if let real = player.detail { parts.append(real) }
        case .soccer:
            // The group already says the position.
            if let nation = player.detail { parts.append(nation) }
        default:
            if let pos = sport == .basketball ? player.positionName : player.position { parts.append(pos) }
            if let detail = player.detail { parts.append(detail) }
        }
        let base = Text(parts.joined(separator: " · "))
        if let injury = player.injury, group != .out, group != .injuredReserve {
            let status = (injury == "Day-To-Day" ? "Day-to-day" : injury) + (player.injuryReturn.map { " until \(Self.short($0))" } ?? "")
            return Text(status).fontWeight(.semibold).foregroundColor(.primary)
                + Text(parts.isEmpty ? "" : " · ") + base
        }
        return base
    }

    /// "late November" → "late Nov".
    static func short(_ s: String) -> String {
        let months = ["January": "Jan", "February": "Feb", "March": "Mar", "April": "Apr", "August": "Aug", "September": "Sep",
                      "October": "Oct", "November": "Nov", "December": "Dec"]
        return months.reduce(s) { $0.replacingOccurrences(of: $1.key, with: $1.value) }
    }

    /// "Jalen Brunson, number 11, Point Guard, 26.3 points, 6.1 assists":
    /// column codes as words ("PTS" isn't read as letters).
    private var accessibilityText: String {
        var parts = [player.ref.name]
        if let j = player.jersey { parts.append("number \(j)") }
        if let p = player.positionName ?? player.position { parts.append(p) }
        if let injury = player.injury { parts.append(injury == "Day-To-Day" ? "Day-to-day" : injury) }
        for c in columns where player.stats[c.key] != nil || c.key == "age" {
            let v = value(c.key)
            parts.append(v == "–" ? "no \(Self.spoken(c.label))" : c.key == "age" ? "age \(v)" : "\(v) \(Self.spoken(c.label))")
        }
        if let line = ProfileRosterColumns.statLine(player) { parts.append(Self.spokenLine(line)) }
        return parts.joined(separator: ", ")
    }

    /// A roster column's code in words.
    static func spoken(_ label: String) -> String {
        [
            "PTS": "points", "REB": "rebounds", "AST": "assists", "MIN": "minutes", "FG%": "field goal percentage",
            "ERA": "earned run average", "K": "strikeouts", "SV": "saves", "W": "wins", "WHIP": "walks and hits per inning",
            "AVG": "batting average", "HR": "home runs", "RBI": "runs batted in", "OPS": "on-base plus slugging",
            "APP": "appearances", "GA": "goals against", "G": "goals", "A": "assists", "SHOTS": "shots", "RATING": "rating",
        ][label] ?? label.lowercased()
    }

    /// "1,474 yds · 9 TD" → "1,474 yards, 9 touchdowns".
    static func spokenLine(_ line: String) -> String {
        line.replacingOccurrences(of: " · ", with: ", ")
            .replacingOccurrences(of: " yds", with: " yards").replacingOccurrences(of: " TD", with: " touchdowns")
            .replacingOccurrences(of: " rec", with: " receptions").replacingOccurrences(of: " tkl", with: " tackles")
            .replacingOccurrences(of: " sk", with: " sacks")
    }
}

/// A roster row redraws when its player, columns or group change.
extension RosterRow: @MainActor Equatable {
    static func == (a: Self, b: Self) -> Bool {
        a.player == b.player && a.columns == b.columns && a.group == b.group
    }
}

/// Static placeholder rows while the roster loads (no shimmer: a repeating
/// animation would keep running after the panel closes).
struct RosterSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(0..<6, id: \.self) { _ in
                HStack(spacing: 9) {
                    Circle().fill(Color.primary.opacity(0.07)).frame(width: 28, height: 28)
                    VStack(alignment: .leading, spacing: 4) {
                        RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.08)).frame(width: 120, height: 8)
                        RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.05)).frame(width: 70, height: 6)
                    }
                    Spacer()
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.06)).frame(width: 22, height: 8)
                    }
                }
            }
        }
        .padding(.top, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading the roster")
    }
}

// MARK: - Depth chart

/// NFL: each unit's slots in depth order. Starters in primary, backups in
/// secondary, each name a link; a list scans faster than a formation diagram.
struct DepthChartView: View {
    let chart: Profile.DepthChart
    let players: [String: Profile.RosterPlayer]
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(chart.units) { unit in
                ProfileGroupHeader(title: "\(unit.kind == .offense ? "Offense" : unit.kind == .defense ? "Defense" : "Special Teams") · \(unit.name)")
                ForEach(unit.slots) { slot in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(slot.label)
                            .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 30, alignment: .leading)
                        ViewThatFits(in: .horizontal) {
                            names(slot, limit: 3)
                            names(slot, limit: 2)
                            names(slot, limit: 1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 1)
                }
            }
        }
    }

    private func names(_ slot: Profile.DepthChart.Slot, limit: Int) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(slot.players.prefix(limit).enumerated()), id: \.offset) { i, p in
                if i > 0 { Text(" · ").foregroundStyle(.tertiary) }
                let player = players[p.id]
                QuietLink(help: "Go to \(p.name)", hint: LinkHint.player, action: { if let player { navigator?.open(player.ref) } }) {
                    HStack(spacing: 3) {
                        Text(Self.lastName(p.name))
                            .fontWeight(i == 0 ? .medium : .regular)
                            .foregroundStyle(i == 0 ? .primary : .secondary)
                        if let injury = player?.injury, ["Out", "Injured Reserve", "Doubtful"].contains(injury) {
                            Text("(\(injury == "Injured Reserve" ? "IR" : injury))").foregroundStyle(.secondary)
                        }
                    }
                }
                .fixedSize()
            }
        }
        .font(.system(size: 12))
    }

    /// "Kenneth Walker III" → "Walker III"; "Patrick Mahomes" → "Mahomes".
    static func lastName(_ name: String) -> String {
        let words = name.split(separator: " ")
        guard words.count > 1 else { return name }
        let suffixes: Set<String> = ["Jr.", "Sr.", "II", "III", "IV"]
        if let last = words.last, suffixes.contains(String(last)), words.count > 2 {
            return words.suffix(2).joined(separator: " ")
        }
        return words.dropFirst().joined(separator: " ")
    }
}

// MARK: - Leaders

struct LeadersGrid: View {
    let leaders: [Profile.TeamLeader]
    let tint: Color
    @Environment(\.widthClass) private var widthClass
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    var body: some View {
        RowGrid(columns: widthClass >= .large ? min(4, leaders.count) : 2, spacing: 4) {
            ForEach(leaders) { leader in
                RowLink(help: "Go to \(leader.player.name)", hint: LinkHint.player, action: { navigator?.open(leader.player) },
                        onDwell: { ProfileStore.shared.prefetch(leader.player) }) { hovering in
                    HStack(spacing: 9) {
                        PlayerPhoto(url: leader.player.photo, name: leader.player.name, tint: tint, size: 34)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(leader.label)
                                .font(.system(size: 9, weight: .semibold))
                                .tracking(0.3)
                                .foregroundStyle(.secondary)
                            Text(leader.value)
                                .font(.system(size: 17, weight: .semibold, design: .rounded).monospacedDigit())
                            Text(DepthChartView.lastName(leader.player.name))
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .linkName(hovering)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .contextMenu { GoToPlayerItem(player: leader.player) }
                .accessibilityLabel("\(leader.label): \(leader.player.name), \(leader.value)")
            }
        }
    }
}

// MARK: - Injuries, transactions, titles

struct InjuryRows: View {
    let players: [Profile.RosterPlayer]
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    var body: some View {
        StackColumn(spacing: 0) {
            ForEach(players) { p in
                RowLink(help: "Go to \(p.ref.name)", hint: LinkHint.player, action: { navigator?.open(p.ref) }) { hovering in
                    HStack(spacing: 6) {
                        Text(p.ref.name).font(.system(size: 12)).lineLimit(1).linkName(hovering)
                        Text(p.position ?? "").font(.system(size: 10.5)).foregroundStyle(.secondary)
                        Spacer(minLength: 6)
                        Text(p.injury == "Day-To-Day" ? "Day-to-day" : p.injury ?? "")
                            .font(.system(size: 11, weight: p.injury == "Out" ? .semibold : .regular))
                            .foregroundStyle(p.injury == "Out" ? .primary : .secondary)
                    }
                }
                .contextMenu { GoToPlayerItem(player: p.ref) }
            }
        }
    }
}

struct TransactionRows: View {
    let transactions: [Profile.Transaction]
    let sessionKey: String
    let store: ProfileStore

    var body: some View {
        let all = store.session[sessionKey]?.expanded.contains("transactions") == true
        StackColumn(spacing: 7) {
            ForEach(all ? transactions : Array(transactions.prefix(5))) { t in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(t.date.map(ProfileFormat.short) ?? "")
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 44, alignment: .leading)
                    Text(t.text)
                        .font(.system(size: 11.5))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .readableWidth()
            }
            if !all, transactions.count > 5 {
                ProfileMoreButton(title: "Show All (\(transactions.count))") {
                    store.session[sessionKey, default: .init()].expanded.insert("transactions")
                }
            }
        }
    }
}

struct TitleRows: View {
    let titles: [Profile.Title]

    var body: some View {
        StackColumn(spacing: 6) {
            ForEach(titles.prefix(5)) { t in
                HStack(spacing: 8) {
                    Image(systemName: "trophy").font(.system(size: 10)).foregroundStyle(.secondary).frame(width: 14)
                    Text(t.name).font(.system(size: 12)).lineLimit(1)
                    Spacer(minLength: 6)
                    Text(t.date.map { $0.formatted(.dateTime.month(.abbreviated).year()) } ?? "")
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Stat tiles

/// Headline numbers as tiles: the number is the chart. A rank caption only
/// when it means something (≤ 25th).
struct StatTiles: View {
    let tiles: [Profile.StatTile]
    var rankSuffix: String? = nil
    @Environment(\.widthClass) private var widthClass

    var body: some View {
        RowGrid(columns: max(1, min(4, tiles.count)), spacing: 6) {
            ForEach(tiles) { tile in
                VStack(alignment: .leading, spacing: 1) {
                    Text(tile.value)
                        .font(.system(size: 20, weight: .semibold, design: .rounded).monospacedDigit())
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(tile.label)
                        .font(.system(size: 9.5, weight: .semibold))
                        .tracking(0.3)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text(caption(tile) ?? " ")
                        .font(.system(size: 9.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel([tile.label, tile.value, caption(tile)].compactMap { $0 }.joined(separator: ", "))
            }
        }
    }

    private func caption(_ tile: Profile.StatTile) -> String? {
        guard let rank = tile.rank else { return nil }
        guard let rankSuffix, widthClass >= .medium, rank.first?.isNumber == true || rank.hasPrefix("T-") else { return rank }
        return "\(rank) \(rankSuffix)"
    }
}
