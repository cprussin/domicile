import { describe, expect, it } from "bun:test";

import { editorCommand } from "./editor-command";

describe("editorCommand", () => {
  it("runs the editor on a path under home", () => {
    // `$EDITOR` and `$HOME` are both read where they exist, which is the
    // process the compositor spawns and not this page: a shell served over
    // `domicile://` has no environment to read either from. `exec` is what
    // keeps the promise that the editor is spawned directly — the `sh` is
    // replaced by it rather than sitting above it as a parent.
    expect(editorCommand("Notes/today.org")).toStrictEqual([
      "sh",
      "-c",
      'case $1 in /*) exec "$EDITOR" "$1" ;; *) exec "$EDITOR" "$HOME/$1" ;; esac',
      "domicile-launcher",
      "Notes/today.org",
    ]);
  });

  it("passes an absolute path through as itself", () => {
    // The same command either way: which branch runs is the running shell's
    // to decide, because it is the one that knows what `$HOME` is. A page that
    // chose here would have to know, and the whole reason the host answers in
    // relative paths is that it does not.
    expect(editorCommand("/etc/hosts").at(-1)).toBe("/etc/hosts");
  });

  it("hands the path as an argument rather than writing it into the script", () => {
    // A path is user text and the script is a shell script: a file called
    // `; rm -rf ~` would be a command if it were interpolated. It is `$1`
    // instead, and the quoting around `$1` is what keeps it one word.
    const command = editorCommand("Notes/; rm -rf ~");

    expect(command.at(-1)).toBe("Notes/; rm -rf ~");
    expect(command[2]).not.toContain("rm -rf");
  });
});
