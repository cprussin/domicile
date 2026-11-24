import { describe, expect, it } from "bun:test";
import type { ClientWindow } from "@domicile-desktop/sdk/desktop/windows";
import { listedWindow } from "@domicile-desktop/sdk/fake-host";

import type { LockingDocument, LockingWindows } from "./pointer-lock";
import { followPointerLock, lockFor } from "./pointer-lock";

/** Windows the test changes, recording what the shell tells the compositor. */
const fakeWindows = (list: ClientWindow[], focused: string | undefined) => {
  const listeners = new Set<() => void>();
  const told: [string, boolean][] = [];
  const state = { focused, list };
  const windows: LockingWindows = {
    get focused() {
      return state.focused;
    },
    get list() {
      return state.list;
    },
    on: (_type, listener) => {
      const call = () => {
        (listener as () => void)();
      };
      listeners.add(call);
      return () => listeners.delete(call);
    },
    pointerConstrained: (appId, active) => {
      told.push([appId, active]);
    },
  };
  const change = (next: Partial<typeof state>) => {
    Object.assign(state, next);
    for (const listener of listeners) {
      listener();
    }
  };
  return { change, listeners, told, windows };
};

/**
 * A page whose `<app>` elements lock the pointer as the engine grants it: at
 * once, firing `pointerlockchange`.
 */
const fakePage = (appIds: string[]) => {
  let locked: Element | null = null;
  let onChange: (() => void) | undefined;
  const asked: string[] = [];
  const lock = (element: Element | null) => {
    locked = element;
    onChange?.();
  };
  const elements = new Map(
    appIds.map((appId) => {
      const element = {
        getAttribute: () => appId,
        localName: "app",
        requestPointerLock: () => {
          asked.push(appId);
          lock(element as unknown as Element);
          return Promise.resolve();
        },
      };
      return [appId, element as unknown as Element];
    }),
  );
  const page = {
    addEventListener: (_type: string, listener: () => void) => {
      onChange = listener;
    },
    exitPointerLock: () => {
      lock(null);
    },
    get pointerLockElement() {
      return locked;
    },
    querySelectorAll: () => [...elements.values()],
    removeEventListener: () => {
      onChange = undefined;
    },
  } as unknown as LockingDocument;
  return { asked, page };
};

describe("lockFor", () => {
  it("locks for the focused window that asked", () => {
    expect(
      lockFor([listedWindow("game", { pointerConstraint: "lock" })], "game"),
    ).toBe("game");
  });

  it("does not lock for a window without the keyboard", () => {
    expect(
      lockFor([listedWindow("game", { pointerConstraint: "lock" })], "term"),
    ).toBeUndefined();
  });

  it("does not take a confinement", () => {
    expect(
      lockFor([listedWindow("game", { pointerConstraint: "confine" })], "game"),
    ).toBeUndefined();
  });
});

describe("followPointerLock", () => {
  it("locks the focused window that asked and says so", () => {
    const { told, windows } = fakeWindows(
      [listedWindow("game", { pointerConstraint: "lock" })],
      "game",
    );
    const { asked, page } = fakePage(["game"]);

    followPointerLock(windows, page);

    expect(asked).toEqual(["game"]);
    expect(told).toEqual([["game", true]]);
  });

  it("lets go when the keyboard moves away, and says so", () => {
    const { change, told, windows } = fakeWindows(
      [
        listedWindow("game", { pointerConstraint: "lock" }),
        listedWindow("term"),
      ],
      "game",
    );
    const { page } = fakePage(["game", "term"]);
    followPointerLock(windows, page);

    change({ focused: "term" });

    expect(page.pointerLockElement).toBeNull();
    expect(told).toEqual([
      ["game", true],
      ["game", false],
    ]);
  });

  it("lets go when the client withdraws its ask", () => {
    const { change, told, windows } = fakeWindows(
      [listedWindow("game", { pointerConstraint: "lock" })],
      "game",
    );
    const { page } = fakePage(["game"]);
    followPointerLock(windows, page);

    change({ list: [listedWindow("game")] });

    expect(told).toEqual([
      ["game", true],
      ["game", false],
    ]);
  });

  it("reports nothing held while the window has no element", () => {
    const { told, windows } = fakeWindows(
      [listedWindow("game", { pointerConstraint: "lock" })],
      "game",
    );
    const { page } = fakePage([]);

    followPointerLock(windows, page);

    expect(told).toEqual([]);
  });

  it("lets go and stops listening when unsubscribed", () => {
    const { listeners, told, windows } = fakeWindows(
      [listedWindow("game", { pointerConstraint: "lock" })],
      "game",
    );
    const { page } = fakePage(["game"]);
    const stop = followPointerLock(windows, page);

    stop();

    expect(listeners.size).toBe(0);
    expect(page.pointerLockElement).toBeNull();
    expect(told).toEqual([
      ["game", true],
      ["game", false],
    ]);
  });
});
