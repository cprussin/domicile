import { describe, expect, it } from "bun:test";

import type { SiteSettings } from "./host";
import { siteName, sites, sitesWith } from "./site-groups";

const SETTINGS: SiteSettings = {
  defaults: {
    "automatic-downloads": "ask",
    camera: "ask",
    clipboard: "ask",
    "idle-detection": "ask",
    "local-fonts": "ask",
    location: "ask",
    microphone: "ask",
    midi: "ask",
    notifications: "allow",
    "window-management": "ask",
  },
  sites: [
    {
      origin: "https://meet.example",
      permission: "microphone",
      setting: "allow",
    },
    {
      origin: "https://maps.example",
      permission: "location",
      setting: "block",
    },
    { origin: "https://meet.example", permission: "camera", setting: "allow" },
  ],
};

const NAMES = new Map([["abc", "Zotero"]]);

describe(sitesWith, () => {
  it("lists the sites with their own setting for a permission", () => {
    expect(sitesWith(SETTINGS, "camera", NAMES)).toEqual([
      { origin: "https://meet.example", setting: "allow" },
    ]);
    expect(sitesWith(SETTINGS, "midi", NAMES)).toEqual([]);
  });
});

describe(sites, () => {
  it("lists each site once, by name, with every permission's setting", () => {
    expect(sites(SETTINGS, NAMES)).toEqual([
      {
        origin: "https://maps.example",
        own: 1,
        settings: {
          "automatic-downloads": "ask",
          camera: "ask",
          clipboard: "ask",
          "idle-detection": "ask",
          "local-fonts": "ask",
          location: "block",
          microphone: "ask",
          midi: "ask",
          notifications: "allow",
          "window-management": "ask",
        },
      },
      {
        origin: "https://meet.example",
        own: 2,
        settings: {
          "automatic-downloads": "ask",
          camera: "allow",
          clipboard: "ask",
          "idle-detection": "ask",
          "local-fonts": "ask",
          location: "ask",
          microphone: "allow",
          midi: "ask",
          notifications: "allow",
          "window-management": "ask",
        },
      },
    ]);
  });
});

describe(siteName, () => {
  it("names a web site by its host, and keeps a port that is not the default", () => {
    expect(siteName("https://meet.example", NAMES)).toBe("meet.example");
    expect(siteName("http://127.0.0.1:8000", NAMES)).toBe("127.0.0.1:8000");
  });

  it("names an installed extension by its name, and another by its origin", () => {
    expect(siteName("chrome-extension://abc", NAMES)).toBe("Zotero");
    expect(siteName("chrome-extension://xyz", NAMES)).toBe(
      "chrome-extension://xyz",
    );
  });
});
