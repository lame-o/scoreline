import SwiftUI

// Each sport's situation in a 28pt strip under a large live tile, drawn from
// data the app already has. Viz ink and type; team colors for marks, never
// text. The tile is the button, so strips have no hover targets of their own;
// their meaning goes in the tile's accessibility label.

/// The strip a live game gets, or none (the face-off takes the space).
struct TileStripView: View {
    let event: Event
    let top: Competitor
    let bottom: Competitor
    let palette: TeamPalette
    var countries: [String] = []

    private enum Kind {
        case football(FootballSpot)
        case baseball(BaseState)
        case soccer([MatchMark])
        case lead(Int)
        case race(GameDetail.CSLive)
    }

    private var kind: Kind? {
        switch event.snapshot {
        case let .football(spot)?: return .football(spot)
        case let .baseball(state)?: return .baseball(state)
        case let .soccer(marks)?: return .soccer(marks)
        case .basketball?:
            guard let a = top.score.flatMap({ Int($0) }), let b = bottom.score.flatMap({ Int($0) }) else { return nil }
            return .lead(a - b)
        case let .counterStrike(live)?: return .race(live)
        default: return nil
        }
    }

    var hasStrip: Bool { kind != nil }

    private var points: StripPoints { StripPoints(top: top.score.flatMap { Int($0) }, bottom: bottom.score.flatMap { Int($0) }) }

    var body: some View {
        Group {
            switch kind {
            case let .football(spot)?:
                FieldStrip(spot: spot, top: palette.top, bottom: palette.bottom, points: points)
            case let .baseball(state)?:
                BasesStrip(state: state, runs: points.top.flatMap { a in points.bottom.map { a + $0 } })
            case let .soccer(marks)?:
                GoalTrack(marks: marks, minute: Self.soccerMinute(event), top: palette.top, bottom: palette.bottom)
            case let .lead(margin)?:
                LeadBar(margin: margin, topLabel: top.abbreviation, bottomLabel: bottom.abbreviation,
                        top: palette.top, bottom: palette.bottom)
            case let .race(live)?:
                RaceStrip(live: live, top: palette.top, bottom: palette.bottom)
            case nil:
                EmptyView()
            }
        }
        .frame(maxHeight: .infinity)
        .accessibilityHidden(true)
    }

    /// The match minute from the polled clock ("67'", "45'+2'", HT).
    static func soccerMinute(_ event: Event) -> Double? {
        guard let clock = event.clock else { return nil }
        if clock.display.uppercased() == "HT" { return 45 }
        return MatchMark.minute(from: clock.display) ?? clock.seconds / 60
    }

    /// What the strip shows, in words, for VoiceOver.
    static func meaning(of event: Event) -> String? {
        let teams = event.competitors
        switch event.snapshot {
        case let .football(spot)?:
            let team = spot.possession.map { $0 == .top ? teams.first : teams.last }??.name
            return [team.map { "\($0) ball" }, event.liveLine, spot.redZone ? "red zone" : nil].compactMap { $0 }
                .joined(separator: ", ")
        case let .baseball(s)?:
            let bases = [(s.onFirst, "first"), (s.onSecond, "second"), (s.onThird, "third")].filter(\.0).map(\.1)
            let runners = bases.isEmpty ? "Bases empty" : "Runners on " + bases.joined(separator: " and ")
            return "\(runners). \(s.balls) balls, \(s.strikes) strikes, \(s.outs) out\(s.outs == 1 ? "" : "s")"
        case let .soccer(marks)?:
            guard let goal = marks.last(where: \.isGoal) else { return nil }
            let name = goal.player.map(MatchMark.surname) ?? "unknown"
            return "Last goal \(name), \(Ordinal.string(Int(goal.minute))) minute"
                + (goal.kind == .penalty ? ", penalty" : goal.kind == .ownGoal ? ", own goal" : "")
        case .basketball?:
            guard teams.count == 2, let a = teams[0].score.flatMap({ Int($0) }), let b = teams[1].score.flatMap({ Int($0) })
            else { return nil }
            return a == b ? "Tied" : "\(a > b ? teams[0].name : teams[1].name) leads by \(abs(a - b))"
        case let .counterStrike(live)?:
            return [live.mapName, "\(live.topScore) to \(live.bottomScore)", live.round.map { "round \($0)" }]
                .compactMap { $0 }.joined(separator: ", ")
        case let .climbing(wall)?:
            switch wall.phase {
            case let .lead(climber, leader, _):
                func hold(_ a: WallState.Ascent) -> String {
                    a.top ? "top" : "hold \(Int(a.height))\(a.height > Double(Int(a.height)) ? " plus" : "")"
                }
                return "\(climber.athlete.name), \(climber.athlete.country ?? ""), on the wall at \(hold(climber))"
                    + (leader.map { ". Leader \($0.athlete.name), \(hold($0))" } ?? "")
            case let .boulder(athlete, _, active):
                return "\(athlete.name) on the wall" + (active.map { ", boulder \($0 + 1)" } ?? "")
            case let .upNext(athlete):
                return "Up next \(athlete.name)"
            }
        case nil:
            return nil
        }
    }
}

// MARK: - Football

/// Both sides' points, for a strip that reacts to a score (a touchdown).
struct StripPoints: Equatable {
    var top: Int?
    var bottom: Int?
}

