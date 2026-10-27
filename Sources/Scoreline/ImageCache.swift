import AppKit
import ImageIO
import SwiftUI

/// Small, downsampled logo cache. Logos are decoded at the size they're drawn
/// (Retina), so a dozen teams cost kilobytes, not the megabytes their 500px
/// originals would.
actor ImageCache {
    static let shared = ImageCache()

    /// NSCache is thread-safe, so views can read it synchronously: a logo
    /// that's already decoded draws on the first frame, with no placeholder.
    nonisolated(unsafe) private let memory: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>()
        cache.countLimit = 300
        return cache
    }()
    private var inFlight: [String: Task<Fetch, Never>] = [:]
    /// URLs the server answered but that aren't images (e.g. a dark logo variant
    /// that doesn't exist). Network failures aren't recorded, so they retry.
    private var missing: Set<URL> = []
    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 2 << 20, diskCapacity: 40 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 15
        return URLSession(configuration: config)
    }()

    private enum Fetch { case image(NSImage), missing, failed }

    private static func key(_ url: URL, _ pixels: Int) -> NSString { "\(pixels)|\(url.absoluteString)" as NSString }

    nonisolated func cached(_ url: URL?, pixels: Int) -> NSImage? {
        url.flatMap { memory.object(forKey: Self.key($0, pixels)) }
    }

    /// `remember: false` decodes without keeping the result in memory (logo
    /// color sampling reads each logo once, at 64px; keeping those would
    /// evict the logos on screen).
    func image(for url: URL, pixels: Int, remember: Bool = true) async -> NSImage? {
        let key = Self.key(url, pixels)
        if let cached = memory.object(forKey: key) { return cached }
        if missing.contains(url) { return nil }

        let task = inFlight[key as String] ?? Task<Fetch, Never> { [session] in
            guard let (data, _) = try? await session.data(from: url) else { return .failed }
            guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                  let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                      kCGImageSourceCreateThumbnailFromImageAlways: true,
                      kCGImageSourceCreateThumbnailWithTransform: true,
                      kCGImageSourceThumbnailMaxPixelSize: pixels,
                  ] as CFDictionary)
            else { return .missing }
            return .image(NSImage(cgImage: cg, size: NSSize(width: cg.width / 2, height: cg.height / 2)))
        }
        inFlight[key as String] = task
        let result = await task.value
        inFlight[key as String] = nil

        switch result {
        case let .image(image):
            if remember { memory.setObject(image, forKey: key) }
            return image
        case .missing:
            missing.insert(url)
            return nil
        case .failed:
            return nil
        }
    }
}

struct LogoView: View {
    let url: URL?
    /// Light-on-dark variant, preferred in Dark Mode when it exists.
    var darkURL: URL? = nil
    var size: CGFloat = 16
    @Environment(\.colorScheme) private var colorScheme
    /// Set only when a logo arrives from the network; cached logos draw directly.
    @State private var loaded: NSImage?

    /// Small logos share one decoded size (32px), so the collapsed preview's
    /// 14pt crests and the rows' 16pt ones are the same cached image: expanding
    /// never shows a placeholder mid-travel.
    private var pixels: Int { Int((max(size, 16) * 2).rounded(.up)) }

    private var cached: NSImage? {
        let cache = ImageCache.shared
        return (colorScheme == .dark ? cache.cached(darkURL, pixels: pixels) : nil) ?? cache.cached(url, pixels: pixels)
    }

    var body: some View {
        let image = loaded ?? cached
        Group {
            if let image {
                Image(nsImage: image).resizable().interpolation(.high).scaledToFit()
            } else {
                Circle().fill(.quaternary).padding(2)
            }
        }
        .frame(width: size, height: size)
        // Only a logo arriving from the network fades in; panel opens draw instantly.
        .animation(Motion.fade, value: loaded != nil)
        .task(id: [url, colorScheme == .dark ? darkURL : nil]) {
            guard cached == nil else { return }
            let cache = ImageCache.shared
            var image: NSImage?
            if colorScheme == .dark, let darkURL { image = await cache.image(for: darkURL, pixels: pixels) }
            if image == nil, let url { image = await cache.image(for: url, pixels: pixels) }
            loaded = image
        }
        .accessibilityHidden(true)
    }
}
