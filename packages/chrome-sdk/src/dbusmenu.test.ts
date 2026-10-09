import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import type { MenuEntry } from "./dbusmenu";
import { MenuEntry as Entry, ToggleKind, watchMenu } from "./dbusmenu";
import type {
  DbusBody,
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "./system";
import { Bus, SystemErrorKind } from "./system";

const MENU = { bus: ":1.42", path: "/MenuBar" };

/** A `v` holding a menu item, as the compositor writes it. */
const child = (id: number, properties: object, children: unknown[] = []) => ({
  signature: "(ia{sv}av)",
  value: [id, properties, children],
});

/** `GetLayout` of a libappindicator item, as the compositor writes it. */
const recorded = (label: string): DbusBody => ({
  body: [
    7,
    [
      0,
      { "children-display": { signature: "s", value: "submenu" } },
      [
        child(1, {
          label: { signature: "s", value: label },
        }),
        child(2, {
          enabled: { signature: "b", value: false },
          label: { signature: "s", value: "Save__As _Copy" },
        }),
        child(3, { type: { signature: "s", value: "separator" } }),
        child(4, {
          "icon-data": { signature: "ay", value: [137, 80, 78, 71] },
          "icon-name": { signature: "s", value: "audio-volume-muted" },
          label: { signature: "s", value: "Mute" },
          "toggle-state": { signature: "i", value: 1 },
          "toggle-type": { signature: "s", value: "checkmark" },
        }),
        child(
          5,
          {
            "children-display": { signature: "s", value: "submenu" },
            label: { signature: "s", value: "_Quality" },
          },
          [
            child(6, {
              label: { signature: "s", value: "High" },
              "toggle-state": { signature: "i", value: 0 },
              "toggle-type": { signature: "s", value: "radio" },
            }),
            child(7, {
              label: { signature: "s", value: "Low" },
              "toggle-state": { signature: "i", value: 1 },
              "toggle-type": { signature: "s", value: "radio" },
            }),
          ],
        ),
        child(8, {
          label: { signature: "s", value: "Debug" },
          visible: { signature: "b", value: false },
        }),
      ],
    ],
  ],
  signature: "u(ia{sv}av)",
});

/** What {@link recorded} reads as, with its first item labeled `label`. */
const parsed = (label: string, mnemonic: number): readonly MenuEntry[] => [
  Entry.Item({
    enabled: true,
    icon: undefined,
    id: 1,
    image: undefined,
    label,
    mnemonic,
    submenu: undefined,
    toggle: undefined,
  }),
  Entry.Item({
    enabled: false,
    icon: undefined,
    id: 2,
    image: undefined,
    label: "Save_As Copy",
    mnemonic: 8,
    submenu: undefined,
    toggle: undefined,
  }),
  Entry.Separator(3),
  Entry.Item({
    enabled: true,
    icon: "audio-volume-muted",
    id: 4,
    image: "data:image/png;base64,iVBORw==",
    label: "Mute",
    mnemonic: undefined,
    submenu: undefined,
    toggle: { checked: true, kind: ToggleKind.Checkmark },
  }),
  Entry.Item({
    enabled: true,
    icon: undefined,
    id: 5,
    image: undefined,
    label: "Quality",
    mnemonic: 0,
    submenu: [
      Entry.Item({
        enabled: true,
        icon: undefined,
        id: 6,
        image: undefined,
        label: "High",
        mnemonic: undefined,
        submenu: undefined,
        toggle: { checked: false, kind: ToggleKind.Radio },
      }),
      Entry.Item({
        enabled: true,
        icon: undefined,
        id: 7,
        image: undefined,
        label: "Low",
        mnemonic: undefined,
        submenu: undefined,
        toggle: { checked: true, kind: ToggleKind.Radio },
      }),
    ],
    toggle: undefined,
  }),
];

const GET_LAYOUT: DbusCall = {
  body: [0, -1, []],
  bus: Bus.Session,
  destination: MENU.bus,
  interface: "com.canonical.dbusmenu",
  member: "GetLayout",
  path: MENU.path,
  signature: "iias",
};

const LOCKED: SystemError = {
  kind: SystemErrorKind.Locked,
  message: "the desktop is locked",
};

const signal = (member: string, body: unknown[]): DbusSignal => ({
  body,
  interface: "com.canonical.dbusmenu",
  member,
  path: MENU.path,
  sender: MENU.bus,
  signature: "",
});

/**
 * The session bus as the library sees it: each call answers the next of
 * `replies`, and the test sends signals to the match. A match fails with
 * `refused` when it is given.
 */
const fakeBus = (
  replies: Result<DbusBody, SystemError>[],
  refused?: SystemError,
) => {
  const calls: DbusCall[] = [];
  const matches: DbusMatch[] = [];
  const signals =
    Promise.withResolvers<ReadableStreamDefaultController<DbusSignal>>();
  const ended = Promise.withResolvers<Result<"stopped", SystemError>>();
  const items = new ReadableStream<DbusSignal>({
    start: (controller) => {
      signals.resolve(controller);
    },
  });
  const state = { stopped: 0 };
  return {
    break: async (error: SystemError) => {
      (await signals.promise).close();
      ended.resolve(Err(error));
    },
    calls,
    /** Settles when the match ends. */
    ended: ended.promise,
    matches,
    send: async (sent: DbusSignal) => {
      (await signals.promise).enqueue(sent);
    },
    get stopped() {
      return state.stopped;
    },
    system: {
      dbusCall: (call: DbusCall) => {
        calls.push(call);
        const reply = replies.shift();
        if (reply === undefined) {
          throw new Error(`test: no reply for ${call.member}`);
        } else {
          return Promise.resolve(reply);
        }
      },
      dbusMatch: (match: DbusMatch) => {
        matches.push(match);
        return Promise.resolve(
          refused === undefined
            ? Ok<Listening<DbusSignal>, SystemError>({
                ended: ended.promise,
                items,
                stop: () => {
                  state.stopped += 1;
                  signals.promise
                    .then((controller) => {
                      controller.close();
                      ended.resolve(Ok("stopped"));
                    })
                    .catch(() => {
                      /* the test fails on the missing report instead */
                    });
                },
              })
            : Err<Listening<DbusSignal>, SystemError>(refused),
        );
      },
    },
  };
};

type Report = Result<readonly MenuEntry[], SystemError>;

/** The reports a watch makes, read one at a time. */
const reports = () => {
  const queue: Report[] = [];
  const waiting: ((report: Report) => void)[] = [];
  return {
    next: (): Promise<Report> => {
      const report = queue.shift();
      return report === undefined
        ? new Promise((resolve) => {
            waiting.push(resolve);
          })
        : Promise.resolve(report);
    },
    on: (report: Report) => {
      const resolve = waiting.shift();
      if (resolve === undefined) {
        queue.push(report);
      } else {
        resolve(report);
      }
    },
  };
};

describe("watchMenu", () => {
  describe("reading", () => {
    it("reads the whole menu from the item's bus and path", async () => {
      const bus = fakeBus([Ok(recorded("_Open"))]);
      const heard = reports();

      const menu = watchMenu(bus.system, MENU, heard.on);

      expect(await heard.next()).toStrictEqual(Ok(parsed("Open", 0)));
      expect(bus.calls).toStrictEqual([GET_LAYOUT]);
      expect(bus.matches).toStrictEqual([
        {
          bus: Bus.Session,
          interface: "com.canonical.dbusmenu",
          path: MENU.path,
          sender: MENU.bus,
        },
      ]);
      menu.stop();
    });

    it("reports a failed read and keeps listening", async () => {
      const unknown: SystemError = {
        kind: SystemErrorKind.Dbus,
        message: "org.freedesktop.DBus.Error.UnknownObject: No such object",
      };
      const bus = fakeBus([Err(unknown), Ok(recorded("_Open"))]);
      const heard = reports();

      const menu = watchMenu(bus.system, MENU, heard.on);

      expect(await heard.next()).toStrictEqual(Err(unknown));
      await bus.send(signal("LayoutUpdated", [8, 0]));
      expect(await heard.next()).toStrictEqual(Ok(parsed("Open", 0)));
      menu.stop();
    });

    it("reports a refused match", async () => {
      const bus = fakeBus([], LOCKED);
      const heard = reports();

      watchMenu(bus.system, MENU, heard.on);

      expect(await heard.next()).toStrictEqual(Err(LOCKED));
    });
  });

  describe("changes", () => {
    it("reads again when the layout or an item's properties change", async () => {
      const bus = fakeBus([
        Ok(recorded("_Open")),
        Ok(recorded("_Close")),
        Ok(recorded("_Open")),
      ]);
      const heard = reports();

      const menu = watchMenu(bus.system, MENU, heard.on);
      await heard.next();

      await bus.send(signal("LayoutUpdated", [8, 0]));
      expect(await heard.next()).toStrictEqual(Ok(parsed("Close", 0)));
      await bus.send(signal("ItemsPropertiesUpdated", [[], []]));
      expect(await heard.next()).toStrictEqual(Ok(parsed("Open", 0)));
      menu.stop();
    });

    it("does not read again when the application asks to show an item", async () => {
      const bus = fakeBus([Ok(recorded("_Open")), Ok(recorded("_Close"))]);
      const heard = reports();

      const menu = watchMenu(bus.system, MENU, heard.on);
      await heard.next();

      await bus.send(signal("ItemActivationRequested", [1, 0]));
      await bus.send(signal("LayoutUpdated", [8, 0]));
      expect(await heard.next()).toStrictEqual(Ok(parsed("Close", 0)));
      expect(bus.calls).toHaveLength(2);
      menu.stop();
    });

    it("stops a match that starts after it was stopped, reporting nothing", async () => {
      const bus = fakeBus([Ok(recorded("_Open"))]);
      const reported: Report[] = [];

      const menu = watchMenu(bus.system, MENU, (report) => {
        reported.push(report);
      });
      menu.stop();
      await bus.ended;

      expect(bus.stopped).toBe(1);
      expect(reported).toStrictEqual([]);
    });

    it("reports a match that breaks", async () => {
      const bus = fakeBus([Ok(recorded("_Open"))]);
      const heard = reports();
      const menu = watchMenu(bus.system, MENU, heard.on);
      await heard.next();

      await bus.break(LOCKED);

      expect(await heard.next()).toStrictEqual(Err(LOCKED));
      menu.stop();
    });
  });

  describe("requests", () => {
    it("clicks an item", async () => {
      const bus = fakeBus([
        Ok(recorded("_Open")),
        Ok({ body: [], signature: "" }),
      ]);
      const heard = reports();
      const menu = watchMenu(bus.system, MENU, heard.on);
      await heard.next();

      expect(await menu.click(4)).toStrictEqual(Ok("clicked"));
      expect(bus.calls[1]).toStrictEqual({
        body: [4, "clicked", { signature: "i", value: 0 }, 0],
        bus: Bus.Session,
        destination: MENU.bus,
        interface: "com.canonical.dbusmenu",
        member: "Event",
        path: MENU.path,
        signature: "isvu",
      });
      menu.stop();
    });

    it("reads again after showing a submenu the application changed", async () => {
      const bus = fakeBus([
        Ok(recorded("_Open")),
        Ok({ body: [true], signature: "b" }),
        Ok(recorded("_Close")),
      ]);
      const heard = reports();
      const menu = watchMenu(bus.system, MENU, heard.on);
      await heard.next();

      expect(await menu.aboutToShow(5)).toStrictEqual(Ok("shown"));
      expect(bus.calls[1]).toStrictEqual({
        body: [5],
        bus: Bus.Session,
        destination: MENU.bus,
        interface: "com.canonical.dbusmenu",
        member: "AboutToShow",
        path: MENU.path,
        signature: "i",
      });
      expect(await heard.next()).toStrictEqual(Ok(parsed("Close", 0)));
      menu.stop();
    });

    it("does not read again after showing an unchanged submenu", async () => {
      const bus = fakeBus([
        Ok(recorded("_Open")),
        Ok({ body: [false], signature: "b" }),
      ]);
      const heard = reports();
      const menu = watchMenu(bus.system, MENU, heard.on);
      await heard.next();

      expect(await menu.aboutToShow(0)).toStrictEqual(Ok("shown"));
      expect(bus.calls).toHaveLength(2);
      menu.stop();
    });

    it("passes on a failed request", async () => {
      const bus = fakeBus([Ok(recorded("_Open")), Err(LOCKED)]);
      const heard = reports();
      const menu = watchMenu(bus.system, MENU, heard.on);
      await heard.next();

      expect(await menu.click(1)).toStrictEqual(Err(LOCKED));
      menu.stop();
    });
  });
});
