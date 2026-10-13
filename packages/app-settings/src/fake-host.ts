// An in-memory stand-in for the settings host, for the app's tests.

import type {
  InstalledExtension,
  MediaDevices,
  SettingsFiles,
  SettingsHost,
  SiteSettings,
  Target,
} from "./host";

/** What a fake host starts with. */
export type FakeHostState = {
  files: SettingsFiles;
  /** The folder the picker returns, or `undefined` for a canceled one. */
  chosen: string | undefined;
  /** The ids the engine says the config installed. */
  configExtensions: string[];
  /** The extensions in the profile, which switches change. */
  installed: InstalledExtension[];
  sites: SiteSettings;
  media: MediaDevices;
  /** The reason every write is refused, if any. */
  refuse?: string | undefined;
};

/**
 * A host over `state`, which writes change; `writes`, `opened` and the rest
 * record each request.
 */
export const fakeHost = (state: FakeHostState) => {
  const changes = new Set<() => void>();
  const writes: { file: Target; text: string }[] = [];
  const loaded: string[] = [];
  const uninstalled: string[] = [];
  const opened: string[] = [];
  /** Each folder the picker returned. */
  const chosen: (string | undefined)[] = [];
  const host: SettingsHost = {
    chooseFolder: () => {
      chosen.push(state.chosen);
      return Promise.resolve(state.chosen);
    },
    configExtensions: () => Promise.resolve([...state.configExtensions]),
    extensions: () => Promise.resolve(structuredClone(state.installed)),
    loadUnpacked: (directory) => {
      loaded.push(directory);
      return Promise.resolve("c".repeat(32));
    },
    mediaDevices: () => Promise.resolve(structuredClone(state.media)),
    onChange: (listener) => {
      changes.add(listener);
      return () => {
        changes.delete(listener);
      };
    },
    openUrl: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    read: () => Promise.resolve(structuredClone(state.files)),
    setExtensionEnabled: (id, enabled) => {
      const found = state.installed.find((extension) => extension.id === id);
      if (found === undefined) {
        throw new Error(`No extension ${id}`);
      } else {
        found.enabled = enabled;
        return Promise.resolve();
      }
    },
    setMediaDevice: (kind, id) => {
      const list = kind === "camera" ? "cameras" : "microphones";
      const preferred = state.media[list].filter((device) => device.id === id);
      const others = state.media[list].filter((device) => device.id !== id);
      state.media = { ...state.media, [list]: [...preferred, ...others] };
      return Promise.resolve();
    },
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
    uninstallExtension: (id) => {
      uninstalled.push(id);
      return Promise.resolve();
    },
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
  return {
    change,
    chosen,
    host,
    loaded,
    opened,
    state,
    uninstalled,
    writes,
  };
};
