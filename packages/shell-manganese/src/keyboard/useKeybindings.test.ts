import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { ShortcutMessage } from "@domicile/chrome-sdk/host-message";
import { KeyAction } from "@domicile/chrome-sdk/key-action";
import type { ShellKeybindings } from "@domicile/chrome-sdk/own-keybindings";
import { act, renderHook } from "@testing-library/react";

import { Direction } from "../window-management/direction";
import type { WindowAction as Action } from "../window-management/window-state";
import { WindowAction } from "../window-management/window-state";
import { useKeybindings } from "./useKeybindings";

/** Meta and the key `keycode`, and nothing else held. */
const meta = (keycode: number): ShortcutMessage => ({
  altKey: false,
  ctrlKey: false,
  keycode,
  metaKey: true,
  shiftKey: false,
});

// Evdev codes, which is all a binding names a key by.
const SPACE = 57;
const L = 38;
const R = 19;
const X = 45;

/** A config of a few of manganese's bindings, as the SDK delivers it. */
const CONFIG = {
  keybindings: new Map([["default", []]]),
  keys: new Map(),
  shells: new Map([
    [
      "manganese",
      {
        keybindings: new Map([
          [
            "default",
            [
              {
                action: KeyAction.SendShell(["launcher"]),
                shortcut: meta(SPACE),
              },
              {
                action: KeyAction.SendShell(["focus", "right"]),
                shortcut: meta(L),
              },
              { action: KeyAction.Mode("resize"), shortcut: meta(R) },
              {
                action: KeyAction.SendShell(["exec", "firefox"]),
                shortcut: meta(X),
              },
            ],
          ],
          [
            "resize",
            [
              {
                action: KeyAction.SendShell(["resize", "grow", "right"]),
                shortcut: meta(L),
              },
            ],
          ],
        ]),
        options: {},
      },
    ],
  ]),
};

/** No keys of the shell's own, so the config's are every key. */
const NONE: ShellKeybindings = {};

/**
 * A stand-in for the client: it takes the handlers the SDK registers and lets
 * a test say what the host said.
 */
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

/** The hook over a client that has been sent {@link CONFIG}. */
const bound = (launcherOpen = false) => {
  const { domicile, says } = client();
  const acted: Action[] = [];
  const modes: string[] = [];
  const reported: string[] = [];
  const { rerender } = renderHook(
    ({ mode }: { mode: string }) => {
      useKeybindings({
        domicile,
        keybindings: NONE,
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
  says("shell_config", CONFIG);
  return { acted, modes, reported, rerender, says };
};

describe("useKeybindings", () => {
  it("does what a `send-shell` binding says", () => {
    const { acted, says } = bound();

    says("shortcut", meta(L));

    expect(acted).toStrictEqual([WindowAction.FocusStepped(Direction.Right)]);
  });

  it("answers only the launcher's own key while it is up", () => {
    // The panel is modal: a window focused behind it is the desktop reacting
    // to keys somebody pressed at the panel.
    const { acted, says } = bound(true);

    says("shortcut", meta(L));
    says("shortcut", meta(SPACE));

    expect(acted).toStrictEqual([WindowAction.LauncherToggled()]);
  });

  it("says which command it does not know, and does nothing", () => {
    const { acted, reported, says } = bound();

    says("shortcut", meta(X));

    expect(acted).toStrictEqual([]);
    expect(reported).toStrictEqual(["manganese: no command `exec firefox`"]);
  });

  it("says when a key enters a mode", () => {
    const { modes, says } = bound();

    says("shortcut", meta(R));

    expect(modes).toStrictEqual(["resize"]);
  });

  it("reads the keys in the mode the desktop is in", () => {
    // Which another page of the desk may have entered.
    const { acted, modes, rerender, says } = bound();

    rerender({ mode: "resize" });
    says("shortcut", meta(L));

    expect(acted).toStrictEqual([WindowAction.WindowGrown(Direction.Right)]);
    expect(modes).toStrictEqual([]);
  });
});
