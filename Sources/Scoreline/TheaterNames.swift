import SwiftUI

// Names on the isometric views, in the broadcast tag the theaters already
// speak: the status tag's type (SF Pro Condensed Black slanted 12°) on a
// slab in the color the figure wears, cut on the same lean. The pointer
// names whoever it's over (his number on the stripe's color, his SURNAME,
// his position); at rest the man the moment is about keeps his surname over
// his head; a figure the theater placed without data says only what's known
// ("SEAHAWKS · DE", "JAZZ"), and officials, umpires and coaches never get one.
//
// Each sport's theater says who each figure in its script is and who the
// moment is about (its `TheaterCast`, built once per script from the game's
// own data, never guessed). This file draws, places and hit-tests the tags
// the same way for all four: drawn inside each frame's Canvas as resolved
// symbols (as the stamp and the banner are), so a tag follows its man
// through a replay for free; placed inside the well, clear of the status
// tag, the heartbeat, the turn control, the stamp and the headline, the
// pointer's first (the key man's steps under his feet when it needs the
// room, or waits); hit-tested from the script at t alone (each figure's
// spot, the lens there, a box from his ground point and height), no posing.
//
// Motion, Emil's and Apple's way: a tag fades in over 120 ms with a 2 pt
// rise, ease-out, and leaves faster (100 ms); moving straight from one man
// to the next swaps at once, as tooltips do after the first; with Reduce
// Motion it fades without the rise. A tag never moves on its own while the
// pointer is still: the stage keeps only who the pointer is over, changed
// when it crosses to another man.

// MARK: - Who

/// A player as a tag names him, as the game's data gives him: his name,
/// the surname the tag says, his number and his position's abbreviation.
struct TheaterPerson: Equatable, Sendable {
    var name: String
    /// "Wembanyama", "Mesa Jr.", "Jones Garcia".
    var last: String
    var number: String?
    /// "SS", "WR", "G", "GK".
    var position: String?

    init(name: String, last: String? = nil, number: String? = nil, position: String? = nil) {
        self.name = name
        self.last = last.flatMap { $0.isEmpty ? nil : $0 } ?? Self.surname(name)
        self.number = number.flatMap { $0.isEmpty ? nil : $0 }
        self.position = position.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// An ESPN athlete (a box score's, a roster's): the surname from its own
    /// `lastName`, else its short name past the initial ("D. Jones Garcia":
    /// Jones Garcia, a two-word surname the full name can't tell), else the
    /// full name's.
    init?(athlete a: JSON, number: String? = nil, position: String? = nil) {
        guard let name = a["displayName"].string ?? a["fullName"].string, !name.isEmpty else { return nil }
        let short = a["shortName"].string.map(Self.afterInitials)
        self.init(name: name, last: a["lastName"].string ?? short, number: number ?? a["jersey"].string,
                  position: position ?? a["position"]["abbreviation"].string)
    }

    /// The surname a tag gives a full name, a suffix kept: "Mikel Brown Jr."
    /// → "Brown Jr.", "Kenneth Walker III" → "Walker III", "Alysson" →
    /// "Alysson". (pure; tested)
    static func surname(_ full: String) -> String {
        let words = afterInitials(full).split(separator: " ").map(String.init)
        guard let last = words.last else { return full }
        if ["Jr.", "Sr.", "Jr", "Sr", "II", "III", "IV", "V"].contains(last), words.count >= 2 { return words[words.count - 2] + " " + last }
        return last
    }

    /// A short name past its initials: "V. Mesa Jr." → "Mesa Jr.", "S.Barkley" → "Barkley".
    static func afterInitials(_ name: String) -> String {
        var rest = Substring(name.trimmingCharacters(in: .whitespaces))
        while let dot = rest.firstIndex(of: "."), rest.distance(from: rest.startIndex, to: dot) <= 2,
              rest[..<dot].allSatisfy(\.isLetter), rest.index(after: dot) < rest.endIndex {
            rest = rest[rest.index(after: dot)...].drop { $0 == " " }
        }
        return rest.isEmpty ? name : String(rest)
    }
}

/// The players a game's summary names, by ESPN athlete ID: parsed once per
/// summary (`ESPNDetail.load`), read by the theaters' casts.
enum TheaterPeople {
    /// Everyone in the box score, with his number and position where it
    /// gives them (basketball's and football's do; baseball's has positions,
    /// no numbers). (pure; tested)
    static func boxscore(_ summary: JSON) -> [String: TheaterPerson] {
        var out: [String: TheaterPerson] = [:]
        for team in summary["boxscore"]["players"].array {
            for group in team["statistics"].array {
                for entry in group["athletes"].array {
                    let a = entry["athlete"]
                    guard let id = a["id"].string, out[id] == nil, let person = TheaterPerson(athlete: a) else { continue }
                    out[id] = person
                }
            }
        }
        return out
    }

