import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const out = process.env.SCORELINE_SCREENSHOTS ?? "test-results/screenshots";
mkdirSync(out,{recursive:true});
for (const size of [{width:390,height:844,colorScheme:"dark" as const},{width:1280,height:900,colorScheme:"light" as const}]) {
  test.describe(`Following ${size.width}`, () => {
    test.use({viewport:size,colorScheme:size.colorScheme,reducedMotion:"reduce"});
    test("browse, scoped selections, team follows, alerts and persistence", async ({page}) => {
      const errors:string[]=[];
      page.on("pageerror",e=>errors.push(e.message));
      await page.addInitScript(() => {
        if (!localStorage.getItem("scoreline.settings.v1")) localStorage.setItem("scoreline.settings.v1",JSON.stringify({enabledLeagues:["eng.1"], theme:"system", filteredLeagues:["nba"], teamFilters:{nba:[]},followed:[]}));
      });
      await page.route("**/*",route=>{
        const u=route.request().url();
        if (u.includes("/api/") || u.includes("sports.core.api.espn.com")) {
          if (u.includes("/teams?")) return route.fulfill({json:{sports:[{leagues:[{teams:[{team:{id:"364",displayName:"Liverpool",logos:[]}},{team:{id:"363",displayName:"Chelsea",logos:[]}}]}]}]}});
          return route.fulfill({json:{events:[],leagues:[],results:[],children:[]}});
        }
        if (!u.startsWith("http://127.0.0.1") && !u.startsWith("http://localhost")) return route.abort();
        return route.continue();
      });
      const read = () => page.evaluate(()=>JSON.parse(localStorage.getItem("scoreline.settings.v1")!));
      await page.goto("/sports");
      await expect(page.getByRole("heading",{name:"Sports",exact:true})).toBeVisible();
      await page.getByRole("combobox",{name:"Sport",exact:true}).selectOption("soccer");
      await page.screenshot({animations:"disabled",path:join(out,`sports-${size.width}.png`)});
      await page.getByRole("link",{name:/Carabao Cup/}).click();
      await expect(page.getByRole("heading",{name:"Carabao Cup",exact:true})).toBeVisible();
      const cupFollow=page.getByRole("switch",{name:"Follow Carabao Cup",exact:true});
      await expect(cupFollow).not.toBeChecked();
      await cupFollow.click();
      await expect(cupFollow).toBeChecked();
      await expect(page.getByRole("link",{name:"Season · Rounds and Results"})).toBeVisible();
      await page.getByRole("radio",{name:"Teams",exact:true}).click();
      await page.getByRole("checkbox",{name:"Liverpool",exact:true}).click();
      await page.getByRole("radio",{name:"Following",exact:true}).click();
      await page.getByRole("radio",{name:"Selected Teams",exact:true}).click();
      await page.getByRole("checkbox",{name:"Chelsea",exact:true}).click();
      await page.screenshot({animations:"disabled",path:join(out,`competition-scope-${size.width}.png`)});
      let stored=await read();
      expect(stored.followed.map((t:{id:string})=>t.id)).toEqual(["espn-soccer-364"]);
      expect(stored.teamFilters["eng.league_cup"]).toEqual(["espn-soccer-363"]);
      expect(stored.mutedTeams).toContain("espn-soccer-364");
      expect(stored.filteredLeagues).not.toContain("nba");
      await cupFollow.click();
      expect((await read()).followed).toHaveLength(1);
      await page.goto("/following");
      await expect(page.getByRole("heading",{name:"Following",exact:true})).toBeVisible();
      await page.getByRole("button",{name:"Enable alerts for Liverpool",exact:true}).click();
      stored=await read();
      expect(stored.mutedTeams).toEqual([]);
      await page.reload();
      await expect(page.getByRole("button",{name:"Mute alerts for Liverpool",exact:true})).toBeVisible();
      await page.screenshot({animations:"disabled",path:join(out,`following-${size.width}.png`)});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const accessibility=await new AxeBuilder({page}).include("main").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();
      expect(accessibility.violations).toEqual([]);
      await page.goto("/bracket/cs2/major-2026?name=Major%202026");
      await page.getByRole("button",{name:"Follow edition",exact:true}).click();
      expect((await read()).editions).toEqual([{source:"cs2",key:"major-2026",name:"Major 2026"}]);
      expect((await read()).enabledLeagues).not.toContain("cs2");
      await page.goto("/following");
      await expect(page.getByRole("link",{name:"Major 2026",exact:true})).toBeVisible();
      await page.getByRole("button",{name:"Unfollow Major 2026",exact:true}).click();
      expect((await read()).editions).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
