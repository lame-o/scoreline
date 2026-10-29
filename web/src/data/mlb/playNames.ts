/**
 * Who each figure is in the play theater, for the names over the field
 * (PlayTheater.swift § Names, `PlayScript.cast`): every man the data names.
 * The fielders by their places in the lineups now (the pitcher a play's own,
 * else the one in now); the batter and the runners a play names, by ID;
 * between plays (and the next batter and the runners a play leaves on), the
 * live situation's. A change on the field: the man coming in by the name the
 * beat gives, the man going off the one he replaces. Umpires, coaches and
 * trainers: nobody. Numbers are the summary's lineups', the pitchers' from
 * MLB's box score (matched by name; without it a pitcher's tag has no
 * number). The key man is the batter; on a runner's play, the runner its
 * text leads with ("Chourio stole second"); between plays the batter at the
 * plate. (pure; tested)
 */
import type { Side } from "../models";
import { TheaterCast, theaterPerson, type CastMember, type TheaterPerson, type TheaterWho, assumed, known, TEAM_ONLY } from "../theater/theaterNames";
import type { BaseballFielders, BaseballNow } from "./fielders";
import { PLACE_NAMES } from "./fielders";
import type { PlayBeat } from "./playBeat";
import { leadingName, type PlayScene } from "./playScene";
import type { Actor, PlayScript, Role } from "./playScript";
import { fold, folded } from "./statcast";
import { Ballpark } from "./theaterField";

export function playCast(
  script: PlayScript,
  scene: PlayScene | null,
  beat: PlayBeat | null,
  batting: Side,
  fielders: BaseballFielders,
  people: Readonly<Record<string, TheaterPerson>>,
  numbers: Readonly<Record<string, string>>,
  now: BaseballNow,
  scope: string,
): TheaterCast {
  const actors = script.actors;
  const fielding: Side = batting === "top" ? "bottom" : "top";
  const person = (id: string | null): TheaterPerson | null => {
    const p = id != null ? people[id] : undefined;
    if (!p) return null;
    return p.number == null ? { ...p, number: numbers[folded(p.name)] ?? null } : p;
  };
  /** The man of a side a beat names by his surname ("Mesa Jr."). */
  const named = (last: string | null, side: Side): string | null => {
    if (!last) return null;
    const key = fold(last);
    return fielders.men[side]?.find((id) => (people[id] ? fold(people[id].last) === key : false)) ?? null;
  };
  // A change on the field: who comes in, and where.
  let incoming: { id: string | null; name: string | null; role: Role } | null = null;
  const kind = beat?.kind;
  if (kind?.kind === "pitchingChange") {
    incoming = { id: named(kind.reliever, fielding) ?? (now.side === batting ? now.pitcher : null), name: kind.reliever, role: { kind: "fielder", n: 1 } };
  } else if (kind?.kind === "substitution") {
    const change = kind.change;
    if (change.role === "pinchRunner") incoming = { id: named(change.name, batting), name: change.name, role: { kind: "runner" } };
    else if ((change.role === "defensive" || change.role === "moves") && change.position != null) {
      incoming = { id: named(change.name, fielding), name: change.name, role: { kind: "fielder", n: change.position } };
    }
  }
  const sameRole = (a: Role, b: Role) => a.kind === b.kind && (a.kind !== "fielder" || (b.kind === "fielder" && a.n === b.n));
  const base = (a: Actor): number | null => [1, 2, 3].find((b) => Math.hypot(a.at.x - Ballpark.lead(b).x, a.at.y - Ballpark.lead(b).y) < 6) ?? null;
  /** A man the play names on a figure of its own already (the batter now on first): never twice. */
  const placed = (id: string | null) => id != null && actors.some((a) => a.athlete === id);

  const members = new Map<number, CastMember>();
  actors.forEach((a, i) => {
    if (a.team === "official") return;
    const side: Side = a.team === "batting" ? batting : fielding;
    let id = a.athlete;
    let who: TheaterWho = TEAM_ONLY;
    // In a change, the man who comes on during it (the reliever, the substitute) is the one coming in.
    const comingIn = Number.isFinite(a.appear) && a.appear > 0 && incoming != null && sameRole(incoming.role, a.role);
    const role = a.role;
    switch (role.kind) {
      case "umpire":
      case "coach":
        return;
      case "fielder": {
        const abbreviation = PLACE_NAMES[role.n] ?? "";
        who = assumed(abbreviation);
        if (comingIn && incoming) {
          id = incoming.id;
          if (id == null && incoming.name) who = known(theaterPerson(incoming.name, incoming.name, null, abbreviation));
        } else if (role.n === 1) {
          if (scene && a.team === "fielding" && scene.pitcher != null) {
            id = scene.pitcher;
          } else if (kind?.kind === "pitchingChange") {
            // Going off: the pitcher before the reliever, or the one in until now.
            const order = fielders.pitchers[side] ?? [];
            const k = incoming?.id != null ? order.indexOf(incoming.id) : -1;
            id = k >= 0 ? (k > 0 ? order[k - 1]! : null) : (fielders.pitching[side] ?? null);
            if (id === incoming?.id) id = null;
          } else {
            id = side === fielding && now.side === batting ? (now.pitcher ?? fielders.pitching[side] ?? null) : (fielders.pitching[side] ?? null);
          }
        } else {
          id = fielders.positions[side]?.[role.n] ?? null;
          if (incoming && sameRole(incoming.role, role) && id === incoming.id) id = null;
        }
        const p = person(id);
        if (p) who = known({ ...p, position: abbreviation });
        break;
      }
      case "batter": {
        if (id == null && side === now.side && !placed(now.batter)) id = now.batter;
        const p = person(id);
        if (p) who = known(p);
        break;
      }
      case "runner": {
        const b = base(a);
        if (comingIn && incoming) {
          id = incoming.id;
          if (id == null && incoming.name) who = known(theaterPerson(incoming.name, incoming.name));
        } else if (id == null && side === now.side && b != null && !placed(now.runners[b - 1] ?? null)) {
          id = now.runners[b - 1] ?? null;
          if (incoming?.role.kind === "runner" && id === incoming.id) id = null;
        }
        const p = person(id);
        if (p) who = known(p);
        break;
      }
    }
    members.set(i, TheaterCast.member(who, side, id, i, scope));
  });

  // Who it's about: the batter; on a runner's play, the runner its text leads with.
  let key: number | null = null;
  if (scene) {
    const batter = scene.batter?.id ?? null;
    if (batter != null) {
      const k = actors.findIndex((a) => a.role.kind === "batter" && a.athlete === batter);
      key = k >= 0 ? k : null;
    } else {
      const lead = leadingName(scene.text);
      if (lead != null) {
        const k = actors.findIndex((a) => a.role.kind === "runner" && a.athlete != null && people[a.athlete] != null && fold(people[a.athlete]!.last) === fold(lead));
        key = k >= 0 ? k : null;
      }
    }
  } else if (now.batter != null) {
    for (const [i, m] of members) if (actors[i]!.role.kind === "batter" && m.id === `a:${now.batter}`) key = i;
  }
  return TheaterCast.of(members, key);
}
