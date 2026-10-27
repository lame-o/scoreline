import AppKit
import SwiftUI

// Results, row by row: the words a finished game adds (status lines, the
// caption's red-card glyph, tooltip, copy), the round picker, a team's form
// strip and season card, and the team's-eye result row. Every string a row
// shows was built by the parser (`ResultDetail`); these only lay it out.

// MARK: - Words

enum ResultText {
    /// A caption with ESPN's red card drawn as the card itself: the parser
    /// writes "▮ Palmer 80'", the row shows a small red card. Plain text
    /// otherwise (one `Text`, no work).
    static func caption(_ text: String) -> Text {
        guard text.contains(redCard) else { return Text(text) }
        let parts = text.components(separatedBy: redCard)
        var out = Text(parts[0])
        for part in parts.dropFirst() {
            out = out + Text(Image(systemName: "rectangle.portrait.fill")).font(.system(size: 7)).foregroundColor(.red)
                + Text(part)
        }
        return out
    }

    /// The parser's red-card mark (`ResultLine.redCard`).
    static var redCard: String { ResultLine.redCard }

    /// "36,743"
    static func attendance(_ r: ResultDetail) -> String? {
        guard let a = r.attendance, a > 0 else { return nil }
        return a.formatted(.number.grouping(.automatic))
    }

