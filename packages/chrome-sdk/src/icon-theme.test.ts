import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";

import { readIconTheme, watchIconTheme } from "./icon-theme";
import type {
  DbusBody,
  DbusCall,
  DbusMatch,
  DbusSignal,
  Listening,
  SystemError,
} from "./system";
import { Bus, SystemErrorKind } from "./system";

/** A desktop whose Settings portal answers `ReadAll` with `answer`. */
const answering = (answer: Result<DbusBody, SystemError>) => {
  const calls: DbusCall[] = [];
  return {
    calls,
    system: {
      dbusCall: (call: DbusCall) => {
        calls.push(call);
        return Promise.resolve(answer);
      },
    },
  };
};

describe("readIconTheme", () => {
  it("reads the config's icon theme from the compositor's Settings portal", async () => {
    const { calls, system } = answering(
      Ok({
        body: [
          {
            "org.gnome.desktop.interface": {
              "icon-theme": { signature: "s", value: "Papirus-Dark" },
            },
          },
        ],
        signature: "a{sa{sv}}",
      }),
    );

    expect(await readIconTheme(system)).toStrictEqual(Ok(Some("Papirus-Dark")));
    expect(calls).toStrictEqual([
      {
        body: [["org.gnome.desktop.interface"]],
        bus: Bus.Session,
        destination: "org.freedesktop.impl.portal.desktop.domicile",
        interface: "org.freedesktop.impl.portal.Settings",
        member: "ReadAll",
        path: "/org/freedesktop/portal/desktop",
        signature: "as",
      },
    ]);
  });

  it("reads no theme when the config sets none", async () => {
    const { system } = answering(Ok({ body: [{}], signature: "a{sa{sv}}" }));

    expect(await readIconTheme(system)).toStrictEqual(Ok(None()));
  });

  it("fails when the portal does", async () => {
    const failure = { kind: SystemErrorKind.Dbus, message: "no portal" };
    const { system } = answering(Err(failure));

    expect(await readIconTheme(system)).toStrictEqual(Err(failure));
  });
});

/** `ReadAll`'s answer for a config whose icon theme is `theme`. */
const readAll = (theme: string): Result<DbusBody, SystemError> =>
  Ok({
    body: [
      {
        "org.gnome.desktop.interface": {
          "icon-theme": { signature: "s", value: theme },
        },
      },
    ],
    signature: "a{sa{sv}}",
  });

/** A `SettingChanged` signal from the compositor's Settings portal. */
const changed = (
  namespace: string,
  key: string,
  value: string,
): DbusSignal => ({
  body: [namespace, key, { signature: "s", value }],
  interface: "org.freedesktop.impl.portal.Settings",
  member: "SettingChanged",
  path: "/org/freedesktop/portal/desktop",
  sender: ":1.7",
  signature: "ssv",
});

/** A portal that reads `theme`, and whose signals the test sends. */
const portal = (theme: string, refused?: SystemError) => {
  const matches: DbusMatch[] = [];
  const signals =
    Promise.withResolvers<ReadableStreamDefaultController<DbusSignal>>();
  const items = new ReadableStream<DbusSignal>({
    start: (controller) => {
      signals.resolve(controller);
    },
  });
  const state = { stopped: false };
  return {
    matches,
    send: async (signal: DbusSignal) => {
      (await signals.promise).enqueue(signal);
    },
    state,
    system: {
      dbusCall: () => Promise.resolve(readAll(theme)),
      dbusMatch: (match: DbusMatch) => {
        matches.push(match);
        return Promise.resolve(
          refused === undefined
            ? Ok<Listening<DbusSignal>, SystemError>({
                ended: new Promise(() => {
                  /* never ends on its own */
                }),
                items,
                stop: () => {
                  state.stopped = true;
                },
              })
            : Err<Listening<DbusSignal>, SystemError>(refused),
        );
      },
    },
  };
};

/** The next `count` themes `watchIconTheme` reports. */
const reports = (
  system: ReturnType<typeof portal>["system"],
  count: number,
) => {
  const heard: Result<Option<string>, SystemError>[] = [];
  const done = Promise.withResolvers<Result<Option<string>, SystemError>[]>();
  const stop = watchIconTheme(system, (theme) => {
    heard.push(theme);
    if (heard.length === count) {
      done.resolve(heard);
    }
  });
  return { heard: done.promise, stop };
};

describe("watchIconTheme", () => {
  it("reads the theme, then follows the portal's changes to it", async () => {
    const bus = portal("Papirus");
    const { heard } = reports(bus.system, 2);

    await bus.send(changed("org.freedesktop.appearance", "contrast", "x"));
    await bus.send(
      changed("org.gnome.desktop.interface", "icon-theme", "Adwaita"),
    );

    expect(await heard).toStrictEqual([
      Ok(Some("Papirus")),
      Ok(Some("Adwaita")),
    ]);
    expect(bus.matches).toStrictEqual([
      {
        bus: Bus.Session,
        interface: "org.freedesktop.impl.portal.Settings",
        member: "SettingChanged",
        path: "/org/freedesktop/portal/desktop",
        sender: "org.freedesktop.impl.portal.desktop.domicile",
      },
    ]);
  });

  it("reports a refused watch, and still reads the theme", async () => {
    const refused = { kind: SystemErrorKind.Dbus, message: "no portal" };
    const { heard } = reports(portal("Papirus", refused).system, 2);

    expect(await heard).toStrictEqual([Err(refused), Ok(Some("Papirus"))]);
  });

  it("stops following when stopped", async () => {
    const bus = portal("Papirus");
    const { heard, stop } = reports(bus.system, 1);
    await heard;

    stop();

    expect(bus.state.stopped).toBe(true);
  });
});
