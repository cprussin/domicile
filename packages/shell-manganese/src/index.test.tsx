import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, within } from "@testing-library/react";

import { exec, runManganese } from "./index";

/** A fake desktop describing one screen. */
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
  // A custom bar layout on the stock desktop.
  it("mounts manganese into the root with the bar it is given", async () => {
    const fake = onADesk();
    // Not attached to the document, so it can't leak into later tests.
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

  // Custom keybindings replace the defaults.
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

  it("refuses a bookmark that is not a web address", () => {
    expect(() =>
      runManganese({
        applications: { bookmarks: [{ name: "Mail", url: "mail.example" }] },
      }),
    ).toThrow("http or https");
  });
});
