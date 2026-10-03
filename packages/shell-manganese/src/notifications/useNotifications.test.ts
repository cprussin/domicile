import { describe, expect, it } from "bun:test";
import type { ToastManager } from "@domicile/component-library/Toaster";
import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { HostMessageOf } from "@domicile/sdk/host-message";
import type { Notification } from "@domicile/sdk/notification";
import { act, renderHook } from "@testing-library/react";

import { notification } from "./fixture";
import { useNotifications } from "./useNotifications";

/**
 * A stand-in for the client that takes the one handler this hook registers,
 * lets a test say what the compositor said, and keeps what the hook asked of
 * it. Narrow for `useTray`'s reason.
 */
const client = () => {
  let handler: ((message: HostMessageOf<"notifications">) => void) | undefined;
  const asked: unknown[][] = [];
  const domicile = {
    dismissNotifications: (ids: readonly number[]) => {
      asked.push(["dismiss", ids]);
    },
    invokeNotificationAction: (id: number, action: string) => {
      asked.push(["invoke", id, action]);
    },
    on: (
      _type: "notifications",
      registered: (message: HostMessageOf<"notifications">) => void,
    ) => {
      handler = registered;
    },
  } as unknown as DomicileClient;

  return {
    asked,
    domicile,
    says: (items: readonly Notification[]) => {
      act(() => {
        handler?.({ items });
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
    it("clears and presses through the client", () => {
      const { host, result } = mounted();

      result.current.dismiss([7, 8]);
      result.current.invoke(7, "reply");

      expect(host.asked).toEqual([
        ["dismiss", [7, 8]],
        ["invoke", 7, "reply"],
      ]);
    });
  });
});
