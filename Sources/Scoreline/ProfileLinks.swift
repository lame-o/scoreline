import AppKit
import SwiftUI

// How team and player pages are reached and how people are drawn: the
// navigator that opens pages from anywhere, quiet links (a name looks like a
// name until you point at it), and photos that fall back to monograms in the
// team's color.

// MARK: - Navigator

/// Opens team, player and match pages from anywhere below the page host. A
/// class in the environment rather than closures in environment keys (those
/// can't be compared, so every reader would re-render on every pass). The
/// host (RootView, hook P1) sets the actions once; previews and the render
/// harness pass none, and links then simply do nothing.
@MainActor
@Observable
final class ProfileNavigator {
    @ObservationIgnored var openTeam: (Profile.TeamRef) -> Void
    @ObservationIgnored var openPlayer: (Profile.PlayerRef) -> Void
    @ObservationIgnored var openEvent: (Event) -> Void
    /// Back, as the page's own Back button does (the render harness drives round trips with it).
    @ObservationIgnored var goBack: () -> Void = {}

    init(openTeam: @escaping (Profile.TeamRef) -> Void = { _ in },
         openPlayer: @escaping (Profile.PlayerRef) -> Void = { _ in },
         openEvent: @escaping (Event) -> Void = { _ in }) {
        self.openTeam = openTeam
        self.openPlayer = openPlayer
        self.openEvent = openEvent
    }

    func open(_ team: Profile.TeamRef) { if team.isSupported { openTeam(team) } }
    func open(_ player: Profile.PlayerRef) { openPlayer(player) }
    func open(_ event: Event) { openEvent(event) }
    func back() { goBack() }
}

// MARK: - Quiet links

/// A name inside a block that isn't itself a link (a hero's team, a court
/// footer's player). Unchanged at rest; underlined with the link pointer
/// under the cursor; dims a little while pressed.
struct QuietLink<Label: View>: View {
    let help: String
    /// What a click does, for VoiceOver ("Opens the team page."); the label
    /// already says the name, so the tooltip isn't repeated as a hint.
    var hint: String? = nil
    let action: () -> Void
    /// After 250 ms under the pointer (prefetch).
    var onDwell: (() -> Void)? = nil
    @ViewBuilder let label: Label
    /// The only state a hover touches: this link re-renders, nothing around it does.
    @State private var hovering = false
    @State private var dwell: Task<Void, Never>?
    /// Prefetch once per link: hovering back and forth never asks again.
    @State private var prefetched = false
    #if DEBUG
    @Environment(\.linkHoverPreview) private var preview
    #else
    private let preview: String? = nil
    #endif

    var body: some View {
        Button(action: action) {
            label
                .underline(hovering || preview == help, color: .secondary)
                .padding(.vertical, 3)
                .contentShape(Rectangle())
        }
        .buttonStyle(QuietPressStyle())
        .pointerStyle(.link)
        .onHover { inside in
            hovering = inside
            dwell?.cancel()
            guard inside, !prefetched, let onDwell else { return }
            // Debounced: only a pointer that rests 250 ms asks.
            dwell = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                prefetched = true
                onDwell()
            }
        }
        .help(help)
        .accessibilityAddTraits(.isLink)
        .accessibilityHint(hint.map { Text($0) } ?? Text(""))
    }
}

private struct QuietPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(Motion.press, value: configuration.isPressed)
    }
}

/// A row whose whole purpose is the thing it names (roster rows, results).
/// The list's hover fill, and the content is told so it can underline its name.
struct RowLink<Content: View>: View {
    let help: String
    /// What a click does, for VoiceOver ("Opens the player page.").
    var hint: String? = nil
    let action: () -> Void
    var onDwell: (() -> Void)? = nil
    @ViewBuilder let content: (_ hovering: Bool) -> Content
    @State private var hovering = false
    @State private var dwell: Task<Void, Never>?
    @State private var prefetched = false

    var body: some View {
        Button(action: action) {
            content(hovering)
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(ListRowStyle(hovering: hovering, inset: 0))
        .padding(.horizontal, -6)
        .onHover { inside in
            hovering = inside
            dwell?.cancel()
            guard inside, !prefetched, let onDwell else { return }
            dwell = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                prefetched = true
                onDwell()
            }
        }
        .help(help)
        .accessibilityAddTraits(.isLink)
        .accessibilityHint(hint.map { Text($0) } ?? Text(""))
    }
}

/// VoiceOver hints for links, in one voice.
enum LinkHint {
    static let team = "Opens the team page."
    static let player = "Opens the player page."
    static let match = "Opens the match."
}

