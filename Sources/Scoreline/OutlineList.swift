import SwiftUI

// Long lists as an outline, macOS's answer to a tall list (not pages): groups
// collapse to a header and a line of crests, the way the scores list folds a
// league; a long list with no natural groups shows its first dozen and "Show
// All N" in place. The team picker and the college standings share it.
//
// The decisions are pure (`Outline`), so they're tested without views. Each
// group's open state is its own observable flag (`DisclosureFlag`), so
// opening one group re-runs that group alone, never the page or its other
// groups. Collapsed groups never build their rows.

// MARK: - Decisions

enum Outline {
    /// A list with no natural groups and more rows than this…
    static let threshold = 24
    /// …shows this many, then "Show All N" in place.
    static let preview = 12

    /// How many rows of a flat run show before "Show All".
    static func visibleCount(_ count: Int, showingAll: Bool) -> Int {
        showingAll || count <= threshold ? count : min(preview, count)
    }

    /// Whether a group starts expanded: the user's own choice this session,
    /// else whether it holds one of their teams (picked or followed).
    static func startsExpanded(remembered: Bool?, members: [String], mine: Set<String>) -> Bool {
        remembered ?? members.contains { mine.contains($0) }
    }

    /// A crest's identity shared by a group's preview and its row, so it
    /// travels between the two: "conf:SEC|espn-ncaaf-333".
    static func crestID(group: String, item: String) -> String { "\(group)|\(item)" }

    // MARK: Keyboard

    /// A section as the arrow keys see it.
    struct Section: Equatable {
        enum Kind: Equatable {
            /// Always open, no header stop ("Selected", short lists, search results).
            case plain
            /// A header that opens and closes (a conference).
            case disclosure
            /// Its first `preview` rows, then a "Show All" stop (a long flat list).
            case capped
        }
        let id: String
        let kind: Kind
        let items: [String]
    }

    /// One stop for ↑/↓: a group's header, a row, or a "Show All".
    enum Stop: Hashable {
        case header(String)
        case row(String, String)
        case more(String)

        var section: String {
            switch self {
            case let .header(s), let .row(s, _), let .more(s): s
            }
        }

        /// The highlight's key (`HighlightState.id`), also the stop's scroll id.
        var key: String {
            switch self {
            case let .header(s): "h|\(s)"
            case let .row(s, item): "r|\(s)|\(item)"
            case let .more(s): "m|\(s)"
            }
        }

        init?(key: String?) {
            guard let key else { return nil }
            let parts = key.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
            switch (parts.first, parts.count) {
            case ("h", 2): self = .header(parts[1])
            case ("m", 2): self = .more(parts[1])
            case ("r", 3): self = .row(parts[1], parts[2])
            default: return nil
            }
        }
    }

    /// The stops on screen, in reading order: collapsed groups contribute
    /// their header alone; a capped run its first rows and "Show All".
    static func stops(_ sections: [Section], expanded: Set<String>, showingAll: Set<String> = []) -> [Stop] {
        sections.flatMap { section -> [Stop] in
            switch section.kind {
            case .plain:
                return section.items.map { .row(section.id, $0) }
            case .disclosure:
                let header = Stop.header(section.id)
                return expanded.contains(section.id) ? [header] + section.items.map { .row(section.id, $0) } : [header]
            case .capped:
                let shown = visibleCount(section.items.count, showingAll: showingAll.contains(section.id))
                let rows = section.items.prefix(shown).map { Stop.row(section.id, $0) }
                return shown < section.items.count ? rows + [.more(section.id)] : rows
            }
        }
    }

    /// ↑/↓ (`delta` −1/+1): the next stop, stopping at the ends. From
    /// nothing, ↓ starts at the top and ↑ at the bottom; from a row hidden
    /// since (its group collapsed), the move starts at its group's header.
    static func step(from current: Stop?, by delta: Int, in stops: [Stop]) -> Stop? {
        guard !stops.isEmpty else { return nil }
        let index = current.flatMap { c in stops.firstIndex(of: c) ?? stops.firstIndex(of: .header(c.section)) }
        guard let index else { return delta > 0 ? stops.first : stops.last }
        return stops[min(max(index + delta, 0), stops.count - 1)]
    }

