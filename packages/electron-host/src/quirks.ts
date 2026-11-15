// What differs between the Electron apps `electron-host` runs, keyed by the
// app's `package.json` name, so a new app needs no new package. See
// "Apps inspected" in `docs/architecture/ELECTRON-APPS.md`.

export type Quirks = {
  /**
   * Why the app's pages need Node, which the engine doesn't give pages yet:
   * the host gives up before its main runs, and the app runs on its own
   * Electron.
   */
  readonly needsNodeInPages?: string;
};

const QUIRKS: Readonly<Record<string, Quirks>> = {
  "@joplin/app-desktop": {
    needsNodeInPages:
      "its windows ask for nodeIntegration and use @electron/remote",
  },
  "signal-desktop": {
    needsNodeInPages: "its pages load libsignal and ringrtc",
  },
  "teams-for-linux": {
    needsNodeInPages: "its preload uses Node with contextIsolation off",
  },
  zulip: {
    needsNodeInPages: "it uses @electron/remote and <webview> with sandbox off",
  },
};

/** What the app named `name` in its `package.json` needs done its way. */
export const quirksOf = (name: string): Quirks => QUIRKS[name] ?? {};
