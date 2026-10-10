import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";
import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
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

/** A fake host that records calls and lets a test send window state. */
const client = () => {
  const fake = new FakeDomicileHost();
  const called = (method: string) =>
    fake.calls.filter(([name]) => name === method).map(([, first]) => first);
  return {
    /** A client the compositor announces. */
    announces: (appId: string) => {
      act(() => {
        fake.appear(appId, { title: appId });
      });
    },
    get closed() {
      return called("closeBrowserWindow");
    },
    domicile: fake.host,
    fake,
    /** The window the compositor says has the keyboard. */
    focuses: (appId: string | null) => {
      act(() => {
        fake.set({ focusedWindow: appId });
      });
    },
    /** Sends the engine's list of the desk's browser windows. */
    lists: (windows: readonly DomicileBrowserWindow[]) => {
      act(() => {
        fake.set({ browserWindows: windows });
      });
    },
    get locks() {
      return called("lock");
    },
    get opened() {
      return called("openBrowserWindow");
    },
    get openedPrivately() {
      return called("openPrivateBrowserWindow");
    },
    /** The system calls asking for a screenshot. */
    get screenshots() {
      return fake.calls
        .filter(([name]) => name === "callSystem")
        .map(([, , request]) => JSON.parse(String(request)))
        .filter((request) => request.call === "screenshot");
    },
    get spawned() {
      return called("spawn");
    },
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

  it("is reduced from what the host lists, whole", () => {
    const { host, result } = desktop([LEFT, RIGHT]);
    host.announces("kitty");
    host.announces("foot");

    act(() => {
      host.fake.close("kitty");
    });

    expect(result.current.windows.map(({ id }) => id)).toEqual([
      appWindowId("foot"),
    ]);
  });

  it("follows the keyboard where the host says it is", () => {
    const { host, result } = desktop([LEFT, RIGHT]);
    host.announces("kitty");
    host.announces("foot");

    host.focuses("kitty");
    expect(result.current.focusedId).toBe(appWindowId("kitty"));

    host.focuses(null);
    expect(result.current.focusedId).toBeUndefined();
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
    isApp: false,
    isPrivate: false,
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
      result.current.act(
        WindowAction.BrowserOpened("https://example.com/", false),
      );
    });

    expect(host.opened).toEqual(["https://example.com/"]);
  });

  it("are asked for privately, for a private window", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(
        WindowAction.BrowserOpened("https://example.com/", true),
      );
    });

    expect(host.openedPrivately).toEqual(["https://example.com/"]);
    expect(host.opened).toEqual([]);
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

  it("asks the compositor for a screenshot through the shell's dialog", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.ScreenshotTaken());
    });

    expect(host.screenshots).toEqual([{ call: "screenshot" }]);
  });

  it("runs the command of an application the launcher chose", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.AppLaunched(["gedit", "--new-window"]));
    });

    expect(host.spawned).toEqual([["gedit", "--new-window"]]);
  });

  it("opens a file the launcher chose with what opens it", async () => {
    const host = client();
    const displays = [LEFT, RIGHT];
    const openFile = (_system: unknown, path: string) =>
      Promise.resolve(["pager", `/home/me/${path}`]);
    const { result } = renderHook(() =>
      useWindows(host.domicile, displays, openFile),
    );

    await act(async () => {
      result.current.act(WindowAction.FileOpened("Notes/today.txt"));
      await Promise.resolve();
    });

    expect(result.current.launcherOpen).toBe(false);
    expect(host.spawned).toEqual([["pager", "/home/me/Notes/today.txt"]]);
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
