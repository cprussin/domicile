import { describe, expect, it } from "bun:test";

import { announcesAChange } from "./subscription";

describe("announcesAChange", () => {
  it("is news for the mixer's own things", () => {
    for (const on of [
      "sink",
      "source",
      "sink-input",
      "source-output",
      "card",
      "server",
    ]) {
      expect(
        announcesAChange(`{"index":1,"event":"change","on":"${on}"}`),
      ).toBe(true);
    }
  });

  // `pactl subscribe` reports each `pactl list` as a client event, so
  // rereading on client events would loop.
  it("is not news for clients, modules or samples", () => {
    for (const on of ["client", "module", "sample-cache"]) {
      expect(announcesAChange(`{"index":1,"event":"new","on":"${on}"}`)).toBe(
        false,
      );
    }
  });

  it("throws on a line that is not an event", () => {
    expect(() => announcesAChange("not json")).toThrow();
    expect(() => announcesAChange(`{"index":1}`)).toThrow();
  });
});
