import SwiftUI

// The Tiles landing view: the list's games regrouped by state (Live, Your
// Teams, Up Next, Final), each tier a grid of large tiles then small ones.
// Column counts come from the coarse panel layout; exact widths are read
// only inside `TileGrid`, so a live resize re-runs arithmetic, never a body.

enum TileMetrics {
    /// Same inset as the match page's hero card.
    static let gutter: CGFloat = 10
    /// Between tiles, both axes.
    static let gap: CGFloat = 8
    static let radius: CGFloat = 12
    /// Fixed, so live updates never move the grid.
    static let smallHeight: CGFloat = 84
    static let largeHeight: CGFloat = 144
    /// 34 = the match page's hero crest, so the decoded image is shared.
    static let crestSmall: CGFloat = 28
    static let crestLarge: CGFloat = 34
    static let padSmall = EdgeInsets(top: 9, leading: 10, bottom: 9, trailing: 10)
    static let padLarge = EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    /// A large tile's face-off never spreads wider than this, centered.
    static let faceOffMax: CGFloat = 360
    static let stripHeight: CGFloat = 28

    /// Never one small column: that would be the list with borders.
    static func smallColumns(_ layout: PanelLayout) -> Int { layout.split ? 4 : (layout.page >= .large ? 3 : 2) }
    static func largeColumns(_ layout: PanelLayout) -> Int { layout.split ? 2 : 1 }
    /// Live games shown large: enough to stay glanceable on a 13-game Sunday.
    static func largeBudget(columns: Int) -> Int { columns >= 2 ? 6 : 4 }
}

enum TileSize: Sendable, Hashable { case large, small }

struct TileSizeKey: LayoutValueKey {
    static let defaultValue = TileSize.small
}

// MARK: - Grid

/// One tier: a band of large tiles, then a band of small ones, each in equal
/// columns with a fixed row height. When the large band has two columns and
/// an odd count, its first tile spans the row (no holes). The same children
/// whatever the columns, so a tile that changes band keeps its identity.
struct TileGrid: Layout {
    var largeColumns: Int
    var smallColumns: Int
    var spacing: CGFloat = TileMetrics.gap

    /// Pure placement, shared by sizing and placing (and the tests).
    static func frames(sizes: [TileSize], width: CGFloat, largeColumns: Int, smallColumns: Int,
                       spacing: CGFloat = TileMetrics.gap) -> (frames: [CGRect], height: CGFloat) {
        var frames = Array(repeating: CGRect.zero, count: sizes.count)
        var y: CGFloat = 0
        func band(_ indices: [Int], columns: Int, height: CGFloat, heroFirst: Bool) {
            guard !indices.isEmpty else { return }
            let columns = max(columns, 1)
            var rest = indices[...]
            if heroFirst, let first = rest.first {
                frames[first] = CGRect(x: 0, y: y, width: width, height: height)
                y += height + spacing
                rest = rest.dropFirst()
            }
            let cell = (width - spacing * CGFloat(columns - 1)) / CGFloat(columns)
            for (n, i) in rest.enumerated() {
                let column = n % columns
                if column == 0 && n > 0 { y += height + spacing }
                frames[i] = CGRect(x: CGFloat(column) * (cell + spacing), y: y, width: cell, height: height)
            }
            if !rest.isEmpty { y += height + spacing }
        }
        let large = sizes.indices.filter { sizes[$0] == .large }
        let small = sizes.indices.filter { sizes[$0] == .small }
        band(large, columns: largeColumns, height: TileMetrics.largeHeight,
             heroFirst: largeColumns >= 2 && large.count % 2 == 1)
        band(small, columns: smallColumns, height: TileMetrics.smallHeight, heroFirst: false)
        return (frames, max(0, y - (sizes.isEmpty ? 0 : spacing)))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? Metrics.compactWidth - 2 * TileMetrics.gutter
        let sizes = subviews.map { $0[TileSizeKey.self] }
        return CGSize(width: width, height: Self.frames(sizes: sizes, width: width, largeColumns: largeColumns,
                                                        smallColumns: smallColumns, spacing: spacing).height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0[TileSizeKey.self] }
        let frames = Self.frames(sizes: sizes, width: bounds.width, largeColumns: largeColumns,
                                 smallColumns: smallColumns, spacing: spacing).frames
        for (subview, frame) in zip(subviews, frames) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), anchor: .topLeading,
                          proposal: ProposedViewSize(frame.size))
        }
    }

    // No alignment guides of its own. Without these, a parent stack asking for
    // the grid's leading edge (any VStack does) makes SwiftUI place every
    // child and ask each one, all the way down: a quarter of building the
    // board went there. Nothing aligns to a guide inside, so the answer is
    // the same: none.
    func explicitAlignment(of guide: HorizontalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }

    func explicitAlignment(of guide: VerticalAlignment, in bounds: CGRect, proposal: ProposedViewSize,
                           subviews: Subviews, cache: inout ()) -> CGFloat? { nil }
}

