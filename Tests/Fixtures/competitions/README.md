# Competition fixtures

Recorded from ESPN on 2026-11-02, and shared by the native and web test suites. Real responses, trimmed to the fields the parsers read. Each season file is `{ info, season, board }`:

- `info`: `site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard`, the `leagues` entry.
- `season`: `sports.core.api.espn.com/v2/sports/soccer/leagues/{slug}/seasons/{year}`.
- `board`: the season's calendar years from `.../scoreboard?dates={year}&limit=1000`, filtered to the season.

Knockout rounds are complete. Long group and league phases keep only their first games (the first 18 or 40), which is enough for every check and keeps the files small.

| File | Why it's here |
| --- | --- |
| `carabao-2026` | In progress: quarterfinals drawn, semifinals and final not. |
| `carabao-2025`, `fa-cup-2025` | Whole cups, whose early rounds don't halve (byes, entries). |
| `fa-cup-2026` | Early rounds only: nothing of the tree is drawn yet. |
| `champions-2026`, `champions-2025` | League phase; byes into the Round of 16; two legs. |
| `mls-2025` | Conference playoffs split across stages, best-of-three, an All-Star game, `Combined`. |
| `libertadores-2026` | A group stage between knockout rounds, and a series winner flag that names the aggregate's loser. |
| `world-cup-2026` | Opens at a Round of 32 after groups; a third-place match. |
| `premier-league-2026` | A league: one stage, no knockout. |
| `liga-mx-2025` | Two tournaments in one season, each with its own final. |
| `carabao-seasons` | `.../seasons?limit=8`. |
| `summary-*` | A match's summary header: the competition it was played in, whichever path it was read through. |
| `cup-goals` | Current-form plays: Liverpool v Chelsea, Carabao Cup. |
| `legacy-plays` | Plays from before ESPN's mid-2026 change of coordinates (a long-range goal, a close one, a penalty). |
| `unlocated-plays` | Community Shield 2025: goals with no location at all. |
