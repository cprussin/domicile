import { describe, expect, it } from "bun:test";

import type {
  DomicileAppCursorEvent,
  DomicileAppEvent,
  DomicileAppsEvent,
  DomicileAppTitledEvent,
  DomicileBatteryEvent,
  DomicileClipboardEvent,
  DomicileExtension,
  DomicileExtensionsEvent,
  DomicileFilePreviewEvent,
  DomicileFilesEvent,
  DomicileIdleEvent,
  DomicileLockedEvent,
  DomicileModifiersEvent,
  DomicileNotificationsEvent,
  DomicileShellConfigEvent,
  DomicileShortcutEvent,
  DomicileTrayEvent,
} from "./domicile-host";
import { FilePreview } from "./file-preview";
import {
  appAppeared,
  appCursor,
  appResized,
  appSizeLimit,
  appTitled,
  battery,
  clipboard,
  extensions,
  filePreview,
  focusChanged,
  foundApps,
  foundFiles,
  idle,
  locked,
  modifiers,
  notifications,
  popupPlaced,
  shellConfig,
  shortcut,
  tray,
} from "./host-message";

/** `DomicileAppEvent` fields, all optional. */
type AppEventFields = Partial<Omit<DomicileAppEvent, keyof Event>>;

/**
 * A `DomicileAppEvent` with unset fields defaulted the way the engine fills
 * them: empty strings and zeros.
 */
const appEvent = (type: string, fields: AppEventFields): DomicileAppEvent =>
  Object.assign(new Event(type), {
    appId: "",
    arrival: 0,
    grab: false,
    hasSize: false,
    height: 0,
    parentAppId: "",
    title: "",
    width: 0,
    x: 0,
    y: 0,
    ...fields,
  });

/** A `DomicileAppCursorEvent`. */
const appCursorEvent = (
  appId: string,
  cursor: string,
): DomicileAppCursorEvent =>
  Object.assign(new Event("appcursor"), {
    appId,
    arrival: 0,
    // Cast so a test can pass a keyword outside the type, as an engine of a
    // different version could.
    cursor: cursor as DomicileAppCursorEvent["cursor"],
  });