    /// Everyone on the summary's rosters (baseball's lineups, soccer's
    /// squads): his number and position there, over the box score's.
    static func rosters(_ summary: JSON) -> [String: TheaterPerson] {
        var out: [String: TheaterPerson] = [:]
        for team in summary["rosters"].array {
            for entry in team["roster"].array {
                let a = entry["athlete"]
                guard let id = a["id"].string,
                      let person = TheaterPerson(athlete: a, number: entry["jersey"].string, position: entry["position"]["abbreviation"].string)
                else { continue }
                out[id] = person
            }
        }
        return out
    }
}

/// Who a figure is, as far as the data says: never more.
enum TheaterWho: Equatable {
    /// Named: the play credits him, or the lineup puts him where he's drawn.
    case known(TheaterPerson)
    /// A man the theater placed without data: his team and his position
    /// are all that's known ("SEAHAWKS · DE").
    case assumed(String)
    /// On the field for his team; which of them isn't known ("JAZZ").
    case team

    var person: TheaterPerson? { if case let .known(p) = self { return p }; return nil }
}

/// Who each figure of a script is, for his side, and who the moment is
/// about: what a sport's theater says about its figures, built once per
/// script. Officials, umpires and coaches aren't in it (no tag, ever).
struct TheaterCast: Equatable {
    struct Member: Equatable {
        var who: TheaterWho
        var side: GameDetail.Side
        /// Who he is across scripts (his athlete ID when he's named), so the
        /// pointer's tag stays with the man, not the figure's number in the
        /// next beat's script; a man the data can't name is his figure's own.
        var id: String
    }

    /// The key man from a moment on (nil figure: nobody), in order.
    struct Key: Equatable {
        var from: Double
        var figure: Int?
    }

    /// By figure (the script's index).
    var members: [Int: Member] = [:]
    var keys: [Key] = []

    init(members: [Int: Member] = [:], keys: [Key] = []) {
        self.members = members
        self.keys = keys
    }

    /// One key man for the whole moment.
    init(members: [Int: Member], key: Int?) {
        self.init(members: members, keys: key.map { [Key(from: -.infinity, figure: $0)] } ?? [])
    }

    /// A named man's member, or one the data knows less about (`scope`: the
    /// script's own, so an unnamed figure is never mistaken for another's).
    static func member(_ who: TheaterWho, side: GameDetail.Side, athlete: String?, figure: Int, scope: String) -> Member {
        if case .known = who, let athlete, !athlete.isEmpty { return Member(who: who, side: side, id: "a:\(athlete)") }
        return Member(who: who, side: side, id: "\(scope)#\(figure)")
    }

    /// The man the moment is about at t: never one the data doesn't name.
    func key(at t: Double) -> Int? {
        guard let figure = keys.last(where: { t >= $0.from })?.figure, members[figure]?.who.person != nil else { return nil }
        return figure
    }

    /// The figure a member's id is, in this script.
    func figure(_ id: String?) -> Int? {
        guard let id else { return nil }
        return members.first { $0.value.id == id }?.key
    }
}

/// How each side's tags look: its name (all a man the data can't name
/// says) and the slab's paint, in the color its figures wear (a team
/// dressed in its second color is labeled in it, so a tag never reads as
/// the other side's).
struct TheaterLabels: Equatable {
    struct Label: Equatable {
        /// "Seahawks": the tag capitalizes it.
        var team: String
        var paint: SlidePaint
    }

