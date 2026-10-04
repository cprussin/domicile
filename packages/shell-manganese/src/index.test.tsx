import { describe, expect, it, spyOn } from "bun:test";
import type { DomicileShortcut } from "@domicile-desktop/sdk/domicile-host";
import { act, within } from "@testing-library/react";

import { exec, runManganese } from "./index";

describe("runManganese", () => {
  // A custom bar layout on the stock desktop.
  it("mounts manganese into the root with the bar it is given", async () => {
    // Without a compositor the shell logs a warning; not under test here.
    const said = spyOn(console, "warn").mockImplementation(() => undefined);
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
    said.mockRestore();
  });

  // Custom keybindings replace the defaults. Runs under a compositor so the
  // grabbed keys can be checked.
  it("binds the keys it is given rather than its own", () => {
    const grabbed: DomicileShortcut[] = [];
    // Minimal compositor: events, unanswered readings, and no-op calls except
    // the one under test.
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
          keybindings: { keybindings: { "Meta+x": exec("kitty") }, modes: {} },
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
