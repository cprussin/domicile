import type { ToastManager } from "@domicile-desktop/component-library/Toaster";
import { watchHost } from "@domicile-desktop/manganese-host/watch-host";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { useCallback, useEffect, useRef, useState } from "react";
import { arrivals } from "./arrivals";
import type { PauseLength } from "./pause";
import { pauseEnd } from "./pause";
import type { Pause } from "./stored-pause";
import { storedPause, storePause } from "./stored-pause";
import { toastTimeout } from "./toast-timeout";

export type NotificationCenter = {
  /** Every uncleared notification, newest first. */
  items: readonly Notification[];
  /**
   * How many arrived since the drawer was last opened, but for those from an
   * uncounted sender.
   */
  unread: number;
  /** Mark everything as seen; called when the drawer opens. */
  read: () => void;
  /** Clear `ids` and tell their applications. */
  dismiss: (ids: readonly number[]) => void;
  /** Press `action` on `id`; `"default"` for the notification itself. */
  invoke: (id: number, action: string) => void;
  /** Send `text` from `id`'s reply field. */
  reply: (id: number, text: string) => void;
  /**
   * Holds back every toast but a critical one, or `undefined` while not
   * paused. Kept through a reload.
   */
  pause: Pause | undefined;
  pauseFor: (length: PauseLength) => void;
  resume: () => void;
};

/** The notifications and how far the user has read. */
type Desk = {
  /** As the compositor sent them: oldest first. */
  items: readonly Notification[];
  /**
   * The latest `time` the user has seen, or `undefined` before the first list,
   * which counts as seen.
   */
  readUpTo: number | undefined;
};

/**
 * The desktop's notifications, toasts for new arrivals, and the unseen count.
 *
 * Like `useTray`, it reads the full list from the host once for the whole
 * desktop and again on every change. The compositor owns the list, so it
 * survives a reload; `arrivals` decides what is new, so a reload toasts
 * nothing.
 *
 * A toast only interrupts. Closing it or timing out leaves the notification in
 * place. Clearing the notification (on any page) or its application closing it
 * removes the toast too. A pause holds back every toast but a critical one;
 * the notifications still collect. A timed pause ends by itself. See
 * docs/architecture/NOTIFICATIONS.md.
 */
export const useNotifications = (
  domicile: Pick<Domicile, "notifications">,
  toasts: ToastManager,
  /** The senders `unread` leaves out, by `appName`, such as the inboxes'. */
  uncounted: readonly string[],
  /**
   * The browser windows whose pages' notifications are cleared as they
   * arrive, unshown, because another sends the same news: an inbox's window,
   * when the inbox notifies its mail itself.
   */
  replaced: readonly string[],
  clock: typeof wallClock = wallClock,
): NotificationCenter => {
  const [desk, setDesk] = useState<Desk>({
    items: [],
    readUpTo: undefined,
  });
  // The last list received, for `arrivals`. A ref because it is only used in
  // the handler, not for rendering.
  const told = useRef<readonly Notification[] | undefined>(undefined);
  const [pause, setPause] = useState(() => unended(storedPause(), clock()));
  // Read by the handler, which subscribes once.
  const quiet = useRef(pause !== undefined);

  useEffect(() => {
    const heard = (sent: readonly Notification[]) => {
      const duplicates = sent
        .filter(
          ({ browserWindow }) =>
            browserWindow !== undefined && replaced.includes(browserWindow),
        )
        .map(({ id }) => id);
      if (duplicates.length > 0) {
        domicile.notifications.dismiss(duplicates);
      }
      const items = sent.filter(({ id }) => !duplicates.includes(id));
      for (const arrived of arrivals(told.current, items).filter(
        ({ urgency }) => !quiet.current || urgency === "critical",
      )) {
        toasts.add({
          data: arrived,
          description: arrived.body,
          id: String(arrived.id),
          timeout: toastTimeout(arrived),
          title: arrived.summary,
          type: arrived.urgency === "critical" ? "danger" : undefined,
        });
      }
      for (const gone of (told.current ?? []).filter(
        ({ id }) => !items.some((item) => item.id === id),
      )) {
        toasts.close(String(gone.id));
      }
      told.current = items;
      setDesk((previous) => ({
        items,
        readUpTo: previous.readUpTo ?? latest(items),
      }));
    };
    const { notifications } = domicile;
    return watchHost(
      (changed) => notifications.on("change", changed),
      () => notifications.list,
      heard,
    );
  }, [domicile, replaced, toasts]);

  const read = useCallback(() => {
    setDesk((previous) => ({ ...previous, readUpTo: latest(previous.items) }));
  }, []);

  const pauseAs = useCallback((next: Pause | undefined) => {
    quiet.current = next !== undefined;
    storePause(next);
    setPause(next);
  }, []);

  const pauseFor = useCallback(
    (length: PauseLength) => {
      const until = pauseEnd(length, clock());
      pauseAs(until === undefined ? {} : { until });
    },
    [clock, pauseAs],
  );

  const resume = useCallback(() => {
    pauseAs(undefined);
  }, [pauseAs]);

  const until = pause?.until;
  useEffect(() => {
    if (until === undefined) {
      return undefined;
    } else {
      const timer = setTimeout(resume, until - clock());
      return () => {
        clearTimeout(timer);
      };
    }
  }, [clock, resume, until]);

  const dismiss = useCallback(
    (ids: readonly number[]) => {
      domicile.notifications.dismiss(ids);
    },
    [domicile],
  );

  const invoke = useCallback(
    (id: number, action: string) => {
      domicile.notifications.invoke(id, action);
    },
    [domicile],
  );

  const reply = useCallback(
    (id: number, text: string) => {
      domicile.notifications.reply(id, text);
    },
    [domicile],
  );

  return {
    dismiss,
    invoke,
    items: desk.items.toReversed(),
    pause,
    pauseFor,
    read,
    reply,
    resume,
    unread: desk.items.filter(
      ({ appName, time }) =>
        time > (desk.readUpTo ?? 0) && !uncounted.includes(appName),
    ).length,
  };
};

/** The wall clock in ms since the epoch; injected so tests can control it. */
const wallClock = (): number => Date.now();

/** `pause`, unless it ended by `now`. */
const unended = (pause: Pause | undefined, now: number): Pause | undefined =>
  pause?.until !== undefined && pause.until <= now ? undefined : pause;

/** The newest `time` in `items`, or `0` for none. */
const latest = (items: readonly Notification[]): number =>
  Math.max(0, ...items.map(({ time }) => time));
