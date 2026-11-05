/** Team directory and competition selections share the existing keyboard outline.
 * `global` follows a team across competitions; `scoped` changes only this
 * competition's picks. A row always has one meaning and one action. */
import { useNavigate } from "react-router";
import { isSupportedTeam, teamRef } from "../../data/profiles/models";
import { TeamLink, teamHref } from "../profiles/ProfileLinks";
import { FollowStar } from "./FollowStar";
import { toggleTeam } from "./followTeam";
import { useQuery } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  Button,
  CrestStrip,
  DisclosureHeader,
  ErrorCopy,
  FormSection,
  GroupBox,
  Icon,
  OutlineCrest,
  OutlineGlide,
  ShowAllButton,
  Skeleton,
  TeamLogo,
  formStyles,
  outlineReveal,
  useGroupFlag,
  useOutline,
  type OutlineStore,
} from "../../design/components";
import { getJSON } from "../../data/http";
import type { League } from "../../data/models";
import { discloseLeft, discloseRight, OUTLINE_PREVIEW, parseStop, step, stopKey, stops, visibleCount, type Stop } from "../../data/outline";
import { pickOutline, pickSections, type PickSection } from "../../data/pickOutline";
import { teamOptions, type TeamOption } from "../../data/providers/teams";
import { useGoBack } from "../../app/navigation";
import { hasFailed, retrying } from "../../state/retry";
import { settings, useSettings } from "../../state/settings";
import styles from "./Settings.module.css";

/** Past this many teams, a search field leads the list. */
const SEARCH_FROM = 12;

interface Highlight {
  readonly key: string | null;
  /** Moved by the keys: it wears the accent. */
  readonly keyboard: boolean;
}

/**
 * One list of a competition's teams, with one meaning (LeagueSettingsView, 34ba1dd): the star
 * follows a team everywhere it plays; while `picking` (Selected Teams, or climbing's countries)
 * a click picks it, a checkmark, for this competition alone; otherwise the row opens the team.
 */
