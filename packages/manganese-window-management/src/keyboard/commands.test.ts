import { describe, expect, it } from "bun:test";
import { KeyActionKind } from "@domicile-desktop/sdk/key-action";

import { parseCommand } from "./command";
import {
  brightness,
  DEFAULT_KEYBINDINGS,
  DEFAULT_MODES,
  exec,
  micMute,
  screenshot,
  searchClipboard,
  volume,
} from "./commands";

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

  it("take a screenshot on Print", () => {
    expect(DEFAULT_KEYBINDINGS.Print).toEqual(screenshot());
    expect(screenshot()).toEqual({
      args: ["screenshot"],
      kind: KeyActionKind.SendShell,
    });
  });

  it("change the volume and brightness on the media keys", () => {
    expect(DEFAULT_KEYBINDINGS).toMatchObject({
      XF86AudioLowerVolume: volume("down"),
      XF86AudioMicMute: micMute(),
      XF86AudioMute: volume("mute"),
      XF86AudioRaiseVolume: volume("up"),
      XF86MonBrightnessDown: brightness("down"),
      XF86MonBrightnessUp: brightness("up"),
    });
    expect([volume("up"), micMute(), brightness("down")]).toEqual([
      { args: ["volume", "up"], kind: KeyActionKind.SendShell },
      { args: ["mic", "mute"], kind: KeyActionKind.SendShell },
      { args: ["brightness", "down"], kind: KeyActionKind.SendShell },
    ]);
  });

  it("search the clipboard on Meta+Shift+space", () => {
    expect(DEFAULT_KEYBINDINGS["Meta+Shift+space"]).toEqual(searchClipboard());
    expect(searchClipboard()).toEqual({
      args: ["search-clipboard"],
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