    var top: Label
    var bottom: Label

    subscript(side: GameDetail.Side) -> Label { side == .top ? top : bottom }

    /// From the kits as `TheaterTeams.dress` wears them on this panel: the
    /// slab in the shirt's own color as it's drawn (black lifted to a gray on
    /// a dark panel, as the figures are), the stripe in the team's other
    /// color; a team in its second color striped in its own; a team in
    /// whites labeled in its own color. (pure; tested)
    static func make(kits: TheaterKits?, scheme: ColorScheme, teams: (top: String, bottom: String)) -> TheaterLabels {
        guard let kits else {
            return TheaterLabels(top: Label(team: teams.top, paint: .team(nil, alternate: nil)), bottom: Label(team: teams.bottom, paint: .team(nil, alternate: nil)))
        }
        let dressed = TheaterTeams.dress(kits, scheme: scheme)
        func paint(_ worn: Uniform, _ kit: TeamKit, _ side: GameDetail.Side) -> SlidePaint {
            switch dressed.rule {
            case .second(side): return SlidePaint.team(OKLab(NSColor(worn.jersey))?.hex ?? kit.alternate, alternate: kit.color)
            case .whites(side): return SlidePaint.team(kit.color, alternate: kit.alternate)
            default: return SlidePaint.team(OKLab(NSColor(worn.jersey))?.hex ?? kit.color, alternate: kit.alternate)
            }
        }
        return TheaterLabels(top: Label(team: teams.top, paint: paint(dressed.top, kits.top, .top)),
                             bottom: Label(team: teams.bottom, paint: paint(dressed.bottom, kits.bottom, .bottom)))
    }
}

// MARK: - The pointer

/// The pointer over a theater: the man it's over (a cast member's id), and
/// his tag's comings and goings. Changed only when the pointer crosses to
/// another man; everything else is a function of the time. (pure; tested)
struct TheaterPointer: Equatable {
    var over: String?
    var since = Date.distantPast
    /// Came in from no tag (it fades in); else it swapped in at once.
    var fades = false
    /// The tag leaving as the pointer left its man, since when.
    var leaving: String?
    var left = Date.distantPast

    static let fadeIn = 0.12
    static let fadeOut = 0.1
    /// The rise as it fades in, in points.
    static let rise: CGFloat = 2

    /// Onto a man (or off every one): whether anything changed.
    @discardableResult
    mutating func move(to id: String?, at date: Date) -> Bool {
        guard id != over else { return false }
        if let id {
            // Straight from another man (or one still leaving): at once, as tooltips after the first.
            let showing = over != nil || (leaving != nil && date.timeIntervalSince(left) < Self.fadeOut)
            over = id
            since = date
            fades = !showing
            leaving = nil
        } else {
            leaving = over
            left = date
            over = nil
        }
        return true
    }

    /// How far the pointer's tag has come in at `date` (0…1, eased out).
    func appear(at date: Date) -> Double {
        guard fades else { return 1 }
        return Motion.curve.value(at: min(max(date.timeIntervalSince(since) / Self.fadeIn, 0), 1))
    }

    /// How much of the leaving tag is left at `date` (1…0, eased out).
    func remaining(at date: Date) -> Double {
        guard leaving != nil else { return 0 }
        return 1 - Motion.curve.value(at: min(max(date.timeIntervalSince(left) / Self.fadeOut, 0), 1))
    }

    /// A tag is still coming in or going: the stage animates until it's done.
    func fading(at date: Date) -> Bool {
        (fades && over != nil && date.timeIntervalSince(since) < Self.fadeIn)
            || (leaving != nil && date.timeIntervalSince(left) < Self.fadeOut)
    }

