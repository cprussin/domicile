import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { fakeDesktop } from "@domicile-desktop/system-apps/fake-desktop";

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
    await clientIcons(fakeDesktop(tree, ENVIRONMENT), () =>
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

  // An entry named for its launcher names its client with `StartupWMClass`.
  it("finds an entry by its window class", async () => {
    expect(
      await iconFor(
        {
          "/share/applications/launch-slack.desktop": `${entry("chat")}StartupWMClass=Slack\n`,
          "/share/icons/hicolor/scalable/apps/chat.svg": "svg",
        },
        "slack",
      ),
    ).toStrictEqual(SVG);
  });

  it("prefers the entry a client's app id names to one claiming it by class", async () => {
    expect(
      await iconFor(
        {
          "/share/applications/agenda.desktop": `${entry("agenda")}StartupWMClass=emacs\n`,
          "/share/applications/emacs.desktop": entry("emacs"),
          "/share/icons/hicolor/scalable/apps/agenda.svg": "agenda",
          "/share/icons/hicolor/scalable/apps/emacs.svg": "svg",
        },
        "emacs",
      ),
    ).toStrictEqual(SVG);
  });

  // An app can install its own entry naming an icon no data directory holds.
  it("passes over an entry whose icon is not found", async () => {
    expect(
      await iconFor(
        {
          "/data/applications/chat.desktop": entry("missing"),
          "/share/applications/launch-chat.desktop": `${entry("chat-icon")}StartupWMClass=chat\n`,
          "/share/icons/hicolor/scalable/apps/chat-icon.svg": "svg",
        },
        "chat",
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