    /// The row's tooltip: when it started, where, who came, the recap's
    /// headline, and the details in full (the row may truncate them).
    static func tooltip(_ item: ScheduleItem) -> String {
        var parts: [String] = []
        if let date = item.start.date {
            let verb = switch item.sport {
            case .soccer, .football: "Kicked off"
            case .basketball: "Tipped off"
            case .baseball: "First pitch"
            default: "Started"
            }
            parts.append("\(verb) \(date.formatted(date: .omitted, time: .shortened))")
        }
        if let venue = item.venue { parts.append(venue.replacingOccurrences(of: " · ", with: ", ")) }
        if let r = item.result {
            if let a = attendance(r) { parts.append(a) }
            if let h = r.headline { parts.append(h) }
        }
        var lines = [parts.joined(separator: " · ")]
        if let r = item.result {
            // In full: the row may have truncated either.
            if let c = r.context { lines.append(c) }
            if let d = r.detailsWide ?? r.details { lines.append(d.replacingOccurrences(of: redCard + " ", with: "Red card: ")) }
        }
        return lines.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    /// Copy: "AVL 2–1 MNC · FT · Jackson 6', 60' · Haaland 52'".
    static func copy(_ item: ScheduleItem) -> String {
        var parts = [ScheduleSpeech.result(item)]
        if let r = item.result {
            parts.append([r.label, r.secondLine].compactMap { $0 }.joined(separator: " "))
            if let c = r.context { parts.append(c) }
            if let d = r.details { parts.append(d.replacingOccurrences(of: redCard + " ", with: "Red card ")) }
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

// MARK: - A team's side of a result

/// One result read from a team's side: "W 2–0 vs Everton". Pure: tested.
struct TeamResult: Equatable {
    /// "W", "D", "L", "T"; nil when there's no result to read.
    let letter: String?
    /// "2–0", the team's score first; nil for a forfeit.
    let score: String?
    let home: Bool
    let opponent: ScheduleTeam?
    /// "(P)" after a shootout.
    let shootout: Bool

    init(_ item: ScheduleItem, team: String) {
        let mine = item.teams.first { $0.id == team }
        let other = item.teams.first { $0.id != team } ?? (mine == nil ? nil : item.teams.last)
        opponent = other
        // Soccer lists the home side first; everyone else the away side first.
        home = item.sport == .soccer ? item.top?.id == team : item.bottom?.id == team
        shootout = item.result?.kind == .penalties
        guard item.status == .final, let mine, let other else {
            letter = nil
            score = nil
            return
        }
        if item.result?.kind == .forfeit {
            letter = mine.winner ? "W" : other.winner ? "L" : nil
            score = nil
            return
        }
        // No score, no result to read (a final the source sent bare).
        guard let a = mine.score, let b = other.score else {
            letter = nil
            score = nil
            return
        }
        letter = mine.winner ? "W" : other.winner ? "L" : (item.sport == .soccer ? "D" : "T")
        score = "\(a)–\(b)"
    }

    /// "won 2 to 0", "lost 1 to 3", "drew 2 to 2".
    var spoken: String? {
        guard let letter else { return nil }
        let word = ["W": "won", "L": "lost", "D": "drew", "T": "tied"][letter] ?? letter
        return [word, score?.replacingOccurrences(of: "–", with: " to ")].compactMap { $0 }.joined(separator: " ")
    }
}

// MARK: - Round picker

/// "‹ Matchweek 8 · Oct 23–25 ⌄ ›": the season's played rounds, newest
/// first in the menu, sectioned ("2026–27"; a cup's stages; Regular Season
/// and Postseason). ‹ is always the past. Stepping never animates.
struct RoundPicker: View {
    let rounds: [ResultRound]
    let selected: ResultRound.ID?
    let onSelect: (ResultRound.ID) -> Void
    let onStep: (Int) -> Void

    var body: some View {
        // The store keeps rounds oldest first.
        let ordered = rounds
        let index = ordered.firstIndex { $0.id == selected }
        let round = index.map { ordered[$0] }
        PeriodPicker(title: round?.title ?? "Results", detail: round?.detail,
                     sections: Self.sections(ordered), selected: selected,
                     previousEnabled: (index ?? 0) > 0, nextEnabled: index.map { $0 < ordered.count - 1 } ?? false,
                     noun: "round", onSelect: onSelect, onPrevious: { onStep(-1) }, onNext: { onStep(1) })
            .accessibilityElement(children: .contain)
    }

    /// Newest first: sections by their newest round, rounds newest first inside.
    static func sections(_ ordered: [ResultRound]) -> [(title: String, options: [PeriodPicker.Option])] {
        var order: [String] = []
        var bySection: [String: [ResultRound]] = [:]
        for r in ordered.reversed() {
            let key = r.section ?? ""
            if bySection[key] == nil { order.append(key) }
            bySection[key, default: []].append(r)
        }
        return order.map { key in
            (key, (bySection[key] ?? []).map { PeriodPicker.Option(id: $0.id, title: $0.title, detail: $0.detail) })
        }
    }
}

// MARK: - Form strip

/// A team's last results as letters in ink: W filled, D tinted, L outlined,
/// oldest on the left. Weight carries the outcome (the house "loser dims"),
/// the letter carries its name, and red stays reserved for live. Hovering a
/// mark rings it and names the game in the readout; clicking opens it.
struct FormStrip: View {
    let marks: [FormMark]
    /// The pointed-at mark's item ID: one reference, so a hover redraws the strip only.
    let hover: HighlightState
    var onOpen: ((String) -> Void)? = nil
    @Environment(\.colorSchemeContrast) private var contrast

    static let cell: CGFloat = 16
    static let gap: CGFloat = 3

    var body: some View {
        // Each mark's hit area takes half the gap on either side: the pointer
        // never falls between marks, and the layout is the same 16 + 3.
        HStack(spacing: 0) {
            ForEach(Array(marks.enumerated()), id: \.offset) { _, mark in
                HighlightGate(state: hover, id: mark.itemID) { lit in
                    FormMarkView(mark: mark, lit: lit, strong: contrast == .increased) {
                        onOpen?(mark.itemID)
                    }
                    .onHover { inside in
                        if inside { hover.id = mark.itemID } else if hover.id == mark.itemID { hover.id = nil }
                    }
                }
            }
        }
        .padding(.horizontal, -Self.gap / 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Form, last \(marks.count), oldest to newest")
    }
}

private struct FormMarkView: View {
    let mark: FormMark
    let lit: Bool
    let strong: Bool
    let action: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 4, style: .continuous)
        Button(action: action) {
            Text(mark.letter)
                .font(.system(size: 9.5, weight: .semibold).monospaced())
                .foregroundStyle(ink)
                .frame(width: FormStrip.cell, height: FormStrip.cell)
                .background(shape.fill(fill))
                .overlay(shape.strokeBorder(Color.primary.opacity(strong ? 0.45 : 0.28), lineWidth: mark.letter == "L" ? 1 : 0))
                // The pointed-at mark: an accent ring just outside it (instant, no animation).
                .overlay(shape.inset(by: -2).strokeBorder(Color.accentColor, lineWidth: 1.5).opacity(lit ? 1 : 0))
                .padding(.horizontal, FormStrip.gap / 2)
                .contentShape(Rectangle())
        }
        .buttonStyle(MarkPressStyle())
        .help(mark.readout)
        .accessibilityLabel(mark.spoken)
    }

    /// A small target confirms the press: it gives a little, quickly.
    private struct MarkPressStyle: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            configuration.label
                .scaleEffect(configuration.isPressed ? 0.94 : 1)
                .animation(Motion.press, value: configuration.isPressed)
        }
    }

    private var fill: Color {
        switch mark.letter {
        case "W": Color.primary.opacity(0.78)
        case "D", "T": Color.primary.opacity(strong ? 0.20 : 0.12)
        default: .clear
        }
    }

    private var ink: AnyShapeStyle {
        switch mark.letter {
        // Inverted: the panel's own ink on the filled mark.
        case "W": AnyShapeStyle(Color(nsColor: .windowBackgroundColor))
        case "L": AnyShapeStyle(.secondary)
        default: AnyShapeStyle(.primary)
        }
    }
}

/// The readout beside or under a form strip: the pointed-at game, else the
/// latest. Reads the hover itself, so pointing redraws this line only.
struct FormReadout: View {
    let marks: [FormMark]
    let hover: HighlightState
    var fallsBackToLatest = true

