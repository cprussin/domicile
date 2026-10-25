import { describe, expect, it } from "bun:test";
import { Battery } from "@domicile-desktop/manganese-bar-module-battery";
import { Bluetooth } from "@domicile-desktop/manganese-bar-module-bluetooth";
import { Brightness } from "@domicile-desktop/manganese-bar-module-brightness";
import { IdleInhibitor } from "@domicile-desktop/manganese-bar-module-idle-inhibitor";
import { Keymap } from "@domicile-desktop/manganese-bar-module-keymap";
import { ThemeSwitch } from "@domicile-desktop/manganese-bar-module-theme-switch";
import { Volume } from "@domicile-desktop/manganese-bar-module-volume";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { DEFAULT_BAR, LOCK_BAR } from "./default-bars";

/** The component each item renders. */
const types = (items: readonly ReactNode[]) =>
  items.map((item) => (isValidElement(item) ? item.type : item));

describe("DEFAULT_BAR", () => {
  it("puts the idle inhibitor between the theme toggle and brightness", () => {
    const right = types(DEFAULT_BAR.right);

    expect(
      right.slice(right.indexOf(ThemeSwitch), right.indexOf(Brightness) + 1),
    ).toEqual([ThemeSwitch, IdleInhibitor, Brightness]);
  });

  it("puts the keymap left of the theme toggle", () => {
    const right = types(DEFAULT_BAR.right);

    expect(right[right.indexOf(ThemeSwitch) - 1]).toBe(Keymap);
  });
});

describe("LOCK_BAR", () => {
  it("is the keymap, brightness, volume, Bluetooth and battery, as the desktop's bar has them", () => {
    expect(
      types([...LOCK_BAR.left, ...LOCK_BAR.center, ...LOCK_BAR.right]),
    ).toEqual([Keymap, Brightness, Volume, Bluetooth, Battery]);
  });
});