    /// Long enough for whatever's fading now to finish.
    static let settle = max(fadeIn, fadeOut) + 0.02
}

// MARK: - What a frame draws

/// The tags a frame draws over its figures: the pointer's (the full tag),
/// one leaving, and the key man's (his surname). Built by the stage for each
/// frame; compared with it, so a hover change redraws one still frame.
struct TheaterTags: Equatable {
    var cast = TheaterCast()
    var labels: TheaterLabels?
    /// The pointer's man and how far in his tag is; the one leaving and how much of it is left.
    var over: String?
    var appear = 1.0
    var leaving: String?
    var remaining = 0.0
    /// Reduce Motion: a fade, no rise.
    var rise = true
    /// What to keep clear of: the status tag's words, the turn control (up
    /// while the pointer's over the theater), the heartbeat's corner.
    var status: String?
    var flip = false
    var heartbeat: HorizontalEdge? = .trailing

    init() {}

    init(cast: TheaterCast, labels: TheaterLabels, pointer: TheaterPointer, at date: Date, reduceMotion: Bool, status: String?,
         flip: Bool, heartbeat: HorizontalEdge? = .trailing) {
        self.cast = cast
        self.labels = labels
        over = pointer.over
        appear = pointer.appear(at: date)
        leaving = pointer.leaving
        remaining = pointer.remaining(at: date)
        rise = !reduceMotion
        self.status = status
        self.flip = flip
        self.heartbeat = heartbeat
    }

    enum Symbol: Hashable { case pointer, leaving, key, status }

    /// A figure as drawn: what a tag stands over.
    struct Figure {
        var index: Int
        var figure: RigFigure
        /// His height standing, in points.
        var height: CGFloat
        /// As he fades in or out (coming on, going off): his tag with him.
        var opacity = 1.0
    }

    /// The tag's type size, from the well's height: a step under the status tag's.
    static func type(_ size: CGSize) -> CGFloat { min(max(size.height * 0.046, 9), 11.5) }

    /// Who's tagged at t: the pointer's man, the one leaving, the key man (not when the pointer's on him).
    func shown(at t: Double) -> (pointer: Int?, leaving: Int?, key: Int?) {
        let pointer = cast.figure(over)
        let leaving = remaining > 0.01 ? cast.figure(self.leaving).flatMap { $0 == pointer ? nil : $0 } : nil
        let key = cast.key(at: t).flatMap { $0 == pointer ? nil : $0 }
        return (pointer, leaving, key)
    }

    /// The tags' views, laid out once per frame and drawn where they go.
    @ViewBuilder
    func symbols(at t: Double, size: CGSize) -> some View {
        if let labels {
            let type = Self.type(size)
            let (pointer, leaving, key) = shown(at: t)
            if let i = pointer, let m = cast.members[i] { TheaterNameTag(who: m.who, label: labels[m.side], full: true, size: type).tag(Symbol.pointer) }
            if let i = leaving, let m = cast.members[i] { TheaterNameTag(who: m.who, label: labels[m.side], full: true, size: type).tag(Symbol.leaving) }
            if let i = key, let m = cast.members[i] { TheaterNameTag(who: m.who, label: labels[m.side], full: false, size: type).tag(Symbol.key) }
            if pointer != nil || leaving != nil || key != nil, let status, !status.isEmpty {
                TheaterStatusTag.measure(status, height: size.height).tag(Symbol.status)
            }
        }
    }

    /// Draws the tags over their men: placed (the pointer's first), faded
    /// and risen as they come and go. `clear`: the frame's own type to keep
    /// clear of (its stamp, its headline).
    func draw(_ figures: [Figure], t: Double, size: CGSize, clear: [CGRect] = [], in context: GraphicsContext) {
        guard labels != nil else { return }
        let (pointer, leaving, key) = shown(at: t)
        guard pointer != nil || leaving != nil || key != nil else { return }
        let status = context.resolveSymbol(id: Symbol.status)?.size
        let furniture = TheaterTagLayout.furniture(size, status: status, flip: flip, heartbeat: heartbeat) + clear
        var asks: [(Symbol, GraphicsContext.ResolvedSymbol, TheaterTagLayout.Ask)] = []
        var seen: [Symbol: Double] = [:]
        for (id, index) in [(Symbol.pointer, pointer), (.leaving, leaving), (.key, key)] {
            guard let index, let f = figures.first(where: { $0.index == index }), let symbol = context.resolveSymbol(id: id) else { continue }
            seen[id] = f.opacity
            asks.append((id, symbol, TheaterTagLayout.Ask(size: symbol.size, head: CGPoint(x: f.figure.head.x, y: Self.top(f.figure)),
                                                           feet: f.figure.ground.y + max(f.height * 0.1, 2), pointer: id != .key)))
        }
        let spots = TheaterTagLayout.place(asks.map(\.2), in: size, clear: furniture)
        // The key man's first, the leaving tag over it, the pointer's on top.
        for k in asks.indices.reversed() {
            guard let rect = spots[k] else { continue }
            var layer = context
            layer.opacity = seen[asks[k].0] ?? 1
            var lift: CGFloat = 0
            switch asks[k].0 {
            case .pointer:
                layer.opacity *= appear
                if rise { lift = TheaterPointer.rise * CGFloat(1 - appear) }
            case .leaving:
                layer.opacity *= remaining
            default:
                break
            }
            guard layer.opacity > 0.005 else { continue }
            layer.draw(asks[k].1, in: rect.offsetBy(dx: 0, dy: lift))
        }
    }

