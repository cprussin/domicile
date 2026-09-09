import { describe, expect, it } from "bun:test";

import type {
  DomicileAppEvent,
  DomicileAppTitledEvent,
  DomicileModifiersEvent,
  DomicileShortcutEvent,
} from "./domicile-host";
import {
  appAppeared,
  appCursor,
  appResized,
  appTitled,
  focusChanged,
  modifiers,
  shortcut,
} from "./host-message";

/** The fields a `DomicileAppEvent` carries, all of them optional to a test. */
type AppEventFields = Partial<Omit<DomicileAppEvent, keyof Event>>;

/**
 * A `DomicileAppEvent`, with the fields that event does not carry left as what
 * the engine fills them with: the empty string, and a zero behind a false
 * `hasSize`.
 *
 * `Object.assign` onto an `Event` rather than a subclass per event type: what
 * these functions read is the fields, and five classes saying that would be a
 * test of the test.
 */
const appEvent = (type: string, fields: AppEventFields): DomicileAppEvent =>
  Object.assign(new Event(type), {
    appId: "",
    cursor: "",
    hasSize: false,
    height: 0,
    title: "",
    width: 0,
    ...fields,
  });

describe("a window appearing", () => {
  it("has no size until the client has drawn", () => {
    // `hasSize` rather than the numbers, which are zero — and that zero is the
    // one shape a shell must not read as a size. A toplevel maps before it
    // draws, and how big a Wayland client wants to be is something it says by
    // drawing; a chrome that believed the zero would open the window at
    // nothing at all, which is what happened when absence was spelled `[0, 0]`.
    expect(
      appAppeared(appEvent("appappeared", { appId: "term" })).size,
    ).toBeUndefined();
  });

  it("carries the size once there is one", () => {
    expect(
      appAppeared(
        appEvent("appappeared", {
          appId: "term",
          hasSize: true,
          height: 480,
          width: 640,
        }),
      ),
    ).toStrictEqual({ app_id: "term", size: [640, 480], title: undefined });
  });
});

describe("a window's name", () => {
  it("is nothing when nobody has named it", () => {
    // The empty string is the only way the engine can say "no name", and it
    // covers two clients that mean it differently — one that has not sent
    // `set_title` yet, and one that named its window *nothing*, which
    // `xdg_toplevel.set_title("")` is the only way to say. Both are the same
    // nothing to a chrome that draws names, and this is where they become it
    // rather than at every place a name is drawn.
    expect(
      appTitled(titledEvent({ appId: "term", title: "" })).title,
    ).toBeUndefined();
  });

  it("is the name when there is one", () => {
    expect(
      appTitled(titledEvent({ appId: "term", title: "Terminal" })),
    ).toStrictEqual({ app_id: "term", title: "Terminal" });
  });
});

describe("a resize", () => {
  it("keeps the fractions, because a CSS pixel has them", () => {
    // Doubles the whole way across. This comes from a layout box, and reading
    // it as an integer is what left every window configured at zero.
    expect(
      appResized(
        appEvent("appresized", {
          appId: "term",
          hasSize: true,
          height: 600.25,
          width: 800.5,
        }),
      ),
    ).toStrictEqual({ app_id: "term", size: [800.5, 600.25] });
  });
});

describe("focus moving", () => {
  it("reads an empty app id as the chrome holding the keyboard", () => {
    // An answer, and one a desktop draws differently from any window being
    // active — not an absence to be skipped over.
    expect(focusChanged(appEvent("focuschanged", { appId: "" }))).toStrictEqual(
      {
        app_id: undefined,
      },
    );
  });

  it("names the window that has it otherwise", () => {
    expect(
      focusChanged(appEvent("focuschanged", { appId: "term" })),
    ).toStrictEqual({ app_id: "term" });
  });
});

describe("a cursor a client asked for", () => {
  it("refuses a keyword CSS does not know", () => {
    // The one value on the typed surface that is still a string the engine
    // does not check — WebIDL has enums and `DomicileAppEvent.cursor` is not
    // declared as one. Assigning an unknown keyword to `style.cursor` is a
    // silent no-op, so without this the symptom is an arrow where a hand
    // should be, on one client, with nothing said anywhere.
    expect(() => {
      appCursor(appEvent("appcursor", { appId: "term", cursor: "pointr" }));
    }).toThrow();
  });

  it("passes a keyword it does know", () => {
    expect(
      appCursor(appEvent("appcursor", { appId: "term", cursor: "grabbing" })),
    ).toStrictEqual({ app_id: "term", cursor: "grabbing" });
  });
});

describe("a claimed press", () => {
  it("comes back with the fields it was claimed with", () => {
    // The same shape in both directions is the point of the dictionary: a
    // shell compares what it grabbed against what fired, field for field,
    // without parsing a string. Flat, and nothing of the `Event` around it.
    const fields = {
      altKey: true,
      ctrlKey: false,
      keycode: 28,
      metaKey: false,
      shiftKey: false,
    };

    expect(
      shortcut(
        Object.assign(new Event("shortcut"), fields) as DomicileShortcutEvent,
      ),
    ).toStrictEqual(fields);
  });
});

describe("the modifiers the seat holds", () => {
  it("arrives under the web's names", () => {
    // Not xkb's depressed/latched/locked masks: the compositor has already
    // resolved those against the keymap, and a page holding a mask could not
    // read it without the keymap too.
    const fields = {
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    };

    expect(
      modifiers(
        Object.assign(new Event("modifiers"), fields) as DomicileModifiersEvent,
      ),
    ).toStrictEqual(fields);
  });
});

/** A `DomicileAppTitledEvent`, which carries only the window and its name. */
const titledEvent = (
  fields: Omit<DomicileAppTitledEvent, keyof Event>,
): DomicileAppTitledEvent => Object.assign(new Event("apptitled"), fields);