extension View {
    /// Underlines a name while its row is hovered (0.5pt, secondary).
    func linkName(_ hovering: Bool) -> some View { underline(hovering, color: .secondary) }
}

// MARK: - Context menu items

/// "Go to Arsenal" / "Go to LeBron James": Music's wording.
struct GoToTeamItem: View {
    let team: Profile.TeamRef
    /// The navigator, passed in by menus whose host may not carry the environment.
    var via: ProfileNavigator? = nil
    @Environment(ProfileNavigator.self) private var environment: ProfileNavigator?

    var body: some View {
        if team.isSupported, let navigator = via ?? environment {
            Button("Go to \(team.name)", systemImage: "shield.lefthalf.filled") { navigator.open(team) }
        }
    }
}

struct GoToPlayerItem: View {
    let player: Profile.PlayerRef
    var via: ProfileNavigator? = nil
    @Environment(ProfileNavigator.self) private var environment: ProfileNavigator?

    var body: some View {
        if let navigator = via ?? environment {
            Button("Go to \(player.name)", systemImage: "person.crop.circle") { navigator.open(player) }
        }
    }
}

// MARK: - Photos and monograms

/// A person's photo in a circle, or Contacts-style initials in the team's
/// color when there's none (most soccer players). The monogram is also the
/// placeholder while a photo loads, so a photo crossfades from initials.
struct PlayerPhoto: View {
    enum Crop { case cutout, portrait }
    let url: URL?
    let name: String
    var tint: Color? = nil
    var size: CGFloat = 28
    /// ESPN and bo3 cutouts are transparent and wider than tall: top-aligned
    /// on a disc. IFSC photos are square portraits: centered.
    var crop: Crop = .cutout
    @State private var loaded: NSImage?

    private var pixels: Int { Int((size * 2 * (crop == .cutout ? 1.45 : 1)).rounded(.up)) }

    var body: some View {
        let image = loaded ?? ImageCache.shared.cached(url, pixels: pixels)
        // Large monograms (heroes) are a solid disc in the team color with white
        // initials, as Contacts draws them; small ones in lists stay quiet.
        let bold = image == nil && size >= 48 && tint != nil
        ZStack {
            if bold, let tint {
                Circle().fill(LinearGradient(colors: [tint.opacity(0.95), tint.opacity(0.7)], startPoint: .top, endPoint: .bottom))
            } else {
                Circle().fill(tint.map { $0.opacity(0.16) } ?? Color.primary.opacity(0.07))
            }
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    // FotMob's photos are face crops: centered, like portraits.
                    .frame(width: size, height: size, alignment: crop == .cutout && url?.host()?.contains("fotmob") != true ? .top : .center)
                    .transition(.opacity)
            } else {
                Text(Profile.initials(name))
                    .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                    .foregroundStyle(bold ? AnyShapeStyle(tint.map { Viz.ink(on: $0) } ?? .white)
                                     : tint.map { AnyShapeStyle($0) } ?? AnyShapeStyle(.secondary))
                    .minimumScaleFactor(0.6)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .animation(Motion.fade, value: loaded != nil)
        .task(id: url) {
            guard let url, ImageCache.shared.cached(url, pixels: pixels) == nil else { return }
            loaded = await ImageCache.shared.image(for: url, pixels: pixels)
        }
        .accessibilityHidden(true)
    }
}

/// A team crest, or its abbreviation when there's no logo (a shield when
/// there's no abbreviation either: three letters of a name can be another
/// team's code, "CHI" for the Chiefs).
struct TeamCrest: View {
    let team: Profile.TeamRef
    var size: CGFloat = 16

    var body: some View {
        if team.logo != nil {
            LogoView(url: team.logo, darkURL: Competitor(id: team.id, name: team.name, abbreviation: team.abbreviation ?? "",
                                                         score: nil, logo: team.logo, isWinner: false).darkLogo, size: size)
        } else {
            Group {
                if let code = team.abbreviation, !code.isEmpty {
                    Text(code.prefix(4).uppercased())
                        .font(.system(size: size * (code.count > 3 ? 0.34 : 0.42), weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.7)
                } else {
                    Image(systemName: "shield").font(.system(size: size * 0.45, weight: .semibold))
                }
            }
            .foregroundStyle(.secondary)
            .frame(width: size, height: size)
            .background(Circle().fill(Color.primary.opacity(0.07)))
            .accessibilityHidden(true)
        }
    }
}

// MARK: - Colors

@MainActor
enum ProfileColors {
    /// The team's two colors for a wash, fitted to the scheme (logo colors first, as the match page reads them).
    static func team(_ ref: Profile.TeamRef?, header: Profile.TeamHeader? = nil, scheme: ColorScheme) -> (Color, Color)? {
        guard let ref else { return nil }
        var competitor = Competitor(id: ref.id, name: ref.name, abbreviation: ref.abbreviation ?? "", score: nil,
                                    logo: header?.logo ?? ref.logo, isWinner: false,
                                    color: header?.color ?? ref.color, alternateColor: header?.alternateColor ?? ref.alternateColor)
        competitor = TeamColors.shared.apply(competitor)
        guard competitor.color != nil else { return nil }
        let palette = TeamPalette(top: competitor.color, bottom: competitor.alternateColor ?? competitor.color, scheme: scheme)
        return (palette.top, competitor.alternateColor == nil ? palette.top : palette.bottom)
    }