    /// The top of a figure: his head, or a hand raised over it.
    static func top(_ f: RigFigure) -> CGFloat {
        var y = f.head.y - f.headRadius
        for l in f.limbs where l.arm { y = min(y, l.end.y - f.limb / 2, l.joint.y - f.limb / 2) }
        return y
    }
}

// MARK: - Placement

/// Where tags go. (pure; tested)
enum TheaterTagLayout {
    /// What a tag asks for: its size, the top of its man's head (and his
    /// middle), where under his feet it could go, and whether it's the pointer's.
    struct Ask: Equatable {
        var size: CGSize
        var head: CGPoint
        var feet: CGFloat
        var pointer: Bool
    }

    /// From the well's edges.
    static let margin: CGFloat = 4
    /// Between a tag and his head (or his feet), and round another tag.
    static let gap: CGFloat = 3

    /// Each tag's place, in order (the pointer's first: it wins). Over his
    /// head, inside the well and clear of the furniture; else under his feet
    /// (first, when he's too near the top for a tag over him); else slid
    /// along off what's in the way. The pointer's always shows;
    /// any other only where it's clear of the furniture and the tags already
    /// placed, else not at all (it waits for the room). A man out of the
    /// well gets none.
    static func place(_ asks: [Ask], in size: CGSize, clear furniture: [CGRect]) -> [CGRect?] {
        var placed: [CGRect] = []
        var out: [CGRect?] = []
        let well = CGRect(origin: .zero, size: size)
        for ask in asks {
            guard well.insetBy(dx: -2, dy: -ask.size.height).contains(ask.head) || well.contains(CGPoint(x: ask.head.x, y: ask.feet)) else {
                out.append(nil)
                continue
            }
            func free(_ r: CGRect) -> Bool {
                !furniture.contains { $0.intersects(r) } && !placed.contains { $0.insetBy(dx: -gap, dy: -gap + 1).intersects(r) }
            }
            let above = CGRect(x: ask.head.x - ask.size.width / 2, y: ask.head.y - gap - ask.size.height, width: ask.size.width, height: ask.size.height)
            let below = CGRect(x: above.minX, y: ask.feet + gap, width: ask.size.width, height: ask.size.height)
            let over = clamp(above, in: size), under = clamp(below, in: size)
            // Kept inside the well by more than a hair, a tag would sit on his own head (or feet): only a side with room
            // (the pointer's goes anywhere as a last resort).
            let sides = (above.minY >= margin - 1 ? [over] : []) + (below.maxY <= size.height - margin + 1 ? [under] : [])
            var candidates = sides + sides.map { slid($0, off: furniture, in: size) }
            if ask.pointer { candidates += [over, under, slid(over, off: furniture, in: size), slid(under, off: furniture, in: size)] }
            if let spot = candidates.first(where: free) {
                placed.append(spot)
                out.append(spot)
            } else if ask.pointer {
                // The pointer's tag always shows: off the furniture if it can be, over the others.
                let spot = candidates.first { r in !furniture.contains { $0.intersects(r) } } ?? over
                placed.append(spot)
                out.append(spot)
            } else {
                out.append(nil)
            }
        }
        return out
    }

