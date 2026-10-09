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

describe("menuIcons", () => {
  it("finds action and status icons in the data directories, before apps", async () => {
    const icons = await menuIcons(
      fakeSystem(
        {
          "/home/icons/hicolor/16x16/actions/exit.png": "action",
          "/home/icons/hicolor/22x22/status/wired.png": "png",
          "/home/icons/hicolor/48x48/apps/exit.png": "app",
        },
        desktop,
      ),
    );

    expect(await icons.andThenAsync((icon) => icon("exit"))).toStrictEqual(
      Ok(Some("data:image/png;base64,YWN0aW9u")),
    );
    expect(await icons.andThenAsync((icon) => icon("wired"))).toStrictEqual(
      Ok(Some("data:image/png;base64,cG5n")),
    );
  });
});
