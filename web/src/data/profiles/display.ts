/**
 * What the profile pages show and say, as pure rules (TeamSections.swift
 * `ProfileRosterColumns`, `RosterRow`; PlayerSections.swift `PlayerColumns`,
 * `AboutFacts`, `StatSpeech`; PlayerPage.swift `PlayerDock`, `height`;
 * ProfileLinks.swift `ProfileFormat`). Width classes are the Mac's: blocks add
 * columns as they widen, and a column never moves when others join.
 */
import type { Sport } from "../models";
import { isFotMobPhoto } from "./photos";
import type { Bio, PlayerProfile, RosterGroupKind, RosterPlayer, StatTile, TeamRef } from "./models";

export type WidthClass = "compact" | "medium" | "large" | "xlarge";
const WIDTH_ORDER: Readonly<Record<WidthClass, number>> = { compact: 0, medium: 1, large: 2, xlarge: 3 };

/** A block's width class from its content width in points (< 380, 380, 460, 560). */
export function widthClassOf(points: number): WidthClass {
  return points >= 560 ? "xlarge" : points >= 460 ? "large" : points >= 380 ? "medium" : "compact";
}

export const atLeast = (have: WidthClass, need: WidthClass) => WIDTH_ORDER[have] >= WIDTH_ORDER[need];

export interface StatColumn {
  readonly key: string;
  readonly label: string;
  /** Points. */
  readonly width: number;
  readonly from: WidthClass;
}

const col = (key: string, label: string, width = 30, from: WidthClass = "compact"): StatColumn => ({ key, label, width, from });

// MARK: - Roster

/** Roster columns per sport and group. */
export function rosterColumns(sport: Sport, group: RosterGroupKind): StatColumn[] {
  switch (sport) {
    case "basketball":
      return [col("PTS", "PTS"), col("REB", "REB"), col("AST", "AST"), col("MIN", "MIN", 32, "medium"), col("FG%", "FG%", 36, "large")];
    case "baseball":
      if (group === "rotation" || group === "bullpen") {
        const third = group === "bullpen" ? "SV" : "W";
        return [col("ERA", "ERA", 36), col("K", "K"), col(third, third, 28, "medium"), col("WHIP", "WHIP", 38, "large")];
      }
      return [col("AVG", "AVG", 38), col("HR", "HR", 28), col("RBI", "RBI", 30, "medium"), col("OPS", "OPS", 38, "large")];
    case "soccer":
      if (group === "goalkeepers") return [col("appearances", "APP"), col("saves", "SV", 28), col("goalsConceded", "GA", 28), col("age", "AGE", 30, "medium")];
      return [col("appearances", "APP"), col("totalGoals", "G", 24), col("goalAssists", "A", 24), col("age", "AGE", 30, "medium"), col("totalShots", "SHOTS", 38, "large")];
    case "esports":
      return group === "players" ? [col("RATING", "RATING", 44), col("age", "AGE", 30, "medium")] : [];
    default:
      return [];
  }
}

/** Football: one stat line by position instead of columns ("1,474 yds · 9 TD"). */
export function footballStatLine(p: RosterPlayer): string | null {
  const s = p.stats;
  const line = (a: string | undefined, unitA: string, b: string | undefined, unitB: string) =>
    a == null ? null : [`${a} ${unitA}`, b != null && b !== "0" ? `${b} ${unitB}` : null].filter(Boolean).join(" · ");
  switch (p.position ?? "") {
    case "QB":
      return line(s.PYDS, "yds", s.PTD, "TD");
    case "RB":
    case "FB":
      return line(s.RYDS, "yds", s.RTD, "TD");
    case "WR":
    case "TE":
      return line(s.REC, "rec", s.RECYDS, "yds");
    case "PK":
    case "K":
    case "P":
    case "LS":
    case "OT":
    case "G":
    case "C":
    case "OL":
      return null;
    default:
      return line(s.TOT, "tkl", s.SACK, "sk");
  }
}