    /// Slid along off whatever furniture it meets, toward the middle, and kept in the well.
    static func slid(_ rect: CGRect, off furniture: [CGRect], in size: CGSize) -> CGRect {
        var r = rect
        for f in furniture where f.intersects(r) {
            r.origin.x = r.midX > f.midX ? f.maxX + 2 : f.minX - 2 - r.width
            r = clamp(r, in: size)
        }
        return r
    }

    /// Kept inside the well, `margin` from its edges.
    static func clamp(_ rect: CGRect, in size: CGSize) -> CGRect {
        var r = rect
        r.origin.x = min(max(r.origin.x, margin), max(size.width - margin - r.width, margin))
        r.origin.y = min(max(r.origin.y, margin), max(size.height - margin - r.height, margin))
        return r
    }

    /// The theater's furniture: the status tag at the top leading corner
    /// (`status`: its size), the turn control at the top trailing one while
    /// the pointer's over the theater, the heartbeat at a bottom corner.
    static func furniture(_ size: CGSize, status: CGSize?, flip: Bool, heartbeat: HorizontalEdge?) -> [CGRect] {
        var out: [CGRect] = []
        if let status { out.append(CGRect(x: 0, y: 8, width: status.width + 2, height: status.height + 2)) }
        if flip { out.append(CGRect(x: size.width - 32, y: 2, width: 30, height: 30)) }
        switch heartbeat {
        case .trailing?: out.append(CGRect(x: size.width - 76, y: size.height - 24, width: 74, height: 22))
        case .leading?: out.append(CGRect(x: 2, y: size.height - 24, width: 74, height: 22))
        case nil: break
        }
        return out
    }

    /// The stamp's room once it's up: `symbol` its size, low at a corner `inset` in.
    static func stamp(_ symbol: CGSize, in size: CGSize, inset: CGFloat, trailing: Bool = false) -> CGRect {
        let bottom = size.height - inset * 0.8
        return CGRect(x: trailing ? size.width - inset - symbol.width : inset, y: bottom - symbol.height, width: symbol.width, height: symbol.height)
    }

    /// The headline's room while it's up: centered across the top.
    static func banner(_ symbol: CGSize, in size: CGSize) -> CGRect {
        let inset = TheaterType.inset(size)
        return CGRect(x: (size.width - symbol.width) / 2, y: inset * 0.7, width: symbol.width, height: symbol.height)
    }
}

// MARK: - Hit test

extension TheaterTags {
    /// The figure under the pointer: of the boxes round each figure (from
    /// his ground point, his height up, never narrower than a fingertip),
    /// the one nearest the lens that holds it. `figures`: each figure's
    /// script index, the screen point under him and his height there, from
    /// the script at t (no posing). (pure; tested)
    static func hit(_ figures: [(index: Int, ground: CGPoint, height: CGFloat)], at p: CGPoint) -> Int? {
        var best: (index: Int, depth: CGFloat)?
        for f in figures {
            let w = max(f.height * 0.62, 10), h = max(f.height * 1.14, 16)
            let box = CGRect(x: f.ground.x - w / 2, y: f.ground.y - h + f.height * 0.06, width: w, height: h)
            guard box.contains(p) else { continue }
            // Lower on screen is nearer: he's drawn over whoever's behind.
            if f.ground.y > best?.depth ?? -.infinity { best = (f.index, f.ground.y) }
        }
        return best?.index
    }
}

// MARK: - The tag

/// One tag, as the status tag draws its type: SF Pro Condensed Black
/// slanted 12° on a slab cut on the same lean, in the color he wears. Under
/// the pointer (`full`), his number leads on the team's other color and his
/// position follows; at rest, his surname alone. A man the data can't name
/// says what's known on a fainter slab: his team and his position, or his team.
struct TheaterNameTag: View {
    let who: TheaterWho
    let label: TheaterLabels.Label
    let full: Bool
    let size: CGFloat

