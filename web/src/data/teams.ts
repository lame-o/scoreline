/**
 * Team identity: one ID format for ESPN teams everywhere, country flags from
 * IOC codes, and the climbing nations list. Ported from Teams.swift.
 */
import type { Sport } from "./models";

/**
 * One format for ESPN team IDs everywhere (events, picks, follows, tables).
 * College teams get their own prefix: ESPN reuses numbers across leagues, so
 * "espn-football-26" would otherwise be both the Seahawks and UCLA.
 */
export function espnTeamID(path: string, sport: Sport, team: string): string {
  return path.endsWith("college-football") ? `espn-ncaaf-${team}` : `espn-${sport}-${team}`;
}

/** IOC codes that differ from ISO 3166-1 alpha-2 (plus the common climbing nations). */
const IOC_TO_ISO: Readonly<Record<string, string>> = {
  AUS: "AU", AUT: "AT", BEL: "BE", BRA: "BR", BUL: "BG", CAN: "CA", CHI: "CL", CHN: "CN",
  COL: "CO", CRO: "HR", CZE: "CZ", DEN: "DK", ECU: "EC", ESP: "ES", EST: "EE", FIN: "FI",
  FRA: "FR", GBR: "GB", GER: "DE", GRE: "GR", HKG: "HK", HUN: "HU", INA: "ID", IND: "IN",
  IRI: "IR", IRL: "IE", ISR: "IL", ITA: "IT", JPN: "JP", KAZ: "KZ", KOR: "KR", LAT: "LV",
  LTU: "LT", MAS: "MY", MEX: "MX", NED: "NL", NOR: "NO", NZL: "NZ", PHI: "PH", POL: "PL",
  POR: "PT", PUR: "PR", ROU: "RO", RSA: "ZA", SGP: "SG", SLO: "SI", SRB: "RS", SUI: "CH",
  SVK: "SK", SWE: "SE", THA: "TH", TPE: "TW", TUR: "TR", UKR: "UA", USA: "US", UZB: "UZ",
  VEN: "VE", ARG: "AR", PER: "PE", MGL: "MN", LUX: "LU", ISL: "IS", SVN: "SI",
};

/** ISO 3166-1 alpha-2 for an IOC code ("SLO" → "SI"). */
export function isoFromIOC(ioc: string | null | undefined): string | null {
  if (!ioc) return null;
  const code = ioc.toUpperCase();
  return IOC_TO_ISO[code] ?? (code.length === 2 ? code : null);
}

/** Flag emoji from an ISO alpha-2 code. */
export function flagFromISO(iso2: string | null | undefined): string | null {
  const code = iso2?.toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  return String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0)));
}

/** Flag emoji from an IOC code (IFSC uses them). */
export function flagFromIOC(ioc: string | null | undefined): string | null {
  return flagFromISO(isoFromIOC(ioc));
}

/** IOC codes, as the IFSC results service reports them, with names as a reader sorts them. */
export const CLIMBING_NATIONS: readonly { readonly code: string; readonly name: string }[] = [
  { code: "AUS", name: "Australia" }, { code: "AUT", name: "Austria" }, { code: "BEL", name: "Belgium" },
  { code: "BRA", name: "Brazil" }, { code: "CAN", name: "Canada" }, { code: "CHI", name: "Chile" },
  { code: "CHN", name: "China" }, { code: "CZE", name: "Czechia" }, { code: "ESP", name: "Spain" },
  { code: "FRA", name: "France" }, { code: "GBR", name: "Great Britain" }, { code: "GER", name: "Germany" },
  { code: "INA", name: "Indonesia" }, { code: "IRI", name: "Iran" }, { code: "ISR", name: "Israel" },
  { code: "ITA", name: "Italy" }, { code: "JPN", name: "Japan" }, { code: "KAZ", name: "Kazakhstan" },
  { code: "KOR", name: "South Korea" }, { code: "NED", name: "Netherlands" }, { code: "NOR", name: "Norway" },
  { code: "NZL", name: "New Zealand" }, { code: "POL", name: "Poland" }, { code: "RSA", name: "South Africa" },
  { code: "SLO", name: "Slovenia" }, { code: "SUI", name: "Switzerland" }, { code: "SWE", name: "Sweden" },
  { code: "UKR", name: "Ukraine" }, { code: "USA", name: "United States" },
];

/** "SLO" → "Slovenia". */
export function countryName(ioc: string): string {
  const known = CLIMBING_NATIONS.find((n) => n.code === ioc)?.name;
  if (known) return known;
  const iso = isoFromIOC(ioc);
  if (iso) {
    try {
      return new Intl.DisplayNames(undefined, { type: "region" }).of(iso) ?? ioc;
    } catch {
      return ioc;
    }
  }
  return ioc;
}

/** Two defining colors from a climbing nation's flag (never the white), for washes (Swift `FlagPalette`, common nations). */
export const FLAG_PALETTE: Readonly<Record<string, readonly [string, string]>> = {
  JPN: ["BC002D", "BC002D"], USA: ["0A3161", "B31942"], SLO: ["005DA4", "ED1C24"], FRA: ["0055A4", "EF4135"],
  ITA: ["009246", "CE2B37"], GER: ["DD0000", "FFCE00"], AUT: ["ED2939", "ED2939"], GBR: ["012169", "C8102E"],
  KOR: ["CD2E3A", "0047A0"], CHN: ["EE1C25", "FFDE00"], CZE: ["11457E", "D7141A"], BEL: ["FDDA24", "EF3340"],
  ESP: ["AA151B", "F1BF00"], CAN: ["D80621", "D80621"], AUS: ["012169", "E4002B"], SUI: ["DA291C", "DA291C"],
  NED: ["AE1C28", "21468B"], POL: ["DC143C", "DC143C"], ISR: ["0038B8", "0038B8"], INA: ["CE1126", "CE1126"],
  UKR: ["0057B7", "FFD700"], NOR: ["BA0C2F", "00205B"], SWE: ["006AA7", "FECC02"], RSA: ["007749", "FFB81C"],
  BRA: ["009C3B", "FFDF00"], CHI: ["D52B1E", "0039A6"], ARG: ["74ACDF", "F6B40E"], NZL: ["00247D", "CC142B"],
  IRI: ["239F40", "DA0000"], KAZ: ["00AFCA", "FEC50C"],
};
