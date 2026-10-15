import { describe, expect, it } from "bun:test";

import { Progress, progressSchema } from "./progress";

describe("progressSchema", () => {
  it("reads each state domicile writes", () => {
    expect(
      [
        { state: "starting" },
        { state: "resolving" },
        { packages: ["react", "zod"], state: "installing" },
        { state: "bundling" },
        { ended: "/run/splash/ended", state: "built" },
        { state: "failed", supervisor: 42, why: "no Shell export" },
      ].map((wire) => progressSchema.parse(wire)),
    ).toEqual([
      Progress.Starting(),
      Progress.Resolving(),
      Progress.Installing(["react", "zod"]),
      Progress.Bundling(),
      Progress.Built("/run/splash/ended"),
      Progress.Failed(42, "no Shell export"),
    ]);
  });

  it("refuses a state it does not know", () => {
    expect(progressSchema.safeParse({ state: "linking" }).success).toBe(false);
  });
});
