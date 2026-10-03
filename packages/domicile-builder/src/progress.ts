// What the builder says as it goes: one JSON line per step on stdout, which
// `domicile` draws as a progress bar.

/** Which step a line is. */
export enum StepKind {
  Resolving,
  Installing,
  Bundling,
  Built,
  Failed,
}

export const Step = {
  /** The entry built: `module` in `root`, which is what the engine serves. */
  Built: (root: string, module: string, cached: boolean) => ({
    cached,
    kind: StepKind.Built as const,
    module,
    root,
  }),
  /** Bundling the entry against Domicile's packages. */
  Bundling: () => ({ kind: StepKind.Bundling as const }),
  /** The build failed, and why. */
  Failed: (why: string) => ({ kind: StepKind.Failed as const, why }),
  /** Installing the packages the entry imports that the project lacks. */
  Installing: (packages: readonly string[]) => ({
    kind: StepKind.Installing as const,
    packages,
  }),
  /** Reading what the entry imports. */
  Resolving: () => ({ kind: StepKind.Resolving as const }),
};

export type Step = ReturnType<(typeof Step)[keyof typeof Step]>;

/**
 * `step` as the line `domicile` reads: `{"step":"built","root":...}`. The
 * wire's words are this function's alone.
 */
export const line = (step: Step): string => {
  switch (step.kind) {
    case StepKind.Resolving: {
      return JSON.stringify({ step: "resolving" });
    }
    case StepKind.Installing: {
      return JSON.stringify({ packages: step.packages, step: "installing" });
    }
    case StepKind.Bundling: {
      return JSON.stringify({ step: "bundling" });
    }
    case StepKind.Built: {
      return JSON.stringify({
        cached: step.cached,
        module: step.module,
        root: step.root,
        step: "built",
      });
    }
    case StepKind.Failed: {
      return JSON.stringify({ step: "failed", why: step.why });
    }
  }
};
