import SwiftUI

/// Connects soccer's existing play-ID focus to the shared historical cursor.
/// It owns only the pointer values it writes and its own hover contribution;
/// row pins and unrelated player/period focus remain owned by their controls.
@MainActor
final class MatchFocusBridge {
    private struct Cursor: Equatable {
        let moment: Date?
        let pinned: Bool
        @MainActor init(_ pointer: OddsPointer) { moment = pointer.moment; pinned = pointer.pinned }
    }
    private struct Selection: Equatable {
        let focus: Focus
        let pinned: Bool
    }

    private var previousCursor: Cursor?
    private var previousHover: Focus?
    private var previousPin: Focus?
    private var initialized = false
    private var ownedCursor: Cursor?
    private var source: Selection?
    private var pending: Selection?
    private var mirrored: Focus?
    private var releasing: Focus?

    func synchronize(history: MatchHistory, domain: ClosedRange<Date>, linked: LinkedFocus, pointer: OddsPointer) {
        guard history.sport == .soccer else { return }
        let cursor = Cursor(pointer)
        let pinChanged = initialized && previousPin != linked.pinned
        let cursorChanged = initialized && previousCursor != cursor
        let releasedEcho = releasing.map { linked.hovered == nil && previousHover == $0 } ?? false
        let mirrorEcho = releasedEcho || (mirrored.map { linked.hovered == $0 || (linked.hovered == nil && previousHover == $0) } ?? false)
        let hoverChanged = initialized && previousHover != linked.hovered && !mirrorEcho
        if releasedEcho { releasing = nil }
        if let hover = linked.hovered, hover != mirrored { mirrored = nil }

        if pinChanged, let pin = linked.pinned {
            follow(Selection(focus: pin, pinned: true), history: history, domain: domain, linked: linked, pointer: pointer)
        } else if cursorChanged {
            // A newer action on either shared chart takes ownership. A delayed
            // history response must not resurrect an earlier row selection.
            ownedCursor = nil; source = nil; pending = nil
            reflect(history: history, linked: linked, pointer: pointer)
        } else if pinChanged, linked.pinned == nil, source?.pinned == true || pending?.pinned == true {
            clearOwned(pointer)
            source = nil; pending = nil
            if let hover = linked.hovered, hover != mirrored {
                follow(Selection(focus: hover, pinned: false), history: history, domain: domain, linked: linked, pointer: pointer)
            } else {
                reflect(history: history, linked: linked, pointer: pointer)
            }
        } else if !initialized && pointer.pinned {
            reflect(history: history, linked: linked, pointer: pointer)
        } else if !initialized || (hoverChanged && !pointer.pinned) {
            let externalHover = linked.hovered == mirrored ? nil : linked.hovered
            if let focus = externalHover ?? linked.pinned {
                follow(Selection(focus: focus, pinned: externalHover == nil && linked.pinned != nil),
                       history: history, domain: domain, linked: linked, pointer: pointer)
            } else {
                clearOwned(pointer)
                source = nil; pending = nil
                reflect(history: history, linked: linked, pointer: pointer)
            }
        } else if let selection = pending ?? source, ownedCursor == nil || ownedCursor == cursor {
            // The selected ID may arrive later, or its reported time may be
            // corrected. Only still-owned selections follow that update.
            follow(selection, history: history, domain: domain, linked: linked, pointer: pointer)
        } else {
            reflect(history: history, linked: linked, pointer: pointer)
        }
        initialized = true
        previousCursor = Cursor(pointer)
        previousHover = linked.hovered
        previousPin = linked.pinned
    }

    private func follow(_ selection: Selection, history: MatchHistory, domain: ClosedRange<Date>,
                        linked: LinkedFocus, pointer: OddsPointer) {
        // A transient linked hover never displaces a held odds reading.
        guard selection.pinned || !pointer.pinned || ownedCursor == Cursor(pointer) && source == selection else { return }
        releaseHighlight(linked)
        guard let id = selection.focus.play else {
            clearOwned(pointer); source = nil; pending = nil
            return
        }
        guard let event = history.events.first(where: { $0.id == id }) else {
            clearOwned(pointer); source = nil; pending = selection
            return
        }
        if !domain.contains(event.t) { pointer.window = .game }
        if selection.pinned { pointer.pin(event.t) } else { pointer.hover(event.t) }
        ownedCursor = Cursor(pointer)
        source = selection; pending = nil
    }

    private func reflect(history: MatchHistory, linked: LinkedFocus, pointer: OddsPointer) {
        let matches = pointer.moment.map { time in history.events.filter { $0.t == time } } ?? []
        // A time-only cursor cannot distinguish simultaneous plays. Preserve
        // a known matching ID; otherwise never guess one or borrow a near play.
        let known = linked.focus?.play.flatMap { id in matches.first { $0.id == id } }
        guard let event = known ?? (matches.count == 1 ? matches.first : nil) else {
            releaseHighlight(linked)
            return
        }
        guard linked.hovered == nil || linked.hovered == mirrored else { return }
        let focus = Focus(play: event.id, period: event.period, side: event.side)
        guard focus != mirrored else { return }
        releaseHighlight(linked)
        mirrored = focus
        linked.hover(focus, true)
    }

    private func clearOwned(_ pointer: OddsPointer) {
        if ownedCursor == Cursor(pointer) { pointer.clear() }
        ownedCursor = nil
    }

    private func releaseHighlight(_ linked: LinkedFocus) {
        if let mirrored {
            if linked.hovered == mirrored { releasing = mirrored }
            linked.hover(mirrored, false)
        }
        mirrored = nil
    }

    func detach(linked: LinkedFocus) { releaseHighlight(linked) }
}

/// Observation is confined to this noninteractive leaf, never the chart's
/// hover responder. LinkedFocus retains its existing hover delay/grace.
struct MatchFocusLink: View {
    let history: MatchHistory
    let domain: ClosedRange<Date>
    let pointer: OddsPointer
    let linked: LinkedFocus
    @State private var bridge = MatchFocusBridge()

    private struct Input: Equatable {
        let history: MatchHistory
        let domain: ClosedRange<Date>
        let moment: Date?
        let pinned: Bool
        let hovered: Focus?
        let focusPin: Focus?
    }

    var body: some View {
        let input = Input(history: history, domain: domain, moment: pointer.moment, pinned: pointer.pinned,
                          hovered: linked.hovered, focusPin: linked.pinned)
        Color.clear.frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: input, initial: true) { _, _ in
                bridge.synchronize(history: history, domain: domain, linked: linked, pointer: pointer)
            }
            .onDisappear { bridge.detach(linked: linked) }
    }
}
