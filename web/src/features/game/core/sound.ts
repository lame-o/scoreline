/**
 * The celebration sounds, synthesized with the Web Audio API
 * (Celebrations.swift `CelebrationSound`; the rules are in
 * data/celebrationSound.ts). The Mac plays the system's Pop and Glass, which
 * it doesn't ship; these are drawn the same way here, so nothing downloads:
 *
 * - Pop: a soft, short bubble, a sine dropping two octaves in 80 ms, with a
 *   brighter overtone that's gone in half that; 0.15 s in all.
 * - Glass: a struck glass, three inharmonic partials over G6 ringing out
 *   in about a second, the upper ones first.
 *
 * Browsers start audio suspended until a gesture: the game page unlocks it on
 * the first pointer or key press (`listenForUnlock`), and Settings' Sounds
 * toggle unlocks it as it's switched on. A sound that can't play yet is
 * skipped, and doesn't use up the 8 s.
 *
 *     playCelebrationSound(moment)   // from the moment slot, with the visual
 */
import { celebrationSound, SoundGate, soundsEnabled, type SoundChoice } from "../../../data/celebrationSound";
import type { LiveMoment } from "../../../data/moments";
import { getSettings } from "../../../state/settings";

/** The parts of an AudioContext the synth uses (an OfflineAudioContext in tests, or a stand-in). */
export interface SynthContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

let context: AudioContext | null = null;
const gate = new SoundGate();

function make(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    return new Context({ latencyHint: "interactive" });
  } catch {
    return null;
  }
}

/** Creates or resumes the page's audio (call from a user gesture). */
export function unlockAudio(): void {
  context ??= make();
  if (context && context.state !== "running") void context.resume().catch(() => {});
}

/** Unlocks audio on the first pointer or key press, then stops listening. Returns the remover. */
export function listenForUnlock(): () => void {
  if (context?.state === "running") return () => {};
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const on = () => {
    unlockAudio();
    off();
  };
  const off = () => events.forEach((e) => window.removeEventListener(e, on, true));
  events.forEach((e) => window.addEventListener(e, on, { capture: true, passive: true }));
  return off;
}

/** Plays a moment's sound if Settings asks for sounds, it's a score, the audio is unlocked and 8 s have passed. */
export function playCelebrationSound(moment: LiveMoment): boolean {
  if (!soundsEnabled(getSettings())) return false;
  const choice = celebrationSound(moment);
  if (!choice || !context || context.state !== "running") return false;
  if (!gate.allow(Date.now())) return false;
  synthesize(context, choice, context.currentTime + 0.01);
  return true;
}

/** One partial: a sine from `from` (gliding to `to` over `glide` s), struck at `at` and ringing out over `decay` s. */
function partial(ctx: SynthContext, out: AudioNode, at: number, { from, to = from, glide = 0, peak, decay }: { from: number; to?: number; glide?: number; peak: number; decay: number }): number {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + glide);
  // From silence, a 3 ms strike (no click), an exponential ring to silence.
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(peak, at + 0.003);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(amp).connect(out);
  osc.start(at);
  const end = at + decay + 0.02;
  osc.stop(end);
  return end;
}

/** Schedules a sound on `ctx` at `at` (its clock); returns when it's over. */
export function synthesize(ctx: SynthContext, { name, volume }: SoundChoice, at: number): number {
  const master = ctx.createGain();
  master.gain.setValueAtTime(volume, at);
  master.connect(ctx.destination);
  if (name === "pop") {
    return Math.max(
      partial(ctx, master, at, { from: 880, to: 220, glide: 0.08, peak: 0.9, decay: 0.13 }),
      partial(ctx, master, at, { from: 1760, to: 600, glide: 0.04, peak: 0.25, decay: 0.06 }),
    );
  }
  // Glass: G6 and two inharmonic partials of a struck glass, the upper ones dying first.
  const f0 = 1568;
  return Math.max(
    partial(ctx, master, at, { from: f0, peak: 0.6, decay: 1.1 }),
    partial(ctx, master, at, { from: f0 * 2.76, peak: 0.22, decay: 0.45 }),
    partial(ctx, master, at, { from: f0 * 5.4, peak: 0.08, decay: 0.2 }),
  );
}
