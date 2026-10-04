import { describe, expect, it } from "bun:test";

import { openCommand } from "./open-command";

describe("openCommand", () => {
  it("opens a path under home with the user's default application", () => {
    // The spawned shell expands `$HOME`, since the page has no environment.
    // `xdg-open` picks the application.
    expect(openCommand("Notes/today.org")).toStrictEqual([
      "sh",
      "-c",
      'case $1 in /*) exec xdg-open "$1" ;; *) exec xdg-open "$HOME/$1" ;; esac',
      "domicile-launcher",
      "Notes/today.org",
    ]);
  });

  it("passes an absolute path through as itself", () => {
    // Same command for relative and absolute paths; the script picks the
    // branch, because only it knows `$HOME`.
    expect(openCommand("/etc/hosts").at(-1)).toBe("/etc/hosts");
  });

  it("hands the path as an argument rather than writing it into the script", () => {
    // The path is passed as quoted `$1`, so a name like `; rm -rf ~` can't
    // inject a command.
    const command = openCommand("Notes/; rm -rf ~");

    expect(command.at(-1)).toBe("Notes/; rm -rf ~");
    expect(command[2]).not.toContain("rm -rf");
  });
});
