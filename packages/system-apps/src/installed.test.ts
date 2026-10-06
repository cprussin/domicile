import { describe, expect, it } from "bun:test";
import { Err } from "@cprussin/option-result";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { DesktopEntry } from "./desktop-entry";
import { fakeSystem } from "./fake-system";
import { installedApps } from "./installed";

const entry = (name: string, exec: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\n`;

const idsAndNames = (
  entries: readonly DesktopEntry[],
): [id: string, name: string][] =>
  entries.map(({ id, name }): [string, string] => [id, name]).toSorted();

describe("installedApps", () => {
  it("names an entry by its path under applications, with dashes", async () => {
    const system = fakeSystem({
      "/share/applications/kde/konsole.desktop": entry("Konsole", "konsole"),
    });

    const found = await installedApps(system, ["/share"]);

    expect(found.map(idsAndNames).unwrapOr([])).toStrictEqual([
      ["kde-konsole.desktop", "Konsole"],
    ]);
  });

  it("lets an earlier directory override a later one, even to hide it", async () => {
    const system = fakeSystem({
      "/system/applications/clock.desktop": entry("Clock", "clock"),
      "/system/applications/editor.desktop": entry("Editor", "editor"),
      "/system/applications/notes.txt": "not an entry",
      "/user/applications/clock.desktop": `${entry("Clock", "clock")}NoDisplay=true\n`,
      "/user/applications/editor.desktop": entry("My Editor", "my-editor"),
    });

    const found = await installedApps(system, [
      "/user",
      "/does/not/exist",
      "/system",
    ]);

    expect(found.map(idsAndNames).unwrapOr([])).toStrictEqual([
      ["editor.desktop", "My Editor"],
    ]);
  });

  it("follows symlinks to entries and to directories of them", async () => {
    // As in a Nix profile, where both point into the store.
    const system = fakeSystem({
      "/profile/applications/editor.desktop": {
        linksTo: "/store/editor/editor.desktop",
      },
      "/profile/applications/kde": { linksTo: "/store/kde" },
      "/store/editor/editor.desktop": entry("Editor", "editor"),
      "/store/kde/konsole.desktop": entry("Konsole", "konsole"),
    });

    const found = await installedApps(system, ["/profile"]);

    expect(found.map(idsAndNames).unwrapOr([])).toStrictEqual([
      ["editor.desktop", "Editor"],
      ["kde-konsole.desktop", "Konsole"],
    ]);
  });

  it("skips an entry it may not read, as the spec says", async () => {
    const system = fakeSystem({
      "/share/applications/editor.desktop": entry("Editor", "editor"),
      "/share/applications/secret.desktop": {
        fails: SystemErrorKind.PermissionDenied,
      },
    });

    const found = await installedApps(system, ["/share"]);

    expect(found.map(idsAndNames).unwrapOr([])).toStrictEqual([
      ["editor.desktop", "Editor"],
    ]);
  });

  it("fails when the desktop refuses to read", async () => {
    const system = fakeSystem({
      "/share/applications/editor.desktop": { fails: SystemErrorKind.Locked },
    });

    expect(await installedApps(system, ["/share"])).toStrictEqual(
      Err({
        kind: SystemErrorKind.Locked,
        message: "/share/applications/editor.desktop",
      }),
    );
  });
});
