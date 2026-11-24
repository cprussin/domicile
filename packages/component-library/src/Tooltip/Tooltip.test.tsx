import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { startsAt } from "../__test__/starts-at";
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

    describe("motion", () => {
      loadEmittedStylesheet(
        document,
        new URL("../../styled-system/styles.css", import.meta.url),
      );

      it("fades in rising off its anchor", async () => {
        render(
          <Tooltip content="Full title" open trigger={<Button>Tab</Button>} />,
        );
        expect(startsAt(await screen.findByRole("tooltip"))).toEqual({
          bottom: "translateY(calc(-1 * 0.125rem))",
          top: "translateY(0.125rem)",
        });
      });
    });

    it("says when it is drawn over a photograph, so the stylesheet can glass it", async () => {
      render(
        <Tooltip
          content="Full title"
          open
          tone="overPhoto"
          trigger={<Button>Tab</Button>}
        />,
      );
      expect(await screen.findByRole("tooltip")).toHaveAttribute(
        "data-tone",
        "overPhoto",
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
