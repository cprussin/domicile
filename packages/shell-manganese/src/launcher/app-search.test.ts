import { describe, expect, it } from "bun:test";
import { None, Some } from "@cprussin/option-result";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import type { Spawned } from "@domicile-desktop/system-apps/fake-system";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";

import { appSearch } from "./app-search";

const entry = (name: string, more = ""): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${name.toLowerCase()} %F\n${more}`;

/** A desktop whose data home is `/home`, with nothing else installed. */
const desktop = (argv: readonly string[]): Spawned => {
  expect(argv).toStrictEqual(["env", "-0"]);
  return {
    code: 0,
    stderr: "",
    stdout: "XDG_DATA_HOME=/home\0XDG_DATA_DIRS=/nowhere\0",
  };
};

/** Bookmark icons a test says are already found. */
const knownIcons = (icons: Readonly<Record<string, string>>) => {
  const asked: string[][] = [];
  return {
    asked,
    icons: {
      icon: (url: string) => {
        const icon = icons[url];
        return icon === undefined ? None<string>() : Some(icon);
      },
      lookFor: (urls: readonly string[]) => {
        asked.push([...urls]);
        return Promise.resolve();
      },
    },
  };
};

describe("appSearch", () => {
  it("offers what is installed and not omitted, with its pictures", async () => {
    const system = fakeSystem(
      {
        "/home/applications/browser.desktop": entry("Browser"),
        "/home/applications/editor.desktop": entry(
          "Editor",
          "Icon=editor\nX-Domicile-Preview=/home/editor-preview.svg\n",
        ),
        "/home/editor-preview.svg": "svg",
        "/home/icons/hicolor/48x48/apps/editor.png": "png",
      },
      desktop,
    );
    const apps = appSearch(
      system,
      { bookmarks: [], omit: ["browser.desktop"] },
      knownIcons({}).icons,
    );

    expect(await apps.opening()).toStrictEqual({
      apps: [
        {
          command: ["editor"],
          comment: "",
          icon: "data:image/png;base64,cG5n",
          id: "editor.desktop",
          name: "Editor",
          preview: "data:image/svg+xml;base64,c3Zn",
        },
      ],
      bookmarks: [],
    });
  });

  it("matches the query against applications and bookmarks", async () => {
    const system = fakeSystem(
      {
        "/home/applications/calculator.desktop": entry("Calculator"),
        "/home/applications/editor.desktop": entry("Editor"),
      },
      desktop,
    );
    const apps = appSearch(
      system,
      {
        bookmarks: [
          { name: "Calendar", url: "https://calendar.example" },
          { name: "Mail", url: "https://mail.example" },
        ],
        omit: [],
      },
      knownIcons({ "https://calendar.example": "data:calendar" }).icons,
    );

    const found = await apps.search("cal");

    expect(found.apps.map(({ name }) => name)).toStrictEqual(["Calculator"]);
    expect(found.bookmarks).toStrictEqual([
      {
        icon: "data:calendar",
        name: "Calendar",
        url: "https://calendar.example",
      },
    ]);
  });

  it("looks for every bookmark's icon on each search", async () => {
    const lookup = knownIcons({});
    const apps = appSearch(
      fakeSystem({}, desktop),
      {
        bookmarks: [{ name: "Mail", url: "https://mail.example" }],
        omit: [],
      },
      lookup.icons,
    );

    await apps.search("x");

    expect(lookup.asked).toStrictEqual([["https://mail.example"]]);
  });

  it("reads what is installed again on opening, and only then", async () => {
    const files: Record<string, string> = {
      "/home/applications/editor.desktop": entry("Editor"),
    };
    const system = fakeSystem(files, desktop);
    const apps = appSearch(
      system,
      { bookmarks: [], omit: [] },
      knownIcons({}).icons,
    );
    await apps.opening();

    files["/home/applications/paint.desktop"] = entry("Paint");
    const typed = await apps.search("");
    const reopened = await apps.opening();

    expect(typed.apps.map(({ name }) => name)).toStrictEqual(["Editor"]);
    expect(reopened.apps.map(({ name }) => name)).toStrictEqual([
      "Editor",
      "Paint",
    ]);
  });

  it("fails when the desktop refuses to read", async () => {
    const apps = appSearch(
      fakeSystem(
        { "/home/applications": { fails: SystemErrorKind.Locked } },
        desktop,
      ),
      { bookmarks: [], omit: [] },
      knownIcons({}).icons,
    );

    await expect(apps.opening()).rejects.toThrow(
      "could not read the installed applications: /home/applications",
    );
  });
});