/// The field as a bar: 120 yards, the left end zone the left crest's (the
/// away team defends it, as the match page says). The ball rides above the
/// line of scrimmage with a chevron pointing where the offense is going.
///
/// At rest it's one canvas, as cheap to build as a still picture. Each live
/// moment (landing-views §6.6) is a small layer that exists only while it
/// plays and moves by opacity or transform alone: a touchdown lights the end
/// zone it went into in the scorer's color on the flash's timings; the
/// red-zone tint fades (`Motion.fade`); a change of possession sweeps the
/// chevron 180° over the ball (`Motion.standard`). The ball and lines glide
/// as they always have (`Motion.travel`). Reduce Motion: the ball jumps and
/// the chevrons crossfade; the colors still change.
struct FieldStrip: View {
    let spot: FootballSpot
    let top: Color
    let bottom: Color
    /// The teams' points, when the caller has them: a side up by 6 or more
    /// in one update scored a touchdown.
    var points: StripPoints?
    /// The docked scorebar's 12pt variant: a 6pt bar, the line of scrimmage
    /// and line to gain across it, and the chevron beside the line of
    /// scrimmage (no ball glyph). Tiles use the 22pt default.
    var compact: Bool
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Moments play only on screen; off it, the strip just shows the new state.
    @Environment(\.pageLive) private var pageLive
    /// The moments playing; each is a layer keyed by its own number.
    @State private var sweep: StripMoment<Sweep>?
    @State private var redFade: StripMoment<RedFade>?
    @State private var touchdown: StripMoment<GameDetail.Side>?
    @State private var count = 0

    static let height: CGFloat = 22
    static let compactHeight: CGFloat = 12
    /// Drawing room above the strip for the chevron's sweep over the ball.
    fileprivate static let sweepRoom: CGFloat = 5

    struct RedFade: Equatable {
        let entering: Bool
        let left: Bool
    }

    /// The ball changing hands, and where it was and went (a punt moves it too).
    struct Sweep: Equatable {
        let toLeft: Bool
        let fromX: Double
        let toX: Double
    }

    init(spot: FootballSpot, top: Color, bottom: Color, points: StripPoints? = nil, compact: Bool = false) {
        self.spot = spot
        self.top = top
        self.bottom = bottom
        self.points = points
        self.compact = compact
    }

    var body: some View {
        let room = compact ? 0 : Self.sweepRoom
        let field = FieldGeometry(compact: compact)
        ZStack(alignment: .topLeading) {
            FieldCanvas(field: field, ballX: spot.ballX, gainX: spot.lineToGainX ?? spot.ballX, showsGain: spot.lineToGainX != nil,
                        attacksLeft: spot.attacksLeft, hasPossession: spot.possession != nil && sweep == nil,
                        // While the tint fades in, its layer draws it.
                        redZone: spot.redZone && redFade?.value.entering != true,
                        top: top, bottom: bottom, light: colorScheme == .light)
                .animation(reduceMotion ? nil : Motion.travel, value: spot.ballX)
                .animation(reduceMotion ? nil : Motion.travel, value: spot.lineToGainX)
            if let redFade {
                FieldLayer(field: field, part: .redZone(left: redFade.value.left))
                    .modifier(PlayOnce(rise: redFade.value.entering ? Motion.fade : nil, hold: nil,
                                       fall: redFade.value.entering ? nil : Motion.fade) {
                        if self.redFade?.id == redFade.id { self.redFade = nil }
                    })
                    .id(redFade.id)
            }
            if let touchdown {
                // The top team attacks right, so its touchdowns land in the right end zone.
                FieldLayer(field: field, part: .endZone(right: touchdown.value == .top,
                                                        color: (touchdown.value == .top ? top : bottom).opacity(0.45)))
                    .modifier(PlayOnce(rise: Motion.fade, hold: TileFlash.hold, fall: TileFlash.decay()) {
                        if self.touchdown?.id == touchdown.id { self.touchdown = nil }
                    })
                    .id(touchdown.id)
            }
            if let sweep {
                ChevronSweep(sweep: sweep.value, field: field, top: top, bottom: bottom, crossfade: reduceMotion) {
                    if self.sweep?.id == sweep.id { self.sweep = nil }
                }
                .id(sweep.id)
            }
        }
        // Laid out at the strip's height; drawn with room above it.
        .frame(height: field.height)
        .padding(.top, -room)
        .onChange(of: spot) { old, new in
            guard pageLive else { return }
            // Only a change of hands sweeps; arriving after a gap, it just appears.
            if let from = old.possession, let to = new.possession, from != to {
                sweep = next(Sweep(toLeft: to == .bottom, fromX: old.ballX, toX: new.ballX))
            }
            if old.redZone != new.redZone {
                // Leaving, it fades where it was.
                redFade = next(RedFade(entering: new.redZone, left: new.redZone ? new.attacksLeft : old.attacksLeft))
            }
        }
        .onChange(of: points) { old, new in
            guard pageLive, let old, let new, let t0 = old.top, let b0 = old.bottom, let t1 = new.top, let b1 = new.bottom
            else { return }
            if t1 - t0 >= 6 { touchdown = next(.top) } else if b1 - b0 >= 6 { touchdown = next(.bottom) }
        }
    }

    private func next<Value>(_ value: Value) -> StripMoment<Value> {
        count += 1
        return StripMoment(id: count, value: value)
    }
}

/// A live moment on a strip: its own number (the layer's identity) and what it shows.
struct StripMoment<Value> {
    let id: Int
    let value: Value
}

/// Plays a layer's opacity once, from when it appears: in (`rise`, or
/// already shown), hold, out (`fall`, or it stays), then `done`, so the
/// strip removes it. Opacity only.
private struct PlayOnce: ViewModifier {
    let rise: Animation?
    let hold: Duration?
    let fall: Animation?
    let done: () -> Void
    @State private var level: Double

    init(rise: Animation?, hold: Duration?, fall: Animation?, done: @escaping () -> Void) {
        self.rise = rise
        self.hold = hold
        self.fall = fall
        self.done = done
        _level = State(initialValue: rise == nil ? 1 : 0)
    }