// MARK: - Plan

/// A tier as it will be drawn: which tiles are large, in order.
struct TierPlan: Identifiable, Equatable {
    struct Tile: Equatable {
        let event: Event
        let size: TileSize
    }
    let tier: ScoreStore.Board.Tier
    let tiles: [Tile]
    var id: String { tier.id }
    var largeCount: Int { tiles.filter { $0.size == .large }.count }
    /// Two large columns and an odd count: the first large tile spans the row.
    var heroFirst: Bool
}

/// The board's pure arithmetic: which tiles are large, crest hand-offs,
/// reveal timing. Kept apart from the view so tests and the keyboard can use it.
enum TilePlanner {
    /// Splits each tier into large and small tiles for a layout. Pure, and it
    /// takes the coarse layout, never a width.
    /// 1. Live games are large while the budget lasts (4 in one large column,
    ///    6 in two), in tier order; the rest are small, after them.
    /// 2. Nothing live: the next game within 24 hours is large (a followed
    ///    team's if one qualifies, otherwise the soonest).
    /// 3. Everything else is small.
    static func plan(_ board: ScoreStore.Board, layout: PanelLayout, now: Date = AppClock.now) -> [TierPlan] {
        let largeColumns = TileMetrics.largeColumns(layout)
        let budget = TileMetrics.largeBudget(columns: largeColumns)
        let hasLive = board.tiers.contains { $0.kind == .live }
        var nextUpID: String?
        if !hasLive {
            func soon(_ kind: ScoreStore.Board.Tier.Kind) -> Event? {
                board.tiers.first { $0.kind == kind }?.events
                    .first { $0.state == .scheduled && $0.start < now + 24 * 3600 }
            }
            nextUpID = (soon(.mine) ?? soon(.next))?.id
        }
        return board.tiers.map { tier in
            var tiles: [TierPlan.Tile]
            if tier.kind == .live {
                tiles = tier.events.enumerated().map { TierPlan.Tile(event: $1, size: $0 < budget ? .large : .small) }
            } else {
                tiles = tier.events.map { TierPlan.Tile(event: $0, size: $0.id == nextUpID ? .large : .small) }
                // The next-up tile leads its tier.
                if let i = tiles.firstIndex(where: { $0.size == .large }), i > 0 { tiles.insert(tiles.remove(at: i), at: 0) }
            }
            let large = tiles.filter { $0.size == .large }.count
            return TierPlan(tier: tier, tiles: tiles, heroFirst: largeColumns >= 2 && large % 2 == 1)
        }
    }
}

extension TilePlanner {
    /// For each tile, the teams appearing for the first time in the tier,
    /// among those the collapsed preview shows: the crests it hands off to.
    static func firstAppearances(_ plan: TierPlan, limit: Int) -> [String: Set<String>] {
        var seen = Set<String>()
        var result: [String: Set<String>] = [:]
        for tile in plan.tiles {
            for competitor in tile.event.competitors where competitor.logo != nil {
                guard seen.count < limit else { return result }
                let id = logoMatchID(section: plan.id, competitor)
                if seen.insert(id).inserted { result[tile.event.id, default: []].insert(id) }
            }
        }
        return result
    }

