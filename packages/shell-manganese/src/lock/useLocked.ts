import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import { useCallback, useEffect, useState } from "react";

/** The desktop's lock state, as the compositor last reported it. */
type LockState = {
  /** Whether the desktop is locked. */
  locked: boolean;
  /** Whether a submitted passphrase is awaiting the compositor's answer. */
  checking: boolean;
  /**
   * How many passphrases the compositor has refused. A count, not a flag, so
   * repeated refusals each register as a change.
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
  domicile: DomicileClient,
): LockState & { unlock: (passphrase: string) => void } => {
  const [state, setState] = useState<LockState>({
    checking: false,
    locked: false,
    refusals: 0,
  });

  // Registered once for the shell's lifetime, like `useClipboard`. `on` is a
  // single slot that replays messages received before registration, and the
  // lock state arrives before the first render ends.
  useEffect(() => {
    domicile.on("locked", (message) => {
      setState((was) => ({
        checking: false,
        locked: message.locked,
        refusals:
          was.checking && message.locked ? was.refusals + 1 : was.refusals,
      }));
    });
  }, [domicile]);

  const unlock = useCallback(
    (passphrase: string) => {
      domicile.unlock(passphrase);
      setState((was) => ({ ...was, checking: true }));
    },
    [domicile],
  );

  return { ...state, unlock };
};
