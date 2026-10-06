import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";

import type { Node } from "./fake-system";
import { fakeSystem } from "./fake-system";
import { defaultApps } from "./mime-apps";

/** A desktop whose environment is `variables` and whose files are `tree`. */
const desktop = (
  variables: Readonly<Record<string, string>>,
  tree: Readonly<Record<string, Node>> = {},
) =>
  fakeSystem(tree, () => ({
    code: 0,
    stderr: "",
    stdout: Object.entries(variables)
      .map(([name, value]) => `${name}=${value}\0`)
      .join(""),
  }));

const list = (defaults: string): string =>
  `[Default Applications]\n${defaults}\n`;

describe("defaultApps", () => {
  it("reads each list in the spec's order, the desktop's own first", async () => {
    const system = desktop(
      {
        XDG_CONFIG_DIRS: "/etc/xdg",
        XDG_CONFIG_HOME: "/config",
        XDG_CURRENT_DESKTOP: "Domicile:GNOME",
        XDG_DATA_DIRS: "/share",
        XDG_DATA_HOME: "/data",
      },
      {
        "/config/gnome-mimeapps.list": list("text/html=epiphany.desktop"),
        "/config/mimeapps.list": list("text/html=chromium.desktop"),
        "/data/applications/mimeapps.list": list("text/html=links.desktop"),
        "/etc/xdg/mimeapps.list": list("text/html=lynx.desktop"),
        "/share/applications/domicile-mimeapps.list": list(
          "text/html=firefox.desktop",
        ),
        "/share/applications/mimeapps.list": list("text/html=w3m.desktop"),
      },
    );

    expect(await defaultApps(system, "text/html")).toStrictEqual(
      Ok([
        "epiphany.desktop",
        "chromium.desktop",
        "lynx.desktop",
        "links.desktop",
        "firefox.desktop",
        "w3m.desktop",
      ]),
    );
  });

  it("reads only the type's defaults, in their own order", async () => {
    const system = desktop(
      { XDG_CONFIG_HOME: "/config" },
      {
        "/config/mimeapps.list": [
          "[Added Associations]",
          "text/plain=added.desktop",
          "[Default Applications]",
          "# text/plain=commented.desktop",
          "text/html=browser.desktop",
          "text/plain = gedit.desktop;vim.desktop;",
        ].join("\n"),
      },
    );

    expect(await defaultApps(system, "text/plain")).toStrictEqual(
      Ok(["gedit.desktop", "vim.desktop"]),
    );
  });

  it("finds the lists under the home and /etc/xdg when nothing is set", async () => {
    const system = desktop(
      {},
      {
        ".config/mimeapps.list": list("text/plain=gedit.desktop"),
        "/etc/xdg/mimeapps.list": list("text/plain=vim.desktop"),
      },
    );

    expect(await defaultApps(system, "text/plain")).toStrictEqual(
      Ok(["gedit.desktop", "vim.desktop"]),
    );
  });
});