    /// Expanding: crests lead, each tile's text follows 40ms later, staggered
    /// by visual row (capped at 4) plus 20ms per column to the right, so the
    /// cascade never zigzags.
    static func revealDelays(_ plan: TierPlan, layout: PanelLayout) -> [String: Double] {
        let nav = TileNavigator(plans: [plan], collapsed: [], largeColumns: TileMetrics.largeColumns(layout),
                                smallColumns: TileMetrics.smallColumns(layout))
        let small = Double(TileMetrics.smallColumns(layout))
        return Dictionary(nav.cells.map { cell in
            let column = (cell.x * small - 0.5).rounded()
            return (cell.id, 0.04 + Double(min(cell.row, 4)) * Motion.stagger + max(column, 0) * 0.02)
        }, uniquingKeysWith: { a, _ in a })
    }
}

// MARK: - Keyboard

/// Grid navigation for the board: rows count down through every expanded
/// tier; ↑/↓ go to the nearest tile (by horizontal center) in the next row,
/// ←/→ step through reading order across rows and tiers. No animation.
struct TileNavigator: Equatable {
    struct Cell: Equatable {
        let id: String
        let row: Int
        /// Horizontal center as a fraction of the width.
        let x: Double
    }
    enum Direction { case up, down, left, right }

    /// Reading order.
    let cells: [Cell]

    init(plans: [TierPlan], collapsed: Set<String>, largeColumns: Int, smallColumns: Int) {
        var cells: [Cell] = []
        var row = 0
        func band(_ tiles: [TierPlan.Tile], columns: Int, heroFirst: Bool) {
            guard !tiles.isEmpty else { return }
            var rest = tiles[...]
            if heroFirst, let first = rest.first {
                cells.append(Cell(id: first.event.id, row: row, x: 0.5))
                row += 1
                rest = rest.dropFirst()
            }
            let columns = max(columns, 1)
            for (n, tile) in rest.enumerated() {
                if n > 0 && n % columns == 0 { row += 1 }
                cells.append(Cell(id: tile.event.id, row: row, x: (Double(n % columns) + 0.5) / Double(columns)))
            }
            if !rest.isEmpty { row += 1 }
        }
        for plan in plans where !collapsed.contains(plan.id) {
            band(plan.tiles.filter { $0.size == .large }, columns: largeColumns, heroFirst: plan.heroFirst)
            band(plan.tiles.filter { $0.size == .small }, columns: smallColumns, heroFirst: false)
        }
        self.cells = cells
    }

    /// The tile to highlight after a key press; nil only when there are none.
    func move(from id: String?, _ direction: Direction) -> String? {
        guard !cells.isEmpty else { return nil }
        guard let index = id.flatMap({ id in cells.firstIndex { $0.id == id } }) else {
            return (direction == .down || direction == .right ? cells.first : cells.last)?.id
        }
        let current = cells[index]
        switch direction {
        case .left: return cells[max(index - 1, 0)].id
        case .right: return cells[min(index + 1, cells.count - 1)].id
        case .up, .down:
            let target = current.row + (direction == .down ? 1 : -1)
            let row = cells.filter { $0.row == target }
            // Nearest center; a tie goes left.
            let best = row.min { a, b in
                let da = abs(a.x - current.x), db = abs(b.x - current.x)
                return abs(da - db) < 0.0001 ? a.x < b.x : da < db
            }
            return best?.id ?? current.id
        }
    }
}

// MARK: - Board

/// The board: tier headers and grids. The page around it (header, scroll
/// view, footnotes, keyboard) belongs to `ScoresView`.
struct TileBoard<Footer: View>: View {
    @Environment(ScoreStore.self) private var store
    @Environment(\.panelLayout) private var layout
    @Environment(\.panelResizing) private var resizing
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var highlight: HighlightState? = nil
    var onHover: (String, Bool) -> Void = { _, _ in }
    var onSelect: (Event) -> Void = { _ in }
    /// The page runs the toggle (it owns the crest-travel link); default: just toggle.
    var onToggle: ((ScoreStore.Board.Tier) -> Void)? = nil
    /// The tier that was just toggled: its tiles' text staggers in behind the crests.
    var justToggled: String? = nil
    /// The page's crest namespace, and the tier linked to it while it toggles
    /// (only then: a link is recomputed on every frame of every animation).
    var logoNamespace: Namespace.ID? = nil
    var linking: String? = nil
    /// Up Next's "Schedule ›": the agenda beyond the next 36 hours.
    var onOpenSchedule: (() -> Void)? = nil
    /// Below the board (the page's footnotes): it moves when the board
    /// re-flows, so it fades through with it.
    @ViewBuilder var footer: Footer
    /// The layout as drawn. When a breakpoint changes the column counts, the
    /// board fades through rather than gliding (tiles would pass over each
    /// other): what moves fades out, everything jumps to its new place in one
    /// frame, unseen, and fades back in. The top header and a band that keeps
    /// its columns (live tiles at 400→500) don't move, so they stay.
    @State private var shownLayout: PanelLayout?
    /// Bands whose column count is changing.
    @State private var reflowing: Set<TileSize> = []
    /// True only for the frame of the re-flow: nothing glides.
    @State private var jumping = false
    @State private var reflowGeneration = 0

