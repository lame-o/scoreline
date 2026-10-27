/**
 * The climbing round page's data (data/climbing.ts, data/wallState.ts;
 * GameDetail.swift `ClimbingDetail`, LiveSnapshot.swift `WallState`,
 * CelebrateMatch.swift's climbing rules, LiveViews.swift's lead and boulder
 * rules) on recorded IFSC rounds: Santiago 2026's Lead Women Final and
 * Qualification, a lead final recorded live with a climber on the wall, Salt
 * Lake City 2026's Boulder Women Final, a speed qualification
 * (`pnpm fixtures matches`).
 */
import { describe, expect, it } from "vitest";
import {
  boulderTotals,
  climbingMoments,
  decided,
  dockClimber,
  heightLabel,
  holdsToGo,
  isFinalRound,
  labelCapacity,
  labeled,
  labelPositions,
  liveFieldSummary,
  loadClimbingDetail,
  medalName,
  nextTarget,
  parseRound,
  passFor,
  place,
  plotScale,
  rankDeltas,
  rankingRows,
  resultsCaption,
  surname,
  travel,
  travelTime,
  washCountry,
  type BoulderCard,
  type Climber,
  type ClimbingState,
  type WallRoute,
} from "../../src/data/climbing";
import { fetchDetail, type Athlete } from "../../src/data/gameDetail";
import { categoryEvent } from "../../src/data/providers/ifsc";
import { capitalized, wallDomain, wallStateFrom } from "../../src/data/wallState";
import { flagFromIOC } from "../../src/data/teams";
import { fixture, replay } from "./fixtures";

const clone = <T,>(name: string) => structuredClone(fixture(name)) as T;
type Results = { ranking: { active?: boolean; ascents: { status?: string; route_name?: string }[] }[] };

