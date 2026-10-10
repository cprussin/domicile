import { describe, expect, it } from "bun:test";

import type { SiteSettings } from "./host";
import { siteName, sites, sitesWith } from "./site-groups";

const SETTINGS: SiteSettings = {
  defaults: {
    camera: "ask",
    clipboard: "ask",
    location: "ask",
    microphone: "ask",
    midi: "ask",
    notifications: "allow",
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

describe(sitesWith, () => {
  it("lists the sites with their own setting for a permission", () => {
    expect(sitesWith(SETTINGS, "camera")).toEqual([
      { origin: "https://meet.example", setting: "allow" },
    ]);
    expect(sitesWith(SETTINGS, "midi")).toEqual([]);
  });
});

describe(sites, () => {
  it("lists each site once, by name, with every permission's setting", () => {
    expect(sites(SETTINGS)).toEqual([
      {
        origin: "https://maps.example",
        own: 1,
        settings: {
          camera: "ask",
          clipboard: "ask",
          location: "block",
          microphone: "ask",
          midi: "ask",
          notifications: "allow",
        },
      },
      {
        origin: "https://meet.example",
        own: 2,
        settings: {
          camera: "allow",
          clipboard: "ask",
          location: "ask",
          microphone: "allow",
          midi: "ask",
          notifications: "allow",
        },
      },
    ]);
  });
});

describe(siteName, () => {
  it("names a web site by its host, and keeps a port that is not the default", () => {
    expect(siteName("https://meet.example")).toBe("meet.example");
    expect(siteName("http://127.0.0.1:8000")).toBe("127.0.0.1:8000");
    expect(siteName("chrome-extension://abc")).toBe("chrome-extension://abc");
  });
});
