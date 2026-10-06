import { describe, expect, it } from "bun:test";
import { None, Some } from "@cprussin/option-result";

import { commandOf } from "./exec";

describe("commandOf", () => {
  it("drops field codes and keeps an escaped percent", () => {
    expect(commandOf("app %F --ratio=50%% %i %c %k")).toStrictEqual(
      Some(["app", "--ratio=50%"]),
    );
  });

  it("reads a quoted argument as one word", () => {
    expect(
      commandOf(String.raw`"/opt/My App/run" --title "say \"hi\" for \$5"`),
    ).toStrictEqual(Some(["/opt/My App/run", "--title", 'say "hi" for $5']));
  });

  it("reads a string escape before the quoting", () => {
    // `\s` escapes a space and `\\` a backslash; inside quotes the result
    // then escapes the next character.
    expect(commandOf(String.raw`a\sb "c\\\\d"`)).toStrictEqual(
      Some(["a", "b", String.raw`c\d`]),
    );
  });

  it("is nothing for a command that cannot be read", () => {
    expect(commandOf('app "unterminated')).toStrictEqual(None());
    expect(commandOf("%U")).toStrictEqual(None());
  });
});
