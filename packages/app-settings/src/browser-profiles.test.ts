import { describe, expect, it } from "bun:test";

import type { BrowserConfig } from "./browser-profiles";
import {
  adBlockingOf,
  asWritten,
  isProfileSite,
  PROTECTIONS_ON,
  profileIdFor,
  profileOrder,
  withDefault,
  withoutProfile,
  withProfileMoved,
  withSite,
} from "./browser-profiles";

const BROWSER: BrowserConfig = {
  block_lists: [],
  block_rules: [],
  cookie_banner_lists: [],
  default_private_profile: "private",
  default_profile: "personal",
  order: [],
  profiles: {
    personal: {
      color: "#0d9488",
      extensions: undefined,
      name: "Personal",
      private: false,
      protections: PROTECTIONS_ON,
    },
    private: {
      color: "#a78bfa",
      extensions: undefined,
      name: "Private",
      private: true,
      protections: PROTECTIONS_ON,
    },
    work: {
      color: "#d97706",
      extensions: undefined,
      name: "Work",
      private: false,
      protections: PROTECTIONS_ON,
    },
  },
  scriptlet_resources: undefined,
  sites: { "*.acme.com": "work" },
};

describe(isProfileSite, () => {
  it("takes a host, its subdomains, or a host and a path", () => {
    expect(isProfileSite("github.com")).toBe(true);
    expect(isProfileSite("*.github.com")).toBe(true);
    expect(isProfileSite("github.com/acme/api")).toBe(true);
  });

  it("refuses an empty path part and a host that is not one", () => {
    expect(isProfileSite("github.com//acme")).toBe(false);
    expect(isProfileSite("not a site")).toBe(false);
    expect(isProfileSite("*.github.com/acme/")).toBe(false);
  });
});

describe(profileIdFor, () => {
  it("spells a name as an id, numbering one that is taken", () => {
    expect(profileIdFor("Side Project!", [])).toBe("side-project");
    expect(profileIdFor("Work", ["work", "work-2"])).toBe("work-3");
    expect(profileIdFor("☕", [])).toBe("profile");
  });
});

describe(withDefault, () => {
  it("makes a private profile the default private one, keeping the sites", () => {
    expect(withDefault(BROWSER, "private")).toEqual({
      ...BROWSER,
      default_private_profile: "private",
    });
  });
});

describe(withoutProfile, () => {
  it("refuses the defaults", () => {
    expect(() => withoutProfile(BROWSER, "personal")).toThrow(
      "personal is a default profile, which can't be removed",
    );
  });

  it("takes the profile out of the order", () => {
    const browser = { ...BROWSER, order: ["work", "personal"] };
    expect(withoutProfile(browser, "work").order).toStrictEqual(["personal"]);
  });
});

describe(profileOrder, () => {
  it("lists the order's profiles, then the rest by id", () => {
    expect(profileOrder({ ...BROWSER, order: ["work"] })).toStrictEqual([
      "work",
      "personal",
      "private",
    ]);
  });
});

describe(withProfileMoved, () => {
  it("moves a profile and writes the whole order", () => {
    expect(withProfileMoved(BROWSER, "work", -1).order).toStrictEqual([
      "personal",
      "work",
      "private",
    ]);
  });

  it("stops at either end", () => {
    expect(withProfileMoved(BROWSER, "personal", -1).order).toStrictEqual([
      "personal",
      "private",
      "work",
    ]);
  });
});

describe(withSite, () => {
  it("unlists a site moved to the default profile", () => {
    expect(withSite(BROWSER, "*.acme.com", "personal").sites).toEqual({});
  });
});

describe("asWritten", () => {
  it("leaves out protections that are on", () => {
    expect(asWritten(BROWSER).profiles.personal).toEqual({
      color: "#0d9488",
      extensions: undefined,
      name: "Personal",
      private: false,
    });
  });

  it("keeps only the protections that are off", () => {
    const written = asWritten({
      ...BROWSER,
      profiles: {
        ...BROWSER.profiles,
        work: {
          color: "#d97706",
          extensions: undefined,
          name: "Work",
          private: false,
          protections: { ...PROTECTIONS_ON, global_privacy_control: false },
        },
      },
    });
    expect(written.profiles.work).toEqual({
      color: "#d97706",
      extensions: undefined,
      name: "Work",
      private: false,
      protections: { global_privacy_control: false },
    });
  });
});

/** {@link BROWSER}'s profile `id`. */
const profileIn = (id: string) => {
  const profile = BROWSER.profiles[id];
  if (profile === undefined) {
    throw new Error(`BROWSER has no profile ${id}`);
  }
  return profile;
};

describe("adBlockingOf", () => {
  it("is standard for a profile that doesn't say, and strict for a private one", () => {
    expect(adBlockingOf(profileIn("personal"))).toBe("standard");
    expect(adBlockingOf(profileIn("private"))).toBe("strict");
  });

  it("is what the profile says", () => {
    expect(
      adBlockingOf({
        ...profileIn("private"),
        protections: { ...PROTECTIONS_ON, block_ads_and_trackers: "off" },
      }),
    ).toBe("off");
  });
});

describe("asWritten's ad blocking", () => {
  const blocking = (
    profile: "personal" | "private",
    mode: "standard" | "strict" | "off",
  ) =>
    asWritten({
      ...BROWSER,
      profiles: {
        ...BROWSER.profiles,
        [profile]: {
          ...profileIn(profile),
          protections: { ...PROTECTIONS_ON, block_ads_and_trackers: mode },
        },
      },
    }).profiles[profile];

  it("leaves out a profile's default", () => {
    expect(blocking("personal", "standard")).not.toHaveProperty("protections");
    expect(blocking("private", "strict")).not.toHaveProperty("protections");
  });

  it("keeps any other", () => {
    expect(blocking("personal", "strict")).toHaveProperty("protections", {
      block_ads_and_trackers: "strict",
    });
    expect(blocking("private", "standard")).toHaveProperty("protections", {
      block_ads_and_trackers: "standard",
    });
    expect(blocking("personal", "off")).toHaveProperty("protections", {
      block_ads_and_trackers: "off",
    });
  });
});
