// In-memory stand-ins for the settings host and `chrome.management`, for the
// app's tests.

import type { Extensions, InstalledExtension } from "./extensions";
import type { SettingsFiles, SettingsHost, SiteSettings, Target } from "./host";

/** What a fake host starts with. */
export type FakeHostState = {
  files: SettingsFiles;
  sites: SiteSettings;
  /** The reason every write is refused, if any. */
  refuse?: string | undefined;
};

/** A host over `state`, which writes change; `writes` records each. */
export const fakeHost = (state: FakeHostState) => {
  const changes = new Set<() => void>();
  const writes: { file: Target; text: string }[] = [];
  const host: SettingsHost = {
    onChange: (listener) => {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    read: () => Promise.resolve(structuredClone(state.files)),
    setSitePermission: (site) => {
      const others = state.sites.sites.filter(
        (stored) =>
          stored.origin !== site.origin ||
          stored.permission !== site.permission,
      );
      state.sites = {
        ...state.sites,
        sites:
          site.setting === state.sites.defaults[site.permission]
            ? others
            : [...others, site],
      };
      return Promise.resolve();
    },
    sitePermissions: () => Promise.resolve(structuredClone(state.sites)),
    write: (file, text) => {
      if (state.refuse === undefined) {
        writes.push({ file, text });
        const current = state.files[file];
        if (current === undefined) {
          throw new Error(`The fake has no ${file} to write`);
        } else {
          state.files = { ...state.files, [file]: { ...current, text } };
          return Promise.resolve();
        }
      } else {
        return Promise.reject(new Error(state.refuse));
      }
    },
  };
  /** Tells the app a file changed on disk. */
  const change = () => {
    for (const listener of changes) {
      listener();
    }
  };
  return { change, host, state, writes };
};

/** `chrome.management` over `installed`, which switches change. */
export const fakeExtensions = (installed: InstalledExtension[]) => {
  const opened: string[] = [];
  const extensions: Extensions = {
    list: () => Promise.resolve(structuredClone(installed)),
    // The fake's list changes only through `setEnabled`, which the page
    // follows by listing again.
    onChange: () => () => {
      /* nothing to stop */
    },
    openOptions: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    selfId: "acpgnhiblklkgbkcjgbabkcmdmchdphk",
    setEnabled: (id, enabled) => {
      const found = installed.find((extension) => extension.id === id);
      if (found === undefined) {
        throw new Error(`No extension ${id}`);
      } else {
        found.enabled = enabled;
        return Promise.resolve();
      }
    },
  };
  return { extensions, installed, opened };
};
