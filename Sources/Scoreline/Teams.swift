import Foundation
import SwiftUI

/// A team (or, for climbing, a country) the user can filter a league down to.
/// `id` uses the same format as `Competitor.id`, so filters match events directly.
struct TeamOption: Identifiable, Hashable {
    let id: String
    let name: String
    let logo: URL?
    /// Country flag, for climbing nations.
    var flag: String? = nil
    /// The natural group it's listed under (a college conference), if any.
    var group: String? = nil

    /// ESPN's light-on-dark crest, as the scores list draws it in Dark Mode.
    var darkLogo: URL? {
        guard let logo, logo.path.contains("/500/") else { return nil }
        return URL(string: logo.absoluteString.replacingOccurrences(of: "/500/", with: "/500-dark/"))
    }
}

/// One format for ESPN team IDs everywhere (events, picks, follows, tables).
/// College teams get their own prefix: ESPN reuses numbers across leagues, so
/// "espn-football-26" would otherwise be both the Seahawks and UCLA.
enum ESPNTeamID {
    static func make(path: String, sport: Sport, team: String) -> String {
        path.hasSuffix("college-football") ? "espn-ncaaf-\(team)" : "espn-\(sport.rawValue)-\(team)"
    }
}

enum TeamCatalog {
    static func options(for league: League) async throws -> [TeamOption] {
        switch league.source {
        case let .espn(path, _):
            // College: the FBS teams the scoreboard covers, from the conference
            // standings (the teams list mixes in 600 teams from every division),
            // by conference (a division's teams under their conference).
            if path.hasSuffix("college-football") {
                return CollegeConferences.byConference(try await Standings.college(path: path)
                    .map { TeamOption(id: $0.id, name: $0.name, logo: $0.logo, group: $0.parentGroup ?? $0.group) })
            }
            let json = try await JSON.fetch(URL.api("https://site.api.espn.com/apis/site/v2/sports/\(path)/teams?limit=1000"))
            return json["sports"][0]["leagues"][0]["teams"].array.compactMap { entry in
                let team = entry["team"]
                guard let id = team["id"].string, let name = team["displayName"].string else { return nil }
                return TeamOption(id: ESPNTeamID.make(path: path, sport: league.sport, team: id), name: name,
                                  logo: team["logos"][0]["href"].string.flatMap(URL.init(string:)))
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

        case .counterStrike:
            // The world ranking keeps the list relevant (bo3.gg tracks thousands of teams).
            var c = URLComponents(string: "https://api.bo3.gg/api/v1/teams")!
            c.queryItems = [.init(name: "filter[teams.discipline_id][eq]", value: "1"),
                            .init(name: "sort", value: "rank"), .init(name: "page[limit]", value: "60")]
            let json = try await JSON.fetch(c.url!)
            return json["results"].array.compactMap { t in
                guard let id = t["id"].int, let name = t["name"].string else { return nil }
                return TeamOption(id: "cs-\(id)", name: name, logo: t["image_url"].string.flatMap(URL.init(string:)))
            }

        case .ifsc:
            // By name as the user reads it (by code, Czechia came before Spain before France).
            return climbingNations
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                .map { TeamOption(id: "country-\($0.code)", name: $0.name, logo: nil, flag: Flag.emoji(ioc: $0.code)) }
        }
    }

    /// "SLO" → "Slovenia".
    static func countryName(_ ioc: String) -> String {
        climbingNations.first { $0.code == ioc }?.name
            ?? Flag.iso(ioc: ioc).flatMap { Locale.current.localizedString(forRegionCode: $0) }
            ?? ioc
    }

    /// IOC codes, as the IFSC results service reports them.
    static let climbingNations: [(code: String, name: String)] = [
        ("AUS", "Australia"), ("AUT", "Austria"), ("BEL", "Belgium"), ("BRA", "Brazil"), ("CAN", "Canada"),
        ("CHI", "Chile"), ("CHN", "China"), ("CZE", "Czechia"), ("ESP", "Spain"), ("FRA", "France"),
        ("GBR", "Great Britain"), ("GER", "Germany"), ("INA", "Indonesia"), ("IRI", "Iran"), ("ISR", "Israel"),
        ("ITA", "Italy"), ("JPN", "Japan"), ("KAZ", "Kazakhstan"), ("KOR", "South Korea"), ("NED", "Netherlands"),
        ("NOR", "Norway"), ("NZL", "New Zealand"), ("POL", "Poland"), ("RSA", "South Africa"), ("SLO", "Slovenia"),
        ("SUI", "Switzerland"), ("SWE", "Sweden"), ("UKR", "Ukraine"), ("USA", "United States"),
    ]
}

/// Country flag emoji from ISO or IOC (Olympic, used by IFSC) codes.
enum Flag {
    static func emoji(iso2: String?) -> String? {
        guard let code = iso2?.uppercased(), code.count == 2,
              code.unicodeScalars.allSatisfy({ ("A"..."Z").contains(Character($0)) }) else { return nil }
        let scalars = code.unicodeScalars.compactMap { UnicodeScalar(127397 + $0.value) }
        return String(String.UnicodeScalarView(scalars))
    }

