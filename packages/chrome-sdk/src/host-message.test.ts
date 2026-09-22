import { describe, expect, it } from "bun:test";

import type {
  DomicileAppCursorEvent,
  DomicileAppEvent,
  DomicileAppTitledEvent,
  DomicileBatteryEvent,
  DomicileClipboardEvent,
  DomicileFilesEvent,
  DomicileModifiersEvent,
  DomicileShortcutEvent,
} from "./domicile-host";
import {
  appAppeared,
  appCursor,
  appResized,
  appTitled,
  battery,
  clipboard,
  files,
  focusChanged,
  modifiers,
  shortcut,
} from "./host-message";

/** The fields a `DomicileAppEvent` carries, all of them optional to a test. */
type AppEventFields = Partial<Omit<DomicileAppEvent, keyof Event>>;

/**
 * A `DomicileAppEvent`, with the fields that event does not carry left as what
 * the engine fills them with: the empty string, a zero behind a false
 * `hasSize`, and a zero `arrival` for the tests that are not about the hop.
 *
 * `Object.assign` onto an `Event` rather than a subclass per event type: what
 * these functions read is the fields, and five classes saying that would be a
 * test of the test.
 */
const appEvent = (type: string, fields: AppEventFields): DomicileAppEvent =>
  Object.assign(new Event(type), {
    appId: "",
    arrival: 0,
    hasSize: false,
    height: 0,
    title: "",
    width: 0,
    ...fields,
  });

/**
 * A `DomicileAppCursorEvent`. Its own builder because it is its own event: a
 * `DomicileCursorShape` has no member meaning "not a cursor", so the shape is
 * named at every call rather than defaulted to a sentinel the engine cannot
 * send.
 */
const appCursorEvent = (
  appId: string,
  cursor: string,
): DomicileAppCursorEvent =>
  Object.assign(new Event("appcursor"), {
    appId,
    arrival: 0,
    // Cast because the point of the test below is the value the engine's own
    // type says cannot be here — which is what `appCursor` is being asked to
    // refuse, and what a shell running against an older engine would see.
    cursor: cursor as DomicileAppCursorEvent["cursor"],
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
    // The page's half of a closed set the engine now also holds: the browser
    // refuses a name that is not a shape when it reads the compositor's
    // socket, so this parse is a second reading rather than the only one. It
    // stays because the DOM is a boundary — an event can be constructed by
    // anything in the page — and because assigning an unknown keyword to
    // `style.cursor` is a silent no-op, so the symptom of a value that got
    // through would be an arrow where a hand should be with nothing said.
    expect(() => {
      appCursor(appCursorEvent("term", "pointr"));
    }).toThrow();
  });

  it("passes a keyword it does know", () => {
    expect(appCursor(appCursorEvent("term", "grabbing"))).toStrictEqual({
      app_id: "term",
      cursor: "grabbing",
    });
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

describe("what there is to open", () => {
  it("arrives as a plain array of paths", () => {
    // A `FrozenArray<DOMString>` on the IDL side, which is an ordinary array
    // to a page — and the order is the answer rather than incidental, so
    // nothing here sorts it a second time.
    const offered = files(
      Object.assign(new Event("files"), {
        arrival: 0,
        files: ["Notes/today.org", "src"],
      }) as DomicileFilesEvent,
    );

    expect(offered).toStrictEqual({ files: ["Notes/today.org", "src"] });
  });

  it("carries an empty list as an empty list", () => {
    // A home with nothing to offer is an answer. It has to survive as one:
    // a launcher that read it as "not told yet" would sit waiting for a
    // second message that is never coming.
    expect(
      files(
        Object.assign(new Event("files"), {
          arrival: 0,
          files: [],
        }) as DomicileFilesEvent,
      ),
    ).toStrictEqual({ files: [] });
  });
});

describe("the charge", () => {
  it("arrives as the fraction and the lead, without the hop", () => {
    // The two fields a bar draws and nothing else: `arrival` is the SDK's
    // own bookkeeping and no shell has a use for it.
    const charge = battery(
      Object.assign(new Event("battery"), {
        arrival: 0,
        charge: 0.42,
        charging: true,
      }) as DomicileBatteryEvent,
    );

    expect(charge).toStrictEqual({ charge: 0.42, charging: true });
  });

  it("carries an empty battery as an empty battery", () => {
    // Zero is a reading. A machine with no battery sends no message at all,
    // so there is nothing here for `0` to be mistaken for.
    expect(
      battery(
        Object.assign(new Event("battery"), {
          arrival: 0,
          charge: 0,
          charging: false,
        }) as DomicileBatteryEvent,
      ),
    ).toStrictEqual({ charge: 0, charging: false });
  });
});

/** A `DomicileAppTitledEvent`, which carries only the window and its name. */
// `arrival` defaulted rather than asked of every caller: the three tests that
// use this are about a window's name, and a hop each of them would have to
// spell out is a field that makes them harder to read without asserting
// anything.
const titledEvent = (
  fields: Omit<DomicileAppTitledEvent, keyof Event | "arrival">,
): DomicileAppTitledEvent =>
  Object.assign(new Event("apptitled"), { arrival: 0, ...fields });

describe("the clipboard", () => {
  it("arrives as the rows a manager draws, without the hop", () => {
    // The entries and nothing else: `arrival` is the SDK's own bookkeeping,
    // and the engine's rows are objects with an id and a preview on them
    // rather than anything a shell would rather have.
    const history = clipboard(
      Object.assign(new Event("clipboard"), {
        arrival: 0,
        entries: [
          { id: 3, preview: "the newest" },
          { id: 1, preview: "the oldest" },
        ],
      }) as DomicileClipboardEvent,
    );

    expect(history).toStrictEqual({
      entries: [
        { id: 3, preview: "the newest" },
        { id: 1, preview: "the oldest" },
      ],
    });
  });

  it("carries a desktop nothing was copied on as an empty history", () => {
    // Not a silence, for the same reason a home with no files is not one: a
    // shell told nothing would wait for a message it has already been sent,
    // and this is the ordinary state of a desktop that has just started.
    const history = clipboard(
      Object.assign(new Event("clipboard"), {
        arrival: 0,
        entries: [],
      }) as DomicileClipboardEvent,
    );

    expect(history).toStrictEqual({ entries: [] });
  });
});
