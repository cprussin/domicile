import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AccordionItem } from "./Accordion";
import { Accordion } from "./Accordion";

const items: readonly AccordionItem[] = [
  { content: <p>the outputs</p>, label: "Outputs", value: "outputs" },
  { content: <p>the inputs</p>, label: "Inputs", value: "inputs" },
];

describe(Accordion, () => {
  describe("rendering", () => {
    it("is a button per section, every one shut", () => {
      render(<Accordion items={items} />);

      expect(screen.getByRole("button", { name: "Outputs" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.queryByText("the outputs")).not.toBeInTheDocument();
    });

    it("opens the sections it is told to", () => {
      render(<Accordion defaultValue={["inputs"]} items={items} />);

      expect(screen.getByText("the inputs")).toBeInTheDocument();
    });
  });

  describe("interactions", () => {
    it("opens a section when its button is pressed", async () => {
      render(<Accordion items={items} />);

      await userEvent.click(screen.getByRole("button", { name: "Outputs" }));

      expect(screen.getByRole("button", { name: "Outputs" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByText("the outputs")).toBeInTheDocument();
    });

    it("keeps one section open at a time unless told otherwise", async () => {
      render(<Accordion items={items} />);

      await userEvent.click(screen.getByRole("button", { name: "Outputs" }));
      await userEvent.click(screen.getByRole("button", { name: "Inputs" }));

      expect(screen.getByRole("button", { name: "Outputs" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    });
  });
});
