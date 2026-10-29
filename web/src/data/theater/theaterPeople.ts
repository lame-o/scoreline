/**
 * Who the names on the isometric views name (TheaterNames.swift § Who,
 * `TheaterPerson` and `TheaterPeople`): a player as a tag gives him, his
 * surname, his number and his position's abbreviation, as the game's own
 * data has him; and everyone a summary names, by ESPN athlete ID, parsed
 * once per summary (gameDetail.ts) for the theaters' casts to read. Small and
 * pure, so the game page's data layer takes it without the theaters' kit
 * (the casts, the tag and its placement are theaterNames.ts).
 */
import { arr, at, str, type JSONValue } from "../json";

/** A player as a tag names him. */
export interface TheaterPerson {
  readonly name: string;
  /** "Wembanyama", "Mesa Jr.", "Jones Garcia". */
  readonly last: string;
  readonly number: string | null;
  /** "SS", "WR", "G", "GK". */
  readonly position: string | null;
}

const filled = (s: string | null | undefined): string | null => (s ? s : null);

/** A person from what's known of him: the surname from his full name unless given. */
export function theaterPerson(name: string, last: string | null = null, number: string | null = null, position: string | null = null): TheaterPerson {
  return { name, last: filled(last) ?? surname(name), number: filled(number), position: filled(position) };
}

/**
 * An ESPN athlete (a box score's, a roster's): the surname from its own
 * `lastName`, else its short name past the initial ("D. Jones Garcia":
 * Jones Garcia, a two-word surname the full name can't tell), else the full
 * name's.
 */
export function athletePerson(a: JSONValue, number: string | null = null, position: string | null = null): TheaterPerson | null {
  const name = str(at(a, "displayName")) ?? str(at(a, "fullName"));
  if (!name) return null;
  const short = str(at(a, "shortName"));
  return theaterPerson(name, str(at(a, "lastName")) ?? (short != null ? afterInitials(short) : null), number ?? str(at(a, "jersey")) ?? null, position ?? str(at(a, "position", "abbreviation")) ?? null);
}

const SUFFIXES = new Set(["Jr.", "Sr.", "Jr", "Sr", "II", "III", "IV", "V"]);

/** The surname a tag gives a full name, a suffix kept: "Mikel Brown Jr." → "Brown Jr.", "Kenneth Walker III" → "Walker III", "Alysson" → "Alysson". (pure; tested) */
export function surname(full: string): string {
  const words = afterInitials(full).split(" ").filter((w) => w.length > 0);
  const last = words.at(-1);
  if (last == null) return full;
  if (SUFFIXES.has(last) && words.length >= 2) return `${words[words.length - 2]} ${last}`;
  return last;
}

/** A short name past its initials: "V. Mesa Jr." → "Mesa Jr.", "S.Barkley" → "Barkley". (pure; tested) */
export function afterInitials(name: string): string {
  let rest = name.trim();
  for (;;) {
    const dot = rest.indexOf(".");
    if (dot < 0 || dot > 2 || dot + 1 >= rest.length || !/^\p{L}*$/u.test(rest.slice(0, dot))) break;
    rest = rest.slice(dot + 1).replace(/^ +/, "");
  }
  return rest.length === 0 ? name : rest;
}

/** The players a game's summary names, by ESPN athlete ID. */
export const TheaterPeople = {
  /**
   * Everyone in the box score, with his number and position where it gives
   * them (basketball's and football's do; baseball's has positions, no
   * numbers). The first entry for a man wins. (pure; tested)
   */
  boxscore(summary: JSONValue): Record<string, TheaterPerson> {
    const out: Record<string, TheaterPerson> = {};
    for (const team of arr(at(summary, "boxscore", "players"))) {
      for (const group of arr(at(team, "statistics"))) {
        for (const entry of arr(at(group, "athletes"))) {
          const a = at(entry, "athlete");
          const id = str(at(a, "id"));
          if (!id || out[id]) continue;
          const person = athletePerson(a);
          if (person) out[id] = person;
        }
      }
    }
    return out;
  },

  /** Everyone on the summary's rosters (baseball's lineups, soccer's squads): his number and position there, over the box score's. */
  rosters(summary: JSONValue): Record<string, TheaterPerson> {
    const out: Record<string, TheaterPerson> = {};
    for (const team of arr(at(summary, "rosters"))) {
      for (const entry of arr(at(team, "roster"))) {
        const a = at(entry, "athlete");
        const id = str(at(a, "id"));
        if (!id) continue;
        const person = athletePerson(a, str(at(entry, "jersey")) ?? null, str(at(entry, "position", "abbreviation")) ?? null);
        if (person) out[id] = person;
      }
    }
    return out;
  },
};
