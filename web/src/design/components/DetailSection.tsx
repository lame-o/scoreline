/**
 * DetailSection: a titled block (Visualizations.swift `DetailSection`), the
 * one the game pages and the team and player pages share: the small-caps
 * title with its state at the trailing edge (Live, Final, the live count
 * "2–2", or text) and trailing controls, a caption of one or two lines
 * saying what the block shows and where it comes from, then the content.
 *
 * - `id` (game pages): the section's name in the page plan; it sets
 *   `data-section`, which the page's geometry reads (the docked bar, the
 *   chart peek), and names the title `section-<id>`.
 * - `spokenCaption`: the caption in words, when the visible one leans on
 *   glyphs or short names ("MIL attacks →").
 * - `layout`: "stack" (the game page: 8pt between blocks) or "flow" (the
 *   profile pages, whose content spaces itself).
 *
 * Each section is a size container (`@container section`), so its content
 * adds detail by the room it has (the Mac's width classes).
 *
 *     <DetailSection id="atBat" title="This At-Bat" accessory={{ count: [2, 2] }}>…</DetailSection>
 *     <DetailSection title="Roster" caption="…" trailing={toggle} layout="flow">…</DetailSection>
 */
import { useId, type ReactNode } from "react";
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
  readonly children: ReactNode;
}

export function DetailSection({ id, title, caption, spokenCaption, accessory, trailing, layout = "stack", className, children }: DetailSectionProps) {
  const generated = useId();
  const titleID = id ? `section-${id}` : `section-${generated}`;
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
