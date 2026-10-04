import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type {
  HostMessageOf,
  HostMessageType,
} from "@domicile-desktop/sdk/host-message";

/** Shared state for one host message type. */
type Shared = {
  /** Current watchers. */
  watchers: Set<(message: never) => void>;
  /** Last message, replayed to late watchers. */
  last: { message: unknown } | undefined;
};

/** One `on` registration per client and type, shared by all watchers. */
const shared = new WeakMap<DomicileClient, Map<HostMessageType, Shared>>();

/**
 * Watch host messages of `type`, sharing one handler with other watchers.
 * `onMessage` gets the last message, if any, then every later one. Returns a
 * function that stops watching.
 *
 * - `on` holds one handler per type, and the page draws a bar per monitor, so
 *   per-bar handlers would replace each other. This registers once and fans
 *   out.
 * - The last message is kept for late watchers (a new monitor, a remounted
 *   bar), since the host resends only on change.
 * - The handler is never removed: after `off` the client drops messages, so a
 *   later watcher would miss them.
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