/** A roster cell's value ("–" when there's none). */
export function rosterValue(p: RosterPlayer, key: string): string {
  if (key === "age") return p.age != null ? String(p.age) : "–";
  return p.stats[key] ?? "–";
}

/** "late November" → "late Nov". */
export function shortMonth(text: string): string {
  const months: Record<string, string> = { January: "Jan", February: "Feb", March: "Mar", April: "Apr", August: "Aug", September: "Sep", October: "Oct", November: "Nov", December: "Dec" };
  return Object.entries(months).reduce((t, [long, short]) => t.replaceAll(long, short), text);
}

/** "#77 · Guard", "#14 · QB · Sophomore", "#7 · England", with an injury leading ("Out until late Nov"). */
export function rosterSubtitle(p: RosterPlayer, sport: Sport, group: RosterGroupKind): { status: string | null; rest: string } {
  const parts: string[] = [];
  if (p.jersey) parts.push(`#${p.jersey}`);
  if (sport === "esports") {
    if (p.detail) parts.push(p.detail);
  } else if (sport === "soccer") {
    // The group already says the position.
    if (p.detail) parts.push(p.detail);
  } else {
    const pos = sport === "basketball" ? p.positionName : p.position;
    if (pos) parts.push(pos);
    if (p.detail) parts.push(p.detail);
  }
  const showInjury = p.injury != null && group !== "out" && group !== "injuredReserve";
  const status = showInjury ? `${p.injury === "Day-To-Day" ? "Day-to-day" : p.injury}${p.injuryReturn ? ` until ${shortMonth(p.injuryReturn)}` : ""}` : null;
  return { status, rest: parts.join(" · ") };
}

const ROSTER_WORDS: Readonly<Record<string, string>> = {
  PTS: "points", REB: "rebounds", AST: "assists", MIN: "minutes", "FG%": "field goal percentage", ERA: "earned run average", K: "strikeouts",
  SV: "saves", W: "wins", WHIP: "walks and hits per inning", AVG: "batting average", HR: "home runs", RBI: "runs batted in",
  OPS: "on-base plus slugging", APP: "appearances", GA: "goals against", G: "goals", A: "assists", SHOTS: "shots", RATING: "rating",
};

/** "1,474 yds · 9 TD" → "1,474 yards, 9 touchdowns". */
export function spokenStatLine(line: string): string {
  return line
    .replaceAll(" · ", ", ")
    .replaceAll(" yds", " yards")
    .replaceAll(" TD", " touchdowns")
    .replaceAll(" rec", " receptions")
    .replaceAll(" tkl", " tackles")
    .replaceAll(" sk", " sacks");
}

/** "Jalen Brunson, number 11, Point Guard, 26.3 points, 6.1 assists": column codes as words. */
export function spokenRosterRow(p: RosterPlayer, columns: readonly StatColumn[]): string {
  const parts = [p.ref.name];
  if (p.jersey) parts.push(`number ${p.jersey}`);
  const pos = p.positionName ?? p.position;
  if (pos) parts.push(pos);
  if (p.injury) parts.push(p.injury === "Day-To-Day" ? "Day-to-day" : p.injury);
  for (const c of columns) {
    if (p.stats[c.key] == null && c.key !== "age") continue;
    const v = rosterValue(p, c.key);
    const word = ROSTER_WORDS[c.label] ?? c.label.toLowerCase();
    parts.push(v === "–" ? `no ${word}` : c.key === "age" ? `age ${v}` : `${v} ${word}`);
  }
  const line = footballStatLine(p);
  if (line) parts.push(spokenStatLine(line));
  return parts.join(", ");
}

// MARK: - Game log and tables

