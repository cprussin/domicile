import { describe, expect, it } from "bun:test";
import { Ok, Some } from "@cprussin/option-result";
import type { Spawned } from "@domicile-desktop/system-apps/fake-system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";

import { menuIcons } from "./menu-icons";

/** A desktop whose data home is `/home`, with nothing else installed. */
const desktop = (): Spawned => ({
  code: 0,
  stderr: "",
  stdout: "XDG_DATA_HOME=/home\0XDG_DATA_DIRS=/nowhere\0",
});

/** A config with `theme` as its icon theme. */
const configured = (theme: string | undefined) => () => Promise.resolve(theme);

/** `name`'s icon from `icons`, as its contents. */
const drawn = async (
  icons: Awaited<ReturnType<typeof menuIcons>>,
  name: string,
) =>
  (await icons.andThenAsync((icon) => icon(name))).map((found) =>
    found.map(({ symbolic, url }) => ({
      symbolic,
      text: atob(url.slice(url.indexOf(",") + 1)),
    })),
  );

describe("menuIcons", () => {
  it("finds menu-sized action and status icons in hicolor, before apps", async () => {
    const icons = await menuIcons(
      fakeSystem(
        {
          "/home/icons/hicolor/16x16/actions/exit.png": "action",
          "/home/icons/hicolor/22x22/status/wired.png": "png",
          "/home/icons/hicolor/48x48/apps/exit.png": "app",
        },
        desktop,
      ),
      configured(undefined),
    );

    expect(await drawn(icons, "exit")).toStrictEqual(
      Ok(Some({ symbolic: false, text: "action" })),
    );
    expect(await drawn(icons, "wired")).toStrictEqual(
      Ok(Some({ symbolic: false, text: "png" })),
    );
  });

  it("finds icons in the config's icon theme, symbolic ones too", async () => {
    const icons = await menuIcons(
      fakeSystem(
        {
          "/home/icons/Adwaita/index.theme":
            "[Icon Theme]\nDirectories=symbolic/actions\n[symbolic/actions]\nSize=16\nContext=Actions\nType=Scalable\n",
          "/home/icons/Adwaita/symbolic/actions/exit-symbolic.svg": "adwaita",
        },
        desktop,
      ),
      configured("Adwaita"),
    );

    expect(await drawn(icons, "exit")).toStrictEqual(
      Ok(Some({ symbolic: true, text: "adwaita" })),
    );
  });
});
