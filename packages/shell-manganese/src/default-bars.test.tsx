import { describe, expect, it } from "bun:test";
import { Cast } from "@domicile-desktop/manganese-bar-module-cast";
import { Keymap } from "@domicile-desktop/manganese-bar-module-keymap";
import { Notifications } from "@domicile-desktop/manganese-bar-module-notifications";
import { Sharing } from "@domicile-desktop/manganese-bar-module-sharing";
import { QuickSettings } from "@domicile-desktop/manganese-quick-settings";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { DEFAULT_BAR, LOCK_BAR } from "./default-bars";

/** The component each item renders. */
const types = (items: readonly ReactNode[]) =>
  items.map((item) => (isValidElement(item) ? item.type : item));

describe("DEFAULT_BAR", () => {
  it("is sharing, casting, the keymap, quick settings and the bell on the right", () => {
    expect(types(DEFAULT_BAR.right)).toEqual([
      Sharing,
      Cast,
      Keymap,
      QuickSettings,
      Notifications,
    ]);
  });
});

describe("LOCK_BAR", () => {
  it("is the keymap and quick settings", () => {
    expect(
      types([...LOCK_BAR.left, ...LOCK_BAR.center, ...LOCK_BAR.right]),
    ).toEqual([Keymap, QuickSettings]);
  });
});
