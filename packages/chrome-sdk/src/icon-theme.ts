// The config's `theme.icon_theme`, read from the compositor's Settings portal
// backend: `org.gnome.desktop.interface`'s `icon-theme`, which applications
// read too. See `docs/SHELL-CONFIG.md`.

import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import { z } from "zod";

import type { DbusSignal, Listening, System, SystemError } from "./system";
import { Bus } from "./system";

const DESTINATION = "org.freedesktop.impl.portal.desktop.domicile";
const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.impl.portal.Settings";
const INTERFACE = "org.gnome.desktop.interface";
const ICON_THEME = "icon-theme";

/** The calls this module makes. */
export type IconThemeSystem = Pick<System, "dbusCall" | "dbusMatch">;

/**
 * The icon theme's directory name, such as `Papirus-Dark`, or `None` where
 * the config sets none and shells use `hicolor`.
 */
export const readIconTheme = async (
  system: Pick<System, "dbusCall">,
): Promise<Result<Option<string>, SystemError>> =>
  (
    await system.dbusCall({
      body: [[INTERFACE]],
      bus: Bus.Session,
      destination: DESTINATION,
      interface: SETTINGS,
      member: "ReadAll",
      path: PATH,
      signature: "as",
    })
  ).map(({ body }) => {
    const theme = readAllSchema.parse(body)[0][INTERFACE]?.[ICON_THEME];
    return theme === undefined ? None() : Some(theme);
  });

/**
 * Calls `listener` with the icon theme now and after each change to it, until
 * the returned function is called. A watch the desktop refuses is reported as
 * an `Err`, and the theme is still read once.
 */
export const watchIconTheme = (
  system: IconThemeSystem,
  listener: (theme: Result<Option<string>, SystemError>) => void,
): (() => void) => {
  const watch: {
    listening: Listening<DbusSignal> | undefined;
    stopped: boolean;
  } = { listening: undefined, stopped: false };
  const report = (theme: Result<Option<string>, SystemError>) => {
    if (!watch.stopped) {
      listener(theme);
    }
  };
  follow(system, watch, report).catch((error: unknown) => {
    // biome-ignore lint/suspicious/noConsole: surfacing a background failure
    console.error("Failed to watch the icon theme", error);
  });
  return () => {
    watch.stopped = true;
    watch.listening?.stop();
  };
};

/** Listen, read, then report each `icon-theme` change. */
const follow = async (
  system: IconThemeSystem,
  watch: { listening: Listening<DbusSignal> | undefined; stopped: boolean },
  report: (theme: Result<Option<string>, SystemError>) => void,
): Promise<void> => {
  // Listen before reading, so a change between the two is not missed.
  const matched = await system.dbusMatch({
    bus: Bus.Session,
    interface: SETTINGS,
    member: "SettingChanged",
    path: PATH,
    sender: DESTINATION,
  });
  await matched.match({
    Err: async (error) => {
      report(Err(error));
      report(await readIconTheme(system));
    },
    Ok: async (listening) => {
      watch.listening = listening;
      if (watch.stopped) {
        listening.stop();
      }
      report(await readIconTheme(system));
      const reader = listening.items.getReader();
      for (
        let next = await reader.read();
        !next.done;
        next = await reader.read()
      ) {
        const [namespace, key, { value }] = settingChangedSchema.parse(
          next.value.body,
        );
        if (namespace === INTERFACE && key === ICON_THEME) {
          report(Ok(Some(z.string().parse(value))));
        }
      }
      (await listening.ended).match({
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

/** `ReadAll`'s `a{sa{sv}}`, keeping only the icon theme. */
const readAllSchema = z.tuple([
  z.record(
    z.string(),
    z.object({
      [ICON_THEME]: z
        .object({ value: z.string() })
        .transform(({ value }) => value)
        .optional(),
    }),
  ),
]);

/** `SettingChanged`'s `ssv`. The value's type depends on the key. */
const settingChangedSchema = z.tuple([
  z.string(),
  z.string(),
  z.object({ value: z.unknown() }),
]);
