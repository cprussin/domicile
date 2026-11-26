// The config's `browser`, as the Profiles page changes it: each change
// returns the whole `browser` to write, which the config accepts. The rules
// are `domicile-config`'s `BrowserConfig::validate`: the default profile is
// never private, the default private one always is, and no site opens in the
// default profile.

import type { Settings } from "./config-schema";
import { isSite } from "./sites";

/** The config's `browser`, with its defaults filled in. */
export type BrowserConfig = Settings["browser"];

/** One profile in the config. */
export type ConfigProfile = BrowserConfig["profiles"][string];

/** How a profile blocks ads and trackers. */
export type AdBlocking = NonNullable<
  ConfigProfile["protections"]["block_ads_and_trackers"]
>;

/**
 * A new profile's protections: every one on, as `domicile-config` has it, and
 * ads blocked as the profile's default (see {@link adBlockingOf}).
 */
export const PROTECTIONS_ON: ConfigProfile["protections"] = {
  block_ads_and_trackers: undefined,
  block_third_party_cookies: true,
  global_privacy_control: true,
  hide_device_details: true,
  hide_local_ip_address: true,
  remove_tracking_from_links: true,
};

/**
 * How `profile` blocks ads and trackers, as `domicile-config`'s
 * `BrowserProfile::ad_blocking` has it: what it says, or strict for a private
 * profile and standard for any other.
 */
export const adBlockingOf = (profile: ConfigProfile): AdBlocking =>
  profile.protections.block_ads_and_trackers ??
  (profile.private ? "strict" : "standard");

/** The colors a new profile and the color row pick from. */
export const PROFILE_COLORS = [
  "#06b6d4",
  "#0d9488",
  "#d97706",
  "#2563eb",
  "#db2777",
  "#65a30d",
  "#a78bfa",
] as const;

/**
 * Whether `site` can open in a profile: a site as `isSite` has it, or a host
 * and a path with no empty part, such as `github.com/acme`.
 */
export const isProfileSite = (site: string): boolean => {
  const slash = site.indexOf("/");
  if (slash === -1) {
    return isSite(site);
  } else {
    const path = site.slice(slash + 1).split("/");
    return isSite(site.slice(0, slash)) && path.every((part) => part !== "");
  }
};

/**
 * An id for a profile named `name`: its letters and digits, lowercased, with
 * `-` between words, and a number after it if another profile has it.
 */
export const profileIdFor = (
  name: string,
  taken: readonly string[],
): string => {
  const base =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-|-$/g, "") || "profile";
  let id = base;
  for (let number = 2; taken.includes(id); number += 1) {
    id = `${base}-${String(number)}`;
  }
  return id;
};

/** `browser` with a new profile named `name`, in a color no profile has yet. */
export const withNewProfile = (
  browser: BrowserConfig,
  name: string,
): BrowserConfig => {
  const ids = Object.keys(browser.profiles);
  const used = new Set(Object.values(browser.profiles).map((p) => p.color));
  const color =
    PROFILE_COLORS.find((candidate) => !used.has(candidate)) ??
    PROFILE_COLORS[ids.length % PROFILE_COLORS.length] ??
    PROFILE_COLORS[0];
  return {
    ...browser,
    profiles: {
      ...browser.profiles,
      [profileIdFor(name, ids)]: {
        color,
        extensions: undefined,
        name,
        private: false,
        protections: PROTECTIONS_ON,
      },
    },
  };
};

/** `browser` with profile `id` changed by `change`. */
export const withProfileChanged = (
  browser: BrowserConfig,
  id: string,
  change: Partial<ConfigProfile>,
): BrowserConfig => {
  const profile = browser.profiles[id];
  if (profile === undefined) {
    throw new Error(`The config has no browser profile ${id}`);
  }
  return {
    ...browser,
    profiles: { ...browser.profiles, [id]: { ...profile, ...change } },
  };
};

/**
 * `browser` without profile `id` and the sites that open in it, which go back
 * to the default profile. The two defaults can't be removed.
 */
export const withoutProfile = (
  browser: BrowserConfig,
  id: string,
): BrowserConfig => {
  if (
    id === browser.default_profile ||
    id === browser.default_private_profile
  ) {
    throw new Error(`${id} is a default profile, which can't be removed`);
  }
  const { [id]: _removed, ...profiles } = browser.profiles;
  return {
    ...browser,
    order: browser.order.filter((each) => each !== id),
    profiles,
    sites: Object.fromEntries(
      Object.entries(browser.sites).filter(([, profile]) => profile !== id),
    ),
  };
};

/**
 * `browser` with `id` the default profile, or the default private profile if
 * it is private. Its sites leave the list: unlisted sites open in the
 * default.
 */
export const withDefault = (
  browser: BrowserConfig,
  id: string,
): BrowserConfig => {
  const profile = browser.profiles[id];
  if (profile === undefined) {
    throw new Error(`The config has no browser profile ${id}`);
  } else if (profile.private) {
    return { ...browser, default_private_profile: id };
  } else {
    return {
      ...browser,
      default_profile: id,
      sites: Object.fromEntries(
        Object.entries(browser.sites).filter(([, opens]) => opens !== id),
      ),
    };
  }
};

/** `browser` with `site` opening in `profile`, or unlisted for the default. */
export const withSite = (
  browser: BrowserConfig,
  site: string,
  profile: string,
): BrowserConfig => {
  const { [site]: _old, ...others } = browser.sites;
  return {
    ...browser,
    sites:
      profile === browser.default_profile
        ? others
        : { ...others, [site]: profile },
  };
};

/**
 * The profile ids in the order the desk lists them, as `domicile-config`'s
 * `ordered_profiles` has it: `order`'s, then the rest by id.
 */
export const profileOrder = (browser: BrowserConfig): string[] => {
  const listed = browser.order.filter((id) => id in browser.profiles);
  const rest = Object.keys(browser.profiles)
    .filter((id) => !listed.includes(id))
    .toSorted();
  return [...listed, ...rest];
};

/**
 * `browser` with profile `id` moved `by` places in the order, which then
 * names every profile. A move past either end leaves it at that end.
 */
export const withProfileMoved = (
  browser: BrowserConfig,
  id: string,
  by: number,
): BrowserConfig => {
  const order = profileOrder(browser);
  const from = order.indexOf(id);
  if (from === -1) {
    throw new Error(`The config has no browser profile ${id}`);
  }
  const to = Math.min(Math.max(from + by, 0), order.length - 1);
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { ...browser, order };
};

/**
 * `browser` as the config file should have it: each profile's protections
 * only where one is not its default, so a file never spells out a default.
 * Every switch is on, and ads are blocked as {@link adBlockingOf} has it,
 * unless the config says otherwise.
 */
export const asWritten = (browser: BrowserConfig) => ({
  ...browser,
  profiles: Object.fromEntries(
    Object.entries(browser.profiles).map(([id, profile]) => {
      const { protections, ...rest } = profile;
      const { block_ads_and_trackers: _ads, ...switches } = protections;
      const ads = adBlockingOf(profile);
      const changed: Partial<ConfigProfile["protections"]> = {
        ...(ads === adBlockingOf({ ...profile, protections: PROTECTIONS_ON })
          ? {}
          : { block_ads_and_trackers: ads }),
        ...Object.fromEntries(Object.entries(switches).filter(([, on]) => !on)),
      };
      return [
        id,
        Object.keys(changed).length === 0
          ? rest
          : { ...rest, protections: changed },
      ];
    }),
  ),
});
