import { describe, expect, it } from "bun:test";
import { sharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import type { Keymaps } from "@domicile-desktop/sdk/keymap-choice";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Keymap } from "./Keymap";

/** A test-controlled keymap list. */
const heldKeymaps = () => {
  const listeners: ((keymaps: Keymaps) => void)[] = [];
  return {
    keymaps: sharedWatch((onKeymaps: (keymaps: Keymaps) => void) => {
      listeners.push(onKeymaps);
      return () => undefined;
    }),
    report: (keymaps: Keymaps) => {
      act(() => {
        for (const onKeymaps of listeners) {
          onKeymaps(keymaps);
        }
      });
    },
  };
};

const DVP_AND_US = {
  keymaps: [
    { description: "English (programmer Dvorak)", name: "dvp" },
    { description: "English (US)", name: "us" },
  ],
};

/** The item over `held`, and the names it selected. */
const shown = (
  held: ReturnType<typeof heldKeymaps>,
  hideDefault = false,
): string[] => {
  const selected: string[] = [];
  render(
    <Keymap
      hideDefault={hideDefault}
      keymaps={held.keymaps}
      onSelect={(name) => {
        selected.push(name);
      }}
    />,
  );
  return selected;
};

describe("Keymap", () => {
  it("shows nothing until the keymaps are known", () => {
    shown(heldKeymaps());

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows nothing for a keyboard with one keymap", () => {
    const held = heldKeymaps();
    shown(held);

    held.report({
      active: "us",
      keymaps: [{ description: undefined, name: "us" }],
    });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("names the keymap the desktop types on", () => {
    const held = heldKeymaps();
    shown(held);

    held.report({ ...DVP_AND_US, active: "us" });

    expect(
      screen.getByRole("button", { name: "Keymap: us" }),
    ).toHaveTextContent("us");
  });

  it("hides on the first keymap when asked to, and shows on any other", () => {
    const held = heldKeymaps();
    shown(held, true);

    held.report({ ...DVP_AND_US, active: "dvp" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    held.report({ ...DVP_AND_US, active: "us" });
    expect(screen.getByRole("button", { name: "Keymap: us" })).toBeVisible();
  });

  it("lists every keymap with xkb's name for it, the active one picked", async () => {
    const held = heldKeymaps();
    shown(held);
    held.report({ ...DVP_AND_US, active: "dvp" });

    await userEvent.click(screen.getByRole("button", { name: "Keymap: dvp" }));

    const dvp = screen.getByRole("radio", { name: /^dvp/ });
    expect(dvp).toBeChecked();
    expect(dvp).toHaveTextContent("English (programmer Dvorak)");
    expect(screen.getByRole("radio", { name: /^us/ })).not.toBeChecked();
  });

  it("selects the keymap picked, and closes", async () => {
    const held = heldKeymaps();
    const selected = shown(held);
    held.report({ ...DVP_AND_US, active: "dvp" });

    await userEvent.click(screen.getByRole("button", { name: "Keymap: dvp" }));
    await userEvent.click(screen.getByRole("radio", { name: /^us/ }));

    expect(selected).toStrictEqual(["us"]);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});
