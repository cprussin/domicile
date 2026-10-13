import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { isValidElement } from "react";

import { useBar } from "../top-bar/bar-context";
import {
  BarBattery,
  BarBluetooth,
  BarBrightness,
  BarVolume,
} from "../top-bar/bar-items";
import { LOCK_BAR } from "../top-bar/layout";
import { LockBar } from "./LockBar";

/** Says what the bar it is on tells its items. */
const ReadsBar = () => {
  const { locked, screen } = useBar();
  return <span>{`${screen} ${locked ? "locked" : "open"}`}</span>;
};

describe("LockBar", () => {
  it("tells its items the desktop is locked, and which screen they are on", () => {
    render(
      <LockBar
        layout={{ center: [], left: [<ReadsBar key="reads" />], right: [] }}
        screen="left"
      />,
    );

    expect(screen.getByText("left locked")).toBeInTheDocument();
  });
});

describe("LOCK_BAR", () => {
  it("is brightness, volume, Bluetooth and battery, as the desktop's bar has them", () => {
    expect(
      [...LOCK_BAR.left, ...LOCK_BAR.center, ...LOCK_BAR.right].map((item) =>
        isValidElement(item) ? item.type : item,
      ),
    ).toEqual([BarBrightness, BarVolume, BarBluetooth, BarBattery]);
  });
});
