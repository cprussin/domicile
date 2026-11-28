import { describe, expect, it } from "bun:test";

import { SCREEN, STATE } from "./overview/fixture";
import { placementsOf, UNSEEN } from "./placement";
import { unseenOf } from "./unseen";
import { appWindowId } from "./window";
import { workspaceNamed } from "./window-state";

const KITTY = appWindowId("kitty");
const FOOT = appWindowId("foot");

/** Where kitty sits on workspace 1, which the screen does not show. */
const onItsWorkspace = () => {
  const found = placementsOf(
    workspaceNamed(STATE, "1"),
    SCREEN.geometry,
    0,
  ).placements.find(({ id }) => id === KITTY);
  if (found === undefined) {
    throw new Error("kitty is not on workspace 1");
  }
  return found;
};

describe("unseenOf", () => {
  it("lays a captured window on a hidden workspace out where it sits there, under the wallpaper", () => {
    const unseen = unseenOf(STATE, [SCREEN], new Set([KITTY])).get(KITTY);
    expect(unseen?.placement).toStrictEqual({
      ...onItsWorkspace(),
      behind: undefined,
      depth: UNSEEN,
    });
    expect(unseen?.screen).toBe(SCREEN.geometry.name);
    // The wallpaper over it lets the pointer through.
    expect(unseen?.seen.shut).toBe(true);
  });

  it("leaves a captured window on the shown workspace to the screen", () => {
    expect(unseenOf(STATE, [SCREEN], new Set([FOOT])).size).toBe(0);
  });

  it("lays out no window nothing captures", () => {
    expect(unseenOf(STATE, [SCREEN], new Set()).size).toBe(0);
  });
});
