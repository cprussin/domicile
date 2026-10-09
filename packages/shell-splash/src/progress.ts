// What `domicile` has told the splash about the build, read from the
// `progress.json` it writes beside the splash (`domicile_launch::splash`).
// Both ship in one install, so the file carries no version.

import { z } from "zod";

/** Where the build is. */
export enum Stage {
  Starting,
  Resolving,
  Installing,
  Bundling,
  Built,
  Failed,
}

export const Progress = {
  Built: () => ({ stage: Stage.Built as const }),
  Bundling: () => ({ stage: Stage.Bundling as const }),
  /** `supervisor` is the pid that logs out when stopped. */
  Failed: (supervisor: number, why: string) => ({
    stage: Stage.Failed as const,
    supervisor,
    why,
  }),
  Installing: (packages: readonly string[]) => ({
    packages,
    stage: Stage.Installing as const,
  }),
  Resolving: () => ({ stage: Stage.Resolving as const }),
  Starting: () => ({ stage: Stage.Starting as const }),
};

export type Progress = ReturnType<(typeof Progress)[keyof typeof Progress]>;

const wireSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("starting") }),
  z.object({ state: z.literal("resolving") }),
  z.object({ packages: z.array(z.string()), state: z.literal("installing") }),
  z.object({ state: z.literal("bundling") }),
  z.object({ state: z.literal("built") }),
  z.object({
    state: z.literal("failed"),
    supervisor: z.number().int(),
    why: z.string(),
  }),
]);

/** Reads `progress.json` into a {@link Progress}. */
export const progressSchema = wireSchema.transform((wire): Progress => {
  switch (wire.state) {
    case "starting":
      return Progress.Starting();
    case "resolving":
      return Progress.Resolving();
    case "installing":
      return Progress.Installing(wire.packages);
    case "bundling":
      return Progress.Bundling();
    case "built":
      return Progress.Built();
    case "failed":
      return Progress.Failed(wire.supervisor, wire.why);
  }
});
