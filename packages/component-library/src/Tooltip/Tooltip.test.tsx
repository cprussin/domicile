import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";

import { Tooltip } from "./Tooltip";

describe(Tooltip, () => {
  describe("rendering", () => {
    it("renders its trigger and not its content while closed", () => {
      render(<Tooltip content="Full title" trigger={<Button>Tab</Button>} />);
      expect(screen.getByRole("button", { name: "Tab" })).toBeInTheDocument();
      expect(screen.queryByText("Full title")).not.toBeInTheDocument();
    });

    it("renders its content while open", async () => {
      render(
        <Tooltip content="Full title" open trigger={<Button>Tab</Button>} />,
      );
      // Found by polling, so the positioner's first placement lands in `act`.
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "Full title",
      );
    });
  });

  describe("interactions", () => {
    it("opens when the pointer rests on its trigger", async () => {
      render(
        <Tooltip
          content="Full title"
          delay={0}
          trigger={<Button>Tab</Button>}
        />,
      );
      await userEvent.hover(screen.getByRole("button", { name: "Tab" }));
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "Full title",
      );
    });
  });
});
