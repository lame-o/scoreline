#if DEBUG
import SwiftUI

// A standalone page of tiles for the offscreen render harness: the store's
// board as Tiles would show it, then every game in every size it can take,
// then any extra samples (recorded or synthetic edge cases). Debug builds only.

struct TileSample: Identifiable {
    let id: String
    /// What the tile demonstrates ("Soccer, own goal").
    let title: String
    let event: Event
    let size: TileSize
    var league: League?
    var pinned = false
    var followed: Set<String> = []
    var countries: [String] = []
}

struct TilesGallery: View {
    let store: ScoreStore
    var extra: [TileSample] = []
    var showsBoard = true
    @Environment(\.panelLayout) private var layout

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsBoard {
                TileBoard()
            }
            let samples = storeSamples + extra
            section("Large", samples.filter { $0.size == .large }, columns: TileMetrics.largeColumns(layout))
            section("Small", samples.filter { $0.size == .small }, columns: TileMetrics.smallColumns(layout))
        }
        .padding(.bottom, 12)
        .environment(store)
    }

    /// Every game the store has, in each size its state allows.
    private var storeSamples: [TileSample] {
        let board = store.board
        return board.tiers.flatMap { tier in
            tier.events.flatMap { event -> [TileSample] in
                let league = board.league[event.id]
                var sizes: [TileSize] = [.small]
                if event.state == .live || (event.state == .scheduled && event.start < .now + 24 * 3600) {
                    sizes.insert(.large, at: 0)
                }
                return sizes.map { size in
                    TileSample(id: "\(event.id)|\(size)", title: "\(league?.shortName ?? "") · \(tier.title)",
                               event: event, size: size, league: league, pinned: store.pinnedID == event.id,
                               followed: Set(event.competitors.compactMap(\.id).filter { id in store.followed.contains { $0.id == id } }),
                               countries: store.climbingCountries)
                }
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, _ samples: [TileSample], columns: Int) -> some View {
        if !samples.isEmpty {
            GroupLabel(title: "\(title) · \(samples.count)", symbol: "square.grid.2x2")
                .padding(.horizontal, Metrics.gutter)
                .padding(.top, 16)
                .padding(.bottom, 6)
            RowGrid(columns: columns, spacing: TileMetrics.gap) {
                ForEach(samples) { sample in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(sample.title)
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                            .padding(.leading, 4)
                        EventTile(event: sample.event, size: sample.size, league: sample.league, pinned: sample.pinned,
                                  followed: sample.followed, countries: sample.countries)
                            .frame(height: sample.size == .large ? TileMetrics.largeHeight : TileMetrics.smallHeight)
                    }
                }
            }
            .padding(.horizontal, TileMetrics.gutter)
        }
    }
}
#endif
