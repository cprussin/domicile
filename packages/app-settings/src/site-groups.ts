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

/** The sites with a setting of their own for `permission`, by origin. */
export const sitesWith = (
  settings: SiteSettings,
  permission: Permission,
): SiteSetting[] =>
  settings.sites
    .filter((site) => site.permission === permission)
    .map(({ origin, setting }) => ({ origin, setting }))
    .toSorted((a, b) => siteName(a.origin).localeCompare(siteName(b.origin)));

/** Every site with a setting of its own, by name. */
export const sites = (settings: SiteSettings): Site[] =>
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
          camera: settingFor("camera"),
          clipboard: settingFor("clipboard"),
          location: settingFor("location"),
          microphone: settingFor("microphone"),
          midi: settingFor("midi"),
          notifications: settingFor("notifications"),
        },
      };
    })
    .toSorted((a, b) => siteName(a.origin).localeCompare(siteName(b.origin)));

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

/** A site as a person reads it: a web site's host, or the whole origin. */
export const siteName = (origin: string): string => {
  const url = new URL(origin);
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.host
    : origin;
};
