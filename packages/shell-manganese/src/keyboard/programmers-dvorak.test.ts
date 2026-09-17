import { describe, expect, it } from "bun:test";

import { codeFor } from "./programmers-dvorak";

describe("codeFor", () => {
  it("puts the letters where Programmer's Dvorak puts them", () => {
    // The row `a o e u i d h t n s -`, so the letter `h` is on the key a US
    // layout calls J.
    expect(codeFor("h")).toBe("KeyJ");
    expect(codeFor("j")).toBe("KeyC");
    expect(codeFor("k")).toBe("KeyV");
    expect(codeFor("l")).toBe("KeyP");
  });

  it("puts the workspace keys on the number row", () => {
    // `$ & [ { } ( = * ) + ] !`, which is where the config's `parenleft` and
    // the rest of the workspace chords live.
    expect(codeFor("parenleft")).toBe("Digit5");
    expect(codeFor("parenright")).toBe("Digit8");
    expect(codeFor("exclam")).toBe("Minus");
  });

  it("leaves the keys every layout agrees on alone", () => {
    expect(codeFor("Return")).toBe("Enter");
    expect(codeFor("Left")).toBe("ArrowLeft");
  });

  it("throws for a keysym it cannot place", () => {
    expect(() => codeFor("Hyper_R")).toThrow();
  });
});
