import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, within } from "@testing-library/react";

import { exec, runManganese } from "./index";

/** A desk of one screen, as the engine hands it to the shell. */
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
  return fake;
};

describe("runManganese", () => {
  // The library's whole promise: a layout of the user's own, on the bar of a
  // desktop they did not have to build.
  it("mounts manganese into the root with the bar it is given", async () => {
    const fake = onADesk();
    // Never put in the document: a desktop this test cannot unmount would
    // still be on the page every later test queries.
    const root = document.createElement("div");

    act(() => {
      runManganese({
        topBar: {
          left: [<span key="mail">mail 3/12</span>],
          middle: [],
          right: [],
        },
      })(root, fake.host);
    });

    expect(root).toContainElement(await within(root).findByText("mail 3/12"));
  });

  // The other half of the promise: a desk's own keys, in place of manganese's.
  // What is grabbed is what the shell was given and nothing else.
  it("binds the keys it is given rather than its own", () => {
    const fake = onADesk();

    act(() => {
      runManganese({
        keybindings: { keybindings: { "Meta+x": exec("kitty") }, modes: {} },
      })(document.createElement("div"), fake.host);
    });

    expect(fake.calls.filter(([method]) => method === "grabShortcut")).toEqual([
      ["grabShortcut", "Meta+x"],
    ]);
  });
});
