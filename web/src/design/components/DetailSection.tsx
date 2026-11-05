/**
 * DetailSection: a titled block (Visualizations.swift `DetailSection`), the
 * one the game pages and the team and player pages share: the small-caps
 * title with its state at the trailing edge (Live, Final, the live count
 * "2–2", or text) and trailing controls, a caption of one or two lines
 * saying what the block shows and where it comes from, then the content.
 *
 * - `id` (game pages): the section's name in the page plan; it sets
 *   `data-section`, which the page's geometry reads (the docked bar), and
 *   names the title `section-<id>`.
 * - `spokenCaption`: the caption in words, when the visible one leans on
 *   glyphs or short names ("MIL attacks →").
 * - `layout`: "stack" (the game page: 8pt between blocks) or "flow" (the
 *   profile pages, whose content spaces itself).
 * - `glance`: what the block says in one line when folded, over the page's
 *   own (the odds chart's prices).
 *
 * On a game page each block is a module (PageModules.swift `ModuleChrome`,
 * read from the environment there, from `SectionChromeContext` here): the
 * page provides a chrome that draws the header as a disclosure and folds the
 * content away. Elsewhere sections are plain.
 *
 * Each section is a size container (`@container section`), so its content
 * adds detail by the room it has (the Mac's width classes).
 *
 *     <DetailSection id="atBat" title="This At-Bat" accessory={{ count: [2, 2] }}>…</DetailSection>
 *     <DetailSection title="Roster" caption="…" trailing={toggle} layout="flow">…</DetailSection>
 */
import { createContext, useContext, useId, type ReactNode } from "react";
import { SectionTitle, type SectionTitleProps } from "./SectionTitle";
import styles from "./DetailSection.module.css";

export interface DetailSectionProps {
  readonly id?: string;
  readonly title: string;
  readonly caption?: string | null;
  readonly spokenCaption?: string;
  readonly accessory?: SectionTitleProps["accessory"];
  readonly trailing?: ReactNode;
  readonly layout?: "stack" | "flow";
  readonly className?: string;
  /** Folded on a game page: the block's own line (over the page's glance for it). */
  readonly glance?: unknown;
  readonly children: ReactNode;
}

/** What a module's header is drawn from. */
export interface SectionHead {
  readonly titleID: string;
  readonly contentID: string;
  readonly title: string;
  readonly caption: string | null;
  readonly spokenCaption: string | null;
  readonly accessory: SectionTitleProps["accessory"] | undefined;
  readonly trailing: ReactNode;
  readonly glance: unknown;
}

/** A block as a game page's module: its header, and whether its content is folded away. */
export interface SectionChrome {
  readonly folded: boolean;
  /** Folded, the content stays (laid out, unseen, out of the focus order): the Live View's theater keeps its running order. */
  readonly keepsAlive: boolean;
  /** Opening, the content rises in (a click); a key or Reduce Motion: none. */
  readonly reveals: boolean;
  readonly header: (head: SectionHead) => ReactNode;
}

export const SectionChromeContext = createContext<SectionChrome | null>(null);

export function DetailSection({ id, title, caption, spokenCaption, accessory, trailing, layout = "stack", className, glance, children }: DetailSectionProps) {
  const generated = useId();
  const chrome = useContext(SectionChromeContext);
  const titleID = id ? `section-${id}` : `section-${generated}`;
  const contentID = `${titleID}-content`;
  if (chrome) {
    return (
      <section className={[styles.section, className].filter(Boolean).join(" ")} data-layout={layout} data-folded={chrome.folded} aria-labelledby={titleID} data-section={id}>
        {chrome.header({ titleID, contentID, title, caption: caption ?? null, spokenCaption: spokenCaption ?? null, accessory, trailing, glance })}
        {chrome.folded && !chrome.keepsAlive ? null : (
          <div id={contentID} className={styles.content} data-reveal={chrome.reveals} hidden={chrome.folded}>
            {children}
          </div>
        )}
      </section>
    );
  }
  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")} data-layout={layout} aria-labelledby={titleID} data-section={id}>
      <div className={styles.head}>
        <SectionTitle id={titleID} accessory={accessory} trailing={trailing}>
          {title}
        </SectionTitle>
        {caption ? (
          <p className={styles.caption}>
            {spokenCaption ? (
              <>
                <span aria-hidden="true">{caption}</span>
                <span className="visually-hidden">{spokenCaption}</span>
              </>
            ) : (
              caption
            )}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