    func body(content: Content) -> some View {
        content
            .opacity(level)
            .task {
                // Each step's sleep covers its animation (the fade 0.15s, the
                // decay 1.2s); the layer is gone once it's done.
                if let rise {
                    withAnimation(rise) { level = 1 }
                    try? await Task.sleep(for: .seconds(0.2))
                }
                if let hold { try? await Task.sleep(for: hold) }
                if let fall {
                    withAnimation(fall) { level = 0 }
                    try? await Task.sleep(for: .seconds(1.25))
                }
                guard !Task.isCancelled else { return }
                done()
            }
    }
}

/// Where the field strip's parts go in a given size.
private struct FieldGeometry {
    let compact: Bool
    var barHeight: CGFloat { compact ? 6 : 8 }
    /// The strip's drawn height (with the sweep's room above, when there is one).
    var height: CGFloat { compact ? FieldStrip.compactHeight : FieldStrip.height + FieldStrip.sweepRoom }

    func bar(_ size: CGSize) -> CGRect {
        compact ? CGRect(x: 0, y: (size.height - barHeight) / 2, width: size.width, height: barHeight)
            : CGRect(x: 0, y: size.height - barHeight, width: size.width, height: barHeight)
    }

    /// Field x (0…100, from the left goal line) to points; end zones are 10 each side.
    func u(_ x: Double, _ size: CGSize) -> CGFloat { CGFloat((x + 10) / 120) * size.width }

    func shape(_ size: CGSize) -> Path { Path(roundedRect: bar(size), cornerRadius: 2) }

    /// The ball's center.
    var ballY: CGFloat { compact ? height / 2 : height - barHeight - 7 }
}

/// The field at rest, everything in one canvas (the ball and lines glide by redrawing, as always).
private struct FieldCanvas: View, Animatable {
    let field: FieldGeometry
    var ballX: Double
    var gainX: Double
    let showsGain: Bool
    let attacksLeft: Bool
    let hasPossession: Bool
    let redZone: Bool
    let top: Color
    let bottom: Color
    let light: Bool

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(ballX, gainX) }
        set { ballX = newValue.first; gainX = newValue.second }
    }

    var body: some View {
        Canvas { context, size in
            let barHeight = field.barHeight
            let bar = field.bar(size)
            func u(_ x: Double) -> CGFloat { field.u(x, size) }
            let shape = field.shape(size)
            // Compact: the lines cross the whole strip, so they read as the ball's place.
            func lines(_ layer: inout GraphicsContext, y: CGFloat, height: CGFloat) {
                if showsGain {
                    let x = u(gainX)
                    if light {
                        // A dark edge so the yellow reads on a light panel.
                        layer.fill(Path(CGRect(x: x - 1.25, y: y, width: 2.5, height: height)), with: .color(.black.opacity(0.25)))
                    }
                    layer.fill(Path(CGRect(x: x - 0.75, y: y, width: 1.5, height: height)), with: .color(.yellow))
                }
                let los = u(ballX)
                layer.fill(Path(CGRect(x: los - 0.75, y: y, width: 1.5, height: height)), with: .color(.blue))
            }

            context.drawLayer { layer in
                layer.clip(to: shape)
                layer.fill(shape, with: .color(.primary.opacity(0.05)))
                layer.fill(Path(CGRect(x: 0, y: bar.minY, width: u(0), height: barHeight)), with: .color(top.opacity(0.25)))
                layer.fill(Path(CGRect(x: u(100), y: bar.minY, width: size.width - u(100), height: barHeight)),
                           with: .color(bottom.opacity(0.25)))
                if redZone {
                    let from = attacksLeft ? u(0) : u(80)
                    layer.fill(Path(CGRect(x: from, y: bar.minY, width: u(20) - u(0), height: barHeight)),
                               with: .color(.red.opacity(0.10)))
                }
                for yard in stride(from: 10, through: 90, by: 10) {
                    let x = u(Double(yard))
                    let width: CGFloat = yard == 50 ? 1 : 0.5
                    layer.fill(Path(CGRect(x: x - width / 2, y: bar.minY, width: width, height: barHeight)),
                               with: .color(yard == 50 ? Viz.reference : Viz.grid))
                }
                if !field.compact { lines(&layer, y: bar.minY, height: barHeight) }
            }
            if field.compact { lines(&context, y: 0, height: size.height) }

            // The ball above the line of scrimmage (none in the compact strip);
            // the chevron on its leading side.
            let center = CGPoint(x: u(ballX), y: field.ballY)
            if !field.compact, let ball = context.resolveSymbol(id: 0) { context.draw(ball, at: center) }
            if hasPossession, let chevron = context.resolveSymbol(id: 1) {
                let reach: CGFloat = field.compact ? 4.5 : 8.5
                context.draw(chevron, at: CGPoint(x: center.x + (attacksLeft ? -reach : reach), y: center.y))
            }
        } symbols: {
            Image(systemName: "football.fill").font(.system(size: 8)).foregroundStyle(.primary).tag(0)
            Image(systemName: attacksLeft ? "arrowtriangle.left.fill" : "arrowtriangle.right.fill")
                .font(.system(size: 5, weight: .bold))
                .foregroundStyle(attacksLeft ? bottom : top)
                .tag(1)
        }
    }
}

/// A still layer for a moment: an end zone lit, or the red zone.
private struct FieldLayer: View {
    enum Part {
        case endZone(right: Bool, color: Color)
        case redZone(left: Bool)
    }

    let field: FieldGeometry
    let part: Part

