import { describe, expect, it } from "bun:test";
import type { Display } from "@domicile-desktop/component-library/display-source";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
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

/** A host the test says windows and addresses through. */
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
    domicile: fake.host,
    fake,
    /** The window the compositor says has the keyboard. */
    focuses: (appId: string | null) => {
      act(() => {
        fake.set({ focusedWindow: appId });
      });
    },
    get locks() {
      return called("lock");
    },
    /** `domicile open-url`. */
    opens: (url: string) => {
      act(() => {
        fake.dispatch("openurl", { url });
      });
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
