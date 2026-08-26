import { describe, expect, it } from "bun:test";

import { exitStatus, STOP_SIGNALS } from "./stop-signals";

describe("STOP_SIGNALS", () => {
  it("includes the one a session manager actually sends", () => {
    // SIGHUP is how a desktop session ends — a closed terminal, a stopped
    // user unit, a logout — and Node terminates on it by default. Left out,
    // the launcher dies without stopping anything it started.
    expect(STOP_SIGNALS).toContain("SIGHUP");
  });
});

describe("exitStatus", () => {
  it("is the chrome's own status when it chose one", () => {
    expect(exitStatus(3, null)).toBe(3);
  });

  it("refuses a chrome that ended with neither", () => {
    // Node gives one or the other for every process it reaped. Reporting 0
    // would be calling an unaccountable chrome a success, and a shell's status
    // is what a session manager's restart policy branches on.
    expect(() => exitStatus(null, null)).toThrow(
      "neither a status nor a signal",
    );
  });

  it("is 128 plus the signal for a chrome that was stopped", () => {
    expect(exitStatus(null, "SIGTERM")).toBe(143);
    expect(exitStatus(null, "SIGINT")).toBe(130);
    expect(exitStatus(null, "SIGHUP")).toBe(129);
  });

  it("reports the signal a chrome actually crashed on", () => {
    // The ones an Electron dies of, and the reason the numbers are looked up
    // rather than listed: a table of the three stop signals answered 137 for
    // all of these, which every init system reads as the OOM killer.
    expect(exitStatus(null, "SIGSEGV")).toBe(139);
    expect(exitStatus(null, "SIGABRT")).toBe(134);
    expect(exitStatus(null, "SIGBUS")).toBe(135);
    expect(exitStatus(null, "SIGKILL")).toBe(137);
  });
});
