import { describe, expect, it } from "bun:test";

import type { Keybinding, ShortcutMessage } from "./host-message";
import { KeyAction } from "./key-action";
import { actionFor, keybindingsFor } from "./keybindings";

/** Meta and the key `keycode`, and nothing else held. */
const meta = (keycode: number, shiftKey = false): ShortcutMessage => ({
  altKey: false,
  ctrlKey: false,
  keycode,
  metaKey: true,
  shiftKey,
});

const binding = (shortcut: ShortcutMessage, action: KeyAction): Keybinding => ({
  action,
  shortcut,
});

describe("keybindingsFor", () => {
  it("adds the shell's own to the desk's, the shell's winning a chord both bind", () => {
    const bindings = keybindingsFor(
      {
        keybindings: new Map([
          [
            "default",
            [
              binding(meta(28), KeyAction.SendShell(["terminal"])),
              binding(meta(38), KeyAction.SendShell(["focus", "left"])),
            ],
          ],
        ]),
        shells: new Map([
          [
            "manganese",
            {
              keybindings: new Map([
                [
                  "default",
                  [binding(meta(38), KeyAction.SendShell(["focus", "right"]))],
                ],
                ["resize", [binding(meta(1), KeyAction.Mode("default"))]],
              ]),
              options: {},
            },
          ],
          [
            "simple",
            {
              keybindings: new Map([
                ["default", [binding(meta(28), KeyAction.SendShell(["kill"]))]],
              ]),
              options: {},
            },
          ],
        ]),
      },
      "manganese",
    );

    expect(actionFor(bindings, "default", meta(38))).toStrictEqual(
      KeyAction.SendShell(["focus", "right"]),
    );
    // The desk's, untouched by another shell's table.
    expect(actionFor(bindings, "default", meta(28))).toStrictEqual(
      KeyAction.SendShell(["terminal"]),
    );
    // A mode only this shell declares is one of its modes.
    expect(actionFor(bindings, "resize", meta(1))).toStrictEqual(
      KeyAction.Mode("default"),
    );
  });

  it("is the desk's alone for a shell the config says nothing about", () => {
    const bindings = keybindingsFor(
      {
        keybindings: new Map([
          ["default", [binding(meta(28), KeyAction.SendShell(["terminal"]))]],
        ]),
        shells: new Map(),
      },
      "manganese",
    );

    expect([...bindings.keys()]).toStrictEqual(["default"]);
    expect(actionFor(bindings, "default", meta(28))).toStrictEqual(
      KeyAction.SendShell(["terminal"]),
    );
  });
});

describe("actionFor", () => {
  const bindings = new Map([
    ["default", [binding(meta(28), KeyAction.SendShell(["terminal"]))]],
    ["resize", [binding(meta(28), KeyAction.Mode("default"))]],
  ]);

  it("reads the press in the mode it is given", () => {
    expect(actionFor(bindings, "resize", meta(28))).toStrictEqual(
      KeyAction.Mode("default"),
    );
  });

  it("answers only the modifiers the chord names", () => {
    // Shift held is a different chord, which nobody bound.
    expect(actionFor(bindings, "default", meta(28, true))).toBeUndefined();
  });

  it("answers nothing in a mode there are no bindings for", () => {
    expect(actionFor(bindings, "move", meta(28))).toBeUndefined();
  });
});