    private struct Columns: Equatable {
        let large: Int
        let small: Int
        init(_ layout: PanelLayout) { large = TileMetrics.largeColumns(layout); small = TileMetrics.smallColumns(layout) }

        /// The bands a change from `self` to `next` re-flows. At the split the
        /// large budget changes too (live-small ⇄ large), so both bands move.
        func changed(to next: Columns) -> Set<TileSize> {
            if large != next.large { return [.large, .small] }
            return small != next.small ? [.small] : []
        }

        func fewer(than other: Columns) -> Bool { large < other.large || small < other.small }
    }

    /// Losing columns, the old ones no longer fit the narrower panel: the
    /// bands that change hide and take the new columns on the very first
    /// frame (no squeezed tiles), then fade back in.
    private var narrowing: Set<TileSize> {
        guard let shownLayout, Columns(layout).fewer(than: Columns(shownLayout)) else { return [] }
        return Columns(shownLayout).changed(to: Columns(layout))
    }

    var body: some View {
        let board = store.board
        let narrowing = self.narrowing
        let hidden = reflowing.union(narrowing)
        // Headers below the first, notes and footer move in a re-flow.
        let movedHidden = !hidden.isEmpty
        let layout = narrowing.isEmpty ? (shownLayout ?? self.layout) : self.layout
        let plans = TilePlanner.plan(board, layout: layout)
        let followed = Set(store.followed.map(\.id))
        let countries = store.climbingCountries
        // The tier header spans the board, so the preview follows the page class.
        let maxLogos = CollapsedPreview.maxLogos(for: layout.page)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(plans) { plan in
                let collapsed = store.collapsed.contains(plan.id)
                let linked = linking == plan.id ? logoNamespace : nil
                TierHeader(tier: plan.tier, events: plan.tiles.map(\.event), collapsed: collapsed,
                           justToggled: justToggled == plan.id, maxLogos: maxLogos,
                           onSchedule: plan.tier.kind == .next ? onOpenSchedule : nil) {
                    if let onToggle { onToggle(plan.tier) } else { store.toggleCollapsed(id: plan.id) }
                }
                .environment(\.logoNamespace, linked)
                .opacity(movedHidden && plan.id != plans.first?.id ? 0 : 1)
                if !collapsed {
                    let matches = TilePlanner.firstAppearances(plan, limit: maxLogos)
                    let delays = justToggled == plan.id ? TilePlanner.revealDelays(plan, layout: layout) : [:]
                    TileGrid(largeColumns: TileMetrics.largeColumns(layout), smallColumns: TileMetrics.smallColumns(layout)) {
                        ForEach(plan.tiles, id: \.event.id) { tile in
                            let event = tile.event
                            HighlightGate(state: highlight ?? HighlightState(), id: event.id) { lit in
                            EventTile(event: event, size: tile.size, league: board.league[event.id],
                                      highlighted: lit, keyboard: lit && highlight?.keyboard == true,
                                      pinned: store.pinnedID == event.id,
                                      followed: Set(event.competitors.compactMap(\.id)).intersection(followed),
                                      coStreaming: store.coStreamingIDs.contains(event.id),
                                      streaming: store.broadcast(for: event)?.isLive == true,
                                      countries: countries, logoMatches: matches[event.id] ?? [], revealDelay: delays[event.id],
                                      onHover: { onHover(event.id, $0) }, onSelect: onSelect)
                                .equatable()
                            }
                                .stackIn()
                                .id(event.id)
                                // Leaving a tier (a game ends) is quicker than arriving;
                                // never from nothing.
                                .transition(.asymmetric(
                                    insertion: (reduceMotion ? AnyTransition.opacity
                                                : AnyTransition.opacity.combined(with: .scale(scale: 0.96)))
                                        .animation(Motion.reveal),
                                    removal: .opacity.animation(Motion.exit)))
                                .opacity(hidden.contains(tile.size) ? 0 : 1)
                                .layoutValue(key: TileSizeKey.self, value: tile.size)
                        }
                    }
                    .padding(.horizontal, TileMetrics.gutter)
                    .padding(.top, 3)
                    .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
                    .environment(\.logoNamespace, linked)
                }
            }
            Group {
                failedNotes
                footer
            }
            .opacity(movedHidden ? 0 : 1)
        }
        .transaction { if jumping || !narrowing.isEmpty { $0.animation = nil } }
        // Games changing tier reposition; nothing moves while the panel is
        // being resized (the signature is width-independent anyway).
        .animation(resizing || reduceMotion ? nil : Motion.standard, value: board.signature)
        .onAppear { shownLayout = self.layout }
        .onChange(of: self.layout) { old, new in
            guard Columns(old) != Columns(new) else {
                // Same columns (a class change inside them): follow along.
                shownLayout = new
                return
            }
            reflow(from: shownLayout ?? old, to: new)
        }
    }

    /// What moves fades out where it is, jumps to its new place in one frame,
    /// unseen, and fades back in.
    private func reflow(from previous: PanelLayout, to next: PanelLayout) {
        let before = Columns(previous), after = Columns(next)
        let bands = before.changed(to: after)
        reflowGeneration += 1
        let generation = reflowGeneration
        if after.fewer(than: before) {
            // Already hidden and re-flowed on the first frame (see `narrowing`).
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) {
                reflowing = bands
                jumping = true
                shownLayout = next
            }
            Task {
                // As long as a fade-out would have taken, so both directions match.
                try? await Task.sleep(for: .seconds(0.12))
                guard generation == reflowGeneration else { return }
                jumping = false
                withAnimation(reduceMotion ? Motion.fade : Motion.reveal) { reflowing = [] }
            }
            return
        }
        withAnimation(Motion.exit) { reflowing = bands }
        Task {
            try? await Task.sleep(for: .seconds(bands.isEmpty ? 0 : 0.12))
            guard generation == reflowGeneration else { return }
            jumping = !bands.isEmpty
            withAnimation(reduceMotion ? nil : Motion.standard) { shownLayout = next }
            // A frame later (the jump has landed), fade them back in.
            try? await Task.sleep(for: .seconds(0.03))
            guard generation == reflowGeneration else { return }
            jumping = false
            withAnimation(reduceMotion ? Motion.fade : Motion.reveal) { reflowing = [] }
        }
    }

    /// The list says this inside a league's section; tiles have no league
    /// sections, so they say it once below the board, in the same voice.
    @ViewBuilder
    private var failedNotes: some View {
        let failed = store.sections.filter(\.failed)
        if !failed.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(failed) { section in
                    Text(ErrorCopy.inline(section.title))
                }
            }
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, 12)
            .stackIn()
        }
    }
}

