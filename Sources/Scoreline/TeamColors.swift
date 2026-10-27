import AppKit
import CoreGraphics
import SwiftUI

// MARK: - OKLab

/// A color in OKLab, the perceptual space team colors are read and adjusted
/// in: equal steps look equal, and changing lightness keeps the hue. (Mixing
/// in white, as sRGB blending does, turns every navy into the same pale blue
/// and every red into the same pink.)
struct OKLab: Equatable {
    var l: Double
    var a: Double
    var b: Double

    init(l: Double, a: Double, b: Double) { (self.l, self.a, self.b) = (l, a, b) }

    init(l: Double, chroma: Double, hue: Double) {
        let radians = hue * .pi / 180
        self.init(l: l, a: chroma * cos(radians), b: chroma * sin(radians))
    }

    /// From sRGB components in 0...1.
    init(red: Double, green: Double, blue: Double) {
        func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        let (r, g, b) = (linear(red), linear(green), linear(blue))
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        self.init(l: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                  a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                  b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)
    }

    init?(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(red: Double(value >> 16 & 0xff) / 255, green: Double(value >> 8 & 0xff) / 255, blue: Double(value & 0xff) / 255)
    }

    init?(_ color: NSColor) {
        guard let c = color.usingColorSpace(.sRGB) else { return nil }
        self.init(red: c.redComponent, green: c.greenComponent, blue: c.blueComponent)
    }

    var chroma: Double { (a * a + b * b).squareRoot() }

    /// Degrees, 0..<360.
    var hue: Double {
        let h = atan2(b, a) * 180 / .pi
        return h < 0 ? h + 360 : h
    }

    func distance(to other: OKLab) -> Double {
        let (dl, da, db) = (l - other.l, a - other.a, b - other.b)
        return (dl * dl + da * da + db * db).squareRoot()
    }

    /// Linear sRGB, possibly outside 0...1.
    private var linearRGB: (r: Double, g: Double, b: Double) {
        let l = pow(self.l + 0.3963377774 * a + 0.2158037573 * b, 3)
        let m = pow(self.l - 0.1055613458 * a - 0.0638541728 * b, 3)
        let s = pow(self.l - 0.0894841775 * a - 1.2914855480 * b, 3)
        return (4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    }

    private var inGamut: Bool {
        let c = linearRGB
        let range = -0.0001...1.0001
        return range.contains(c.r) && range.contains(c.g) && range.contains(c.b)
    }

    /// sRGB components in 0...1. Out-of-gamut colors keep their lightness and
    /// hue and give up chroma until they fit.
    var rgb: (r: Double, g: Double, b: Double) {
        var color = self
        if !inGamut {
            var (lo, hi) = (0.0, chroma)
            let h = hue
            for _ in 0..<20 {
                let mid = (lo + hi) / 2
                if OKLab(l: l, chroma: mid, hue: h).inGamut { lo = mid } else { hi = mid }
            }
            color = OKLab(l: l, chroma: lo, hue: h)
        }
        func encode(_ c: Double) -> Double {
            let c = min(max(c, 0), 1)
            return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055
        }
        let c = color.linearRGB
        return (encode(c.r), encode(c.g), encode(c.b))
    }

    var nsColor: NSColor {
        let c = rgb
        return NSColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 1)
    }

    var hex: String {
        let c = rgb
        return String(format: "%02x%02x%02x", Int((c.r * 255).rounded()), Int((c.g * 255).rounded()), Int((c.b * 255).rounded()))
    }
}

// MARK: - Tone

/// Fits a team color to the panel without changing which color it is: only
/// lightness moves (dark colors lift on a dark panel, pale ones deepen on a
/// light one), so hue and saturation, the things that tell two teams apart,
/// are kept. Colors with no usable hue here come back as `nil` and are shown
/// honestly as gray.
enum TeamTone {
    static func adjust(_ color: NSColor, scheme: ColorScheme) -> NSColor? {
        guard var lab = OKLab(color) else { return nil }
        let gray = lab.chroma < 0.03
        switch scheme {
        case .dark:
            // Black has nothing to lift into.
            if gray && lab.l < 0.3 { return nil }
            // 0.68: every team mark clears 3:1 against the chart plate on the
            // real dark glass (measured), and a receded one 2:1.
            if lab.l < 0.68 {
                // Lifting lightness alone washes a color out (navy would read as
                // slate), so chroma rises with it, gently, to keep its character.
                let lift = 0.68 / max(lab.l, 0.2)
                let chroma = lab.chroma * min(pow(lift, 0.5), 1.8)
                lab = OKLab(l: 0.68, chroma: chroma, hue: lab.hue)
            } else if lab.l > 0.86 {
                // Near-white would out-shout the other team.
                lab = OKLab(l: 0.86, a: lab.a, b: lab.b)
            }
        default:
            if gray && lab.l > 0.95 { return nil }
            // Yellow only exists light: deepened as far as other hues, it turns olive.
            // Others stop at 0.62, which keeps pale ones (sky blue) near 3.6:1 on white.
            let cap = (75...115).contains(lab.hue) && lab.chroma > 0.08 ? 0.8 : 0.62
            if lab.l > cap { lab = OKLab(l: cap, chroma: lab.chroma, hue: lab.hue) }
        }
        return lab.nsColor
    }
}

