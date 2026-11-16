import type { BrowserProfile } from "@domicile-desktop/sdk/desktop/browser";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useCallback, useSyncExternalStore } from "react";

/** The desk's browser profiles and the one a window's page is in. */
export type WindowProfile = {
  /** The page's profile. */
  profile: BrowserProfile;
  /** Every profile, in the config's order. */
  profiles: readonly BrowserProfile[];
};

/**
 * The browser profile browser window `engineId`'s page is in, with the
 * others; `undefined` until the engine lists both, or for a page in none.
 */
export const useBrowserProfile = (
  domicile: Pick<Domicile, "browser">,
  engineId: string,
): WindowProfile | undefined => {
  const subscribe = useCallback(
    (changed: () => void) => {
      const windows = domicile.browser.on("change", changed);
      const profiles = domicile.browser.on("profilesChange", changed);
      return () => {
        windows();
        profiles();
      };
    },
    [domicile],
  );
  const profiles = useSyncExternalStore(
    subscribe,
    () => domicile.browser.profiles,
  );
  const id = useSyncExternalStore(
    subscribe,
    () =>
      domicile.browser.windows?.find((window) => window.id === engineId)
        ?.profile,
  );
  const profile = profiles?.find((each) => each.id === id);
  return profiles === undefined || profile === undefined
    ? undefined
    : { profile, profiles };
};

/**
 * The color of the browser profile browser window `engineId`'s page is in,
 * when that is not the default profile; `undefined` for the default one, a
 * page in none, or no browser window. A tab marks its icon with it.
 */
export const useProfileMark = (
  domicile: Pick<Domicile, "browser">,
  engineId: string | undefined,
): string | undefined => {
  const subscribe = useCallback(
    (changed: () => void) => {
      const windows = domicile.browser.on("change", changed);
      const profiles = domicile.browser.on("profilesChange", changed);
      return () => {
        windows();
        profiles();
      };
    },
    [domicile],
  );
  return useSyncExternalStore(subscribe, () => {
    const id =
      engineId === undefined
        ? undefined
        : domicile.browser.windows?.find((window) => window.id === engineId)
            ?.profile;
    const profile = domicile.browser.profiles?.find((each) => each.id === id);
    return profile === undefined || profile.isDefault
      ? undefined
      : profile.color;
  });
};
