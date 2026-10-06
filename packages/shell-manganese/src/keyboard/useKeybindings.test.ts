import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { KeyAction } from "@domicile-desktop/sdk/key-action";
import type { ShellKeybindings } from "@domicile-desktop/sdk/own-keybindings";
import { act, renderHook } from "@testing-library/react";

import { Direction } from "../window-management/direction";
import type { WindowAction as Action } from "../window-management/window-state";
import { WindowAction } from "../window-management/window-state";
import { useKeybindings } from "./useKeybindings";

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

/** A fake host whose chord presses a test sends. */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
    domicile: fake.host,
    presses: (chord: string) => {
      act(() => {
        fake.dispatch("shortcut", { chord });
      });
    },
  };
};

/** Render the hook over a fake host. */
const bound = (launcherOpen = false) => {
  const { domicile, presses } = client();
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
  return { acted, modes, presses, reported, rerender };
};

describe("useKeybindings", () => {
  it("does what a `send-shell` binding says", () => {
    const { acted, presses } = bound();

    presses("Meta+l");

    expect(acted).toStrictEqual([WindowAction.FocusStepped(Direction.Right)]);
  });

  it("answers only the launcher's own key while it is up", () => {
    // The launcher is modal, so keys must not act on windows behind it.
    const { acted, presses } = bound(true);

    presses("Meta+l");
    presses("Meta+space");

    expect(acted).toStrictEqual([WindowAction.LauncherToggled()]);
  });

  it("says which command it does not know, and does nothing", () => {
    const { acted, reported, presses } = bound();

    presses("Meta+x");

    expect(acted).toStrictEqual([]);
    expect(reported).toStrictEqual(["manganese: no command `terminal`"]);
  });

  it("says when a key enters a mode", () => {
    const { modes, presses } = bound();

    presses("Meta+r");

    expect(modes).toStrictEqual(["resize"]);
  });

  it("reads the keys in the mode the desktop is in", () => {
    // Another page may have entered the mode.
    const { acted, modes, rerender, presses } = bound();

    rerender({ mode: "resize" });
    presses("Meta+l");

    expect(acted).toStrictEqual([WindowAction.WindowGrown(Direction.Right)]);
    expect(modes).toStrictEqual([]);
  });
});
