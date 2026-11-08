import { describe, expect, it } from "bun:test";

import type { Rect } from "../rect";
import { seenThrough, tileAt, tilesOf, viewOf } from "./tiles";

const SCREEN: Rect = { height: 1080, width: 1920, x: 0, y: 0 };
const AREA: Rect = { height: 1048, width: 1920, x: 0, y: 32 };

describe("tilesOf", () => {
  it("shows one workspace at most a little over half size, centered", () => {
    const [tile] = tilesOf(AREA, SCREEN, ["1"]);

    expect(tile?.box.width).toBe(1152);
    expect(tile?.box.height).toBe(648);
    expect(tile?.box.x).toBe(384);
  });

  it("keeps two workspaces side by side, in order, the screen's shape", () => {
    const tiles = tilesOf(AREA, SCREEN, ["1", "4"]);

    expect(tiles.map(({ name }) => name)).toStrictEqual(["1", "4"]);
    expect(new Set(tiles.map(({ box }) => box.y)).size).toBe(1);
    for (const { box } of tiles) {
      expect(Math.abs(box.width / box.height - 1920 / 1080)).toBeLessThan(0.01);
    }
  });

  it("wraps many into rows, centering a short last row", () => {
    const tiles = tilesOf(AREA, SCREEN, ["1", "2", "3", "4", "5"]);
    const rows = [...new Set(tiles.map(({ box }) => box.y))];
    const last = tiles.filter(({ box }) => box.y === rows.at(-1));
    const first = tiles.filter(({ box }) => box.y === rows[0]);
    const middle = (boxes: typeof tiles) =>
      ((boxes[0]?.box.x ?? 0) +
        (boxes.at(-1)?.box.x ?? 0) +
        (boxes.at(-1)?.box.width ?? 0)) /
      2;

    expect(rows.length).toBe(2);
    expect(Math.abs(middle(last) - middle(first))).toBeLessThanOrEqual(1);
  });

  it("fits every tile and its label inside the area", () => {
    const tiles = tilesOf(AREA, SCREEN, ["1", "2", "3", "4", "5", "6", "7"]);

    for (const { box } of tiles) {
      expect(box.x).toBeGreaterThanOrEqual(AREA.x);
      expect(box.y).toBeGreaterThanOrEqual(AREA.y);
      expect(box.x + box.width).toBeLessThanOrEqual(AREA.x + AREA.width);
      expect(box.y + box.height).toBeLessThanOrEqual(AREA.y + AREA.height);
    }
  });
});

describe("viewOf", () => {
  it("maps the screen onto its tile", () => {
    const screen = { height: 1080, width: 1920, x: 1920, y: 0 };
    const tile = { height: 270, width: 480, x: 2000, y: 100 };
    const view = viewOf(screen, tile);

    expect(seenThrough(view, screen)).toStrictEqual(tile);
    expect(
      seenThrough(view, { height: 108, width: 192, x: 2112, y: 108 }),
    ).toStrictEqual({ height: 27, width: 48, x: 2048, y: 127 });
  });
});

describe("tileAt", () => {
  it("finds the tile under a point, or none between them", () => {
    const tiles = tilesOf(AREA, SCREEN, ["1", "2"]);
    const second = tiles[1]?.box ?? AREA;

    expect(
      tileAt(tiles, [second.x + 1, second.y + second.height - 1])?.name,
    ).toBe("2");
    expect(tileAt(tiles, [AREA.x, AREA.y])).toBeUndefined();
  });
});
