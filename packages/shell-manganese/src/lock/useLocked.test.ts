import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, renderHook } from "@testing-library/react";

import { useLocked } from "./useLocked";

/** A fake host whose lock a test sets. Records submitted passphrases. */
const client = () => {
  const fake = new FakeDomicileHost();
  return {
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
