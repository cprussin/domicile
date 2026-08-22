import { describe, expect, it } from "bun:test";

import { settle } from "./waiting";

/**
 * The wait a probe uses instead of a fixed sleep.
 *
 * Both directions matter and they are opposite failures. Returning late turns
 * a loaded box into a chrome that "was told nothing"; returning on a deadline
 * rather than never is what lets the script still fail when the message
 * genuinely does not come. A `settle` that only ever slept its full budget
 * would pass the second of these and be the bug it replaced.
 */
describe("settle", () => {
  it("returns as soon as the condition holds", async () => {
    const started = Date.now();
    await settle(5000, () => true);

    // Well under the budget, and generous enough not to be a clock test: the
    // point is that it did not wait 5 seconds.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("gives up on the deadline rather than waiting for good", async () => {
    const started = Date.now();
    await settle(100, () => false);
    const waited = Date.now() - started;

    expect(waited).toBeGreaterThanOrEqual(100);
    expect(waited).toBeLessThan(2000);
  });

  it("waits for the condition rather than polling once", async () => {
    // A `settle` that checked once and returned would report the state before
    // the message arrived, which is the false alarm it exists to remove.
    let arrived = false;
    setTimeout(() => {
      arrived = true;
    }, 100);

    await settle(5000, () => arrived);

    expect(arrived).toBe(true);
  });
});
