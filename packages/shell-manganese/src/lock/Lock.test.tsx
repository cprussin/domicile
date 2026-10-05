import { describe, expect, it } from "bun:test";
import { DisplayProvider } from "@domicile-desktop/component-library/DisplayProvider";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OnOneScreen } from "../screens/fixture";
import { Lock } from "./Lock";

/** The lock state, as `useLocked` returns it. */
type Standing = { checking: boolean; locked: boolean; refusals: number };

/** Renders the lock, recording every passphrase it submits. */
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
  const { rerender } = render(drawn({ checking: false, locked, refusals: 0 }), {
    wrapper: OnOneScreen,
  });
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
    // Inert rather than unmounted so it can fade out. A transparent sheet would
    // still catch every click and Tab.
    lock(false);

    expect(
      screen.getByLabelText("Passphrase").closest("[inert]"),
    ).not.toBeNull();
  });

  it("covers the desktop and asks for the passphrase", () => {
    lock();

    expect(screen.getByLabelText("Passphrase").closest("[inert]")).toBeNull();
  });

  it("blurs each screen and not the gaps between them", () => {
    // Monitors of different sizes leave gaps in the page. A blur over the
    // whole page would cost as much there as on the screens.
    render(
      <Lock checking={false} locked onUnlock={() => undefined} refusals={0} />,
      {
        wrapper: ({ children }) => (
          <DisplayProvider
            source={{
              displays: [
                {
                  name: "left",
                  position: [0, 0],
                  scale: 1,
                  size: [1920, 1080],
                },
                {
                  name: "right",
                  position: [1920, 120],
                  scale: 2,
                  size: [2560, 1440],
                },
              ],
              onDisplays: () => () => undefined,
            }}
          >
            {children}
          </DisplayProvider>
        ),
      },
    );

    expect(
      [...document.querySelectorAll<HTMLElement>("[data-veil]")].map(
        ({ style: { height, left, top, width } }) => ({
          height,
          left,
          top,
          width,
        }),
      ),
    ).toEqual([
      { height: "1080px", left: "0px", top: "0px", width: "1920px" },
      { height: "1440px", left: "1920px", top: "120px", width: "2560px" },
    ]);
  });

  it("blurs the whole page until the screens are described", () => {
    // A desk that locks while starting must not be left readable.
    render(
      <Lock checking={false} locked onUnlock={() => undefined} refusals={0} />,
      {
        wrapper: ({ children }) => (
          <DisplayProvider
            source={{ displays: undefined, onDisplays: () => () => undefined }}
          >
            {children}
          </DisplayProvider>
        ),
      },
    );

    const veils = document.querySelectorAll<HTMLElement>("[data-veil]");
    expect(veils.length).toBe(1);
    expect(veils[0]?.getAttribute("style")).toBeNull();
  });

  describe("the keyboard", () => {
    it("is put in the field as the desk shuts", () => {
      // On the transition, not on mount: the sheet is always mounted.
      const { says } = lock(false);

      says({ locked: true });

      expect(document.activeElement).toBe(screen.getByLabelText("Passphrase"));
    });

    it("cannot be taken out of the field while the desk is shut", async () => {
      // The field is the only input on a locked desktop, so a key elsewhere
      // would be lost.
      const { user } = lock();

      await user.tab();
      expect(document.activeElement).toBe(screen.getByLabelText("Passphrase"));

      await user.click(screen.getByRole("button", { name: "Unlock" }));
      expect(document.activeElement).toBe(screen.getByLabelText("Passphrase"));
    });
  });

  it("offers what was typed and never decides anything itself", async () => {
    // The component only submits the passphrase. The compositor's unlock clears
    // it; clearing on submit would let Enter alone appear to unlock.
    const { offered, user } = lock();

    await user.type(screen.getByLabelText("Passphrase"), "open sesame{Enter}");

    expect(offered).toStrictEqual(["open sesame"]);
    expect(screen.getByLabelText("Passphrase")).toBeTruthy();
  });

  it("keeps the passphrase out of the document", () => {
    // The passphrase must not be readable on screen.
    lock();

    expect(screen.getByLabelText("Passphrase").getAttribute("type")).toBe(
      "password",
    );
  });

  describe("a passphrase being checked", () => {
    it("stays in the field, and is not offered twice", async () => {
      // Kept until the compositor answers, so the user can see what they sent.
      const { field, offered, says, user } = lock();
      await user.type(field(), "open sesame{Enter}");

      says({ checking: true });
      await user.type(field(), "{Enter}");

      expect(field().value).toBe("open sesame");
      expect(offered).toStrictEqual(["open sesame"]);
    });

    it("is cleared once it is refused, and the refusal said", async () => {
      // Only a refusal clears the field, so a wrong guess is not left on
      // screen.
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
      // The sheet stays mounted to fade out, so the passphrase must not stay in
      // it.
      const { field, says, user } = lock();
      await user.type(field(), "open sesame{Enter}");

      says({ locked: false });

      expect(field().value).toBe("");
    });
  });
});
