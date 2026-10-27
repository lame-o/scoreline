/**
 * Long lists as an outline (OutlineList.swift): groups collapse to a header
 * and a line of crests, the way the scores list folds a league; a long list
 * with no natural groups shows its first dozen and "Show All N" in place.
 * The college standings, long schedules and team lists share it. The
 * decisions are pure, in `data/outline.ts`.
 *
 * Each group's open state is its own subscription (`useGroupFlag`), so
 * opening one group re-renders that group alone, never the page or its other
 * groups; collapsed groups never build their rows. A click plays the scores
 * list's choreography: the crests link between the preview and the rows,
 * the group opens on the next frame, the crests travel (shared layout), the
 * groups below glide, and the rows' text rises in. A keyboard toggle, a click
 * within 450ms of the last, or Reduce Motion is instant (a fade).
 *
 *     const outline = useOutline("standings:college-football", groups, mine);
 *     <OutlineGroup outline={outline} id="SEC">{(flag) => …}</OutlineGroup>
 */
import { m } from "motion/react";
import { memo, useMemo, useRef, useSyncExternalStore, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { crestID, disclosureMemory, startsExpanded } from "../../data/outline";
import { plural } from "../../data/format";
import { revealDelay, spring } from "../motion";
import { Icon } from "../icons";
import { TeamLogo } from "./TeamLogo";
import styles from "./Outline.module.css";

/** Toggles faster than this skip the show (DisclosureGroups.set). */
const RAPID_MS = 450;
/** How long a toggle's links (crest travel, stagger) last. */
const CHOREOGRAPHY_MS = 800;

/** One group's state. */
export interface GroupFlag {
  readonly open: boolean;
  /** A clicked toggle in progress: crests link between the preview and the rows. */
  readonly animating: boolean;
  /** An opening show in progress: the rows' text staggers in. */
  readonly revealing: boolean;
}

const CLOSED: GroupFlag = { open: false, animating: false, revealing: false };

type Listener = () => void;

/** A page's groups (and "Show All"s), with the toggle choreography. */
export class OutlineStore {
  scope = "";
  private flags = new Map<string, GroupFlag>();
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();
  private last = 0;
  private generation = 0;
  private playing: string | null = null;
  /** True while any group's show plays (the groups below glide). */
  animating = false;

  /** Each group's starting state: this session's choice, else open when it holds one of `mine`. */
  prepare(scope: string, groups: readonly { readonly id: string; readonly members: readonly string[] }[], mine: ReadonlySet<string>) {
    this.scope = scope;
    for (const g of groups) {
      if (this.flags.has(g.id)) continue;
      this.flags.set(g.id, { ...CLOSED, open: startsExpanded(disclosureMemory.choice(g.id, scope), g.members, mine) });
    }
  }

  flag(id: string): GroupFlag {
    let f = this.flags.get(id);
    if (!f) {
      f = { ...CLOSED, open: disclosureMemory.choice(id, this.scope) ?? false };
      this.flags.set(id, f);
    }
    return f;
  }

  /** The open groups (keyboard handlers read this without subscribing). */
  get expanded(): Set<string> {
    return new Set([...this.flags].filter(([, f]) => f.open).map(([id]) => id));
  }

  subscribe(id: string, listener: Listener): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  subscribeAll(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  private write(id: string, next: GroupFlag) {
    this.flags.set(id, next);
    this.listeners.get(id)?.forEach((l) => l());
  }

  private setAnimating(on: boolean) {
    if (this.animating === on) return;
    this.animating = on;
    this.globalListeners.forEach((l) => l());
  }

  toggle(id: string, viaKeyboard: boolean) {
    this.set(id, !this.flag(id).open, viaKeyboard);
  }

  set(id: string, open: boolean, viaKeyboard: boolean) {
    const flag = this.flag(id);
    if (flag.open === open) return;
    disclosureMemory.remember(open, id, this.scope);
    const now = performance.now();
    const rapid = now - this.last < RAPID_MS;
    this.last = now;
    const mine = ++this.generation;
    if (this.playing && this.playing !== id) this.write(this.playing, { ...this.flag(this.playing), animating: false, revealing: false });
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (viaKeyboard || rapid || reduce) {
      this.playing = null;
      this.setAnimating(false);
      this.write(id, { open, animating: false, revealing: false });
      return;
    }
    // Link the crests and turn layout tracking on first, so this frame
    // records where everything starts; open on the next frame.
    this.playing = id;
    this.setAnimating(true);
    this.write(id, { open: flag.open, animating: true, revealing: open });
    requestAnimationFrame(() => {
      if (this.generation !== mine) {
        this.write(id, { ...this.flag(id), open, animating: false, revealing: false });
        return;
      }
      this.write(id, { ...this.flag(id), open });
      window.setTimeout(() => {
        if (this.playing !== id || this.generation !== mine) return;
        this.playing = null;
        this.write(id, { ...this.flag(id), animating: false, revealing: false });
        this.setAnimating(false);
      }, CHOREOGRAPHY_MS);
    });
  }

  /** A long list's "Show All", remembered like a group; from a key at once. */
  showAll(id: string) {
    const flag = this.flag(id);
    if (flag.open) return;
    disclosureMemory.remember(true, id, this.scope);
    this.write(id, { open: true, animating: false, revealing: false });
  }
}

/** A page's outline, prepared with its groups (a new scope is a new outline). */
export function useOutline(scope: string, groups: readonly { readonly id: string; readonly members: readonly string[] }[], mine: ReadonlySet<string>): OutlineStore {
  const ref = useRef<OutlineStore | null>(null);
  if (!ref.current || ref.current.scope !== scope) ref.current = new OutlineStore();
  const store = ref.current;
  // Groups that arrive later (a page loading) get their defaults as they appear.
  useMemo(() => store.prepare(scope, groups, mine), [store, scope, groups, mine]);
  return store;
}

/** One group's flag; re-renders only when this group changes. */
export function useGroupFlag(store: OutlineStore, id: string): GroupFlag {
  return useSyncExternalStore(
    (l) => store.subscribe(id, l),
    () => store.flag(id),
    () => store.flag(id),
  );
}

/** Whether any group's show is playing (the groups below glide while it does). */
export function useOutlineAnimating(store: OutlineStore): boolean {
  return useSyncExternalStore(
    (l) => store.subscribeAll(l),
    () => store.animating,
    () => false,
  );
}

// MARK: - Views

export interface DisclosureHeaderProps {
  readonly title: string;
  readonly count: number;
  /** What the count counts, spoken: "team" → "16 teams". */
  readonly noun?: string;
  readonly showsCount?: boolean;
  readonly open: boolean;
  /** The keyboard highlight (accent). */
  readonly highlighted?: boolean;
  /** Spoken after "collapsed" ("leader Oregon, 8–0"). */
  readonly spokenPreview?: string;
  /** Set while a click toggles it (the chevron eases); otherwise instant. */
  readonly animated?: boolean;
  readonly controls?: string;
  readonly onToggle: (viaKeyboard: boolean) => void;
  /** The collapsed preview line (a `CrestStrip`, or a leader line). */
  readonly preview?: ReactNode;
  /** The highlight's key, for arrow-key scrolling. */
  readonly navKey?: string;
}

/**
 * A group's header in the scores list's idiom: its name and how many it
 * holds ("SEC · 16"), the chevron at the trailing edge, and while collapsed,
 * the preview under it. The whole header is the button, inside an `h2`.
 */
export const DisclosureHeader = memo(function DisclosureHeader({
  title,
  count,
  noun = "team",
  showsCount = true,
  open,
  highlighted = false,
  spokenPreview,
  animated = false,
  controls,
  onToggle,
  preview,
  navKey,
}: DisclosureHeaderProps) {
  const onClick = (event: MouseEvent) => onToggle(event.detail === 0);
  return (
    <h2 className={styles.heading}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={open}
        aria-controls={controls}
        aria-label={`${title}, ${plural(count, noun)}${!open && spokenPreview ? `, ${spokenPreview}` : ""}`}
        data-keyboard={highlighted}
        data-instant={!animated}
        data-nav-key={navKey}
        title={open ? `Hide ${title}` : `Show ${title}`}
        onClick={onClick}
      >
        <span className={styles.headerRow}>
          <span className={styles.title}>
            <span className={styles.titleText}>{title}</span>
            {showsCount ? <span className={styles.count}> · {count}</span> : null}
          </span>
          <Icon name="chevronRight" size={9} className={styles.chevron} />
        </span>
        {!open && preview ? <span className={styles.preview}>{preview}</span> : null}
      </button>
    </h2>
  );
});

export interface Crest {
  readonly id: string;
  readonly name: string;
  readonly logo: string | null;
}

/**
 * A collapsed group's line: its first crests in row order and a short note
 * at the trailing edge. No "N more": the header says how many. While the
 * group toggles by click, each crest shares an identity with its row's
 * (`OutlineCrest`), so it travels there.
 */
export function CrestStrip({ group, crests, note, linking = false, revealNote = false, max = 7 }: { group: string; crests: readonly Crest[]; note?: ReactNode; linking?: boolean; revealNote?: boolean; max?: number }) {
  return (
    <span className={styles.strip} aria-hidden="true">
      <span className={styles.crests}>
        {crests.slice(0, max).map((c) => (
          <OutlineCrest key={c.id} group={group} id={c.id} logo={c.logo} size={14} linking={linking} title={c.name} />
        ))}
      </span>
      {note != null ? <span className={[styles.note, revealNote ? styles.revealNote : null].filter(Boolean).join(" ")}>{note}</span> : null}
    </span>
  );
}

/** A crest that travels between a collapsed preview and its row while its group toggles. */
export function OutlineCrest({ group, id, logo, size, linking, title }: { group: string; id: string; logo: string | null; size: number; linking: boolean; title?: string }) {
  if (!linking) {
    return (
      <span className={styles.crest} title={title}>
        <TeamLogo url={logo} size={size} />
      </span>
    );
  }
  return (
    <m.span layoutId={crestID(group, id)} layout="position" transition={spring.travel} className={styles.crest} title={title}>
      <TeamLogo url={logo} size={size} />
    </m.span>
  );
}

/**
 * The inset box a group's rows sit in. `fadesIn`: a group opening by click;
 * the plate fades in under rows that arrive on their own (crests travel,
 * text staggers), so it never covers what's still sliding below it.
 */
export function OutlineBox({ fadesIn = false, children, className, id }: { fadesIn?: boolean; children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={[styles.box, fadesIn ? styles.boxFade : null, className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}

/** "Show All 38": the rest of a long flat list, in place. */
export function ShowAllButton({ count, onShowAll, highlighted = false, navKey, noun }: { count: number; onShowAll: (viaKeyboard: boolean) => void; highlighted?: boolean; navKey?: string; noun?: string }) {
  return (
    <button
      type="button"
      className={styles.showAll}
      data-keyboard={highlighted}
      data-nav-key={navKey}
      onClick={(e) => onShowAll(e.detail === 0)}
      aria-label={noun ? `Show all ${plural(count, noun)}` : `Show all ${count}`}
    >
      Show All {count}
      <Icon name="chevronDown" size={8} />
    </button>
  );
}

/**
 * A row's text arriving as its group opens by click: it rises 4pt as it
 * fades in, staggered 40ms per row and capped at four (View.reveal). Spread
 * onto the row's text, never its crest (the crest travels).
 */
export function outlineReveal(index: number, revealing: boolean): { className?: string; style?: CSSProperties } {
  if (!revealing) return {};
  return { className: styles.reveal, style: { animationDelay: `${revealDelay(index)}s` } };
}

/**
 * A wrapper that glides when a group above it opens or closes (the layout
 * spring), only while a show plays: layout tracking costs a measurement.
 */
export function OutlineGlide({ outline, children, className, as = "div", ...rest }: { outline: OutlineStore; children: ReactNode; className?: string; as?: "div" | "section"; "aria-label"?: string; id?: string }) {
  const animating = useOutlineAnimating(outline);
  const Tag = as === "section" ? m.section : m.div;
  return (
    <Tag layout={animating ? "position" : false} transition={spring.standard} className={className} {...rest}>
      {children}
    </Tag>
  );
}