// MARK: - Logo colors

/// Each team's own colors, read from its logo: the colors it reads as
/// (ignoring white, black, grays and transparency), strongest first. Sources
/// give at most one team color, often a stock shade many teams share, and
/// none at all for CS2, so the logo is the better witness. Read once per logo
/// and kept on disk.
@MainActor
final class TeamColors {
    static let shared = TeamColors()

    struct Entry: Codable, Equatable {
        /// Up to three clearly different colors, strongest first. Empty: the
        /// logo is black and white, so the source's color stands.
        let colors: [String]
        /// How strongly the logo reads as each color, relative to the first (1).
        var weights: [Double] = []
    }

    /// The app turns this on; tests and render harnesses never fetch logos.
    var isEnabled = false
    /// Called (at most every half second) when newly read logos have colors.
    var onChange: (() -> Void)?

    /// Bump when the reading changes, so every logo is read again.
    private static let version = 5
    private var entries: [String: Entry]
    private var pending: Set<String> = []
    private var queue: [URL] = []
    private var running = 0
    private var notifyScheduled = false
    private var saveScheduled = false
    private let file: URL? = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
        .appendingPathComponent(Bundle.main.bundleIdentifier ?? "Scoreline", isDirectory: true)
        .appendingPathComponent("team-colors-v\(TeamColors.version).json")

    private init() {
        entries = file.flatMap { try? Data(contentsOf: $0) }
            .flatMap { try? JSONDecoder().decode([String: Entry].self, from: $0) } ?? [:]
    }

    func entry(for logo: URL?) -> Entry? { logo.flatMap { entries[$0.absoluteString] } }

    /// The competitor wearing its logo's colors, when they're known. Logos not
    /// read yet are queued; `onChange` reports when they are.
    func apply(_ competitor: Competitor) -> Competitor {
        guard let logo = competitor.logo else { return competitor }
        guard let entry = entries[logo.absoluteString] else {
            request(logo)
            return competitor
        }
        let colors = Self.order(entry, source: competitor.color)
        guard !colors.isEmpty else { return competitor }
        var c = competitor
        c.color = colors[0]
        c.alternateColor = colors.count > 1 ? colors[1] : competitor.alternateColor
        return c
    }

    /// The logo's colors in the order a team wears them. When the logo reads
    /// almost as strongly as the source's own color as it does its first one,
    /// the source's tips it (Thunder blue over the sunset band). A navy source
    /// color never does: that's the shade half a league shares.
    nonisolated static func order(_ entry: Entry, source: String?) -> [String] {
        var colors = entry.colors
        guard let source = source.flatMap(OKLab.init(hex:)),
              source.chroma >= 0.12 || (source.l >= 0.4 && source.chroma >= 0.06),
              let match = colors.indices.dropFirst().first(where: { sameColor(colors[$0], source) }),
              match < entry.weights.count, entry.weights[match] >= 0.6 else { return colors }
        colors.insert(colors.remove(at: match), at: 0)
        return colors
    }

    /// The same color named two ways: one hue family, similar lightness.
    private nonisolated static func sameColor(_ hex: String, _ source: OKLab) -> Bool {
        guard let lab = OKLab(hex: hex) else { return false }
        var hues = abs(lab.hue - source.hue)
        if hues > 180 { hues = 360 - hues }
        return hues <= 25 && abs(lab.l - source.l) <= 0.25
    }

    func apply(_ events: [Event]) -> [Event] {
        events.map { event in
            guard case let .match(top, bottom) = event.content else { return event }
            let (t, b) = (apply(top), apply(bottom))
            return t == top && b == bottom ? event : event.with(content: .match(top: t, bottom: b))
        }
    }

    private func request(_ logo: URL) {
        let key = logo.absoluteString
        guard isEnabled, !pending.contains(key) else { return }
        pending.insert(key)
        queue.append(logo)
        pump()
    }

    /// Four at a time: the first launch reads a hundred-odd logos.
    private func pump() {
        while running < 4, !queue.isEmpty {
            let logo = queue.removeFirst()
            running += 1
            Task {
                let image = await ImageCache.shared.image(for: logo, pixels: 64, remember: false)
                let cg = image.flatMap { $0.cgImage(forProposedRect: nil, context: nil, hints: nil) }
                // Reading the pixels is off the main thread.
                let entry = await Self.readOffMain(cg)
                running -= 1
                // A failed download isn't recorded: it's tried again next time.
                if let entry {
                    entries[logo.absoluteString] = entry
                    scheduleSave()
                    if !entry.colors.isEmpty { scheduleNotify() }
                }
                pending.remove(logo.absoluteString)
                pump()
            }
        }
    }

