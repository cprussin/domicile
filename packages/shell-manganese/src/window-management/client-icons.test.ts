import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";

import { clientIcons } from "./client-icons";

const ENVIRONMENT = () => ({
  code: 0,
  stderr: "",
  stdout: "XDG_DATA_HOME=/data\0XDG_DATA_DIRS=/share\0",
});

const entry = (icon: string): string =>
  `[Desktop Entry]\nType=Application\nName=App\nExec=app\nIcon=${icon}\n`;

const SVG = "data:image/svg+xml;base64,c3Zn";

/** The icon `clientIcons` finds for `desktopId` among `tree`'s files. */
const iconFor = async (
  tree: Record<string, string>,
  desktopId: string,
  theme?: string,
): Promise<string | undefined> => {
  const lookup = succeeded(
    await clientIcons(fakeSystem(tree, ENVIRONMENT), () =>
      Promise.resolve(theme),
    ),
  );
  return succeeded(await lookup(desktopId)).match({
    None: () => undefined,
    Some: (url) => url,
  });
};

const succeeded = <T extends NonNullable<unknown>>(
  result: Result<T, SystemError>,
): T =>
  result.match({
    Err: (error) => {
      throw new Error(`test: the read failed: ${error.message}`);
    },
    Ok: (value) => value,
  });

describe("clientIcons", () => {
  it("draws a client with its desktop entry's icon", async () => {
    expect(
      await iconFor(
        {
          "/share/applications/org.gnome.Nautilus.desktop": entry("files"),
          "/share/icons/hicolor/scalable/apps/files.svg": "svg",
        },
        "org.gnome.Nautilus",
      ),
    ).toStrictEqual(SVG);
  });

  // Some clients' app ids differ from their entry's name only in case.
  it("finds an entry whatever its case", async () => {
    expect(
      await iconFor(
        {
          "/share/applications/firefox.desktop": entry("firefox-browser"),
          "/share/icons/hicolor/scalable/apps/firefox-browser.svg": "svg",
        },
        "Firefox",
      ),
    ).toStrictEqual(SVG);
  });

  // Apps often install an icon named after their app id, entry or not.
  it("draws a client with no entry with the icon named after it", async () => {
    expect(
      await iconFor(
        { "/share/icons/hicolor/scalable/apps/kitty.svg": "svg" },
        "kitty",
      ),
    ).toStrictEqual(SVG);
  });

  it("looks in the icon theme first", async () => {
    expect(
      await iconFor(
        {
          "/share/icons/hicolor/scalable/apps/kitty.svg": "svg",
          "/share/icons/Papirus/apps/kitty.svg": "themed",
          "/share/icons/Papirus/index.theme":
            "[Icon Theme]\nDirectories=apps\n[apps]\nSize=16\nType=Scalable\n",
        },
        "kitty",
        "Papirus",
      ),
    ).toStrictEqual("data:image/svg+xml;base64,dGhlbWVk");
  });

  it("draws nothing for a client with no icon", async () => {
    expect(await iconFor({}, "org.example.Unknown")).toStrictEqual(undefined);
  });
});
