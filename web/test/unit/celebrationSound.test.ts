/**
 * Celebration sounds (Celebrations.swift `CelebrationSound`): opt-in, never
 * with Celebrations off, a pop for a score and glass for a decisive one,
 * nothing below score tier, at most one every 8 s; synthesized from silence
 * to silence (no clicks), short, never louder than the Mac's volume.
 */
import { describe, expect, it } from "vitest";
import { celebrationSound, SoundGate, soundsEnabled } from "../../src/data/celebrationSound";
import { liveMoment, Tier, type LiveMoment } from "../../src/data/moments";
import { synthesize, type SynthContext } from "../../src/features/game/core/sound";

const moment = (tier: Tier, decisive = false): LiveMoment =>
  liveMoment({ id: "m", chart: "pitch", tier, kind: "goal", lead: "Goal", detail: "Haaland", accents: decisive ? ["decisive"] : [] });

describe("celebration sounds", () => {
  it("plays a pop for a score, glass for a decisive one, nothing below", () => {
    expect(celebrationSound(moment(Tier.score))).toEqual({ name: "pop", volume: 0.25 });
    expect(celebrationSound(moment(Tier.score, true))).toEqual({ name: "glass", volume: 0.3 });
    expect(celebrationSound(moment(Tier.swing))).toBeNull();
    expect(celebrationSound(moment(Tier.routine))).toBeNull();
  });

  it("is opt-in, and off with Celebrations off", () => {
    expect(soundsEnabled({ celebrationSounds: false, celebrationLevel: "full" })).toBe(false);
    expect(soundsEnabled({ celebrationSounds: true, celebrationLevel: "full" })).toBe(true);
    expect(soundsEnabled({ celebrationSounds: true, celebrationLevel: "subtle" })).toBe(true);
    expect(soundsEnabled({ celebrationSounds: true, celebrationLevel: "off" })).toBe(false);
  });

  it("plays at most one every 8 s", () => {
    const gate = new SoundGate();
    expect(gate.allow(0)).toBe(true);
    expect(gate.allow(7_999)).toBe(false);
    expect(gate.allow(8_000)).toBe(true);
    expect(gate.allow(9_000)).toBe(false);
  });
});

/** A stand-in AudioContext that records what's scheduled. */
function recorder() {
  const events: { node: string; param: string; kind: string; value: number; time: number }[] = [];
  const stops: number[] = [];
  const param = (node: string, name: string) => ({
    setValueAtTime: (value: number, time: number) => events.push({ node, param: name, kind: "set", value, time }),
    linearRampToValueAtTime: (value: number, time: number) => events.push({ node, param: name, kind: "linear", value, time }),
    exponentialRampToValueAtTime: (value: number, time: number) => events.push({ node, param: name, kind: "exp", value, time }),
  });
  let n = 0;
  const node = (kind: string) => {
    const id = `${kind}${n++}`;
    const self = {
      id,
      connect: (to: unknown) => to,
      gain: param(id, "gain"),
      frequency: param(id, "frequency"),
      type: "sine",
      start: () => {},
      stop: (t: number) => stops.push(t),
    };
    return self;
  };
  const ctx = { currentTime: 0, destination: {} as AudioNode, createOscillator: () => node("osc"), createGain: () => node("gain") } as unknown as SynthContext;
  return { ctx, events, stops };
}

describe("synthesized sounds", () => {
  for (const name of ["pop", "glass"] as const) {
    it(`${name}: from silence to silence, short, at the Mac's volume`, () => {
      const { ctx, events, stops } = recorder();
      const end = synthesize(ctx, { name, volume: name === "pop" ? 0.25 : 0.3 }, 1);
      expect(end - 1).toBeLessThanOrEqual(name === "pop" ? 0.2 : 1.2);
      expect(stops.every((t) => t <= end)).toBe(true);
      const envelopes = events.filter((e) => e.param === "gain" && !e.node.startsWith("gain0"));
      const starts = envelopes.filter((e) => e.kind === "set");
      const ends = envelopes.filter((e) => e.kind === "exp");
      expect(starts.every((e) => e.value === 0)).toBe(true);
      expect(ends.every((e) => e.value <= 0.001)).toBe(true);
      // The partials' peaks sum to at most 1 under the master volume: never louder than the Mac's.
      const peaks = envelopes.filter((e) => e.kind === "linear").reduce((s, e) => s + e.value, 0);
      expect(peaks).toBeLessThanOrEqual(1.15);
      expect(events.find((e) => e.node === "gain0")?.value).toBe(name === "pop" ? 0.25 : 0.3);
    });
  }
});