    /// What ← or → does, as an outline does it.
    enum Disclose: Equatable {
        case expand(String)
        case collapse(String)
        case highlight(Stop)
    }

    /// →: opens a closed header; on an open one, steps to its first row.
    static func right(from current: Stop?, sections: [Section], expanded: Set<String>) -> Disclose? {
        guard case let .header(id)? = current else { return nil }
        guard expanded.contains(id) else { return .expand(id) }
        return sections.first { $0.id == id }?.items.first.map { .highlight(.row(id, $0)) }
    }

    /// ←: closes an open header; from a row in an open group, goes to its header.
    static func left(from current: Stop?, sections: [Section], expanded: Set<String>) -> Disclose? {
        switch current {
        case let .header(id)?:
            return expanded.contains(id) ? .collapse(id) : nil
        case let .row(id, _)?:
            return sections.contains { $0.id == id && $0.kind == .disclosure } ? .highlight(.header(id)) : nil
        default:
            return nil
        }
    }
}

// MARK: - Session memory

/// The groups people opened or closed, for as long as the app runs: coming
/// back to a page finds them as left. Only explicit choices are kept; a
/// group never touched follows its default (does it hold one of your teams?).
@MainActor
enum DisclosureMemory {
    private static var choices: [String: [String: Bool]] = [:]

    static func choice(_ id: String, in scope: String) -> Bool? { choices[scope]?[id] }

    static func remember(_ open: Bool, _ id: String, in scope: String) { choices[scope, default: [:]][id] = open }

    /// Tests only.
    static func forget(_ scope: String) { choices[scope] = nil }
}

// MARK: - State

/// One group's open state. Its own observable, so a toggle re-runs only the
/// views reading this group.
@Observable @MainActor
final class DisclosureFlag {
    var open: Bool
    /// A clicked toggle in progress: the crests link between the preview and
    /// the rows (a matched-geometry link costs every frame, so idle groups
    /// carry none). Cleared once it settles.
    var animating = false
    /// An opening show in progress: the rows' text staggers in.
    var revealing = false

    /// A closing show in progress: the preview's words wait for the crests.
    /// (Not while opening: the preview is leaving, and must not blink out
    /// on the pass that links the crests.)
    var collapsing: Bool { animating && !revealing }

    init(open: Bool) { self.open = open }
}

/// A page's groups (and "Show All"s), with the toggle choreography the
/// scores list uses: link the crests, open on the next pass with the travel
/// spring, clear the link once it lands. Keyboard toggles are instant; rapid
/// clicks and Reduce Motion skip the show. Not observable itself: pages read
/// the flags, and keyboard handlers read `expanded` without subscribing.
@MainActor
final class DisclosureGroups {
    private(set) var scope = ""
    private var flags: [String: DisclosureFlag] = [:]
    private var lastToggle = Date.distantPast
    private var generation = 0
    /// The group whose show is playing; a newer toggle ends it at once.
    private weak var playing: DisclosureFlag?

    enum Style { case click, keyboard }

    /// Sets each group's starting state (`Outline.startsExpanded`): this
    /// session's choice, else open when it holds one of `mine`. Flags already
    /// made keep their identity (their views stay put).
    func prepare(scope: String, _ groups: [(id: String, members: [String])], mine: Set<String>) {
        self.scope = scope
        for group in groups {
            let open = Outline.startsExpanded(remembered: DisclosureMemory.choice(group.id, in: scope),
                                              members: group.members, mine: mine)
            if let flag = flags[group.id] { flag.open = open } else { flags[group.id] = DisclosureFlag(open: open) }
        }
    }

    /// A group's flag (closed if it wasn't prepared).
    func flag(_ id: String) -> DisclosureFlag {
        if let flag = flags[id] { return flag }
        let flag = DisclosureFlag(open: DisclosureMemory.choice(id, in: scope) ?? false)
        flags[id] = flag
        return flag
    }

    var expanded: Set<String> { Set(flags.filter { $0.value.open }.keys) }

    func toggle(_ id: String, style: Style, reduceMotion: Bool) {
        set(id, open: !flag(id).open, style: style, reduceMotion: reduceMotion)
    }

