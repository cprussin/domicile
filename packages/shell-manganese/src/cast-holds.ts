// While anything is cast to a TV, the desk holds off idle blanking and holds
// notification banners, which the TV would show. See
// docs/architecture/CASTING-TO-TVS.md.

import type { Result } from "@cprussin/option-result";
import type { Release } from "@domicile-desktop/manganese-bar-module-idle-inhibitor/portal-inhibit";
import { inhibitIdle } from "@domicile-desktop/manganese-bar-module-idle-inhibitor/portal-inhibit";
import type { Casting } from "@domicile-desktop/sdk/cast";
import { casting } from "@domicile-desktop/sdk/cast";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { useEffect, useState } from "react";

/**
 * Holds `inhibit`'s idle inhibitor while `casts` has one running, and calls
 * `onChange` with whether one is, now and on each change. Returns what stops
 * watching and lets go.
 */
export const holdWhileCasting = (
  casts: Pick<Casting, "watch">,
  inhibit: () => Promise<Result<Release, SystemError>>,
  onChange: (casting: boolean) => void,
): (() => void) => {
  const state: { held: Promise<Result<Release, SystemError>> | undefined } = {
    held: undefined,
  };
  const letGo = () => {
    const { held } = state;
    state.held = undefined;
    void held?.then((inhibited) => {
      inhibited.match({
        // Idle blanking was never held off, so there is nothing to let go.
        Err: () => undefined,
        Ok: (release) => {
          void release();
        },
      });
    });
  };
  const stop = casts.watch((running) => {
    const on = running.length > 0;
    if (on && state.held === undefined) {
      state.held = inhibit();
    } else if (!on) {
      letGo();
    }
    onChange(on);
  });
  return () => {
    stop();
    letGo();
  };
};

/**
 * Whether anything is cast to a TV, holding off idle blanking while it is.
 */
export const useCastHolds = (domicile: Domicile): boolean => {
  const [held, setHeld] = useState(false);
  useEffect(
    () =>
      holdWhileCasting(
        casting(domicile),
        () => inhibitIdle(domicile.dbus, "Casting to a TV"),
        setHeld,
      ),
    [domicile],
  );
  return held;
};
