// A tray item's menu: `com.canonical.dbusmenu` on the session bus, read,
// kept current and clicked through the shell's system calls. See
// docs/architecture/SYSTEM-TRAY.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { z } from "zod";

import type {
  DbusCall,
  DbusSignal,
  Listening,
  System,
  SystemError,
} from "./system";
import { Bus } from "./system";

const DBUSMENU = "com.canonical.dbusmenu";

/** The signals after which the menu is read again. */
const CHANGES: ReadonlySet<string> = new Set([
  "ItemsPropertiesUpdated",
  "LayoutUpdated",
]);

export enum MenuEntryKind {
  Item,
  Separator,
}

export enum ToggleKind {
  Checkmark,
  Radio,
}

/** A check box or radio button beside an item. */
export type Toggle = { kind: ToggleKind; checked: boolean };

/** One thing the menu can do, or a submenu. */
export type MenuItem = {
  /** What {@link WatchedMenu.click} names it by. */
  id: number;
  /** Its text, with the mnemonic's underscore removed. */
  label: string;
  /** Where in `label` the access key is, if its underscore marked one. */
  mnemonic: number | undefined;
  enabled: boolean;
  /** A freedesktop icon name. */
  icon: string | undefined;
  /** The application's own picture (`icon-data`), as a PNG `data:` URL. */
  image: string | undefined;
  toggle: Toggle | undefined;
  /** Its entries, for an item that opens a submenu. */
  submenu: readonly MenuEntry[] | undefined;
};

// Return types written out: a submenu holds entries, which TypeScript cannot
// infer through `ReturnType`.
type ItemEntry = MenuItem & { kind: MenuEntryKind.Item };
type SeparatorEntry = { id: number; kind: MenuEntryKind.Separator };

export const MenuEntry = {
  Item: (item: MenuItem): ItemEntry => ({ ...item, kind: MenuEntryKind.Item }),
  Separator: (id: number): SeparatorEntry => ({
    id,
    kind: MenuEntryKind.Separator,
  }),
};

/** An entry the application shows; hidden ones are left out. */
export type MenuEntry = ReturnType<(typeof MenuEntry)[keyof typeof MenuEntry]>;

/** Where a menu answers: a tray item's `bus` and `menu`. */
export type MenuAddress = { bus: string; path: string };

/** The calls this module makes. */
export type MenuSystem = Pick<System, "dbusCall" | "dbusMatch">;

/** A menu being watched, and the requests it takes. */
export type WatchedMenu = {
  /** Activate an item. */
  click: (id: number) => Promise<Result<"clicked", SystemError>>;
  /**
   * Tell the application the submenu under `id` (0 for the top) is about to
   * show. Reads the menu again if the application changed it.
   */
  aboutToShow: (id: number) => Promise<Result<"shown", SystemError>>;
  stop: () => void;
};

/**
 * Calls `onMenu` with the menu at `address` now and after each change, until
 * stopped.
 *
 * An `Err` is a D-Bus failure, such as the application having quit or the
 * desktop being locked. The watch keeps listening after a failed read.
 */
export const watchMenu = (
  system: MenuSystem,
  address: MenuAddress,
  onMenu: (menu: Result<readonly MenuEntry[], SystemError>) => void,
): WatchedMenu => {
  const watch: Watch = {
    listening: undefined,
    reading: Promise.resolve(),
    stopped: false,
  };
  const report = (menu: Result<readonly MenuEntry[], SystemError>) => {
    if (!watch.stopped) {
      onMenu(menu);
    }
  };
  // Reads one at a time, so an older read never reports after a newer one.
  const reread = (): Promise<void> => {
    watch.reading = watch.reading.then(async () => {
      report(await read(system, address));
    });
    return watch.reading;
  };
  follow(system, address, watch, report, reread).catch((error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: surfacing a background failure
    console.error("Failed to watch a tray menu", error);
  });
  return {
    aboutToShow: async (id) =>
      (await call(system, address, "AboutToShow", "i", [id])).andThenAsync(
        async ({ body }) => {
          const [changed] = aboutToShowSchema.parse(body);
          if (changed) {
            await reread();
          }
          return Ok("shown" as const);
        },
      ),
    click: async (id) =>
      (
        await call(system, address, "Event", "isvu", [
          id,
          "clicked",
          { signature: "i", value: 0 },
          0,
        ])
      ).map(() => "clicked"),
    stop: () => {
      watch.stopped = true;
      watch.listening?.stop();
    },
  };
};

/** A watch's state, shared by its loop, its requests and its stop function. */
type Watch = {
  listening: Listening<DbusSignal> | undefined;
  /** The read in flight, or the last one. */
  reading: Promise<void>;
  stopped: boolean;
};

/** Listen, read, then read again on each change until the match ends. */
const follow = async (
  system: MenuSystem,
  address: MenuAddress,
  watch: Watch,
  report: (menu: Result<readonly MenuEntry[], SystemError>) => void,
  reread: () => Promise<void>,
): Promise<void> => {
  const matched = await system.dbusMatch({
    bus: Bus.Session,
    interface: DBUSMENU,
    path: address.path,
    sender: address.bus,
  });
  await matched.match({
    Err: (error) => {
      report(Err(error));
      return Promise.resolve();
    },
    Ok: async (listening) => {
      watch.listening = listening;
      if (watch.stopped) {
        listening.stop();
      }
      await changes(listening, reread);
      const ended = await listening.ended;
      ended.match({
        Err: (error) => {
          report(Err(error));
        },
        Ok: () => {
          /* stopped by the caller */
        },
      });
    },
  });
};