    /// Logo colors are read once per logo, in the background. When a page's
    /// logo hasn't been read yet, wait a moment for it (at most 2 s) so the
    /// wash can take the logo's colors on the first visit.
    static func awaitLogoColors(_ logo: URL?, then: () -> Void) async {
        guard let logo, TeamColors.shared.isEnabled, TeamColors.shared.entry(for: logo) == nil else { return }
        for _ in 0..<8 {
            try? await Task.sleep(for: .milliseconds(250))
            if TeamColors.shared.entry(for: logo) != nil { return then() }
        }
    }

    /// The one color a person's marks use (their team's, else the accent).
    static func tint(_ ref: Profile.TeamRef?, header: Profile.TeamHeader? = nil, scheme: ColorScheme) -> Color {
        team(ref, header: header, scheme: scheme)?.0 ?? .accentColor
    }
}

// MARK: - Hero

extension View {
    /// A team or player page's hero card as the page's top heading: VoiceOver
    /// reads it as one element and moves to it when the page comes on screen
    /// (the page has no title in its header; the hero is the title).
    func pageHero() -> some View { modifier(PageHero()) }
}

private struct PageHero: ViewModifier {
    @AccessibilityFocusState private var voiceOverFocus: Bool
    @Environment(\.pageLive) private var live

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHeading(.h1)
            .accessibilityFocused($voiceOverFocus)
            .task(id: live) {
                guard live else { return }
                // Once the page is in the accessibility tree.
                try? await Task.sleep(for: .milliseconds(100))
                voiceOverFocus = true
            }
    }
}

/// A soft glow of the team's color behind a hero crest or photo. A radial
/// gradient, not a blurred circle: the hero scales as the page scrolls
/// (`heroTuck`), and a blur would re-rasterize on every frame of it.
struct HeroGlow: View {
    let color: Color
    let diameter: CGFloat

    /// The profile of a disc of this diameter at 35%, blurred by 14pt: the
    /// look the glow had, without the blur pass.
    var body: some View {
        RadialGradient(stops: [.init(color: color.opacity(0.33), location: 0), .init(color: color.opacity(0.30), location: 0.25),
                               .init(color: color.opacity(0.17), location: 0.5), .init(color: color.opacity(0.08), location: 0.67),
                               .init(color: color.opacity(0.025), location: 0.83), .init(color: color.opacity(0), location: 1)],
                       center: .center, startRadius: 0, endRadius: diameter)
            .frame(width: diameter * 2, height: diameter * 2)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

// MARK: - Small shared pieces

/// A sub-heading inside a section ("PODIUMS", a day of rounds, "TIME TBA",
/// a roster group): small caps drawn by `textCase`, so it's read as written.
struct SubLabel: View {
    let title: String

    init(_ title: String) { self.title = title }

    var body: some View {
        Text(title)
            .textCase(.uppercase)
            .font(.system(size: 9.5, weight: .semibold))
            .tracking(0.4)
            .foregroundStyle(.secondary)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHeading(.h3)
    }
}

/// A section's small-caps row label with optional column headers on the
/// right. Only the title is a heading; the column labels are drawn for the
/// eye (each row speaks its own values with their names).
struct ProfileGroupHeader: View {
    let title: String
    var columns: [(label: String, width: CGFloat)] = []

    var body: some View {
        HStack(spacing: 6) {
            SubLabel(title)
            Spacer(minLength: 4)
            ForEach(columns.indices, id: \.self) { i in
                Text(columns[i].label)
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: columns[i].width, alignment: .trailing)
                    .widthDetail()
                    .accessibilityHidden(true)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 2)
    }
}

/// "All Games (20) ⌄": opens the rest of a long list in place, in the
/// section link's one style (`SectionLink`).
struct ProfileMoreButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        SectionLink(title, symbol: "chevron.down", action: action)
            .padding(.vertical, 2)
    }
}

/// A footnote for parts that didn't load, with the way to try again (a
/// profile loads once per visit: nothing retries on its own).
struct ProfileFootnote: View {
    let text: String
    var retry: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(text)
                .font(Viz.note)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            if let retry { SectionLink(ErrorCopy.retry, symbol: "arrow.clockwise", action: retry) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 14)
    }
}

