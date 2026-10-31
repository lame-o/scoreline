import SwiftUI

// The theater bench's video (CHOREOGRAPHY §9.4): the same stretch of a
// recorded game told twice, side by side: today's stage on the left (its
// cuts and crossfades as the page draws them), the engine on the right (one
// world, every hand-off a splice). Each side starts a few seconds before its
// own telling of the stretch's first play, so the two line up by play, not
// by wall time. Frames are rendered offscreen and piped straight into ffmpeg
// (no frame dumps on disk).
//
//   ./test.sh --bench --theater video <out.mp4> [first play] [last play]

@MainActor
enum BenchVideo {
    static let size = CGSize(width: 540, height: 270)
    static let scale = 2.0
    static let fps = 30.0

    /// An ffmpeg encoding raw BGRA frames from its stdin.
    final class Encoder {
        let process = Process()
        let pipe = Pipe()
        let width: Int
        let height: Int
        private var buffer: [UInt8]

        init?(to url: URL, width: Int, height: Int, fps: Int) {
            self.width = width
            self.height = height
            buffer = [UInt8](repeating: 0, count: width * height * 4)
            process.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
            process.arguments = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", "\(width)x\(height)", "-r", "\(fps)",
                                 "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart",
                                 url.path]
            process.standardInput = pipe
            do { try process.run() } catch { return nil }
        }

        /// One frame, on the well's dark ground.
        func add(_ image: CGImage?) {
            let space = CGColorSpaceCreateDeviceRGB()
            buffer.withUnsafeMutableBytes { raw in
                guard let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                              space: space,
                                              bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
                else { return }
                context.setFillColor(CGColor(gray: 0.08, alpha: 1))
                context.fill(CGRect(x: 0, y: 0, width: width, height: height))
                if let image { context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height)) }
            }
            pipe.fileHandleForWriting.write(Data(buffer))
        }

        func finish() -> Bool {
            try? pipe.fileHandleForWriting.close()
            process.waitUntilExit()
            return process.terminationStatus == 0
        }
    }

    /// One labelled frame image.
    static func image<V: View>(_ view: V, label: String) -> CGImage? {
        let framed = ZStack(alignment: .topTrailing) {
            view.frame(width: size.width, height: size.height)
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.75))
                .padding(.top, 34)
                .padding(.trailing, 10)
        }
        .frame(width: size.width, height: size.height)
        .background(Color(white: 0.11))
        .environment(\.colorScheme, .dark)
        let renderer = ImageRenderer(content: framed)
        renderer.scale = scale
        return renderer.cgImage
    }

    static func run(_ arguments: [String]) -> Int32 {
        guard let out = arguments.first else {
            print("video: give the output path")
            return 64
        }
        let first = arguments.count > 1 ? arguments[1] : "401909285677"
        let last = arguments.count > 2 ? arguments[2] : "401909285685"
        guard let (recording, _) = TheaterBench.recordings("basketball").first(where: { $0.0.event == "401909285" }) else {
            print("video: no recording")
            return 1
        }
        let teams = BasketballTeams(offense: Uniform(.orange), defense: Uniform(.blue))
        let ink = TheaterInk(.dark)

        let width = Int(size.width * scale), height = Int(size.height * scale)
        let leftURL = URL(fileURLWithPath: out + ".today.mp4"), rightURL = URL(fileURLWithPath: out + ".engine.mp4")
        defer {
            try? FileManager.default.removeItem(at: leftURL)
            try? FileManager.default.removeItem(at: rightURL)
        }

        // Today: its stage's frames inside its window (its telling of `first` to after `last`'s), streamed to its half.
        guard let left = Encoder(to: leftURL, width: width, height: height, fps: Int(fps)) else { return 1 }
        var todayFrames = 0
        var todayWindow: ClosedRange<Double>?
        _ = Today.basketball(recording, label: "today", render: { t, stage, fade in
            if todayWindow == nil, let start = stage.decisive.first(where: { $0.id == first })?.at { todayWindow = (start - 4)...(start + 4) }
            if let lastAt = stage.decisive.first(where: { $0.id == last })?.at, let w = todayWindow, w.upperBound < lastAt + 5 {
                todayWindow = w.lowerBound...(lastAt + 5)
            }
            guard let w = todayWindow, w.contains(t), Int(((t - w.lowerBound) * 60).rounded()) % 2 == 0 else { return }
            left.add(image(Today.frame(stage, at: t, fade: fade, teams: teams, ink: ink, size: size), label: "today"))
            todayFrames += 1
        })
        guard left.finish() else { return 1 }

        // The engine: its frames inside its window (its decisive frame of `first`, to after `last`'s), streamed to its half.
        guard let right = Encoder(to: rightURL, width: width, height: height, fps: Int(fps)) else { return 1 }
        var engineFrames = 0
        var window: ClosedRange<Double>?
        var anchors: [String: Double] = [:]
        _ = EngineRun.basketball(recording, label: "video") { T, chain, scratch in
            if let baked = chain.plans.last {
                for p in baked.plan.placements { if let id = p.play, let d = p.clip.decisive { anchors[id] = p.offset + d } }
            }
            if window == nil, let start = anchors[first] { window = (start - 4)...(start + 4) }
            if let lastAt = anchors[last], let w = window, w.upperBound < lastAt + 5 { window = w.lowerBound...(lastAt + 5) }
            guard let w = window, w.contains(T), Int(((T - w.lowerBound) * 60).rounded()) % 2 == 0,
                  let drawn = HoopsPainter.frame(chain, scratch, size: size) else { return }
            right.add(image(BasketballFrame(scene: drawn.clip.scene, script: drawn.clip.script, t: drawn.t, teams: teams, ink: ink, size: size,
                                            world: drawn.world), label: "the engine"))
            engineFrames += 1
        }
        guard right.finish() else { return 1 }
        print(String(format: "video: today %d frames, the engine %d frames at %.0f fps", todayFrames, engineFrames, fps))

        // Side by side: today on the left, the engine on the right (the shorter holds its last frame).
        let stack = Process()
        stack.executableURL = URL(fileURLWithPath: "/opt/homebrew/bin/ffmpeg")
        stack.arguments = ["-y", "-loglevel", "error", "-i", leftURL.path, "-i", rightURL.path, "-filter_complex",
                           "[0:v]tpad=stop_mode=clone:stop=-1[a];[1:v]tpad=stop_mode=clone:stop=-1[b];[a][b]hstack=inputs=2:shortest=0,trim=duration="
                               + String(format: "%.2f", Double(max(todayFrames, engineFrames)) / fps),
                           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out]
        do { try stack.run() } catch { return 1 }
        stack.waitUntilExit()
        return stack.terminationStatus
    }

}
