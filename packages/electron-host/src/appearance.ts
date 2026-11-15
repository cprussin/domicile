// The desktop's appearance, for `nativeTheme`: the settings portal's
// `org.freedesktop.appearance` keys, as Electron reads them on Linux. See
// "Settings" in docs/PORTALS.md.

import type { Appearance } from "./electron/native-theme";

const NAMESPACE = "org.freedesktop.appearance";

/** What this reads of `org.freedesktop.portal.Settings`. */
export type PortalSettings = {
  readonly ReadOne: (
    namespace: string,
    key: string,
  ) => Promise<{ readonly value: unknown }>;
  readonly on: (
    event: "SettingChanged",
    listener: (
      namespace: string,
      key: string,
      value: { readonly value: unknown },
    ) => void,
  ) => unknown;
};

const COLOR_SCHEMES: Readonly<Record<number, Appearance["colorScheme"]>> = {
  0: "none",
  1: "dark",
  2: "light",
};

/** `color-scheme`'s value, read loudly: the portal is the desktop's own. */
const colorSchemeOf = (value: unknown) => {
  const scheme = typeof value === "number" ? COLOR_SCHEMES[value] : undefined;
  if (scheme === undefined) {
    throw new Error(
      `the settings portal sent color-scheme ${JSON.stringify(value)}, which is none of 0, 1 or 2`,
    );
  }
  return scheme;
};

const highContrastOf = (value: unknown) => {
  if (value !== 0 && value !== 1) {
    throw new Error(
      `the settings portal sent contrast ${JSON.stringify(value)}, which is neither 0 nor 1`,
    );
  }
  return value === 1;
};

/**
 * Reads the desktop's appearance from `settings`, then hands `changed` each
 * new one the portal sends.
 */
export const watchAppearance = async (
  settings: PortalSettings,
  changed: (appearance: Appearance) => void,
): Promise<Appearance> => {
  const [scheme, contrast] = await Promise.all([
    settings.ReadOne(NAMESPACE, "color-scheme"),
    settings.ReadOne(NAMESPACE, "contrast"),
  ]);
  let appearance: Appearance = {
    colorScheme: colorSchemeOf(scheme.value),
    highContrast: highContrastOf(contrast.value),
  };
  settings.on("SettingChanged", (namespace, key, { value }) => {
    if (namespace === NAMESPACE && key === "color-scheme") {
      appearance = { ...appearance, colorScheme: colorSchemeOf(value) };
      changed(appearance);
    } else if (namespace === NAMESPACE && key === "contrast") {
      appearance = { ...appearance, highContrast: highContrastOf(value) };
      changed(appearance);
    }
  });
  return appearance;
};