    var body: some View {
        Canvas { context, size in
            let bar = field.bar(size), h = field.barHeight
            func u(_ x: Double) -> CGFloat { field.u(x, size) }
            context.clip(to: field.shape(size))
            switch part {
            case let .endZone(right, color):
                let rect = right ? CGRect(x: u(100), y: bar.minY, width: size.width - u(100), height: h)
                    : CGRect(x: 0, y: bar.minY, width: u(0), height: h)
                context.fill(Path(rect), with: .color(color))
            case let .redZone(left):
                let from = left ? u(0) : u(80)
                context.fill(Path(CGRect(x: from, y: bar.minY, width: u(20) - u(0), height: h)), with: .color(.red.opacity(0.10)))
            }
        }
        .allowsHitTesting(false)
    }
}

/// Moves a full-width layer whose content sits at the strip's left edge to
/// field x (0…100): a translation, glided with the ball.
private struct FieldShift: GeometryEffect {
    var x: Double

    var animatableData: Double {
        get { x }
        set { x = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: CGFloat((x + 10) / 120) * size.width, y: 0))
    }
}

/// The possession chevron changing hands, for as long as that takes: it
/// sweeps 180° over the top of the ball (a rotation), taking the other
/// team's color as it goes (an opacity crossfade). The compact strip has no
/// room above, so there it turns about the line of scrimmage (a 3D turn).
/// Reduce Motion: the two crossfade in place. The canvas draws it at rest.
private struct ChevronSweep: View {
    let sweep: FieldStrip.Sweep
    let field: FieldGeometry
    let top: Color
    let bottom: Color
    let crossfade: Bool
    let done: () -> Void
    /// 0: the old side's chevron; 1: the new side's.
    @State private var progress = 0.0
    /// Where the ball is: it starts where the ball was and glides with it.
    @State private var x: Double

    init(sweep: FieldStrip.Sweep, field: FieldGeometry, top: Color, bottom: Color, crossfade: Bool, done: @escaping () -> Void) {
        self.sweep = sweep
        self.field = field
        self.top = top
        self.bottom = bottom
        self.crossfade = crossfade
        self.done = done
        _x = State(initialValue: sweep.fromX)
    }

    private var reach: CGFloat { field.compact ? 4.5 : 8.5 }
    private var turns: Bool { field.compact }

    var body: some View {
        // The sweep runs from the old side (swing 0 = attacking right) to the new.
        let swing = sweep.toLeft ? progress : 1 - progress
        ZStack {
            if crossfade {
                glyph("arrowtriangle.right.fill", top).offset(x: reach).opacity(1 - swing)
                glyph("arrowtriangle.left.fill", bottom).offset(x: -reach).opacity(swing)
            } else {
                ZStack {
                    glyph("arrowtriangle.right.fill", top).opacity(1 - swing)
                    glyph("arrowtriangle.right.fill", bottom).opacity(swing)
                }
                .offset(x: reach)
                .rotationEffect(.degrees(turns ? 0 : -180 * swing))
                .rotation3DEffect(.degrees(turns ? 180 * swing : 0), axis: (x: 0, y: 1, z: 0), perspective: 0.4)
            }
        }
        .frame(width: 2 * reach + 8, height: 2 * reach + 8)
        .position(x: 0, y: field.ballY)
        .modifier(FieldShift(x: x))
        .allowsHitTesting(false)
        .task {
            // Two transactions: the ball's glide and the sweep keep their own curves.
            withAnimation(crossfade ? nil : Motion.travel) { x = sweep.toX }
            withAnimation(crossfade ? Motion.fade : Motion.standard) { progress = 1 }
            try? await Task.sleep(for: .seconds(0.45))
            guard !Task.isCancelled else { return }
            done()
        }
    }

    private func glyph(_ name: String, _ color: Color) -> some View {
        Image(systemName: name).font(.system(size: 5, weight: .bold)).foregroundStyle(color)
    }
}

// MARK: - Baseball

/// Bases (filled = occupied) and the count, `BaseballDiamond` in miniature.
/// A run scoring pings home plate once (landing-views §6.6).
struct BasesStrip: View {
    let state: BaseState
    /// Both teams' runs together, when known: each rise is a run scored.
    var runs: Int? = nil
    /// The run being pinged: a layer that exists only while it plays.
    @State private var ping: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.pageLive) private var pageLive

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                base(state.onSecond, order: 1).offset(y: -6)
                base(state.onFirst, order: 0).offset(x: 10, y: 1)
                base(state.onThird, order: 2).offset(x: -10, y: 1)
                Image(systemName: "pentagon.fill")
                    .font(.system(size: 6))
                    .rotationEffect(.degrees(180))
                    .foregroundStyle(.secondary)
                    .offset(y: 9)
                if let ping {
                    StripPing(color: .primary, diameter: 8, fades: reduceMotion) {
                        if self.ping == ping { self.ping = nil }
                    }
                    .id(ping)
                    .offset(y: 9)
                }
            }
            .frame(width: 30, height: 26)
            .onChange(of: runs) { old, new in
                guard pageLive, let old, let new, new > old else { return }
                ping = new
            }
            HStack(spacing: 10) {
                count("B", state.balls, of: 3, color: .green)
                count("S", state.strikes, of: 2, color: .orange)
                count("O", state.outs, of: 2, color: .red)
            }
            Spacer(minLength: 0)
        }
    }

    /// Bases fill in order, so runners moving up read as a sweep.
    private func base(_ occupied: Bool, order: Int) -> some View {
        RoundedRectangle(cornerRadius: 1.5)
            .fill(occupied ? Color.primary : Color.primary.opacity(0.08))
            .overlay(RoundedRectangle(cornerRadius: 1.5).strokeBorder(Color.primary.opacity(occupied ? 0 : 0.25), lineWidth: 1))
            .frame(width: 8, height: 8)
            .rotationEffect(.degrees(45))
            .animation(reduceMotion ? Motion.fade : Motion.quick.delay(Double(order) * Motion.stagger), value: occupied)
    }

    private func count(_ label: String, _ value: Int, of total: Int, color: Color) -> some View {
        HStack(spacing: 3) {
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
            ForEach(0..<total, id: \.self) { i in
                Circle().fill(i < value ? color : Viz.track).frame(width: 6, height: 6)
            }
        }
        .animation(reduceMotion ? Motion.fade : Motion.quick, value: value)
    }
}