describe("a window appearing", () => {
  it("has no size until the client has drawn", () => {
    // A window can appear before it draws. Its zero width and height must
    // not be read as a size.
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
    // The engine sends "" both before `set_title` and for an empty title.
    // Both mean no name.
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
    // Sizes come from a layout box, so they are fractional.
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

describe("a window's size limits", () => {
  it("read a zero on an axis as no limit on it", () => {
    // In xdg-shell, `680x0` means at least 680 wide and any height.
    expect(
      appSizeLimit(
        appEvent("appminsize", {
          appId: "vault",
          hasSize: true,
          height: 0,
          width: 680,
        }),
      ),
    ).toStrictEqual({ app_id: "vault", size: [680, undefined] });
  });
});

describe("a popup", () => {
  it("is placed against what it is over, and knows whether it grabbed", () => {
    expect(
      popupPlaced(
        appEvent("popupplaced", {
          appId: "menu",
          grab: true,
          hasSize: true,
          height: 240,
          parentAppId: "term",
          width: 180,
          x: 12,
          y: 30,
        }),
      ),
    ).toStrictEqual({
      app_id: "menu",
      grab: true,
      parent: "term",
      position: [12, 30],
      size: [180, 240],
    });
  });
});

describe("focus moving", () => {
  it("reads an empty app id as the chrome holding the keyboard", () => {
    // The chrome having focus is a real state that a shell draws.
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
    // The engine also validates this. The SDK checks again because any page
    // code can construct the event, and `style.cursor` silently ignores an
    // unknown keyword.
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
    // Same fields as `grabShortcut` takes, so a shell can compare them
    // directly.
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
    // Booleans, not xkb masks: the compositor resolves them against the
    // keymap.
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

describe("what a search found", () => {
  it("arrives as the query it answers, the paths, how many and whether that is all", () => {
    // `indexing` tells a partial result from a complete one. `query` tells
    // this answer from one to an earlier keystroke.
    const fields = {
      files: ["Notes/", "Notes/today.org"],
      indexing: true,
      matched: 40,
      query: "notes",
    };

    expect(
      foundFiles(
        Object.assign(new Event("files"), {
          arrival: 0,
          ...fields,
        }) as DomicileFilesEvent,
      ),
    ).toStrictEqual(fields);
  });
});

describe("what applications matched", () => {
  const firefox = {
    command: ["firefox", "--new-window"],
    comment: "Browse the web",
    id: "firefox.desktop",
    name: "Firefox",
  };

  it("arrives as the query it answers, the entries each with its pictures, and the bookmarks", () => {
    const pictured = {
      ...firefox,
      icon: "data:image/png;base64,cm93",
      preview: "data:image/svg+xml;base64,PHN2Zz4=",
    };
    const bookmark = {
      icon: "data:image/png;base64,aWNv",
      name: "Fire Drill",
      url: "https://example.com/drill",
    };
    expect(
      foundApps(
        Object.assign(new Event("apps"), {
          apps: [pictured],
          arrival: 0,
          bookmarks: [bookmark],
          query: "fire",
        }) as DomicileAppsEvent,
      ),
    ).toStrictEqual({
      apps: [pictured],
      bookmarks: [bookmark],
      query: "fire",
    });
  });

  it("has no icon or preview for one the engine carries an empty one for", () => {
    const found = foundApps(
      Object.assign(new Event("apps"), {
        apps: [{ ...firefox, icon: "", preview: "" }],
        arrival: 0,
        bookmarks: [
          { icon: "", name: "Fire Drill", url: "https://example.com/drill" },
        ],
        query: "fire",
      }) as DomicileAppsEvent,
    );

    expect(found.apps[0]?.icon).toBeUndefined();
    expect(found.apps[0]?.preview).toBeUndefined();
    expect(found.bookmarks[0]?.icon).toBeUndefined();
  });
});

describe("what a file holds", () => {
  /** A `DomicileFilePreviewEvent` with unused fields empty. */
  const previewEvent = (
    fields: Partial<Omit<DomicileFilePreviewEvent, keyof Event>>,
  ): DomicileFilePreviewEvent =>
    Object.assign(new Event("filepreview"), {
      album: "",
      arrival: 0,
      artist: "",
      cover: "",
      duration: 0,
      entries: [],
      kind: "unreadable",
      path: "Notes",
      text: "",
      title: "",
      ...fields,
    });

  it("arrives as the path and what the kind says is in it", () => {
    expect(
      filePreview(previewEvent({ kind: "text", text: "* today\n" })),
    ).toStrictEqual({ path: "Notes", preview: FilePreview.Text("* today\n") });
    expect(
      filePreview(
        previewEvent({ entries: ["2026/", "today.org"], kind: "directory" }),
      ).preview,
    ).toStrictEqual(FilePreview.Directory(["2026/", "today.org"]));
    expect(filePreview(previewEvent({ kind: "binary" })).preview).toStrictEqual(
      FilePreview.Binary(),
    );
    expect(
      filePreview(
        previewEvent({
          artist: "Band",
          cover: "data:image/png;base64,AQID",
          duration: 61.5,
          kind: "audio",
          title: "Song",
        }),
      ).preview,
    ).toStrictEqual(
      FilePreview.Audio({
        album: undefined,
        artist: "Band",
        cover: "data:image/png;base64,AQID",
        duration: 61.5,
        title: "Song",
      }),
    );
    expect(
      filePreview(previewEvent({ kind: "unreadable" })).preview,
    ).toStrictEqual(FilePreview.Unreadable());
  });

  it("refuses a kind it does not know rather than drawing nothing", () => {
    // A newer engine could send one. Failing loudly exposes the version skew.
    expect(() => filePreview(previewEvent({ kind: "video" }))).toThrow();
  });
});

describe("the charge", () => {
  it("arrives as the fraction and the lead, without the hop", () => {
    // `arrival` is dropped; shells do not use it.
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
    // Zero is a valid reading. A machine with no battery sends no event.
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

/** A `DomicileAppTitledEvent` with `arrival` defaulted. */
const titledEvent = (
  fields: Omit<DomicileAppTitledEvent, keyof Event | "arrival">,
): DomicileAppTitledEvent =>
  Object.assign(new Event("apptitled"), { arrival: 0, ...fields });

describe("the clipboard", () => {
  it("arrives as the rows a manager draws, without the hop", () => {
    // Only the entries; `arrival` is dropped.
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
    // An empty history is still an event, so a newly started shell does not
    // wait for one.
    const history = clipboard(
      Object.assign(new Event("clipboard"), {
        arrival: 0,
        entries: [],
      }) as DomicileClipboardEvent,
    );

    expect(history).toStrictEqual({ entries: [] });
  });
});

describe("the system tray", () => {
  it("arrives as the icons a tray draws, without the hop", () => {
    const icons = tray(
      Object.assign(new Event("tray"), {
        arrival: 0,
        items: [
          {
            icon: "data:image/png;base64,iVBORw0KGgo=",
            id: ":1.42/StatusNotifierItem",
            title: "Network",
          },
        ],
      }) as DomicileTrayEvent,
    );

    expect(icons).toStrictEqual({
      items: [
        {
          icon: "data:image/png;base64,iVBORw0KGgo=",
          id: ":1.42/StatusNotifierItem",
          title: "Network",
        },
      ],
    });
  });

  it("has no icon for an item the engine carries an empty one for", () => {
    // The compositor could not draw the icon; a shell shows a label instead.
    const icons = tray(
      Object.assign(new Event("tray"), {
        arrival: 0,
        items: [{ icon: "", id: ":1.9/StatusNotifierItem", title: "Sync" }],
      }) as DomicileTrayEvent,
    );

    expect(icons).toStrictEqual({
      items: [
        { icon: undefined, id: ":1.9/StatusNotifierItem", title: "Sync" },
      ],
    });
  });
});

describe("the notifications", () => {
  /** One notification as the engine sends it. */
  const carried = (
    fields: Partial<DomicileNotificationsEvent["items"][number]>,
  ) => ({
    actions: [],
    appName: "Firefox",
    body: "Ada: lunch?",
    clickable: true,
    icon: "data:image/png;base64,iVBORw0KGgo=",
    id: 7,
    summary: "New message",
    time: 1_790_000_000_000,
    timeoutMs: -1,
    urgency: "normal",
    ...fields,
  });

  const arrived = (items: DomicileNotificationsEvent["items"]) =>
    notifications(
      Object.assign(new Event("notifications"), {
        arrival: 0,
        items,
      }) as DomicileNotificationsEvent,
    );

  it("arrives as the notifications a shell draws, without the hop", () => {
    expect(
      arrived([carried({ actions: [{ key: "reply", label: "Reply" }] })]),
    ).toStrictEqual({
      items: [
        {
          actions: [{ key: "reply", label: "Reply" }],
          appName: "Firefox",
          body: "Ada: lunch?",
          clickable: true,
          icon: "data:image/png;base64,iVBORw0KGgo=",
          id: 7,
          summary: "New message",
          time: 1_790_000_000_000,
          timeoutMs: undefined,
          urgency: "normal",
        },
      ],
    });
  });

  it("reads the engine's empty and negative stand-ins as nothing said", () => {
    // Empty icon and `-1` timeout mean unset. `0` means stay until dismissed,
    // so it is kept.
    const [lasting, critical] = arrived([
      carried({ icon: "", timeoutMs: 0 }),
      carried({ id: 8, urgency: "critical" }),
    ]).items;

    expect([lasting?.icon, lasting?.timeoutMs]).toStrictEqual([undefined, 0]);
    expect(critical?.urgency).toBe("critical");
  });

  it("refuses an urgency the compositor has no word for", () => {
    expect(() => arrived([carried({ urgency: "panic" })])).toThrow();
  });
});

describe("the extensions in the tray", () => {
  const ID = "abcdefghijklmnopabcdefghijklmnop";
  const ICON = "data:image/png;base64,iVBORw0KGgo=";

  /** One extension as the engine sends it, with a popup. */
  const row = (fields: Partial<DomicileExtension>): DomicileExtension => ({
    badgeColor: "#1c3a2eff",
    badgeText: "7",
    enabled: true,
    icon: ICON,
    id: ID,
    name: "A tray guard",
    popup: `chrome-extension://${ID}/popup.html`,
    title: "Open the guard",
    ...fields,
  });

  const extensionsEvent = (
    rows: readonly DomicileExtension[],
  ): DomicileExtensionsEvent =>
    Object.assign(new Event("extensions"), { extensions: rows });

  it("arrives as the rows a tray draws, a missing popup as undefined", () => {
    // The engine sends `null` for no popup; the SDK uses `undefined`.
    expect(
      extensions(extensionsEvent([row({}), row({ popup: null })])),
    ).toStrictEqual({
      extensions: [
        {
          badgeColor: "#1c3a2eff",
          badgeText: "7",
          enabled: true,
          icon: ICON,
          id: ID,
          name: "A tray guard",
          popup: `chrome-extension://${ID}/popup.html`,
          title: "Open the guard",
        },
        {
          badgeColor: "#1c3a2eff",
          badgeText: "7",
          enabled: true,
          icon: ICON,
          id: ID,
          name: "A tray guard",
          popup: undefined,
          title: "Open the guard",
        },
      ],
    });
  });

  it("refuses an icon that is not a PNG it can draw", () => {
    // The engine renders every icon to a PNG data URL. Anything else means
    // the engine and SDK disagree.
    expect(() =>
      extensions(
        extensionsEvent([row({ icon: `chrome-extension://${ID}/icon.png` })]),
      ),
    ).toThrow();
  });

  it("refuses an id that is not an extension's", () => {
    // An invalid id would make `activateExtension` fail silently.
    expect(() => extensions(extensionsEvent([row({ id: "" })]))).toThrow();
  });
});

describe("whether anybody is at the desk", () => {
  it("arrives as the state, both ways round and without the hop", () => {
    // Test both values: an inverted mapping would pass a single-value test.
    expect(
      idle(
        Object.assign(new Event("idle"), {
          arrival: 0,
          idle: true,
        }) as DomicileIdleEvent,
      ),
    ).toStrictEqual({ idle: true });

    expect(
      idle(
        Object.assign(new Event("idle"), {
          arrival: 0,
          idle: false,
        }) as DomicileIdleEvent,
      ),
    ).toStrictEqual({ idle: false });
  });
});

describe("whether the desk is locked", () => {
  it("arrives as the state, both ways round and without the hop", () => {
    // Test both values: an inverted mapping would pass a single-value test,
    // and would hide the lock screen while locked.
    expect(
      locked(
        Object.assign(new Event("locked"), {
          arrival: 0,
          locked: true,
        }) as DomicileLockedEvent,
      ),
    ).toStrictEqual({ locked: true });

    expect(
      locked(
        Object.assign(new Event("locked"), {
          arrival: 0,
          locked: false,
        }) as DomicileLockedEvent,
      ),
    ).toStrictEqual({ locked: false });
  });
});

describe("the keys the config binds", () => {
  /** A `shellconfig` event carrying `config` as JSON. */
  const configEvent = (config: unknown): DomicileShellConfigEvent =>
    Object.assign(new Event("shellconfig"), {
      arrival: 0,
      config: JSON.stringify(config),
    }) as DomicileShellConfigEvent;

  it("arrives as a table of keysyms and the keys they are on", () => {
    expect(
      shellConfig(
        configEvent({ keys: { l: 38, Return: 28 }, type: "shell_config" }),
      ),
    ).toStrictEqual({
      keys: new Map([
        ["Return", 28],
        ["l", 38],
      ]),
    });
  });

  it("refuses a line that is not the message", () => {
    // The engine forwards the line unparsed, so the SDK must validate it.
    expect(() =>
      shellConfig(
        configEvent({ keys: { Return: "28" }, type: "shell_config" }),
      ),
    ).toThrow();
  });
});
