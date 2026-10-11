import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type {
  Listening,
  UnlockRefusal,
  UnlockRefused,
} from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import { useCallback, useEffect, useState } from "react";

import { watchHost } from "../host/watch-host";
import { uptime } from "./uptime";

/** Why the compositor last refused a passphrase, and when it takes another. */
export type Refused = {
  refusal: UnlockRefusal;
  /** When, on `uptime`, the compositor starts taking passphrases again. */
  retryAt: number;
};

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
  /** The last refusal since the desk locked. */
  refused: Refused | undefined;
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
 * how it is told apart from the message that locked the desktop. Why it was
 * refused arrives just before, from the compositor's `unlockRefusals`.
 */
export const useLocked = (
  domicile: DomicileHost,
  now: typeof uptime = uptime,
): LockState & { unlock: (passphrase: string) => void } => {
  const [state, setState] = useState<LockState>({
    checking: false,
    locked: false,
    refusals: 0,
    refused: undefined,
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
          refused: locked ? was.refused : undefined,
        }));
      }),
    [domicile],
  );

  useEffect(
    () =>
      hearRefusals(domicile, ({ refusal, retryInMs }) => {
        setState((was) => ({
          ...was,
          refused: { refusal, retryAt: now() + retryInMs },
        }));
      }),
    [domicile, now],
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

/**
 * Call `onRefused` with each refusal the compositor sends, and return a
 * function that stops listening. A stop before listening starts ends it once
 * it does.
 */
const hearRefusals = (
  domicile: DomicileHost,
  onRefused: (refused: UnlockRefused) => void,
): (() => void) => {
  const state: {
    stopped: boolean;
    listening: Listening<UnlockRefused> | undefined;
  } = { listening: undefined, stopped: false };
  system(domicile)
    .unlockRefusals()
    .then((result) => {
      result.match({
        Err: reportToConsole,
        Ok: (listening) => {
          if (state.stopped) {
            listening.stop();
          } else {
            state.listening = listening;
          }
          eachOf(listening.items, onRefused).catch(reportToConsole);
        },
      });
    })
    .catch(reportToConsole);
  return () => {
    state.stopped = true;
    state.listening?.stop();
  };
};

/** Log that the lock screen cannot say why a passphrase was refused. */
const reportToConsole = (error: unknown): void => {
  // biome-ignore lint/suspicious/noConsole: the lock still works and still shows a refusal, only without its reason
  console.error("this page cannot hear why a passphrase was refused", error);
};

/** Call `each` with every item `items` brings, until it closes. */
const eachOf = async <T>(
  items: ReadableStream<T>,
  each: (item: T) => void,
): Promise<void> => {
  for await (const item of items) {
    each(item);
  }
};
