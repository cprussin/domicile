import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { UnlockRefusal } from "@domicile-desktop/sdk/system";
import { act, renderHook } from "@testing-library/react";

import { useLocked } from "./useLocked";

/** A fake host whose lock a test sets. Records submitted passphrases. */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
    /** A line from the compositor to the page's system calls. */
    answers: async (line: object) => {
      await act(async () => {
        fake.dispatch("system", { data: JSON.stringify(line) });
        await Promise.resolve();
      });
    },
    domicile: fake.host,
    get offered() {
      return fake.calls
        .filter(([method]) => method === "unlock")
        .map(([, passphrase]) => passphrase);
    },
    says: (locked: boolean) => {
      act(() => {
        fake.set({ locked });
      });
    },
    /** The system calls the hook made, as the compositor reads them. */
    get system() {
      return fake.calls
        .filter(([method]) => method === "callSystem")
        .map(([, id, request]) => [id, JSON.parse(String(request))]);
    },
  };
};

/** The monotonic clock the hook reads, frozen, in milliseconds. */
const NOW = 86_400_000;
const now = () => NOW;

describe("useLocked", () => {
  it("is open until the compositor has said otherwise", () => {
    // Starts unlocked. The compositor reports the lock state on connect;
    // starting locked would flash the lock screen on every connect.
    const host = client();

    const { result } = renderHook(() => useLocked(host.domicile));

    expect(result.current.locked).toBe(false);
  });

  it("is whichever the compositor last said, both ways round", () => {
    // Both directions in one test because the likely bug is an inversion, which
    // each direction alone would not catch.
    const host = client();
    const { result } = renderHook(() => useLocked(host.domicile));

    host.says(true);
    expect(result.current.locked).toBe(true);

    host.says(false);
    expect(result.current.locked).toBe(false);
  });

  describe("a passphrase", () => {
    it("is handed to the compositor and checked until it answers", () => {
      const host = client();
      const { result } = renderHook(() => useLocked(host.domicile));
      host.says(true);

      act(() => {
        result.current.unlock("open sesame");
      });

      expect(host.offered).toStrictEqual(["open sesame"]);
      expect(result.current.checking).toBe(true);
    });

    it("is refused by the compositor saying the desk is still locked", () => {
      // `locked: true` while a passphrase is pending is the refusal: nothing
      // else sends it to an already locked desktop.
      const host = client();
      const { result } = renderHook(() => useLocked(host.domicile));
      host.says(true);
      act(() => {
        result.current.unlock("wrong");
      });

      host.says(true);

      expect(result.current).toMatchObject({
        checking: false,
        locked: true,
        refusals: 1,
      });
    });

    it("is not refused by a desk that opened", () => {
      const host = client();
      const { result } = renderHook(() => useLocked(host.domicile));
      host.says(true);
      act(() => {
        result.current.unlock("open sesame");
      });

      host.says(false);

      expect(result.current).toMatchObject({
        checking: false,
        locked: false,
        refusals: 0,
      });
    });

    it("has its refusals forgotten when the desk opens", () => {
      // A count left over would shake the field again on the next lock.
      const host = client();
      const { result } = renderHook(() => useLocked(host.domicile));
      host.says(true);
      act(() => {
        result.current.unlock("wrong");
      });
      host.says(true);
      act(() => {
        result.current.unlock("open sesame");
      });

      host.says(false);
      host.says(true);

      expect(result.current.refusals).toBe(0);
    });

    it("is not refused by a desk that shut with nothing out", () => {
      // The lock transition itself is not an answer.
      const host = client();
      const { result } = renderHook(() => useLocked(host.domicile));

      host.says(true);

      expect(result.current.refusals).toBe(0);
    });
  });

  describe("a refusal", () => {
    /** A lock screen hearing the compositor's refusals. */
    const listening = async () => {
      const host = client();
      const hook = renderHook(() => useLocked(host.domicile, now));
      host.says(true);
      await host.answers({
        id: 1,
        reply: { kind: "started" },
        type: "system_reply",
      });
      return { hook, host };
    };

    it("says why, and when the compositor takes the next passphrase", async () => {
      const { host, hook } = await listening();

      await host.answers({
        event: {
          failures: 3,
          kind: "unlock_refused",
          refusal: "wrong_passphrase",
          retry_in_ms: 5000,
        },
        id: 1,
        type: "system_event",
      });

      expect(host.system[0]).toStrictEqual([1, { call: "unlock_refusals" }]);
      expect(hook.result.current.refused).toStrictEqual({
        refusal: UnlockRefusal.WrongPassphrase,
        retryAt: NOW + 5000,
      });
    });

    it("is forgotten when the desk opens", async () => {
      const { host, hook } = await listening();
      await host.answers({
        event: {
          failures: 1,
          kind: "unlock_refused",
          refusal: "unverifiable",
          retry_in_ms: 0,
        },
        id: 1,
        type: "system_event",
      });

      host.says(false);

      expect(hook.result.current.refused).toBeUndefined();
    });

    it("stops being heard once the lock screen goes", async () => {
      const { host, hook } = await listening();

      hook.unmount();

      expect(host.system[1]).toStrictEqual([1, { call: "unwatch" }]);
    });
  });
});
