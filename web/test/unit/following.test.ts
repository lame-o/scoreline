import { beforeEach, describe, expect, it } from "vitest";
import { alertsFor, editionID, inclusionReasons, matchesEdition, pollingIDs, sanitizeEditions, type EditionFollow } from "../../src/data/following";
import { competitionKind, hasTable, leagueWithID } from "../../src/data/leagues";
import { competitors, type ScoreEvent } from "../../src/data/models";
import { computeSections, filtered, liveCount, allFailed } from "../../src/data/scoreboard";
import { DEFAULTS, getSettings, sanitize, settings } from "../../src/state/settings";
import { espnTeamID } from "../../src/data/teams";
import { teamSource } from "../../src/data/providers/schedule";
import { parseBoards } from "../../src/data/providers/espn";
import { fixture } from "./fixtures";

const league = leagueWithID("eng.1")!;
const board = parseBoards([fixture("espn-eng1-scoreboard.json")], "soccer/eng.1", "soccer", Date.parse("2026-11-01T12:00:00Z"));
const sample = board[0]!;
const team = {id:competitors(sample)[0]!.id!, name:competitors(sample)[0]!.name, logo:null};
const now = Date.parse("2026-11-01T12:00:00Z");
const cup: ScoreEvent = {...sample, id:"cup", state:"live", start:now, ref:{kind:"espn", path:"soccer/eng.league_cup", id:"cup", sport:"soccer"}};
const cs: ScoreEvent = {...sample, id:"cs-1", state:"live", start:now, ref:{kind:"counterStrike",slug:"match-one",tournament:"major-2026"}};
const edition: EditionFollow = {source:"cs2",key:"major-2026",name:"Major 2026"};
const ids = (s: ReturnType<typeof computeSections>) => s.flatMap(x => x.events.map(e => e.id));

describe("explicit following policy", () => {
  beforeEach(() => settings.reset());
  it("does not expand a league follow to its teams' other competitions", () => {
    const p = {...DEFAULTS,enabledLeagues:["eng.1"]};
    expect(ids(computeSections({"eng.league_cup":{events:[cup],failed:false}},p,now))).not.toContain("cup");
  });
  it("includes a global team's cup fixture once when a cup follow overlaps", () => {
    const p = {...DEFAULTS,enabledLeagues:["eng.league_cup"],followed:[team]};
    expect(ids(computeSections({"eng.league_cup":{events:[cup],failed:false}},p,now))).toEqual(["cup"]);
    const off = {...p,enabledLeagues:[]};
    expect(ids(computeSections({},off,now,new Map([[team.id,[{event:cup,league:"eng.league_cup"}]]])))).toEqual(["cup"]);
    expect(liveCount({"eng.league_cup":{events:[cup],failed:false}},off)).toBe(1);
    expect(allFailed({"eng.league_cup":{events:[],failed:true}},off)).toBe(true);
    expect(inclusionReasons(cup,off)).toEqual([`Following ${team.name} · All competitions`]);
  });
  it("keeps scoped picks local and an intentionally empty selection empty", () => {
    const p = {...DEFAULTS,filteredLeagues:["eng.1"],teamFilters:{"eng.1":[]}};
    expect(filtered([sample],league,p)).toEqual([]);
    expect(filtered([sample],league,{...p,teamFilters:{"eng.1":[team.id]}})).toEqual([sample]);
    expect(p.followed).toEqual([]);
  });
  it("follows exactly one edition without enabling its whole game", () => {
    const p = {...DEFAULTS,enabledLeagues:[],editions:[edition]};
    const other = {...cs,id:"cs-2",ref:{kind:"counterStrike" as const,slug:"match-two",tournament:"other-major"}};
    expect(pollingIDs(p)).toEqual(["cs2"]);
    const results = {cs2:{events:[cs,other],failed:false}};
    expect(ids(computeSections(results,p,now))).toEqual(["cs-1"]);
    expect(liveCount(results,p)).toBe(1);
    expect(allFailed({cs2:{events:[],failed:true}},p)).toBe(true);
    settings.toggleEdition(edition);
    settings.toggleEdition(edition);
    expect(getSettings().editions).toEqual([]);
  });
  it("deduplicates a tournament follow overlapping its parent game", () => {
    const p = {...DEFAULTS,enabledLeagues:["cs2"],editions:[edition]};
    expect(ids(computeSections({cs2:{events:[cs],failed:false}},p,now))).toEqual(["cs-1"]);
  });
  it("uses the climbing event identity, not a city name or category", () => {
    const e: ScoreEvent = {...sample,ref:{kind:"climbing",eventID:1489,eventName:"Santiago",category:"Lead Women",resultURL:null,round:null,nextURL:null}};
    expect(matchesEdition(e,{source:"ifsc",key:"1489",name:"Santiago"})).toBe(true);
    expect(matchesEdition(e,{source:"ifsc",key:"1490",name:"Santiago"})).toBe(false);
  });
  it("respects disciplines when following a climbing event", () => {
    const e: ScoreEvent = {...sample,id:"lead",state:"live",start:now,ref:{kind:"climbing",eventID:1489,eventName:"Santiago",category:"Lead Women",resultURL:null,round:null,nextURL:null}};
    const p = {...DEFAULTS,enabledLeagues:[],editions:[{source:"ifsc" as const,key:"1489",name:"Santiago"}],climbingDisciplines:["boulder" as const]};
    const results = {ifsc:{events:[e],failed:false}};
    expect(ids(computeSections(results,p,now))).toEqual([]);
    expect(liveCount(results,p)).toBe(0);
  });
  it("a new team follow alerts until its bell says otherwise", () => {
    settings.toggleFollow(team);
    expect(alertsFor(cup,getSettings())).toBe(true);
    settings.setTeamAlerts(team.id,false);
    expect(alertsFor(cup,getSettings())).toBe(false);
    settings.setTeamAlerts(team.id,true);
    expect(alertsFor(cup,getSettings())).toBe(true);
    settings.set("notifyFollowed",false);
    expect(alertsFor(cup,getSettings())).toBe(false);
    expect(getSettings().followed).toEqual([team]);
    settings.unfollow(team.id);
    expect(getSettings().mutedTeams).toEqual([]);
  });
  it("polls a followed team's board with no competition subscriptions", () => {
    expect(pollingIDs({...DEFAULTS,enabledLeagues:[],followed:[{...team,id:"espn-football-12"}]})).toEqual(["nfl"]);
  });
});

