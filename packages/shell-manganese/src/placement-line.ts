// What the chrome has to say about its own timings, which is one thing.
//
// Placement is about a desktop merely existing: every window is measured on
// every animation frame so that its client stays configured at the box the
// page gives it, and that is paid per window per frame whether or not anybody
// is touching the machine. It is also the one cost that grows with the number
// of windows rather than with what any of them is doing, which is why it is
// worth a line of its own on an idle desktop.
//
// Keystroke to pixel is not measured here: `domicile-compositor`'s `latency.rs`
// is the only process that both puts the key into the client's seat and can ask
// the engine what was drawn. See ENGINE-FORK.md.

import type { SampleReport } from "@domicile/chrome-sdk/sample-window";

/**
 * The line to print for what a reporting interval spent measuring windows, or
 * `undefined` when it measured none — an untouched desktop should not fill the
 * log.
 */
export const placementLine = (
  placement: SampleReport | undefined,
): string | undefined => {
  if (placement === undefined) {
    return undefined;
  } else {
    return [
      `placements=${placement.count.toString()}`,
      // The total as well as the average, because the total is the question —
      // how much of a second goes on measuring — and the reader should not
      // have to multiply. The average and the worst case carry decimals
      // because one measurement is sub-millisecond by construction: whole
      // milliseconds print every one of them as zero, which is the answer this
      // exists to disprove.
      `place_total_ms=${Math.round(placement.count * placement.averageMs).toString()}`,
      `place_ms=${precise(placement.averageMs)} place_worst_ms=${precise(placement.worstMs)}`,
    ].join(" ");
  }
};

// For a duration too small to survive whole milliseconds.
//
// Two decimals rather than more, because a third would be noise on a number
// this size: 0.01ms against an average of 0.4ms is already 2.5%, and
// `place_total_ms` carries the exact figure for anyone who needs it. Chromium
// clamps `performance.now()` to 100µs in a renderer that is not cross-origin
// isolated, which this one is not — so the *worst* case really has nothing
// past the first decimal, though an average over a thousand samples recovers
// more, their quantisation phases being independent.
const precise = (ms: number): string => ms.toFixed(2);
