import { describe, expect, it, setDefaultTimeout } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { blockedText, SiteShield } from "./SiteShield";
import type { SitePrivacy } from "./useSitePrivacy";

// Each test drives the popover through user-event, which is slow under CI's
// load, as in `SitePermissions.test.tsx`.
setDefaultTimeout(15_000);

const ON: SitePrivacy = {
  blocked: 23,
  mode: "standard",
  protections: {
    hideCookieBanners: { on: true, setFor: "profile" },
    hideDeviceDetails: { on: true, setFor: "profile" },
    removeTrackingFromLinks: { on: true, setFor: "profile" },
  },
  setFor: "profile",
  site: "nytimes.com",
};

/** The shield for `privacy`, recording what it asks of the page. */
const renderShield = (privacy: SitePrivacy) => {
  const calls: string[] = [];
  render(
    <SiteShield
      onOpenSettings={() => {
        calls.push("settings");
      }}
      onReload={() => {
        calls.push("reload");
      }}
      onSet={(mode, scope) => {
        calls.push(`${mode ?? "clear"} ${scope}`);
      }}
      onSetProtection={(protection, on, scope) => {
        calls.push(`${protection} ${on ?? "clear"} ${scope}`);
      }}
      privacy={privacy}
    />,
  );
  return calls;
};

const openShield = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name }));
};

describe("SiteShield", () => {
  it("shows the count only in the panel", async () => {
    renderShield(ON);

    expect(
      screen.queryByText("23 ads and trackers blocked on this page"),
    ).toBeNull();
    await openShield("Protections");

    expect(
      screen.getByText("23 ads and trackers blocked on this page"),
    ).toBeDefined();
    expect(screen.getByText("nytimes.com")).toBeDefined();
  });

  it("asks how long, with this window first, before turning off", async () => {
    const calls = renderShield(ON);
    await openShield("Protections");

    await userEvent.click(screen.getByRole("switch", { name: "Protections" }));

    expect(screen.getByText("Turn them off for how long?")).toBeDefined();
    const choices = screen.getAllByRole("radio");
    expect(choices.map((choice) => choice.textContent)).toStrictEqual([
      "This window onlyUntil you close it",
      "Always on this siteKept for nytimes.com",
    ]);
    expect(choices[0]?.getAttribute("aria-checked")).toBe("true");
    expect(calls).toStrictEqual([]);

    await userEvent.click(
      screen.getByRole("button", { name: "Turn off and reload" }),
    );

    expect(calls).toStrictEqual(["off window", "reload"]);
  });

  it("turns off for the site when asked to", async () => {
    const calls = renderShield(ON);
    await openShield("Protections");
    await userEvent.click(screen.getByRole("switch", { name: "Protections" }));

    await userEvent.click(screen.getByRole("radio", { name: /Always/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off and reload" }),
    );

    expect(calls).toStrictEqual(["off site", "reload"]);
  });

  it("changes nothing when canceled", async () => {
    const calls = renderShield(ON);
    await openShield("Protections");
    await userEvent.click(screen.getByRole("switch", { name: "Protections" }));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(calls).toStrictEqual([]);
    expect(
      screen.getByText("23 ads and trackers blocked on this page"),
    ).toBeDefined();
  });

  it("says where it was turned off, and clears that to turn on", async () => {
    const calls = renderShield({
      ...ON,
      blocked: 0,
      mode: "off",
      setFor: "window",
    });
    await openShield("Protections off");

    expect(screen.getByText("Off in this window only")).toBeDefined();
    await userEvent.click(screen.getByRole("switch", { name: "Protections" }));

    expect(calls).toStrictEqual(["clear window", "reload"]);
  });

  it("turns on for the site when the profile has them off", async () => {
    const calls = renderShield({ ...ON, mode: "off", setFor: "profile" });
    await openShield("Protections off");

    expect(screen.getByText("Off in this profile's settings")).toBeDefined();
    await userEvent.click(screen.getByRole("switch", { name: "Protections" }));

    expect(calls).toStrictEqual(["standard site", "reload"]);
  });

  it("has a switch for each protection, in order", async () => {
    renderShield(ON);
    await openShield("Protections");

    expect(
      screen
        .getAllByRole("switch")
        .map((each) => each.getAttribute("aria-label")),
    ).toStrictEqual([
      "Protections",
      "Hide cookie banners",
      "Remove tracking from links",
      "Hide your device's details",
    ]);
  });

  it("asks how long before turning one protection off", async () => {
    const calls = renderShield(ON);
    await openShield("Protections");

    await userEvent.click(
      screen.getByRole("switch", { name: "Hide cookie banners" }),
    );

    expect(
      screen.getByText('Turn off "Hide cookie banners" for how long?'),
    ).toBeDefined();
    expect(screen.getByText("Protections on")).toBeDefined();
    expect(calls).toStrictEqual([]);
    await userEvent.click(screen.getByRole("radio", { name: /Always/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off and reload" }),
    );

    expect(calls).toStrictEqual(["hideCookieBanners false site", "reload"]);
  });

  it("says where a protection was turned off, and clears that to turn on", async () => {
    const calls = renderShield({
      ...ON,
      protections: {
        ...ON.protections,
        removeTrackingFromLinks: { on: false, setFor: "window" },
      },
    });
    await openShield("Protections");

    expect(screen.getByText("Off in this window only")).toBeDefined();
    await userEvent.click(
      screen.getByRole("switch", { name: "Remove tracking from links" }),
    );

    expect(calls).toStrictEqual([
      "removeTrackingFromLinks clear window",
      "reload",
    ]);
  });

  it("turns a protection on for the site when the profile has it off", async () => {
    const calls = renderShield({
      ...ON,
      protections: {
        ...ON.protections,
        hideDeviceDetails: { on: false, setFor: "profile" },
      },
    });
    await openShield("Protections");

    await userEvent.click(
      screen.getByRole("switch", { name: "Hide your device's details" }),
    );

    expect(calls).toStrictEqual(["hideDeviceDetails true site", "reload"]);
  });

  it("shows no protection's switch while protections are off", async () => {
    renderShield({ ...ON, mode: "off", setFor: "site" });
    await openShield("Protections off");

    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("opens Settings", async () => {
    const calls = renderShield(ON);
    await openShield("Protections");

    await userEvent.click(
      screen.getByRole("button", { name: "Privacy settings" }),
    );

    expect(calls).toStrictEqual(["settings"]);
  });
});

describe("blockedText", () => {
  it("counts in words", () => {
    expect(blockedText(0)).toBe("Nothing blocked on this page yet");
    expect(blockedText(1)).toBe("1 ad or tracker blocked on this page");
    expect(blockedText(1234)).toBe(
      "1,234 ads and trackers blocked on this page",
    );
  });
});
