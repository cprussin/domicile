import { describe, expect, it } from "bun:test";
import type { Inbox as InboxType } from "@domicile-desktop/manganese-notifications/inbox";
import {
  Inbox,
  InboxReading,
} from "@domicile-desktop/manganese-notifications/inbox";
import { sharedWatch } from "@domicile-desktop/react/shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { act, renderHook } from "@testing-library/react";

import { useInboxDrawer } from "./inbox-drawer";

/** A Work inbox read from outside, and a Chat page. */
const inboxes = () => {
  const reading: { send: (reading: InboxReading) => void } = {
    send: () => undefined,
  };
  const opened: (readonly unknown[])[] = [];
  const list: readonly InboxType[] = [
    Inbox.Watched({
      icon: EnvelopeSimpleIcon,
      name: "Work",
      open: (_domicile, read) => {
        opened.push(["open work", read]);
      },
      read: () =>
        sharedWatch((onReading) => {
          reading.send = onReading;
          return () => undefined;
        }),
    }),
    Inbox.Page({
      countUnread: () => () => undefined,
      icon: EnvelopeSimpleIcon,
      name: "Chat",
      url: "https://chat.example.com/",
    }),
  ];
  return { list, opened, reading };
};

const drawer = () => {
  const { list, opened, reading } = inboxes();
  const domicile: Domicile = new FakeDomicileHost().domicile;
  const hook = renderHook(() =>
    useInboxDrawer({
      domicile,
      inboxes: list,
      onClose: () => {
        opened.push(["close"]);
      },
      onShow: () => {
        opened.push(["show"]);
      },
    }),
  );
  return { hook, opened, reading };
};

describe("useInboxDrawer", () => {
  it("reads every inbox, and adds up their unread conversations", () => {
    const { hook, reading } = drawer();

    act(() => {
      reading.send(InboxReading.Counted(12, 2));
      hook.result.current.drawer.onUnread(1, 3);
    });

    expect(hook.result.current.drawer.readings).toEqual([
      InboxReading.Counted(12, 2),
      InboxReading.Unread(3),
    ]);
    expect(hook.result.current.unread).toBe(5);
  });

  it("counts a page once, at its latest", () => {
    const { hook } = drawer();

    act(() => {
      hook.result.current.drawer.onUnread(1, 2);
    });
    act(() => {
      hook.result.current.drawer.onUnread(1, 1);
    });

    expect(hook.result.current.unread).toBe(1);
  });

  it("opens an inbox read from outside with its reading, closing the drawer", () => {
    const { hook, opened, reading } = drawer();
    act(() => {
      reading.send(InboxReading.SignedOut());
    });

    act(() => {
      hook.result.current.drawer.onOpen(0);
    });

    expect(opened).toEqual([
      ["open work", InboxReading.SignedOut()],
      ["close"],
    ]);
  });

  it("shows a page in the drawer, and goes back to the list", () => {
    const { hook, opened } = drawer();

    act(() => {
      hook.result.current.drawer.onOpen(1);
    });
    expect(opened).toEqual([["show"]]);
    expect(hook.result.current.drawer.shown).toBe(1);

    act(hook.result.current.back);
    expect(hook.result.current.drawer.shown).toBeUndefined();
  });

  it("opens the drawer on a page that asks to be shown", () => {
    const { hook, opened } = drawer();

    act(() => {
      hook.result.current.drawer.onShow(1);
    });

    expect(opened).toEqual([["show"]]);
    expect(hook.result.current.drawer.shown).toBe(1);
  });
});
