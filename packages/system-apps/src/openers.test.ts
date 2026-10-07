import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Some } from "@cprussin/option-result";

import type { Node } from "./fake-system";
import { fakeSystem } from "./fake-system";
import { openers } from "./openers";

const ENVIRONMENT = {
  HOME: "/home/me",
  XDG_CONFIG_HOME: "/config",
  XDG_CURRENT_DESKTOP: "Domicile",
  XDG_DATA_DIRS: "/share",
  XDG_DATA_HOME: "/data",
};

const GLOBS = "50:text/plain:*.txt\n50:image/png:*.png\n";

const app = (name: string, exec: string, types: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\nMimeType=${types}\n`;

const desktop = (tree: Readonly<Record<string, Node>>) =>
  fakeSystem(
    {
      "/share/applications/editor.desktop": app(
        "Editor",
        "editor %F",
        "text/plain;",
      ),
      "/share/applications/notes.desktop": app("Notes", "notes", "text/plain;"),
      "/share/applications/viewer.desktop": app(
        "Viewer",
        "viewer %u",
        "image/png;",
      ),
      "/share/mime/globs2": GLOBS,
      "a b.txt": "",
      ...tree,
    },
    () => ({
      code: 0,
      stderr: "",
      stdout: Object.entries(ENVIRONMENT)
        .map(([name, value]) => `${name}=${value}\0`)
        .join(""),
    }),
  );

const ok = <T extends NonNullable<unknown>, E extends NonNullable<unknown>>(
  result: Result<T, E>,
): T =>
  result.unwrapOrElse((error) => {
    throw new Error(`expected a value: ${JSON.stringify(error)}`);
  });

const ids = async (system: ReturnType<typeof desktop>, path: string) =>
  ok(await openers(system, path)).apps.map(({ id }) => id);

describe("openers", () => {
  it("offers the type's defaults first, the desktop's own first, then the rest by name", async () => {
    const system = desktop({
      "/config/domicile-mimeapps.list":
        "[Default Applications]\ntext/plain=notes.desktop;missing.desktop\n",
      "/config/mimeapps.list":
        "[Default Applications]\ntext/plain=viewer.desktop\n",
      "/share/applications/aa.desktop": app("Aa", "aa", "text/plain;"),
    });

    expect(await ids(system, "a b.txt")).toStrictEqual([
      "notes.desktop",
      "viewer.desktop",
      "aa.desktop",
      "editor.desktop",
    ]);
  });

  it("offers nothing for a file of no known type", async () => {
    expect(await ids(desktop({ "notes.org": "" }), "notes.org")).toStrictEqual(
      [],
    );
  });

  it("opens the file by its absolute path with an app's own command", async () => {
    const found = ok(await openers(desktop({}), "a b.txt"));

    expect(found.contentType).toStrictEqual(Some("text/plain"));
    expect(found.apps.map((entry) => found.command(entry))).toStrictEqual([
      ["editor", "/home/me/a b.txt"],
      ["notes", "/home/me/a b.txt"],
    ]);
  });

  it("keeps an absolute path as it is", async () => {
    const found = ok(
      await openers(desktop({ "/tmp/x.png": "" }), "/tmp/x.png"),
    );

    expect(found.apps.map((entry) => found.command(entry))).toStrictEqual([
      ["viewer", "/tmp/x.png"],
    ]);
  });
});
