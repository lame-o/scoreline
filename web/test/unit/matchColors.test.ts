/**
 * One game's colors, decided once (MatchColorsTests.swift, check by check):
 * real matchups with ESPN's real values. Home keeps its kit; away changes on
 * a clash; the chart and the field agree about who is who, in both schemes.
 */
import { describe, expect, it } from "vitest";
import { coloredEvent, EMPTY_DETAIL, parseESPNDetail, type GameDetail } from "../../src/data/gameDetail";
import { CHARCOAL, APART, eventColors, matchColors, matchPalette, WHITE, type MatchColors, type TeamKit } from "../../src/data/matchColors";
import { dress } from "../../src/data/mlb/theaterTeams";
import type { Competitor, ScoreEvent, Side } from "../../src/data/models";
import { chroma, hue, labDistance, NEUTRAL, oklabFromHex, type Scheme } from "../../src/data/teamColors";
import { theaterLabels } from "../../src/data/theater/theaterNames";
import { noteDetail } from "../../src/state/logoColors";

const kit = (color: string, alternate: string | null = null): TeamKit => ({ color, alternate });

/** A real game: ESPN's team colors (and the match-day kits where the summary has them). */
interface Game {
  readonly name: string;
  readonly top: TeamKit;
  readonly bottom: TeamKit;
  readonly topKit?: TeamKit;
  readonly bottomKit?: TeamKit;
  readonly home: Side;
  /** What each side is wearing once it's decided. */
  readonly wears: readonly [string, string];
}

const games: readonly Game[] = [
  // The NFL lists the visitors first.
  { name: "ATL @ TB", top: kit("a71930", "000000"), bottom: kit("bd1c36", "3e3a35"), home: "bottom", wears: ["000000", "bd1c36"] },
  { name: "CLE @ PIT", top: kit("472a08", "ff3c00"), bottom: kit("000000", "ffb612"), home: "bottom", wears: ["ff3c00", "000000"] },
  { name: "CHI @ SEA", top: kit("0b1c3a", "e64100"), bottom: kit("002a5c", "69be28"), home: "bottom", wears: ["e64100", "002a5c"] },
  { name: "BAL @ BUF", top: kit("29126f", "000000"), bottom: kit("00338d", "d50a0a"), home: "bottom", wears: ["000000", "00338d"] },
  // Soccer lists the home side first. Arsenal's third kit at Anfield, November 1.
  { name: "ARS @ LIV, kits posted", top: kit("d11317", "FFFFFF"), bottom: kit("e20520", "003399"), topKit: kit("ff0000"), bottomKit: kit("fceec1", "1b4879"), home: "top", wears: ["ff0000", "fceec1"] },
  { name: "ARS @ LIV, before the lineups", top: kit("d11317", "FFFFFF"), bottom: kit("e20520", "003399"), home: "top", wears: ["d11317", "003399"] },
  { name: "BOU @ MUN", top: kit("da020e", "4169E1"), bottom: kit("f42727", "B57EDC"), home: "top", wears: ["da020e", "B57EDC"] },
  // Both in white as ESPN has them: Palace change into their kit's second color.
  { name: "CRY @ FUL, kits posted", top: kit("ffffff", "CC0000"), bottom: kit("0202fb", "000000"), topKit: kit("ffffff", "000000"), bottomKit: kit("f8f8ff", "0a7fcc"), home: "top", wears: ["ffffff", "0a7fcc"] },
];

const colorsOf = (g: Game): MatchColors => matchColors(g.top, g.bottom, { topKit: g.topKit ?? null, bottomKit: g.bottomKit ?? null, home: g.home });

/** A mark and a jersey are the same color family: both without a hue, or the same hue. */
function family(mark: string, jersey: string): boolean {
  const shirt = oklabFromHex(jersey);
  if (!shirt) return false;
  if (mark === NEUTRAL) return chroma(shirt) < 0.03;
  const drawn = oklabFromHex(mark);
  if (!drawn) return false;
  if (chroma(drawn) < 0.03 || chroma(shirt) < 0.03) return chroma(drawn) < 0.03 && chroma(shirt) < 0.03;
  let hues = Math.abs(hue(drawn) - hue(shirt));
  if (hues > 180) hues = 360 - hues;
  return hues < 16;
}

const SCHEMES: readonly Scheme[] = ["dark", "light"];

