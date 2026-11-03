import { describe, expect, it } from "bun:test";
import type { App } from "@domicile-desktop/component-library/useApps";

import { namedHolders } from "./named-holders";
import { BROWSER } from "./wake-locked-pages";

const described: Record<string, App> = {
  "com.slack.Slack": { icon: "data:image/png;base64,c2xhY2s=", name: "Slack" },
  mpv: { icon: undefined, name: "mpv" },
};

const app = (appId: string): App =>
  described[appId] ?? { icon: undefined, name: appId };

describe(namedHolders, () => {
  it("names each app by its entry, keeping a browser window's hold", () => {
    expect(namedHolders(["com.slack.Slack", BROWSER, "mpv"], app)).toEqual({
      holders: ["Slack", BROWSER, "mpv"],
      icons: new Map([["Slack", "data:image/png;base64,c2xhY2s="]]),
    });
  });
});
