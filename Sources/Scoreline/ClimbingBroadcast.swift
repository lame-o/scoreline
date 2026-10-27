import Foundation

/// World Climbing streams nearly every World Cup round on YouTube. The channel's
/// `/live` page resolves to the stream that's on now — or, between rounds, the
/// next scheduled one with its start time. That's both the live signal and the
/// schedule (the IFSC results service doesn't publish round start times).
struct ClimbingBroadcast: Equatable {
    let url: URL
    let title: String
    let isLive: Bool
    let start: Date?

    static let channelURL = URL(string: "https://www.youtube.com/@WorldClimbing/streams")!
    private static let liveURL = URL(string: "https://www.youtube.com/@WorldClimbing/live")!

    /// nil means no stream is live or scheduled; a failed request throws.
    static func fetch() async throws -> ClimbingBroadcast? {
        var request = URLRequest(url: liveURL)
        // Desktop UA + English so the page carries the full player metadata.
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
                         forHTTPHeaderField: "User-Agent")
        request.setValue("en-US", forHTTPHeaderField: "Accept-Language")
        let (data, response) = try await HTTP.session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, let html = String(data: data, encoding: .utf8) else {
            throw URLError(.badServerResponse)
        }
        return parse(html)
    }

    static func parse(_ html: String) -> ClimbingBroadcast? {
        // No live or scheduled stream: the canonical link is the channel, not a video.
        guard let canonical = first(#"<link rel="canonical" href="([^"]+)""#, in: html),
              canonical.contains("watch?v="), let url = URL(string: canonical),
              let title = first(#"<meta name="title" content="([^"]*)""#, in: html) ?? first(#"<title>([^<]*)</title>"#, in: html)
        else { return nil }
        let isLive = first(#""isLiveNow":(true|false)"#, in: html) == "true"
        let start = first(#""startTimestamp":"([^"]+)""#, in: html).flatMap(DateParser.parse)
            ?? first(#""scheduledStartTime":"(\d+)""#, in: html).flatMap(Double.init).map(Date.init(timeIntervalSince1970:))
        return ClimbingBroadcast(url: url, title: decodeEntities(title), isLive: isLive, start: start)
    }

    /// Whether this stream covers a climbing row: same city, same discipline,
    /// and (when known) same round. "Lead semi-finals | Santiago 2026" covers
    /// both Lead Men and Lead Women semi-finals.
    func covers(category: String, round: String?, eventName: String) -> Bool {
        let t = title.lowercased()
        guard let city = eventName.lowercased().split(separator: " ").first, t.contains(city) else { return false }
        if let discipline = category.lowercased().split(separator: " ").first, !t.contains(discipline) {
            // Combined events stream as "Boulder & Lead".
            guard category.lowercased().contains("&") || category.lowercased().contains("combined") else { return false }
        }
        guard let round = round?.lowercased() else { return true }
        if round.contains("semi") { return t.contains("semi") }
        if round.contains("final") { return t.contains("final") && !t.contains("semi") }
        if round.contains("qualif") { return t.contains("qualif") }
        return true
    }

    private static func first(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1, let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }

    private static func decodeEntities(_ s: String) -> String {
        s.replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&quot;", with: "\"").replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
    }
}

/// "in 25 min", "in 3h 20m" — for things starting soon.
enum Countdown {
    static func text(to date: Date, from now: Date = .now) -> String? {
        let seconds = date.timeIntervalSince(now)
        guard seconds > -60 else { return nil }
        if seconds < 60 { return "Starting" }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "in \(minutes) min" }
        if minutes < 24 * 60 { return "in \(minutes / 60)h \(minutes % 60)m" }
        return nil
    }

    /// Ticking clock for the detail page: "2:14:33" / "14:33".
    static func clock(to date: Date, from now: Date = .now) -> String? {
        let seconds = Int(date.timeIntervalSince(now))
        guard seconds > 0, seconds < 24 * 3600 else { return nil }
        let h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

/// The one way the app says when something happens, matching macOS:
/// "Today 7:00 AM", "Yesterday 7:00 AM", "Tomorrow 7:00 AM", "Monday 7:00 AM",
/// "Nov 7, 7:00 AM".
enum When {
    static func dayAndTime(_ date: Date, now: Date = .now) -> String {
        let time = date.formatted(date: .omitted, time: .shortened)
        guard let day = day(date, now: now) else { return "Today \(time)" }
        // A day said in words reads straight into the time; a date takes a comma.
        return relative(date, now: now) ? "\(day) \(time)" : "\(day), \(time)"
    }

    /// "Yesterday", "Tomorrow", "Monday", "Nov 7" — nil for today.
    static func day(_ date: Date, now: Date = .now) -> String? {
        let cal = Calendar.current
        if cal.isDate(date, inSameDayAs: now) { return nil }
        if let tomorrow = cal.date(byAdding: .day, value: 1, to: now), cal.isDate(date, inSameDayAs: tomorrow) { return "Tomorrow" }
        if let yesterday = cal.date(byAdding: .day, value: -1, to: now), cal.isDate(date, inSameDayAs: yesterday) { return "Yesterday" }
        if date > now && date.timeIntervalSince(now) < 6 * 86400 { return date.formatted(.dateTime.weekday(.wide)) }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    /// The day is said in words (yesterday, tomorrow, a weekday this week), not as a date.
    private static func relative(_ date: Date, now: Date) -> Bool {
        let cal = Calendar.current
        if let yesterday = cal.date(byAdding: .day, value: -1, to: now), cal.isDate(date, inSameDayAs: yesterday) { return true }
        return date > now && date.timeIntervalSince(now) < 6 * 86400
    }
}
