/**
 * Helpers the play theater's suites share (PlayCreditsTests.swift's `ends`
 * and `inView`): where each runner went, in a line, and whether a point is in
 * the camera's view.
 */
import type { CameraFrame } from "../../src/data/mlb/playCamera";
import type { Runner } from "../../src/data/mlb/playScene";
import type { FieldPoint } from "../../src/data/mlb/theaterField";

/** "B→1 2→R 1×2 B×c": where each runner went. */
export function ends(runners: readonly Runner[]): string {
  return runners
    .map((r) => {
      const from = r.from === 0 ? "B" : String(r.from);
      switch (r.end.kind) {
        case "base":
          return `${from}→${r.end.base}`;
        case "scored":
          return `${from}→R`;
        case "out":
          return `${from}×${r.end.at ?? "c"}`;
      }
    })
    .join(" ");
}

/** Where a point sits in the view, as fractions across and up, is inside it. */
export function inView(p: FieldPoint, c: CameraFrame, slack = 0): boolean {
  const x = 0.5 + (p.x - c.x) / (c.span * 2);
  const y = 0.5 + (p.y * 0.5 + p.z * 0.82 - c.y) / c.span;
  return x >= -slack && x <= 1 + slack && y >= -slack && y <= 1 + slack;
}