    static func emoji(ioc: String?) -> String? {
        emoji(iso2: iso(ioc: ioc))
    }

    /// ISO 3166-1 alpha-2 for an IOC code ("SLO" → "SI").
    static func iso(ioc: String?) -> String? {
        guard let ioc = ioc?.uppercased() else { return nil }
        return iocToISO[ioc] ?? (ioc.count == 2 ? ioc : nil)
    }

    /// IOC codes that differ from ISO 3166-1 alpha-2 (plus the common climbing nations).
    private static let iocToISO: [String: String] = [
        "AUS": "AU", "AUT": "AT", "BEL": "BE", "BRA": "BR", "BUL": "BG", "CAN": "CA", "CHI": "CL", "CHN": "CN",
        "COL": "CO", "CRO": "HR", "CZE": "CZ", "DEN": "DK", "ECU": "EC", "ESP": "ES", "EST": "EE", "FIN": "FI",
        "FRA": "FR", "GBR": "GB", "GER": "DE", "GRE": "GR", "HKG": "HK", "HUN": "HU", "INA": "ID", "IND": "IN",
        "IRI": "IR", "IRL": "IE", "ISR": "IL", "ITA": "IT", "JPN": "JP", "KAZ": "KZ", "KOR": "KR", "LAT": "LV",
        "LTU": "LT", "MAS": "MY", "MEX": "MX", "NED": "NL", "NOR": "NO", "NZL": "NZ", "PHI": "PH", "POL": "PL",
        "POR": "PT", "PUR": "PR", "ROU": "RO", "RSA": "ZA", "SGP": "SG", "SLO": "SI", "SRB": "RS", "SUI": "CH",
        "SVK": "SK", "SWE": "SE", "THA": "TH", "TPE": "TW", "TUR": "TR", "UKR": "UA", "USA": "US", "UZB": "UZ",
        "VEN": "VE", "ARG": "AR", "PER": "PE", "MGL": "MN", "LUX": "LU", "ISL": "IS", "SVN": "SI",
    ]
}

/// "1st", "2nd", "3rd", "11th".
enum Ordinal {
    static func string(_ n: Int) -> String {
        let suffix = (11...13).contains(n % 100) ? "th" : [1: "st", 2: "nd", 3: "rd"][n % 10] ?? "th"
        return "\(n)\(suffix)"
    }
}

/// Two defining colors from each climbing nation's flag (never the white), for
/// the climbing page's header wash. Single-color flags repeat their color.
enum FlagPalette {
    static func colors(ioc: String?) -> (Color, Color)? {
        guard let ioc = ioc?.uppercased(), let pair = table[ioc] else { return nil }
        guard let a = Color(hex: pair.0), let b = Color(hex: pair.1) else { return nil }
        return (a, b)
    }