/// Three 5pt bases after a name in a small live tile.
struct MiniBases: View {
    let state: BaseState

    var body: some View {
        ZStack {
            mark(state.onSecond).offset(y: -2.5)
            mark(state.onFirst).offset(x: 4, y: 1)
            mark(state.onThird).offset(x: -4, y: 1)
        }
        .frame(width: 13, height: 9)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
        .accessibilityHidden(true)
    }

    private func mark(_ occupied: Bool) -> some View {
        Rectangle()
            .fill(occupied ? Color.primary : Color.primary.opacity(0.18))
            .frame(width: 3.5, height: 3.5)
            .rotationEffect(.degrees(45))
    }
}

// MARK: - Soccer

/// The match on one line: time played filled to now, half-time marked, each
/// team's goals in its own lane (left crest's above, right crest's below),
/// red cards in the offender's lane. `SoccerTimeline` in miniature.
///
/// Live: a new mark arrives like a badge (92% to full, `Motion.quick`), and a
/// goal pings once in its team's color (`Motion.ping`). Reduce Motion: the
/// mark fades in and the ring fades in place.
struct GoalTrack: View {
    let marks: [MatchMark]
    let minute: Double?
    let top: Color
    let bottom: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.pageLive) private var pageLive
    /// The mark arriving and the goal pinging, each a layer that exists only
    /// while it plays (keyed by its own number).
    @State private var arriving: StripMoment<MatchMark>?
    @State private var pinging: StripMoment<MatchMark>?
    @State private var count = 0

    /// Drawing room above and below the track for the ping's ring.
    private static let bleed: CGFloat = 4

    var body: some View {
        let now = minute ?? -1
        ZStack {
            GoalCanvas(now: now, marks: marks, top: top, bottom: bottom, skipping: arriving?.value)
                .animation(reduceMotion ? nil : Motion.standard, value: minute)
            if let arriving {
                ArrivingMark(now: now, marks: marks, mark: arriving.value, top: top, bottom: bottom, fades: reduceMotion) {
                    if self.arriving?.id == arriving.id { self.arriving = nil }
                }
                .id(arriving.id)
            }
            if let pinging {
                let mark = pinging.value
                StripPing(color: mark.side == .top ? top : mark.side == .bottom ? bottom : .primary, diameter: 9, fades: reduceMotion) {
                    if self.pinging?.id == pinging.id { self.pinging = nil }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .modifier(AtMark(now: now, marks: marks, mark: mark, diameter: 9))
                .id(pinging.id)
            }
        }
        // Laid out 24pt tall; drawn with room for the ring.
        .frame(height: 24 + 2 * Self.bleed)
        .padding(.vertical, -Self.bleed)
        .onChange(of: marks) { old, new in
            // The latest of what's new (one poll can bring two); off screen it just appears.
            guard pageLive, let mark = new.filter({ !old.contains($0) }).max(by: { $0.minute < $1.minute }) else { return }
            count += 1
            arriving = StripMoment(id: count, value: mark)
            if mark.isGoal { pinging = StripMoment(id: count, value: mark) }
        }
    }
}

/// Where the goal track's parts go in a given size.
private struct GoalGeometry {
    let size: CGSize
    let end: Double
    let mid: CGFloat
    static let inset: CGFloat = 4
    static let lane: CGFloat = 6.5

    init(size: CGSize, now: Double, marks: [MatchMark]) {
        self.size = size
        end = max(90, now, marks.map(\.minute).max() ?? 0)
        mid = (size.height / 2).rounded()
    }

    func x(_ minute: Double) -> CGFloat {
        Self.inset + CGFloat(min(max(minute, 0), end) / end) * (size.width - 2 * Self.inset)
    }

    func rect(_ mark: MatchMark) -> CGRect {
        let cx = x(mark.minute)
        guard let side = mark.side else { return CGRect(x: cx - 3.5, y: mid - 3.5, width: 7, height: 7) }
        let cy = side == .top ? mid - Self.lane : mid + Self.lane
        return mark.kind == .redCard ? CGRect(x: cx - 2, y: cy - 3, width: 4, height: 6)
            : CGRect(x: cx - 3.5, y: cy - 3.5, width: 7, height: 7)
    }
}

/// A newly arrived mark, alone in its layer while it arrives: it grows
/// from 92% and fades in once (`Motion.quick`; a fade with Reduce Motion),
/// then hands back to the track's canvas.
private struct ArrivingMark: View {
    let now: Double
    let marks: [MatchMark]
    let mark: MatchMark
    let top: Color
    let bottom: Color
    let fades: Bool
    let done: () -> Void
    @State private var shown = false

    var body: some View {
        Canvas { context, size in
            let ordered = marks.sorted { $0.minute < $1.minute }
            guard let i = ordered.firstIndex(of: mark) else { return }
            GoalCanvas.draw(ordered: ordered, index: i, in: context, geometry: GoalGeometry(size: size, now: now, marks: marks),
                            top: top, bottom: bottom)
        }
        .modifier(MarkScale(scale: shown || fades ? 1 : 0.92, now: now, marks: marks, mark: mark))
        .opacity(shown ? 1 : 0)
        .allowsHitTesting(false)
        .task {
            withAnimation(fades ? Motion.fade : Motion.quick) { shown = true }
            try? await Task.sleep(for: .seconds(0.3))
            guard !Task.isCancelled else { return }
            done()
        }
    }
}

/// Scales a full-track layer about one mark's center.
private struct MarkScale: GeometryEffect {
    var scale: CGFloat
    let now: Double
    let marks: [MatchMark]
    let mark: MatchMark