/** Read now, and again on each signal that changes the menu. */
const changes = async (
  listening: Listening<DbusSignal>,
  reread: () => Promise<void>,
): Promise<void> => {
  const reader = listening.items.getReader();
  await reread();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    if (CHANGES.has(next.value.member)) {
      await reread();
    }
  }
};

/** The whole menu, from the top. */
const read = async (
  system: MenuSystem,
  address: MenuAddress,
): Promise<Result<readonly MenuEntry[], SystemError>> =>
  (await call(system, address, "GetLayout", "iias", [0, -1, []])).map(
    ({ body }) => entriesOf(getLayoutSchema.parse(body)[1][2]),
  );

const call = (
  system: MenuSystem,
  address: MenuAddress,
  member: string,
  signature: string,
  body: NonNullable<DbusCall["body"]>,
) =>
  system.dbusCall({
    body,
    bus: Bus.Session,
    destination: address.bus,
    interface: DBUSMENU,
    member,
    path: address.path,
    signature,
  });

const entriesOf = (layouts: readonly Layout[]): readonly MenuEntry[] =>
  layouts.flatMap(([id, properties, children]): MenuEntry[] => {
    if (properties.visible === false) {
      return [];
    } else {
      return properties.type === "separator"
        ? [MenuEntry.Separator(id)]
        : [MenuEntry.Item(itemOf(id, properties, children))];
    }
  });

const itemOf = (
  id: number,
  properties: Properties,
  children: readonly Layout[],
): MenuItem => {
  const { label, mnemonic } = withoutMnemonic(properties.label ?? "");
  return {
    enabled: properties.enabled ?? true,
    icon: properties["icon-name"] === "" ? undefined : properties["icon-name"],
    id,
    image: pngOf(properties["icon-data"]),
    label,
    mnemonic,
    submenu:
      properties["children-display"] === "submenu" || children.length > 0
        ? entriesOf(children)
        : undefined,
    toggle: toggleOf(properties),
  };
};

const toggleOf = (properties: Properties): Toggle | undefined => {
  // -1, "indeterminate", draws unchecked.
  const checked = properties["toggle-state"] === 1;
  switch (properties["toggle-type"]) {
    case "checkmark": {
      return { checked, kind: ToggleKind.Checkmark };
    }
    case "radio": {
      return { checked, kind: ToggleKind.Radio };
    }
    case "":
    case undefined: {
      return undefined;
    }
  }
};

/**
 * A label as GTK writes one: `_` marks the next character as the access key,
 * and `__` is a literal underscore.
 */
const withoutMnemonic = (
  written: string,
): { label: string; mnemonic: number | undefined } => {
  const label = unescaped(written);
  // The first underscore that is not half of a `__`.
  const marker = [...written.matchAll(UNDERSCORE)].find(
    ([, doubled]) => doubled === "",
  );
  const at =
    marker === undefined
      ? undefined
      : unescaped(written.slice(0, marker.index)).length;
  return {
    label,
    mnemonic: at === undefined || at === label.length ? undefined : at,
  };
};

/** An underscore, and the one after it if any. */
const UNDERSCORE = /_(_?)/g;

/** `written` with each `__` made `_` and each other `_` removed. */
const unescaped = (written: string): string =>
  written.replaceAll(UNDERSCORE, "$1");

/** `icon-data`'s bytes as a `data:` URL, or nothing for none. */
const pngOf = (bytes: readonly number[] | undefined): string | undefined =>
  bytes === undefined || bytes.length === 0
    ? undefined
    : `data:image/png;base64,${btoa(bytes.map((byte) => String.fromCharCode(byte)).join(""))}`;

/** A `v`, as `domicile_host::dbus_json` writes it, read as its value. */
const variant = <T>(value: z.ZodType<T>) =>
  z.object({ value }).transform(({ value: held }) => held);

const propertiesSchema = z.object({
  "children-display": variant(z.string()).optional(),
  enabled: variant(z.boolean()).optional(),
  "icon-data": variant(z.array(z.number().int().min(0).max(255))).optional(),
  "icon-name": variant(z.string()).optional(),
  label: variant(z.string()).optional(),
  "toggle-state": variant(z.number()).optional(),
  "toggle-type": variant(z.enum(["checkmark", "radio", ""])).optional(),
  type: variant(z.enum(["standard", "separator"])).optional(),
  visible: variant(z.boolean()).optional(),
});

type Properties = z.infer<typeof propertiesSchema>;

/** An item, `(ia{sv}av)`: its id, its properties and its children. */
type Layout = [number, Properties, Layout[]];

const layoutSchema: z.ZodType<Layout> = z.lazy(() =>
  z.tuple([z.number(), propertiesSchema, z.array(variant(layoutSchema))]),
);

/** `GetLayout`'s reply: the revision and the top item. */
const getLayoutSchema = z.tuple([z.number(), layoutSchema]);

/** `AboutToShow`'s reply: whether the application changed the menu. */
const aboutToShowSchema = z.tuple([z.boolean()]);
