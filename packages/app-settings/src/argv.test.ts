import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";

import { joinArgv, splitArgv } from "./argv";

describe(joinArgv, () => {
  it("writes a command as it is typed, quoting what needs it", () => {
    expect(joinArgv(["sh", "-c", "echo 'hi' there"])).toBe(
      `sh -c "echo 'hi' there"`,
    );
    expect(joinArgv(["emacs", "--daemon"])).toBe("emacs --daemon");
    expect(joinArgv(["printf", ""])).toBe(`printf ""`);
  });
});

describe(splitArgv, () => {
  it("reads back what joinArgv writes", () => {
    for (const argv of [
      ["sh", "-c", "echo 'hi' there"],
      ["emacs", "--daemon"],
      ["printf", ""],
      ["say", 'a "quote"'],
    ]) {
      expect(splitArgv(joinArgv(argv))).toEqual(Ok(argv));
    }
  });

  it("takes single quotes and backslashes as a shell does", () => {
    expect(splitArgv(`notify-send 'Hello there' a\\ b`)).toEqual(
      Ok(["notify-send", "Hello there", "a b"]),
    );
  });

  it("refuses an unfinished quote and an empty command", () => {
    expect(splitArgv(`sh -c "echo`)).toEqual(Err("A quote is not closed"));
    expect(splitArgv("   ")).toEqual(Err("A command needs a program"));
  });
});
