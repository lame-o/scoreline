import SwiftUI

// The schedule's sticky date: a week strip (days), a week picker (NFL,
// college) or a month bar (teams), in the page chrome under the header. It
// follows the scroll (the day at the top of the agenda is selected) and jumps
// when clicked. Pinned headers inside the list would put a material on the
// glass panel; the chrome sits outside the scroll view instead.

// MARK: - Week strip

struct WeekStrip: View {
    enum Dot: Int, Comparable {
        case games, followed, live
        static func < (a: Dot, b: Dot) -> Bool { a.rawValue < b.rawValue }
    }

    let days: [DayKey]
    let today: DayKey
    /// The day at the top of the agenda.
    let selected: DayKey?
    let dots: [DayKey: Dot]
    let onSelect: (DayKey) -> Void
    let onPrevious: () -> Void
    let onNext: () -> Void
    /// Days that can be picked (Results: days with a result; later days can't).
    var enabled: (DayKey) -> Bool = { _ in true }
    @Environment(\.colorSchemeContrast) private var contrast

    private var monthLabel: String {
        guard let first = days.first, let last = days.last else { return "" }
        let a = first.displayDate.formatted(.dateTime.month(.wide)), b = last.displayDate.formatted(.dateTime.month(.wide))
        let year = String(last.year)
        return (a == b ? "\(a) \(year)" : "\(first.displayDate.formatted(.dateTime.month(.abbreviated))) – \(last.displayDate.formatted(.dateTime.month(.abbreviated))) \(year)").uppercased()
    }

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 2) {
                Text(monthLabel)
                    .font(.system(size: 10.5, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(.secondary)
                Spacer()
                StripArrow(symbol: "chevron.left", help: "Previous week", action: onPrevious)
                StripArrow(symbol: "chevron.right", help: "Next week", action: onNext)
            }
            .padding(.leading, Metrics.gutter)
            .padding(.trailing, 8)
            HStack(spacing: 0) {
                ForEach(days, id: \.self) { day in
                    DayCell(day: day, today: today, selected: day == selected, dot: dots[day], contrast: contrast,
                            enabled: enabled(day)) { onSelect(day) }
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 8)
        }
        .padding(.bottom, 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Week")
    }
}

private struct DayCell: View {
    let day: DayKey
    let today: DayKey
    let selected: Bool
    let dot: WeekStrip.Dot?
    let contrast: ColorSchemeContrast
    var enabled = true
    let action: () -> Void
    @State private var hovering = false

    private var ink: AnyShapeStyle {
        if !enabled { return contrast == .increased ? AnyShapeStyle(.secondary) : AnyShapeStyle(.quaternary) }
        if day == today { return AnyShapeStyle(Color.accentColor) }
        return day < today ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary)
    }

    var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Text(day.displayDate.formatted(.dateTime.weekday(.narrow)))
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
                Text("\(day.day)")
                    .font(.system(size: 13, weight: day == today ? .semibold : .regular).monospacedDigit())
                    .foregroundStyle(ink)
                Circle()
                    .fill(dotColor)
                    .frame(width: 4, height: 4)
                    .opacity(dot == nil ? 0 : 1)
            }
            .padding(.vertical, 4)
            .frame(maxWidth: 40)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(Color.primary.opacity(selected ? 0.10 : hovering ? 0.05 : 0))
                    .frame(maxWidth: 40)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .onHover { hovering = $0 && enabled }
        .help(day.longLabel)
        .accessibilityLabel(day.longLabel + (dot == nil ? ", no games" : ""))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private var dotColor: Color {
        switch dot {
        case .live: .red
        case .followed: .accentColor
        default: Color.primary.opacity(contrast == .increased ? 0.7 : 0.4)
        }
    }
}

struct StripArrow: View {
    let symbol: String
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .frame(width: 22, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle(hovering: hovering, cornerRadius: 5))
        .foregroundStyle(.secondary)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

// MARK: - Period picker (weeks, rounds)

/// "‹  Week 8  Oct 28 – Nov 3 ⌄  ›": a period of the season, the ones on
/// either side, and a sectioned menu of all of them. Shared by the football
/// week picker (Upcoming) and the round picker (Results).
struct PeriodPicker: View {
    struct Option: Identifiable, Hashable {
        let id: String
        let title: String
        let detail: String
    }

    let title: String
    let detail: String?
    /// Menu sections, in order, each with its options in order.
    let sections: [(title: String, options: [Option])]
    let selected: String?
    var previousEnabled = true
    var nextEnabled = true
    /// "week", "round": the arrows' help ("Previous week") and spoken names.
    var noun = "week"
    let onSelect: (String) -> Void
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            StripArrow(symbol: "chevron.left", help: "Previous \(noun)", action: onPrevious)
                .disabled(!previousEnabled)
            Spacer(minLength: 4)
            Menu {
                ForEach(sections.indices, id: \.self) { i in
                    Section(sections[i].title) {
                        ForEach(sections[i].options) { o in
                            Button {
                                onSelect(o.id)
                            } label: {
                                let text = o.detail.isEmpty || o.detail == o.title ? o.title : "\(o.title) · \(o.detail)"
                                if o.id == selected { Label(text, systemImage: "checkmark") } else { Text(text) }
                            }
                        }
                    }
                }
            } label: {
                // A long round ("Round of 16 · 2nd legs") drops its dates
                // before its name truncates; the panel never widens for it.
                ViewThatFits(in: .horizontal) {
                    label(showsDetail: true)
                    label(showsDetail: false)
                }
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize(horizontal: false, vertical: true)
            .help("Choose a \(noun)")
            .accessibilityLabel([title, detail].compactMap { $0 }.joined(separator: ", "))
            .accessibilityHint("Choose a \(noun)")
            Spacer(minLength: 4)
            StripArrow(symbol: "chevron.right", help: "Next \(noun)", action: onNext)
                .disabled(!nextEnabled)
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
    }

