import { describe, expect, it } from "bun:test";
import { KeyActionKind } from "@domicile/sdk/key-action";

import { parseCommand } from "./command";
import { DEFAULT_KEYBINDINGS, DEFAULT_MODES } from "./commands";

describe("manganese's default keys", () => {
  // Every binding a desk gets without asking has to be a command this shell
  // answers: a default that said "unknown command" would be a key that does
  // nothing on every desk.
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

  it("are sway's: the terminal on Meta+Return, workspaces on Meta and a digit", () => {
    expect(DEFAULT_KEYBINDINGS["Meta+Return"]?.kind).toBe(
      KeyActionKind.SendShell,
    );
    expect(DEFAULT_KEYBINDINGS["Meta+1"]).toEqual({
      args: ["workspace", "1"],
      kind: KeyActionKind.SendShell,
    });
    expect(DEFAULT_KEYBINDINGS["Meta+0"]).toEqual({
      args: ["workspace", "10"],
      kind: KeyActionKind.SendShell,
    });
  });
});