    var animatableData: CGFloat {
        get { scale }
        set { scale = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let r = GoalGeometry(size: size, now: now, marks: marks).rect(mark)
        return ProjectionTransform(CGAffineTransform(translationX: r.midX, y: r.midY).scaledBy(x: scale, y: scale)
            .translatedBy(x: -r.midX, y: -r.midY))
    }
}

/// Moves a full-track layer whose content sits at its top-left corner
/// (`diameter` across) onto one mark's center.
private struct AtMark: GeometryEffect {
    let now: Double
    let marks: [MatchMark]
    let mark: MatchMark
    let diameter: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        let r = GoalGeometry(size: size, now: now, marks: marks).rect(mark)
        return ProjectionTransform(CGAffineTransform(translationX: r.midX - diameter / 2, y: r.midY - diameter / 2))
    }
}

/// `MomentPing`'s ring ("here": grows from 0.6× and fades, once, on
/// `Motion.ping`), as a layer that exists only while it plays. With Reduce
/// Motion it doesn't grow: it appears softer and fades where it is.
struct StripPing: View {
    let color: Color
    var diameter: CGFloat = 12
    var fades = false
    let done: () -> Void
    @State private var fired = false

    var body: some View {
        Circle()
            .strokeBorder(color, lineWidth: 1.5)
            .frame(width: diameter, height: diameter)
            .scaleEffect(fades ? 1.2 : fired ? 1.8 : 0.6)
            .opacity(fired ? 0 : fades ? 0.6 : 0.9)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .task {
                withAnimation(Motion.ping) { fired = true }
                try? await Task.sleep(for: .seconds(0.65))
                guard !Task.isCancelled else { return }
                done()
            }
    }
}

private struct GoalCanvas: View, Animatable {
    var now: Double
    let marks: [MatchMark]
    let top: Color
    let bottom: Color
    /// Drawn by its own arriving layer meanwhile.
    let skipping: MatchMark?

    var animatableData: Double {
        get { now }
        set { now = newValue }
    }

    var body: some View {
        Canvas { context, size in
            let geometry = GoalGeometry(size: size, now: now, marks: marks)
            func x(_ minute: Double) -> CGFloat { geometry.x(minute) }
            let mid = geometry.mid

            // Clear rings around marks sitting on the track (the now dot, an
            // unplaceable own goal), clipped out rather than erased, so nothing
            // behind the panel shows through.
            var rings = Path()
            if now >= 0 { rings.addEllipse(in: CGRect(x: x(now) - 4.5, y: mid - 4.5, width: 9, height: 9)) }
            for mark in marks where mark.side == nil {
                rings.addEllipse(in: CGRect(x: x(mark.minute) - 5, y: mid - 5, width: 10, height: 10))
            }

            context.drawLayer { track in
                track.clip(to: rings, options: .inverse)
                track.fill(Path(CGRect(x: x(0), y: mid - 1, width: x(90) - x(0), height: 2)), with: .color(.primary.opacity(0.12)))
                if now > 90 {
                    track.fill(Path(CGRect(x: x(90), y: mid - 1, width: x(now) - x(90), height: 2)), with: .color(.primary.opacity(0.06)))
                }
                if now > 0 {
                    track.fill(Path(CGRect(x: x(0), y: mid - 1, width: x(now) - x(0), height: 2)), with: .color(.primary.opacity(0.45)))
                }
                track.fill(Path(CGRect(x: x(45) - 0.5, y: mid - 4, width: 1, height: 8)), with: .color(Viz.reference))
            }
            if now >= 0 {
                context.fill(Path(ellipseIn: CGRect(x: x(now) - 3, y: mid - 3, width: 6, height: 6)), with: .color(.red))
            }

            // Marks in time order (see `draw`).
            let ordered = marks.sorted { $0.minute < $1.minute }
            for i in ordered.indices where ordered[i] != skipping {
                Self.draw(ordered: ordered, index: i, in: context, geometry: geometry, top: top, bottom: bottom)
            }
        }
    }

    /// One mark, in time order: each later mark of the same team clips a
    /// ring out of earlier ones it overlaps, so two quick goals stay two dots.
    static func draw(ordered: [MatchMark], index i: Int, in context: GraphicsContext, geometry: GoalGeometry, top: Color, bottom: Color) {
        let mark = ordered[i]
        let r = geometry.rect(mark)
        context.drawLayer { layer in
            var later = Path()
            for next in ordered.dropFirst(i + 1) where next.side == mark.side {
                let n = geometry.rect(next).insetBy(dx: -1.5, dy: -1.5)
                if n.intersects(r) { later.addEllipse(in: n) }
            }
            if !later.isEmpty { layer.clip(to: later, options: .inverse) }
            switch (mark.kind, mark.side) {
            case (.redCard, _):
                layer.fill(Path(roundedRect: r, cornerRadius: 1), with: .color(.red))
            case (_, nil):
                // An own goal the scores can't place: hollow, on the track.
                layer.stroke(Path(ellipseIn: r.insetBy(dx: 0.75, dy: 0.75)), with: .color(.primary), lineWidth: 1.5)
            case (_, .top?):
                layer.fill(Path(ellipseIn: r), with: .color(top))
            case (_, .bottom?):
                layer.fill(Path(ellipseIn: r), with: .color(bottom))
            }
        }
    }
}

// MARK: - Basketball