/** The game-log table's columns, by sport and position. */
export function gameLogColumns(sport: Sport, position: string | null, pitching: boolean): StatColumn[] {
  const pos = (position ?? "").toUpperCase();
  switch (sport) {
    case "basketball":
      return [col("points", "PTS"), col("totalRebounds", "REB"), col("assists", "AST"), col("minutes", "MIN", 30, "medium"),
        col("fieldGoalsMade-fieldGoalsAttempted", "FG", 40, "large"), col("threePointFieldGoalsMade-threePointFieldGoalsAttempted", "3PT", 36, "large"),
        col("steals", "STL", 28, "xlarge"), col("blocks", "BLK", 28, "xlarge")];
    case "football":
      switch (pos) {
        case "QB":
          return [col("passingYards", "YDS", 36), col("passingTouchdowns", "TD", 24), col("interceptions", "INT", 26), col("cmpatt", "C/ATT", 44, "medium"),
            col("QBRating", "RTG", 36, "large"), col("rushingYards", "RUSH", 36, "xlarge")];
        case "RB":
        case "FB":
          return [col("rushingYards", "YDS", 36), col("rushingTouchdowns", "TD", 24), col("rushingAttempts", "CAR", 30), col("yardsPerRushAttempt", "AVG", 32, "medium")];
        case "WR":
        case "TE":
          return [col("receptions", "REC", 30), col("receivingYards", "YDS", 36), col("receivingTouchdowns", "TD", 24), col("receivingTargets", "TGT", 30, "medium")];
        case "PK":
        case "K":
          return [col("fieldGoalsMade-fieldGoalAttempts", "FG", 34), col("longFieldGoalMade", "LNG", 30), col("totalKickingPoints", "PTS", 30)];
        default:
          return [col("totalTackles", "TOT"), col("sacks", "SACK", 34), col("interceptions", "INT", 26), col("passesDefended", "PD", 26, "medium")];
      }
    case "baseball":
      if (pitching) {
        return [col("innings", "IP"), col("earnedRuns", "ER", 26), col("strikeouts", "K", 26), col("hits", "H", 26, "medium"), col("walks", "BB", 26, "large"),
          col("wins-losses", "DEC", 30, "large")];
      }
      return [col("hits", "H", 24), col("homeRuns", "HR", 26), col("RBIs", "RBI"), col("atBats", "AB", 26, "medium"), col("walks", "BB", 26, "large"),
        col("strikeouts", "SO", 26, "large")];
    case "soccer":
      if (pos === "G") return [col("saves", "SV", 26), col("goalsConceded", "GA", 26), col("cleanSheet", "CS", 26)];
      return [col("totalGoals", "G", 22), col("goalAssists", "A", 22), col("totalShots", "SH", 26), col("shotsOnTarget", "SOT", 30, "medium"),
        col("yellowCards", "YC", 26, "large")];
    case "esports":
      return [col("rating", "RTG", 34), col("kd", "K–D", 42), col("adr", "ADR", 30), col("hs", "HS%", 34, "medium"), col("maps", "MAPS", 110, "xlarge")];
    default:
      return [];
  }
}

/** The overview's season and career lines (preferred keys, and from which width). */
export function seasonColumns(sport: Sport, position: string | null): [string, WidthClass][] {
  switch (sport) {
    case "basketball":
      return [["gamesPlayed", "compact"], ["avgPoints", "compact"], ["avgRebounds", "compact"], ["avgAssists", "compact"], ["fieldGoalPct", "medium"],
        ["threePointPct", "large"], ["avgMinutes", "large"]];
    case "football":
      switch ((position ?? "").toUpperCase()) {
        case "QB":
          return [["passingYards", "compact"], ["passingTouchdowns", "compact"], ["interceptions", "compact"], ["completionPct", "medium"], ["QBRating", "large"]];
        case "RB":
        case "FB":
          return [["rushingAttempts", "compact"], ["rushingYards", "compact"], ["rushingTouchdowns", "compact"], ["yardsPerRushAttempt", "medium"]];
        case "WR":
        case "TE":
          return [["receptions", "compact"], ["receivingYards", "compact"], ["receivingTouchdowns", "compact"], ["yardsPerReception", "medium"]];
        default:
          return [["totalTackles", "compact"], ["sacks", "compact"], ["interceptions", "compact"], ["passesDefended", "medium"]];
      }
    case "baseball":
      // Web addition: a pitcher's overview has no ERA or wins (only GP, IP, H, ER, HR, BB, K), so the
      // hitter's columns would show hits and home runs allowed; a pitcher reads innings and strikeouts.
      if (["SP", "RP", "P", "CL"].includes((position ?? "").toUpperCase())) {
        return [["gamesPlayed", "compact"], ["innings", "compact"], ["strikeouts", "compact"], ["walks", "compact"], ["earnedRuns", "medium"],
          ["hits", "large"], ["homeRuns", "large"]];
      }
      return [["gamesPlayed", "compact"], ["hits", "compact"], ["homeRuns", "compact"], ["RBIs", "compact"], ["atBats", "medium"], ["walks", "large"],
        ["strikeouts", "large"], ["ERA", "compact"], ["wins", "compact"], ["innings", "medium"]];
    default:
      return [];
  }
}

