import { describe, expect, it } from "bun:test";
import { None, Some } from "@cprussin/option-result";

import { parseDesktopEntry } from "./desktop-entry";

/** A file under `recorded/`, copied from a real install. */
const recorded = (name: string): Promise<string> =>
  Bun.file(new URL(`recorded/${name}`, import.meta.url)).text();

const entry = (name: string, exec: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\n`;

describe("parseDesktopEntry", () => {
  it("reads an application's name, comment, command, icon and preview", () => {
    expect(
      parseDesktopEntry(
        "firefox.desktop",
        [
          "# a comment",
          "[Desktop Entry]",
          "Type=Application",
          "Name=Firefox",
          "Name[de]=Feuerfuchs",
          "GenericName=Web Browser",
          "Keywords=internet;www;",
          "Comment = Browse the web",
          "Exec=firefox %u",
          "Icon=firefox",
          "X-Domicile-Preview=/usr/share/firefox/preview.svg",
          "[Desktop Action new-window]",
          "Name=New Window",
          "Exec=firefox --new-window",
        ].join("\n"),
      ),
    ).toStrictEqual(
      Some({
        command: ["firefox"],
        comment: "Browse the web",
        icon: "firefox",
        id: "firefox.desktop",
        name: "Firefox",
        preview: "/usr/share/firefox/preview.svg",
        words: "firefox\nweb browser\ninternet;www;",
      }),
    );
  });

  it("reads a recorded entry with actions and translations", async () => {
    expect(
      parseDesktopEntry(
        "libreoffice-startcenter.desktop",
        await recorded("libreoffice-startcenter.desktop"),
      ),
    ).toStrictEqual(
      Some({
        command: ["libreoffice"],
        comment:
          "Launch applications to create text documents, spreadsheets, presentations, drawings, formulas, and databases, or open recently used documents.",
        icon: "libreoffice-startcenter",
        id: "libreoffice-startcenter.desktop",
        name: "LibreOffice",
        preview: undefined,
        words: "libreoffice\noffice\n",
      }),
    );
  });

  it("reads a recorded entry with no comment as an empty one", async () => {
    expect(
      parseDesktopEntry("kitty.desktop", await recorded("kitty.desktop")).map(
        ({ command, comment }) => ({ command, comment }),
      ),
    ).toStrictEqual(
      Some({
        command: ["kitty"],
        comment: "Fast, feature-rich, GPU based terminal",
      }),
    );
  });

  it("is nothing for a recorded entry a launcher should not offer", async () => {
    // Vim runs in a terminal, which the launcher does not know; Zenity is
    // `NoDisplay`.
    expect(
      parseDesktopEntry("vim.desktop", await recorded("vim.desktop")),
    ).toStrictEqual(None());
    expect(
      parseDesktopEntry(
        "org.gnome.Zenity.desktop",
        await recorded("org.gnome.Zenity.desktop"),
      ),
    ).toStrictEqual(None());
  });

  it.each([
    ["a link", "[Desktop Entry]\nType=Link\nName=Docs\nURL=https://a\n"],
    ["hidden", `${entry("A", "a")}Hidden=true\n`],
    ["nameless", "[Desktop Entry]\nType=Application\nExec=a\n"],
    ["nothing to run", "[Desktop Entry]\nType=Application\nName=A\n"],
    ["a command that cannot be read", entry("A", '"a')],
    ["outside the group", "Type=Application\nName=A\nExec=a\n"],
  ])("is nothing for %s", (_, text) => {
    expect(parseDesktopEntry("a.desktop", text)).toStrictEqual(None());
  });

  it("unescapes values", () => {
    expect(
      parseDesktopEntry(
        "a.desktop",
        `${entry(String.raw`A\sB`, "a")}Comment=one\\ntwo\n`,
      ).map(({ comment, name }) => ({ comment, name })),
    ).toStrictEqual(Some({ comment: "one\ntwo", name: "A B" }));
  });
});
