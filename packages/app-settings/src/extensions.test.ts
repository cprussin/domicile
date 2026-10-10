import { describe, expect, it } from "bun:test";

import type { ManagementApi } from "./extensions";
import { chromeExtensions } from "./extensions";

/** A `chrome` with `installed` extensions, recording what the app did. */
const fakeApi = (installed: unknown[]) => {
  const listeners = new Set<() => void>();
  const event = {
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
  };
  const enabled: [string, boolean][] = [];
  const opened: string[] = [];
  const api: ManagementApi = {
    management: {
      getAll: () => Promise.resolve(installed),
      onDisabled: event,
      onEnabled: event,
      onInstalled: event,
      onUninstalled: event,
      setEnabled: (id, value) => {
        enabled.push([id, value]);
        return Promise.resolve();
      },
    },
    runtime: { id: "acpgnhiblklkgbkcjgbabkcmdmchdphk" },
    tabs: {
      create: ({ url }) => {
        opened.push(url);
        return Promise.resolve({});
      },
    },
  };
  return { api, enabled, listeners, opened };
};

const UBLOCK = {
  description: "An efficient content blocker.",
  enabled: true,
  id: "ddkjiahejlhfcafbddmgiahcphecmpfh",
  installType: "normal",
  name: "uBlock Origin Lite",
  optionsUrl:
    "chrome-extension://ddkjiahejlhfcafbddmgiahcphecmpfh/dashboard.html",
  type: "extension",
  version: "2025.1",
};

describe(chromeExtensions, () => {
  it("lists extensions by name, leaving out themes and apps", async () => {
    const { api } = fakeApi([
      { ...UBLOCK, id: "b".repeat(32), name: "zotero", optionsUrl: "" },
      UBLOCK,
      { ...UBLOCK, id: "c".repeat(32), name: "A theme", type: "theme" },
    ]);
    expect(await chromeExtensions(api).list()).toEqual([
      {
        description: "An efficient content blocker.",
        enabled: true,
        id: UBLOCK.id,
        name: "uBlock Origin Lite",
        optionsUrl: UBLOCK.optionsUrl,
        version: "2025.1",
      },
      {
        description: "An efficient content blocker.",
        enabled: true,
        id: "b".repeat(32),
        name: "zotero",
        optionsUrl: undefined,
        version: "2025.1",
      },
    ]);
  });

  it("turns an extension on and off, and opens its options", async () => {
    const { api, enabled, opened } = fakeApi([UBLOCK]);
    const extensions = chromeExtensions(api);
    await extensions.setEnabled(UBLOCK.id, false);
    await extensions.openOptions(UBLOCK.optionsUrl);
    expect(enabled).toEqual([[UBLOCK.id, false]]);
    expect(opened).toEqual([UBLOCK.optionsUrl]);
  });

  it("knows its own id", () => {
    expect(chromeExtensions(fakeApi([]).api).selfId).toBe(
      "acpgnhiblklkgbkcjgbabkcmdmchdphk",
    );
  });

  it("calls a listener on any install, removal or switch, until it stops", () => {
    const { api, listeners } = fakeApi([]);
    const stop = chromeExtensions(api).onChange(() => {
      /* only the count of listeners matters */
    });
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });
});