extension TileBoard where Footer == EmptyView {
    init(highlight: HighlightState? = nil, onHover: @escaping (String, Bool) -> Void = { _, _ in },
         onSelect: @escaping (Event) -> Void = { _ in }, onToggle: ((ScoreStore.Board.Tier) -> Void)? = nil,
         justToggled: String? = nil, logoNamespace: Namespace.ID? = nil, linking: String? = nil) {
        self.init(highlight: highlight, onHover: onHover, onSelect: onSelect, onToggle: onToggle,
                  justToggled: justToggled, logoNamespace: logoNamespace, linking: linking) { EmptyView() }
    }
}

// MARK: - Tier header

/// A tier's title row: the group label and a chevron. Collapsed, a one-line
/// preview hints at what's inside. Tiers aren't leagues, so the menu only
/// expands or collapses.
struct TierHeader: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let tier: ScoreStore.Board.Tier
    /// In tile order (a next-up tile leads its tier).
    let events: [Event]
    let collapsed: Bool
    var justToggled = false
    /// Crests the collapsed preview shows; the tiles' hand-off uses the same count.
    var maxLogos = 7
    /// Up Next only: a link to the schedule, before the chevron.
    var onSchedule: (() -> Void)? = nil
    let toggle: () -> Void
    @State private var hovering = false

    /// A click anywhere on the header toggles; Up Next's "Schedule ›" is its
    /// own button beside the title (never a button inside the toggle's
    /// label), so the click and VoiceOver each reach it unambiguously.
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                GroupLabel(title: tier.title, symbol: tier.symbol)
                    // The tier's toggle, for VoiceOver: the title, its state as the value.
                    .accessibilityAddTraits(.isButton)
                    .accessibilityValue(collapsed ? "Collapsed, \(CollapsedPreview.spoken(events))" : "Expanded")
                    .accessibilityAction { toggle() }
                Spacer()
                if let onSchedule {
                    SectionLink("Schedule", help: "Schedule (⌘U)", action: onSchedule)
                }
                Image(systemName: "chevron.right")
                    .font(Glyph.disclosure)
                    .foregroundStyle(hovering ? .secondary : .tertiary)
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
                    .animation(reduceMotion ? nil : Motion.quick, value: collapsed)
                    .accessibilityHidden(true)
            }
            if collapsed {
                // The list's preview: crests that travel into the tiles.
                CollapsedPreview(events: events, sectionID: tier.id, maxLogos: maxLogos, revealSummary: justToggled)
                    .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 12)
        .padding(.bottom, collapsed ? 6 : 3)
        .contentShape(Rectangle())
        // The link inside takes its own clicks first.
        .onTapGesture(perform: toggle)
        .stackIn()
        .onHover { hovering = $0 }
        .contextMenu {
            Button(collapsed ? "Expand" : "Collapse", systemImage: collapsed ? "chevron.down" : "chevron.right", action: toggle)
        }
        .accessibilityElement(children: .contain)
        .help(collapsed ? "Show \(tier.title)" : "Hide \(tier.title)")
    }
}

