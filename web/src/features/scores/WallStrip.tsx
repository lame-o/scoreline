/**
 * Who's on the wall, on a live climbing tile (TileStrips.swift `WallStrip`):
 * the lead climber's high point against the route's leader (a tick), the
 * boulder athlete's card, or who climbs next. Your countries' climbers fill
 * in the accent. Read from the IFSC results the scores provider already
 * fetches (data/wallState.ts `wallStateFrom`); what it shows is in the
 * tile's label (`wallMeaning`), so the strip itself is hidden from screen
 * readers. Bars ease to their new heights (transform only).
 */
import { useMemo, type CSSProperties } from "react";
import type { WallAthlete, WallReach, WallState } from "../../data/models";
import { wallDomain } from "../../data/wallState";
import { useSettings } from "../../state/settings";
import styles from "./WallStrip.module.css";

const SHARE: Readonly<Record<WallReach, number>> = { top: 1, zone: 0.6, lowZone: 0.3, none: 0 };
const who = (a: WallAthlete) => [a.flag, a.name].filter(Boolean).join(" ");

/** Your climbing countries (IOC), when the climbing filter is on. */
function useCountries(): ReadonlySet<string> {
  const filtered = useSettings((s) => s.filteredLeagues);
  const filters = useSettings((s) => s.teamFilters);
  return useMemo(() => new Set(filtered.includes("ifsc") ? (filters["ifsc"] ?? []).map((id) => id.replace("country-", "")) : []), [filtered, filters]);
}

export function WallStrip({ state }: { state: WallState }) {
  const countries = useCountries();
  const phase = state.phase;
  if (phase.kind === "lead") {
    const { climber, leader, route } = phase;
    const mine = climber.athlete.country != null && countries.has(climber.athlete.country);
    const domain = wallDomain(climber.height, leader?.height ?? null);
    const holds = climber.top ? domain : Math.floor(climber.height);
    const share = Math.min(holds / domain, 1);
    const moving = !climber.top && climber.height > Math.floor(climber.height);
    return (
      <span className={styles.strip} aria-hidden="true">
        <span className={styles.line}>
          <span className={styles.lead}>{route ? `Route ${route}` : "On the wall"}</span>
          <span className={styles.who}>{who(climber.athlete)}</span>
          <span className={styles.spacer} />
          <span className={styles.height} data-top={climber.top}>
            {climber.top ? "TOP" : climber.label}
          </span>
        </span>
        <span className={styles.bar} data-mine={mine}>
          <span className={styles.fill} style={{ transform: `scaleX(${share})` }} />
          {moving ? <span className={styles.nub} style={{ transform: `translateX(calc(${share} * 100cqw))` }} /> : null}
          {leader && !climber.top ? <span className={styles.leader} style={{ transform: `translateX(calc(${Math.min(leader.height / domain, 1)} * 100cqw))` } as CSSProperties} /> : null}
        </span>
      </span>
    );
  }
  if (phase.kind === "boulder") {
    return (
      <span className={styles.strip} aria-hidden="true">
        <span className={styles.line}>
          <span className={styles.lead}>On the wall</span>
          <span className={styles.who}>{who(phase.athlete) + (phase.active != null ? ` · B${phase.active + 1}` : "")}</span>
          <span className={styles.spacer} />
          <span className={styles.cells}>
            {phase.cells.map((reach, i) => (
              <span key={i} className={styles.cell} data-active={i === phase.active} style={{ "--share": SHARE[reach] } as CSSProperties} />
            ))}
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className={styles.strip} aria-hidden="true">
      <span className={styles.line}>
        <span className={styles.lead}>Up next</span>
        <span className={styles.who}>{who(phase.athlete)}</span>
      </span>
    </span>
  );
}

/** The strip in words, for the tile's label (TileStrips.swift's accessibility text). */
export function wallMeaning(state: WallState): string {
  const p = state.phase;
  if (p.kind === "lead") return `${p.climber.athlete.name}, ${p.climber.athlete.country ?? ""}, on the wall at ${p.climber.top ? "the top" : `hold ${p.climber.label}`}`;
  if (p.kind === "boulder") return `${p.athlete.name} on the wall${p.active != null ? `, boulder ${p.active + 1}` : ""}`;
  return `Up next: ${p.athlete.name}`;
}

/** Lead: who leads the route ("Leader 🇯🇵 S. Yoshida 41+"), under the strip. */
export function wallLeaderLine(state: WallState): string | null {
  const p = state.phase;
  if (p.kind !== "lead" || !p.leader) return null;
  return `Leader ${[p.leader.athlete.flag, p.leader.athlete.name, p.leader.label].filter(Boolean).join(" ")}`;
}

/** A small live tile's line: who's climbing, when known. */
export function wallSmallLine(state: WallState): string {
  const p = state.phase;
  if (p.kind === "lead") return [p.climber.athlete.flag, p.climber.athlete.name, p.climber.label].filter(Boolean).join(" ");
  if (p.kind === "boulder") return who(p.athlete) + (p.active != null ? ` · B${p.active + 1}` : "");
  return `Up next ${who(p.athlete)}`;
}
