import { describe, expect, it } from "bun:test";
import {
  act,
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";
import { Select } from "../Select/Select";

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

    it("says when it is drawn flush, so the stylesheet can drop its padding", () => {
      render(
        <Popover flush open>
          Body
        </Popover>,
      );
      expect(screen.getByRole("dialog")).toHaveAttribute("data-flush");
    });

    it("says when it is drawn over a photograph, so the stylesheet can glass it", () => {
      render(
        <Popover open tone="overPhoto">
          Body
        </Popover>,
      );
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "data-tone",
        "overPhoto",
      );
    });

    it("is padded unless it is drawn flush", () => {
      render(<Popover open>Body</Popover>);
      expect(screen.getByRole("dialog")).not.toHaveAttribute("data-flush");
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

    it("closes when focus moves to something outside it", async () => {
      render(
        <>
          <Popover title="Connection" trigger={<Button>Details</Button>}>
            Body
          </Popover>
          <button type="button">Elsewhere</button>
        </>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Details" }));

      act(() => {
        screen.getByRole("button", { name: "Elsewhere" }).focus();
      });

      await waitForElementToBeRemoved(() => screen.queryByText("Body"));
    });

    it("stays open when focus moves within it", async () => {
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          <button type="button">Inside</button>
        </Popover>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Details" }));

      act(() => {
        screen.getByRole("button", { name: "Inside" }).focus();
      });

      expect(screen.getByRole("button", { name: "Inside" })).toBeVisible();
    });

    it("stays open while a select inside it is used, though its list is drawn elsewhere", async () => {
      const user = userEvent.setup();
      render(
        <Popover title="Connection" trigger={<Button>Details</Button>}>
          <Select
            aria-label="Port"
            defaultValue="speakers"
            options={[
              { label: "Speakers", value: "speakers" },
              { label: "Headphones", value: "headphones" },
            ]}
          />
        </Popover>,
      );
      await user.click(screen.getByRole("button", { name: "Details" }));

      await user.click(screen.getByRole("combobox", { name: "Port" }));
      await user.click(screen.getByRole("option", { name: "Headphones" }));

      expect(screen.getByRole("combobox", { name: "Port" })).toHaveTextContent(
        "Headphones",
      );
    });
  });
});