    func set(_ id: String, open: Bool, style: Style, reduceMotion: Bool) {
        let flag = flag(id)
        guard flag.open != open else { return }
        DisclosureMemory.remember(open, id, in: scope)
        var instant = Transaction()
        instant.disablesAnimations = true
        let now = Date()
        let rapid = now.timeIntervalSince(lastToggle) < 0.45
        lastToggle = now
        generation += 1
        let generation = generation
        if let playing, playing !== flag { withTransaction(instant) { Self.settle(playing) } }
        // Keys never animate.
        if style == .keyboard {
            withTransaction(instant) {
                Self.settle(flag)
                flag.open = open
            }
            return
        }
        // Faster than the choreography can play, or Reduce Motion: a plain,
        // quick change (a fade with Reduce Motion), however fast the clicks.
        if rapid || reduceMotion {
            withTransaction(instant) { Self.settle(flag) }
            withAnimation(reduceMotion ? Motion.fade : Motion.exit) { flag.open = open }
            return
        }
        // Link the crests first, so the frame before the toggle registers
        // where they start, and toggle on the next pass. (Rows already on
        // screen never stagger: only an opening reveals.)
        flag.animating = true
        flag.revealing = open
        playing = flag
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            // Overtaken before it began: still count it, without the show.
            guard generation == self.generation else {
                withTransaction(instant) { flag.open = open }
                return
            }
            // Building the rows takes a frame or two; the travel starts just
            // after, so it gets every frame.
            withAnimation(Motion.travel.delay(0.04)) { flag.open = open }
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(0.8))
                // A newer toggle has already ended this one.
                guard self.playing === flag else { return }
                Self.settle(flag)
                self.playing = nil
            }
        }
    }

    /// A long list's "Show All", remembered like a group: the rest arrive
    /// on the standard spring (a fade with Reduce Motion), from a key at once.
    func showAll(_ id: String, keyboard: Bool, reduceMotion: Bool) {
        let flag = flag(id)
        guard !flag.open else { return }
        DisclosureMemory.remember(true, id, in: scope)
        if keyboard {
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) { flag.open = true }
        } else {
            withAnimation(reduceMotion ? Motion.fade : Motion.standard) { flag.open = true }
        }
    }

    private static func settle(_ flag: DisclosureFlag) {
        flag.animating = false
        flag.revealing = false
    }
}

// MARK: - Views

/// A group's header in the scores list's idiom: its name (and how many it
/// holds, "SEC · 16"), the chevron at the trailing edge, and while
/// collapsed, a preview line under it. The whole header is the button.
///
/// For VoiceOver it's one heading button: "SEC, 16 teams", valued
/// "collapsed" or "expanded" (plus the preview's words, "1 selected").
/// The keyboard highlight wears the list's accent; the pointer only
/// brightens the chevron, as on Scores.
struct DisclosureHeader<Preview: View>: View {
    let title: String
    let count: Int
    /// What the count counts, for VoiceOver: "team" → "16 teams".
    var noun = "team"
    var showsCount = true
    let open: Bool
    var highlighted = false
    /// Spoken after "collapsed" ("1 selected", "leader Oregon, 8–0").
    var spokenPreview: String? = nil
    /// Its distance from the page's edge; the title sits 16pt in either way.
    var edge: CGFloat = 12
    let toggle: () -> Void
    @ViewBuilder var preview: Preview
    @State private var hovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: toggle) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        Text(title)
                            .textCase(.uppercase)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        if showsCount {
                            Text(" · \(count)")
                                .monospacedDigit()
                                .foregroundStyle(.tertiary)
                                .fixedSize()
                        }
                    }
                    .font(SectionTitle<EmptyView>.font)
                    .tracking(0.5)
                    Spacer(minLength: 6)
                    // Always visible so collapsing is discoverable; brighter on hover.
                    Image(systemName: "chevron.right")
                        .font(Glyph.disclosure)
                        .foregroundStyle(hovering || highlighted ? .secondary : .tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                        .animation(reduceMotion ? nil : Motion.quick, value: open)
                }
                if !open {
                    // Crests carry the motion themselves, so the line just fades.
                    preview
                        .transition(.asymmetric(insertion: .identity, removal: .opacity.animation(Motion.exit)))
                }
            }
            .padding(.horizontal, 16 - edge)
            .padding(.top, 8)
            .padding(.bottom, open ? 5 : 8)
            .contentShape(Rectangle())
        }
        // The pointer brightens the chevron; only the keyboard lights the row.
        .buttonStyle(ListRowStyle(hovering: highlighted, inset: 0, keyboard: true))
        .padding(.horizontal, edge)
        .padding(.top, 4)
        .onHover { hovering = $0 }
        .contextMenu {
            Button(open ? "Collapse" : "Expand", systemImage: open ? "chevron.right" : "chevron.down", action: toggle)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(plural(count, noun))")
        .accessibilityValue(open ? "expanded" : (["collapsed"] + (spokenPreview.map { [$0] } ?? [])).joined(separator: ", "))
        .accessibilityAddTraits([.isHeader, .isButton])
        .accessibilityHeading(.h2)
        .help(open ? "Hide \(title)" : "Show \(title)")
    }
}

