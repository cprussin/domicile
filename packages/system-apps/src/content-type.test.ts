import { describe, expect, it } from "bun:test";
import { None, Ok, Some } from "@cprussin/option-result";

import { contentTypeOf } from "./content-type";
import type { Node } from "./fake-system";
import { fakeSystem } from "./fake-system";

const DIRS = ["/data", "/share"];

const desktop = (tree: Readonly<Record<string, Node>>) =>
  fakeSystem({ "notes/todo.org": "", ...tree });

describe("contentTypeOf", () => {
  it("is a directory's type for a directory", async () => {
    expect(
      await contentTypeOf(desktop({ "music/a.flac": "" }), DIRS, "music"),
    ).toStrictEqual(Ok(Some("inode/directory")));
  });

  it("takes the heaviest glob", async () => {
    const system = desktop({
      "/share/mime/globs2": [
        "# generated",
        "80:text/x-heavy:*.org",
        "50:text/x-longer:*todo.org",
        "",
      ].join("\n"),
    });

    expect(await contentTypeOf(system, DIRS, "notes/todo.org")).toStrictEqual(
      Ok(Some("text/x-heavy")),
    );
  });

  it("takes the longest of equal weights, then the earliest directory", async () => {
    const system = desktop({
      "/data/mime/globs2": "50:text/x-org:*.org\n",
      "/share/mime/globs2": "50:text/x-later:*.org\n50:text/x-todo:*todo.org\n",
      "notes/done.org": "",
    });

    expect(await contentTypeOf(system, DIRS, "notes/todo.org")).toStrictEqual(
      Ok(Some("text/x-todo")),
    );
    expect(await contentTypeOf(system, DIRS, "notes/done.org")).toStrictEqual(
      Ok(Some("text/x-org")),
    );
  });

  it("ignores case unless the glob says `cs`", async () => {
    const system = desktop({
      "/share/mime/globs2": "50:text/x-c++src:*.C:cs\n50:text/plain:*.txt\n",
      "notes/main.c": "",
      "notes/README.TXT": "",
    });

    expect(await contentTypeOf(system, DIRS, "notes/main.c")).toStrictEqual(
      Ok(None()),
    );
    expect(await contentTypeOf(system, DIRS, "notes/README.TXT")).toStrictEqual(
      Ok(Some("text/plain")),
    );
  });

  it("is nothing for a name no glob matches", async () => {
    expect(
      await contentTypeOf(desktop({}), DIRS, "notes/todo.org"),
    ).toStrictEqual(Ok(None()));
  });
});
