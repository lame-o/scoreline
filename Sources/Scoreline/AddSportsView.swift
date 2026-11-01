import SwiftUI

/// Browsing never subscribes. The star is the explicit follow action.
struct AddSportsView: View {
    @Environment(ScoreStore.self) private var store
    let onBack: () -> Void
    var backTitle = "Scores"
    var onOpenLeague: (League) -> Void = { _ in }
    var onOpenTeams: (League) -> Void = { _ in }
    @State private var sport: Sport?
    @State private var teams = false
    @State private var query = ""
    @State private var hoveredID: String?

    private var matches: [League] {
        League.catalog.filter {
            (sport == nil || $0.sport == sport) && (!teams || $0.source != .ifsc)
                && (query.trimmingCharacters(in: .whitespaces).isEmpty
                    || "\($0.name) \($0.sport.name) \(CompetitionCatalog.kind($0))".localizedCaseInsensitiveContains(query.trimmingCharacters(in: .whitespaces)))
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            PageHeader("Sports") { BackButton(title: backTitle, action: onBack) }.stackIn().pageChrome()
            PageScrollView {
                StackColumn {
                    HStack {
                        Picker("Sport", selection: $sport) {
                            Text("All sports").tag(Sport?.none)
                            ForEach(Sport.allCases) { Text($0.name).tag(Optional($0)) }
                        }
                        .frame(maxWidth: 180)
                        Spacer(minLength: 8)
                    }.padding(.horizontal, 12).padding(.top, 14)
                    Picker("Browse", selection: $teams) {
                        Text("Competitions").tag(false)
                        Text("Teams").tag(true)
                    }.pickerStyle(.segmented).labelsHidden().padding(.horizontal, 12)
                    TextField("Search competitions", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 12)
                    Text(teams ? "Choose a competition to find its teams. Team follows include all competitions." : "Open any competition to explore. Following adds its matches to Scores; alerts are separate.")
                        .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).padding(.horizontal, 16)
                    ForEach(Sport.allCases) { sport in
                        let leagues = matches.filter { $0.sport == sport }
                        if !leagues.isEmpty {
                            GroupLabel(title: sport.name, symbol: sport.symbol).padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 5)
                            GroupBox { ForEach(leagues) { catalogRow($0) } }
                        }
                    }
                    if matches.isEmpty { Text("No competitions match your search.").font(.system(size: 12)).foregroundStyle(.secondary).padding(16) }
                }.formColumn().padding(.bottom, 12)
            }
        }
    }
    private func catalogRow(_ league: League) -> some View {
        HStack(spacing: 8) {
            Button { teams ? onOpenTeams(league) : onOpenLeague(league) } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(league.name).font(.system(size: 13))
                        Text(teams ? "Browse teams" : CompetitionCatalog.kind(league)).font(.system(size: 10.5)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(Glyph.row).foregroundStyle(.tertiary).accessibilityHidden(true)
                }.padding(.vertical, 7).padding(.leading, 12)
            }.buttonStyle(ListRowStyle(hovering: hoveredID == league.id)).onHover { hoveredID = $0 ? league.id : nil }
            if !teams {
                Button { store.setEnabled(league, !store.isEnabled(league)) } label: {
                    Image(systemName: store.isEnabled(league) ? "star.fill" : "star").font(.system(size: 13))
                        .foregroundStyle(store.isEnabled(league) ? Color.accentColor : .secondary).frame(width: 30, height: 30)
                }.buttonStyle(.plain).help("\(store.isEnabled(league) ? "Unfollow" : "Follow") \(league.name)")
                    .accessibilityLabel("\(store.isEnabled(league) ? "Unfollow" : "Follow") \(league.name)")
            }
        }.padding(.trailing, 8)
    }
}
