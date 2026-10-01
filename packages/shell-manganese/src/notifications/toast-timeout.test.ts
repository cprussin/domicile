import { describe, expect, it } from "bun:test";

import { notification } from "./fixture";
import { toastTimeout } from "./toast-timeout";

describe("toastTimeout", () => {
  it("leaves it to the desk where the sender did", () => {
    // A low one is the least worth reading and goes soonest.
    expect(toastTimeout(notification({ urgency: "normal" }))).toBe(6000);
    expect(toastTimeout(notification({ urgency: "low" }))).toBe(4000);
  });

  it("keeps a critical one up until it is dismissed, whatever it asked", () => {
    expect(
      toastTimeout(notification({ timeoutMs: 3000, urgency: "critical" })),
    ).toBe(0);
  });

  it("keeps one up that asked to stay", () => {
    expect(toastTimeout(notification({ timeoutMs: 0 }))).toBe(0);
  });

  it("takes how long one asked for, within reason", () => {
    // Too short to read, or so long it is a window nobody opened.
    expect(toastTimeout(notification({ timeoutMs: 10_000 }))).toBe(10_000);
    expect(toastTimeout(notification({ timeoutMs: 500 }))).toBe(2000);
    expect(toastTimeout(notification({ timeoutMs: 600_000 }))).toBe(30_000);
  });
});
