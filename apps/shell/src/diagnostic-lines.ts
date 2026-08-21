// What the chrome has to say about its own timings, given what it recorded.
//
// Two subjects, and they are not the same one. The round trip is about a
// keystroke — everything between pressing a key and seeing it, including the
// stages inside it the compositor cannot see. Placement is about a desktop
// merely existing: every portal is measured on every animation frame so that a
// window follows a CSS transition, and that is paid per window per frame
// whether or not anybody is touching the machine.
//
// So they are reported separately, and each is silent when its own window is
// empty. A desktop nobody has typed at should still say what its windows cost
// it — reporting placement only alongside a keystroke would hide the number in
// exactly the case it exists to describe, and would leave its window undrained
// in the meantime, so the first keystroke of a session would report an average
// over the whole session.
//
// `ipc` and `draw` have no line of their own on purpose, and are dropped on an
// interval with no keystroke to print them beside. Frames arrive with nothing
// typed behind them all the time — a blinking cursor, a video — so leaving
// their windows undrained until the next keystroke, which is what this used to
// do, put a `frames` count spanning several intervals on one line with a `keys`
// count spanning only the last. Draining them every interval is what makes all
// four fields of that line cover the same five seconds; having nowhere to print
// them meanwhile is the price of it.

import type { SampleReport } from "@domicile/chrome-sdk/sample-window";

/** Everything one reporting interval collected. */
export type Timings = {
  /** Keystroke to pixels, when a key was pressed. */
  trip: SampleReport | undefined;
  /** The host's bytes arriving in this process, to reaching this page. */
  ipc: SampleReport | undefined;
  /** Putting those pixels on the canvas. */
  draw: SampleReport | undefined;
  /** Measuring a portal and reporting where it is. */
  place: SampleReport | undefined;
};

/** The lines to print, which is none when nothing happened. */
export const diagnosticLines = ({
  trip,
  ipc,
  draw,
  place,
}: Timings): string[] => [
  ...(trip === undefined
    ? []
    : [
        [
          `round trip keys=${trip.count.toString()}`,
          `rt_ms=${round(trip.averageMs)} rt_worst_ms=${round(trip.worstMs)}`,
          `frames=${(ipc?.count ?? 0).toString()}`,
          `ipc_ms=${round(ipc?.averageMs)} ipc_worst_ms=${round(ipc?.worstMs)}`,
          `draw_ms=${round(draw?.averageMs)} draw_worst_ms=${round(draw?.worstMs)}`,
        ].join(" "),
      ]),
  ...(place === undefined
    ? []
    : [
        [
          `placements=${place.count.toString()}`,
          // The total as well as the average, because the total is the
          // question — how much of a second goes on measuring — and the reader
          // should not have to multiply. The average and the worst case carry
          // decimals because one measurement is sub-millisecond by
          // construction: whole milliseconds print every one of them as zero,
          // which is the answer this exists to disprove.
          `place_total_ms=${round(place.count * place.averageMs)}`,
          `place_ms=${precise(place.averageMs)} place_worst_ms=${precise(place.worstMs)}`,
        ].join(" "),
      ]),
];

// A stage that recorded nothing reads as zero, the way the compositor's line
// does: "did not run" and "took no time" are the same claim in a log line.
const round = (ms: number | undefined): string =>
  Math.round(ms ?? 0).toString();

// For a duration too small to survive whole milliseconds.
//
// Two decimals rather than more, because a third would be noise on a number
// this size: 0.01ms against an average of 0.4ms is already 2.5%, and
// `place_total_ms` carries the exact figure for anyone who needs it. Chromium
// clamps `performance.now()` to 100µs in a renderer that is not cross-origin
// isolated, which an Electron one is not — so the *worst* case really has
// nothing past the first decimal, though an average over a thousand samples
// recovers more, their quantisation phases being independent.
const precise = (ms: number): string => ms.toFixed(2);
