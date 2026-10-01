import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Lock } from "./Lock";

/** The lock over a desk, recording every passphrase it was asked to offer. */
const lock = (locked = true) => {
  const offered: string[] = [];
  const drawn = (shut: boolean) => (
    <Lock
      locked={shut}
      onUnlock={(passphrase) => {
        offered.push(passphrase);
      }}
    />
  );
  const { rerender } = render(drawn(locked));
  return {
    offered,
    says: (shut: boolean) => {
      rerender(drawn(shut));
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

      says(true);

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

  it("clears what was typed after each try", async () => {
    // A refused passphrase is answered with nothing at all, so the field is
    // what says the try happened: one left full is a person retyping over their
    // own first guess, and one somebody walked away from is a guess left on the
    // screen of a locked desk.
    const { user } = lock();
    const field = screen.getByLabelText("Passphrase");

    await user.type(field, "wrong{Enter}");

    expect((field as HTMLInputElement).value).toBe("");
  });
});
