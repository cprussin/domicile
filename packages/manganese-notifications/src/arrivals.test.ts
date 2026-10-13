import { describe, expect, it } from "bun:test";

import { arrivals } from "./arrivals";
import { notification } from "./fixture";

describe("arrivals", () => {
  it("is nothing the first time the desk says, which is the history", () => {
    // A page that has just connected, or reloaded, is told every notification
    // nobody has cleared. None of them just happened.
    expect(arrivals(undefined, [notification({ id: 1 })])).toEqual([]);
  });

  it("is each one the page had not been told", () => {
    const one = notification({ id: 1 });
    const two = notification({ id: 2 });

    expect(arrivals([one], [one, two])).toEqual([two]);
  });

  it("is one its sender replaced, which is news again", () => {
    const downloading = notification({
      id: 1,
      summary: "Downloading",
      time: 1,
    });
    const downloaded = notification({ id: 1, summary: "Downloaded", time: 2 });

    expect(arrivals([downloading], [downloaded])).toEqual([downloaded]);
  });

  it("is nothing for one that went", () => {
    expect(arrivals([notification({ id: 1 })], [])).toEqual([]);
  });
});
