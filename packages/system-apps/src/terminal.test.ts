import { describe, expect, it } from "bun:test";

import { TERMINAL_VARIABLE, terminalOf } from "./terminal";

const named = (value: string) => new Map([[TERMINAL_VARIABLE, value]]);

describe("terminalOf", () => {
  it("reads the argv the compositor wrote", () => {
    expect(terminalOf(named('["kitty","--title","a b"]'))).toEqual([
      "kitty",
      "--title",
      "a b",
    ]);
  });

  it("is no terminal when the config names none", () => {
    expect(terminalOf(new Map())).toBeUndefined();
    expect(terminalOf(named(""))).toBeUndefined();
  });

  it("is no terminal for a value that is no argv", () => {
    expect(terminalOf(named("kitty"))).toBeUndefined();
    expect(terminalOf(named("[]"))).toBeUndefined();
    expect(terminalOf(named("[1]"))).toBeUndefined();
  });
});
