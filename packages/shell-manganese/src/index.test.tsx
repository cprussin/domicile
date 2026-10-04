import { afterEach, describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, within } from "@testing-library/react";

import { exec, runManganese } from "./index";

/** A fake host describing one screen. */
const onADesk = (): FakeDomicileHost => {
  const fake = new FakeDomicileHost();
  fake.set({
    displays: [
      {
        height: 1080,
        modeHeight: 1080,
        modeWidth: 1920,
        name: "left",
        scale: 1,
        transform: "normal",
        width: 1920,
        x: 0,
        y: 0,
      },
    ],
  });
  (window as { domicile?: unknown }).domicile = fake.host;
  return fake;
};

afterEach(() => {
  delete (window as { domicile?: unknown }).domicile;
});

describe("runManganese", () => {
  // A custom bar layout on the stock desktop.
  it("mounts manganese into the root with the bar it is given", async () => {
    onADesk();
    // Not attached to the document, so it can't leak into later tests.
    const root = document.createElement("div");

    act(() => {
      runManganese({
        topBar: {
          left: [<span key="mail">mail 3/12</span>],
          middle: [],
          right: [],
        },
      })(root);
    });

    expect(root).toContainElement(await within(root).findByText("mail 3/12"));
  });

  // Custom keybindings replace the defaults.
  it("binds the keys it is given rather than its own", () => {
    const fake = onADesk();

    act(() => {
      runManganese({
        keybindings: { keybindings: { "Meta+x": exec("kitty") }, modes: {} },
      })(document.createElement("div"));
    });

    expect(fake.calls.filter(([method]) => method === "grabShortcut")).toEqual([
      ["grabShortcut", "Meta+x"],
    ]);
  });

  it("draws nothing in a page with no desktop behind it", () => {
    const root = document.createElement("div");

    runManganese()(root);

    expect(root.childElementCount).toBe(0);
  });
});