describe("climbing: a round's results", () => {
  it("reads a lead final: one route, highest first, the top one hold above the best", () => {
    const d = parseRound(fixture("ifsc-round-lead-final.json"));
    expect(d.roundName).toBe("Final");
    expect(d.discipline).toBe("lead");
    expect(d.wall).toHaveLength(1);
    const route = d.wall[0]!;
    expect(route.total).toBe(8);
    expect(route.climbers.map((c) => c.label)).toEqual(["Top", "48+", "46+", "46+", "46+", "44+", "38", "37+"]);
    expect(route.climbers[0]).toMatchObject({ name: "J. Garnbret", country: "SLO", flag: "🇸🇮", top: true, height: 49 });
    expect(route.climbers[1]!.height).toBe(48.5);
    // Ties keep the route's rank order.
    expect(route.climbers.slice(2, 5).map((c) => c.rank)).toEqual([3, 4, 5]);
    expect(d.ranking[0]).toEqual({ id: 1147, rank: 1, name: "Janja Garnbret", country: "SLO", score: "TOP", short: "J. Garnbret" });
    expect(d.boulders).toEqual([]);
    expect(d.upNext).toBeNull();
  });

  it("reads a lead qualification's two routes, tops first and ordered by height", () => {
    const d = parseRound(fixture("ifsc-round-lead-qualification.json"));
    expect(d.wall.map((r) => r.name)).toEqual(["1", "2"]);
    for (const r of d.wall) {
      const heights = r.climbers.map((c) => c.height);
      expect(heights).toEqual([...heights].sort((a, b) => b - a));
      const tops = r.climbers.filter((c) => c.top);
      expect(r.climbers.slice(0, tops.length).every((c) => c.top)).toBe(true);
      expect(tops.every((c) => c.height > Math.max(...r.climbers.filter((x) => !x.top).map((x) => x.height)))).toBe(true);
    }
  });

  it("reads a boulder final's cards: four problems, the winner topped three, attempts counted", () => {
    const d = parseRound(fixture("ifsc-round-boulder-final.json"));
    expect(d.discipline).toBe("boulder");
    expect(d.boulderProblems).toEqual(["1", "2", "3", "4"]);
    expect(d.wall).toEqual([]);
    const first = d.boulders[0]!;
    expect(first).toMatchObject({ name: "O. Bertone", country: "FRA", flag: "🇫🇷", score: "84.6", rank: 1, onWall: false });
    expect(first.problems.map((p) => p.reach)).toEqual(["top", "top", "zone", "top"]);
    expect(first.problems.map((p) => p.tries)).toEqual([5, 1, 4, 1]);
    expect(boulderTotals(first)).toEqual({ tops: 3, zones: 4 });
  });

  it("never draws speed times on the wall", () => {
    const d = parseRound(fixture("ifsc-round-results.json"));
    expect(d.wall).toEqual([]);
    expect(d.boulders).toEqual([]);
    expect(d.ranking.length).toBeGreaterThan(0);
  });

  it("reads who's on the wall live, and who climbs next", () => {
    const d = parseRound(fixture("ifsc-round-lead-live.json"));
    expect(d.roundStatus).toBe("active");
    const route = d.wall[0]!;
    expect(route.climbers.filter((c) => c.onWall).map((c) => c.name)).toEqual(["R. Hamada"]);
    expect(route.climbers.map((c) => c.label)).toEqual(["41+", "7"]);
    expect(route.total).toBe(8);
    expect(d.upNext).toMatchObject({ name: "S. Anraku", position: 3, total: 8 });
  });

  it("names the hero's leader from the round's own ranking, as the scores list words it", () => {
    const d = parseRound(fixture("ifsc-round-lead-live.json"));
    const first = d.ranking.find((a) => a.rank === 1)!;
    const line = liveFieldSummary(d, "live");
    // "Final · Leader 🇯🇵 R. Hamada": the results' first place, the scoreboard's wording (Providers.swift).
    expect(line).toBe(`${d.roundName} · Leader ${[flagFromIOC(first.country), first.short].filter(Boolean).join(" ")}`);
    expect(first.short).toMatch(/^\p{L}\. \S/u);
    // A climber on the wall has no place yet: the line names whoever IFSC ranks first.
    const climbing = { ...d, ranking: [{ ...first, rank: null, score: "48+" }, ...d.ranking.filter((a) => a !== first).map((a) => (a.rank === 2 ? { ...a, rank: 1 } : a))] };
    const next = climbing.ranking.find((a) => a.rank === 1);
    expect(liveFieldSummary(climbing, "live")).toBe(next ? `${d.roundName} · Leader ${[flagFromIOC(next.country), next.short].filter(Boolean).join(" ")}` : null);
    // Not live, or nobody placed: the scoreboard's line stands.
    expect(liveFieldSummary(d, "final")).toBeNull();
    expect(liveFieldSummary({ ...d, roundStatus: "finished" }, "live")).toBeNull();
    expect(liveFieldSummary({ ...d, ranking: d.ranking.map((a) => ({ ...a, rank: null })) }, "live")).toBeNull();
  });

  it("loads the next round's starting order before it begins", async () => {
    const next = { round: "Final", startlist: [{ athlete_id: 2, firstname: "Ai", lastname: "MORI", country: "JPN", route_start_positions: [{ route_name: "1", position: 2 }] }, { athlete_id: 1, firstname: "Janja", lastname: "GARNBRET", country: "SLO", route_start_positions: [{ route_name: "1", position: 1 }] }], ranking: [] };
    const fetcher = replay([
      [/category_rounds\/10451\//, fixture("ifsc-round-lead-qualification.json")],
      [/category_rounds\/11362\//, next],
    ]);
    const d = await loadClimbingDetail("/api/v1/category_rounds/10451/results", "/api/v1/category_rounds/11362/results", fetcher);
    expect(fetcher.calls.every((u) => u.startsWith("https://ifsc.results.info/api/v1/"))).toBe(true);
    expect(d.startlistRound).toBe("Final");
    expect(d.startlist.map((a) => [a.rank, a.name])).toEqual([[1, "Janja Garnbret"], [2, "Ai Mori"]]);
    // The round's own order, while it has no results yet.
    const pending = parseRound({ round: "Semi-final", status: "pending", startlist: next.startlist, ranking: [] });
    expect(pending.startlistRound).toBe("Semi-final");
    expect(pending.startlist).toHaveLength(2);
  });

  it("is fetched through the page's detail by the event's ref", async () => {
    const fetcher = replay([[/category_rounds\/11362\//, fixture("ifsc-round-lead-final.json")]]);
    const e = { id: "ifsc-1489-3", content: { kind: "field", title: "Lead Women", summary: "" }, state: "final", start: 0, detail: null, caption: null, link: null, stage: null, clock: null, possession: null, liveLine: null, liveLineRoutine: false, broadcast: null, venue: null, snapshot: null, ref: { kind: "climbing", eventID: 1489, category: "Lead Women", resultURL: "/api/v1/category_rounds/11362/results", round: "Final", eventName: "Santiago 2026", nextURL: null } } as const;
    const d = await fetchDetail(e, fetcher);
    expect(d.wall[0]!.climbers).toHaveLength(8);
    expect(d.maps).toEqual([]);
  });
});

describe("climbing: who's on the wall, for tiles (WallState.from)", () => {
  it("lead: the climber on the wall, with the route's leader", () => {
    const state = wallStateFrom(fixture("ifsc-round-lead-live.json"));
    expect(state?.phase.kind).toBe("lead");
    if (state?.phase.kind !== "lead") return;
    expect(state.phase.climber).toMatchObject({ athlete: { name: "R. Hamada", country: "JPN", flag: "🇯🇵" }, top: false, label: "7" });
    expect(state.phase.leader).toMatchObject({ athlete: { name: "S. Yoshida" }, label: "41+", height: 41.5 });
    expect(state.phase.route).toBeNull();
    expect(wallDomain(7, 41.5)).toBe(50);
    expect(wallDomain(2, null)).toBe(10);
  });

  it("between climbers: who's up next, with their country", () => {
    const between = clone<Results>("ifsc-round-lead-live.json");
    for (const a of between.ranking) {
      a.active = false;
      for (const s of a.ascents) if (s.status === "active") s.status = "pending";
    }
    const state = wallStateFrom(between);
    expect(state?.phase).toEqual({ kind: "upNext", athlete: { name: "R. Hamada", flag: "🇯🇵", country: "JPN" } });
  });

  it("boulder: nobody on a finished round; the athlete's card and the problem being climbed", () => {
    expect(wallStateFrom(fixture("ifsc-round-boulder-final.json"))).toBeNull();
    const live = clone<Results>("ifsc-round-boulder-final.json");
    live.ranking[2]!.active = true;
    live.ranking[2]!.ascents[3]!.status = "active";
    const state = wallStateFrom(live);
    expect(state?.phase.kind).toBe("boulder");
    if (state?.phase.kind !== "boulder") return;
    expect(state.phase.cells).toHaveLength(4);
    expect(state.phase.active).toBe(3);
    expect(state.phase.athlete.name).toBe("M. Nakamura");
  });

  it("speed and finished lead rounds: nothing", () => {
    expect(wallStateFrom(fixture("ifsc-round-results.json"))).toBeNull();
    expect(wallStateFrom(fixture("ifsc-round-lead-final.json"))).toBeNull();
  });

  it("dresses a live tile from the provider's own read of the round", async () => {
    const live = fixture("ifsc-round-lead-live.json");
    const fetcher = replay([[/results$/, live]]);
    const now = Date.parse("2026-10-25T20:00:00Z");
    const cat = { dcat_name: "LEAD Men", category_rounds: [{ name: "Final", status: "active", status_as_of: "2026-10-25 19:30:00 UTC", result_url: "/api/v1/category_rounds/11361/results" }] };
    const comp = { event_id: 1489, event: "World Climbing Series Santiago 2026", starts_at: "2026-10-23 03:00:00 UTC", ends_at: "2026-10-26 02:59:00 UTC" };
    const e = await categoryEvent(cat, comp, now, 2, [], fetcher, undefined, now);
    expect(e?.state).toBe("live");
    expect(e?.snapshot?.kind).toBe("climbing");
    expect(capitalized("GINÉS LÓPEZ")).toBe("Ginés López");
  });
});

// MARK: - Rules

const c = (id: number, height: number, extra: Partial<Climber> = {}): Climber => ({
  id,
  name: `C${id}`,
  country: "SLO",
  flag: null,
  height,
  top: false,
  label: heightLabel(height, extra.top ?? false),
  rank: null,
  onWall: false,
  ...extra,
});
const detail = (climbers: Climber[], { total = 8, round = "Final" }: { total?: number; round?: string } = {}): ClimbingState => ({
  wall: [{ name: "1", climbers, total }],
  boulders: [],
  boulderProblems: [],
  roundName: round,
});

describe("climbing rules: the lead wall", () => {
  // Done before Rogora climbs: Rakovec 46+, Nakagawa 46+, Doumont 44+, Siruckova 38, Fisher 37+.
  const done = [c(1160, 46.5), c(11783, 46.5), c(328, 44.5), c(1447, 38), c(13022, 37.5)];

  it("reads heights like IFSC, and places a climber among the finished", () => {
    expect([heightLabel(46.5, false), heightLabel(47, false), heightLabel(53, true)]).toEqual(["46+", "47", "Top"]);
    expect(place(44, false, done)).toBe(4);
    expect(place(47, false, done)).toBe(1);
    expect(nextTarget(44, false, done)?.id).toBe(328);
    expect(nextTarget(46.5, false, done)).not.toBeNull();
    expect(nextTarget(47, false, done)).toBeNull();
  });

  it("says what the next place takes", () => {
    expect(holdsToGo(44, false, done)).toBe("1 hold to 3rd");
    expect(holdsToGo(44.5, false, done)).toBe("1 hold to 3rd");
    expect(holdsToGo(45, false, done)).toBe("2 holds to lead");
    expect(holdsToGo(47, false, done)).toBeNull();
    expect(holdsToGo(40, true, done)).toBeNull();
    expect(holdsToGo(40, false, [c(1, 0, { top: true })])).toBeNull();
  });

  it("knocks each mark as the dot's travel spring reaches it", () => {
    const rogora = c(928, 47, { onWall: true });
    const pass = passFor({ id: "pass:928:11783", targets: [] }, rogora, 44, done, 51, false);
    expect(pass.knocks.map((k) => k.id)).toEqual([328, 1160, 11783]);
    const times = pass.knocks.map((k) => k.at);
    expect(times.every((t, i) => i === 0 || t > times[i - 1]!)).toBe(true);
    expect(times.every((t) => t >= 0.04 && t <= 0.45)).toBe(true);
    expect(times[2]! - times[1]!).toBeCloseTo(0.035, 6);
    expect(travel(times[0]!)).toBeCloseTo(0.5 / 3, 3);
    expect(travel(times[1]!)).toBeCloseTo(2.5 / 3, 3);
    expect(pass.flip).toBe(times.at(-1));
    expect(passFor({ id: "x", targets: ["11783"] }, rogora, 44, done, 51, false).knocks.map((k) => k.id)).toEqual([11783]);
    const calm = passFor({ id: "x", targets: [] }, rogora, 44, done, 51, true);
    calm.knocks.forEach((k, i) => expect(k.at).toBeCloseTo([0.08, 0.13, 0.18][i]!, 9));
    const topped = passFor({ id: "climb:1147:1", targets: [] }, c(1147, 49, { top: true }), 47.5, [c(928, 48.5), ...done], 53, false);
    expect(topped.knocks.map((k) => k.id)).toEqual([928]);
    expect(travel(topped.flip)).toBeCloseTo(0.85, 2);
    expect(travel(travelTime(0.6))).toBeCloseTo(0.6, 3);
    expect(travel(0)).toBe(0);
    expect(travel(1.2)).toBeGreaterThan(0.999);
  });

  it("labels as many as fit, your countries first, and keeps labels apart within the wall", () => {
    const field = Array.from({ length: 40 }, (_, i) => c(i + 1, 40 - i * 0.5, { country: i === 30 ? "USA" : "JPN" }));
    const capacity = labelCapacity(250);
    expect(capacity).toBe(18);
    const shown = labeled(field, new Set(["USA"]), capacity);
    expect(shown.size).toBe(capacity);
    expect(shown.has(31)).toBe(true);
    expect(labeled(field.slice(0, 5), new Set(), capacity).size).toBe(5);
    const stacked = labelPositions(Array(30).fill(20), 13, 242, 12);
    expect(stacked[0]).toBeGreaterThanOrEqual(12);
    stacked.forEach((y, i) => i > 0 && expect(y - stacked[i - 1]!).toBeCloseTo(13, 9));
    expect(labelPositions([100, 101, 140], 13, 242)).toEqual([100, 113, 140]);
  });

  it("scales the plot to at least 45 holds, four above the best", () => {
    expect(plotScale({ name: "1", climbers: done, total: 8 })).toBe(51);
    expect(plotScale({ name: "1", climbers: [c(1, 30)], total: 8 })).toBe(45);
    expect(plotScale({ name: "1", climbers: [c(1, 44.5)], total: 8 })).toBe(49);
  });
});

describe("climbing rules: moments (a top, a pass, the podium, the final decided)", () => {
  // Finished: 41 (5), 38+ (1), 36 (4), 33 (2), 20 (6). Climber 9 goes 30 → 39.
  const done = [c(5, 41), c(1, 38.5), c(4, 36), c(2, 33), c(6, 20)];
  const before = detail([...done, c(9, 30, { onWall: true })]);
  const after = detail([...done, c(9, 39, { onWall: true })]);

  it("names every climber passed, lowest first, with the climb's span; into the medal zone", () => {
    const pass = climbingMoments(before, after).find((m) => m.kind === "passed")!;
    expect(pass.id).toBe("pass:9:1");
    expect(pass.targets).toEqual(["2", "4", "1"]);
    expect(pass.span).toEqual([30, 39]);
    expect([...pass.accents]).toEqual(["podium"]);
    expect(pass.tier).toBe(2);
    expect(pass.detail).toBe("C9 · now 2nd");
  });

  it("a new leader in a final is the round's score; in a semi, a swing", () => {
    const lead = climbingMoments(after, detail([...done, c(9, 42, { onWall: true })])).find((m) => m.kind === "passed")!;
    expect([...lead.accents]).toEqual(["newLeader"]);
    expect(lead.tier).toBe(3);
    expect(lead.lead).toBe("Takes the lead");
    expect(lead.targets).toEqual(["5"]);
    const semi = climbingMoments(detail([...done, c(9, 30, { onWall: true })], { round: "Semi-final" }), detail([...done, c(9, 42, { onWall: true })], { round: "Semi-final" })).find((m) => m.kind === "passed")!;
    expect([...semi.accents]).toEqual(["newLeader"]);
    expect(semi.tier).toBe(2);
    expect(semi.lead).toBe("Passes C5");
  });

  it("a top passes everyone below it, up to the plot's scale; no separate pass", () => {
    const topped = climbingMoments(before, detail([...done, c(9, 50, { top: true, onWall: true })]));
    expect(topped).toHaveLength(1);
    const top = topped[0]!;
    expect(top).toMatchObject({ kind: "top", tier: 3, chart: "ascent", targets: ["2", "4", "1", "5"], span: [30, 45] });
    expect(new Set(top.accents)).toEqual(new Set(["newLeader", "podium"]));
  });

  it("decides the final once, from the winner's mark; never outside a final", () => {
    const last = detail([c(5, 41, { rank: 2 }), c(9, 44, { rank: 1 }), c(4, 36, { rank: 3 }), c(7, 20, { onWall: true })], { total: 4 });
    const down = detail([c(5, 41, { rank: 2 }), c(9, 44, { rank: 1 }), c(4, 36, { rank: 3 }), c(7, 22, { rank: 4 })], { total: 4 });
    const moments = climbingMoments(last, down);
    const gold = moments.find((m) => m.id === "decided:1")!;
    expect(gold.accents.has("decisive")).toBe(true);
    expect(gold).toMatchObject({ tier: 3, targets: ["9"], chart: "ascent" });
    expect(moments.some((m) => m.id === "done:7")).toBe(true);
    expect(climbingMoments(down, down)).toEqual([]);
    expect(climbingMoments(detail(last.wall[0]!.climbers as Climber[], { total: 4, round: "Semi-final" }), detail(down.wall[0]!.climbers as Climber[], { total: 4, round: "Semi-final" })).some((m) => m.accents.has("decisive"))).toBe(false);
    expect(decided(down.wall)).toBe(true);
    expect(decided(last.wall)).toBe(false);
    expect(decided([...down.wall, ...down.wall])).toBe(false);
    expect(decided([{ name: "1", climbers: [], total: 0 }])).toBe(false);
  });

  it("a top that decides the final is the decisive moment itself", () => {
    const last = detail([c(5, 41, { rank: 1 }), c(9, 30, { onWall: true })], { total: 2 });
    const topped = detail([c(9, 50, { top: true, rank: 1 }), c(5, 41, { rank: 2 })], { total: 2 });
    const moments = climbingMoments(last, topped);
    expect(moments.map((m) => m.id)).toEqual(["climb:9:1"]);
    expect(moments[0]!.accents.has("decisive")).toBe(true);
  });

  it("knows a final from a semi", () => {
    expect(isFinalRound("Final")).toBe(true);
    expect(isFinalRound("Women's Final")).toBe(true);
    expect(isFinalRound("Semi-final")).toBe(false);
    expect(isFinalRound("Semifinal")).toBe(false);
    expect(isFinalRound("Qualification")).toBe(false);
    expect(isFinalRound(null)).toBe(false);
    expect([1, 2, 3, 4].map(medalName)).toEqual(["gold", "silver", "bronze", null]);
  });

  it("boulders: a top on the first attempt is a flash; a zone fills quietly", () => {
    const card = (reach: BoulderCard["problems"][number]["reach"], tries: number | null): BoulderCard => ({ id: 3, rank: 1, name: "A. Mori", country: "JPN", flag: null, problems: [{ reach, tries, active: false }], score: null, onWall: true });
    const b = (cards: BoulderCard[]): ClimbingState => ({ wall: [], boulders: cards, boulderProblems: ["1"], roundName: "Final" });
    const flash = climbingMoments(b([card("none", null)]), b([card("top", 1)]));
    expect(flash[0]).toMatchObject({ id: "boulder:3:0:top", kind: "top", chart: "boulder", detail: "A. Mori on B1, flash" });
    expect([...flash[0]!.accents]).toEqual(["flash"]);
    expect([...climbingMoments(b([card("none", null)]), b([card("top", 3)]))[0]!.accents]).toEqual([]);
    expect(climbingMoments(b([card("none", 1)]), b([card("zone", 2)]))[0]).toMatchObject({ kind: "zone", tier: 1 });
  });
});

describe("climbing rules: results and the page", () => {
  const a = (id: number, rank: number | null, country: string | null = null): Athlete => ({ id, rank, name: `A${id}`, country, score: null });

  it("rank deltas: places lost or gained; new, unchanged and unranked show none", () => {
    const deltas = rankDeltas([a(1, 1), a(2, 2), a(3, 3), a(5, null)], [a(4, 1), a(1, 2), a(3, 3), a(2, 4), a(5, 5)]);
    expect([...deltas]).toEqual([[1, -1], [2, -2]]);
  });

  it("lists the top 12 and your countries' athletes below", () => {
    const list = Array.from({ length: 20 }, (_, i) => a(i + 1, i + 1, i === 15 ? "USA" : "JPN"));
    const rows = rankingRows(list, new Set(["USA"]));
    expect(rows.top).toHaveLength(12);
    expect(rows.yoursBelow.map((x) => x.id)).toEqual([16]);
  });

  it("dresses the page in the climber on the wall, else the leader", () => {
    const live = parseRound(fixture("ifsc-round-lead-live.json"));
    expect(washCountry(live, true)).toBe("JPN");
    const final = parseRound(fixture("ifsc-round-lead-final.json"));
    expect(washCountry(final, false)).toBe("SLO");
  });

  it("the docked bar's climber: on the wall with a place, up next, the winner", () => {
    const live = parseRound(fixture("ifsc-round-lead-live.json"));
    expect(dockClimber(live, "live")).toMatchObject({ prefix: null, name: "Hamada", height: "7", place: 2, flag: "🇯🇵" });
    const final = parseRound(fixture("ifsc-round-lead-final.json"));
    expect(dockClimber(final, "final")).toMatchObject({ prefix: "Winner", name: "Janja Garnbret", flag: "🇸🇮" });
    expect(surname("J. Garnbret")).toBe("Garnbret");
    expect(surname("Garnbret")).toBe("Garnbret");
    const boulder = clone<Results>("ifsc-round-boulder-final.json");
    boulder.ranking[0]!.active = true;
    boulder.ranking[0]!.ascents[2]!.status = "active";
    expect(dockClimber(parseRound(boulder), "live")).toMatchObject({ name: "Bertone", boulder: "B3", tally: "3T 4Z" });
  });

  it("captions results by discipline", () => {
    expect(resultsCaption("Speed Men", "Qualification")).toBe("Fastest time in seconds. Lower is better.");
    expect(resultsCaption("Boulder Women", "Final")).toBe("Points for tops and zones, less for extra attempts.");
    expect(resultsCaption("Lead Women", "Qualification")).toBe("Score combines places on both routes. Lower is better.");
    expect(resultsCaption("Lead Women", "Final")).toBe("Score is the highest hold reached. Top means finished.");
  });

  it("the routes the wall shows keep their climbers' order across reads (no flicker)", () => {
    const one = parseRound(fixture("ifsc-round-lead-final.json")).wall[0] as WallRoute;
    const two = parseRound(fixture("ifsc-round-lead-final.json")).wall[0] as WallRoute;
    expect(one.climbers.map((x) => x.id)).toEqual(two.climbers.map((x) => x.id));
  });
});
