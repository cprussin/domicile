import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type {
  HostMessageOf,
  HostMessageType,
} from "@domicile/chrome-sdk/host-message";

/** One host message type, as every watcher on the page shares it. */
type Shared = {
  /** Who is watching now. */
  watchers: Set<(message: never) => void>;
  /** What the host last said, for a watcher that starts after it did. */
  last: { message: unknown } | undefined;
};

/** Per client, per type: one `on` each, however many watchers. */
const shared = new WeakMap<DomicileClient, Map<HostMessageType, Shared>>();

/**
 * Watch a host message `type` alongside every other watcher on the page:
 * `onMessage` is called with what the host last said, if it has said
 * anything, and again with everything it says after — and what comes back
 * stops it.
 *
 * **`on` is a single slot**, and the page draws a bar per monitor. A bar that
 * registered its own handler displaced the one before it, so only the last
 * monitor's bar heard the charge or the brightness — the others drew nothing
 * at all, which is how a battery that "isn't there" looks. This registers once
 * per client and fans out.
 *
 * **The last message is kept** for a watcher that starts late: a monitor
 * plugged in after the host said the charge, or a bar remounted. The host says
 * these again only when they move.
 *
 * **The `on` is never let go**, even when every watcher has stopped: an `off`
 * tells the client nobody will listen again, and anything it says after is
 * dropped — so the next monitor's bar would wait for a reading that already
 * went by. One handler kept for the life of the page is what that costs.
 */
export const watchShared = <T extends HostMessageType>(
  domicile: DomicileClient,
  type: T,
  onMessage: (message: HostMessageOf<T>) => void,
): (() => void) => {
  const types = shared.get(domicile) ?? new Map<HostMessageType, Shared>();
  shared.set(domicile, types);
  const existing = types.get(type);
  const entry: Shared = existing ?? { last: undefined, watchers: new Set() };
  if (existing === undefined) {
    types.set(type, entry);
    domicile.on(type, (message) => {
      entry.last = { message };
      for (const watcher of entry.watchers) {
        (watcher as (message: HostMessageOf<T>) => void)(message);
      }
    });
  }
  const watcher = onMessage as (message: never) => void;
  entry.watchers.add(watcher);
  if (entry.last !== undefined) {
    onMessage(entry.last.message as HostMessageOf<T>);
  }
  return () => {
    entry.watchers.delete(watcher);
  };
};
