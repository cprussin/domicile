import { describe, expect, it, spyOn } from "bun:test";
import type { DomicileShortcut } from "@domicile-desktop/sdk/domicile-host";
import { act, within } from "@testing-library/react";

import { runManganese, terminal } from "./index";

describe("runManganese", () => {
  // The library's whole promise: a layout of the user's own, on the bar of a
  // desktop they did not have to build.
  it("mounts manganese into the root with the bar it is given", async () => {
    // A page with no compositor says so once on the console, which is the
    // case here and not the thing under test.
    const said = spyOn(console, "warn").mockImplementation(() => undefined);
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
      })(root);
    });

    expect(root).toContainElement(await within(root).findByText("mail 3/12"));
    said.mockRestore();
  });

  // The other half of the promise: a desk's own keys, in place of manganese's.
  // Under a compositor, so they are claimed: what is grabbed is what the shell
  // was given and nothing else.
  it("binds the keys it is given rather than its own", () => {
    const grabbed: DomicileShortcut[] = [];
    // The compositor, as far as a shell's start reaches it: events, its two
    // readings not yet taken, and every call a no-op but the one under test.
    const events = new EventTarget();
    const READINGS = new Set<PropertyKey>(["brightness", "displays"]);
    const host = new Proxy(events, {
      get: (target, name) => {
        if (name === "grabShortcut") {
          return (shortcut: DomicileShortcut) => grabbed.push(shortcut);
        } else if (READINGS.has(name)) {
          return null;
        } else if (name in target) {
          return Reflect.get(target, name).bind(target);
        } else {
          return () => undefined;
        }
      },
    });
    const global = window as unknown as { domicile?: unknown };
    global.domicile = host;
    try {
      act(() => {
        runManganese({
          keybindings: { keybindings: { "Meta+x": terminal() }, modes: {} },
        })(document.createElement("div"));
      });
      act(() => {
        events.dispatchEvent(
          Object.assign(new Event("shellconfig"), {
            arrival: 0,
            config: JSON.stringify({ keys: { x: 45 }, type: "shell_config" }),
          }),
        );
      });

      expect(grabbed).toEqual([
        {
          altKey: false,
          ctrlKey: false,
          keycode: 45,
          metaKey: true,
          shiftKey: false,
        },
      ]);
    } finally {
      delete global.domicile;
    }
  });
});
