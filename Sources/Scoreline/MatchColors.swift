import AppKit
import SwiftUI

// One game's colors, decided once. A team has its identity (the club's own
// color: the page's wash, the hero's crests, a tile's wash) and, for this game,
// a kit: what its men wear on the field and what every mark of theirs is drawn
// in, the charts, the tags, the docked bar and the end zones, so the chart and
// the field can't name a team by different colors. The kit is the match-day
// kit where the source has one (ESPN's soccer summaries, once lineups post),
// else the team's own color. On a clash the rule is the sport's: home keeps
// its kit and the away side changes. Light and dark don't come into it: the
// decision is made once, for both, and appearance only tones what's drawn.

/// A team's colors as a source gives them (hex): its own and its second.
struct TeamKit: Hashable, Sendable, Codable {
    var color: String?
    var alternate: String?

    init(color: String? = nil, alternate: String? = nil) {
        self.color = color
        self.alternate = alternate
    }

    /// ESPN's `uniform` (`{type, color, alternateColor}`). `type` names the kit
    /// (home, away, third), not the side wearing it: it isn't read. (pure)
    init?(uniform: JSON) {
        guard let color = uniform["color"].string, OKLab(hex: color) != nil else { return nil }
        self.init(color: color, alternate: uniform["alternateColor"].string.flatMap { OKLab(hex: $0) == nil ? nil : $0 })
    }
}

struct MatchColors: Hashable, Sendable {
    /// How a side comes to wear what it's wearing.
    enum Wear: Hashable, Sendable {
        /// Its own kit: the match-day kit, else the team's color.
        case own
        /// Away, on a clash: its second color.
        case second
        /// Away, with no second color that reads apart: white, or charcoal against a pale home kit.
        case contrast
    }

    struct Team: Hashable, Sendable {
        /// The club's own colors.
        var identity: TeamKit
        /// What its men wear in this game (nil: nothing known).
        var color: String?
        /// The kit's trim; a side that changed, its own color.
        var alternate: String?
        var wear = Wear.own
    }

    var top: Team
    var bottom: Team
    var home: GameDetail.Side

    /// Below this (OKLab distance, in the less forgiving appearance) two kits look alike.
    static let apart = 0.12
    static let white = "ffffff"
    static let charcoal = "3d3d3d"

    /// The rule: home keeps its kit. On a clash, away changes: to its kit's
    /// second color, then its team's, then white (charcoal if home is pale).
    /// (pure; tested)
    init(top: TeamKit, bottom: TeamKit, topKit: TeamKit? = nil, bottomKit: TeamKit? = nil, home: GameDetail.Side = .bottom) {
        self.home = home
        func wearing(_ own: TeamKit, _ kit: TeamKit?) -> Team {
            Team(identity: own, color: kit?.color ?? own.color, alternate: kit?.alternate ?? own.alternate)
        }
        self.top = wearing(top, topKit)
        self.bottom = wearing(bottom, bottomKit)
        guard let homeColor = (home == .top ? self.top : self.bottom).color,
              let awayColor = (home == .top ? self.bottom : self.top).color,
              !Self.readApart(homeColor, awayColor) else { return }
        let away = home == .top ? bottom : top
        let seconds = [home == .top ? bottomKit?.alternate : topKit?.alternate, away.alternate].compactMap { $0 }
        let changed: Team
        if let second = seconds.first(where: { Self.readApart(homeColor, $0) }) {
            changed = Team(identity: away, color: second, alternate: awayColor, wear: .second)
        } else {
            let pale = (OKLab(hex: homeColor)?.l ?? 0) >= 0.6
            changed = Team(identity: away, color: pale ? Self.charcoal : Self.white, alternate: away.color, wear: .contrast)
        }
        if home == .top { self.bottom = changed } else { self.top = changed }
    }

