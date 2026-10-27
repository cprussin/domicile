import type {
  Inbox,
  InboxReading as Reading,
} from "@domicile-desktop/manganese-notifications/inbox";
import {
  InboxKind,
  InboxReading,
  unreadIn,
} from "@domicile-desktop/manganese-notifications/inbox";
import type { DrawerInboxes } from "@domicile-desktop/manganese-notifications/NotificationDrawer";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { useCallback, useEffect, useMemo, useState } from "react";

type Options = {
  domicile: Domicile;
  /** The config's inboxes. */
  inboxes: readonly Inbox[];
  /** Closes the notification drawer. */
  onClose: () => void;
  /** Opens the notification drawer. */
  onShow: () => void;
};

/**
 * The notification drawer's inboxes: what each reads, the page the drawer
 * shows, and the unread conversations the bell adds to its count.
 */
export const useInboxDrawer = ({
  domicile,
  inboxes,
  onClose,
  onShow,
}: Options) => {
  const [shown, setShown] = useState<number | undefined>(undefined);
  const watched = useWatchedReadings(domicile, inboxes);
  const [pageCounts, setPageCounts] = useState<ReadonlyMap<number, number>>(
    () => new Map(),
  );
  const readings = useMemo(
    () =>
      inboxes.map((inbox, index) => {
        const counted = pageCounts.get(index);
        if (inbox.kind === InboxKind.Watched) {
          return watched[index];
        } else {
          return counted === undefined
            ? undefined
            : InboxReading.Unread(counted);
        }
      }),
    [inboxes, pageCounts, watched],
  );
  const back = useCallback(() => {
    setShown(undefined);
  }, []);
  const show = useCallback(
    (index: number) => {
      setShown(index);
      onShow();
    },
    [onShow],
  );
  const open = useCallback(
    (index: number) => {
      const inbox = inboxes[index];
      if (inbox?.kind === InboxKind.Page) {
        show(index);
      } else if (inbox?.kind === InboxKind.Watched) {
        inbox.open(domicile, readings[index]);
        setShown(undefined);
        onClose();
      }
    },
    [domicile, inboxes, onClose, readings, show],
  );
  const countPage = useCallback((index: number, unread: number) => {
    setPageCounts((counted) => new Map([...counted, [index, unread]]));
  }, []);
  const drawer = useMemo<DrawerInboxes>(
    () => ({
      inboxes,
      onOpen: open,
      onShow: show,
      onUnread: countPage,
      readings,
      shown,
    }),
    [countPage, inboxes, open, readings, show, shown],
  );
  const unread = useMemo(
    () => readings.reduce((sum, reading) => sum + unreadIn(reading), 0),
    [readings],
  );
  return { back, drawer, unread };
};

/** The latest reading of each inbox read from outside, by its place. */
const useWatchedReadings = (domicile: Domicile, inboxes: readonly Inbox[]) => {
  const watches = useMemo(
    () =>
      inboxes.map((inbox) =>
        inbox.kind === InboxKind.Watched ? inbox.read(domicile) : undefined,
      ),
    [domicile, inboxes],
  );
  const [readings, setReadings] = useState<readonly (Reading | undefined)[]>(
    () => watches.map((watch) => watch?.current()),
  );
  useEffect(() => {
    const stops = watches.map((watch, index) =>
      watch?.subscribe(() => {
        setReadings((read) => read.with(index, watch.current()));
      }),
    );
    setReadings(watches.map((watch) => watch?.current()));
    return () => {
      for (const stop of stops) {
        stop?.();
      }
    };
  }, [watches]);
  return readings;
};
