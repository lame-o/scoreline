/**
 * Players' names in ESPN's football play texts, as links to their pages
 * ("Jordan Love Pass Complete for 22 Yds to Matthew Golden": both names
 * open a page). The texts name players in full, and the box score lists
 * everyone who played by ID and full name, so a game's names are matched
 * once (longest first, whole words) and every text is split on them.
 *
 *     const names = useNameLinker(detail.playerNames, "football/nfl");
 *     <span>{names(play.text)}</span>
 */
import { Fragment, useMemo, type ReactNode } from "react";
import { espnPlayerRef, PlayerLink } from "../../profiles/ProfileLinks";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits `text` into plain runs and the players it names: `[text, null]` or `[name, id]`. Pure. */
export function splitNames(text: string, pattern: RegExp | null, byName: ReadonlyMap<string, string>): [string, string | null][] {
  if (!pattern || !text) return [[text, null]];
  const out: [string, string | null][] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push([text.slice(last, at), null]);
    out.push([match[0], byName.get(match[0]) ?? null]);
    last = at + match[0].length;
  }
  if (last < text.length) out.push([text.slice(last), null]);
  return out;
}

/** One game's matcher: every name in the box score, longest first, on word boundaries. */
export function namePattern(names: Readonly<Record<string, string>>): { pattern: RegExp | null; byName: Map<string, string> } {
  const byName = new Map<string, string>();
  for (const [id, name] of Object.entries(names)) if (name.trim().length > 2 && !byName.has(name)) byName.set(name, id);
  const all = [...byName.keys()].sort((a, b) => b.length - a.length).map(escape);
  return { pattern: all.length ? new RegExp(`(?<![\\p{L}.])(?:${all.join("|")})(?![\\p{L}])`, "gu") : null, byName };
}

/** A renderer for one game's texts, with its players' names as quiet links (plain text where a name has no page). */
export function useNameLinker(names: Readonly<Record<string, string>>, path: string | null): (text: string) => ReactNode {
  const { pattern, byName } = useMemo(() => namePattern(names), [names]);
  return useMemo(
    () => (text: string) => {
      const parts = splitNames(text, pattern, byName);
      if (parts.length === 1 && parts[0]![1] == null) return text;
      return parts.map(([run, id], i) =>
        id ? (
          <PlayerLink key={i} player={espnPlayerRef(path, id, run)}>
            {run}
          </PlayerLink>
        ) : (
          <Fragment key={i}>{run}</Fragment>
        ),
      );
    },
    [pattern, byName, path],
  );
}
