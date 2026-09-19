import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";

import { Popover } from "./Popover";

describe(Popover, () => {
  describe("rendering", () => {
    it("does not render the body when closed", () => {
      render(
        <Popover open={false} title="Connection">
          Body
        </Popover>,
      );
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });

    it("renders the title and the body when open", () => {
      render(
        <Popover open title="Connection">
          Body
        </Popover>,
      );
      expect(screen.getByText("Connection")).toBeInTheDocument();
      expect(screen.getByText("Body")).toBeInTheDocument();
    });

    it("renders a body with no title", () => {
      render(
        <Popover open title={undefined}>
          Body
        </Popover>,
      );
      expect(screen.getByText("Body")).toBeInTheDocument();
    });

    it("renders the trigger and stays closed until it is pressed", () => {
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          Body
        </Popover>,
      );
      expect(screen.getByRole("button", { name: "Details" })).toBeVisible();
      expect(screen.queryByText("Body")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("opens when its trigger is pressed", async () => {
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          Body
        </Popover>,
      );

      await userEvent.click(screen.getByRole("button", { name: "Details" }));

      expect(screen.getByText("Body")).toBeInTheDocument();
    });
  });
});
