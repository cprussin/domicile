import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { Release } from "@domicile-desktop/manganese-bar-module-idle-inhibitor/portal-inhibit";
import type { Cast } from "@domicile-desktop/sdk/cast";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { holdWhileCasting } from "./cast-holds";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A desk's casts, which a test starts and ends. */
const desk = () => {
  const listeners = new Set<(casts: readonly Cast[]) => void>();
  const send = (casts: readonly Cast[]) => {
    for (const listener of listeners) {
      listener(casts);
    }
  };
  return {
    casts: {
      watch: (listener: (casts: readonly Cast[]) => void) => {
        listeners.add(listener);
        listener([]);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    ended: () => {
      send([]);
    },
    started: () => {
      send([{} as Cast]);
    },
  };
};

/** An idle inhibitor that records each hold and release. */
const inhibitor = (refused = false) => {
  const heard: string[] = [];
  return {
    heard,
    inhibit: (): Promise<Result<Release, SystemError>> => {
      heard.push("held");
      return Promise.resolve(
        refused
          ? Err<Release, SystemError>({
              kind: SystemErrorKind.Dbus,
              message: "refused",
            })
          : Ok<Release, SystemError>(() => {
              heard.push("released");
              return Promise.resolve(Ok<"released", SystemError>("released"));
            }),
      );
    },
  };
};

describe("holdWhileCasting", () => {
  it("holds off idle blanking while a cast runs, once", async () => {
    const tv = desk();
    const idle = inhibitor();
    const casting: boolean[] = [];
    holdWhileCasting(tv.casts, idle.inhibit, (on) => casting.push(on));
    tv.started();
    tv.started();
    tv.ended();
    await settle();

    expect(casting).toEqual([false, true, true, false]);
    expect(idle.heard).toEqual(["held", "released"]);
  });

  it("lets go when it stops watching", async () => {
    const tv = desk();
    const idle = inhibitor();
    const stop = holdWhileCasting(tv.casts, idle.inhibit, () => undefined);
    tv.started();
    stop();
    tv.ended();
    await settle();

    expect(idle.heard).toEqual(["held", "released"]);
  });

  it("still says it is casting when the portal refuses", async () => {
    const tv = desk();
    const idle = inhibitor(true);
    const casting: boolean[] = [];
    holdWhileCasting(tv.casts, idle.inhibit, (on) => casting.push(on));
    tv.started();
    tv.ended();
    await settle();

    expect(casting).toEqual([false, true, false]);
    expect(idle.heard).toEqual(["held"]);
  });
});
