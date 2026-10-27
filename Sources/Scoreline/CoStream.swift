import Foundation

/// Works out which live CS2 matches a streamer (ohnePixel by default) is
/// co-streaming. Two signals:
///  1. bo3.gg lists the channel among a match's streams (definitive, seen when
///     a match's detail page loads).
///  2. The channel is live on Twitch in Counter-Strike and its title names a
///     team or the tournament of a live match.
enum CoStream {
    struct Status {
        let live: Bool
        let title: String
        let game: String
    }

    /// Keyless Twitch status via decapi.me (plain-text endpoints).
    static func status(of channel: String) async -> Status? {
        @Sendable func get(_ endpoint: String) async -> String? {
            guard let url = URL(string: "https://decapi.me/twitch/\(endpoint)/\(channel)"),
                  let (data, response) = try? await HTTP.session.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
            return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        async let uptime = get("uptime")
        async let title = get("title")
        async let game = get("game")
        guard let up = await uptime else { return nil }
        return Status(live: !up.localizedCaseInsensitiveContains("offline"), title: await title ?? "", game: await game ?? "")
    }

    static func avatar(of channel: String) async -> URL? {
        guard let url = URL(string: "https://decapi.me/twitch/avatar/\(channel)"),
              let (data, _) = try? await HTTP.session.data(from: url),
              let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              text.hasPrefix("http") else { return nil }
        return URL(string: text)
    }

    /// IDs of the live matches the stream title points at.
    static func matches(_ status: Status, in liveMatches: [Event]) -> Set<String> {
        guard status.live, status.game.localizedCaseInsensitiveContains("counter-strike") else { return [] }
        let title = status.title.lowercased()

        // A team named in the title is the strongest signal.
        let byTeam = liveMatches.filter { event in
            event.competitors.contains { c in
                [c.name, c.abbreviation].contains { containsWord(title, $0.lowercased()) }
            }
        }
        if !byTeam.isEmpty { return Set(byTeam.map(\.id)) }

        // Otherwise a tournament keyword ("Major", "IEM", "Cologne"…).
        let byTournament = liveMatches.filter { event in
            tournamentKeywords(event).contains { containsWord(title, $0) }
        }
        if !byTournament.isEmpty { return Set(byTournament.map(\.id)) }

        // A generic watch-party title with exactly one live match is unambiguous.
        let watchWords = ["watch", "watchparty", "costream", "co-stream", "co stream"]
        if liveMatches.count == 1, watchWords.contains(where: title.contains) {
            return [liveMatches[0].id]
        }
        return []
    }

    private static let genericWords: Set<String> = ["season", "series", "stage", "group", "open", "online", "2025", "2026", "2027", "cup", "league"]

    static func tournamentKeywords(_ event: Event) -> [String] {
        guard case let .counterStrike(_, tournament?) = event.ref else { return [] }
        let words = tournament.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)
        var keywords = words.filter { $0.count >= 3 && !genericWords.contains($0) }
        if tournament.localizedCaseInsensitiveContains("major") { keywords.append("major") }
        return keywords
    }

    /// Whole-word match so "g2" doesn't fire on "g2a" and "faze" not on "fazed".
    static func containsWord(_ text: String, _ word: String) -> Bool {
        guard word.count >= 2 else { return false }
        let pattern = "(?<![a-z0-9])" + NSRegularExpression.escapedPattern(for: word) + "(?![a-z0-9])"
        return text.range(of: pattern, options: .regularExpression) != nil
    }
}
