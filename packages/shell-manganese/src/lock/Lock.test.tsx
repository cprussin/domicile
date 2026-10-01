import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Lock } from "./Lock";

/** Where the lock stands, as `useLocked` would hand it over. */
type Standing = { checking: boolean; locked: boolean; refusals: number };

/** The lock over a desk, recording every passphrase it was asked to offer. */
const lock = (locked = true) => {
  const offered: string[] = [];
  const drawn = (standing: Standing) => (
    <Lock
      {...standing}
      onUnlock={(passphrase) => {
        offered.push(passphrase);
      }}
    />
  );
  const { rerender } = render(drawn({ checking: false, locked, refusals: 0 }));
  return {
    field: () => screen.getByLabelText("Passphrase") as HTMLInputElement,
    offered,
    says: (standing: Partial<Standing>) => {
      rerender(
        drawn({ checking: false, locked: true, refusals: 0, ...standing }),
      );
    },
    user: userEvent.setup(),
  };
};

describe("Lock", () => {
  it("is out of reach while the desk is open", () => {
    // Inert rather than unmounted, because it has to fade out after the desk
    // opens — and a sheet over the whole desktop that was merely transparent
    // would take every click on the desk with it, and every Tab too.
    lock(false);

    expect(
      screen.getByLabelText("Passphrase").closest("[inert]"),
    ).not.toBeNull();
  });

  it("covers the desktop and asks for the passphrase", () => {
    lock();

    expect(screen.getByLabelText("Passphrase").closest("[inert]")).toBeNull();
  });

  describe("the keyboard", () => {
    it("is put in the field as the desk shuts", () => {
      // On the edge rather than on mount: the sheet is on the page the whole
      // time, so the moment it is shown is the moment the compositor says so.
      const { says } = lock(false);

      says({ locked: true });

      expect(document.activeElement).toBe(screen.getByLabelText("Passphrase"));
    });

    it("cannot be taken out of the field while the desk is shut", async () => {
      // Nothing else on a locked desk is anything to type into, so a key that
      // went anywhere but the field is a key of the passphrase thrown away.
      const { user } = lock();

      await user.tab();
      expect(document.activeElement).toBe(screen.getByLabelText("Passphrase"));

      await user.click(screen.getByRole("button", { name: "Unlock" }));
      expect(document.activeElement).toBe(screen.getByLabelText("Passphrase"));
    });
  });

  it("offers what was typed and never decides anything itself", async () => {
    // THE WHOLE OF WHAT THIS COMPONENT DOES WITH A PASSPHRASE IS HAND IT OVER.
    // It is still on the page afterward, because what clears it is the
    // compositor saying the desk opened — a lock screen that cleared itself on
    // submit would be a lock anybody could open by pressing Enter.
    const { offered, user } = lock();

    await user.type(screen.getByLabelText("Passphrase"), "open sesame{Enter}");

    expect(offered).toStrictEqual(["open sesame"]);
    expect(screen.getByLabelText("Passphrase")).toBeTruthy();
  });

  it("keeps the passphrase out of the document", () => {
    // A field whose value is readable off the screen over the shoulder of
    // somebody standing at a locked desk is not a passphrase field. `type` is
    // asserted rather than assumed because it is one attribute between a lock
    // screen and a billboard.
    lock();

    expect(screen.getByLabelText("Passphrase").getAttribute("type")).toBe(
      "password",
    );
  });

  describe("a passphrase being checked", () => {
    it("stays in the field, and is not offered twice", async () => {
      // Held rather than cleared, because nothing has said it was wrong yet —
      // a field that emptied on Enter is a person who cannot see what they
      // just sent.
      const { field, offered, says, user } = lock();
      await user.type(field(), "open sesame{Enter}");

      says({ checking: true });
      await user.type(field(), "{Enter}");

      expect(field().value).toBe("open sesame");
      expect(offered).toStrictEqual(["open sesame"]);
    });

    it("is cleared once it is refused, and the refusal said", async () => {
      // A refusal is the only thing that says the try was wrong, so it is the
      // only thing that empties the field — and one somebody walked away from
      // would be a guess left on the screen of a locked desk.
      const { field, says, user } = lock();
      await user.type(field(), "wrong{Enter}");
      says({ checking: true });

      says({ refusals: 1 });

      expect(field().value).toBe("");
      expect(screen.getByRole("alert").textContent).toBe("Wrong passphrase");
    });

    it("stops saying it was wrong once somebody types again", async () => {
      const { field, says, user } = lock();
      says({ refusals: 1 });

      await user.type(field(), "x");

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("is cleared once the desk opens", async () => {
      // The sheet outlives the lock to fade out, and a passphrase left in it
      // would be one sitting in the page of an open desk.
      const { field, says, user } = lock();
      await user.type(field(), "open sesame{Enter}");

      says({ locked: false });

      expect(field().value).toBe("");
    });
  });
});
