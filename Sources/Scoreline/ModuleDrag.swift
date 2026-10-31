import AppKit
import SwiftUI

// Rearranging a game page's modules by dragging their headers. A press that
// travels past 4pt lifts the module: the page folds to its headers and
// glances for the moment (never saved) so all of it fits the panel; the
// module rides the pointer 1:1, raised a little, while the others slide out
// of its way; on release it settles, the order is saved for the sport
// (`ModuleLayout.rank`), and the page opens back up around it. Esc puts
// everything back. Near the viewport's top or bottom edge the page scrolls.
//
// The module in hand is drawn twice: its header, raised, in an overlay over
// the scroll view (the lift), and the module itself, unseen, at the gap it
// would land in. So scrolling never moves what's under the pointer, and the
// module keeps its identity (a folded Live View keeps its running order and
// clocks; nothing is rebuilt). As the page folds, it scrolls to keep the
// gap under the lift; where it can't, the lift glides onto its gap.
//
// Per frame, only the lift's placement re-renders. The page re-renders when
// the gap moves (the arrangement reads `preview`) and when the drag starts
// and ends (`compact`).

/// What the lift shows: the header's own words, handed over as the drag begins.
struct ModuleDragImage {
    var title: String
    var caption: String?
    var accessory: SectionAccessory?
    /// The module's own glance (the odds chart's), over the page's.
    var glance: ModuleGlance?
}

/// Dragging a module's header moves it: the handle the match page sets on
/// each module's chrome, with the page as it's arranged right now.
struct ModuleReorder {
    let drag: ModuleDrag
    /// "court": the module's ID (its fold key's second half, its section ID).
    let id: String
    /// The module's run, top to bottom: its column on the split page, else the page.
    let run: [String]
    /// Every module on the page, in the one-column order (the ranking's).
    let page: [String]
    /// The page's new order, saved for the sport.
    let commit: @MainActor ([String]) -> Void
    /// VoiceOver's Move Up and Move Down (nil at the run's ends).
    var moveUp: (@MainActor () -> Void)?
    var moveDown: (@MainActor () -> Void)?
}

@MainActor
@Observable
final class ModuleDrag {
    /// The scroll view's frame: the pointer and the lift are measured in it.
    nonisolated static let space = "ModuleDrag.viewport"

    enum Phase: Equatable { case idle, dragging, settling }

    private(set) var phase: Phase = .idle
    /// The module in hand: its lift is drawn.
    private(set) var id: String?
    private(set) var image: ModuleDragImage?
    /// The module unseen in the page, holding its gap.
    private(set) var gap: String?
    /// Every module folded while one is dragged (never saved).
    private(set) var compact = false
    /// The page's modules in the order the drag proposes, the dragged one
    /// at its gap: the arrangement's ranking meanwhile. Written only when
    /// the gap moves.
    private(set) var preview: [String]?
    /// The lift's top in the viewport (per frame: only the lift reads it).
    private(set) var liftY: CGFloat = 0
    /// Its column: fixed for the drag.
    private(set) var liftX: CGFloat = 0
    private(set) var liftWidth: CGFloat = 0
    /// Raised: a touch larger, with a soft shadow.
    private(set) var raised = false
    private(set) var liftOpacity: Double = 1
    /// On release, the module in the page takes over from its lift: drawn
    /// this far down from its place, gliding to none.
    private(set) var handoffID: String?
    private(set) var handoffY: CGFloat = 0

    @ObservationIgnored weak var geometry: PageGeometry?
    @ObservationIgnored private var reorder: ModuleReorder?
    /// The pointer's height below the header's top, at the press.
    @ObservationIgnored private var grab: CGFloat = 0
    @ObservationIgnored private var pointerY: CGFloat = 0
    /// The content offset the drag works with (the geometry's, or the autoscroll's ahead of it).
    @ObservationIgnored private var offset: CGFloat = 0
    @ObservationIgnored private var slot = 0
    @ObservationIgnored private var startSlot = 0
    /// The page as the drag found it: section frames (open), offset, content height.
    @ObservationIgnored private var startFrames: [String: CGRect] = [:]
    @ObservationIgnored private var startOffset: CGFloat = 0
    @ObservationIgnored private var startContent: CGFloat = 0
    /// The module's own fold when it was picked up (it opens back to it).
    @ObservationIgnored private var startFolded = false
    /// Esc ended this gesture's drag: the rest of the gesture is ignored.
    @ObservationIgnored private var spent = false
    /// The page is folding for the drag: until its layout lands, the gap stays put.
    @ObservationIgnored private var anchoring = false
    @ObservationIgnored private var anchorQueued = false
    @ObservationIgnored private var monitor: Any?
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var speed: CGFloat = 0
    @ObservationIgnored private var glideTimer: Timer?

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    // MARK: The gesture

