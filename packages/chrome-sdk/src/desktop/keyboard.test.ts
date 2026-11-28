import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { KeymapChoice } from "../keymap-choice";
import { desktop } from "./desktop";
import { pointer } from "./pointer";

const pressed = {
  altKey: false,
  chord: "Meta+Return",
  ctrlKey: false,
  keycode: 28,
  metaKey: true,
  shiftKey: false,
};

describe("keyboard", () => {
  it("reads no modifiers until the compositor says", () => {
    expect(
      desktop(new FakeDomicileHost().host).keyboard.modifiers,
    ).toBeUndefined();
  });

  it("reads the seat's modifiers", () => {
    const fake = new FakeDomicileHost();
    fake.set({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: true });

    expect(desktop(fake.host).keyboard.modifiers).toStrictEqual({
      alt: false,
      ctrl: true,
      meta: false,
      shift: true,
    });
  });

  it("grabs and gives back chords", () => {
    const fake = new FakeDomicileHost();
    const { keyboard } = desktop(fake.host);
    keyboard.grab("Meta+Return");
    keyboard.ungrab("Meta+Return");

    expect(fake.calls).toStrictEqual([
      ["grabShortcut", "Meta+Return"],
      ["ungrabShortcut", "Meta+Return"],
    ]);
  });

  it("grabs a chord that stays the shell's while a window inhibits", () => {
    const fake = new FakeDomicileHost();
    const { keyboard } = desktop(fake.host);
    keyboard.grab("Meta+Escape", { whileInhibited: true });

    expect(fake.calls).toStrictEqual([["grabShortcut", "Meta+Escape", true]]);
  });

  it("grabs a tap held no longer than it says", () => {
    const fake = new FakeDomicileHost();
    const { keyboard } = desktop(fake.host);
    keyboard.grab("Meta", { longestTap: 500 });
    keyboard.grab("Alt", { longestTap: 200, whileInhibited: true });

    expect(fake.calls).toStrictEqual([
      ["grabShortcut", "Meta", false, 500],
      ["grabShortcut", "Alt", true, 200],
    ]);
  });

  it("hears a grabbed chord pressed and let go", async () => {
    const fake = new FakeDomicileHost();
    const { keyboard } = desktop(fake.host);
    const press = new Promise((resolve) => {
      keyboard.on("shortcut", resolve);
    });
    const release = new Promise((resolve) => {
      keyboard.on("shortcutrelease", resolve);
    });
    fake.dispatch("shortcut", pressed);
    fake.dispatch("shortcutrelease", pressed);

    expect(await press).toStrictEqual(pressed);
    expect(await release).toStrictEqual(pressed);
  });

  it("says the modifiers changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).keyboard.on("modifierschange", () => {
        resolve(undefined);
      });
    });
    fake.set({ altKey: true });

    expect(await changed).toBeUndefined();
  });
});