// MARK: - Loading

/// First-load placeholder shaped like the board at the current columns: a
/// band of large tiles and two rows of small ones. Static, like the list's.
struct SkeletonTiles: View {
    @Environment(\.panelLayout) private var layout

    var body: some View {
        let large = TileMetrics.largeColumns(layout), small = TileMetrics.smallColumns(layout)
        VStack(alignment: .leading, spacing: 0) {
            RoundedRectangle(cornerRadius: 3).fill(Color.primary.opacity(0.07)).frame(width: 60, height: 8)
                .padding(.horizontal, Metrics.gutter).padding(.top, 14).padding(.bottom, 9)
            TileGrid(largeColumns: large, smallColumns: small) {
                ForEach(0..<(large + 2 * small), id: \.self) { i in
                    placeholder(large: i < large).layoutValue(key: TileSizeKey.self, value: i < large ? .large : .small)
                }
            }
            .padding(.horizontal, TileMetrics.gutter)
        }
        .padding(.bottom, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading scores")
    }

    private func placeholder(large: Bool) -> some View {
        let crest = large ? TileMetrics.crestLarge : TileMetrics.crestSmall
        return RoundedRectangle(cornerRadius: TileMetrics.radius, style: .continuous)
            .fill(Color.primary.opacity(0.045))
            .overlay {
                // Large: crests over equal columns; small: crests at the edges (as the tiles are).
                HStack(spacing: large ? 40 : 0) {
                    Circle().frame(width: crest, height: crest)
                    if !large { Spacer(minLength: 3) }
                    RoundedRectangle(cornerRadius: 3).frame(width: large ? 48 : 30, height: large ? 14 : 10)
                    if !large { Spacer(minLength: 3) }
                    Circle().frame(width: crest, height: crest)
                }
                .padding(.horizontal, large ? 0 : TileMetrics.padSmall.leading)
                .foregroundStyle(Color.primary.opacity(0.07))
            }
    }
}