enum ProfileFormat {
    /// "Sun, Oct 25".
    static func day(_ date: Date) -> String { date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()) }
    /// "Oct 25".
    static func short(_ date: Date) -> String { date.formatted(.dateTime.month(.abbreviated).day()) }
    /// "$1.6M", "$457K".
    static func money(_ value: Double) -> String {
        value >= 1_000_000 ? String(format: "$%.1fM", value / 1_000_000) : String(format: "$%.0fK", value / 1000)
    }
}

// MARK: - Hooks for other views (R3 patches call these)

private struct ProfileLeagueKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

private struct ProfilePathKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    /// The `League.id` of the page showing a table or a match, so rows can build team links.
    var profileLeague: String? {
        get { self[ProfileLeagueKey.self] }
        set { self[ProfileLeagueKey.self] = newValue }
    }

    /// The ESPN sport/league path of the match being shown ("soccer/eng.1"), so player rows can build links.
    var profilePath: String? {
        get { self[ProfilePathKey.self] }
        set { self[ProfilePathKey.self] = newValue }
    }
}

extension Profile.TeamRef {
    /// The `League.id` for an ESPN path ("soccer/eng.1" → "eng.1").
    static func league(forPath path: String?) -> String? {
        guard let path else { return nil }
        return League.catalog.first { if case let .espn(p, _) = $0.source { return p == path }; return false }?.id
    }
}

extension View {
    /// A table row that opens a page: the list's hover fill, the whole row
    /// clickable, and nothing else changed (no underline: tables keep their
    /// alignment). Does nothing without a navigator or a destination.
    /// `outset`: how far the hover fill reaches past the content (0 for rows with their own padding).
    func profileRowLink(help: String, hint: String? = nil, outset: CGFloat = 4, action: (() -> Void)?) -> some View {
        modifier(ProfileRowLinkModifier(help: help, hint: hint, outset: outset, action: action))
    }

    /// For rows whose single click is already taken (picking a player for
    /// the court, pinning a chart): a double click opens the page, as Finder
    /// opens what a click selects.
    func profileDoubleClick(_ action: (() -> Void)?) -> some View {
        simultaneousGesture(TapGesture(count: 2).onEnded { action?() }, including: action == nil ? .subviews : .all)
    }
}

private struct ProfileRowLinkModifier: ViewModifier {
    let help: String
    let hint: String?
    let outset: CGFloat
    let action: (() -> Void)?
    /// Lives here, not in the row: a hover re-runs this modifier and its button
    /// style (the fill), never the row's own content.
    @State private var hovering = false
    #if DEBUG
    @Environment(\.linkHoverPreview) private var preview
    #else
    private let preview: String? = nil
    #endif

    func body(content: Content) -> some View {
        if let action {
            Button(action: action) {
                content.contentShape(Rectangle())
            }
            .buttonStyle(ProfileRowButtonStyle(hovering: hovering || preview == help, outset: outset))
            .onHover { hovering = $0 }
            .help(help)
            .accessibilityAddTraits(.isLink)
            .accessibilityHint(hint.map { Text($0) } ?? Text(""))
        } else {
            content
        }
    }
}

private struct ProfileRowButtonStyle: ButtonStyle {
    let hovering: Bool
    let outset: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.primary.opacity(configuration.isPressed ? 0.11 : hovering ? 0.06 : 0))
                .padding(.horizontal, -outset)
                .padding(.vertical, -outset / 4))
    }
}

extension Profile.PlayerRef {
    /// An ESPN player with a page (NBA, NFL, college football, MLB, soccer;
    /// not the WNBA or college basketball), from a match page's IDs.
    static func espn(path: String?, id: String?, name: String, photo: URL? = nil, team: Profile.TeamRef? = nil) -> Self? {
        guard let path, let id, !id.isEmpty,
              ["basketball/nba", "football/nfl", "football/college-football", "baseball/mlb"].contains(path) || path.hasPrefix("soccer/")
        else { return nil }
        return Self(source: .espn(path: path), id: id, name: name, photo: photo, team: team)
    }
}

extension View {
    /// A standings row that opens its team's page: the hover fill, a click,
    /// "Go to …" in the context menu. Reads the league from `profileLeague`;
    /// stays plain without a navigator or for sports without team pages.
    func teamRowLink(id: String, name: String, logo: URL?, abbreviation: String?) -> some View {
        modifier(TeamRowLink(id: id, name: name, logo: logo, abbreviation: abbreviation))
    }
}

