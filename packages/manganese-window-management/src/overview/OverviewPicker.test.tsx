import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import type { Rect } from "../rect";
import { appWindowId } from "../window";
import { overviewOf } from "./fixture";
import { OverviewPicker } from "./OverviewPicker";

const OVERVIEW = overviewOf(false);

const tileBox = (name: string): Rect => {
  const tile = OVERVIEW.tiles.find((found) => found.name === name);
  if (tile === undefined) {
    throw new Error(`test: no tile for workspace ${name}`);
  } else {
    return tile.box;
  }
};

/** The middle of workspace `name`'s tile, over its lone window. */
const overWindow = (name: string) => {
  const box = tileBox(name);
  return { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
};

/** The top of workspace `name`'s tile, where the bar would be: no window. */
const overDesk = (name: string) => {
  const box = tileBox(name);
  return { clientX: box.x + 2, clientY: box.y + 2 };
};

type Picked =
  | { dismissed: true }
  | { moved: [string, string] }
  | { picked: string }
  | { pickedWindow: string };

const picker = () => {
  const picked: Picked[] = [];
  render(
    <OverviewPicker
      focused=""
      onDismiss={() => picked.push({ dismissed: true })}
      onMove={(id, workspace) => picked.push({ moved: [id, workspace] })}
      onPick={(workspace) => picked.push({ picked: workspace })}
      onPickWindow={(id) => picked.push({ pickedWindow: id })}
      overviews={[OVERVIEW]}
    />,
  );
  return picked;
};

const tile = (name: string) =>
  screen.getByRole("button", { name: `Workspace ${name}` });

describe("OverviewPicker", () => {
  it("offers each workspace, marking the one on screen, which has focus", () => {
    picker();

    expect(tile("1").getAttribute("aria-current")).toBeNull();
    expect(tile("3").getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(tile("3"));
  });

  it("goes to the window pressed, or to the workspace around it", () => {
    const picked = picker();

    fireEvent.click(tile("1"), { ...overWindow("1"), detail: 1 });
    fireEvent.click(tile("1"), { ...overDesk("1"), detail: 1 });

    expect(picked).toStrictEqual([
      { pickedWindow: appWindowId("kitty") },
      { picked: "1" },
    ]);
  });

  it("goes to the workspace chosen from the keyboard", () => {
    const picked = picker();

    fireEvent.keyDown(tile("3"), { key: "ArrowLeft" });
    fireEvent.click(document.activeElement ?? document.body, { detail: 0 });

    expect(picked).toStrictEqual([{ picked: "1" }]);
  });

  it("keeps Tab among its tiles", () => {
    // The bar and the other screens are behind it.
    picker();

    fireEvent.keyDown(tile("3"), { key: "Tab" });
    expect(document.activeElement).toBe(tile("1"));
    fireEvent.keyDown(tile("1"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(tile("3"));
  });

  it("closes on Escape, or a press between the tiles", () => {
    const picked = picker();

    fireEvent.keyDown(tile("3"), { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog", { name: "Workspaces" }));

    expect(picked).toStrictEqual([{ dismissed: true }, { dismissed: true }]);
  });

  it("moves a window dragged onto another workspace, and picks nothing", () => {
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overWindow("1"));
    fireEvent.pointerMove(tile("1"), { ...overWindow("3"), buttons: 1 });
    fireEvent.pointerUp(tile("3"), overWindow("3"));
    fireEvent.click(screen.getByRole("dialog", { name: "Workspaces" }));

    expect(picked).toStrictEqual([{ moved: [appWindowId("kitty"), "3"] }]);
  });

  it("leaves a window dragged back onto its own workspace", () => {
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overWindow("1"));
    fireEvent.pointerMove(tile("1"), { ...overDesk("1"), buttons: 1 });
    fireEvent.pointerUp(tile("1"), overDesk("1"));
    fireEvent.click(tile("1"), { ...overDesk("1"), detail: 1 });

    expect(picked).toStrictEqual([]);
  });

  it("keeps a drag whose pointer a tile hands it", () => {
    // A touch's pointer starts captured by the tile it went down on, which
    // loses it as the layer takes it.
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overWindow("1"));
    fireEvent.pointerMove(tile("1"), { ...overWindow("3"), buttons: 1 });
    fireEvent.lostPointerCapture(tile("1"));
    fireEvent.pointerUp(tile("3"), overWindow("3"));

    expect(picked).toStrictEqual([{ moved: [appWindowId("kitty"), "3"] }]);
  });

  it("moves nothing on a drag with another button, and still takes the next click", () => {
    const picked = picker();

    fireEvent.pointerDown(tile("1"), { ...overWindow("1"), button: 2 });
    fireEvent.pointerMove(tile("1"), { ...overWindow("3"), buttons: 1 });
    fireEvent.pointerUp(tile("3"), overWindow("3"));
    fireEvent.click(tile("3"), { ...overDesk("3"), detail: 1 });

    expect(picked).toStrictEqual([{ picked: "3" }]);
  });

  it("stays open when a press on a tile is let go between tiles", () => {
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overDesk("1"));
    fireEvent.pointerUp(screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("dialog"));

    expect(picked).toStrictEqual([]);
  });

  it("takes Enter on a tile after a touch drag, which ends with no click", () => {
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overWindow("1"));
    fireEvent.pointerMove(tile("1"), { ...overWindow("3"), buttons: 1 });
    fireEvent.pointerUp(tile("3"), overWindow("3"));
    fireEvent.click(tile("3"), { detail: 0 });

    expect(picked).toStrictEqual([
      { moved: [appWindowId("kitty"), "3"] },
      { picked: "3" },
    ]);
  });

  it("forgets a press canceled before it became a drag", () => {
    // The shell can take a touch for a gesture of its own.
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overWindow("1"));
    fireEvent.pointerCancel(tile("1"));
    fireEvent.pointerMove(tile("3"), { ...overWindow("3"), buttons: 1 });
    fireEvent.pointerUp(tile("3"), overWindow("3"));

    expect(picked).toStrictEqual([]);
  });

  it("forgets a press let go off it, once the pointer comes back", () => {
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overWindow("1"));
    fireEvent.pointerMove(tile("3"), { ...overWindow("3"), buttons: 0 });
    fireEvent.pointerUp(tile("3"), overWindow("3"));

    expect(picked).toStrictEqual([]);
  });

  it("follows only the pointer that pressed", () => {
    const picked = picker();

    fireEvent.pointerDown(tile("1"), { ...overWindow("1"), pointerId: 1 });
    fireEvent.pointerDown(tile("3"), {
      ...overWindow("3"),
      isPrimary: false,
      pointerId: 2,
    });
    fireEvent.pointerMove(tile("1"), {
      ...overWindow("3"),
      buttons: 1,
      pointerId: 1,
    });
    fireEvent.pointerUp(tile("3"), { ...overWindow("3"), pointerId: 1 });

    expect(picked).toStrictEqual([{ moved: [appWindowId("kitty"), "3"] }]);
  });

  it("drops a drag whose pointer it loses", () => {
    // The shell or the engine can take the pointer from it mid-drag.
    const picked = picker();

    fireEvent.pointerDown(tile("1"), overWindow("1"));
    fireEvent.pointerMove(tile("1"), { ...overWindow("3"), buttons: 1 });
    fireEvent.lostPointerCapture(screen.getByRole("dialog"));
    fireEvent.pointerUp(tile("3"), overWindow("3"));

    expect(picked).toStrictEqual([]);
  });
});
