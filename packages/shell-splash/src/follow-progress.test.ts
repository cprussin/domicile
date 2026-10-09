import { describe, expect, it } from "bun:test";

import { followProgress } from "./follow-progress";
import { Progress } from "./progress";

/** A `read` that answers `answers` in turn, then the last one forever. */
const answering =
  (...answers: (() => Promise<unknown>)[]) =>
  (): Promise<unknown> => {
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next === undefined) {
      throw new Error("answering needs an answer");
    } else {
      return next();
    }
  };

describe(followProgress, () => {
  it("reads the progress again until stopped", async () => {
    const heard = await new Promise<Progress[]>((resolve) => {
      const seen: Progress[] = [];
      const stop = followProgress(
        (progress) => {
          seen.push(progress);
          if (seen.length === 2) {
            stop();
            resolve(seen);
          }
        },
        answering(
          () => Promise.resolve({ state: "resolving" }),
          () => Promise.resolve({ state: "bundling" }),
        ),
        0,
      );
    });
    expect(heard).toEqual([Progress.Resolving(), Progress.Bundling()]);
  });

  it("keeps reading after a read fails", async () => {
    const heard = await new Promise<Progress>((resolve) => {
      const stop = followProgress(
        (progress) => {
          stop();
          resolve(progress);
        },
        answering(
          () => Promise.reject(new Error("mid-rename")),
          () => Promise.resolve({ state: "built" }),
        ),
        0,
        () => {
          /* the failure is expected here */
        },
      );
    });
    expect(heard).toEqual(Progress.Built());
  });
});