    /// The header's drag moved (past the threshold): the first call lifts the module.
    func changed(_ value: DragGesture.Value, reorder: ModuleReorder, folded: Bool, image: ModuleDragImage) {
        guard !spent else { return }
        switch phase {
        case .idle: begin(value, reorder: reorder, folded: folded, image: image)
        case .dragging: move(to: value.location.y)
        case .settling: break
        }
    }

    /// The pointer came up.
    func ended() {
        if spent { return spent = false }
        if phase == .dragging { drop() }
    }

    /// The gesture is over however it ended (the system can cancel one
    /// without an `ended`): a drag still in hand goes back.
    func released() {
        if phase == .dragging { cancel() }
        spent = false
    }

    /// Esc: everything goes back where it was; the rest of the gesture does nothing.
    func cancel() {
        guard phase == .dragging, let geometry else { return }
        spent = true
        settle(scroll: startOffset, in: geometry)
    }

    /// The page lost the module (it has nothing to show any more) or went away.
    func abandon() {
        if phase == .dragging { cancel() }
        spent = false
    }

    // MARK: Phases

    private func begin(_ value: DragGesture.Value, reorder: ModuleReorder, folded: Bool, image: ModuleDragImage) {
        guard let geometry, let frame = geometry.frames[reorder.id], reorder.run.contains(reorder.id) else { return }
        glideTimer?.invalidate()
        glideTimer = nil
        self.reorder = reorder
        startFrames = geometry.frames
        startOffset = geometry.visible.minY
        startContent = geometry.contentHeight
        offset = startOffset
        startSlot = reorder.run.firstIndex(of: reorder.id) ?? 0
        slot = startSlot
        startFolded = folded
        grab = value.startLocation.y - (frame.minY + ModuleChrome.headerInset(folded: folded) - startOffset)
        pointerY = value.location.y
        liftX = frame.minX
        liftWidth = frame.width
        liftY = liftTop(pointerY)
        liftOpacity = 1
        self.image = image
        id = reorder.id
        gap = reorder.id
        phase = .dragging
        // The page folds for the drag; the panel keeps its size meanwhile.
        geometry.holdsSize = true
        anchoring = true
        geometry.framesChanged = { [weak self] in self?.queueAnchor() }
        // A page with nothing left to fold reports no new layout.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in self?.anchoring = false }
        let reduce = reduceMotion
        withAnimation(reduce ? Motion.fade : Motion.standard) { compact = true }
        withAnimation(reduce ? nil : Motion.quick) { raised = true }
        listenForEscape()
        autoscroll()
    }

    /// Once per batch of frames (the folded page's layout).
    private func queueAnchor() {
        guard anchoring, !anchorQueued else { return }
        anchorQueued = true
        DispatchQueue.main.async { [weak self] in
            self?.anchorQueued = false
            self?.anchor()
        }
    }

    /// The page has folded: it scrolls so the module's gap is under its
    /// lift; where it can't scroll that far, the lift glides onto its gap
    /// (and from there follows the pointer 1:1). Picked up and put down
    /// without moving, a module stays where it was.
    private func anchor() {
        guard anchoring, phase == .dragging, let id, let geometry, let gap = geometry.frames[id] else { return }
        anchoring = false
        let bottom = max(geometry.contentHeight - geometry.viewport.height, 0)
        let scroll = min(max(gap.minY - liftY, 0), bottom)
        if abs(scroll - geometry.visible.minY) > 0.5 { geometry.scroll(toY: scroll, animation: nil) }
        offset = scroll
        let residual = gap.minY - scroll - liftY
        guard abs(residual) > 0.5 else { return }
        grab -= residual
        withAnimation(reduceMotion ? nil : Motion.standard) { liftY += residual }
    }

    private func move(to y: CGFloat) {
        pointerY = y
        if timer == nil, !anchoring, let geometry { offset = geometry.visible.minY }
        liftY = liftTop(y)
        retarget()
        autoscroll()
    }

    /// The lift's top for a pointer height: the header stays where it was grabbed (folded, it sits 12pt down).
    private func liftTop(_ pointer: CGFloat) -> CGFloat {
        pointer - grab - ModuleChrome.headerInset(folded: true)
    }

    /// Moves the gap to the slot nearest the lift (others slide on `standard`; Reduce Motion: in place).
    private func retarget() {
        guard !anchoring, let geometry, let reorder, let id else { return }
        let frames = reorder.run.compactMap { geometry.frames[$0] }
        guard frames.count == reorder.run.count else { return }
        let others = reorder.run.filter { $0 != id }
        let next = ModuleOrder.slot(top: liftY + offset, runTop: frames.map(\.minY).min() ?? 0,
                                    heights: others.map { geometry.frames[$0]?.height ?? 0 })
        guard next != slot else { return }
        slot = next
        let page = ModuleOrder.permute(reorder.page, run: ModuleOrder.move(id, to: next, in: reorder.run))
        withAnimation(reduceMotion ? nil : Motion.standard) { preview = page }
    }

