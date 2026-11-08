import { describe, expect, it } from "bun:test";

import type { Rect } from "../rect";
import { appWindowId } from "../window";
import { SCREEN, STATE } from "./fixture";
import { screenOverviewsOf, windowAt } from "./overview";

describe("screenOverviewsOf", () => {
  it("tiles the workspaces the screen's bar lists", () => {
    const [overview] = screenOverviewsOf(STATE, [SCREEN], false);

    expect(overview?.tiles.map(({ name }) => name)).toStrictEqual(["1", "3"]);
    expect(overview?.screen).toBe(SCREEN);
  });

  it("lays out the hidden workspaces' windows on the screen", () => {
    const [overview] = screenOverviewsOf(STATE, [SCREEN], false);

    expect(overview?.others.map(({ name }) => name)).toStrictEqual(["1"]);
    expect(overview?.others[0]?.placements.map(({ id }) => id)).toStrictEqual([
      appWindowId("kitty"),
    ]);
  });

  it("says whether it is closing", () => {
    expect(screenOverviewsOf(STATE, [SCREEN], true)[0]?.closing).toBe(true);
  });
});

describe("windowAt", () => {
  const [overview] = screenOverviewsOf(STATE, [SCREEN], false);
  const [one, three] = overview?.tiles ?? [];

  it("finds the window under the pointer in any tile", () => {
    // Each workspace's lone window fills its tile below the bar.
    const middle = (box: Rect) =>
      [box.x + box.width / 2, box.y + box.height / 2] as const;

    expect(
      overview === undefined || one === undefined
        ? undefined
        : windowAt(overview, middle(one.box)),
    ).toMatchObject({ id: appWindowId("kitty"), workspace: "1" });
    expect(
      overview === undefined || three === undefined
        ? undefined
        : windowAt(overview, middle(three.box)),
    ).toMatchObject({ id: appWindowId("foot"), workspace: "3" });
  });

  it("finds none over a tile's empty top, where the bar would be", () => {
    expect(
      overview === undefined || one === undefined
        ? "missing"
        : windowAt(overview, [one.box.x + 1, one.box.y + 1]),
    ).toBeUndefined();
  });
});
