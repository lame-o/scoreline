/**
 * The marketing shot list: what capture.mjs photographs and what compose.mjs
 * frames. Add a shot here, run both scripts with its name (and
 * readme-gallery.mjs for the galleries), and point the README at the output.
 *
 * Game pages use the `?demo` harness (src/data/demo.ts): recorded games
 * replayed live through each page's own lane, the same every run. Schedules,
 * tables, brackets and profiles read the live feeds through the local Worker,
 * so they show the day they're taken.
 *
 * Captions follow the launch brief's style guide: one family, a short
 * headline with its key word in red-orange (`*word*`), a subline of twelve
 * words or fewer.
 */

/** The settings every capture starts from (localStorage, scoreline.settings.v1). */
export const SETTINGS = {
  enabledLeagues: ["mlb", "nfl", "nba", "eng.1", "uefa.champions", "cs2", "ifsc"],
  followed: [],
};

/** Where the Mac app's renders land (another pipeline; set SCORELINE_MAC_RAW); compose.mjs reads them when they exist. */
export const MAC_RAW_DEFAULT = new URL("../../test-results/marketing/mac", import.meta.url).pathname;

const MLB = "/game/espn-401908044?demo&mlb=8";
const NFL = "/game/espn-401873016?demo&nfl=10";
const SOCCER = "/game/espn-401879256?demo&league=eng.1&soccer=6";
const NBA = "/game/espn-401909869?demo&league=nba&nba=16";
const CS2 = "/game/cs-132240?demo&cs=17";
const CLIMB = "/game/ifsc-1489-0?demo&climb=39";

const settled = (ms) => async (page, h) => {
  await h.settle(ms);
};

// MARK: - Captures

export const captures = [
  // The scores: the sidebar beside a live game, as a list and as tiles, and a game's menu.
  { name: "scores-list", path: NBA, prepare: async (page, h) => { await h.scores(); await h.settle(6000); } },
  {
    name: "scores-tiles",
    path: NFL,
    prepare: async (page, h) => {
      await h.scores();
      await page.getByRole("radio", { name: "Tiles" }).click();
      await h.settle(9000);
    },
  },
  {
    name: "scores-menu",
    path: SOCCER,
    prepare: async (page, h) => {
      await h.scores();
      await h.settle(4000);
      const row = page.locator("aside [data-nav-id]").first();
      const box = await row.boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45, { button: "right" });
      await h.sleep(800);
    },
  },

  // Each sport's live page, its isometric view mid-play (frames timed from the page opening; pick one in compositions).
  { name: "mlb", path: MLB, frames: [6000, 6800, 7600, 9000, 9600, 10400], prepare: async (page, h) => { await h.scores(); } },
  {
    name: "nfl",
    path: NFL,
    framesFrom: "prepare",
    frames: [4200, 4800, 5400, 6200],
    framesOnly: true,
    prepare: async (page, h) => {
      await h.scores();
      await h.sleep(2600);
      await h.scrollTo('section[data-section="field"]', 64);
    },
  },
  { name: "soccer", path: SOCCER, frames: [9500, 10500, 11500, 12500, 13500, 14500, 15500], framesOnly: true, prepare: async (page, h) => { await h.scores(); } },
  { name: "nba", path: NBA, prepare: async (page, h) => { await h.scores(); await page.getByText("Buzzer-beater", { exact: true }).first().waitFor({ timeout: 30_000 }).catch(() => {}); await h.settle(800); } },
  { name: "nba-charts", path: NBA, prepare: async (page, h) => { await h.scores(); await h.settle(12000); await h.scrollTo('section[data-section="flow"]', 64); } },
  { name: "cfb", path: "/game/espn-401856732?demo&league=college-football", prepare: settled(3000) },
  { name: "cs2", path: CS2, prepare: settled(7000) },
  { name: "cs2-final", path: "/game/cs-132237?demo", prepare: settled(3000) },
  { name: "climbing", path: CLIMB, prepare: settled(7000) },

  // The isometric views on their own (the dev render harness, /dev/theater, frozen at an instant), for the feature grid.
  { name: "theater-mlb", path: "/dev/theater?only=Home&t=2.6", element: "canvas", scale: 4, prepare: settled(2500) },
  { name: "theater-nfl", path: "/dev/theater/football?only=Touchdown&t=2.6", element: "canvas", scale: 4, prepare: settled(2500) },
  { name: "theater-soccer", path: "/dev/theater/soccer?only=Gabriel&t=6.4", element: "canvas", scale: 4, prepare: settled(2500) },

  // Everything around the game (live feeds).
  { name: "schedule", path: "/schedule", prepare: settled(4000) },
  { name: "schedule-nfl", path: "/schedule/nfl", prepare: settled(4000) },
  { name: "results", path: "/schedule/eng.1?mode=results", prepare: settled(4000) },
  { name: "standings", path: "/standings/eng.1?demo", prepare: async (page, h) => { await h.scores(); await h.settle(4000); } },
  { name: "standings-nba", path: "/standings/nba", prepare: settled(4000) },
  { name: "rankings", path: "/rankings/college-football", prepare: settled(4000) },
  { name: "bracket-mlb", path: "/bracket/mlb/2026", prepare: settled(4000) },
  { name: "bracket-cs2", path: "/bracket/cs2/pgl-masters-bucharest-2026?name=PGL%20Masters%20Bucharest%202026", prepare: settled(5000) },
  { name: "tournaments", path: "/schedule/tournaments", prepare: settled(4000) },
  { name: "climbing-season", path: "/schedule/climbing", prepare: settled(4000) },
  { name: "team", path: "/team/espn-baseball-8", prepare: settled(5000) },
  { name: "team-soccer", path: "/team/espn-soccer-359?league=eng.1", prepare: settled(5000) },
  { name: "player", path: "/player/mlb-4917869", prepare: settled(5000) },
  { name: "player-soccer", path: "/player/eng.1-238262", prepare: settled(5000) },
  { name: "settings", path: "/settings?demo", prepare: settled(2500) },
  { name: "settings-keyboard", path: "/settings?demo", prepare: async (page, h) => { await h.settle(2500); await h.scrollTo('[role="group"][aria-label="Keyboard shortcuts"]', 330); } },
  { name: "settings-league", path: "/settings/league/eng.1", prepare: settled(4500) },
  { name: "climbing-results", path: "/results/climbing/1489/5?category=Lead%20Women&event=Santiago", prepare: settled(4500) },

  // The phone layout.
  { name: "phone-scores", device: "phone", path: "/?demo", prepare: async (page, h) => { await h.scores(); await h.settle(3000); } },
  { name: "phone-tiles", device: "phone", path: "/?demo", prepare: async (page, h) => { await h.scores(); await page.getByRole("radio", { name: "Tiles" }).click(); await h.settle(3000); } },
  { name: "phone-mlb", device: "phone", path: MLB, frames: [6000, 6800, 7600, 9000, 9600, 10400], framesOnly: true },
  { name: "phone-nfl", device: "phone", path: NFL, prepare: settled(9000) },
];

