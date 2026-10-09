import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContextMenu } from "./ContextMenu";

describe(ContextMenu, () => {
  describe("rendering", () => {
    it("draws nothing while closed", () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="Page" open={false}>
          <ContextMenu.Item>Reload</ContextMenu.Item>
        </ContextMenu>,
      );
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("draws a named menu of its items while open", async () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="Page" open>
          <ContextMenu.Item>Back</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item>Reload</ContextMenu.Item>
        </ContextMenu>,
      );
      expect(
        await screen.findByRole("menu", { name: "Page" }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent),
      ).toEqual(["Back", "Reload"]);
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });

    it("shows an item's shortcut beside it", async () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="Page" open>
          <ContextMenu.Item shortcut="Ctrl+Shift+I">Inspect</ContextMenu.Item>
        </ContextMenu>,
      );
      expect(
        await screen.findByRole("menuitem", { name: /Inspect/ }),
      ).toHaveTextContent("Ctrl+Shift+I");
    });

    it("marks an item that cannot be chosen", async () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="Page" open>
          <ContextMenu.Item disabled>Forward</ContextMenu.Item>
        </ContextMenu>,
      );
      expect(
        await screen.findByRole("menuitem", { name: "Forward" }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    it("marks whether a check box item is checked", async () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="Sound" open>
          <ContextMenu.CheckboxItem checked>Mute</ContextMenu.CheckboxItem>
          <ContextMenu.CheckboxItem checked={false}>
            Boost
          </ContextMenu.CheckboxItem>
        </ContextMenu>,
      );
      expect(
        await screen.findByRole("menuitemcheckbox", { name: "Mute" }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByRole("menuitemcheckbox", { name: "Boost" }),
      ).toHaveAttribute("aria-checked", "false");
    });

    it("marks the chosen radio item", async () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="Quality" open>
          <ContextMenu.RadioGroup value="low">
            <ContextMenu.RadioItem value="high">High</ContextMenu.RadioItem>
            <ContextMenu.RadioItem value="low">Low</ContextMenu.RadioItem>
          </ContextMenu.RadioGroup>
        </ContextMenu>,
      );
      expect(
        await screen.findByRole("menuitemradio", { name: "Low" }),
      ).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByRole("menuitemradio", { name: "High" }),
      ).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("interactions", () => {
    it("runs the item pressed and asks to close", async () => {
      const user = userEvent.setup();
      const chosen = Promise.withResolvers<string>();
      const closed = Promise.withResolvers<boolean>();
      render(
        <ContextMenu
          at={{ x: 10, y: 20 }}
          label="Page"
          onOpenChange={closed.resolve}
          open
        >
          <ContextMenu.Item
            onClick={() => {
              chosen.resolve("reload");
            }}
          >
            Reload
          </ContextMenu.Item>
        </ContextMenu>,
      );
      await user.click(await screen.findByRole("menuitem", { name: "Reload" }));
      expect(await chosen.promise).toBe("reload");
      expect(await closed.promise).toBe(false);
    });

    it("opens a submenu from its item, keeping the menu open", async () => {
      const user = userEvent.setup();
      const opened = Promise.withResolvers<boolean>();
      render(
        <ContextMenu at={{ x: 10, y: 20 }} defaultOpen label="Player">
          <ContextMenu.Submenu label="Quality" onOpenChange={opened.resolve}>
            <ContextMenu.Item>High</ContextMenu.Item>
          </ContextMenu.Submenu>
        </ContextMenu>,
      );
      await user.click(
        await screen.findByRole("menuitem", { name: "Quality" }),
      );
      expect(await opened.promise).toBe(true);
      expect(
        await screen.findByRole("menuitem", { name: "High" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("menu", { name: "Player" })).toBeInTheDocument();
    });

    it("asks to close on Escape", async () => {
      const user = userEvent.setup();
      const closed = Promise.withResolvers<boolean>();
      render(
        <ContextMenu
          at={{ x: 10, y: 20 }}
          label="Page"
          onOpenChange={closed.resolve}
          open
        >
          <ContextMenu.Item>Reload</ContextMenu.Item>
        </ContextMenu>,
      );
      await screen.findByRole("menu", { name: "Page" });
      await user.keyboard("{Escape}");
      expect(await closed.promise).toBe(false);
    });
  });
});
