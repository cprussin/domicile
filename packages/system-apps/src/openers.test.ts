import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Some } from "@cprussin/option-result";

import type { Node } from "./fake-desktop";
import { fakeDesktop } from "./fake-desktop";
import { openers } from "./openers";

const ENVIRONMENT = {
  HOME: "/home/me",
  XDG_CONFIG_HOME: "/config",
  XDG_CURRENT_DESKTOP: "Domicile",
  XDG_DATA_DIRS: "/share",
  XDG_DATA_HOME: "/data",
};

const GLOBS = [
  "50:text/plain:*.txt",
  "50:image/png:*.png",
  "50:text/markdown:*.md",
  "50:application/x-thing:*.thing",
  "",
].join("\n");

const app = (name: string, exec: string, types: string): string =>
  `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exec}\nMimeType=${types}\n`;

/**
 * A desktop holding `tree`, whose `domicile open --which` prints `opener`, or
 * fails when it is `undefined`, as when nothing opens the file.
 */
const desktop = (
  tree: Readonly<Record<string, Node>>,
  opener: string | undefined = undefined,
) =>
  fakeDesktop(
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
    (argv) =>
      argv[0] === "domicile"
        ? {
            code: opener === undefined ? 1 : 0,
            stderr: "",
            stdout: opener === undefined ? "" : `${opener}\n`,
          }
        : {
            code: 0,
            stderr: "",
            stdout: Object.entries(ENVIRONMENT)
              .map(([name, value]) => `${name}=${value}\0`)
              .join(""),
          },
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

  it("offers a type's defaults, then its supertypes', then what declares each", async () => {
    const system = desktop({
      "/config/mimeapps.list":
        "[Default Applications]\ntext/plain=notes.desktop\ntext/markdown=viewer.desktop\n",
      "/share/applications/marked.desktop": app(
        "Marked",
        "marked",
        "text/markdown;",
      ),
      "notes.md": "",
    });

    expect(await ids(system, "notes.md")).toStrictEqual([
      "viewer.desktop",
      "notes.desktop",
      "marked.desktop",
      "editor.desktop",
    ]);
  });

  it("follows `mime/subclasses` up to text/plain", async () => {
    const system = desktop({
      "/config/mimeapps.list":
        "[Default Applications]\ntext/plain=notes.desktop\n",
      "/share/mime/subclasses":
        "application/x-thing application/x-base\napplication/x-base text/x-base\n",
      "a.thing": "",
    });

    expect(await ids(system, "a.thing")).toStrictEqual([
      "notes.desktop",
      "editor.desktop",
    ]);
  });

  it("offers what `domicile open` would run first, NoDisplay or not", async () => {
    const system = desktop(
      {
        "/config/mimeapps.list":
          "[Default Applications]\ntext/plain=notes.desktop\n",
        "/share/applications/hidden.desktop": `${app("Hidden", "hidden %f", "")}NoDisplay=true\n`,
      },
      "hidden.desktop",
    );

    expect(await ids(system, "a b.txt")).toStrictEqual([
      "hidden.desktop",
      "notes.desktop",
      "editor.desktop",
    ]);
  });

  it("moves what `domicile open` would run to the front, once", async () => {
    const system = desktop(
      {
        "/config/mimeapps.list":
          "[Default Applications]\ntext/plain=notes.desktop\n",
      },
      "editor.desktop",
    );

    expect(await ids(system, "a b.txt")).toStrictEqual([
      "editor.desktop",
      "notes.desktop",
    ]);
  });

  it("offers what `domicile open` would run for a file of no known type", async () => {
    expect(
      await ids(desktop({ "notes.org": "" }, "editor.desktop"), "notes.org"),
    ).toStrictEqual(["editor.desktop"]);
  });

  it("asks `domicile open` about the file by its absolute path", async () => {
    const asked: (readonly string[])[] = [];
    const system = fakeDesktop({ "a b.txt": "" }, (argv) => {
      asked.push(argv);
      return {
        code: argv[0] === "env" ? 0 : 1,
        stderr: "",
        stdout: argv[0] === "env" ? "HOME=/home/me\0" : "",
      };
    });
    ok(await openers(system, "a b.txt"));

    expect(asked).toContainEqual([
      "domicile",
      "open",
      "--which",
      "/home/me/a b.txt",
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
