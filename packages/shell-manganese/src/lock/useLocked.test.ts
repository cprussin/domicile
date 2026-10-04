import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { HostMessageOf } from "@domicile-desktop/sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useLocked } from "./useLocked";

/**
 * A client stub that captures the hook's handler, lets a test send compositor
 * messages and records submitted passphrases.
 *
 * Only the two members the hook uses, like `useClipboard`'s test.
 */
const client = () => {
  let handler: ((message: HostMessageOf<"locked">) => void) | undefined;
  const offered: string[] = [];
  const domicile = {
    on: (
      _type: "locked",
      registered: (message: HostMessageOf<"locked">) => void,
    ) => {
      handler = registered;
    },
    unlock: (passphrase: string) => {
      offered.push(passphrase);
    },
  } as unknown as DomicileClient;

  return {
    domicile,
    offered,
    says: (locked: boolean) => {
      act(() => {
        handler?.({ locked });
      });
    },
  };
};

describe("useLocked", () => {
  it("is open until the compositor has said otherwise", () => {
    // Starts unlocked. The compositor reports the lock state on connect;
    // starting locked would flash the lock screen on every connect, even on
    // desktops with no lock configured.
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

    it("is not refused by a desk that shut with nothing out", () => {
      // The lock transition itself is not an answer.
      const host = client();
      const { result } = renderHook(() => useLocked(host.domicile));

      host.says(true);

      expect(result.current.refusals).toBe(0);
    });
  });
});
