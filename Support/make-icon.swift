// Renders the app icon: a planet almost wholly in night, a thin cold crescent
// of day on its rim, in ordered-dither pixels on a starfield.
// Usage: swift make-icon.swift <output.png>
import AppKit

let size = 1024.0, inset = 100.0, side = 824.0
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32) -> CGColor {
    CGColor(srgbRed: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
            blue: Double(hex & 255) / 255, alpha: 1)
}
func clamp(_ v: Double) -> Double { min(max(v, 0), 1) }

/// Night to ice: the tones the dither mixes between.
let palette = [0x01070D, 0x0A2438, 0x23628A, 0x8FCBEE, 0xF4FBFF].map(color)

/// 8 × 8 Bayer thresholds in 0…1.
let bayer: [[Double]] = {
    var m: [[Double]] = [[0]]
    while m.count < 8 {
        let n = m.count
        var next = Array(repeating: Array(repeating: 0.0, count: n * 2), count: n * 2)
        for y in 0..<n {
            for x in 0..<n {
                let v = m[y][x] * 4
                next[y][x] = v; next[y][x + n] = v + 2; next[y + n][x] = v + 3; next[y + n][x + n] = v + 1
            }
        }
        m = next
    }
    return m.map { $0.map { ($0 + 0.5) / 64 } }
}()

/// Deterministic hash noise in 0..<1, so every build draws the same stars.
func noise(_ x: Double, _ y: Double) -> Double {
    var h = UInt64(bitPattern: Int64(x * 73856093) ^ Int64(y * 19349663)) &* 0x9E3779B97F4A7C15
    h ^= h >> 29; h = h &* 0xBF58476D1CE4E5B9; h ^= h >> 32
    return Double(h % 10000) / 10000
}
func star(_ x: Double, _ y: Double) -> Double {
    let cx = (x / 7).rounded(.down), cy = (y / 7).rounded(.down)
    return noise(cx, cy) < 0.006 ? 0.6 + 0.4 * noise(cy, cx) : 0
}

// The planet, and the light from behind and to the upper right of it.
let center = (x: 512.0, y: 512.0), radius = 270.0
let light: (x: Double, y: Double, z: Double) = {
    let l = (0.82, 0.45, -0.22), n = (l.0 * l.0 + l.1 * l.1 + l.2 * l.2).squareRoot()
    return (l.0 / n, l.1 / n, l.2 / n)
}()

func tone(_ x: Double, _ y: Double) -> Double {
    let dx = (x - center.x) / radius, dy = (y - center.y) / radius, d2 = dx * dx + dy * dy
    if d2 <= 1 {
        let lit = clamp(dx * light.x + dy * light.y + (1 - d2).squareRoot() * light.z)
        return 0.05 + 0.95 * pow(lit, 1.25)
    }
    // Atmosphere: a glow off the rim, brightest on the lit side.
    let distance = d2.squareRoot() * radius
    let glow = exp(-(distance - radius) / (radius * 0.22)) * (0.5 + 0.5 * (dx * light.x + dy * light.y) / d2.squareRoot())
    return clamp(0.06 + 0.5 * glow + star(x, y))
}

let context = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let squircle = CGPath(roundedRect: CGRect(x: inset, y: inset, width: side, height: side),
                      cornerWidth: 185, cornerHeight: 185, transform: nil)

context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: CGColor(gray: 0, alpha: 0.3))
context.addPath(squircle)
context.setFillColor(color(0x000000))
context.fillPath()
context.restoreGState()

// Ordered dither in 6 pt cells: each takes one of the two palette tones around its value.
context.addPath(squircle)
context.clip()
let cell = 6.0
for (row, y) in stride(from: inset, to: inset + side, by: cell).enumerated() {
    for (column, x) in stride(from: inset, to: inset + side, by: cell).enumerated() {
        let p = tone(x + cell / 2, y + cell / 2) * Double(palette.count - 1)
        let low = min(Int(p), palette.count - 1)
        let mixUp = p - Double(low) > bayer[row % 8][column % 8] && low + 1 < palette.count
        context.setFillColor(palette[mixUp ? low + 1 : low])
        context.fill(CGRect(x: x, y: y, width: cell, height: cell))
    }
}

let rep = NSBitmapImageRep(cgImage: context.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