// MARK: - Compositions (2400×1500 and 1600×1000)

export const compositions = [
  {
    name: "isometric",
    kind: "grid",
    caption: { title: "Every play, *replayed*.", subtitle: "In isometric 3D, the moment it happens." },
    cards: [
      { source: "theater-mlb", title: "Baseball", detail: "Statcast-accurate flights" },
      { source: "theater-nfl", title: "Football", detail: "Every snap of the drive" },
      { source: "theater-soccer", title: "Soccer", detail: "Every shot, every angle" },
    ],
  },
  { name: "game-mlb", kind: "browser", source: "mlb@9600", caption: { title: "Pitch by *pitch*.", subtitle: "The count, the runners, the strike zone and every ball in play." } },
  { name: "game-nfl", kind: "browser", source: "nfl@4800", caption: { title: "Snap by *snap*.", subtitle: "The drive on the field, down and distance, and win probability." } },
  { name: "game-soccer", kind: "browser", source: "soccer@13500", caption: { title: "Every chance, *mapped*.", subtitle: "The live pitch, the shot map and the match timeline." } },
  { name: "game-nba", kind: "browser", source: "nba", caption: { title: "Every shot, *charted*.", subtitle: "The shot chart, the game's flow, leaders and the box score." } },
  { name: "esports", kind: "browser", source: "cs2", caption: { title: "Round by *round*.", subtitle: "S-tier Counter-Strike 2: every map, round and economy swing." } },
  { name: "climbing", kind: "browser", source: "climbing", caption: { title: "Hold by *hold*.", subtitle: "The wall, every climber's high point and the live ranking." } },
  { name: "scores", kind: "browser", source: "scores-list", caption: { title: "Every game, one *glance* away.", subtitle: "Your leagues and teams, live, in a list or in tiles." } },
  { name: "tiles", kind: "browser", source: "scores-tiles", caption: { title: "The whole slate, *at once*.", subtitle: "Tiles show every live game's state without opening it." } },
  { name: "schedule", kind: "browser", source: "schedule", caption: { title: "What's on, and *when*.", subtitle: "Every league's schedule and results, by day, week or round." } },
  { name: "standings", kind: "browser", source: "standings", caption: { title: "The table, *live*.", subtitle: "Standings that move as the goals go in." } },
  { name: "bracket", kind: "browser", source: "bracket-cs2", caption: { title: "The road to the *title*.", subtitle: "Playoff brackets, from the postseason to S-tier CS2." } },
  { name: "team", kind: "browser", source: "team", caption: { title: "Know the *team*.", subtitle: "Results, form, the schedule, the roster and the leaders." } },
  { name: "player", kind: "browser", source: "player", caption: { title: "Know the *player*.", subtitle: "The season, the game log and the career." } },
  { name: "settings", kind: "browser", source: "settings", caption: { title: "Your leagues. Your *teams*.", subtitle: "Pick leagues, follow teams, choose alerts and celebrations." } },
  { name: "follow", kind: "browser", source: "scores-menu", caption: { title: "Follow your *teams*.", subtitle: "Right-click any game to follow a team or pin its score." } },
  {
    name: "phones",
    kind: "phones",
    caption: { title: "Also on the *web*.", subtitle: "Installs to your phone's home screen, with the same live pages." },
    phones: [{ source: "phone-scores" }, { source: "phone-mlb@10400" }],
  },
  // The Mac app (renders from the Mac pipeline; a placeholder panel until they exist).
  {
    name: "hero",
    kind: "mac",
    caption: { title: "Live scores in\nyour *menu bar*.", subtitle: "Every pitch, drive, shot and round, one click away." },
    spec: { titleSize: 104 },
    panels: [{ source: "game-mlb", label: "Scoreline for Mac" }],
  },
];

