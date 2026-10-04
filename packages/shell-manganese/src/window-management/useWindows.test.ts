import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import { act, renderHook } from "@testing-library/react";

import { useWindows } from "./useWindows";
import { appWindowId, browserWindowId } from "./window";
import { currentHere, WindowAction, workspaceOn } from "./window-state";
import { windowsOn } from "./workspace";

const LEFT: Display = {
  name: "left",
  position: [0, 0],
  scale: 1,
  size: [1920, 1080],
};

const RIGHT: Display = { ...LEFT, name: "right", position: [1920, 0] };

/**
 * A fake client that captures the hook's handlers so a test can emit
 * compositor events. It implements only the three members the hook uses.
 */
const client = () => {
  const handlers = new Map<string, (message: never) => void>();
  const spawned: (readonly string[])[] = [];
  const locks: undefined[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const domicile = {
    closeApp: () => undefined,
    closeBrowserWindow: (id: string) => {
      closed.push(id);
    },
    lock: () => {
      locks.push(undefined);
    },
    on: (type: string, registered: (message: never) => void) => {
      handlers.set(type, registered);
    },
    openBrowserWindow: (url: string) => {
      opened.push(url);
    },
    spawn: (command: readonly string[]) => {
      spawned.push(command);
    },
  } as unknown as DomicileClient;

  return {
    /** A client the compositor announces. */
    announces: (appId: string) => {
      act(() => {
        handlers.get("app_appeared")?.({
          app_id: appId,
          title: appId,
        } as never);
      });
    },
    closed,
    domicile,
    /** Sends the engine's list of the desk's browser windows. */
    lists: (windows: readonly DomicileBrowserWindow[]) => {
      act(() => {
        handlers.get("browser_windows")?.({ windows } as never);
      });
    },
    locks,
    opened,
    spawned,
  };
};

const desktop = (displays: readonly Display[] | undefined) => {
  const host = client();
  const view = renderHook(() => useWindows(host.domicile, displays));
  return { ...view, host };
};

describe("the desktop", () => {
  it("is reduced from the compositor's events", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    host.announces("kitty");

    expect(result.current.windows.map(({ id }) => id)).toEqual([
      appWindowId("kitty"),
    ]);
  });

  it("takes up the screens the host describes", () => {
    const { result } = desktop([LEFT, RIGHT]);

    expect(
      result.current.screens.map(({ box, name }) => ({ box, name })),
    ).toEqual([
      { box: { height: 1080, width: 1920, x: 0, y: 0 }, name: "left" },
      { box: { height: 1080, width: 1920, x: 1920, y: 0 }, name: "right" },
    ]);
  });
});

describe("the desk's browser windows", () => {
  const EXAMPLE: DomicileBrowserWindow = {
    height: 0,
    id: "1",
    popupWindow: null,
    title: "",
    url: "https://example.com/",
    width: 0,
  };

  it("are drawn as the engine lists them", () => {
    // `domicile open-url`, a page's target="_blank" and the bar's `+` each
    // reach the shell as a window the engine opened and listed.
    const { host, result } = desktop([LEFT, RIGHT]);

    host.lists([EXAMPLE]);

    expect(result.current.windows).toContainEqual(
      expect.objectContaining({ url: "https://example.com/" }),
    );
  });

  it("are asked for, because the engine opens them", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.BrowserOpened("https://example.com/"));
    });

    expect(host.opened).toEqual(["https://example.com/"]);
  });

  it("are asked to close, because the engine closes them", () => {
    const { host, result } = desktop([LEFT, RIGHT]);
    host.lists([EXAMPLE]);

    act(() => {
      result.current.act(WindowAction.WindowClosed(browserWindowId("1")));
    });

    expect(host.closed).toEqual(["1"]);
  });
});

describe("a command", () => {
  it("is run", () => {
    const { result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.WorkspaceSelected("4"));
    });

    expect(currentHere(result.current)).toBe("4");
  });

  it("takes what only the compositor can do with it", () => {
    // An `exec` is a process the compositor starts.
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.CommandExecuted(["foot", "-e", "htop"]));
    });

    expect(host.spawned).toEqual([["foot", "-e", "htop"]]);
  });

  it("asks the compositor to lock the desk", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.DeskLocked());
    });

    expect(host.locks).toHaveLength(1);
  });

  it("runs the command of an application the launcher chose", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.AppLaunched(["gedit", "--new-window"]));
    });

    expect(host.spawned).toEqual([["gedit", "--new-window"]]);
  });

  it("opens a window on the screen the keyboard is on", () => {
    // End to end: focus moves to the second screen, and a new client is laid
    // out there.
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.WorkspaceSelected("2"));
    });
    host.announces("kitty");

    expect(result.current.focused).toBe("right");
    expect(windowsOn(workspaceOn(result.current, "right"))).toEqual([
      appWindowId("kitty"),
    ]);
  });
});
