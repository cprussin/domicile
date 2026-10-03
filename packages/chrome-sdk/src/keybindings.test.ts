import { describe, expect, it } from "bun:test";

import type { Keybinding, ShortcutMessage } from "./host-message";
import { KeyAction } from "./key-action";
import { actionFor } from "./keybindings";

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
