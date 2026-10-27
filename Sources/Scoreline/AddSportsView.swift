import SwiftUI

/// The full league catalog, one level below Settings. Click a row to add or
/// remove a league; it joins the end of "Your Sports".
struct AddSportsView: View {
    @Environment(ScoreStore.self) private var store
    let onBack: () -> Void
    @State private var hoveredID: String?

    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Add Sports") { BackButton(title: "Settings", action: onBack) }
                .stackIn()
                .pageChrome()

            PageScrollView {
                StackColumn {
                    ForEach(Sport.allCases) { sport in
                        GroupLabel(title: sport.name, symbol: sport.symbol)
                            .padding(.horizontal, 16)
                            .padding(.top, 14)
                            .padding(.bottom, 5)
                        GroupBox {
                            ForEach(League.catalog.filter { $0.sport == sport }) { league in
                                catalogRow(league)
                            }
                        }
                    }
                }
                // One centred column, like every settings page.
                .formColumn()
                .padding(.bottom, 12)
            }
        }
    }

    private func catalogRow(_ league: League) -> some View {
        let added = store.isEnabled(league)
        return Button {
            withAnimation(Motion.quick) { store.setEnabled(league, !added) }
        } label: {
            HStack(spacing: 8) {
                Text(league.name).font(.system(size: 13))
                Spacer()
                Image(systemName: added ? "checkmark.circle.fill" : "plus.circle")
                    .font(.system(size: 14))
                    .foregroundStyle(added ? Color.accentColor : Color.secondary.opacity(0.6))
                    .contentTransition(.symbolEffect(.replace))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        }
        .buttonStyle(ListRowStyle(hovering: hoveredID == league.id))
        .onHover { inside in
            if inside { hoveredID = league.id } else if hoveredID == league.id { hoveredID = nil }
        }
        .accessibilityLabel(league.name)
        .accessibilityValue(added ? "Added" : "Not added")
        .help(added ? "Remove \(league.name)" : "Add \(league.name)")
    }
}
