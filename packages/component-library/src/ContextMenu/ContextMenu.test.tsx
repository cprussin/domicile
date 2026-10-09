import { describe, expect, it } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    it("draws an item's icon before its label, outside its name", async () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="Sound" open>
          <ContextMenu.Item icon={<img alt="" src="data:image/png;base64," />}>
            Mute
          </ContextMenu.Item>
        </ContextMenu>,
      );
      const item = await screen.findByRole("menuitem", { name: "Mute" });
      expect(within(item).getByRole("presentation")).toHaveAttribute(
        "src",
        "data:image/png;base64,",
      );
    });

    it("underlines each kind of item's mnemonic in its plain label", async () => {
      render(
        <ContextMenu at={{ x: 10, y: 20 }} label="File" open>
          <ContextMenu.Item mnemonic={5}>Save As</ContextMenu.Item>
          <ContextMenu.CheckboxItem checked mnemonic={0}>
            Autosave
          </ContextMenu.CheckboxItem>
          <ContextMenu.RadioGroup value="low">
            <ContextMenu.RadioItem mnemonic={0} value="low">
              Low
            </ContextMenu.RadioItem>
          </ContextMenu.RadioGroup>
          <ContextMenu.Submenu label="Recent" mnemonic={2}>
            <ContextMenu.Item>notes.txt</ContextMenu.Item>
          </ContextMenu.Submenu>
        </ContextMenu>,
      );
      await screen.findByRole("menu", { name: "File" });
      expect(
        ["menuitem", "menuitemcheckbox", "menuitemradio"].flatMap((role) =>
          screen.getAllByRole(role).map(underlined),
        ),
      ).toStrictEqual([
        ["Save As", "A"],
        ["Recent", "c"],
        ["Autosave", "A"],
        ["Low", "L"],
      ]);
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

    describe("mnemonics", () => {
      it("chooses the first enabled item whose mnemonic is pressed, in either case", async () => {
        const user = userEvent.setup();
        const chosen = Promise.withResolvers<string>();
        render(
          <ContextMenu at={{ x: 10, y: 20 }} label="Page" open>
            <ContextMenu.Item disabled mnemonic={0}>
              Back
            </ContextMenu.Item>
            <ContextMenu.Item
              mnemonic={0}
              onClick={() => {
                chosen.resolve("bookmark");
              }}
            >
              Bookmark
            </ContextMenu.Item>
          </ContextMenu>,
        );
        await screen.findByRole("menu", { name: "Page" });
        await user.keyboard("B");
        expect(await chosen.promise).toBe("bookmark");
      });

      it("chooses check box and radio items by their mnemonics", async () => {
        const user = userEvent.setup();
        const checked = Promise.withResolvers<boolean>();
        const picked = Promise.withResolvers<unknown>();
        render(
          <ContextMenu at={{ x: 10, y: 20 }} label="Sound" open>
            <ContextMenu.CheckboxItem
              checked={false}
              mnemonic={0}
              onCheckedChange={checked.resolve}
            >
              Mute
            </ContextMenu.CheckboxItem>
            <ContextMenu.RadioGroup onValueChange={picked.resolve} value="high">
              <ContextMenu.RadioItem mnemonic={0} value="high">
                High
              </ContextMenu.RadioItem>
              <ContextMenu.RadioItem mnemonic={0} value="low">
                Low
              </ContextMenu.RadioItem>
            </ContextMenu.RadioGroup>
          </ContextMenu>,
        );
        await screen.findByRole("menu", { name: "Sound" });
        await user.keyboard("ml");
        expect(await checked.promise).toBe(true);
        expect(await picked.promise).toBe("low");
      });

      it("opens a submenu by its mnemonic, whose own mnemonics then apply", async () => {
        const user = userEvent.setup();
        const chosen: string[] = [];
        render(
          <ContextMenu at={{ x: 10, y: 20 }} label="Player" open>
            <ContextMenu.Submenu label="Quality" mnemonic={0}>
              <ContextMenu.Item
                mnemonic={0}
                onClick={() => {
                  chosen.push("high");
                }}
              >
                High
              </ContextMenu.Item>
            </ContextMenu.Submenu>
            <ContextMenu.Item
              mnemonic={0}
              onClick={() => {
                chosen.push("help");
              }}
            >
              Help
            </ContextMenu.Item>
          </ContextMenu>,
        );
        await screen.findByRole("menu", { name: "Player" });
        await user.keyboard("q");
        // The rest of "High", after its underlined letter.
        await screen.findByText("igh");
        await user.keyboard("h");
        await waitFor(() => {
          expect(chosen).toStrictEqual(["high"]);
        });
      });

      it("leaves a letter held with a modifier alone", async () => {
        const user = userEvent.setup();
        const chosen: string[] = [];
        render(
          <ContextMenu at={{ x: 10, y: 20 }} label="Page" open>
            <ContextMenu.Item
              mnemonic={0}
              onClick={() => {
                chosen.push("reload");
              }}
            >
              Reload
            </ContextMenu.Item>
          </ContextMenu>,
        );
        await screen.findByRole("menu", { name: "Page" });
        await user.keyboard(
          "{Control>}r{/Control}{Alt>}r{/Alt}{Meta>}r{/Meta}",
        );
        expect(chosen).toStrictEqual([]);
      });

      it("leaves other letters to type-ahead, which only highlights", async () => {
        const user = userEvent.setup();
        render(
          <ContextMenu at={{ x: 10, y: 20 }} label="Page" open>
            <ContextMenu.Item mnemonic={0}>Reload</ContextMenu.Item>
            <ContextMenu.Item>Bookmark</ContextMenu.Item>
          </ContextMenu>,
        );
        await screen.findByRole("menu", { name: "Page" });
        await user.keyboard("b");
        expect(
          screen.getByRole("menuitem", { name: "Bookmark" }),
        ).toHaveAttribute("data-highlighted", "");
        expect(screen.getByRole("menu", { name: "Page" })).toBeInTheDocument();
      });
    });
  });
});

/**
 * An item's label and its one-letter element, which draws the underline. The
 * label is its accessible name in a browser; happy-dom puts spaces around the
 * letter's element.
 */
const underlined = (item: HTMLElement) => [
  item.textContent,
  within(item).getByText(/^.$/).textContent,
];
