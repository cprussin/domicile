import { describe, expect, it } from "bun:test";
import { KeyActionKind } from "@domicile-desktop/sdk/key-action";

import { parseCommand } from "./command";
import { DEFAULT_KEYBINDINGS, DEFAULT_MODES, exec } from "./commands";

describe("manganese's default keys", () => {
  // Every default binding must parse, or that key does nothing.
  it("are every one a command manganese knows, or a mode it has", () => {
    const tables = [DEFAULT_KEYBINDINGS, ...Object.values(DEFAULT_MODES)];
    for (const table of tables) {
      for (const [chord, action] of Object.entries(table)) {
        switch (action.kind) {
          case KeyActionKind.SendShell: {
            expect(
              parseCommand(action.args).match({
                Err: () => false,
                Ok: () => true,
              }),
              chord,
            ).toBe(true);
            break;
          }
          case KeyActionKind.Mode: {
            expect(
              action.name === "default" ||
                Object.hasOwn(DEFAULT_MODES, action.name),
              chord,
            ).toBe(true);
            break;
          }
        }
      }
    }
  });

  it("are sway's: workspaces on Meta and a digit", () => {
    expect(DEFAULT_KEYBINDINGS["Meta+1"]).toEqual({
      args: ["workspace", "1"],
      kind: KeyActionKind.SendShell,
    });
    expect(DEFAULT_KEYBINDINGS["Meta+0"]).toEqual({
      args: ["workspace", "10"],
      kind: KeyActionKind.SendShell,
    });
  });

  // No default terminal binding; users bind their own with `exec`.
  it("launch nothing on Meta+Return", () => {
    expect(DEFAULT_KEYBINDINGS["Meta+Return"]).toBeUndefined();
  });
});

describe("exec", () => {
  it("is sway's `exec`, with the argv as its words", () => {
    expect(exec("kitty", "--hold")).toEqual({
      args: ["exec", "kitty", "--hold"],
      kind: KeyActionKind.SendShell,
    });
  });
});