describe("backward-compatible preferences and supported catalog", () => {
  it("preserves scoped picks, ordering, appearance and existing alerts", () => {
    const legacy = {enabledLeagues:["nfl","eng.1"],filteredLeagues:["eng.1","nba"],teamFilters:{"eng.1":[team.id],nba:[]},followed:[team],notifyFollowed:true,theme:"dark"};
    const p = sanitize(legacy);
    expect(p.enabledLeagues).toEqual(legacy.enabledLeagues);
    expect(p.filteredLeagues).toEqual(["eng.1"]);
    expect(p.teamFilters["eng.1"]).toEqual([team.id]);
    expect(p.followed).toEqual([team]);
    expect(p.theme).toBe("dark");
    expect(alertsFor(cup,p)).toBe(true);
    expect(sanitize(p)).toEqual(p);
  });
  it("retains an empty selection after v2 and preserves hidden picks", () => {
    const p = sanitize({...DEFAULTS,enabledLeagues:[],filteredLeagues:["eng.1"],teamFilters:{"eng.1":[]}});
    expect(p.filteredLeagues).toEqual(["eng.1"]);
    expect(p.enabledLeagues).toEqual([]);
  });
  it("validates and deduplicates edition identities without trusting storage", () => {
    expect(sanitizeEditions([edition,edition,{...edition,key:"../../other"},{...edition,source:"other"},null,{source:"ifsc",key:"NaN",name:"x"}])).toEqual([edition]);
    expect(editionID(edition)).toBe("cs2:major-2026");
  });
  it("separates WNBA and NBA team IDs and migrates scoped WNBA picks", () => {
    const id = espnTeamID("basketball/wnba","basketball","3");
    expect(id).toBe("espn-wnba-3");
    expect(id).not.toBe(espnTeamID("basketball/nba","basketball","3"));
    expect(teamSource(id)?.path).toBe("basketball/wnba");
    expect(sanitize({teamFilters:{wnba:["espn-basketball-3"]},filteredLeagues:["wnba"]}).teamFilters.wnba).toEqual([id]);
  });
  it("distinguishes a game, series, cup and league without offering unsupported tables", () => {
    expect(competitionKind(leagueWithID("cs2")!)).toContain("Game");
    expect(competitionKind(leagueWithID("ifsc")!)).toContain("Series");
    expect(competitionKind(leagueWithID("eng.league_cup")!)).toBe("Cup");
    expect(competitionKind(league)).toBe("League");
    expect(hasTable(leagueWithID("eng.league_cup")!)).toBe(false);
    expect(hasTable(leagueWithID("nba")!)).toBe(true);
  });
});
