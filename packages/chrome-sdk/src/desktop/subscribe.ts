// The `on` every namespace of the desktop has: one listener per event,
// unsubscribed by calling what `on` returns.

import type { DomicileHost, DomicileHostEventMap } from "../domicile-host";

/** Stops what subscribed it. */
export type Unsubscribe = () => void;

/** A namespace's events, each as the listener it calls. */
export type Listeners = Record<string, (...args: never[]) => void>;

/** Call `listener` on each `type` event until the returned function runs. */
export type On<L extends Listeners> = <K extends keyof L>(
  type: K,
  listener: L[K],
) => Unsubscribe;

/** What a namespace listens to on the host. */
export type EventHost = Pick<
  DomicileHost,
  "addEventListener" | "removeEventListener"
>;

/** An `on` that subscribes each event the way `subscribers` says. */
export const on =
  <L extends Listeners>(
    subscribers: {
      [K in keyof L]: (listener: L[K]) => Unsubscribe;
    },
  ): On<L> =>
  (type, listener) =>
    subscribers[type](listener);

/** `listener` on each `type` event of `host`, until unsubscribed. */
export const hostEvent = <T extends keyof DomicileHostEventMap>(
  host: EventHost,
  type: T,
  listener: (event: DomicileHostEventMap[T]) => void,
): Unsubscribe => {
  host.addEventListener(type, listener);
  return () => {
    host.removeEventListener(type, listener);
  };
};