describe("match colors", () => {
  for (const game of games) {
    describe(game.name, () => {
      const colors = colorsOf(game);
      it("each side wears what the rule says", () => {
        expect([colors.top.color, colors.bottom.color]).toEqual(game.wears);
      });
      it("home keeps its kit", () => {
        const homeSide = game.home === "top" ? colors.top : colors.bottom;
        const homeKit = game.home === "top" ? (game.topKit ?? game.top) : (game.bottomKit ?? game.bottom);
        expect(homeSide.wear).toBe("own");
        expect(homeSide.color).toBe(homeKit.color);
      });
      it("the clubs' own colors stay for the wash", () => {
        expect(colors.top.identity).toEqual(game.top);
        expect(colors.bottom.identity).toEqual(game.bottom);
      });
      for (const scheme of SCHEMES) {
        it(`${scheme}: the chart and the field draw each team in the same color, never naming opposite teams; both read apart, tags too`, () => {
          const chart = matchPalette(colors, scheme);
          const field = dress(colors, scheme);
          expect(family(chart.top, field.top.jersey) && family(chart.bottom, field.bottom.jersey)).toBe(true);
          expect(!family(chart.top, field.bottom.jersey) || !family(chart.bottom, field.top.jersey)).toBe(true);
          const top = oklabFromHex(field.top.jersey)!;
          const bottom = oklabFromHex(field.bottom.jersey)!;
          expect(labDistance(top, bottom)).toBeGreaterThanOrEqual(APART);
          const tags = theaterLabels(colors, scheme, { top: "A", bottom: "B" });
          expect(labDistance(tags.top.paint.slab, tags.bottom.paint.slab)).toBeGreaterThanOrEqual(APART);
        });
      }
    });
  }

  it("the Steelers are black in both schemes, not gold in one of them", () => {
    const pit = colorsOf(games[1]!);
    for (const scheme of SCHEMES) expect(oklabFromHex(dress(pit, scheme).bottom.jersey)!.l).toBeLessThan(0.35);
  });

  it("a white club is white on the field, and an honest gray mark on a light chart", () => {
    const fulham = colorsOf(games[7]!);
    expect(oklabFromHex(dress(fulham, "light").top.jersey)!.l).toBeGreaterThan(0.9);
    expect(matchPalette(fulham, "light").top).toBe(NEUTRAL);
  });

  it("nothing to change into: the visitors in white, their color at the cap; two golds, charcoal", () => {
    const navies = matchColors(kit("13294b"), kit("092c5c"));
    expect(navies.top.color).toBe(WHITE);
    expect(navies.top.wear).toBe("contrast");
    expect(navies.bottom.wear).toBe("own");
    const golds = matchColors(kit("fdb827"), kit("ffc52f"));
    expect(golds.top.color).toBe(CHARCOAL);
  });
});

describe("ESPN's match-day kits", () => {
  const competitor = (id: string, name: string, color: string): Competitor => ({
    id,
    name,
    abbreviation: name.slice(0, 3).toUpperCase(),
    score: null,
    logo: null,
    isWinner: false,
    color,
    rank: null,
    record: null,
    conferenceRecord: null,
    alternateColor: null,
  });
  const event: ScoreEvent = {
    id: "espn-401879246",
    content: { kind: "match", top: competitor("espn-soccer-364", "Liverpool", "d11317"), bottom: competitor("espn-soccer-359", "Arsenal", "e20520") },
    state: "live",
    start: 0,
    detail: "10'",
    caption: null,
    link: null,
    ref: { kind: "espn", path: "soccer/eng.1", id: "401879246", sport: "soccer" },
  } as unknown as ScoreEvent;
  const header = {
    competitions: [
      {
        competitors: [
          { homeAway: "home", team: { id: "364", color: "d11317", alternateColor: "FFFFFF" } },
          { homeAway: "away", team: { id: "359", color: "e20520", alternateColor: "003399" } },
        ],
      },
    ],
  };
  const inputs = { event, path: "soccer/eng.1", id: "401879246", sport: "soccer" as const };

  it("the summary's rosters say what each side wears; `type` names the kit, not the side", () => {
    const rosters = parseESPNDetail(
      {
        header,
        rosters: [
          { team: { id: "364" }, uniform: { type: "home", color: "ff0000" } },
          { team: { id: "359" }, uniform: { type: "third", color: "fceec1", alternateColor: "1b4879" } },
        ],
      },
      inputs,
    );
    expect(rosters.matchKits["espn-soccer-364"]).toEqual(kit("ff0000"));
    expect(rosters.matchKits["espn-soccer-359"]).toEqual(kit("fceec1", "1b4879"));
    // The page reads the kit for marks and the club's color for the wash.
    const arsenal = eventColors(coloredEvent(event, rosters), true)!;
    expect(arsenal.bottom.color).toBe("fceec1");
    expect(arsenal.bottom.identity.color).toBe("e20520");
  });

  it("or the box score's teams; a side without one wears its team's color", () => {
    const box = parseESPNDetail({ header, boxscore: { teams: [{ team: { id: "359", uniform: { type: "third", color: "fceec1", alternateColor: "1b4879" } } }] } }, inputs);
    expect(box.matchKits["espn-soccer-359"]?.color).toBe("fceec1");
    expect(box.matchKits["espn-soccer-364"]).toBeUndefined();
  });

  it("lineups post about 40 minutes before kickoff: taken once then; never a change mid-game", () => {
    const at = (id: string, state: ScoreEvent["state"]): ScoreEvent => ({ ...event, id, state });
    const summary: GameDetail = { ...EMPTY_DETAIL, matchKits: {} };
    expect(noteDetail(summary, at("espn-kit-test", "scheduled")).matchKits).toEqual({});
    const posted: GameDetail = { ...summary, matchKits: { "espn-soccer-359": kit("fceec1") } };
    expect(noteDetail(posted, at("espn-kit-test", "scheduled")).matchKits).toEqual(posted.matchKits);
    const changed: GameDetail = { ...summary, matchKits: { "espn-soccer-359": kit("003399") } };
    expect(noteDetail(changed, at("espn-kit-test", "live")).matchKits).toEqual(posted.matchKits);
    // No kit by kickoff: the game keeps its team colors for good.
    expect(noteDetail(EMPTY_DETAIL, at("espn-kit-test-late", "live")).matchKits).toEqual({});
    expect(noteDetail(posted, at("espn-kit-test-late", "live")).matchKits).toEqual({});
  });
});
