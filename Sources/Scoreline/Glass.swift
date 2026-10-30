import SwiftUI

// Liquid Glass on macOS 26+, with the previous translucent look as a fallback.
// Glass is reserved for the floating layer — controls, badges, the detail
// header card — per Apple's guidance; content stays on plain surfaces so
// glass never stacks on glass.

private struct GlassModifier<S: Shape>: ViewModifier {
    let shape: S
    let tint: Color?
    let interactive: Bool
    let clear: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.glassPresence) private var presence
    #if DEBUG
    /// The render harness: Liquid Glass can't be captured offscreen.
    @Environment(\.glassStandIn) private var standIn
    #else
    private let standIn = false
    #endif

    /// Increase Contrast: every glass surface gets a visible edge, and clear
    /// glass (the hero card over a saturated wash) turns regular, so the
    /// secondary text on it keeps its contrast.
    private var increased: Bool { contrast == .increased }

    func body(content: Content) -> some View {
        if reduceTransparency || standIn {
            // Reduce Transparency: a solid surface with a defined edge.
            content
                .background(shape.fill(tint?.opacity(0.9) ?? Color(nsColor: .controlBackgroundColor)))
                .overlay(shape.stroke(Color.primary.opacity(increased ? 0.25 : 0.12), lineWidth: 0.5))
                .opacity(presence)
        } else if #available(macOS 26.0, *) {
            let base: Glass = clear && !increased ? .clear : .regular
            // Stepping aside (`glassPresence`): the content fades inside the
            // glass and the glass itself goes, as only those reach the screen
            // through a container.
            content.opacity(presence)
                .glassEffect(GlassPresence.glass(base.tint(tint).interactive(interactive), presence: presence), in: shape)
                .overlay { if increased { shape.stroke(Color.primary.opacity(0.25 * presence), lineWidth: 0.5).allowsHitTesting(false) } }
        } else {
            content
                .background(shape.fill(tint?.opacity(0.85) ?? Color.primary.opacity(increased ? 0.1 : 0.07)))
                .overlay(shape.stroke(Color.primary.opacity(increased ? 0.25 : 0.08), lineWidth: 0.5))
                .opacity(presence)
        }
    }
}

/// A glass surface stepping aside (the hero card under its scoring slide).
/// Inside a `GlassEffectContainer` an opacity can't do it: the container
/// composites its glass shapes, with their content, over everything else
/// inside it, and an opacity applied around a glass view reaches neither the
/// glass nor what's in it. So the surface steps aside from within: its
/// content fades, and the glass becomes identity glass (no glass), which the
/// container fades out with the same animation.
enum GlassPresence {
    /// The glass at `presence` (0 gone, 1 shown): itself until it's gone.
    @available(macOS 26.0, *)
    static func glass(_ glass: Glass, presence: Double) -> Glass { presence > 0 ? glass : .identity }
}

private struct GlassPresenceKey: EnvironmentKey {
    static let defaultValue = 1.0
}

extension EnvironmentValues {
    /// How much of the glass surfaces below shows, 0 to 1 (see `GlassPresence`):
    /// `SlideCover` steps the hero card aside with it. Every glass surface
    /// reads it; nothing but the cover ever sets it.
    var glassPresence: Double {
        get { self[GlassPresenceKey.self] }
        set { self[GlassPresenceKey.self] = newValue }
    }
}

/// `GlassGroup` as a modifier, for wrapping an existing stack.
struct GlassGroupModifier: ViewModifier {
    var spacing: CGFloat = 8

    func body(content: Content) -> some View {
        GlassGroup(spacing: spacing) { content }
    }
}

extension View {
    /// Glass in a shape. `interactive` adds the system's hover/press response.
    func glass(in shape: some Shape, tint: Color? = nil, interactive: Bool = false, clear: Bool = false) -> some View {
        modifier(GlassModifier(shape: shape, tint: tint, interactive: interactive, clear: clear))
    }

    func glassCapsule(tint: Color? = nil, interactive: Bool = false) -> some View {
        glass(in: Capsule(), tint: tint, interactive: interactive)
    }

    /// The hero card's glass (match, team and player pages), at `Metrics.heroRadius`.
    func glassCard(cornerRadius: CGFloat = Metrics.heroRadius, tint: Color? = nil, clear: Bool = false) -> some View {
        glass(in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous), tint: tint, clear: clear)
    }

    /// The system's soft scroll edge on macOS 26 (content dissolves under the
    /// header/footer); callers draw hairlines themselves on older systems.
    @ViewBuilder
    func softScrollEdges() -> some View {
        if #available(macOS 26.0, *) {
            self.scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
        } else {
            self
        }
    }
}

/// Groups nearby glass shapes so they blend and morph together as one surface.
struct GlassGroup<Content: View>: View {
    var spacing: CGFloat = 8
    @ViewBuilder let content: Content
    #if DEBUG
    /// The render harness: a glass container draws nothing offscreen.
    @Environment(\.glassStandIn) private var standIn
    #else
    private let standIn = false
    #endif

    var body: some View {
        if standIn {
            content
        } else if #available(macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

enum GlassSupport {
    static var available: Bool {
        if #available(macOS 26.0, *) { return true }
        return false
    }
}
