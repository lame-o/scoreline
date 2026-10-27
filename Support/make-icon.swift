// Renders the app icon: a score panel dropping from a menu bar item, on a
// deep graphite-to-green squircle. Drawn from plain shapes (no symbols or fonts).
// Usage: swift make-icon.swift <output.png>
import AppKit

let size: CGFloat = 1024
let white = NSColor.white
let live = NSColor(red: 1, green: 0.27, blue: 0.23, alpha: 1)
let ink = NSColor(red: 0.05, green: 0.27, blue: 0.18, alpha: 1)

func capsule(_ r: NSRect) -> NSBezierPath { NSBezierPath(roundedRect: r, xRadius: r.height / 2, yRadius: r.height / 2) }

let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
    let inset = rect.insetBy(dx: 100, dy: 100)
    let shape = NSBezierPath(roundedRect: inset, xRadius: 185, yRadius: 185)

    NSGraphicsContext.current?.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
    shadow.shadowBlurRadius = 24
    shadow.shadowOffset = NSSize(width: 0, height: -10)
    shadow.set()
    NSColor.black.setFill()
    shape.fill()
    NSGraphicsContext.current?.restoreGraphicsState()

    NSGradient(colors: [
        NSColor(red: 0.07, green: 0.36, blue: 0.24, alpha: 1),
        NSColor(red: 0.04, green: 0.16, blue: 0.12, alpha: 1),
    ])!.draw(in: shape, angle: -90)

    NSGraphicsContext.current?.saveGraphicsState()
    shape.addClip()

    // The menu bar, with Scoreline's item selected.
    white.withAlphaComponent(0.18).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 742, width: size, height: 62)).fill()
    white.withAlphaComponent(0.92).setFill()
    NSBezierPath(roundedRect: NSRect(x: 596, y: 752, width: 168, height: 42), xRadius: 12, yRadius: 12).fill()

    // The panel hanging from it, popover-style, lifted off the background.
    NSGraphicsContext.current?.saveGraphicsState()
    let lift = NSShadow()
    lift.shadowColor = NSColor.black.withAlphaComponent(0.35)
    lift.shadowBlurRadius = 40
    lift.shadowOffset = NSSize(width: 0, height: -16)
    lift.set()
    white.setFill()
    let panel = NSBezierPath(roundedRect: NSRect(x: 262, y: 236, width: 500, height: 470), xRadius: 72, yRadius: 72)
    panel.move(to: NSPoint(x: 650, y: 700))
    panel.line(to: NSPoint(x: 680, y: 732))
    panel.line(to: NSPoint(x: 710, y: 700))
    panel.close()
    panel.fill()
    NSGraphicsContext.current?.restoreGraphicsState()

    // "● Live"
    live.setFill()
    NSBezierPath(ovalIn: NSRect(x: 318, y: 618, width: 40, height: 40)).fill()
    capsule(NSRect(x: 372, y: 624, width: 84, height: 28)).fill()

    // Two team rows: crest, name, score.
    for (row, y) in [486.0, 330.0].enumerated() {
        ink.withAlphaComponent(row == 0 ? 1 : 0.45).setFill()
        NSBezierPath(ovalIn: NSRect(x: 318, y: y, width: 96, height: 96)).fill()
        capsule(NSRect(x: 440, y: y + 30, width: row == 0 ? 150 : 120, height: 36)).fill()
        NSBezierPath(roundedRect: NSRect(x: 636, y: y + 8, width: 70, height: 80), xRadius: 16, yRadius: 16).fill()
    }
    NSGraphicsContext.current?.restoreGraphicsState()
    return true
}

let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
