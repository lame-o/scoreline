/**
 * Whether game pages broadcast at all (BROADCAST.md). Always, but for the
 * `?demo` harness (development only), whose recorded plays carry their own
 * game's wallclocks, days old: no presentation clock can present those live,
 * so its pages show as they did before the broadcast unless `&broadcast`
 * restamps the plays onto the harness's own clock (data/demoCourtSoccer.ts).
 */
let available = true;

export function broadcastAvailable(): boolean {
  return available;
}

export function setBroadcastAvailable(on: boolean): void {
  available = on;
}