    /// Released: the order is saved, and the module settles where it was let
    /// go while the page opens back up around it (it scrolls to keep the
    /// module's header under the pointer, as far as the page allows).
    private func drop() {
        guard let reorder, let id, let geometry else { return finish() }
        let run = ModuleOrder.move(id, to: slot, in: reorder.run)
        if slot != startSlot { reorder.commit(ModuleOrder.permute(reorder.page, run: run)) }
        // Open again, its header lands at its run's top plus the open heights now above it.
        let top = reorder.run.compactMap { startFrames[$0]?.minY }.min() ?? 0
        let landing = top + run.prefix { $0 != id }.reduce(0) { $0 + (startFrames[$1]?.height ?? 0) }
            + ModuleChrome.headerInset(folded: startFolded)
        let bottom = max(startContent - geometry.viewport.height, 0)
        settle(scroll: min(max(landing - (liftY + ModuleChrome.headerInset(folded: true)), 0), bottom), in: geometry)
    }

    /// The module in the page takes over from its lift, drawn where the lift
    /// is (for one frame nothing changes on screen); then the page opens,
    /// scrolls to `scroll`, and the module glides home, all on `standard`, so
    /// they arrive together. Reduce Motion: the lift and the module cross-fade
    /// and the page opens in place.
    private func settle(scroll: CGFloat, in geometry: PageGeometry) {
        stopAutoscroll()
        stopListening()
        anchoring = false
        geometry.framesChanged = nil
        phase = .settling
        geometry.holdsSize = false
        guard let id, !reduceMotion else {
            withAnimation(Motion.fade) {
                preview = nil
                compact = false
                raised = false
                liftOpacity = 0
                gap = nil
            } completion: { [weak self] in
                self?.finish()
            }
            DispatchQueue.main.async { geometry.scroll(toY: scroll, animation: nil) }
            return
        }
        handoffID = id
        handoffY = liftY - ((geometry.frames[id]?.minY ?? 0) - geometry.visible.minY)
        self.id = nil
        gap = nil
        // Next turn: the hand-off has been drawn, so the glide starts from it.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            withAnimation(Motion.standard) {
                self.handoffY = 0
                self.preview = nil
                self.compact = false
                self.raised = false
            } completion: { [weak self] in
                self?.finish()
            }
            // A turn later, once the page has grown back to where it can scroll that far.
            DispatchQueue.main.async { [weak self] in self?.glide(to: scroll, in: geometry) }
        }
    }

    private func finish() {
        stopAutoscroll()
        stopListening()
        anchoring = false
        geometry?.framesChanged = nil
        geometry?.holdsSize = false
        id = nil
        gap = nil
        image = nil
        preview = nil
        compact = false
        raised = false
        liftOpacity = 1
        handoffID = nil
        handoffY = 0
        reorder = nil
        phase = .idle
    }

    /// Scrolls to `target` along `standard`'s curve, a frame at a time, in
    /// step with the page's own spring. (A scroll view drops an animated
    /// scroll while the mouse is still down in it, as it is after Esc.)
    private func glide(to target: CGFloat, in geometry: PageGeometry) {
        let from = geometry.visible.minY
        glideTimer?.invalidate()
        glideTimer = nil
        guard abs(target - from) > 0.5 else { return }
        let start = CACurrentMediaTime()
        let timer = Timer(timeInterval: 1.0 / 120, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                let progress = Self.springProgress(CACurrentMediaTime() - start)
                geometry.scroll(toY: from + (target - from) * progress, animation: nil)
                if progress >= 1 {
                    timer.invalidate()
                    self?.glideTimer = nil
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        glideTimer = timer
    }

    /// How far along `Motion.standard` (a 0.3 s spring, no bounce: critically
    /// damped) is `t` seconds in; 1 from twice its duration. (pure; tested)
    nonisolated static func springProgress(_ t: Double, duration: Double = 0.3) -> Double {
        guard t < 2 * duration else { return 1 }
        let omega = 2 * Double.pi / duration
        return max(0, 1 - (1 + omega * t) * exp(-omega * t))
    }

    // MARK: Esc

    /// Esc cancels, whatever has keyboard focus (a local monitor sees the key before the page does).
    private func listenForEscape() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return event }
            let took = MainActor.assumeIsolated { () -> Bool in
                guard let self, self.phase == .dragging else { return false }
                self.cancel()
                return true
            }
            return took ? nil : event
        }
    }

    private func stopListening() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    // MARK: Autoscroll

    /// Points per tick (60 a second) for a pointer at `pointer` in a viewport
    /// `height` tall: within `zone` of an edge (below `topInset`, the docked
    /// bar), faster the closer, up to `fastest`. (pure; tested)
    nonisolated static func autoscrollSpeed(pointer: CGFloat, height: CGFloat, topInset: CGFloat,
                                            zone: CGFloat = 44, fastest: CGFloat = 12) -> CGFloat {
        guard height > 2 * zone else { return 0 }
        let top = topInset + zone, bottom = height - zone
        if pointer < top { return -fastest * min((top - pointer) / zone, 1) }
        if pointer > bottom { return fastest * min((pointer - bottom) / zone, 1) }
        return 0
    }

    private func autoscroll() {
        guard phase == .dragging, let geometry else { return stopAutoscroll() }
        speed = Self.autoscrollSpeed(pointer: pointerY, height: geometry.viewport.height,
                                     topInset: geometry.dockProgress >= 0.5 ? PageGeometry.dockInset : 0)
        guard speed != 0 else { return stopAutoscroll() }
        guard timer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        guard phase == .dragging, let geometry else { return stopAutoscroll() }
        let bottom = max(geometry.contentHeight - geometry.viewport.height, 0)
        let next = min(max(offset + speed, 0), bottom)
        guard next != offset else { return }
        offset = next
        geometry.scroll(toY: next, animation: nil)
        retarget()
    }

    private func stopAutoscroll() {
        timer?.invalidate()
        timer = nil
        speed = 0
    }
}

