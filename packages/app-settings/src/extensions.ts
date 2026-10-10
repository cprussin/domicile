// The browser's extensions through `chrome.management`, with every answer
// parsed. Installing and removing go through the config instead; see
// `config-extensions.ts`.

import { z } from "zod";

/** A `chrome.*` event the app adds a listener to and removes it from. */
type ChromeEvent = {
  addListener: (listener: () => void) => void;
  removeListener: (listener: () => void) => void;
};

/** The parts of the `chrome` global this module calls. */
export type ManagementApi = {
  management: {
    getAll: () => Promise<unknown>;
    onDisabled: ChromeEvent;
    onEnabled: ChromeEvent;
    onInstalled: ChromeEvent;
    onUninstalled: ChromeEvent;
    setEnabled: (id: string, enabled: boolean) => Promise<unknown>;
  };
  runtime: { id: string };
  tabs: { create: (properties: { url: string }) => Promise<unknown> };
};

declare const chrome: ManagementApi;

const extensionSchema = z
  .object({
    description: z.string(),
    enabled: z.boolean(),
    id: z.string(),
    name: z.string(),
    optionsUrl: z.string(),
    type: z.string(),
    version: z.string(),
  })
  .transform(({ optionsUrl, type: _type, ...extension }) => ({
    ...extension,
    // Chrome reports no options page as "".
    optionsUrl: optionsUrl === "" ? undefined : optionsUrl,
  }));

/** An extension in the browser windows' profile. */
export type InstalledExtension = z.output<typeof extensionSchema>;

/** What the app does with extensions. */
export type Extensions = {
  list: () => Promise<InstalledExtension[]>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Opens an extension's options page in a browser window. */
  openOptions: (url: string) => Promise<void>;
  /** Calls `listener` on any change to the list. Returns an unsubscribe. */
  onChange: (listener: () => void) => () => void;
  /** This app's own id. */
  selfId: string;
};

/** {@link Extensions} over `chrome.management`. */
export const chromeExtensions = (api: ManagementApi = chrome): Extensions => {
  const events = [
    api.management.onDisabled,
    api.management.onEnabled,
    api.management.onInstalled,
    api.management.onUninstalled,
  ];
  return {
    list: async () =>
      z
        .array(z.object({ type: z.string() }).loose())
        .parse(await api.management.getAll())
        .filter((item) => item.type === "extension")
        .map((item) => extensionSchema.parse(item))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    onChange: (listener) => {
      for (const event of events) {
        event.addListener(listener);
      }
      return () => {
        for (const event of events) {
          event.removeListener(listener);
        }
      };
    },
    openOptions: async (url) => {
      await api.tabs.create({ url });
    },
    selfId: api.runtime.id,
    setEnabled: async (id, enabled) => {
      await api.management.setEnabled(id, enabled);
    },
  };
};
