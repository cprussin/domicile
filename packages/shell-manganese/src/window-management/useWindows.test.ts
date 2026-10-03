import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile/component-library/display-source";
import type { DomicileClient } from "@domicile/sdk/domicile-client";
import { act, renderHook } from "@testing-library/react";

import { useWindows } from "./useWindows";
import { appWindowId } from "./window";
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
 * A stand-in for the client: it takes the handlers this hook registers and
 * lets a test say what the compositor said.
 *
 * Narrower than a `DomicileClient` because the hook uses three of its members,
 * and a double that implemented the other fifteen would be claiming a seam
 * that size.
 */
const client = () => {
  const handlers = new Map<string, (message: never) => void>();
  const spawned: (readonly string[])[] = [];
  const locks: undefined[] = [];
  const domicile = {
    closeApp: () => undefined,
    lock: () => {
      locks.push(undefined);
    },
    on: (type: string, registered: (message: never) => void) => {
      handlers.set(type, registered);
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
    domicile,
    locks,
    /** `domicile open-url`. */
    opens: (url: string) => {
      act(() => {
        handlers.get("open_url")?.({ url } as never);
      });
    },
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

describe("an address somebody asked the desk to open", () => {
  it("is a browser window", () => {
    const { host, result } = desktop([LEFT, RIGHT]);

    host.opens("https://example.com/");

    expect(result.current.windows).toContainEqual(
      expect.objectContaining({ src: "https://example.com/" }),
    );
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
    // A terminal is a process the compositor starts.
    const { host, result } = desktop([LEFT, RIGHT]);

    act(() => {
      result.current.act(WindowAction.TerminalLaunched());
    });

    expect(host.spawned).toEqual([["kitty"]]);
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
    // The whole of what a desk of several monitors is for, end to end: the
    // keyboard is moved to the second screen and the client that appears is
    // laid out there.
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
