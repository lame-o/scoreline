import AppKit
import SwiftUI

// Team colors read from logos: the color a logo reads as (navy outlines count
// for less than the color they frame), a second color that's truly different,
// black-and-white crests left to the source, the source's own color tipping a
// near tie, and lightness-only fitting that keeps each team's hue.

extension ScorelineTests {
    static func teamColors() {
        print("\nTeam colors")

        /// A 64×64 logo: bands of color by share of the area, then transparent.
        func logo(_ bands: [(hex: UInt32, share: Double)]) -> CGImage {
            let size = 64
            let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
                                    space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            var y = 0.0
            for band in bands {
                let h = band.share * Double(size)
                context.setFillColor(red: CGFloat(band.hex >> 16 & 0xff) / 255, green: CGFloat(band.hex >> 8 & 0xff) / 255,
                                     blue: CGFloat(band.hex & 0xff) / 255, alpha: 1)
                context.fill(CGRect(x: 0, y: y, width: Double(size), height: h))
                y += h
            }
            return context.makeImage()!
        }
        func lab(_ hex: String?) -> OKLab? { hex.flatMap(OKLab.init(hex:)) }
        func near(_ hex: String?, _ target: String, within: Double = 0.03) -> Bool {
            guard let a = lab(hex), let b = lab(target) else { return false }
            return a.distance(to: b) <= within
        }

        // Liverpool-like: one red, on white.
        let red = TeamColors.read(logo([(0xd11317, 0.5), (0xffffff, 0.5)]))
        check(red.colors.count == 1 && near(red.colors.first, "d11317"), "one color on white: that color, its exact hex",
              "\(red.colors)")

        // Nuggets-like: a navy field (55%) framing gold (30%) and a little red.
        let nuggets = TeamColors.read(logo([(0x0e2240, 0.55), (0xfec524, 0.3), (0x8b2131, 0.15)]))
        check(near(nuggets.colors.first, "fec524"), "a navy frame counts for less than the gold it frames", "\(nuggets.colors)")
        check(nuggets.colors.contains { near($0, "0e2240") }, "navy is still kept as a second color")

        // Ravens-like: rich dark purple isn't navy, so area wins.
        let ravens = TeamColors.read(logo([(0x241773, 0.6), (0x9e7c0c, 0.25), (0x000000, 0.15)]))
        check(near(ravens.colors.first, "241773"), "rich dark purple keeps its full weight", "\(ravens.colors)")

        // Two shades of one gold aren't two colors; purple is.
        let lakers = TeamColors.read(logo([(0xfdb927, 0.4), (0xc89a20, 0.2), (0x552583, 0.25)]))
        check(lakers.colors.count == 2 && near(lakers.colors.last, "552583", within: 0.05),
              "a second shade of the same gold isn't a second color", "\(lakers.colors)")

        // Black, white and gray: nothing to read.
        let mono = TeamColors.read(logo([(0x000000, 0.5), (0xffffff, 0.3), (0x8a8d8f, 0.2)]))
        check(mono.colors.isEmpty, "a black-and-white crest leaves the source's color")
        let sliver = TeamColors.read(logo([(0x000000, 0.98), (0xc8102e, 0.02)]))
        check(sliver.colors.isEmpty, "a sliver of color in a black crest isn't the team's color")

        // The source's own color tips a near tie, but only a vivid one.
        let tie = TeamColors.Entry(colors: ["f63b1e", "2c7ec1"], weights: [1, 0.64])
        check(TeamColors.order(tie, source: "007ac1").first == "2c7ec1", "the source's color tips a near tie (Thunder blue)")
        let far = TeamColors.Entry(colors: ["f63b1e", "2c7ec1"], weights: [1, 0.3])
        check(TeamColors.order(far, source: "007ac1").first == "f63b1e", "but not when the logo clearly reads as another color")
        let navy = TeamColors.Entry(colors: ["e92139", "031c42"], weights: [1, 0.77])
        check(TeamColors.order(navy, source: "002a5c").first == "e92139", "a navy source color never tips it")

        // Competitors wear the logo's colors; unknown logos keep the source's.
        let competitor = comp("a", "A", color: "1d428a")
        check(TeamColors.shared.apply(competitor).color == "1d428a", "no logo read yet: the source's color stands")

        // Fitting: dark colors lift on a dark panel, keeping their hue.
        for hex in ["041e42", "8b0000", "006341", "4b0082"] {
            let before = lab(hex)!
            let after = TeamTone.adjust(OKLab(hex: hex)!.nsColor, scheme: .dark).flatMap(OKLab.init)!
            var hues = abs(after.hue - before.hue)
            if hues > 180 { hues = 360 - hues }
            check(after.l >= 0.59 && hues < 6 && after.chroma >= before.chroma * 0.9,
                  "dark #\(hex) lifts on a dark panel without losing its hue or color",
                  "L \(before.l)→\(after.l), hue Δ\(hues), C \(before.chroma)→\(after.chroma)")
        }
        check(TeamTone.adjust(NSColor.black, scheme: .dark) == nil, "black on a dark panel shows as gray")
        check(TeamTone.adjust(NSColor.white, scheme: .light) == nil, "white on a light panel shows as gray")
        let pale = TeamTone.adjust(OKLab(hex: "99c5ea")!.nsColor, scheme: .light).flatMap(OKLab.init)!
        check(pale.l <= 0.71, "pale sky blue deepens on a light panel")
        let yellow = TeamTone.adjust(OKLab(hex: "fdb927")!.nsColor, scheme: .light).flatMap(OKLab.init)!
        check(yellow.l > 0.75, "yellow stays yellow on a light panel instead of turning olive")

        // Two navy teams are no longer the same gray-blue as a royal blue one.
        let navyTeam = TeamTone.adjust(OKLab(hex: "0c2340")!.nsColor, scheme: .dark).flatMap(OKLab.init)!
        let royal = TeamTone.adjust(OKLab(hex: "0050b5")!.nsColor, scheme: .dark).flatMap(OKLab.init)!
        check(navyTeam.distance(to: royal) > 0.05, "navy and royal blue stay apart on a dark panel")
    }
}
