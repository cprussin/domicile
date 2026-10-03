import { describe, expect, it } from "bun:test";

import { KeyAction } from "./key-action";
import { ownKeybindings } from "./own-keybindings";

/** The keyboard the compositor describes: `dvp`'s `l` is the key `us` prints p on. */
const KEYS: ReadonlyMap<string, number> = new Map([
  ["Escape", 1],
  ["Return", 28],
  ["l", 25],
  ["parenleft", 6],
]);

describe("ownKeybindings", () => {
  it("resolves each chord's keysym to the key the keyboard has it on", () => {
    expect(
      ownKeybindings(
        { keybindings: { "Meta+Shift+parenleft": KeyAction.SendShell(["a"]) } },
        KEYS,
      ),
    ).toEqual(
      new Map([
        [
          "default",
          [
            {
              action: KeyAction.SendShell(["a"]),
              shortcut: {
                altKey: false,
                ctrlKey: false,
                keycode: 6,
                metaKey: true,
                shiftKey: true,
              },
            },
          ],
        ],
      ]),
    );
  });

  it("reads every spelling of every modifier, in any case", () => {
    const [binding] =
      ownKeybindings(
        { keybindings: { "super+CONTROL+mod1+l": KeyAction.Mode("x") } },
        KEYS,
      ).get("default") ?? [];
    expect(binding?.shortcut).toEqual({
      altKey: true,
      ctrlKey: true,
      keycode: 25,
      metaKey: true,
      shiftKey: false,
    });
  });

  it("keeps each mode's table apart, with `default` always there", () => {
    const bindings = ownKeybindings(
      { modes: { resize: { "Meta+Escape": KeyAction.Mode("default") } } },
      KEYS,
    );
    expect([...bindings.keys()]).toEqual(["default", "resize"]);
    expect(bindings.get("default")).toEqual([]);
  });

  it("refuses a chord with no keysym, an unknown modifier or one held twice", () => {
    for (const chord of ["Meta+", "Hyper+l", "Meta+Super+l", "Meta+ l"]) {
      expect(() =>
        ownKeybindings({ keybindings: { [chord]: KeyAction.Mode("x") } }, KEYS),
      ).toThrow(chord);
    }
  });

  it("refuses a keysym the keyboard cannot type, by name", () => {
    expect(() =>
      ownKeybindings(
        { keybindings: { "Meta+Greek_alpha": KeyAction.Mode("x") } },
        KEYS,
      ),
    ).toThrow("Greek_alpha");
  });

  it("refuses a table for `default` beside the default one", () => {
    expect(() => ownKeybindings({ modes: { default: {} } }, KEYS)).toThrow(
      "default",
    );
  });
});
