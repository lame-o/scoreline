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
// A tag and the play never block each other. A tag sits where the other
// men and the ball cover it least through its stretch of the replay (over
// his head, nudged aside, or under his feet, with a hairline to him once
// it's off his head), chosen once for the stretch from the script alone,
// so it rides with him and never wanders; and it lies on the surface, over
// the field and its shadows and under everything that plays (every figure,
// the ball and its path, a goal or a hoop). Where a figure or the ball
// still crosses one (a runner passing through), a thin ring round him over
// the tag alone (his own silhouette grown a little), in the surface's
// color as a chart's ring is (the slab cut away round him; white in the
// light, as the owner asked), keeps his colors off the slab's. A tag
// nothing crosses, over a man nothing crowds, draws as it always has.
//
// Motion, Emil's and Apple's way: a tag fades in over 120 ms with a 2 pt
// rise, ease-out, and leaves faster (100 ms); moving straight from one man
// to the next swaps at once, as tooltips do after the first; with Reduce
// Motion it fades without the rise. A tag never moves on its own while the
// pointer is still: the stage keeps only who the pointer is over, changed
// when it crosses to another man. The key man's tag, when the moment
// passes to the next man, glides over to him in 200 ms on a strong
// ease-in-out, the names crossfading (a crossfade alone with Reduce
// Motion), a function of t like everything else in the frame.

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
    /// The script's own (the stage's key for it): where its tags sit is chosen once for it.
    var scope = ""

    init(members: [Int: Member] = [:], keys: [Key] = [], scope: String = "") {
        self.members = members
        self.keys = keys
        self.scope = scope
    }

    /// One key man for the whole moment.
    init(members: [Int: Member], key: Int?, scope: String = "") {
        self.init(members: members, keys: key.map { [Key(from: -.infinity, figure: $0)] } ?? [], scope: scope)
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

    /// The stretch of the script the key man at t is key through: until the next one.
    func stretch(at t: Double) -> Range<Double> {
        guard let i = keys.lastIndex(where: { t >= $0.from }) else { return -.infinity..<(keys.first?.from ?? .infinity) }
        return keys[i].from..<(i + 1 < keys.count ? keys[i + 1].from : .infinity)
    }

    /// How long the key man's tag takes to go over to the next one (or to come, or to go).
    static let handoff = 0.2

    /// Just after the key man changes, the tag on its way from the last one:
    /// who had it (nil: nobody named) and through what stretch, and how far
    /// it's come (0…1, eased in and out, as a move across the well is). Nil
    /// once it's there.
    func handoff(at t: Double) -> (from: Int?, stretch: Range<Double>, u: Double)? {
        guard let i = keys.lastIndex(where: { t >= $0.from }), i > 0, keys[i].from.isFinite, t - keys[i].from < Self.handoff else { return nil }
        let from = keys[i - 1].figure.flatMap { members[$0]?.who.person != nil ? $0 : nil }
        guard from != nil || key(at: t) != nil else { return nil }
        return (from, keys[i - 1].from..<keys[i].from, Celebrate.sweepCurve.value(at: (t - keys[i].from) / Self.handoff))
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

/// The tags a frame draws under its figures: the pointer's (the full tag),
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

    enum Symbol: Hashable { case pointer, leaving, key, handoff, status }

    /// A figure as drawn: what a tag stands over, or crosses.
    struct Figure {
        var index: Int
        var figure: RigFigure
        /// His height standing, in points.
        var height: CGFloat
        /// As he fades in or out (coming on, going off): his tag with him.
        var opacity = 1.0
        /// As he's drawn, when that's fainter still (a man fading under the stamp): his ring with him.
        var drawn: Double?
        /// What he holds out past his silhouette (the batter's bat): its line, and its width outline and all.
        var held: (line: Path, width: CGFloat)?
    }

    /// The ball as drawn: its shape (the disc and its edge, a football's
    /// oval), the height of a man where it is (its ring's as wide as his),
    /// how faint.
    struct Ball {
        var shape: Path
        var height: CGFloat
        var opacity = 1.0
    }

    /// What parts a figure (or the ball) from a tag he crosses: a ring in
    /// a paint, or the slab cut away round him so the surface under it shows.
    enum Ring: Equatable {
        case paint(Color)
        case cutout
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

    /// The key man's tag on its way over from the last one at t (not the pointer's man's).
    func handoff(at t: Double) -> (from: Int?, stretch: Range<Double>, u: Double)? {
        guard let h = cast.handoff(at: t) else { return nil }
        return (h.from.flatMap { $0 == cast.figure(over) ? nil : $0 }, h.stretch, h.u)
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
            if let i = handoff(at: t)?.from, i != key, let m = cast.members[i] {
                TheaterNameTag(who: m.who, label: labels[m.side], full: false, size: type).tag(Symbol.handoff)
            }
            if pointer != nil || leaving != nil || key != nil, let status, !status.isEmpty {
                TheaterStatusTag.measure(status, height: size.height).tag(Symbol.status)
            }
        }
    }

    /// Draws the tags under the play, round their men: placed (the
    /// pointer's first, each where its stretch of the `replay` covers it
    /// least, a hairline to him when that's off his head), faded and risen as
    /// they come and go, the key man's gliding over to the next, ringed where
    /// a figure or the ball crosses one. Drawn after the surface and its
    /// shadows, before everything that plays. `clear`: the frame's own type to
    /// keep clear of (its stamp, its headline).
    func draw(_ figures: [Figure], ball: Ball? = nil, t: Double, size: CGSize, clear: [CGRect] = [], ring: Ring, replay: TheaterReplay? = nil,
              in context: GraphicsContext) {
        guard let labels else { return }
        let (pointer, leaving, key) = shown(at: t), glide = handoff(at: t)
        guard pointer != nil || leaving != nil || key != nil || glide?.from != nil else { return }
        let status = context.resolveSymbol(id: Symbol.status)?.size
        let furniture = TheaterTagLayout.furniture(size, status: status, flip: flip, heartbeat: heartbeat) + clear
        // Each tag's ask, its spot its stretch's (the key man's while he's key; the pointer's man's the whole replay).
        func ask(_ id: Symbol, _ index: Int?) -> Tag? {
            let symbolID = id == .handoff && index == key ? Symbol.key : id
            guard let index, let f = figures.first(where: { $0.index == index }), let member = cast.members[index],
                  let symbol = context.resolveSymbol(id: symbolID) else { return nil }
            let stretch = switch id {
            case .key: cast.stretch(at: t)
            case .handoff: glide?.stretch ?? cast.stretch(at: t)
            default: -Double.infinity..<Double.infinity
            }
            let spot = replay.map {
                TheaterTagPlan.spot(index, tag: symbol.size, pointer: id != .key && id != .handoff, over: stretch, in: size, heartbeat: heartbeat,
                                    replay: $0, scope: cast.scope)
            } ?? TheaterTagSpot()
            return Tag(id: id, symbol: symbol, man: f, member: member, spot: spot,
                       ask: TheaterTagLayout.Ask(size: symbol.size, head: CGPoint(x: f.figure.head.x, y: Self.top(f.figure)), feet: Self.feet(f),
                                                 pointer: id != .key && id != .handoff, spot: spot))
        }
        let tags = [ask(.pointer, pointer), ask(.leaving, leaving), ask(.key, key)].compactMap { $0 }
        let spots = TheaterTagLayout.place(tags.map(\.ask), in: size, clear: furniture)
        // The last key man's tag where it was before the change (placed as if the new one weren't there yet).
        var from: (tag: Tag, rect: CGRect)?
        if let glide, let last = ask(.handoff, glide.from) {
            let before = tags.filter { $0.id != .key } + [last]
            from = TheaterTagLayout.place(before.map(\.ask), in: size, clear: furniture).last.flatMap { $0 }.map { (last, $0) }
        }
        // The key man's first, the leaving tag over it, the pointer's on top.
        for k in tags.indices.reversed() {
            let tag = tags[k]
            var opacity = tag.man.opacity
            var lift: CGFloat = 0
            switch tag.id {
            case .pointer:
                opacity *= appear
                if rise { lift = TheaterPointer.rise * CGFloat(1 - appear) }
            case .leaving:
                opacity *= remaining
            default:
                break
            }
            guard var rect = spots[k] else { continue }
            rect = rect.offsetBy(dx: 0, dy: lift)
            guard tag.id == .key, let glide else {
                put(tag, at: rect, opacity: opacity, leader: 1, labels: labels, figures: figures, ball: ball, ring: ring, in: context)
                continue
            }
            // Coming over from the last key man: gliding from his tag's place to this one's, the names crossfading (with
            // Reduce Motion, a crossfade where each stands); or fading in.
            let u = glide.u
            if case let (last, was)? = from {
                func at(_ r: CGRect) -> CGRect {
                    guard rise else { return r }
                    let x = was.midX + (rect.midX - was.midX) * u, y = was.midY + (rect.midY - was.midY) * u
                    return CGRect(x: x - r.width / 2, y: y - r.height / 2, width: r.width, height: r.height)
                }
                put(last, at: at(was), opacity: last.man.opacity * (1 - u), leader: max(1 - u / 0.4, 0), labels: labels, figures: figures, ball: ball,
                    ring: ring, in: context)
                put(tag, at: at(rect), opacity: opacity * u, leader: max((u - 0.6) / 0.4, 0), labels: labels, figures: figures, ball: ball, ring: ring,
                    in: context)
            } else {
                put(tag, at: rect, opacity: opacity * u, leader: u, labels: labels, figures: figures, ball: ball, ring: ring, in: context)
            }
        }
        // The last key man's going with nobody after him: it fades where it stands.
        if key == nil, let glide, case let (last, was)? = from {
            put(last, at: was, opacity: last.man.opacity * (1 - glide.u), leader: 1, labels: labels, figures: figures, ball: ball, ring: ring, in: context)
        }
    }

    /// A tag being drawn: which, its man, where round him its stretch put it, and what it asked of placement.
    private struct Tag {
        var id: Symbol
        var symbol: GraphicsContext.ResolvedSymbol
        var man: Figure
        var member: TheaterCast.Member
        var spot: TheaterTagSpot
        var ask: TheaterTagLayout.Ask
    }

    /// One tag at `rect`: its hairline to him when its spot's off his head
    /// (`leader`: how much of it), and the room round whoever crosses it.
    private func put(_ tag: Tag, at rect: CGRect, opacity: Double, leader: Double, labels: TheaterLabels, figures: [Figure], ball: Ball?, ring: Ring,
                     in context: GraphicsContext) {
        guard opacity > 0.005 else { return }
        var layer = context
        layer.opacity = opacity
        let line = tag.spot == TheaterTagSpot() || leader < 0.01 ? nil : Self.leader(from: rect, to: tag.ask, ground: tag.man.figure.ground.y)
        let slab = labels[tag.member.side].paint.slabColor.opacity(tag.member.who.person == nil ? 0.7 : 1)
        func drawn(_ c: GraphicsContext) {
            if let line {
                var hairline = c
                hairline.opacity *= leader
                hairline.stroke(line, with: .color(slab), style: StrokeStyle(lineWidth: Self.hairline, lineCap: .round))
            }
            c.draw(tag.symbol, in: rect)
        }
        // Who crosses the tag itself (its hairline runs under them, into him).
        let crossing = Self.crossing(figures, ball: ball, tag: rect, own: tag.man.index)
        guard !crossing.figures.isEmpty || crossing.ball else { return drawn(layer) }
        switch ring {
        case let .paint(color):
            // A ring in a paint: round each man over the tag, faded with it (and with him).
            drawn(layer)
            var over = layer
            over.clip(to: Self.shape(rect))
            for i in crossing.figures {
                let f = figures[i]
                var c = over
                c.opacity *= f.drawn ?? f.opacity
                c.fill(TheaterDraw.outline(f.figure, grown: TheaterDraw.halo(f.height) + Self.ring(f.height)), with: .color(color))
                if let held = f.held {
                    c.stroke(held.line, with: .color(color), style: StrokeStyle(lineWidth: held.width + 2 * Self.ring(f.height), lineCap: .round))
                }
            }
            if crossing.ball, let ball {
                var c = over
                c.opacity *= ball.opacity
                c.fill(ball.shape, with: .color(color))
                c.stroke(ball.shape, with: .color(color), style: StrokeStyle(lineWidth: 2 * Self.ring(ball.height), lineJoin: .round))
            }
        case .cutout:
            // The tag with each man's room cut out of it, so the surface shows round him: a clip, as the charts leave
            // room round their marks (never a blend, which would punch through the glass). One fading in or out
            // takes his room with him: the tag there at what's left.
            let rooms = crossing.figures.map { (Self.room(figures[$0]), figures[$0].drawn ?? figures[$0].opacity) }
                + (crossing.ball ? ball.map { [(Self.room($0), $0.opacity)] } ?? [] : [])
            let all = rooms.dropFirst().reduce(rooms.first?.0 ?? Path()) { $0.union($1.0) }
            var cut = layer
            cut.clip(to: Path((line.map { rect.union($0.boundingRect) } ?? rect).insetBy(dx: -1, dy: -1)).subtracting(all))
            drawn(cut)
            for (room, seen) in rooms where seen < 0.99 {
                var faint = layer
                faint.clip(to: room)
                faint.opacity *= 1 - seen
                drawn(faint)
            }
        }
    }

    /// A leader's width: a hairline.
    static let hairline: CGFloat = 0.75

    /// A tag's hairline to its man when its spot's off his head: from the
    /// tag's edge nearest him (under his head, or over his feet), straight to
    /// him, a little into him (he's drawn over it). (pure; tested)
    static func leader(from rect: CGRect, to ask: TheaterTagLayout.Ask, ground: CGFloat) -> Path {
        let lean = rect.height * SlideMetrics.lean, under = rect.minY >= ask.feet - 0.5
        // Along the edge it leaves from, inside the slab's cut corners.
        let x = under ? min(max(ask.head.x, rect.minX + lean + 1), rect.maxX - 1) : min(max(ask.head.x, rect.minX + 1), rect.maxX - lean - 1)
        var path = Path()
        path.move(to: CGPoint(x: x, y: under ? rect.minY : rect.maxY))
        path.addLine(to: CGPoint(x: ask.head.x, y: under ? ground : ask.head.y + 1))
        return path
    }

    // MARK: Crossing

    /// The ring's width past a man's own outline, `height` tall: about
    /// 1.5 pt at the compact panel, with his line weight.
    static func ring(_ height: CGFloat) -> CGFloat { max(height * 0.06, 1.1) }

    /// The room round a man a tag leaves him: his silhouette grown by his
    /// outline and the ring (what he holds too, a bat).
    static func room(_ f: Figure) -> Path {
        let margin = ring(f.height), outline = TheaterDraw.outline(f.figure, grown: TheaterDraw.halo(f.height) + margin)
        guard let held = f.held else { return outline }
        return outline.union(held.line.strokedPath(StrokeStyle(lineWidth: held.width + 2 * margin, lineCap: .round)))
    }

    /// The room round the ball: its shape grown by the ring.
    static func room(_ ball: Ball) -> Path {
        ball.shape.union(ball.shape.strokedPath(StrokeStyle(lineWidth: 2 * ring(ball.height), lineJoin: .round)))
    }

    /// A tag's own shape: the slab cut on the lean (the full tag's number
    /// and name meet on it, so it's one shape either way). (pure; tested)
    static func shape(_ rect: CGRect) -> Path { LeanShape().path(in: rect) }

    /// The room a figure's ring takes: every part grown by its own width,
    /// his outline and the ring (or, not `ringed`, the figure as drawn). (pure; tested)
    static func box(_ f: Figure, ringed: Bool = true) -> CGRect {
        let margin = ringed ? ring(f.height) : 0, grown = TheaterDraw.halo(f.height) + margin, g = f.figure
        var box = CGRect.null
        func add(_ p: CGPoint, _ r: CGFloat) { box = box.union(CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)) }
        for l in g.limbs { for p in [l.root, l.joint, l.end] { add(p, g.limb / 2 + grown) } }
        add(g.hip, g.torso / 2 + grown)
        add(g.neck, g.torso / 2 + grown)
        add(g.head, g.headRadius + grown)
        if let held = f.held { box = box.union(held.line.boundingRect.insetBy(dx: -held.width / 2 - margin, dy: -held.width / 2 - margin)) }
        return box
    }

    /// Who crosses a tag at `rect`: the figures (by their place in
    /// `figures`) whose box meets it, and whether the ball does; only they
    /// are ringed, and a tag nobody crosses draws as it always has. The
    /// tag's `own` man stands clear of it by placement, closer than his
    /// ring in a big figure: only what of him reaches into it counts (his
    /// bat), never the ring's margin, or it would bite the tag over his head.
    /// (pure; tested)
    static func crossing(_ figures: [Figure], ball: Ball?, tag rect: CGRect, own: Int? = nil) -> (figures: [Int], ball: Bool) {
        let hit = figures.indices.filter { i in
            let f = figures[i]
            return f.opacity > 0.01 && (f.drawn ?? 1) > 0.01 && box(f, ringed: f.index != own).intersects(rect)
        }
        let ballHit = ball.map { $0.opacity > 0.01 && $0.shape.boundingRect.insetBy(dx: -ring($0.height), dy: -ring($0.height)).intersects(rect) } ?? false
        return (hit, ballHit)
    }

    /// Where a tag under a figure's feet starts from.
    static func feet(_ f: Figure) -> CGFloat { f.figure.ground.y + max(f.height * 0.1, 2) }

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
        /// Where round him it goes first (its stretch's choice).
        var spot = TheaterTagSpot()
    }

    /// From the well's edges.
    static let margin: CGFloat = 4
    /// Between a tag and his head (or his feet), and round another tag.
    static let gap: CGFloat = 3

    /// Each tag's place, in order (the pointer's first: it wins). Where its
    /// spot puts it (over his head, or nudged aside, or under his feet),
    /// inside the well and clear of the furniture; else on his other side
    /// (under his feet first when he's too near the top for a tag over him);
    /// else slid along off what's in the way. The pointer's always shows;
    /// any other only where it's clear of the furniture and the tags already
    /// placed, else not at all (it waits for the room). A man out of the
    /// well gets none.
    static func place(_ asks: [Ask], in size: CGSize, clear furniture: [CGRect]) -> [CGRect?] {
        var placed: [CGRect] = []
        var out: [CGRect?] = []
        for ask in asks {
            guard inWell(ask, size) else {
                out.append(nil)
                continue
            }
            func free(_ r: CGRect) -> Bool {
                !furniture.contains { $0.intersects(r) } && !placed.contains { $0.insetBy(dx: -gap, dy: -gap + 1).intersects(r) }
            }
            let (above, below) = sides(ask)
            let over = clamp(above, in: size), under = clamp(below, in: size)
            // Kept inside the well by more than a hair, a tag would sit on his own head (or feet): only a side with room
            // (the pointer's goes anywhere as a last resort).
            let up = above.minY >= margin - 1 ? [over] : [], down = below.maxY <= size.height - margin + 1 ? [under] : []
            let first = ask.spot.under ? down + up : up + down
            var candidates = first + first.map { slid($0, off: furniture, in: size) }
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

    /// Whether a tag's man is in the well (one out of it gets none).
    static func inWell(_ ask: Ask, _ size: CGSize) -> Bool {
        let well = CGRect(origin: .zero, size: size)
        return well.insetBy(dx: -2, dy: -ask.size.height).contains(ask.head) || well.contains(CGPoint(x: ask.head.x, y: ask.feet))
    }

    /// A tag's two sides of its man, as its spot nudges them: over his head and under his feet.
    static func sides(_ ask: Ask) -> (over: CGRect, under: CGRect) {
        let x = ask.head.x + ask.spot.nudge * ask.size.width - ask.size.width / 2
        return (CGRect(x: x, y: ask.head.y - gap - ask.size.height, width: ask.size.width, height: ask.size.height),
                CGRect(x: x, y: ask.feet + gap, width: ask.size.width, height: ask.size.height))
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

// MARK: - Where round him

/// Where round its man a tag goes first: over his head (its middle nudged
/// across by a share of its width), or under his feet.
struct TheaterTagSpot: Hashable {
    var nudge: CGFloat = 0
    var under = false
}

/// A moment of a replay as the tags see it: each figure's spot on screen
/// (his ground point, his height there) and the ball's, from the script at
/// t through the camera, no posing. What the pointer hits; what a tag keeps
/// clear of.
struct TheaterSpots {
    var figures: [(index: Int, ground: CGPoint, height: CGFloat)]
    var ball: CGPoint?
}

/// A replay as the tags see it: how long it runs, and each moment of it.
struct TheaterReplay {
    var length: Double
    var at: (Double) -> TheaterSpots
}

/// Where each tag sits round its man, so the play and the names never block
/// each other: of the spots round him, the one the other men and the ball
/// cover least through his stretch of the replay (while he's the key man; the
/// whole replay under the pointer), sampled ten times a second from the
/// script alone. Chosen once per stretch, so a tag never wanders mid-play; a
/// man passing through (a brief crossing) never moves it, since each spot
/// past the first costs a little (the ring takes those); a crowd he stands
/// behind does. (pure; tested)
enum TheaterTagPlan {
    /// The spots, most wanted first, and what each costs over the first (as
    /// a share of the tag covered through the stretch): over his head; nudged
    /// a quarter or nearly half its width (his head still under it); under
    /// his feet, the same.
    static let spots: [(spot: TheaterTagSpot, cost: Double)] = [
        (TheaterTagSpot(), 0),
        (TheaterTagSpot(nudge: -0.25), 0.06), (TheaterTagSpot(nudge: 0.25), 0.06),
        (TheaterTagSpot(under: true), 0.09),
        (TheaterTagSpot(nudge: -0.45), 0.12), (TheaterTagSpot(nudge: 0.45), 0.12),
        (TheaterTagSpot(nudge: -0.25, under: true), 0.14), (TheaterTagSpot(nudge: 0.25, under: true), 0.14),
        (TheaterTagSpot(nudge: -0.45, under: true), 0.2), (TheaterTagSpot(nudge: 0.45, under: true), 0.2),
    ]

    /// Samples a second.
    static let rate = 10.0
    /// The ball covers more than its size: it's what the eye follows.
    static let ballWeight = 3.0

    /// A man on screen from his ground point and height: what a tag over him would cover.
    static func body(_ ground: CGPoint, _ height: CGFloat) -> CGRect {
        CGRect(x: ground.x - height * 0.3, y: ground.y - height * 1.04, width: height * 0.6, height: height * 1.1)
    }

    /// What a tag asks of placement round a man at a moment (his ground point
    /// and height there; no posing), at `spot`.
    static func ask(_ spot: TheaterTagSpot, tag: CGSize, ground: CGPoint, height: CGFloat, pointer: Bool) -> TheaterTagLayout.Ask {
        TheaterTagLayout.Ask(size: tag, head: CGPoint(x: ground.x, y: ground.y - height), feet: ground.y + max(height * 0.1, 2), pointer: pointer, spot: spot)
    }

    /// The spot for man `man`'s tag, `tag` big, through `stretch` of a
    /// replay in a well `size`, kept clear of the corners that never move
    /// (`furniture`): at each moment, where placement would put it at each
    /// spot and how much of it the other men and the ball would cover (all
    /// of it when it wouldn't show; nothing counted while he's out of the
    /// well); the least covered once its cost is counted (the first of
    /// equals). (pure; tested)
    static func choose(_ man: Int, tag: CGSize, pointer: Bool, over stretch: Range<Double>, in size: CGSize, clear furniture: [CGRect],
                       replay: TheaterReplay) -> TheaterTagSpot {
        let from = min(max(stretch.lowerBound, 0), replay.length), to = max(min(stretch.upperBound, replay.length), from)
        let moments = stride(from: from, through: to, by: 1 / rate).map(replay.at)
        var best = (spot: TheaterTagSpot(), score: Double.infinity)
        for (spot, cost) in spots {
            var covered = 0.0, seen = 0
            for moment in moments {
                guard let him = moment.figures.first(where: { $0.index == man }) else { continue }
                let ask = ask(spot, tag: tag, ground: him.ground, height: him.height, pointer: pointer)
                guard TheaterTagLayout.inWell(ask, size) else { continue }
                seen += 1
                guard let r = TheaterTagLayout.place([ask], in: size, clear: furniture)[0] else {
                    covered += 1
                    continue
                }
                var area = 0.0
                for other in moment.figures where other.index != man {
                    let overlap = r.intersection(body(other.ground, other.height))
                    if !overlap.isNull { area += overlap.width * overlap.height }
                }
                if let ball = moment.ball {
                    let g = max(him.height * 0.15, 2.5)
                    let overlap = r.intersection(CGRect(x: ball.x - g, y: ball.y - g, width: 2 * g, height: 2 * g))
                    if !overlap.isNull { area += overlap.width * overlap.height * ballWeight }
                }
                covered += min(area / max(r.width * r.height, 1), 1)
            }
            let score = (seen > 0 ? covered / Double(seen) : 0) + cost
            if score < best.score - 1e-9 { best = (spot, score) }
        }
        return best.spot
    }

    /// `choose`, each stretch's once: by the replay (its cast's scope), the
    /// man, his stretch, the well and the tag. Kept clear of the corners that
    /// stay put through a replay (the turn control's, whether it's up or not,
    /// and the heartbeat's): the status tag's words change and the stamp and
    /// the headline come and go, so placement keeps clear of those as they do.
    static func spot(_ man: Int, tag: CGSize, pointer: Bool, over stretch: Range<Double>, in size: CGSize, heartbeat: HorizontalEdge?,
                     replay: TheaterReplay, scope: String) -> TheaterTagSpot {
        let corner = heartbeat.map { $0 == .leading ? "L" : "T" } ?? "-"
        let key = "\(scope)|\(man)|\(pointer)|\(stretch.lowerBound)|\(Int(size.width))×\(Int(size.height))|\(Int(tag.width * 2))×\(Int(tag.height * 2))|\(corner)"
            as NSString
        if let spot = chosen.object(forKey: key) { return spot.spot }
        let spot = choose(man, tag: tag, pointer: pointer, over: stretch, in: size,
                          clear: TheaterTagLayout.furniture(size, status: nil, flip: true, heartbeat: heartbeat), replay: replay)
        chosen.setObject(Chosen(spot), forKey: key)
        return spot
    }

    private final class Chosen {
        let spot: TheaterTagSpot
        init(_ spot: TheaterTagSpot) { self.spot = spot }
    }

    /// NSCache is thread-safe: any frame reads it.
    nonisolated(unsafe) private static let chosen: NSCache<NSString, Chosen> = {
        let cache = NSCache<NSString, Chosen>()
        cache.countLimit = 200
        return cache
    }()
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