    init(top: Competitor?, bottom: Competitor?, topIsHome: Bool = false) {
        self.init(top: TeamKit(color: top?.color, alternate: top?.alternateColor),
                  bottom: TeamKit(color: bottom?.color, alternate: bottom?.alternateColor),
                  topKit: top?.kit, bottomKit: bottom?.kit, home: topIsHome ? .top : .bottom)
    }

    /// A game's colors (`topIsHome`: as its summary says; else as its sport lists its teams).
    init(_ event: Event, topIsHome: Bool? = nil) {
        self.init(top: event.competitors.first, bottom: event.competitors.count > 1 ? event.competitors.last : nil,
                  topIsHome: topIsHome ?? event.listsHomeFirst)
    }

    /// Whether two colors can be told apart in both appearances, as marks on a
    /// chart and as men on a field. (pure; tested)
    static func readApart(_ a: String, _ b: String) -> Bool {
        guard let x = OKLab(hex: a), let y = OKLab(hex: b) else { return true }
        return [ColorScheme.dark, .light].allSatisfy { scheme in
            // A color with no usable hue on this panel is a gray mark (`Viz.neutral`).
            let gray = OKLab(l: scheme == .dark ? 0.62 : 0.5, a: 0, b: 0)
            let marks = (TeamTone.adjust(x, scheme: scheme) ?? gray).distance(to: TeamTone.adjust(y, scheme: scheme) ?? gray)
            return marks >= apart && TeamTone.worn(x, scheme: scheme).distance(to: TeamTone.worn(y, scheme: scheme)) >= apart
        }
    }

    // MARK: On this panel

    /// What each side wears, as marks: the charts, the dock, the end zones.
    func palette(_ scheme: ColorScheme) -> TeamPalette {
        TeamPalette(top: top.color, bottom: bottom.color, scheme: scheme)
    }

    /// The clubs' own colors: the wash and the crests.
    func identity(_ scheme: ColorScheme) -> TeamPalette {
        TeamPalette(top: top.identity.color, bottom: bottom.identity.color, scheme: scheme)
    }
}

extension MatchColors.Team {
    /// Dressed for this panel. A pale jersey on a light panel takes a rim of its
    /// own, deepened, not the white halo; a side in a contrast kit keeps its
    /// color at the cap and the trim. (pure; tested)
    func uniform(_ scheme: ColorScheme) -> Uniform {
        let dark = scheme == .dark
        func shade(_ lab: OKLab) -> Color { Color(nsColor: lab.nsColor) }
        let gray = OKLab(l: dark ? 0.72 : 0.5, a: 0, b: 0)
        let worn = color.flatMap(OKLab.init(hex:)).map { TeamTone.worn($0, scheme: scheme) } ?? gray
        // Type in the team's color: a pale one deepens on a light panel, keeping its hue; black or white on its own panel reads as ink.
        let own = (wear == .contrast ? identity.color : color).flatMap(OKLab.init(hex:)).flatMap { TeamTone.adjust($0, scheme: scheme) }
        let accent = own.map { shade(!dark && $0.l > 0.7 ? OKLab(l: 0.6, chroma: $0.chroma, hue: $0.hue) : $0) } ?? .primary
        if wear == .contrast {
            let team = shade(own ?? gray)
            return Uniform(jersey: shade(worn), cap: team, piping: dark || worn.l < 0.5 ? nil : team.opacity(0.9), accent: accent)
        }
        return Uniform(jersey: shade(worn), cap: shade(worn),
                       piping: !dark && worn.l > 0.7 ? shade(OKLab(l: 0.42, chroma: worn.chroma, hue: worn.hue)) : nil, accent: accent)
    }
}

extension Event {
    /// Soccer lists the home side first; the North American sports, away first.
    var listsHomeFirst: Bool {
        if case .espn(_, _, .soccer)? = ref { true } else { false }
    }

    /// This game's colors, for a head-to-head match.
    var matchColors: MatchColors? {
        if case .match = content { MatchColors(self) } else { nil }
    }
}
