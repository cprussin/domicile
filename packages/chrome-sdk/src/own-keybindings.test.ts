import { describe, expect, it } from "bun:test";

import { KeyAction } from "./key-action";
import { ownKeybindings } from "./own-keybindings";

describe("ownKeybindings", () => {
  it("files each binding under its chord, spelled the one way", () => {
    expect(
      ownKeybindings({
        keybindings: { "Shift+Meta+parenleft": KeyAction.SendShell(["a"]) },
      }),
    ).toEqual(
      new Map([
        [
          "default",
          new Map([["Shift+Meta+parenleft", KeyAction.SendShell(["a"])]]),
        ],
      ]),
    );
  });

  it("reads every spelling of every modifier, in any case, in any order", () => {
    const [chord] =
      ownKeybindings({
        keybindings: { "super+CONTROL+mod1+l": KeyAction.Mode("x") },
      })
        .get("default")
        ?.keys() ?? [];
    expect(chord).toBe("Ctrl+Alt+Meta+l");
  });

  it("keeps each mode's table apart, with `default` always there", () => {
    const bindings = ownKeybindings({
      modes: { resize: { "Meta+Escape": KeyAction.Mode("default") } },
    });
    expect([...bindings.keys()]).toEqual(["default", "resize"]);
    expect(bindings.get("default")).toEqual(new Map());
  });

  it("refuses a chord with no keysym, an unknown modifier or one held twice", () => {
    for (const chord of ["Meta+", "Hyper+l", "Meta+Super+l", "Meta+ l"]) {
      expect(() =>
        ownKeybindings({ keybindings: { [chord]: KeyAction.Mode("x") } }),
      ).toThrow(chord);
    }
  });

  it("refuses two spellings of one chord in one mode", () => {
    expect(() =>
      ownKeybindings({
        keybindings: {
          "Meta+Shift+l": KeyAction.Mode("x"),
          "Shift+Super+l": KeyAction.Mode("y"),
        },
      }),
    ).toThrow("Shift+Super+l");
  });

  it("refuses a table for `default` beside the default one", () => {
    expect(() => ownKeybindings({ modes: { default: {} } })).toThrow("default");
  });
});
