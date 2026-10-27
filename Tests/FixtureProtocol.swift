import CryptoKit
import Foundation

/// Serves recorded HTTP responses so the suite runs offline and deterministically.
/// With SCORELINE_RECORD=1 it fetches live and saves each response instead.
final class FixtureProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var directory = URL(fileURLWithPath: "Tests/Fixtures")
    static var recording: Bool { ProcessInfo.processInfo.environment["SCORELINE_RECORD"] == "1" }
    private static let live = URLSession(configuration: .ephemeral)

    /// Query parameters that vary by day are ignored, so recordings replay later.
    static func key(for url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "invalid" }
        let items = components.queryItems?.filter { $0.name != "dates" }.sorted { $0.name < $1.name }
        components.queryItems = items
        let normalized = (components.host ?? "") + components.path + "?" + (components.query ?? "")
        return String(SHA256.hash(data: Data(normalized.utf8)).map { String(format: "%02x", $0) }.joined().prefix(24))
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let file = Self.directory.appendingPathComponent(Self.key(for: url) + ".bin")
        if Self.recording {
            let task = Self.live.dataTask(with: request) { data, response, error in
                if let data, let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    try? data.write(to: file)
                    let index = Self.directory.appendingPathComponent("index.txt")
                    let line = "\(Self.key(for: url))  \(url.absoluteString)\n"
                    if let handle = try? FileHandle(forWritingTo: index) {
                        handle.seekToEndOfFile(); handle.write(Data(line.utf8)); try? handle.close()
                    } else {
                        try? line.write(to: index, atomically: true, encoding: .utf8)
                    }
                }
                self.finish(data: data, response: response, error: error)
            }
            task.resume()
        } else if let data = try? Data(contentsOf: file) {
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)
            finish(data: data, response: response, error: nil)
        } else {
            finish(data: nil, response: HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil), error: nil)
        }
    }

    override func stopLoading() {}

    private func finish(data: Data?, response: URLResponse?, error: Error?) {
        if let error { client?.urlProtocol(self, didFailWithError: error); return }
        if let response { client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed) }
        if let data { client?.urlProtocol(self, didLoad: data) }
        client?.urlProtocolDidFinishLoading(self)
    }
}
