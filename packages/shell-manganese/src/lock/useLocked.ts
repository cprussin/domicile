import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import { useCallback, useEffect, useState } from "react";

import { watchHost } from "../host/watch-host";

/** The desktop's lock state, as the compositor last reported it. */
type LockState = {
  /** Whether the desktop is locked. */
  locked: boolean;
  /** Whether a submitted passphrase is awaiting the compositor's answer. */
  checking: boolean;
  /**
   * How many passphrases the compositor has refused since the desk locked. A
   * count, not a flag, so repeated refusals each register as a change.
   */
  refusals: number;
};

/**
 * Whether the desktop is locked, and a way to submit a passphrase.
 *
 * The compositor owns the lock and pushes its state; this hook only mirrors it.
 * There is no local setter, so a page reload or engine restart cannot unlock
 * the desktop. See docs/LOCK.md.
 *
 * Starts `false`. The compositor sends the state during the handshake, and
 * starting `true` would flash the lock screen on every connect, including on
 * desktops with no passphrase configured.
 *
 * A refusal arrives as `locked: true` while a passphrase is pending. That is
 * how it is told apart from the message that locked the desktop.
 */
export const useLocked = (
  domicile: DomicileHost,
): LockState & { unlock: (passphrase: string) => void } => {
  const [state, setState] = useState<LockState>({
    checking: false,
    locked: false,
    refusals: 0,
  });

  // The engine sends `lockedchanged` on every answer, not only on a change: a
  // refusal leaves the desk locked.
  useEffect(
    () =>
      watchHost(domicile, "lockedchanged", lockedOf, (locked) => {
        setState((was) => ({
          checking: false,
          locked,
          refusals: refusalsAfter(was, locked),
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

/**
 * The refusal count after the compositor says `locked`. Unlocking resets it,
 * so the next lock does not start shaken.
 */
const refusalsAfter = (was: LockState, locked: boolean): number => {
  if (locked) {
    return was.checking ? was.refusals + 1 : was.refusals;
  } else {
    return 0;
  }
};