    private func label(showsDetail: Bool) -> some View {
        HStack(spacing: 5) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .truncationMode(.tail)
            if showsDetail, let detail, !detail.isEmpty, detail != title {
                Text(detail.replacingOccurrences(of: "-", with: " – "))
                    .font(.system(size: 12).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }
            Image(systemName: "chevron.down")
                .font(Glyph.link)
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .lineLimit(1)
    }
}

// MARK: - Week picker (NFL, college)

struct WeekPicker: View {
    let week: ScheduleCalendar.Week?
    let weeks: [ScheduleCalendar.Week]
    let onSelect: (ScheduleCalendar.Week) -> Void

    private func index(_ w: ScheduleCalendar.Week?) -> Int? { w.flatMap { weeks.firstIndex(of: $0) } }

    var body: some View {
        PeriodPicker(title: week?.label ?? "Week", detail: week?.detail,
                     sections: groupedWeeks.map { title, list in
                         (title, list.map { PeriodPicker.Option(id: $0.id, title: $0.label, detail: $0.detail) })
                     },
                     selected: week?.id,
                     previousEnabled: (index(week) ?? 0) > 0,
                     nextEnabled: (index(week) ?? weeks.count) < weeks.count - 1,
                     onSelect: { id in if let w = weeks.first(where: { $0.id == id }) { onSelect(w) } },
                     onPrevious: { if let i = index(week), i > 0 { onSelect(weeks[i - 1]) } },
                     onNext: { if let i = index(week), i + 1 < weeks.count { onSelect(weeks[i + 1]) } })
    }

    private var groupedWeeks: [(String, [ScheduleCalendar.Week])] {
        let names = [1: "Preseason", 2: "Regular Season", 3: "Postseason"]
        return [1, 2, 3, 4].compactMap { type in
            let list = weeks.filter { $0.seasonType == type }
            return list.isEmpty ? nil : (names[type] ?? "Off Season", list)
        }
    }
}

// MARK: - Month bar (teams)

struct MonthBar: View {
    /// The month of the day at the top of the agenda.
    let month: DayKey?
    /// "Chiefs · 5–0 · 1st in AFC West"
    var summary: String?
    let onPrevious: () -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(spacing: 1) {
            HStack(spacing: 2) {
                StripArrow(symbol: "chevron.left", help: "Previous month", action: onPrevious)
                Spacer(minLength: 4)
                Text(month.map { $0.displayDate.formatted(.dateTime.month(.wide).year()) } ?? " ")
                    .font(.system(size: 13, weight: .semibold))
                    .contentTransition(.identity)
                Spacer(minLength: 4)
                StripArrow(symbol: "chevron.right", help: "Next month", action: onNext)
            }
            if let summary {
                Text(summary)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
    }
}

// MARK: - Scope chips

/// "All · ★ Your Teams · Arsenal · Chiefs": switches the page in place.
struct ScheduleChips: View {
    struct Chip: Identifiable, Hashable {
        let scope: ScheduleScope
        let title: String
        var symbol: String? = nil
        /// Opens another page (a league's own schedule) instead of filtering this one.
        var drills = false
        var id: String { scope.memoryKey }
    }

    let chips: [Chip]
    let selected: ScheduleScope
    let onSelect: (ScheduleScope) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(chips) { chip in
                    // Filters, then (after a hairline) leagues to open.
                    if chip.drills, chip.id == chips.first(where: \.drills)?.id, chip.id != chips.first?.id {
                        Divider().frame(height: 14).padding(.horizontal, 2)
                    }
                    ChipButton(chip: chip, selected: chip.scope == selected) { onSelect(chip.scope) }
                }
            }
            .padding(.horizontal, Metrics.gutter)
        }
        .scrollIndicators(.never)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .padding(.top, 4)
        .padding(.bottom, 2)
    }
}

private struct ChipButton: View {
    let chip: ScheduleChips.Chip
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let symbol = chip.symbol {
                    Image(systemName: symbol).font(.system(size: 8.5, weight: .bold)).foregroundStyle(selected ? Color.yellow : .secondary)
                }
                Text(chip.title)
                if chip.drills {
                    Image(systemName: "chevron.right").font(Glyph.link).foregroundStyle(.tertiary).accessibilityHidden(true)
                }
            }
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(selected ? .primary : .secondary)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(Capsule().fill(Color.primary.opacity(selected ? 0.12 : hovering ? 0.08 : 0.05)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(chip.drills ? "\(chip.title) schedule" : chip.title)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - Scroll-spy

/// Which day is at the top of the agenda. Each day header reports one Bool
/// (above the line or not), only when it flips; the page re-renders only
/// when the answer changes: at most once per day scrolled past.
@MainActor
final class ScrollSpy {
    nonisolated static let space = "schedule.viewport"
    private var above: Set<DayKey> = []

    /// The latest day whose header has passed the top, else nil.
    func report(_ day: DayKey, above isAbove: Bool) -> DayKey? {
        if isAbove { above.insert(day) } else { above.remove(day) }
        return above.max()
    }

    func reset() { above.removeAll() }
}
