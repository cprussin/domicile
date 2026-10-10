import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import { StripButtons } from "./StripButtons";

const nothing = () => undefined;

const buttonsProps = {
  depth: 0,
  floating: false,
  fullscreen: false,
  onFloat: nothing,
  onFullscreen: nothing,
  rect: { height: 30, width: 400, x: 200, y: 0 },
} as const;

describe("StripButtons", () => {
  it("floats the group", async () => {
    await new Promise<void>((resolve) => {
      const { getByRole } = render(
        <StripButtons {...buttonsProps} onFloat={resolve} />,
      );
      fireEvent.click(getByRole("button", { name: "Float group" }));
    });
  });

  it("fills the screen with the group", async () => {
    await new Promise<void>((resolve) => {
      const { getByRole } = render(
        <StripButtons {...buttonsProps} onFullscreen={resolve} />,
      );
      fireEvent.click(getByRole("button", { name: "Maximize group" }));
    });
  });

  it("offers to tile a floating group and give a fullscreen one back", () => {
    const { queryByRole } = render(
      <StripButtons {...buttonsProps} floating fullscreen />,
    );

    expect(queryByRole("button", { name: "Tile group" })).not.toBeNull();
    expect(queryByRole("button", { name: "Restore group" })).not.toBeNull();
  });
});
