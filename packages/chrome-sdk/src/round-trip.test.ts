import { describe, expect, it } from "bun:test";

import { RoundTripWindow } from "./round-trip";

describe("RoundTripWindow", () => {
  it("counts a keystroke as sent before any frame answers it", () => {
    // The count that matters most is the one a broken desktop still produces.
    // Reporting nothing until something works made a swallowed keystroke look
    // like a keystroke nobody typed.
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);

    expect(window.report(0)).toEqual({
      answered: 0,
      averageMs: 0,
      medianMs: 0,
      p95Ms: 0,
      sent: 1,
      worstMs: 0,
    });
  });

  it("has nothing to say about a desktop nobody has typed at", () => {
    const window = new RoundTripWindow();
    window.drew("app-1", 10);

    expect(window.report(10)).toBeUndefined();
  });

  it("measures a keystroke from when it was sent to the frame that answered it", () => {
    const window = new RoundTripWindow();
    window.keyed("app-1", 100);
    window.drew("app-1", 180);

    expect(window.report(180)).toMatchObject({
      answered: 1,
      averageMs: 80,
      sent: 1,
      worstMs: 80,
    });
  });

  it("does not let a second keystroke start a clock the first one is holding", () => {
    // Two keys outstanding and one frame arriving cannot say which key it
    // answered. The second is counted as sent and measured by nothing, which
    // is why `sent` and `answered` are both printed.
    const window = new RoundTripWindow();
    window.keyed("app-1", 100);
    window.keyed("app-1", 120);
    window.drew("app-1", 200);

    expect(window.report(200)).toMatchObject({
      answered: 1,
      averageMs: 100,
      sent: 2,
    });
  });

  it("gives up on a keystroke no frame could still be answering", () => {
    // The bug this replaces: the stale keystroke stayed outstanding and the
    // next frame — a cursor blink, seconds later — was timed against it. A
    // control run typing a key the client ignores reported a 5.3 second round
    // trip that way.
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);
    window.drew("app-1", 5000);

    expect(window.report(5000)).toEqual({
      answered: 0,
      averageMs: 0,
      medianMs: 0,
      p95Ms: 0,
      sent: 1,
      worstMs: 0,
    });
  });

  it("counts an unanswered keystroke even when nothing arrives afterwards", () => {
    // The expiry has to run when the report is taken as well as on the next
    // event, or a run whose last keystrokes were swallowed reports them as
    // still pending and prints a smaller `sent` than it sent.
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);
    window.keyed("app-1", 3000);

    expect(window.report(6000)).toMatchObject({ answered: 0, sent: 2 });
  });

  it("reports the middle, the tail and the worst of a run", () => {
    // A path that is usually quick and occasionally terrible is what a stutter
    // is. The mean hides it, the median says what typing feels like, and p95
    // is the one a person actually notices.
    const window = new RoundTripWindow();
    for (const [at, took] of [
      [0, 10],
      [1000, 20],
      [2000, 30],
      [3000, 40],
      [4000, 900],
    ] as const) {
      window.keyed("app-1", at);
      window.drew("app-1", at + took);
    }

    expect(window.report(5000)).toEqual({
      answered: 5,
      averageMs: 200,
      medianMs: 30,
      p95Ms: 900,
      sent: 5,
      worstMs: 900,
    });
  });

  it("keeps one app's keystrokes out of another's measurement", () => {
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);
    window.keyed("app-2", 10);
    window.drew("app-2", 30);

    expect(window.report(30)).toMatchObject({
      answered: 1,
      sent: 2,
      worstMs: 20,
    });
  });

  it("accumulates over the run rather than resetting each time it is read", () => {
    // A mean over whichever few seconds a reader's `tail` caught is not a
    // measurement of anything, and the run-to-run spread here is wider than
    // any regression worth catching.
    const window = new RoundTripWindow();
    window.keyed("app-1", 0);
    window.drew("app-1", 10);
    window.report(10);
    window.keyed("app-1", 100);
    window.drew("app-1", 130);

    expect(window.report(130)).toMatchObject({
      answered: 2,
      averageMs: 20,
      sent: 2,
    });
  });
});