/// A collapsed group's line: its first crests in row order (as many as the
/// scores list's preview shows at this width, `CollapsedPreview.maxLogos`),
/// and a short note at the trailing edge. No "N more": the header says how
/// many. Each crest shares an identity with its row's, so it travels there
/// when the group opens.
struct CrestStrip: View {
    struct Crest: Identifiable, Equatable {
        let id: String
        let name: String
        let logo: URL?
        var darkLogo: URL? = nil
    }

    let group: String
    let crests: [Crest]
    var note: String? = nil
    /// The rows' crest size: drawn at that size and scaled to 14pt, so the
    /// preview and the rows share one decoded image and nothing reloads mid-travel.
    var rowSize: CGFloat = 18
    /// Just collapsed: the note waits for the crests to land, then fades in.
    var revealNote = false

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 5) {
                ForEach(crests) { crest in
                    LogoView(url: crest.logo, darkURL: crest.darkLogo, size: rowSize)
                        .scaleEffect(14 / rowSize)
                        .frame(width: 14, height: 14)
                        .matchedLogo(Outline.crestID(group: group, item: crest.id))
                        .help(crest.name)
                }
            }
            // Never squeezed: the note gives way first.
            .fixedSize()
            Spacer(minLength: 6)
            if let note {
                Text(note)
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    // ~ when the crests (0.4s travel) have mostly landed.
                    .revealOnAppear(after: revealNote ? 0.22 : nil)
            }
        }
        .frame(minHeight: 16)
        .accessibilityHidden(true)
    }
}

/// Equatable on what it draws, so a highlight moving between rows (which
/// re-runs every header's `HighlightGate`) redraws only the header it lit.
extension DisclosureHeader: @MainActor Equatable where Preview: Equatable {
    static func == (a: DisclosureHeader, b: DisclosureHeader) -> Bool {
        a.title == b.title && a.count == b.count && a.noun == b.noun && a.showsCount == b.showsCount && a.open == b.open
            && a.highlighted == b.highlighted && a.spokenPreview == b.spokenPreview && a.edge == b.edge && a.preview == b.preview
    }
}

extension CrestStrip: @MainActor Equatable {
    static func == (a: CrestStrip, b: CrestStrip) -> Bool {
        a.group == b.group && a.crests == b.crests && a.note == b.note && a.rowSize == b.rowSize && a.revealNote == b.revealNote
    }
}

/// The inset box a group's rows sit in (the picker's, as before).
/// `fadesIn`: a group opening by click; the box's plate fades in under rows
/// that arrive on their own (crests travel, text staggers), so it never
/// covers what's still sliding down below it.
struct OutlineBox<Content: View>: View {
    var fadesIn = false
    @ViewBuilder let content: Content
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        content
            .padding(.vertical, 3)
            .background {
                ZStack {
                    shape.fill(Color.primary.opacity(contrast == .increased ? 0.08 : 0.045))
                    shape.strokeBorder(Color.primary.opacity(contrast == .increased ? 0.25 : 0.06))
                }
                .opacity(!fadesIn || shown ? 1 : 0)
            }
            .padding(.horizontal, 12)
            .onAppear {
                guard fadesIn, !shown else { return }
                withAnimation(reduceMotion ? Motion.fade : Motion.reveal) { shown = true }
            }
    }
}
