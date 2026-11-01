# Soccer competition fixtures

Recorded from ESPN on 2026-11-01. Public sports data, trimmed to fields the adapters exercise.

- `current-season.json`: `https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.league_cup/seasons/2026`
- `previous-season.json`: the same endpoint for 2025.
- `champions-season.json`: `https://sports.core.api.espn.com/v2/sports/soccer/leagues/uefa.champions/seasons/2026`
- `boards.json`: `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.league_cup/scoreboard?dates=2026&limit=1000`. Contains the end of the 2025 season and the beginning of 2026, intentionally exercising season filtering. Only the semifinals and final of the older season are present; this fixture does not claim to contain its full earlier rounds.
- Native `cup-goals.json`: the two regulation goals from the event `401921842` core plays endpoint, used to verify replay availability.
- Web `match-summary.json`: header and gameInfo from `soccer/eng.league_cup/summary?event=401921842`, used to check the competition-to-match-to-competition link.

The loader tests add an explicit `endDate` to exercise cross-calendar-year retrieval. The browser tests deliberately block team-logo requests and unrelated sports APIs for deterministic rendering.