// MARK: - Every page, framed (the README's galleries; no captions baked in)

export const gallery = [
  { name: "scores", source: "scores-list", label: "Scores, beside a live game" },
  { name: "tiles", source: "scores-tiles", label: "Tiles" },
  { name: "game-menu", source: "scores-menu", label: "A game's menu: follow, pin, schedule" },
  { name: "mlb", source: "mlb@9600", label: "Baseball, live" },
  { name: "nfl", source: "nfl@4800", label: "NFL, live" },
  { name: "college-football", source: "cfb", label: "College football, with the conference table" },
  { name: "soccer", source: "soccer@13500", label: "Soccer, live" },
  { name: "nba", source: "nba", label: "NBA, live" },
  { name: "nba-charts", source: "nba-charts", label: "NBA: game flow and the box score" },
  { name: "cs2", source: "cs2", label: "Counter-Strike 2, live" },
  { name: "cs2-final", source: "cs2-final", label: "Counter-Strike 2, a finished series" },
  { name: "climbing", source: "climbing", label: "Climbing, live" },
  { name: "schedule", source: "schedule", label: "Schedule" },
  { name: "schedule-nfl", source: "schedule-nfl", label: "A league's schedule" },
  { name: "results", source: "results", label: "Results" },
  { name: "standings", source: "standings", label: "Standings" },
  { name: "standings-nba", source: "standings-nba", label: "NBA standings" },
  { name: "rankings", source: "rankings", label: "College football rankings" },
  { name: "bracket", source: "bracket-mlb", label: "The MLB postseason bracket" },
  { name: "bracket-cs2", source: "bracket-cs2", label: "A CS2 tournament's bracket" },
  { name: "tournaments", source: "tournaments", label: "CS2 tournaments" },
  { name: "climbing-season", source: "climbing-season", label: "The climbing season" },
  { name: "climbing-results", source: "climbing-results", label: "A climbing final's results" },
  { name: "team", source: "team", label: "A team page" },
  { name: "team-soccer", source: "team-soccer", label: "A club's page" },
  { name: "player", source: "player", label: "A player page" },
  { name: "player-soccer", source: "player-soccer", label: "A footballer's page" },
  { name: "settings", source: "settings", label: "Settings" },
  { name: "settings-keyboard", source: "settings-keyboard", label: "Settings: your sports and the keyboard" },
  { name: "settings-league", source: "settings-league", label: "A league: fixtures, results and teams to follow" },
  { name: "phone-scores", source: "phone-scores", device: "phone", label: "Scores on a phone" },
  { name: "phone-tiles", source: "phone-tiles", device: "phone", label: "Tiles on a phone" },
  { name: "phone-mlb", source: "phone-mlb@10400", device: "phone", label: "A live game on a phone" },
  { name: "phone-nfl", source: "phone-nfl", device: "phone", label: "Football on a phone" },
];

/** The Mac pipeline's framed images to carry into docs/screenshots/mac as they are (`from` is its output's name). */
export const macImports = [{ name: "hero", from: "hero" }];

/**
 * README images that appear only once their files exist (the Mac pipeline's), each between
 * `<!-- image:<key>:start -->` and `<!-- image:<key>:end -->`; until then the slot stays empty.
 */
export const readmeImages = [
  { key: "scoring-slide", dir: "docs/screenshots/mac", name: "scoring-slide", alt: "The scoring slide: a home run's bar sliding in from the scoring team's side, in its colors, with who and how far" },
];

/** The Mac renders to carry into docs/screenshots/mac/pages (by their file names in the Mac pipeline's output). */
export const macGallery = [];

/** GitHub's social preview. */
export const social = {
  source: "mlb@9600",
  tagline: "Live scores in your Mac's menu bar.\nEvery home run, basket, touchdown\nand goal, replayed in 3D.",
  tags: "MLB · NFL · NBA · Soccer · CS2 · Climbing",
};