// MARK: - Views

/// The module in hand, raised over the page at the pointer: its header and
/// glance (the folded form) on a card, a touch larger, with a soft shadow.
/// Not interactive; VoiceOver doesn't see it (the module itself is still in the page).
struct ModuleLift<Content: View>: View {
    let drag: ModuleDrag
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.horizontal, Metrics.gutter)
            .padding(.top, ModuleChrome.headerInset(folded: true))
            .frame(width: drag.liftWidth, alignment: .topLeading)
            .background { ModuleCard(drag: drag) }
            .modifier(ModuleLiftPlacement(drag: drag))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Where the lift is: the only view that re-renders as the pointer moves.
private struct ModuleLiftPlacement: ViewModifier {
    let drag: ModuleDrag

    func body(content: Content) -> some View {
        content
            .scaleEffect(drag.raised ? 1.02 : 1)
            .opacity(drag.liftOpacity)
            .offset(x: drag.liftX, y: drag.liftY)
    }
}

/// The lift's card: the panel's raised surface, its shadow coming with the lift.
private struct ModuleCard: View {
    let drag: ModuleDrag
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ModuleSlotShape()
            .fill(scheme == .dark ? Color(white: 0.24) : .white)
            .overlay(ModuleSlotShape().strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
            .shadow(color: .black.opacity(drag.raised ? (scheme == .dark ? 0.45 : 0.18) : 0), radius: 14, y: 6)
            .padding(ModuleSlotShape.insets)
    }
}

/// A module's folded block, as a rounded shape: the lift's card and the gap's well.
struct ModuleSlotShape: InsettableShape {
    /// From the module's frame: the card reaches 8pt past the text on each side and 6pt above the header.
    static let insets = EdgeInsets(top: 6, leading: Metrics.gutter - 8, bottom: -4, trailing: Metrics.gutter - 8)
    var inset: CGFloat = 0

    func path(in rect: CGRect) -> Path {
        RoundedRectangle(cornerRadius: 10, style: .continuous).path(in: rect.insetBy(dx: inset, dy: inset))
    }

    func inset(by amount: CGFloat) -> ModuleSlotShape { ModuleSlotShape(inset: inset + amount) }
}

/// The module in hand, in the page: unseen, holding the gap it will land in
/// (a faint well marks it); on release, gliding home from where its lift was.
struct ModuleGap: ViewModifier {
    let drag: ModuleDrag
    let id: String

    func body(content: Content) -> some View {
        let gap = drag.gap == id
        content
            .opacity(gap ? 0 : 1)
            .overlay {
                if gap {
                    ModuleSlotShape().fill(Color.primary.opacity(0.05)).padding(ModuleSlotShape.insets)
                        .transition(.asymmetric(insertion: .opacity.animation(Motion.fade), removal: .identity))
                }
            }
            .offset(y: drag.handoffID == id ? drag.handoffY : 0)
    }
}

#if DEBUG
/// The interaction harness listens here: a module header's pointer entering or leaving (the wash lit or not).
@MainActor
enum ModuleProbe {
    static var hover: ((String, Bool) -> Void)?
}
#endif
