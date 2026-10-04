import { describe, expect, it } from "bun:test";
import type { ToastManager } from "@domicile-desktop/component-library/Toaster";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { act, renderHook } from "@testing-library/react";

import { notification } from "./fixture";
import { useNotifications } from "./useNotifications";

/**
 * A host whose notifications the test says, in the engine's spellings, and
 * that keeps what the hook asked of it.
 */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
    asked: fake.calls,
    domicile: fake.host,
    says: (items: readonly Notification[]) => {
      act(() => {
        fake.set({
          notifications: items.map((item) => ({
            ...item,
            icon: item.icon ?? "",
            timeoutMs: item.timeoutMs ?? -1,
          })),
        });
      });
    },
  };
};

/** A toast manager that keeps what it was asked to show and take down. */
const toasts = () => {
  const added: unknown[] = [];
  const closed: string[] = [];
  const manager = {
    add: (options: unknown) => {
      added.push(options);
      return "";
    },
    close: (id: string) => {
      closed.push(id);
    },
  } as unknown as ToastManager;
  return { added, closed, manager };
};

const mounted = () => {
  const host = client();
  const shown = toasts();
  const { result } = renderHook(() =>
    useNotifications(host.domicile, shown.manager),
  );
  return { host, result, shown };
};

describe("useNotifications", () => {
  describe("the list", () => {
    it("is empty until the compositor has said", () => {
      expect(mounted().result.current.items).toEqual([]);
    });

    it("is what the compositor said last, newest first", () => {
      const { host, result } = mounted();
      const older = notification({ id: 1, time: 1 });
      const newer = notification({ id: 2, time: 2 });

      host.says([older, newer]);

      expect(result.current.items).toEqual([newer, older]);
    });
  });

  describe("toasts", () => {
    it("toasts nothing the desk already had when the page connected", () => {
      const { host, shown } = mounted();

      host.says([notification({ id: 1 })]);

      expect(shown.added).toEqual([]);
    });

    it("toasts what arrives after, for as long as it asked", () => {
      const { host, shown } = mounted();
      host.says([]);
      const arrived = notification({
        body: "Ada: lunch?",
        id: 7,
        summary: "New message",
        timeoutMs: 10_000,
      });

      host.says([arrived]);

      expect(shown.added).toEqual([
        {
          data: arrived,
          description: "Ada: lunch?",
          id: "7",
          timeout: 10_000,
          title: "New message",
          type: undefined,
        },
      ]);
    });

    it("marks a critical one as danger", () => {
      const { host, shown } = mounted();
      host.says([]);

      host.says([notification({ id: 8, urgency: "critical" })]);

      expect(shown.added).toEqual([
        expect.objectContaining({ timeout: 0, type: "danger" }),
      ]);
    });

    it("takes a toast down when its notification goes", () => {
      // Its application closed it, or it was cleared on another monitor's
      // page.
      const { host, shown } = mounted();
      host.says([notification({ id: 7 })]);

      host.says([]);

      expect(shown.closed).toEqual(["7"]);
    });
  });

  describe("unread", () => {
    it("counts what arrived since the drawer was last opened", () => {
      const { host, result } = mounted();
      host.says([notification({ id: 1, time: 1 })]);
      host.says([
        notification({ id: 1, time: 1 }),
        notification({ id: 2, time: 2 }),
        notification({ id: 3, time: 3 }),
      ]);

      expect(result.current.unread).toBe(2);

      act(() => {
        result.current.read();
      });

      expect(result.current.unread).toBe(0);
    });
  });

  describe("asking the compositor", () => {
    it("clears and presses through the host", () => {
      const { host, result } = mounted();

      result.current.dismiss([7, 8]);
      result.current.invoke(7, "reply");

      expect(host.asked).toEqual([
        ["dismissNotifications", [7, 8]],
        ["invokeNotificationAction", 7, "reply"],
      ]);
    });
  });
});