    private static let table: [String: (String, String)] = [
        "JPN": ("BC002D", "BC002D"), "USA": ("0A3161", "B31942"), "SLO": ("005DA4", "ED1C24"),
        "FRA": ("0055A4", "EF4135"), "ITA": ("009246", "CE2B37"), "GER": ("DD0000", "FFCE00"),
        "AUT": ("ED2939", "ED2939"), "GBR": ("012169", "C8102E"), "KOR": ("CD2E3A", "0047A0"),
        "CHN": ("EE1C25", "FFDE00"), "CZE": ("11457E", "D7141A"), "BEL": ("FDDA24", "EF3340"),
        "ESP": ("AA151B", "F1BF00"), "CAN": ("D80621", "D80621"), "AUS": ("012169", "E4002B"),
        "SUI": ("DA291C", "DA291C"), "NED": ("AE1C28", "21468B"), "POL": ("DC143C", "DC143C"),
        "ISR": ("0038B8", "0038B8"), "INA": ("CE1126", "CE1126"), "UKR": ("0057B7", "FFD700"),
        "NOR": ("BA0C2F", "00205B"), "SWE": ("006AA7", "FECC02"), "RSA": ("007749", "FFB81C"),
        "BRA": ("009C3B", "FFDF00"), "CHI": ("D52B1E", "0039A6"), "ARG": ("74ACDF", "F6B40E"),
        "NZL": ("00247D", "CC142B"), "IRI": ("239F40", "DA0000"), "KAZ": ("00AFCA", "FEC50C"),
        "HKG": ("DE2910", "DE2910"), "TPE": ("FE0000", "000095"), "IND": ("FF9933", "138808"),
        "MEX": ("006847", "CE1126"), "SRB": ("C6363C", "0C4076"), "CRO": ("FF0000", "171796"),
        "SVK": ("0B4EA2", "EE1C25"), "HUN": ("CE2939", "477050"), "FIN": ("002F6C", "002F6C"),
        "DEN": ("C8102E", "C8102E"), "IRL": ("169B62", "FF883E"), "POR": ("006600", "FF0000"),
        "ECU": ("FFD100", "034EA2"), "COL": ("FCD116", "003893"), "THA": ("A51931", "2D2A4A"),
        "SGP": ("EF3340", "EF3340"), "BUL": ("00966E", "D62612"), "ROU": ("002B7F", "FCD116"),
        "GRE": ("0D5EAF", "0D5EAF"), "TUR": ("E30A17", "E30A17"), "LAT": ("9E3039", "9E3039"),
        "LTU": ("FDB913", "006A44"), "EST": ("0072CE", "0072CE"), "PHI": ("0038A8", "CE1126"),
        "MAS": ("010066", "CC0001"), "VEN": ("FFCC00", "00247D"), "PER": ("D91023", "D91023"),
        "LUX": ("EF3340", "00A3E0"), "SLV": ("0047AB", "0047AB"), "GUA": ("4997D0", "4997D0"),
        "CRC": ("002B7F", "CE1126"), "MAR": ("C1272D", "006233"), "EGY": ("CE1126", "C09300"),
        "ALG": ("006233", "D21034"), "TUN": ("E70013", "E70013"), "QAT": ("8A1538", "8A1538"),
        "UAE": ("00732F", "FF0000"), "KSA": ("006C35", "006C35"),
        "AIN": ("0072CE", "0072CE"), "MGL": ("C4272F", "015197"), "VIE": ("DA251D", "FFFF00"),
        "PUR": ("ED0000", "0050F0"), "URU": ("0038A8", "FCD116"), "ISL": ("02529C", "DC1E35"),
        "CYP": ("D57800", "4E5B31"), "MNE": ("C40308", "D3AE3B"), "BIH": ("002395", "FECB00"),
        "MKD": ("D20000", "FFE600"), "GEO": ("FF0000", "FF0000"), "ARM": ("D90012", "0033A0"),
        "AZE": ("00B5E2", "EF3340"), "BLR": ("C8313E", "4AA657"), "MDA": ("0046AE", "FFD200"),
        "ESA": ("0047AB", "0047AB"),
    ]
}
