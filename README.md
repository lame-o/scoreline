<p align="center"><img src="docs/icon.png" width="128" alt="Scoreline icon"></p>

<h1 align="center">Scoreline</h1>

**Live scores in your Mac's menu bar.** Every pitch, drive, shot and round as it happens, one click away, without a browser tab or a phone.

Scoreline is a free, open-source menu bar app for macOS. Pick your leagues and teams once; the scores sit in the menu bar, and a click opens the full live game.

![macOS 15+](https://img.shields.io/badge/macOS-15%2B-black) ![Apple silicon and Intel](https://img.shields.io/badge/Apple%20silicon%20%2B%20Intel-universal-black) ![MIT license](https://img.shields.io/badge/license-MIT-black)

## What's in it

**Live game pages, built for each sport**
- **Baseball**: count, runners (hover a base to see who's on), the at-bat pitch by pitch in the strike zone, a spray chart of every ball in play, and the line score.
- **Football**: the field with the current drive, down and distance, red zone and two-minute drill, scoring plays and win probability.
- **Basketball**: shot chart, scoring runs, leaders and the full box score.
- **Soccer**: shot map, live pitch, match timeline and key events.
- **Counter-Strike 2**: maps, rounds and economy.
- **Climbing**: the wall with every climber's high point, live rankings and boulder scorecards.

**Everything around the game**
- Schedules and results for every league, with standings, playoff brackets, team pages and player profiles.
- Big moments land with a little celebration (home runs, touchdowns, goals); turn it down or off any time.
- Notifications for your teams, and official "Where to Watch" for each game.
- List or tile layouts, a pinned scorebar for the game you're following, and full keyboard navigation.

**Leagues**: Premier League, Champions League, Europa League, LaLiga, Serie A, Bundesliga, Ligue 1, Championship, MLS, FIFA World Cup, NFL, College Football, MLB, NBA, WNBA, Counter-Strike 2 (S-tier events) and the World Climbing Series.

## Install

Paste this into Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/lame-o/scoreline/main/install.sh | bash
```

It downloads the latest release into Applications and opens it ([read the script](install.sh) first if you like).

Or download `Scoreline.dmg` from [Releases](https://github.com/lame-o/scoreline/releases/latest), open it and drag Scoreline to Applications. Scoreline isn't signed with a paid Apple Developer ID, so the first time you open a downloaded copy macOS says it can't verify the developer: go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. You only do this once.

After that, Scoreline keeps itself up to date (Settings → Updates).

Requires macOS 15 Sequoia or later, on Apple silicon or Intel.

## Privacy

No account, no analytics, no tracking. Scoreline only talks to the public sports data feeds it shows you, and your teams and settings stay on your Mac.

## Build from source

Scoreline builds with the Xcode Command Line Tools alone (no Xcode project, no packages):

```sh
xcode-select --install   # if you don't have the Command Line Tools
./build.sh --install     # builds Scoreline.app, copies it to /Applications and launches it
./test.sh                # the offline test suite (recorded API responses, no network)
```

`./build.sh --universal` builds for both Apple silicon and Intel.

## Data and disclaimer

Scores and stats come from public feeds by ESPN, MLB (Statcast, via statsapi.mlb.com), bo3.gg and World Climbing (IFSC), among others. Scoreline is an independent project, not affiliated with or endorsed by any league, team, broadcaster or data provider. Team names and logos belong to their owners. Those feeds aren't official APIs and can change without notice; if something breaks, please [open an issue](https://github.com/lame-o/scoreline/issues).

## License

[MIT](LICENSE)
