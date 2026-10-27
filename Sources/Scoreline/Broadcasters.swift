import Foundation

/// An official broadcaster for a game, as ESPN reports it (US market), linked to
/// the service's own watch page when it's one we recognize.
struct Broadcaster: Identifiable, Hashable {
    enum Kind { case tv, streaming, subscription, radio }
    let name: String
    let kind: Kind
    let url: URL?
    var id: String { name }

    init(name: String, type: String?) {
        self.name = Self.displayNames[name] ?? name
        let t = (type ?? "").lowercased()
        kind = t.contains("radio") ? .radio
            : t.contains("stream") ? .streaming
            : t.contains("subscription") ? .subscription
            : .tv
        url = Self.watchPages[name].flatMap(URL.init(string:))
    }

    /// ESPN's abbreviations, spelled out.
    private static let displayNames: [String: String] = [
        "USA Net": "USA Network", "NFL Net": "NFL Network", "MLB Net": "MLB Network", "NBA TV": "NBA TV",
        "CBSSN": "CBS Sports Network", "FS1": "FS1", "FS2": "FS2", "ESPN+": "ESPN+", "Fox": "FOX",
        "Tele": "Telemundo", "ERADM": "ESPN Radio", "ESPN Radio": "ESPN Radio", "SiriusXM": "SiriusXM",
    ]

    /// Official watch pages. Unknown broadcasters are listed without a link.
    private static let watchPages: [String: String] = [
        "Peacock": "https://www.peacocktv.com/sports",
        "NBC": "https://www.nbcsports.com/watch", "NBCSN": "https://www.nbcsports.com/watch",
        "USA Net": "https://www.usanetwork.com/live", "USA Network": "https://www.usanetwork.com/live",
        "Telemundo": "https://www.telemundo.com/deportes", "Tele": "https://www.telemundo.com/deportes", "Universo": "https://www.telemundo.com/deportes",
        "Paramount+": "https://www.paramountplus.com/live-tv/",
        "CBS": "https://www.cbssports.com/watch/", "CBSSN": "https://www.cbssports.com/watch/",
        "Fox": "https://www.foxsports.com/live", "FOX": "https://www.foxsports.com/live",
        "FS1": "https://www.foxsports.com/live", "FS2": "https://www.foxsports.com/live",
        "Fox Deportes": "https://www.foxsports.com/live",
        "ESPN": "https://www.espn.com/watch/", "ESPN2": "https://www.espn.com/watch/", "ESPNU": "https://www.espn.com/watch/",
        "ESPN+": "https://www.espn.com/watch/", "ESPN Deportes": "https://www.espn.com/watch/", "ABC": "https://www.espn.com/watch/",
        "NFL Net": "https://www.nfl.com/network/watch/nfl-network-live", "NFL+": "https://www.nfl.com/plus/",
        "Prime Video": "https://www.amazon.com/primevideo",
        "Apple TV": "https://tv.apple.com", "Apple TV+": "https://tv.apple.com", "MLS Season Pass": "https://tv.apple.com",
        "Netflix": "https://www.netflix.com",
        "TNT": "https://www.tntdrama.com/watchtnt", "TBS": "https://www.tbs.com/watchtbs", "truTV": "https://www.trutv.com/watchtrutv",
        "Max": "https://www.max.com", "HBO Max": "https://www.max.com",
        "NBA League Pass": "https://www.nba.com/watch/league-pass-stream", "NBA TV": "https://www.nba.com/watch",
        "MLB.TV": "https://www.mlb.com/tv", "MLB Net": "https://www.mlb.com/network",
        "DAZN": "https://www.dazn.com",
        "Fubo": "https://www.fubo.tv", "fuboTV": "https://www.fubo.tv",
    ]
}
