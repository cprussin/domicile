// Idle and lock. See docs/SHELL-IDLE-AND-LOCK.md.

import type { DomicileHost } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";
import type { System } from "./system-calls";

export type SessionListeners = {
  idlechange: () => void;
  lockchange: () => void;
};

export type Session = {
  /** `undefined` until the compositor says. */
  readonly idle: boolean | undefined;
  /** `undefined` until the compositor says. */
  readonly locked: boolean | undefined;
  /** Lock the desk now; answered with `lockchange` once it shut. */
  lock: () => void;
  /**
   * Offer a passphrase at a locked desk; answered with `lockchange` only when
   * it opened. Clear a lock screen on that event, never on its own check.
   */
  unlock: (passphrase: string) => void;
  idleWarnings: System["idleWarnings"];
  idleHolds: System["idleHolds"];
  unlockRefusals: System["unlockRefusals"];
  on: On<SessionListeners>;
};

export type SessionHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "idle"
  | "lock"
  | "locked"
  | "removeEventListener"
  | "unlock"
>;

export const session = (
  host: SessionHost,
  calls: Pick<System, "idleHolds" | "idleWarnings" | "unlockRefusals">,
): Session => ({
  get idle() {
    return host.idle ?? undefined;
  },
  idleHolds: () => calls.idleHolds(),
  idleWarnings: () => calls.idleWarnings(),
  lock: () => {
    host.lock();
  },
  get locked() {
    return host.locked ?? undefined;
  },
  on: on<SessionListeners>({
    idlechange: (listener) => hostEvent(host, "idlechanged", () => listener()),
    lockchange: (listener) =>
      hostEvent(host, "lockedchanged", () => listener()),
  }),
  unlock: (passphrase) => {
    host.unlock(passphrase);
  },
  unlockRefusals: () => calls.unlockRefusals(),
});
