import { Button } from "@domicile/component-library/Button";
import { Field } from "@domicile/component-library/Field";
import { Input } from "@domicile/component-library/Input";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { useEffect, useRef, useState } from "react";

import { css } from "../../styled-system/css";
import { vstack } from "../../styled-system/patterns";

/** What the field is called, which is also how a test finds it. */
const PASSPHRASE = "Passphrase";

type Props = {
  /** Whether the compositor says this desk is locked. */
  locked: boolean;
  /**
   * Offer this passphrase to the compositor.
   *
   * Nothing comes back. What opens the desk is the compositor agreeing, and what
   * says so is the `locked` message that turns {@link locked} off.
   */
  onUnlock: (passphrase: string) => void;
};

/**
 * The lock screen: a sheet over the whole desktop with a passphrase on it.
 *
 * **IT IS NOT WHAT LOCKS THE DESK, AND IT IS NOT WHAT UNLOCKS IT EITHER.** The
 * compositor holds the lock — while it is shut, nothing this page forwards is
 * put into the Wayland seat, so no client on this desk sees a keystroke or a
 * click. This component draws over a desktop that has already stopped listening
 * and collects what somebody types; the compositor decides whether that opens
 * anything. So there is no local state here for a click to flip, which is what
 * makes the lock survive a reload of this page.
 *
 * A picture of the same thing would be indistinguishable from this one, and that
 * is fine: what the picture would be missing is not on the page at all.
 *
 * **Unmounted rather than hidden while the desk is open.** A sheet over the
 * whole desktop that was merely transparent would take every click on the desk
 * with it, and the desk this shell draws is the one somebody is working at.
 *
 * **Nothing dismisses it.** Not Escape, not a click beside it, not submitting:
 * `ModalDialog` is the wrong primitive here for exactly that reason — every one
 * of its ways out is a way past this. The only thing that takes this off the
 * screen is the desk opening.
 */
export const Lock = ({ locked, onUnlock }: Props) => {
  const [typed, setTyped] = useState("");
  const field = useRef<HTMLInputElement>(null);

  // The sheet is up because the desk shut, so the keyboard belongs in the field:
  // a lock screen where the first thing typed goes nowhere is one somebody types
  // their passphrase into twice. Taken on mount, which is the moment the desk
  // shut — this component is not on the page at any other time.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return locked ? (
    <div className={sheetStyles}>
      <form
        className={panelStyles}
        onSubmit={(event) => {
          // The page is the desktop and has nowhere to navigate to; a submit
          // that reloaded it would throw away the connection this shell is drawn
          // over.
          event.preventDefault();
          onUnlock(typed);
          // Cleared whatever the answer is, because there is no answer to wait
          // for: a refused passphrase produces no message at all, so a field
          // left full is a person retyping over their own first guess — and one
          // somebody walked away from is a guess left on the screen of a locked
          // desk.
          setTyped("");
        }}
      >
        {/*
          Decoration, and the only thing on this panel that is: a person looking
          at their own locked desk knows what it is, and the field's label says
          so to anybody reading the page. Hidden explicitly, because Phosphor
          hides nothing on its own — an icon it is given no label for is an
          unlabeled `<svg>` rather than one marked decorative.
        */}
        <div aria-hidden="true" className={markStyles}>
          <LockIcon size={32} />
        </div>
        <Field label={PASSPHRASE}>
          <Input
            name="passphrase"
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            ref={field}
            // The one attribute between a lock screen and a billboard: the
            // screen of a locked desk is the screen somebody else is standing
            // in front of.
            type="password"
            value={typed}
          />
        </Field>
        <Button type="submit">Unlock</Button>
      </form>
    </div>
  ) : undefined;
};

// Over everything, including the panels: the launcher and the clipboard are
// `modal`, and a lock screen underneath an open launcher would be a locked desk
// somebody could still type a path into. `lock` is the preset's token for that
// one layer. One sheet for the whole desktop rather than one per screen, for the
// wallpaper's reason — the page spans every display, so `position: fixed` is the
// desktop.
const sheetStyles = css({
  alignItems: "center",
  backdropFilter: "blur(16px)",
  backgroundColor: "color-mix(in oklab, {colors.background} 92%, transparent)",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  position: "fixed",
  zIndex: "lock",
});

const panelStyles = vstack({
  alignItems: "stretch",
  backgroundColor: "card",
  borderColor: "border",
  borderRadius: "lg",
  borderWidth: "1px",
  gap: 4,
  minInlineSize: 72,
  padding: 8,
});

// The icon takes its color from here rather than from a prop of its own, which
// is the convention every other icon in this shell follows.
const markStyles = css({
  alignSelf: "center",
  color: "muted",
});
