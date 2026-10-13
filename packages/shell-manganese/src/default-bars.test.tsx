import { describe, expect, it } from "bun:test";
import { Battery } from "@domicile-desktop/manganese-bar-module-battery";
import { Bluetooth } from "@domicile-desktop/manganese-bar-module-bluetooth";
import { Brightness } from "@domicile-desktop/manganese-bar-module-brightness";
import { Volume } from "@domicile-desktop/manganese-bar-module-volume";
import { isValidElement } from "react";
import { LOCK_BAR } from "./default-bars";

describe("LOCK_BAR", () => {
  it("is brightness, volume, Bluetooth and battery, as the desktop's bar has them", () => {
    expect(
      [...LOCK_BAR.left, ...LOCK_BAR.center, ...LOCK_BAR.right].map((item) =>
        isValidElement(item) ? item.type : item,
      ),
    ).toEqual([Brightness, Volume, Bluetooth, Battery]);
  });
});