    var body: some View {
        let mark = marks.first { $0.itemID == hover.id } ?? (fallsBackToLatest ? marks.last : nil)
        Text(mark?.readout ?? "")
            .font(.system(size: 10.5).monospacedDigit())
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .accessibilityHidden(true)
    }
}

// MARK: - Team season card

/// A team's season at a glance: record and standing, the count of games
/// and outcomes, goals (points, runs) for and against, and the form strip.
struct TeamSeasonCard: View {
    let season: TeamSeason
    var sport: Sport? = nil
    var onOpen: ((String) -> Void)? = nil
    @State private var hover = HighlightState()

    private var resolvedSport: Sport? { sport ?? season.results.first?.sport }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 7) {
                LogoView(url: season.team.logo, size: 16)
                Text("\(season.team.name) · \(season.season)")
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            if let line = standingLine {
                Text(line).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            }
            Text(countsLine)
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .accessibilityLabel(spokenCounts)
            if let line = scoredLine {
                Text(line).font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
            }
            if !season.form.isEmpty {
                HStack(alignment: .center, spacing: 8) {
                    Text("Form")
                        .textCase(.uppercase)
                        .font(.system(size: 9.5, weight: .semibold))
                        .tracking(0.4)
                        .foregroundStyle(.secondary)
                        .accessibilityHidden(true)
                    FormStrip(marks: Array(season.form.suffix(5)), hover: hover, onOpen: onOpen)
                }
                .padding(.top, 4)
                // The strip's footer: the pointed-at game, else the newest.
                FormReadout(marks: Array(season.form.suffix(5)), hover: hover)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(0.045)))
    }

    /// "7–0–1 · 2nd in Premier League"; a past season's computed record alone.
    private var standingLine: String? {
        [season.record.map(RowText.record), season.isCurrent ? season.standing : nil].compactMap { $0 }
            .joined(separator: " · ").nilIfEmpty
    }

    /// "All competitions  13 played · W 11 · D 1 · L 1"
    private var countsLine: String {
        var parts = ["\(season.played) played", "W \(season.won)"]
        if resolvedSport == .soccer || season.drawn > 0 { parts.append("\(resolvedSport == .soccer ? "D" : "T") \(season.drawn)") }
        parts.append("L \(season.lost)")
        let counts = parts.joined(separator: " · ")
        return resolvedSport == .soccer ? "All competitions  \(counts)" : counts
    }

    private var spokenCounts: String {
        let draws = resolvedSport == .soccer ? "drawn" : "tied"
        return "\(season.played) played, \(season.won) won, \(season.drawn > 0 || resolvedSport == .soccer ? "\(season.drawn) \(draws), " : "")\(season.lost) lost"
    }

    /// "Goals 26–9", "Points 212–150", "Runs 712–650".
    private var scoredLine: String? {
        guard let f = season.scoredFor, let a = season.scoredAgainst, season.played > 0 else { return nil }
        let noun = switch resolvedSport {
        case .soccer: "Goals"
        case .baseball: "Runs"
        case .esports: "Maps"
        default: "Points"
        }
        return "\(noun) \(f)–\(a)"
    }
}