/** Career by season (`/stats` averages). */
export function careerColumns(sport: Sport, position: string | null): [string, WidthClass][] {
  switch (sport) {
    case "basketball":
      return [["gamesPlayed", "compact"], ["avgPoints", "compact"], ["avgRebounds", "compact"], ["avgAssists", "compact"], ["fieldGoalPct", "medium"], ["threePointPct", "large"]];
    case "baseball":
      return [["gamesPlayed", "compact"], ["homeRuns", "compact"], ["RBIs", "compact"], ["avg", "compact"], ["OPS", "medium"], ["ERA", "compact"], ["wins", "compact"],
        ["strikeouts", "medium"]];
    default:
      return seasonColumns(sport, position);
  }
}

export const COMPETITION_COLUMNS: [string, WidthClass][] = [["starts", "compact"], ["totalGoals", "compact"], ["goalAssists", "compact"], ["totalShots", "medium"],
  ["yellowCards", "large"]];

/** The table columns that exist and fit: the preferred ones, else the first few (StatTableView.indices). */
export function tableColumnIndices(keys: readonly string[], columnCount: number, preferred: readonly [string, WidthClass][], width: WidthClass): number[] {
  const wanted = preferred.filter(([, from]) => atLeast(width, from)).map(([k]) => k);
  const found = wanted.flatMap((k) => {
    const idx = keys.indexOf(k);
    return idx >= 0 ? [idx] : [];
  });
  const large = atLeast(width, "large");
  if (found.length > 0) return found.slice(0, large ? 7 : 5);
  return Array.from({ length: Math.min(columnCount, large ? 6 : 4) }, (_, k) => k);
}

/** A game-log cell ("cmpatt" is completions/attempts). */
export function gameLogValue(stats: Readonly<Record<string, string>>, key: string): string {
  if (key === "cmpatt" && stats.completions != null && stats.passingAttempts != null) return `${stats.completions}/${stats.passingAttempts}`;
  return stats[key] ?? "–";
}

const STAT_WORDS: Readonly<Record<string, string>> = {
  GP: "games", G: "goals", A: "assists", PTS: "points", REB: "rebounds", AST: "assists", MIN: "minutes", FG: "field goals", "FG%": "field goal percentage",
  "3PT": "three-pointers", "3P%": "three-point percentage", STL: "steals", BLK: "blocks", YDS: "yards", TD: "touchdowns", INT: "interceptions",
  "C/ATT": "completions", RTG: "rating", RUSH: "rushing yards", CAR: "carries", AVG: "average", REC: "receptions", TGT: "targets", LNG: "long",
  TOT: "tackles", SACK: "sacks", PD: "passes defended", IP: "innings", ER: "earned runs", K: "strikeouts", H: "hits", BB: "walks", DEC: "decision",
  HR: "home runs", RBI: "runs batted in", AB: "at bats", SO: "strikeouts", SV: "saves", GA: "goals against", CS: "clean sheets", SH: "shots",
  SOT: "shots on target", YC: "yellow cards", "K–D": "kills to deaths", ADR: "damage per round", "HS%": "headshot percentage", MAPS: "maps",
  ERA: "earned run average", W: "wins", L: "losses", OPS: "on-base plus slugging", WHIP: "walks and hits per inning", "CMP%": "completion percentage",
  STRT: "starts", SHOTS: "shots", APP: "appearances",
};

