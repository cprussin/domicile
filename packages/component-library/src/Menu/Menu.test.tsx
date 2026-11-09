import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button/Button";
import { Menu } from "./Menu";

const menu = (chose: string[] = []) =>
  render(
    <Menu trigger={<Button>Pause</Button>}>
      <Menu.Item
        onClick={() => {
          chose.push("hour");
        }}
      >
        For 1 hour
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item>Until I resume</Menu.Item>
    </Menu>,
  );

describe(Menu, () => {
  describe("rendering", () => {
    it("draws only its trigger while closed", () => {
      menu();

      expect(screen.getByRole("button", { name: "Pause" })).toHaveAttribute(
        "aria-haspopup",
        "menu",
      );
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("opens a menu of its items from its trigger, named by it", async () => {
      menu();

      await userEvent.click(screen.getByRole("button", { name: "Pause" }));

      expect(
        await screen.findByRole("menu", { name: "Pause" }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent),
      ).toEqual(["For 1 hour", "Until I resume"]);
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });

    it("chooses an item", async () => {
      const chose: string[] = [];
      menu(chose);

      await userEvent.click(screen.getByRole("button", { name: "Pause" }));
      await userEvent.click(
        await screen.findByRole("menuitem", { name: "For 1 hour" }),
      );

      expect(chose).toEqual(["hour"]);
    });
  });
});
