// The browser's extensions through the settings host. Installing and removing
// go through the config or the host's own requests; see `host.ts`.

import type { InstalledExtension, SettingsHost } from "./host";

/** What the app does with extensions. */
export type Extensions = {
  list: () => Promise<InstalledExtension[]>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Opens an extension's options page in a browser window. */
  openOptions: (url: string) => Promise<void>;
  /** Calls `listener` on any change to the list. Returns an unsubscribe. */
  onChange: (listener: () => void) => () => void;
};

/**
 * {@link Extensions} over `host`. A listener hears this app's own switches
 * and every change the host pushes.
 */
export const hostExtensions = (host: SettingsHost): Extensions => {
  const switched = new Set<() => void>();
  return {
    list: async () =>
      (await host.extensions()).toSorted((a, b) =>
        a.name.localeCompare(b.name),
      ),
    onChange: (listener) => {
      switched.add(listener);
      const stop = host.onChange(listener);
      return () => {
        switched.delete(listener);
        stop();
      };
    },
    openOptions: (url) => host.openUrl(url),
    setEnabled: async (id, enabled) => {
      await host.setExtensionEnabled(id, enabled);
      for (const listener of switched) {
        listener();
      }
    },
  };
};
