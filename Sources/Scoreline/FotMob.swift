import Foundation

/// Soccer photos, injuries and the current coach from FotMob, matched onto
/// ESPN's squads. ESPN has photos for about 1 in 20 soccer players, lists no
/// soccer injuries, and its "coach" field is a list of past managers; FotMob
/// has all three.
///
/// FotMob is an unofficial source (a keyless web API, like ESPN's), so this
/// is enrichment only: it runs after the page has its ESPN data, never blocks
/// it, is cached (the team ID for 30 days, the squad for 12 hours), and any
/// failure (a changed payload, a 404, no confident match) leaves ESPN's data
/// and the monogram exactly as they were. A player is matched only when the
/// match is unambiguous (§ `match`).
enum FotMob {
    static let base = "https://www.fotmob.com/api/data"

    /// FotMob's league IDs for the domestic leagues ESPN files teams under.
    static let leagueIDs: [String: Int] = ["eng.1": 47, "esp.1": 87, "ger.1": 54, "ita.1": 55, "fra.1": 53, "eng.2": 48, "usa.1": 130]

    /// Team search: 0.5 KB, gives the team ID with its league.
    static func searchURL(_ team: String) -> URL? {
        var c = URLComponents(string: "\(base)/search/suggest")!
        c.queryItems = [.init(name: "term", value: team), .init(name: "lang", value: "en")]
        return c.url
    }

    /// The team page (≈90 KB gzipped; the squad is a small part of it).
    static func teamURL(_ id: Int) -> URL? { URL(string: "\(base)/teams?id=\(id)") }

    /// A transparent 192×192 face crop.
    static func photoURL(_ playerID: Int) -> URL? {
        URL(string: "https://images.fotmob.com/image_resources/playerimages/\(playerID).png")
    }

    // MARK: Parsing

    /// The team among the search suggestions: same league first, then the exact name.
    static func teamID(_ data: Data, name: String, league: String?) -> Int? {
        let teams = JSON(data: data).array.flatMap { $0["suggestions"].array }.filter { $0["type"].string == "team" }
        let wanted = league.flatMap { leagueIDs[$0] }
        let key = tokens(name).joined(separator: " ")
        if let wanted, let t = teams.first(where: { $0["leagueId"].int == wanted }) { return t["id"].int }
        return teams.first { tokens($0["name"].string ?? "").joined(separator: " ") == key }?["id"].int
    }

    struct Member: Equatable, Sendable {
        let id: Int
        let name: String
        let shirt: Int?
        /// "Late November 2026", "Doubtful"; nil when fit.
        let injury: String?
    }

    struct Squad: Equatable, Sendable {
        var members: [Member]
        var coach: String?
    }

    static func squad(_ data: Data) -> Squad? {
        let groups = JSON(data: data)["squad"]["squad"].array
        guard !groups.isEmpty else { return nil }
        var squad = Squad(members: [], coach: nil)
        for group in groups {
            let coach = group["title"].string == "coach"
            for m in group["members"].array {
                guard let id = m["id"].int, let name = m["name"].string else { continue }
                if coach {
                    if squad.coach == nil { squad.coach = name }
                    continue
                }
                let injured = m["injury"].exists
                squad.members.append(Member(id: id, name: name, shirt: m["shirtNumber"].int,
                                            injury: injured ? (m["injury"]["expectedReturn"].string ?? "Injured") : nil))
            }
        }
        return squad
    }

    // MARK: Matching

    /// Lowercased tokens with accents and punctuation removed, so "Martin
    /// Ødegaard" and "Martin Odegaard", or "O’Neill" and "O'Neill", compare equal.
    static func tokens(_ name: String) -> [String] {
        let special: [Character: String] = ["ø": "o", "Ø": "o", "æ": "ae", "Æ": "ae", "ß": "ss", "đ": "d", "Đ": "d",
                                            "ł": "l", "Ł": "l", "ı": "i", "œ": "oe", "Œ": "oe", "þ": "th"]
        let mapped = name.map { special[$0] ?? String($0) }.joined()
        let folded = mapped.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .lowercased()
        return folded.split { $0 == " " || $0 == "-" }
            .map { $0.filter { $0.isLetter || $0.isNumber } }
            .filter { !$0.isEmpty }
    }

    /// The squad member who is this ESPN player, or nil unless the match is
    /// unambiguous:
    /// - the same name (accents and punctuation aside), or the same names in another order;
    /// - the same shirt number and a shared name ("Gabriel" #6 is "Gabriel Magalhães" #6);
    /// - the same surname with a compatible first initial, when only one member qualifies.
    /// Two members tied at the best score below a shirt-number match means no match.
    static func match(name: String, jersey: String?, in members: [Member]) -> Member? {
        let target = tokens(name)
        guard !target.isEmpty else { return nil }
        let shirt = jersey.flatMap { Int($0) }
        var scored: [(Member, Int)] = []
        for m in members {
            let t = tokens(m.name)
            guard !t.isEmpty else { continue }
            let score: Int
            if t == target {
                score = 100
            } else if Set(t) == Set(target) {
                score = 95
            } else if let shirt, m.shirt == shirt, !Set(t).isDisjoint(with: target) {
                score = 90
            } else if t.last == target.last, t.count > 1, target.count > 1, t.first?.first == target.first?.first {
                score = 70
            } else if t.count == 1 || target.count == 1, !Set(t).isDisjoint(with: target), shirt == nil || m.shirt == nil {
                // A one-word name ("Gabriel") without shirt numbers to confirm it: weak.
                score = 60
            } else {
                continue
            }
            scored.append((m, score))
        }
        guard let best = scored.max(by: { $0.1 < $1.1 }), best.1 >= 70 else { return nil }
        if best.1 < 90, scored.filter({ $0.1 == best.1 }).count > 1 { return nil }
        return best.0
    }

    /// FotMob's injury, as the pages show one: "Doubtful", or "Out" with the expected return.
    static func injury(_ m: Member) -> (status: String, detail: String?)? {
        guard let text = m.injury else { return nil }
        if text.localizedCaseInsensitiveContains("doubtful") { return ("Doubtful", nil) }
        // "Late November 2026" → "Expected back late November".
        let words = text.split(separator: " ").filter { Int($0) == nil }
        let back = words.isEmpty ? nil : "Expected back " + words.joined(separator: " ").lowercased()
            .replacingOccurrences(of: "january", with: "January").replacingOccurrences(of: "february", with: "February")
            .replacingOccurrences(of: "march", with: "March").replacingOccurrences(of: "april", with: "April")
            .replacingOccurrences(of: "may", with: "May").replacingOccurrences(of: "june", with: "June")
            .replacingOccurrences(of: "july", with: "July").replacingOccurrences(of: "august", with: "August")
            .replacingOccurrences(of: "september", with: "September").replacingOccurrences(of: "october", with: "October")
            .replacingOccurrences(of: "november", with: "November").replacingOccurrences(of: "december", with: "December")
        return ("Out", text == "Injured" ? nil : back)
    }
}
