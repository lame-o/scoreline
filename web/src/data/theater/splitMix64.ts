/**
 * The Swift app's own seeded generator, bit for bit (Celebrations.swift
 * `SplitMix64` and `Celebration.seed`, 64-bit FNV-1a over the ID's UTF-8),
 * for the choreography that rolls dice (the basketball theater's spacing,
 * its ways in to the rim): the same play draws the same numbers as on the
 * Mac, so each replay is the Mac's replay. 64-bit arithmetic in BigInt; a
 * script asks a few dozen times, once, as it's built. (The celebrations'
 * particles use the cheaper SplitMix32 in celebrations.ts.)
 */
const MASK = (1n << 64n) - 1n;
const UTF8 = new TextEncoder();

/** FNV-1a 64 of the ID's UTF-8 bytes. */
export function seed64(id: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of UTF8.encode(id)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & MASK;
  }
  return hash;
}

export class SplitMix64 {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed & MASK;
  }

  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }

  /** Uniform in [lo, hi]. */
  in(lo: number, hi: number): number {
    return lo + (Number(this.next() >> 11n) / 2 ** 53) * (hi - lo);
  }

  sign(): number {
    return (this.next() & 1n) === 0n ? 1 : -1;
  }

  /** `random.next() & 1 == 0`: a coin. */
  heads(): boolean {
    return (this.next() & 1n) === 0n;
  }
}