private struct TeamRowLink: ViewModifier {
    let id: String
    let name: String
    let logo: URL?
    let abbreviation: String?
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    @Environment(\.profileLeague) private var league

    func body(content: Content) -> some View {
        let ref = Profile.TeamRef(id: id, name: name, logo: logo, league: league, abbreviation: abbreviation)
        let page = navigator != nil && ref.isSupported ? ref : nil
        content
            .profileRowLink(help: "Go to \(name)", hint: LinkHint.team, outset: 0,
                            action: navigator.flatMap { nav in page.map { p in { nav.open(p) } } })
            .contextMenu { if let page { GoToTeamItem(team: page, via: navigator) } }
    }
}

// MARK: - Entry points on match pages and tables

/// A team's name that opens its page (a match hero's names): plain at rest,
/// underlined with the link pointer under it. Reads the navigator itself, so
/// the page around it gains no dependency.
struct TeamNameLink<Label: View>: View {
    let team: Profile.TeamRef?
    @ViewBuilder let label: Label
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?

    var body: some View {
        if let team, team.isSupported, let navigator {
            QuietLink(help: "Go to \(team.name)", hint: LinkHint.team, action: { navigator.open(team) },
                      onDwell: { ProfileStore.shared.prefetch(team) }) { label }
                // QuietLink's taller hit area, without moving the layout around it.
                .padding(.vertical, -3)
        } else {
            label
        }
    }
}

/// A person's name that opens their page, in a row whose own click does
/// something else (pinning a climber, picking a player for the court): plain
/// at rest, underlined with the link pointer under it, as a hero's team names
/// are. A click on the name opens the page; anywhere else in the row keeps the
/// row's click. An ESPN athlete is resolved against the match's `profilePath`.
struct PlayerNameLink<Label: View>: View {
    var player: Profile.PlayerRef? = nil
    var espn: (id: String?, name: String, photo: URL?)? = nil
    @ViewBuilder let label: Label
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    @Environment(\.profilePath) private var path

    var body: some View {
        if let navigator, let ref = player ?? espn.flatMap({ Profile.PlayerRef.espn(path: path, id: $0.id, name: $0.name, photo: $0.photo) }) {
            QuietLink(help: "Go to \(ref.name)", hint: LinkHint.player, action: { navigator.open(ref) },
                      onDwell: { ProfileStore.shared.prefetch(ref) }) { label }
                // QuietLink's taller hit area, without moving the row around it.
                .padding(.vertical, -3)
        } else {
            label
        }
    }
}

extension View {
    /// A row whose click is already taken (picking a player for the court):
    /// a double click, "Go to …" in the context menu, or VoiceOver's action
    /// opens the player's page. Reads the match's ESPN path from `profilePath`
    /// (NBA, NFL, MLB and soccer have pages; the WNBA doesn't).
    func playerPageLink(id: String?, name: String, photo: URL? = nil) -> some View {
        modifier(PlayerPageLink(ref: nil, espn: (id, name, photo)))
    }

    /// The same for a person whose page is already known (a climber in a round's ranking).
    func playerPageLink(_ ref: Profile.PlayerRef) -> some View {
        modifier(PlayerPageLink(ref: ref, espn: nil))
    }
}

private struct PlayerPageLink: ViewModifier {
    let ref: Profile.PlayerRef?
    let espn: (id: String?, name: String, photo: URL?)?
    @Environment(ProfileNavigator.self) private var navigator: ProfileNavigator?
    @Environment(\.profilePath) private var path

    func body(content: Content) -> some View {
        if let navigator, let ref = ref ?? espn.flatMap({ Profile.PlayerRef.espn(path: path, id: $0.id, name: $0.name, photo: $0.photo) }) {
            content
                .profileDoubleClick { navigator.open(ref) }
                .contextMenu { GoToPlayerItem(player: ref, via: navigator) }
                .accessibilityAction(named: "Go to \(ref.name)") { navigator.open(ref) }
        } else {
            content
        }
    }
}

#if DEBUG
private struct LinkHoverPreviewKey: EnvironmentKey {
    static let defaultValue: String? = nil
}

extension EnvironmentValues {
    /// Render harness only: draws the link with this help text ("Open Lakers") as if the pointer were on it.
    var linkHoverPreview: String? {
        get { self[LinkHoverPreviewKey.self] }
        set { self[LinkHoverPreviewKey.self] = newValue }
    }
}
#endif
