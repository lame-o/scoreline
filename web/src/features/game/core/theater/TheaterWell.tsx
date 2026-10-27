/**
 * A play theater's well, empty: what a page shows while the theater's own
 * chunk loads (the football and soccer theaters are lazy), the same size so
 * nothing below it moves when the field arrives. Decorative.
 *
 *     <Suspense fallback={<TheaterWell />}><FootballTheater … /></Suspense>
 */
import styles from "./TheaterWell.module.css";

export function TheaterWell() {
  return <div className={styles.well} aria-hidden="true" />;
}
