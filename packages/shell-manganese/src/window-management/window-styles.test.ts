import { describe, expect, it } from "bun:test";

import config from "../../panda.config";
import { Layout } from "./tree/node";
import {
  collapsedAlong,
  movingStyles,
  placedAt,
  scaledAbout,
  shuffledBy,
} from "./window-styles";

const RECT = { height: 200, width: 300, x: 10, y: 20 };

describe("placedAt", () => {
  it("places a window in the desktop's own coordinates", () => {
    // The viewport spans the whole desktop, including under the top bar.
    expect(placedAt(RECT, 0).position).toBe("fixed");
  });

  it("puts the window where the rectangle says", () => {
    expect(placedAt(RECT, 0)).toMatchObject({
      blockSize: "200px",
      inlineSize: "300px",
      insetBlockStart: "20px",
      insetInlineStart: "10px",
    });
  });

  it("writes the depth as the element's own z-index", () => {
    // The compositor stacks the client's surface by the element's own z-index.
    expect(placedAt(RECT, 3).zIndex).toBe(3);
  });

  it("hands its corner to the keyframes that clip it to its screen", () => {
    expect(placedAt(RECT, 0)).toMatchObject({
      "--placed-x": "10px",
      "--placed-y": "20px",
    });
  });
});

// A window's bar and contents, and the frame they span.
const FRAME = { height: 1048, width: 1920, x: 0, y: 32 };
const BAR = { height: 30, width: 1920, x: 0, y: 32 };
const SURFACE = { height: 1018, width: 1920, x: 0, y: 62 };

describe("scaledAbout", () => {
  // Bar and contents share one origin so they don't pull apart when scaled.
  it("turns the contents about the middle of the whole frame", () => {
    // The frame's center is (960, 556), 494px below the contents' top.
    expect(scaledAbout(FRAME, SURFACE).transformOrigin).toBe("960px 494px");
  });

  it("turns the bar about that same point, which is below the bar", () => {
    expect(scaledAbout(FRAME, BAR).transformOrigin).toBe("960px 524px");
  });

  it("turns a box that is the whole frame about its own middle", () => {
    // A hidden tab's window shows only its tab, so the tab is the frame.
    expect(scaledAbout(BAR, BAR).transformOrigin).toBe("960px 15px");
  });
});

describe("shuffledBy", () => {
  it("hands the shuffle to the keyframes as custom properties", () => {
    expect(
      shuffledBy({ away: { x: -48, y: 12 }, from: 1, id: "a", to: 2 }),
    ).toStrictEqual({
      "--restack-from": 1,
      "--restack-to": 2,
      "--restack-x": "-48px",
      "--restack-y": "12px",
    });
  });

  it("is nothing for a window that is not shuffling", () => {
    expect(shuffledBy(undefined)).toStrictEqual({});
  });
});

describe("collapsedAlong", () => {
  // Across for a tabbed container, down for a stack.
  it("hands the way a tab closes up to the keyframes", () => {
    expect(collapsedAlong(Layout.Tabbed)).toStrictEqual({
      "--collapse-x": 0,
    });
    expect(collapsedAlong(Layout.Stacking)).toStrictEqual({
      "--collapse-y": 0,
    });
  });

  it("is nothing for a bar that is not a tab", () => {
    expect(collapsedAlong(undefined)).toStrictEqual({});
  });
});

describe("movingStyles", () => {
  // The page spans every monitor, so a window sliding off its screen would
  // otherwise show on the next one.
  it.each([
    "arriving-from-end",
    "arriving-from-start",
    "leaving-to-end",
    "leaving-to-start",
  ] as const)("clips a %s window to its screen", (motion) => {
    const { animation } = movingStyles.raw({ motion });
    const animated = String(animation)
      .split(",")
      .flatMap((entry) => {
        const name = entry.trim().split(" ")[0] ?? "";
        return Object.values(config.theme?.extend?.keyframes?.[name] ?? {});
      })
      .flatMap((frame) => Object.keys(frame));

    expect(animated).toContain("clipPath");
  });
});