    var body: some View {
        let h = size * 1.6, lean = h * SlideMetrics.lean
        let paint = label.paint
        let type = Font.system(size: size, weight: .black).width(.condensed)
        switch who {
        case let .known(p):
            HStack(spacing: 0) {
                if full, let n = p.number {
                    Text(n)
                        .font(type)
                        .tracking(size * 0.04)
                        .foregroundStyle(paint.stripeInk)
                        .oblique()
                        .padding(.leading, size * 0.55 + lean * 0.5)
                        .padding(.trailing, size * 0.45 + lean)
                        .frame(height: h)
                        .background(LeanShape().fill(paint.stripeColor))
                        .zIndex(1)
                }
                HStack(spacing: size * 0.4) {
                    Text(p.last.uppercased()).font(type).tracking(size * 0.06)
                    if full, let position = p.position {
                        Text(position).font(.system(size: size * 0.86, weight: .heavy).width(.condensed)).opacity(0.72)
                    }
                }
                .foregroundStyle(paint.ink)
                .oblique()
                .padding(.leading, size * 0.55 + lean)
                .padding(.trailing, size * 0.6 + lean * 0.5)
                .frame(height: h)
                .background(LeanShape().fill(paint.slabColor))
                .padding(.leading, full && p.number != nil ? -lean : 0)
            }
            .lineLimit(1)
            .fixedSize()
        case let .assumed(position):
            faint(position.isEmpty ? label.team.uppercased() : "\(label.team.uppercased()) · \(position)", h: h, lean: lean)
        case .team:
            faint(label.team.uppercased(), h: h, lean: lean)
        }
    }

    /// What's known of a man the data can't name, on a fainter slab.
    private func faint(_ text: String, h: CGFloat, lean: CGFloat) -> some View {
        Text(text)
            .font(.system(size: size, weight: .bold).width(.condensed))
            .tracking(size * 0.06)
            .foregroundStyle(label.paint.ink.opacity(0.85))
            .oblique()
            .lineLimit(1)
            .padding(.horizontal, size * 0.55 + lean)
            .frame(height: h)
            .background(LeanShape().fill(label.paint.slabColor.opacity(0.7)))
            .fixedSize()
    }
}

extension TheaterStatusTag {
    /// The status tag's room, laid out as it lays out its words (never drawn): what a name tag keeps clear of.
    static func measure(_ tag: String, height: CGFloat) -> some View {
        let size = size(for: height)
        return Text(tag)
            .font(.system(size: size, weight: .black).width(.condensed))
            .tracking(size * 0.06)
            .textCase(.uppercase)
            .lineLimit(1)
            .padding(.leading, size * 0.75)
            .padding(.trailing, size * 1.6 * SlideMetrics.lean + size * 0.7)
            .frame(height: size * 1.6)
            .fixedSize()
            .hidden()
    }
}

// MARK: - The stage's pointer

extension View {
    /// While a tag fades in or out, `fading` is up: the stage draws frames
    /// until it's done (still again after, nothing redrawn while nothing moves).
    func theaterFading(_ pointer: TheaterPointer, _ fading: Binding<Bool>) -> some View {
        task(id: pointer) {
            guard pointer.fading(at: .now) else {
                if fading.wrappedValue { fading.wrappedValue = false }
                return
            }
            fading.wrappedValue = true
            try? await Task.sleep(for: .seconds(TheaterPointer.settle))
            guard !Task.isCancelled else { return }
            fading.wrappedValue = false
        }
    }

    /// Follows the pointer over a theater's well: on each move, the figure
    /// under it (`figure`: the sport's hit test at the frame on screen) as
    /// the cast's member, kept in `pointer` only when it crosses to another
    /// man; off every figure (or out of the well), the tag goes. An official
    /// or a coach under it names nobody.
    func theaterPointer(_ pointer: Binding<TheaterPointer>, cast: TheaterCast, figure: @escaping (CGPoint) -> Int?) -> some View {
        onContinuousHover(coordinateSpace: .local) { phase in
            let id: String?
            switch phase {
            case let .active(location): id = figure(location).flatMap { cast.members[$0]?.id }
            case .ended: id = nil
            }
            if id != pointer.wrappedValue.over { pointer.wrappedValue.move(to: id, at: .now) }
        }
    }
}
