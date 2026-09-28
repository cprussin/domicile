import { describe, expect, it } from "bun:test";

import { openCommand } from "./open-command";

describe("openCommand", () => {
  it("opens a path under home with the user's default application", () => {
    // `$HOME` is read where it exists, which is the process the compositor
    // spawns and not this page: a shell served over `domicile://` has no
    // environment to read it from. Which application opens the file is
    // `xdg-open`'s to decide, from the user's MIME associations.
    expect(openCommand("Notes/today.org")).toStrictEqual([
      "sh",
      "-c",
      'case $1 in /*) exec xdg-open "$1" ;; *) exec xdg-open "$HOME/$1" ;; esac',
      "domicile-launcher",
      "Notes/today.org",
    ]);
  });

  it("passes an absolute path through as itself", () => {
    // The same command either way: which branch runs is the running shell's
    // to decide, because it is the one that knows what `$HOME` is. A page that
    // chose here would have to know, and the whole reason the host answers in
    // relative paths is that it does not.
    expect(openCommand("/etc/hosts").at(-1)).toBe("/etc/hosts");
  });

  it("hands the path as an argument rather than writing it into the script", () => {
    // A path is user text and the script is a shell script: a file called
    // `; rm -rf ~` would be a command if it were interpolated. It is `$1`
    // instead, and the quoting around `$1` is what keeps it one word.
    const command = openCommand("Notes/; rm -rf ~");

    expect(command.at(-1)).toBe("Notes/; rm -rf ~");
    expect(command[2]).not.toContain("rm -rf");
  });
});
