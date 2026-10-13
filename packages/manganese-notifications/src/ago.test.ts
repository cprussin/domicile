import { describe, expect, it } from "bun:test";

import { ago } from "./ago";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("ago", () => {
  const now = new Date(2026, 9, 1, 12, 0, 0).getTime();

  it("is now for the last minute", () => {
    expect(ago(now - 20 * SECOND, now)).toBe("now");
    // A sender's clock a little ahead of this page's is still now.
    expect(ago(now + 5 * SECOND, now)).toBe("now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(ago(now - 5 * MINUTE, now)).toBe("5m");
    expect(ago(now - 3 * HOUR, now)).toBe("3h");
    expect(ago(now - 2 * DAY, now)).toBe("2d");
  });

  it("dates one older than a week", () => {
    expect(ago(new Date(2026, 8, 3, 9, 0).getTime(), now)).toBe("Sep 3");
  });
});
