import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { ShortcutMessage } from "@domicile-desktop/sdk/host-message";
import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { act, renderHook } from "@testing-library/react";

import { Direction } from "../window-management/direction";
import type { WindowAction as Action } from "../window-management/window-state";
import { WindowAction } from "../window-management/window-state";
import { useKeybindings } from "./useKeybindings";

/** A shortcut of Meta plus `keycode`. */
const meta = (keycode: number): ShortcutMessage => ({
  altKey: false,
  ctrlKey: false,
  keycode,
  metaKey: true,
  shiftKey: false,
});

// Evdev key codes.
const SPACE = 57;
const L = 38;
const R = 19;
const X = 45;

/** A sample of manganese's bindings. */
const KEYS: ShellKeybindings = {
  keybindings: {
    "Meta+l": KeyAction.SendShell(["focus", "right"]),
    "Meta+r": KeyAction.Mode("resize"),
    "Meta+space": KeyAction.SendShell(["launcher"]),
    "Meta+x": KeyAction.SendShell(["terminal"]),
  },
  modes: {
    resize: { "Meta+l": KeyAction.SendShell(["resize", "grow", "right"]) },
  },
};

/** Keymap for those keys, as the compositor sends it. */
const KEYBOARD = {
  keys: new Map([
    ["l", L],
    ["r", R],
    ["space", SPACE],
    ["x", X],
  ]),
};

/** Fake client that captures the SDK's handlers so a test can send messages. */
const client = () => {
  const handlers = new Map<string, (message: never) => void>();
  const domicile = {
    grabShortcut: () => undefined,
    off: (type: string) => {
      handlers.delete(type);
    },
    on: (type: string, registered: (message: never) => void) => {
      handlers.set(type, registered);
    },
  } as unknown as DomicileClient;
  return {
    domicile,
    says: (type: string, message: unknown) => {
      act(() => {
        handlers.get(type)?.(message as never);
      });
    },
  };
};

/** Render the hook with a client that has received {@link KEYBOARD}. */
const bound = (launcherOpen = false) => {
  const { domicile, says } = client();
  const acted: Action[] = [];
  const modes: string[] = [];
  const reported: string[] = [];
  const { rerender } = renderHook(
    ({ mode }: { mode: string }) => {
      useKeybindings({
        domicile,
        keybindings: KEYS,
        launcherOpen,
        mode,
        onAction: (action) => {
          acted.push(action);
        },
        onModeChanged: (entered) => {
          modes.push(entered);
        },
        report: (error) => {
          reported.push(error);
        },
      });
    },
    { initialProps: { mode: "default" } },
  );
  says("shell_config", KEYBOARD);
  return { acted, modes, reported, rerender, says };
};

describe("useKeybindings", () => {
  it("does what a `send-shell` binding says", () => {
    const { acted, says } = bound();

    says("shortcut", meta(L));

    expect(acted).toStrictEqual([WindowAction.FocusStepped(Direction.Right)]);
  });

  it("answers only the launcher's own key while it is up", () => {
    // The launcher is modal, so keys must not act on windows behind it.
    const { acted, says } = bound(true);

    says("shortcut", meta(L));
    says("shortcut", meta(SPACE));

    expect(acted).toStrictEqual([WindowAction.LauncherToggled()]);
  });

  it("says which command it does not know, and does nothing", () => {
    const { acted, reported, says } = bound();

    says("shortcut", meta(X));

    expect(acted).toStrictEqual([]);
    expect(reported).toStrictEqual(["manganese: no command `terminal`"]);
  });

  it("says when a key enters a mode", () => {
    const { modes, says } = bound();

    says("shortcut", meta(R));

    expect(modes).toStrictEqual(["resize"]);
  });

  it("reads the keys in the mode the desktop is in", () => {
    // Another page may have entered the mode.
    const { acted, modes, rerender, says } = bound();

    rerender({ mode: "resize" });
    says("shortcut", meta(L));

    expect(acted).toStrictEqual([WindowAction.WindowGrown(Direction.Right)]);
    expect(modes).toStrictEqual([]);
  });
});
