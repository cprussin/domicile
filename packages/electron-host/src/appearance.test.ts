import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import type { PortalSettings } from "./appearance";
import { watchAppearance } from "./appearance";
import type { Appearance } from "./electron/native-theme";

/** A settings portal holding `values`, by "namespace key". */
const portal = (values: Record<string, number>) => {
  const signals = new EventEmitter();
  const settings: PortalSettings = {
    on: (event, listener) => signals.on(event, listener),
    ReadOne: (namespace, key) => {
      const value = values[`${namespace} ${key}`];
      return value === undefined
        ? Promise.reject(new Error(`no ${key}`))
        : Promise.resolve({ value });
    },
  };
  const change = (namespace: string, key: string, value: number) => {
    signals.emit("SettingChanged", namespace, key, { value });
  };
  return { change, settings };
};

describe(watchAppearance, () => {
  it("reads the desktop's color scheme and contrast", async () => {
    const { settings } = portal({
      "org.freedesktop.appearance color-scheme": 1,
      "org.freedesktop.appearance contrast": 1,
    });

    expect(await watchAppearance(settings, () => undefined)).toEqual({
      colorScheme: "dark",
      highContrast: true,
    });
  });

  it("follows each change the portal sends, and nothing else", async () => {
    const { change, settings } = portal({
      "org.freedesktop.appearance color-scheme": 0,
      "org.freedesktop.appearance contrast": 0,
    });
    const seen: Appearance[] = [];
    expect(await watchAppearance(settings, (next) => seen.push(next))).toEqual({
      colorScheme: "none",
      highContrast: false,
    });

    change("org.freedesktop.appearance", "color-scheme", 2);
    change("org.gnome.desktop.interface", "icon-theme", 0);
    change("org.freedesktop.appearance", "contrast", 1);

    expect(seen).toEqual([
      { colorScheme: "light", highContrast: false },
      { colorScheme: "light", highContrast: true },
    ]);
  });

  it("fails loudly on a value the portal should never send", () => {
    const { settings } = portal({
      "org.freedesktop.appearance color-scheme": 7,
      "org.freedesktop.appearance contrast": 0,
    });

    expect(watchAppearance(settings, () => undefined)).rejects.toThrow(
      "the settings portal sent color-scheme 7",
    );
  });
});