// MARK: - Team result row

/// A result from the team's side, as the player page's game log reads:
/// date, opponent crest, "vs Everton" / "at Bayern", and "W 2–0"; a second
/// line names the competition and the game's details.
struct TeamResultRow: View {
    let item: ScheduleItem
    let team: String
    var details = true
    var showsCompetition = true
    let highlighted: Bool
    var keyboard = false
    let onHover: (Bool) -> Void
    let onSelect: (ScheduleItem) -> Void

    var body: some View {
        let r = TeamResult(item, team: team)
        Button { onSelect(item) } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(item.day.shortLabel)
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 42, alignment: .leading)
                    LogoView(url: r.opponent?.logo, size: 14)
                    Text("\(r.home ? "vs" : "at") \(r.opponent?.name ?? "TBD")")
                        .font(.system(size: 12))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 6)
                    trailing(r)
                }
                if let line = secondLine {
                    ResultText.caption(line)
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.leading, 48)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: highlighted, inset: 0, keyboard: keyboard))
        .padding(.horizontal, 6)
        .onHover(perform: onHover)
        .help(ResultText.tooltip(item))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(r))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(LinkHint.match)
        .accessibilityAction { onSelect(item) }
    }

    @ViewBuilder
    private func trailing(_ r: TeamResult) -> some View {
        if item.status == .postponed || item.status == .canceled {
            Text(item.result?.label ?? (item.status == .canceled ? "Canceled" : "Postponed"))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(item.status == .canceled ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.orange))
        } else if let letter = r.letter {
            let lost = letter == "L"
            (Text(letter).fontWeight(.semibold)
                + Text(r.score.map { " \($0)" } ?? "")
                + Text(r.shootout ? " (P)" : "").foregroundColor(.secondary))
                .font(.system(size: 11.5).monospacedDigit())
                .foregroundStyle(lost ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                .lineLimit(1)
                .fixedSize()
        } else {
            Text(item.result?.label ?? item.statusDetail ?? "")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }

    /// "Premier League · Konsa 7', Magalhães 68'": the competition, then
    /// the knockout context, else the details.
    private var secondLine: String? {
        let story = item.result?.context ?? (details ? item.result?.details : nil)
        return [showsCompetition ? item.competition : nil, story].compactMap { $0 }.joined(separator: " · ").nilIfEmpty
    }

    private func spoken(_ r: TeamResult) -> String {
        var parts = [item.day.displayDate.formatted(.dateTime.month(.wide).day())]
        if let o = r.opponent { parts.append("\(r.home ? "versus" : "at") \(o.name)") }
        if let s = r.spoken { parts.append(s + (r.shootout ? " after penalties" : "")) }
        if item.status == .postponed { parts.append("postponed") }
        if let line = secondLine { parts.append(line.replacingOccurrences(of: ResultText.redCard + " ", with: "red card ")) }
        return parts.joined(separator: ", ")
    }
}

extension TeamResultRow: @MainActor Equatable {
    static func == (a: TeamResultRow, b: TeamResultRow) -> Bool {
        a.item == b.item && a.team == b.team && a.details == b.details && a.showsCompetition == b.showsCompetition
            && a.highlighted == b.highlighted && a.keyboard == b.keyboard
    }
}
