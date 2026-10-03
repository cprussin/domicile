import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { HostMessageOf } from "@domicile-desktop/sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useLocked } from "./useLocked";

/**
 * A stand-in for the client: it takes the one handler this hook registers and
 * lets a test say what the compositor said, and it records every passphrase it
 * was handed.
 *
 * Narrower than a `DomicileClient` for `useClipboard`'s reason — the hook uses
 * two members of it, and a double that implemented the rest would be claiming
 * a seam that size.
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
    // NOT LOCKED, and the direction matters: a desk that came up locked would
    // be one the compositor has said so about, and it says so as this page
    // connects. Starting from `true` instead would put a lock screen over every
    // desktop for the length of a handshake, including every desk that has no
    // lock at all and can never be asked for a passphrase.
    const host = client();

    const { result } = renderHook(() => useLocked(host.domicile));

    expect(result.current.locked).toBe(false);
  });

  it("is whichever the compositor last said, both ways round", () => {
    // Both directions in one test because the failure is an inversion, and an
    // inversion reads perfectly well from either one alone: a shell that locked
    // when the desk opened and cleared when it shut is the same bug seen twice.
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
      // `locked: true` while a passphrase is out is the answer to it: nothing
      // else sends one to a desk being checked, because that desk is already
      // shut.
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
      // The edge that raises the lock screen is not an answer to anything.
      const host = client();
      const { result } = renderHook(() => useLocked(host.domicile));

      host.says(true);

      expect(result.current.refusals).toBe(0);
    });
  });
});