/** Stat column codes as a screen reader should say them ("PTS" → "points"). */
export function statWord(code: string): string {
  return STAT_WORDS[code.toUpperCase()] ?? code.toLowerCase();
}

// MARK: - Formatting

/** "Sun, Oct 25". */
export function profileDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "Oct 25". */
export function profileShort(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Mar 12, 1999", in UTC (birth dates are days, not instants). */
export function bornDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "$1.6M", "$457K". */
export function money(value: number): string {
  return value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}K`;
}

/** ESPN's "6' 2\"" in typographic primes. */
export function height(text: string): string {
  return text.replaceAll("' ", "′").replaceAll('"', "″");
}

/** "6' 2\"" → "6 feet 2 inches"; "164 cm" stays as is. */
export function spokenHeight(text: string): string {
  const digits = text.split(/\D+/).filter(Boolean).map(Number);
  if (!text.includes("'") || digits[0] == null) return text;
  const inches = digits[1] ?? 0;
  return `${digits[0]} feet${inches > 0 ? ` ${inches} ${inches === 1 ? "inch" : "inches"}` : ""}`;
}

// MARK: - About

/** Facts in reading order; a missing fact is skipped, never "–". */
export function aboutFacts(bio: Bio, sport: Sport, college: boolean, profile: PlayerProfile): [string, string][] {
  const out: [string, string][] = [];
  const add = (lbl: string, value: string | null | undefined) => {
    if (value) out.push([lbl, value]);
  };
  const birth = [bio.birthDate != null ? bornDate(bio.birthDate) : null, bio.birthPlace].filter(Boolean).join(" · ");
  const size = [bio.height ? height(bio.height) : null, bio.weight?.replace(" lbs", " lb") ?? null].filter(Boolean).join(" · ");
  switch (sport) {
    case "esports":
      add("Born", bio.birthDate != null ? bornDate(bio.birthDate) : null);
      add("Nationality", bio.nationality);
      add("With team since", bio.since != null ? new Date(bio.since).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : null);
      add("Role", profile.roles.length > 0 ? profile.roles.join(" · ") : null);
      add("Prize money", bio.prizeMoney != null ? money(bio.prizeMoney) : null);
      break;
    case "climbing":
      add("Born", bio.birthDate != null ? bornDate(bio.birthDate) : null);
      add("Height", bio.height);
      add("Arm span", bio.armSpan != null ? `${bio.armSpan} cm` : null);
      add("Home", bio.hometown);
      add("Federation", bio.federation);
      add("Speed PB", profile.speedBest);
      break;
    case "soccer":
      add("Born", birth);
      add("Nationality", bio.nationality);
      add("Height", bio.height ? height(bio.height) : null);
      add("Position", bio.position);
      break;
    case "baseball":
      add("Born", birth);
      add("Bats / Throws", bio.batsThrows);
      add("Debut", bio.debutYear != null ? String(bio.debutYear) : null);
      add("Size", size);
      break;
    default:
      if (sport === "football" && college) {
        add("Class", bio.classYear);
        add("Hometown", bio.birthPlace);
        add("Size", size);
        add("Position", bio.position);
      } else {
        add("Born", birth);
        add("Size", size);
        add("College", bio.college);
        add("Drafted", bio.draft);
        add("Experience", bio.experience);
      }
  }
  return out;
}

/** "31 · 6′2″ · 225 lb"; college "Sophomore · 6′4″"; climbers "27 · 164 cm · Slovenj Gradec". */
export function factsLine(bio: Bio, sport: Sport, college: boolean, flag: (iso2: string | null) => string | null): { text: string; spoken: string } | null {
  const parts: string[] = [];
  const spoken: string[] = [];
  if (college && bio.classYear) {
    parts.push(bio.classYear);
    spoken.push(bio.classYear);
  } else if (bio.age != null) {
    parts.push(String(bio.age));
    spoken.push(`${bio.age} years old`);
  }
  if (bio.height) {
    parts.push(height(bio.height));
    spoken.push(spokenHeight(bio.height));
  }
  if (bio.weight) {
    parts.push(bio.weight.replace(" lbs", " lb"));
    spoken.push(bio.weight.replace(" lbs", " pounds").replace(" lb", " pounds"));
  }
  if (sport === "climbing" && bio.hometown) {
    parts.push(bio.hometown);
    spoken.push(bio.hometown);
  }
  if (sport === "esports" && bio.nationality) {
    parts.unshift(`${flag(bio.country) ?? ""} ${bio.nationality}`.trim());
    spoken.unshift(bio.nationality);
  }
  return parts.length > 0 ? { text: parts.join(" · "), spoken: spoken.join(", ") } : null;
}

// MARK: - The docked bar (PlayerPage.swift `PlayerDock`)

/** Beside the name: "LAL · SF"; "🇸🇮 Slovenia" for climbers; the team for CS2; "Free agent" once the bio says there's no team. */
export function dockDetail(sport: Sport, bio: Bio, team: TeamRef | null, loaded: boolean, flagIOC: (ioc: string | null) => string | null): string | null {
  switch (sport) {
    case "climbing":
      return [flagIOC(bio.country), bio.nationality ?? bio.country].filter(Boolean).join(" ") || null;
    case "esports":
      return team?.name ?? null;
    default: {
      const position = bio.positionAbbreviation ?? bio.position;
      const parts = [team ? (team.abbreviation ?? team.name) : null, position].filter((p): p is string => p != null);
      if (parts.length === 0 && loaded) return bio.active ? "Free agent" : "Retired";
      return parts.length > 0 ? parts.join(" · ") : null;
    }
  }
}

/** The season's lead number: the first of the season's tiles (points, bo3.gg's rating, a World Cup rank). */
export function dockStat(tiles: readonly StatTile[]): StatTile | null {
  return tiles[0] ?? null;
}

/**
 * The dock's progress for a scroll offset, in steps of 1/64 (PageGeometry.swift
 * `dockStep`): 0 until a quarter of the hero has slid under the header, 1
 * three quarters of its height later. Quantized, so the bar re-renders at most
 * 64 times across the whole tuck, never per scroll event.
 */
export function dockStep(heroTop: number, heroHeight: number, offset: number): number {
  const start = heroTop + 0.25 * heroHeight;
  const travel = Math.max(0.75 * heroHeight - 4, 24);
  const p = Math.min(Math.max((offset - start) / travel, 0), 1);
  return Math.round(p * 64);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The bar at dock progress p (DockedScorebar.swift `DockRules`): from 96% and
 * 6pt up, fading in over 0.35…0.9, taking clicks from half docked.
 */
export function dockMotion(p: number): { opacity: number; scale: number; offset: number; interactive: boolean } {
  const c = Math.min(Math.max(p, 0), 1);
  return { opacity: p <= 0 ? 0 : smoothstep(0.35, 0.9, p), scale: 0.96 + 0.04 * c, offset: -6 * (1 - c), interactive: p >= 0.5 };
}

/** The hero tucking under the header: shrinks 6% toward its top edge and fades (DockRules.heroTuck). */
export function heroTuck(minY: number, heroHeight: number): { scale: number; opacity: number } {
  if (heroHeight <= 0) return { scale: 1, opacity: 1 };
  const t = Math.min(Math.max(-minY / (0.75 * heroHeight), 0), 1);
  const s = Math.min(Math.max((t - 0.35) / 0.45, 0), 1);
  return { scale: 1 - 0.06 * t, opacity: 1 - s * s * (3 - 2 * s) };
}

/** Large monograms (heroes) are a solid disc in the team color; small ones in lists stay quiet. */
export function boldMonogram(size: number, hasTint: boolean): boolean {
  return size >= 48 && hasTint;
}

/** FotMob's photos are face crops: centered, like portraits. */
export function photoAlignment(url: string | null, crop: "cutout" | "portrait"): "top" | "center" {
  return crop === "cutout" && !isFotMobPhoto(url) ? "top" : "center";
}