    private func scheduleNotify() {
        guard !notifyScheduled else { return }
        notifyScheduled = true
        Task {
            try? await Task.sleep(for: .milliseconds(500))
            notifyScheduled = false
            onChange?()
        }
    }

    @concurrent private nonisolated static func readOffMain(_ image: CGImage?) async -> Entry? {
        image.map(read)
    }

    /// One write for a burst of new logos (the first launch reads a hundred-odd).
    private func scheduleSave() {
        guard !saveScheduled else { return }
        saveScheduled = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            saveScheduled = false
            save()
        }
    }

    private func save() {
        guard let file, let data = try? JSONEncoder().encode(entries) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    /// The logo's colors, strongest first: the color it reads as, then the
    /// next ones that are clearly different (another hue, or far lighter or
    /// darker; not a second shade of the same gold).
    nonisolated static func read(_ image: CGImage) -> Entry {
        let (w, h) = (image.width, image.height)
        guard w > 0, h > 0 else { return Entry(colors: []) }
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        let drawn = bytes.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                          space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return Entry(colors: []) }

        var opaque = 0
        var colors: [OKLab] = []
        for i in stride(from: 0, to: bytes.count, by: 4) {
            let alpha = Double(bytes[i + 3]) / 255
            // Antialiased edges are a blend with the background: skip them.
            guard alpha > 0.7 else { continue }
            opaque += 1
            // Premultiplied: divide the alpha back out.
            func channel(_ v: UInt8) -> Double { min(Double(v) / 255 / alpha, 1) }
            let lab = OKLab(red: channel(bytes[i]), green: channel(bytes[i + 1]), blue: channel(bytes[i + 2]))
            if lab.chroma >= 0.04 { colors.append(lab) }
        }
        // A sliver of color in a black-and-white crest isn't the team's color.
        guard opaque > 0, Double(colors.count) / Double(opaque) >= 0.04 else { return Entry(colors: []) }

        var found: [(color: OKLab, count: Int, weight: Double)] = []
        var rest = colors
        for _ in 0..<6 where found.count < 3 {
            guard let next = dominant(in: rest) else { break }
            if let first = found.first, next.count < max(first.count / 8, 12) { break }
            if found.allSatisfy({ distinct(next.color, $0.color) }) { found.append(next) }
            rest = rest.filter { $0.distance(to: next.color) > 0.1 }
        }
        // Found in bin order; a later color can turn out heavier once its
        // neighbors are gathered in.
        found.sort { $0.weight > $1.weight }
        let first = found.first?.weight ?? 1
        return Entry(colors: found.map(\.color.hex), weights: found.map { ($0.weight / first * 100).rounded() / 100 })
    }

    private nonisolated static func distinct(_ x: OKLab, _ y: OKLab) -> Bool {
        var hues = abs(x.hue - y.hue)
        if hues > 180 { hues = 360 - hues }
        return hues >= 30 || abs(x.l - y.l) >= 0.22
    }

    /// The color the logo reads as: bin by hue and lightness, take the
    /// heaviest bin, then average everything near its mean so a color
    /// straddling two bins isn't split. Pixels weigh by vividness as well as
    /// area: a navy outline (shared by half a league) counts for less than the
    /// gold or Beale Street blue it frames, which is the color people see.
    private nonisolated static func dominant(in colors: [OKLab]) -> (color: OKLab, count: Int, weight: Double)? {
        guard !colors.isEmpty else { return nil }
        var bins: [Int: (weight: Double, l: Double, a: Double, b: Double, n: Double)] = [:]
        for c in colors {
            let key = Int(c.hue / 20) * 4 + min(Int(c.l / 0.25), 3)
            var bin = bins[key] ?? (0, 0, 0, 0, 0)
            bin.weight += vividness(c)
            bin.l += c.l; bin.a += c.a; bin.b += c.b; bin.n += 1
            bins[key] = bin
        }
        guard let top = bins.values.max(by: { $0.weight < $1.weight }) else { return nil }
        let center = OKLab(l: top.l / top.n, a: top.a / top.n, b: top.b / top.n)
        let near = colors.filter { $0.distance(to: center) <= 0.09 }
        guard !near.isEmpty else { return (center, Int(top.n), top.weight) }
        let n = Double(near.count)
        let mean = OKLab(l: near.map(\.l).reduce(0, +) / n, a: near.map(\.a).reduce(0, +) / n, b: near.map(\.b).reduce(0, +) / n)
        return (mean, near.count, near.map(vividness).reduce(0, +))
    }

    private nonisolated static func vividness(_ c: OKLab) -> Double {
        // Navy: dark and muted. Rich dark colors (Ravens purple, Villa claret) keep full weight.
        let navy = c.l < 0.4 && c.chroma < 0.11 ? 0.5 : 1
        return min(max(c.chroma / 0.12, 0.35), 1.5) * navy
    }
}
