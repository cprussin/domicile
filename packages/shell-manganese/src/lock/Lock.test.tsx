import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Lock } from "./Lock";

/** The lock over a desk, recording every passphrase it was asked to offer. */
const lock = (locked = true) => {
  const offered: string[] = [];
  render(
    <Lock
      locked={locked}
      onUnlock={(passphrase) => {
        offered.push(passphrase);
      }}
    />,
  );
  return { offered, user: userEvent.setup() };
};

describe("Lock", () => {
  it("is not on the page at all while the desk is open", () => {
    // Absent rather than hidden. A sheet over the whole desktop that was merely
    // transparent would take every click on the desk with it, and the desk this
    // shell is drawing is the one somebody is working at.
    lock(false);

    expect(screen.queryByLabelText("Passphrase")).toBeNull();
  });

  it("covers the desktop and asks for the passphrase", () => {
    lock();

    expect(screen.getByLabelText("Passphrase")).toBeTruthy();
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
