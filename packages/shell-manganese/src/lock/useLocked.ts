import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useCallback, useEffect, useState } from "react";

import { watchHost } from "../host/watch-host";

/** Where this desk's lock stands, as the compositor last said. */
type LockState = {
  /** Whether the desk is locked. */
  locked: boolean;
  /** Whether a passphrase is out with the compositor, unanswered. */
  checking: boolean;
  /**
   * How many passphrases the compositor has turned down. A count rather than a
   * flag, so the same refusal twice is two changes a lock screen can answer.
   */
  refusals: number;
};

/**
 * Whether this desk is locked, and the way to offer it a passphrase.
 *
 * **Pushed rather than asked for, and held by the compositor rather than here.**
 * This page does not decide the lock and cannot: input on this system is
 * forwarded by this page and injected into a Wayland seat by the compositor, and
 * a locked desk is that injection not happening. So what this hook holds is the
 * compositor's answer and nothing else — there is no local `setLocked` for a
 * click to reach, which is what makes the lock survive a reload of this page and
 * an engine that died and came back.
 *
 * `false` until the compositor has said otherwise, which is a moment rather than
 * a state worth drawing: it says where the desk stands as this page connects, so
 * a page that reloaded over a locked desk is told inside the handshake. Starting
 * from `true` would put a lock screen over every desktop for the length of one —
 * including the ones with no passphrase configured, which can never be asked for
 * one and would have nothing to clear it.
 *
 * **A REFUSAL IS `locked: true` WHILE A PASSPHRASE IS OUT.** The compositor
 * answers every check that leaves the desk shut by telling every chrome the
 * desk is locked again, and nothing else sends one to a desk being checked —
 * that desk is already shut. So an answer that does not open the desk is told
 * apart from the edge that shut it by whether this page was waiting on one.
 */
export const useLocked = (
  domicile: DomicileHost,
): LockState & { unlock: (passphrase: string) => void } => {
  const [state, setState] = useState<LockState>({
    checking: false,
    locked: false,
    refusals: 0,
  });

  // The engine says `lockedchanged` on every answer, not only on a change:
  // a refusal is the desk saying it is still locked.
  useEffect(
    () =>
      watchHost(domicile, "lockedchanged", lockedOf, (locked) => {
        setState((was) => ({
          checking: false,
          locked,
          refusals: was.checking && locked ? was.refusals + 1 : was.refusals,
        }));
      }),
    [domicile],
  );

  const unlock = useCallback(
    (passphrase: string) => {
      domicile.unlock(passphrase);
      setState((was) => ({ ...was, checking: true }));
    },
    [domicile],
  );

  return { ...state, unlock };
};

const lockedOf = ({ locked }: DomicileHost): boolean | undefined =>
  locked ?? undefined;
