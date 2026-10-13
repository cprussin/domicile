import { describe, expect, it } from "bun:test";
import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { render, screen } from "@testing-library/react";
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