/// Who leads, by how much: a diverging bar from the center toward the
/// leader's side (left = left crest), capped at 20 points. The fill is a
/// signed value, so a lead change sweeps through the middle.
struct LeadBar: View {
    let margin: Int
    let topLabel: String
    let bottomLabel: String
    let top: Color
    let bottom: Color
    /// The docked scorebar's 12pt variant: the bar and center tick alone
    /// (the scores beside it already say the margin). Tiles use the default.
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        LeadCanvas(margin: Double(margin), topLabel: topLabel, bottomLabel: bottomLabel, top: top, bottom: bottom,
                   compact: compact)
            .frame(height: compact ? 12 : 26)
            .animation(reduceMotion ? nil : Motion.standard, value: margin)
            .help("Lead, capped at 20 points")
    }
}

private struct LeadCanvas: View, Animatable {
    var margin: Double
    let topLabel: String
    let bottomLabel: String
    let top: Color
    let bottom: Color
    var compact = false

    var animatableData: Double {
        get { margin }
        set { margin = newValue }
    }

    var body: some View {
        Canvas { context, size in
            let barY = compact ? size.height / 2 : size.height - 6
            let center = size.width / 2
            let half = center - 1
            context.fill(Path(roundedRect: CGRect(x: 0, y: barY - 2, width: size.width, height: 4), cornerRadius: 2),
                         with: .color(Viz.track))
            let length = CGFloat(min(abs(margin), 20) / 20) * half
            if length > 0.5 {
                let rect = margin > 0 ? CGRect(x: center - length, y: barY - 2, width: length, height: 4)
                    : CGRect(x: center, y: barY - 2, width: length, height: 4)
                context.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(margin > 0 ? top : bottom))
            }
            context.fill(Path(CGRect(x: center - 0.5, y: barY - 5, width: 1, height: 10)), with: .color(Viz.reference))
            guard !compact else { return }

            let points = Int(abs(margin).rounded())
            let label = points == 0 ? "Tied" : "\(margin > 0 ? topLabel : bottomLabel) +\(points)"
            let text = context.resolve(Text(label).font(.system(size: 10, weight: .semibold).monospacedDigit())
                .foregroundColor(.primary))
            let width = text.measure(in: size).width
            // Over the end of the fill, kept inside the strip.
            let end = points == 0 ? center : (margin > 0 ? center - length : center + length)
            let x = min(max(end, width / 2), size.width - width / 2)
            context.draw(text, at: CGPoint(x: x, y: barY - 13), anchor: .center)
        }
    }
}

// MARK: - CS2

/// The map being played as a race to 13: each team fills its half from the
/// outside in; first to the middle takes the map. Overtime races to 4 in the
/// current block. The main score stays maps, so the map's name is always here.
struct RaceStrip: View {
    let live: GameDetail.CSLive
    let top: Color
    let bottom: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    struct Race: Equatable {
        let cells: Int
        let top: Int
        let bottom: Int
        let label: String?
    }

    static func race(_ live: GameDetail.CSLive) -> Race {
        let t = live.topScore, b = live.bottomScore
        // MR12: first to 13. At 12–12, overtime blocks of six, first to 4.
        guard t >= 12 && b >= 12 else {
            return Race(cells: 13, top: min(t, 13), bottom: min(b, 13), label: live.round.map { "Round \($0)" })
        }
        let block = max(0, (min(t, b) - 12) / 3)
        return Race(cells: 4, top: min(t - 12 - 3 * block, 4), bottom: min(b - 12 - 3 * block, 4),
                    label: block > 0 ? "Overtime \(block + 1)" : "Overtime")
    }

