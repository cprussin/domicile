import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { isAbsent, watchPresence } from "./watch-presence";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe(watchPresence, () => {
  it("reports now, then only a change, until stopped", async () => {
    const present = { now: true };
    const ticks: (() => void)[] = [];
    const heard: Result<boolean, SystemError>[] = [];
    const stop = watchPresence(
      () => Promise.resolve(Ok(present.now)),
      (found) => {
        heard.push(found);
      },
      (_ms, tick) => {
        ticks.push(tick);
        return () => {
          ticks.length = 0;
        };
      },
    );
    const tick = async () => {
      for (const each of ticks) {
        each();
      }
      await settle();
    };

    await settle();
    await tick();
    present.now = false;
    await tick();
    expect(heard).toEqual([Ok(true), Ok(false)]);

    stop();
    present.now = true;
    await tick();
    expect(heard).toHaveLength(2);
  });
});

describe(isAbsent, () => {
  it("hides an item until its hardware is found, and when the look fails shows it", () => {
    expect(isAbsent(undefined)).toBe(true);
    expect(isAbsent(Ok(false))).toBe(true);
    expect(isAbsent(Ok(true))).toBe(false);
    expect(
      isAbsent(Err({ kind: SystemErrorKind.Other, message: "unreadable" })),
    ).toBe(false);
  });
});