describe("pointer", () => {
  it("warps a pointer that is over one of the boxes", () => {
    // The page cannot see the pointer over a browser window's page; the
    // engine can.
    const fake = new FakeDomicileHost();
    desktop(fake.host).pointer.warp(10, 20, [
      { height: 4, width: 3, x: 1, y: 2 },
    ]);

    expect(fake.calls).toStrictEqual([
      ["warpPointer", 10, 20, [new DOMRectReadOnly(1, 2, 3, 4)], undefined],
    ]);
  });

  it("asks the engine to leave a pointer that is over a box", () => {
    const fake = new FakeDomicileHost();
    desktop(fake.host).pointer.warp(10, 20, [], {
      height: 4,
      width: 3,
      x: 1,
      y: 2,
    });

    expect(fake.calls).toStrictEqual([
      ["warpPointer", 10, 20, [], new DOMRectReadOnly(1, 2, 3, 4)],
    ]);
  });

  it("asks the engine to hold the pointer in boxes, and to let go", () => {
    const fake = new FakeDomicileHost();
    const { pointer } = desktop(fake.host);
    pointer.confine([{ height: 4, width: 3, x: 1, y: 2 }]).catch(() => {
      /* never answered */
    });
    pointer.confine([]).catch(() => {
      /* never answered */
    });

    expect(fake.calls).toStrictEqual([
      ["confinePointer", [new DOMRectReadOnly(1, 2, 3, 4)]],
      ["confinePointer", []],
    ]);
  });

  it("asks the engine where the pointer is, and hears it is off the desk", async () => {
    const answering = (at: DOMPointReadOnly | null) => ({
      addEventListener: () => undefined,
      confinePointer: () => Promise.resolve(false),
      pointerPosition: () => Promise.resolve(at),
      removeEventListener: () => undefined,
      warpPointer: () => undefined,
      watchedPointer: null,
      watchPointer: () => undefined,
    });

    expect(
      await pointer(answering(new DOMPointReadOnly(12.5, 40))).position(),
    ).toStrictEqual({ x: 12.5, y: 40 });
    expect(await pointer(answering(null)).position()).toBeUndefined();
  });

  it("follows the pointer only while something follows it", () => {
    const fake = new FakeDomicileHost();
    const heard: unknown[] = [];
    const stop = desktop(fake.host).pointer.follow((at) => heard.push(at));
    fake.set({ watchedPointer: new DOMPointReadOnly(3, 4) });
    fake.set({ watchedPointer: null });
    stop();
    stop();
    fake.set({ watchedPointer: new DOMPointReadOnly(5, 6) });

    expect(heard).toStrictEqual([{ x: 3, y: 4 }, undefined]);
    expect(fake.calls).toStrictEqual([
      ["watchPointer", true],
      ["watchPointer", false],
    ]);
  });

  it("tells a later follower the place the engine said, off the desk too", async () => {
    const fake = new FakeDomicileHost();
    const first = pointer(fake.host).follow(() => undefined);
    fake.set({ watchedPointer: null });
    fake.dispatch("watchedpointerchanged");
    const heard: unknown[] = [];
    const second = pointer(fake.host).follow((at) => heard.push(at));
    await Promise.resolve();
    first();
    second();

    expect(heard).toStrictEqual([undefined]);
  });

  it("watches again after the last follower stopped", () => {
    const fake = new FakeDomicileHost();
    pointer(fake.host).follow(() => undefined)();
    pointer(fake.host).follow(() => undefined)();

    expect(fake.calls).toStrictEqual([
      ["watchPointer", true],
      ["watchPointer", false],
      ["watchPointer", true],
      ["watchPointer", false],
    ]);
  });

  it("counts no follower when the engine refuses the watch", () => {
    let refuse = true;
    const host = {
      addEventListener: () => undefined,
      confinePointer: () => Promise.resolve(false),
      pointerPosition: () => Promise.resolve(null),
      removeEventListener: () => undefined,
      warpPointer: () => undefined,
      watchedPointer: null,
      watchPointer: (watching: boolean) => {
        if (watching && refuse) {
          throw new Error("not ready");
        }
        watched.push(watching);
      },
    };
    const watched: boolean[] = [];
    expect(() => pointer(host).follow(() => undefined)).toThrow("not ready");
    refuse = false;
    pointer(host).follow(() => undefined);

    expect(watched).toStrictEqual([true]);
  });

  it("keeps watching until the last follower stops", async () => {
    const fake = new FakeDomicileHost();
    const first = pointer(fake.host).follow(() => undefined);
    fake.set({ watchedPointer: new DOMPointReadOnly(1, 2) });
    const heard: unknown[] = [];
    const second = pointer(fake.host).follow((at) => heard.push(at));
    await Promise.resolve();
    first();

    expect(heard).toStrictEqual([{ x: 1, y: 2 }]);
    expect(fake.calls).toStrictEqual([["watchPointer", true]]);
    second();
    expect(fake.calls).toStrictEqual([
      ["watchPointer", true],
      ["watchPointer", false],
    ]);
  });

  it("hears the keymaps and switches them through the compositor", async () => {
    const fake = new FakeDomicileHost();
    const { keyboard } = desktop(fake.host);
    keyboard.keymaps().catch(() => {
      /* never answered */
    });
    keyboard.selectKeymap(KeymapChoice.Next()).catch(() => {
      /* never answered */
    });
    await Promise.resolve();

    expect(fake.calls).toStrictEqual([
      ["callSystem", 1, JSON.stringify({ call: "keymaps" })],
      [
        "callSystem",
        2,
        JSON.stringify({ call: "select_keymap", keymap: { kind: "next" } }),
      ],
    ]);
  });
});
