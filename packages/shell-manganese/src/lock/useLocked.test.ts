import { describe, expect, it } from "bun:test";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { HostMessageOf } from "@domicile/chrome-sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { useLocked } from "./useLocked";

/**
 * A stand-in for the client: it takes the one handler this hook registers and
 * lets a test say what the compositor said.
 *
 * Narrower than a `DomicileClient` for `useClipboard`'s reason — the hook uses
 * one member of it, and a double that implemented the rest would be claiming a
 * seam that size.
 */
const client = () => {
  let handler: ((message: HostMessageOf<"locked">) => void) | undefined;
  const domicile = {
    on: (
      _type: "locked",
      registered: (message: HostMessageOf<"locked">) => void,
    ) => {
      handler = registered;
    },
  } as unknown as DomicileClient;

  return {
    domicile,
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

    expect(result.current).toBe(false);
  });

  it("is whichever the compositor last said, both ways round", () => {
    // Both directions in one test because the failure is an inversion, and an
    // inversion reads perfectly well from either one alone: a shell that locked
    // when the desk opened and cleared when it shut is the same bug seen twice.
    const host = client();
    const { result } = renderHook(() => useLocked(host.domicile));

    host.says(true);
    expect(result.current).toBe(true);

    host.says(false);
    expect(result.current).toBe(false);
  });
});
