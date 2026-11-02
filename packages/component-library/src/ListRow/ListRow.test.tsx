import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { List, ListRow } from "./ListRow";

describe(ListRow, () => {
  describe("rendering", () => {
    it("is an item of its list, with its label, detail and end", () => {
      render(
        <List label="Devices">
          <ListRow
            detail="Battery 80%"
            end={<button type="button">Disconnect</button>}
            label="WH-1000XM4"
          />
        </List>,
      );
      const row = screen.getByRole("listitem");
      expect(screen.getByRole("list", { name: "Devices" })).toContainElement(
        row,
      );
      expect(row).toHaveTextContent("WH-1000XM4");
      expect(row).toHaveTextContent("Battery 80%");
      expect(row).toContainElement(
        screen.getByRole("button", { name: "Disconnect" }),
      );
    });

    it("says when its end shows only on hover, so the stylesheet can hide it", () => {
      render(
        <List>
          <ListRow
            end={<button type="button">Open</button>}
            endOnHover
            label="report.pdf"
          />
        </List>,
      );
      expect(screen.getByRole("listitem")).toHaveAttribute("data-end-on-hover");
    });

    it("draws what goes under it, such as a field, in the item", () => {
      render(
        <List>
          <ListRow label="Office">
            <input aria-label="Passphrase" />
          </ListRow>
        </List>,
      );
      expect(screen.getByRole("listitem")).toContainElement(
        screen.getByRole("textbox", { name: "Passphrase" }),
      );
    });
  });

  describe("interactions", () => {
    it("folds what goes under it behind a toggle when given one", async () => {
      render(
        <List>
          <ListRow disclosure="Details" label="Centar">
            <span>10.42.0.17</span>
          </ListRow>
        </List>,
      );
      const toggle = screen.getByRole("button", { name: "Details" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("10.42.0.17")).toBeNull();

      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("10.42.0.17")).toBeVisible();
    });

    it("is one button when it can be pressed, named for assistive tech", async () => {
      const pressed = new Promise((resolve) => {
        render(
          <List>
            <ListRow
              end="3"
              label="PrussinNet"
              name="PrussinNet: 3 unread"
              onPress={() => {
                resolve(true);
              }}
            />
          </List>,
        );
      });
      await userEvent.click(
        screen.getByRole("button", { name: "PrussinNet: 3 unread" }),
      );
      expect(await pressed).toBe(true);
    });

    it("says it is busy while its request is out", () => {
      render(
        <List>
          <ListRow busy label="Office" onPress={() => undefined} />
        </List>,
      );
      expect(screen.getByRole("button", { name: "Office" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });
  });

  describe("motion", () => {
    it("is still its list's item, with its label, when it can move", () => {
      render(
        <List>
          <ListRow
            label="invoice.pdf"
            motion={{
              arriving: true,
              leaving: undefined,
              onLeft: () => undefined,
            }}
            surface="filled"
          />
        </List>,
      );
      const row = screen.getByRole("listitem");
      expect(row).toHaveTextContent("invoice.pdf");
      expect(row).toHaveAttribute("data-arriving");
      expect(row).toHaveAttribute("data-surface", "filled");
    });

    it("leaves out of reach", () => {
      render(
        <List>
          <ListRow
            end={<button type="button">Open</button>}
            label="invoice.pdf"
            motion={{ arriving: false, leaving: 0, onLeft: () => undefined }}
          />
        </List>,
      );
      expect(document.querySelector("li[data-leaving]")).toHaveTextContent(
        "invoice.pdf",
      );
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