export function TeamPicks({ league, picking = true }: { league: League; picking?: boolean }) {
  const mode: "scoped" | "global" = picking ? "scoped" : "global";
  const climbing = league.source.kind === "ifsc";
  const noun = climbing ? "Countries" : "Teams";
  const scopedPicks = useSettings((s) => s.teamFilters[league.id]) ?? EMPTY;
  const followedTeams = useSettings((s) => s.followed);
  const followed = useMemo(() => followedTeams.map((t) => t.id), [followedTeams]);
  const picks = scopedPicks;
  const goBack = useGoBack();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ["teams", league.id],
    queryFn: ({ signal }) => teamOptions(league, getJSON, signal),
    staleTime: 6 * 3_600_000,
    ...retrying(),
  });
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState<Highlight>({ key: null, keyboard: false });
  const options = query.data ?? EMPTY_OPTIONS;
  // The picks as of opening: rows don't jump between groups while you click.
  const initial = useRef<ReadonlySet<string> | null>(null);
  if (initial.current == null && query.data) initial.current = new Set(picks);
  const sections = useMemo(() => pickSections(options, search, initial.current ?? EMPTY_SET, noun), [options, search, noun]);
  const groups = useMemo(() => sections.filter((s) => s.kind === "disclosure").map((s) => ({ id: s.id, members: s.options.map((o) => o.id) })), [sections]);
  const mine = useMemo(() => new Set([...picks, ...followed]), [picks, followed]);
  const outline = useOutline(`picks.${league.id}`, groups, mine);
  const root = useRef<HTMLDivElement>(null);

  // Typing narrows the list; the first match is ready for Return.
  const searched = useRef(search);
  useEffect(() => {
    if (searched.current === search) return;
    searched.current = search;
    const first = stops(pickOutline(sections), outline.expanded, outline.expanded)[0];
    setHighlight({ key: search.trim() && first ? stopKey(first) : null, keyboard: true });
  }, [search, sections, outline]);

  const moveTo = (stop: Stop, keepFocus: boolean) => {
    const key = stopKey(stop);
    setHighlight({ key, keyboard: true });
    requestAnimationFrame(() => {
      const el = root.current?.querySelector<HTMLElement>(`[data-nav-key="${CSS.escape(key)}"]`);
      el?.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
      if (!keepFocus) el?.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const inSearch = (event.target as HTMLElement).tagName === "INPUT";
    const outlineSections = pickOutline(sections);
    const expanded = outline.expanded;
    const current = parseStop(highlight.key);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const next = step(current, event.key === "ArrowDown" ? 1 : -1, stops(outlineSections, expanded, expanded));
        if (!next) return;
        event.preventDefault();
        moveTo(next, inSearch);
        return;
      }
      case "ArrowRight":
      case "ArrowLeft": {
        // While typing they move the caret.
        if (inSearch && search) return;
        const action = event.key === "ArrowRight" ? discloseRight(current, outlineSections, expanded) : discloseLeft(current, outlineSections, expanded);
        if (!action) return;
        event.preventDefault();
        if (action.kind === "highlight") moveTo(action.stop, inSearch);
        else outline.set(action.id, action.kind === "expand", true);
        return;
      }
      case "Enter": {
        if (!current) return;
        event.preventDefault();
        if (current.kind === "row") {
          const team = options.find(o => o.id === current.item);
          if (mode === "scoped") settings.togglePick(league.id, current.item);
          else if (team) {
            // Not picking: Return opens the team, as a click does.
            const ref = teamRef({ id: team.id, name: team.name, logo: team.logo, league: league.id });
            if (isSupportedTeam(ref)) navigate(teamHref(ref), { state: { team: ref } });
          }
        }
        else if (current.kind === "header") outline.toggle(current.section, true);
        else {
          // Show All: the highlight moves on to the first row it revealed.
          outline.showAll(current.section);
          const revealed = sections.find((s) => s.id === current.section)?.options[OUTLINE_PREVIEW];
          if (revealed) moveTo({ kind: "row", section: current.section, item: revealed.id }, inSearch);
        }
        return;
      }
      case "Escape":
        if (!inSearch) return;
        // Esc first clears a search, like any macOS search field; then it's Back.
        event.preventDefault();
        event.stopPropagation();
        if (search) setSearch("");
        else goBack(true);
        return;
    }
  };

  return (
    <FormSection title={noun} icon={climbing ? "flag" : "star"}>
      <div
        ref={root}
        onKeyDown={onKeyDown}
        onPointerMove={() => highlight.keyboard && setHighlight((h) => ({ ...h, keyboard: false }))}
      >
        {options.length > SEARCH_FROM ? (
          <label className={styles.search}>
            <Icon name="search" size={11} />
            <span className="visually-hidden">Search {noun.toLowerCase()}</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${noun.toLowerCase()}`}
              autoComplete="off"
              aria-controls={`picks-${league.id}`}
              aria-activedescendant={undefined}
            />
          </label>
        ) : null}
        <div id={`picks-${league.id}`}>
          {hasFailed(query) ? (
            <p className={formStyles.caption}>
              {ErrorCopy.inline(noun.toLowerCase())}{" "}
              <Button onClick={() => void query.refetch()} style={{ marginLeft: "calc(6 * var(--pt))" }}>
                {ErrorCopy.retry}
              </Button>
            </p>
          ) : query.isPending ? (
            <PickSkeleton noun={noun} />
          ) : sections.length === 0 ? (
            <p className={styles.noMatches}>{search.trim() ? `No ${noun.toLowerCase()} match “${search.trim()}”` : `No ${noun.toLowerCase()}`}</p>
          ) : (
            sections.map((section) => {
              const lit = highlight.keyboard && highlight.key != null && parseStop(highlight.key)?.section === section.id ? highlight.key : null;
              const props = { section, league, mode, picks, followed, lit, outline, titled: sections.length > 1 || section.kind === "capped" };
              return section.kind === "disclosure" ? <GroupSection key={section.id} {...props} /> : <PlainSection key={section.id} {...props} />;
            })
          )}
        </div>
      </div>
    </FormSection>
  );
}

const EMPTY: readonly string[] = [];
const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_OPTIONS: readonly TeamOption[] = [];

interface SectionProps {
  readonly section: PickSection;
  readonly league: League;
  readonly mode: "scoped" | "global";
  readonly picks: readonly string[];
  readonly followed: readonly string[];
  /** The keyboard highlight's key, when it's in this section. */
  readonly lit: string | null;
  readonly outline: OutlineStore;
  readonly titled: boolean;
}

/** "Selected", a short list, search results, or a long list's first dozen and "Show All". */
const PlainSection = memo(function PlainSection({ section, league, mode, picks, followed, lit, outline, titled }: SectionProps) {
  const flag = useGroupFlag(outline, section.id);
  const shown = section.kind === "capped" ? visibleCount(section.options.length, flag.open) : section.options.length;
  const moreKey = stopKey({ kind: "more", section: section.id });
  return (
    <OutlineGlide outline={outline} as="section" aria-label={section.title}>
      {titled ? <p className={styles.conference}>{section.title}</p> : <div style={{ height: "calc(8 * var(--pt))" }} />}
      <GroupBox>
        {section.options.slice(0, shown).map((o) => (
          <PickRow key={o.id} option={o} league={league} mode={mode} section={section.id} picked={picks.includes(o.id)} following={followed.includes(o.id)} lit={lit} />
        ))}
      </GroupBox>
      {shown < section.options.length ? (
        <div className={styles.showAll}>
          <ShowAllButton count={section.options.length} noun={league.source.kind === "ifsc" ? "country" : "team"} highlighted={lit === moreKey} navKey={moreKey} onShowAll={() => outline.showAll(section.id)} />
        </div>
      ) : null}
    </OutlineGlide>
  );
});

/** A conference: its header (folded: a line of crests and how many are picked), and open, its teams. */
const GroupSection = memo(function GroupSection({ section, league, mode, picks, followed, lit, outline }: SectionProps) {
  const flag = useGroupFlag(outline, section.id);
  const headerKey = stopKey({ kind: "header", section: section.id });
  const picked = section.options.filter((o) => picks.includes(o.id)).length;
  const id = `picks-${section.id.replace(/\W+/g, "-")}`;
  return (
    <OutlineGlide outline={outline} as="section" aria-label={section.title}>
      <DisclosureHeader
        title={section.title}
        count={section.options.length}
        open={flag.open}
        animated={flag.animating}
        controls={id}
        highlighted={lit === headerKey}
        navKey={headerKey}
        spokenPreview={picked > 0 ? `${picked} selected` : undefined}
        onToggle={(viaKeyboard) => outline.toggle(section.id, viaKeyboard)}
        preview={
          <CrestStrip
            group={section.id}
            crests={section.options.map((o) => ({ id: o.id, name: o.name, logo: o.logo }))}
            note={picked > 0 ? `${picked} selected` : undefined}
            linking={flag.animating}
            revealNote={flag.animating}
          />
        }
      />
      {flag.open ? (
        <div id={id}>
          <GroupBox>
            {section.options.map((o, i) => (
              <PickRow key={o.id} option={o} league={league} mode={mode} section={section.id} picked={picks.includes(o.id)} following={followed.includes(o.id)} lit={lit} reveal={flag.revealing ? i : null} crestGroup={flag.animating ? section.id : null} />
            ))}
          </GroupBox>
        </div>
      ) : null}
    </OutlineGlide>
  );
});

interface PickRowProps {
  readonly option: TeamOption;
  readonly league: League;
  readonly mode: "scoped" | "global";
  readonly section: string;
  readonly picked: boolean;
  readonly following: boolean;
  readonly lit: string | null;
  /** Arriving as its group opens by click: the text rises in (its stagger index). */
  readonly reveal?: number | null;
  /** While its group toggles by click: the crest travels from the preview. */
  readonly crestGroup?: string | null;
}

const PickRow = memo(
  function PickRow({ option, league, mode, section, picked, following, lit, reveal = null, crestGroup = null }: PickRowProps) {
    const key = stopKey({ kind: "row", section, item: option.id });
    const text = outlineReveal(reveal ?? 0, reveal != null);
    const crest = option.flag ? (
      <span className={styles.flag}>{option.flag}</span>
    ) : crestGroup ? (
      <OutlineCrest group={crestGroup} id={option.id} logo={option.logo} size={16} linking />
    ) : (
      <TeamLogo url={option.logo} size={16} />
    );
    const name = (
      <span className={[styles.teamName, text.className].filter(Boolean).join(" ")} style={text.style}>
        {option.name}
      </span>
    );
    // Climbing's countries are picked, never followed.
    const followable = league.source.kind !== "ifsc";
    return (
      <div className={styles.teamRow} style={{ paddingLeft: 0 }}>
        {mode === "scoped" ? (
          <button type="button" className={styles.pick} role="checkbox" aria-checked={picked} data-nav-key={key} data-keyboard={lit === key} onClick={() => settings.togglePick(league.id, option.id)}>
            <span className={styles.check}>{picked ? <Icon name="check" size={11} /> : null}</span>
            {crest}
            {name}
          </button>
        ) : (
          <TeamLink team={teamRef({ id: option.id, name: option.name, logo: option.logo, league: league.id })} className={styles.pick} data-nav-key={key} data-keyboard={lit === key}>
            {crest}
            {name}
          </TeamLink>
        )}
        {followable ? <FollowStar following={following} name={option.name} help={`Follow ${option.name}: first on the scores list, in every competition, with alerts`} onToggle={() => toggleTeam(option)} /> : null}
      </div>
    );
  },
  // A row redraws when what it shows changes, or the highlight lands on it or leaves it.
  (a, b) => {
    const key = stopKey({ kind: "row", section: a.section, item: a.option.id });
    return a.mode === b.mode && a.option === b.option && a.picked === b.picked && a.following === b.following && a.reveal === b.reveal && a.crestGroup === b.crestGroup && (a.lit === key) === (b.lit === key);
  },
);

/** Six rows shaped like the list's while it loads (PickListSkeleton). Static. */
function PickSkeleton({ noun }: { noun: string }) {
  return (
    <GroupBox>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={styles.skeletonRow} role={i === 0 ? "status" : undefined} aria-label={i === 0 ? `Loading ${noun.toLowerCase()}` : undefined}>
          <Skeleton circle width={16} height={16} />
          <Skeleton width={[120, 96, 140, 108, 84, 128][i]!} height={9} />
        </div>
      ))}
    </GroupBox>
  );
}
