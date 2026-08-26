import { describe, expect, it } from "bun:test";

import type { BandBridge } from "./render-bands";
import { renderBands } from "./render-bands";

/** A `show` that does nothing, for the tests that are not about showing. */
const showsNothing = (): void => {
  // Deliberately empty: what the shell paints is its own business, and these
  // tests are about the protocol around it.
};

/** A bridge that records what it was told and lets a test drive `render_band`. */
const bridge = () => {
  let asking: ((message: { band: number }) => void) | undefined;
  const declared: number[][] = [];
  return {
    ask: (band: number) => asking?.({ band }),
    declareBands: (depths: readonly number[]) => {
      declared.push([...depths]);
    },
    declared,
    off: () => {
      asking = undefined;
    },
    on: (_: "render_band", handler: (message: { band: number }) => void) => {
      asking = handler;
    },
  } as unknown as BandBridge & {
    ask: (band: number) => void;
    declared: number[][];
  };
};

/** The opacity of the element that guarantees a frame, if it is in the page. */
const nudged = () =>
  document.getElementById("domicile-band-nudge")?.style.opacity;

describe("renderBands", () => {
  it("declares the depths the shell draws at", () => {
    const host = bridge();
    renderBands(host, [0, 5], showsNothing);

    expect(host.declared).toStrictEqual([[0, 5]]);
  });

  it("shows the band it was asked for", () => {
    const host = bridge();
    const shown: number[] = [];
    renderBands(host, [0, 5], (band) => shown.push(band));

    host.ask(1);
    host.ask(0);

    expect(shown).toStrictEqual([1, 0]);
  });

  it("changes a style every time, so a frame always happens", () => {
    // What is needed is a paint invalidation, and setting a style to the value
    // it already holds is not one: Chromium invalidates nothing, paints
    // nothing, commits nothing, and the compositor's question stands for ever.
    //
    // The case that catches a value derived from the *band*: one band, asked
    // twice. Both are band 0, so a band-derived value repeats and the second
    // ask changes nothing at all.
    const host = bridge();
    renderBands(host, [0], showsNothing);

    host.ask(0);
    const first = nudged();
    host.ask(0);

    expect(first).toBeDefined();
    expect(nudged()).not.toBe(first);
  });

  it("keeps one nudge however many bands are asked for", () => {
    const host = bridge();
    renderBands(host, [0, 5], showsNothing);

    host.ask(0);
    host.ask(1);
    host.ask(0);

    expect(document.querySelectorAll("#domicile-band-nudge")).toHaveLength(1);
  });

  it("takes no pointer, so the shell's own hit-testing is untouched", () => {
    const host = bridge();
    renderBands(host, [0], showsNothing);
    host.ask(0);

    expect(
      document.getElementById("domicile-band-nudge")?.style.pointerEvents,
    ).toBe("none");
  });

  it("stops answering when the shell lets it go", () => {
    // The registration is a single slot on the bridge, so a shell that mounts
    // twice — React's strict mode, a hot reload — would displace its own
    // handler and the first `show` would go dead with nothing said.
    const host = bridge();
    const shown: number[] = [];
    const stop = renderBands(host, [0], (band) => shown.push(band));

    stop();
    host.ask(0);

    expect(shown).toStrictEqual([]);
  });
});
