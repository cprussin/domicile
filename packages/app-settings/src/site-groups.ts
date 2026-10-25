// The engine's site settings arranged two ways: the sites with a setting of
// their own for one permission, and each site with all its permissions.

import type { Permission, Setting, SitePermission, SiteSettings } from "./host";

/** A site's own setting for one permission. */
export type SiteSetting = { origin: string; setting: Setting };

/** A site and what it gets for each permission. */
export type Site = {
  origin: string;
  /** How many permissions the site has a setting of its own for. */
  own: number;
  settings: Readonly<Record<Permission, Setting>>;
};

/** Installed extensions' names by id. */
export type ExtensionNames = ReadonlyMap<string, string>;

/** The sites with a setting of their own for `permission`, by name. */
export const sitesWith = (
  settings: SiteSettings,
  permission: Permission,
  names: ExtensionNames,
): SiteSetting[] =>
  settings.sites
    .filter((site) => site.permission === permission)
    .map(({ origin, setting }) => ({ origin, setting }))
    .toSorted((a, b) =>
      siteName(a.origin, names).localeCompare(siteName(b.origin, names)),
    );

/** Every site with a setting of its own, by name. */
export const sites = (settings: SiteSettings, names: ExtensionNames): Site[] =>
  [...new Set(settings.sites.map((site) => site.origin))]
    .map((origin) => {
      const own = settings.sites.filter((site) => site.origin === origin);
      const settingFor = (permission: Permission) =>
        own.find((site) => site.permission === permission)?.setting ??
        settings.defaults[permission];
      return {
        origin,
        own: own.length,
        settings: {
          "automatic-downloads": settingFor("automatic-downloads"),
          camera: settingFor("camera"),
          clipboard: settingFor("clipboard"),
          "idle-detection": settingFor("idle-detection"),
          "local-fonts": settingFor("local-fonts"),
          location: settingFor("location"),
          microphone: settingFor("microphone"),
          midi: settingFor("midi"),
          notifications: settingFor("notifications"),
          "window-management": settingFor("window-management"),
        },
      };
    })
    .toSorted((a, b) =>
      siteName(a.origin, names).localeCompare(siteName(b.origin, names)),
    );

/** The changes that remove `origin`'s own settings: each set to the default. */
export const resetSite = (
  settings: SiteSettings,
  origin: string,
): SitePermission[] =>
  settings.sites
    .filter((site) => site.origin === origin)
    .map(({ permission }) => ({
      origin,
      permission,
      setting: settings.defaults[permission],
    }));

/**
 * A site as a person reads it: a web site's host, an installed extension's
 * name, or the whole origin.
 */
export const siteName = (origin: string, names: ExtensionNames): string => {
  const url = new URL(origin);
  switch (url.protocol) {
    case "http:":
    case "https:":
      return url.host;
    case "chrome-extension:":
      return names.get(url.host) ?? origin;
    default:
      return origin;
  }
};
