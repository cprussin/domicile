import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";
import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import type { FloatingOptions } from "./floating/floating-rules";
import { floatingRulesSchema } from "./floating/floating-rules";
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

const desktop = (
  displays: readonly Display[] | undefined,
  floating: FloatingOptions = [],
) => {
  const host = client();
  const rules = floatingRulesSchema.parse(floating);
  const view = renderHook(() => useWindows(host.domicile, displays, rules));
  return { ...view, host };
};

describe("the desktop", () => {
  it("asks the compositor to sync frames, since its windows render them", () => {
    const { host } = desktop([LEFT]);

    expect(host.fake.calls).toContainEqual(["syncFrames"]);
  });

  it("shows each window at the synced frame the host lists", () => {
    const { host, result } = desktop([LEFT]);
    host.announces("kitty");

    act(() => {
      host.fake.change("kitty", { frame: 2 });
    });

    expect(result.current.windows).toMatchObject([{ syncedFrame: 2 }]);
  });

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

  it("floats a window a floating rule names", () => {
    const { host, result } = desktop([LEFT], [{ app: "pinentry" }]);

    act(() => {
      host.fake.appear("pin", {
        desktopId: "pinentry-qt",
        height: 300,
        width: 400,
      });
    });

    expect(
      workspaceOn(result.current, "left").floats.map(({ width }) => width),
    ).toEqual([400]);
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

describe("a client's window requests", () => {
  /** Answer the page's `window_requests` call, and return its id. */
  const listening = (host: ReturnType<typeof client>): number => {
    const found = host.fake.calls.find(
      ([name, , request]) =>
        name === "callSystem" &&
        JSON.parse(String(request)).call === "window_requests",
    );
    if (found === undefined) {
      throw new Error("test: the desktop does not listen for window requests");
    } else {
      const id = Number(found[1]);
      host.fake.dispatch("system", {
        data: JSON.stringify({
          id,
          reply: { kind: "started" },
          type: "system_reply",
        }),
      });
      return id;
    }
  };

  /** The compositor reports `request` from `appId`'s client. */
  const asks = async (
    host: ReturnType<typeof client>,
    id: number,
    appId: string,
    request: object,
  ) => {
    await act(async () => {
      host.fake.dispatch("system", {
        data: JSON.stringify({
          event: { app_id: appId, kind: "window_request", request },
          id,
          type: "system_event",
        }),
      });
      await Bun.sleep(0);
    });
  };

  it("fill the screen while the client asks for fullscreen", async () => {
    const { host, result } = desktop([LEFT]);
    host.announces("mpv");
    const id = listening(host);

    await asks(host, id, "mpv", { display: null, kind: "fullscreen" });
    expect(workspaceOn(result.current, "left").fullscreen?.id).toBe(
      appWindowId("mpv"),
    );

    await asks(host, id, "mpv", { kind: "unfullscreen" });
    expect(workspaceOn(result.current, "left").fullscreen).toBeUndefined();
  });

  it("leave a tiled window as it is when the client asks to maximize", async () => {
    const { host, result } = desktop([LEFT]);
    host.announces("gedit");
    const id = listening(host);
    const before = result.current;

    await asks(host, id, "gedit", { kind: "maximize" });

    expect(result.current.workspaces).toBe(before.workspaces);
  });
});

describe("the desk's browser windows", () => {
  const EXAMPLE: DomicileBrowserWindow = {
    height: 0,
    id: "1",
    isApp: false,
    isCaptured: false,
    isPrivate: false,
    partition: "",
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

  it("is run by one function for the desktop's life", () => {
    // Listeners that run commands, such as the pointer's, are added once.
    const { host, result } = desktop([LEFT, RIGHT]);
    const { act: run } = result.current;

    host.announces("kitty");

    expect(result.current.act).toBe(run);
  });

  it("kills the window being worked in now, not when the function was made", () => {
    const { host, result } = desktop([LEFT, RIGHT]);
    const { act: run } = result.current;
    host.announces("kitty");
    host.announces("foot");

    act(() => {
      run(WindowAction.WindowKilled());
    });

    expect(
      host.fake.calls
        .filter(([name]) => name === "closeApp")
        .map(([, appId]) => appId),
    ).toEqual(["foot"]);
  });

  it("kills every window in the group `focus parent` selected", () => {
    const { host, result } = desktop([LEFT, RIGHT]);
    host.announces("kitty");
    host.announces("foot");

    act(() => {
      result.current.act(WindowAction.ParentFocused());
    });
    act(() => {
      result.current.act(WindowAction.WindowKilled());
    });

    expect(
      host.fake.calls
        .filter(([name]) => name === "closeApp")
        .map(([, appId]) => appId),
    ).toEqual(["kitty", "foot"]);
  });

  it("closes every window in a group closed from its tab", () => {
    const { host, result } = desktop([LEFT, RIGHT]);
    host.announces("kitty");
    host.announces("foot");

    act(() => {
      result.current.act(
        WindowAction.GroupClosed({ id: appWindowId("foot"), up: 1 }),
      );
    });

    expect(
      host.fake.calls
        .filter(([name]) => name === "closeApp")
        .map(([, appId]) => appId),
    ).toEqual(["kitty", "foot"]);
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

  describe("searching the clipboard", () => {
    const searched = (copied: readonly string[]) => {
      const { host, result } = desktop([LEFT, RIGHT]);
      act(() => {
        host.fake.set({
          clipboard: copied.map((preview, at) => ({ id: at, preview })),
        });
      });

      act(() => {
        result.current.act(WindowAction.ClipboardSearched());
      });

      return host.opened;
    };

    it("opens the newest copy as a site when it is a URL", () => {
      expect(searched(["example.com/page", "older words"])).toEqual([
        "https://example.com/page",
      ]);
    });

    it("searches Google for the newest copy otherwise", () => {
      expect(searched(["hello world", "example.com"])).toEqual([
        "https://google.com/search?q=hello%20world",
      ]);
    });

    it("opens nothing when nothing was copied", () => {
      expect(searched([])).toEqual([]);
    });

    it("opens a private window from a private one", () => {
      const { host, result } = desktop([LEFT, RIGHT]);
      host.lists([
        {
          height: 0,
          id: "1",
          isApp: false,
          isCaptured: false,
          isPrivate: true,
          partition: "",
          popupWindow: null,
          title: "",
          url: "https://example.com/",
          width: 0,
        },
      ]);
      act(() => {
        host.fake.set({ clipboard: [{ id: 0, preview: "hello world" }] });
      });

      act(() => {
        result.current.act(WindowAction.ClipboardSearched());
      });

      expect(host.openedPrivately).toEqual([
        "https://google.com/search?q=hello%20world",
      ]);
      expect(host.opened).toEqual([]);
    });
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
      useWindows(
        host.domicile,
        displays,
        floatingRulesSchema.parse([]),
        openFile,
      ),
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