    var body: some View {
        let race = Self.race(live)
        VStack(spacing: 4) {
            HStack {
                Text(live.mapName ?? "Map \(live.mapNumber ?? 1)")
                    .font(.system(size: 10, weight: .semibold))
                Spacer(minLength: 6)
                if let label = race.label {
                    Text(label).font(.system(size: 10).monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            .lineLimit(1)
            HStack(spacing: 5) {
                Text("\(live.topScore)")
                    .frame(minWidth: 13, alignment: .leading)
                cells(race.cells, filled: race.top, color: top, fromLeading: true)
                Rectangle().fill(Viz.reference).frame(width: 1, height: 10)
                cells(race.cells, filled: race.bottom, color: bottom, fromLeading: false)
                Text("\(live.bottomScore)")
                    .frame(minWidth: 13, alignment: .trailing)
            }
            .font(.system(size: 9, weight: .semibold).monospacedDigit())
        }
    }

    private func cells(_ count: Int, filled: Int, color: Color, fromLeading: Bool) -> some View {
        RaceCells(count: count, filled: filled, color: color, fromLeading: fromLeading)
    }
}

/// One team's half of the race. A round won fills the next cell
/// (`Motion.quick`, as always). A map won (or an overtime block ending)
/// starts the race over: the cells empty at once and a ghost of the won
/// cells fades out over them (`Motion.exit`, leaving faster than arriving),
/// opacity only, then goes. Reduce Motion: fills fade too.
private struct RaceCells: View {
    let count: Int
    let filled: Int
    let color: Color
    let fromLeading: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.pageLive) private var pageLive
    /// The cells that were won before a clear, while their ghost fades.
    @State private var clearing: StripMoment<(count: Int, filled: Int)>?
    /// The last reading: the body sees the new one first, so a drop is a clear.
    @State private var last: Int

    init(count: Int, filled: Int, color: Color, fromLeading: Bool) {
        self.count = count
        self.filled = filled
        self.color = color
        self.fromLeading = fromLeading
        _last = State(initialValue: filled)
    }

    var body: some View {
        cells(count, filled: filled)
            // A clear empties at once (the ghost fades); a round won fills.
            .animation(filled < last ? nil : reduceMotion ? Motion.fade : Motion.quick, value: filled)
            .overlay {
                if let clearing {
                    cells(clearing.value.count, filled: clearing.value.filled, ghost: true)
                        .modifier(PlayOnce(rise: nil, hold: nil, fall: Motion.exit) {
                            if self.clearing?.id == clearing.id { self.clearing = nil }
                        })
                        .id(clearing.id)
                }
            }
            .onChange(of: filled) { old, new in
                last = new
                guard pageLive, new < old else { return }
                clearing = StripMoment(id: (clearing?.id ?? 0) + 1, value: (count: count, filled: old))
            }
    }

    private func cells(_ count: Int, filled: Int, ghost: Bool = false) -> some View {
        HStack(spacing: 1.5) {
            ForEach(0..<count, id: \.self) { i in
                let n = fromLeading ? i : count - 1 - i
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(n < filled ? color : ghost ? .clear : Viz.track)
                    .frame(height: 6)
            }
        }
    }
}

// MARK: - Climbing

/// Who's on the wall: lead height against the leader's, a boulder card, or
/// who climbs next. Your countries' climbers fill in the accent color.
struct WallStrip: View {
    let state: WallState
    var countries: [String] = []
    /// The docked scorebar's 12pt variant: the lead height bar, or the
    /// boulder card at 10pt, without words (the bar's text names the
    /// climber). Nothing between climbers. Tiles use the default.
    var compact = false

    var body: some View {
        if compact { compactBody } else { tileBody }
    }

    @ViewBuilder
    private var compactBody: some View {
        Group {
            switch state.phase {
            case let .lead(climber, leader, _):
                HeightBar(height: climber.height, top: climber.top, leader: leader?.height,
                          mine: climber.athlete.country.map(countries.contains) ?? false)
                    .frame(height: 6)
            case let .boulder(_, cells, active):
                HStack(spacing: 2.5) {
                    ForEach(Array(cells.enumerated()), id: \.offset) { i, reach in
                        BoulderCell(reach: reach, active: i == active, size: 10)
                    }
                    Spacer(minLength: 0)
                }
            case .upNext:
                Color.clear
            }
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }

    private var tileBody: some View {
        Group {
            switch state.phase {
            case let .lead(climber, leader, route):
                let mine = climber.athlete.country.map(countries.contains) ?? false
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 4) {
                        Text(route.map { "Route \($0)" } ?? "On the wall").foregroundStyle(.secondary)
                        Text(athlete(climber.athlete)).lineLimit(1)
                        Spacer(minLength: 6)
                        Text(climber.top ? "TOP" : climber.label)
                            .font(.system(size: climber.top ? 9 : 10, weight: climber.top ? .bold : .semibold).monospacedDigit())
                    }
                    .font(.system(size: 10.5))
                    HeightBar(height: climber.height, top: climber.top, leader: leader?.height, mine: mine)
                        .frame(height: 6)
                }
            case let .boulder(athlete, cells, active):
                HStack(spacing: 4) {
                    Text("On the wall").foregroundStyle(.secondary)
                    Text(self.athlete(athlete) + (active.map { " · B\($0 + 1)" } ?? "")).lineLimit(1)
                    Spacer(minLength: 6)
                    HStack(spacing: 3) {
                        ForEach(Array(cells.enumerated()), id: \.offset) { i, reach in
                            BoulderCell(reach: reach, active: i == active)
                        }
                    }
                }
                .font(.system(size: 10.5))
            case let .upNext(athlete):
                HStack(spacing: 4) {
                    Text("Up next").foregroundStyle(.secondary)
                    Text(self.athlete(athlete)).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .font(.system(size: 10.5))
            }
        }
        .frame(maxHeight: .infinity)
        .accessibilityHidden(true)
    }

    private func athlete(_ a: WallState.Athlete) -> String {
        [a.flag, a.name].compactMap { $0 }.joined(separator: " ")
    }
}

/// A lead climber's high point on a 0…domain scale: the fill, a "+" nub
/// when moving to the next hold, and a tick at the leader's height.
private struct HeightBar: View {
    let height: Double
    let top: Bool
    let leader: Double?
    let mine: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HeightCanvas(height: height, top: top, leader: leader, mine: mine)
            .animation(reduceMotion ? nil : Motion.standard, value: height)
    }
}

private struct HeightCanvas: View, Animatable {
    var height: Double
    let top: Bool
    let leader: Double?
    let mine: Bool

    var animatableData: Double {
        get { height }
        set { height = newValue }
    }

    var body: some View {
        Canvas { context, size in
            let domain = WallState.domain(height: height, leader: leader)
            func x(_ h: Double) -> CGFloat { CGFloat(min(h / domain, 1)) * size.width }
            let fill: Color = mine ? .accentColor : Viz.neutral
            context.fill(Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 1.5), with: .color(Viz.track))
            let holds = top ? domain : height.rounded(.down)
            context.fill(Path(roundedRect: CGRect(x: 0, y: 0, width: x(holds), height: size.height), cornerRadius: 1.5),
                         with: .color(fill))
            if !top && height > height.rounded(.down) {
                // "+": moving to the next hold.
                context.fill(Path(CGRect(x: x(holds) + 1, y: 0, width: 4, height: size.height)), with: .color(fill.opacity(0.35)))
            }
            if let leader, !top {
                context.fill(Path(CGRect(x: x(leader) - 0.5, y: -2, width: 1, height: size.height + 4)), with: .color(Viz.reference))
            }
        }
    }
}

/// A boulder problem at 12pt: top fills, zone fills 60%, low zone 30%; the
/// problem being climbed has a red edge.
private struct BoulderCell: View {
    let reach: WallState.Reach
    let active: Bool
    var size: CGFloat = 12

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size / 4, style: .continuous)
        let share: CGFloat = switch reach {
        case .top: 1
        case .zone: 0.6
        case .lowZone: 0.3
        case .none: 0
        }
        shape.fill(Viz.track)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.accentColor).frame(height: size * share)
            }
            .clipShape(shape)
            .overlay { if active { shape.strokeBorder(Color.red, lineWidth: 1) } }
            .frame(width: size, height: size)
    }
}
