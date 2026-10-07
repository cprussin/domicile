import { describe, expect, it } from "bun:test";

import { describeApps } from "./describe-apps";
import { fakeSystem } from "./fake-system";

const ENVIRONMENT = () => ({
  code: 0,
  stderr: "",
  stdout: "XDG_DATA_HOME=/data\0XDG_DATA_DIRS=/share\0",
});

const entry = (name: string, icon?: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=app\n${
    icon === undefined ? "" : `Icon=${icon}\n`
  }`;

describe("describeApps", () => {
  it("names each id by its desktop entry, with its icon", async () => {
    const system = fakeSystem(
      {
        "/share/applications/org.gnome.Evince.desktop": entry(
          "Document Viewer",
          "evince",
        ),
        "/share/icons/hicolor/scalable/apps/evince.svg": "svg",
      },
      ENVIRONMENT,
    );

    const described = await describeApps(system, ["org.gnome.Evince"]);

    expect(described.unwrapOr([])).toStrictEqual([
      {
        icon: "data:image/svg+xml;base64,c3Zn",
        id: "org.gnome.Evince",
        name: "Document Viewer",
      },
    ]);
  });

  it("names an id with no entry, or an entry with no icon found, as it can", async () => {
    const system = fakeSystem(
      {
        "/share/applications/editor.desktop": entry("Editor", "missing"),
        "/share/applications/notes.desktop": entry("Notes"),
      },
      ENVIRONMENT,
    );

    const described = await describeApps(system, [
      "editor",
      "notes",
      "org.example.Unknown",
    ]);

    expect(described.unwrapOr([])).toStrictEqual([
      { icon: undefined, id: "editor", name: "Editor" },
      { icon: undefined, id: "notes", name: "Notes" },
      {
        icon: undefined,
        id: "org.example.Unknown",
        name: "org.example.Unknown",
      },
    ]);
  });
});
