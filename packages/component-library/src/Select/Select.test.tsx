import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { SelectOption } from "./Select";
import { Select } from "./Select";

const OPTIONS: readonly SelectOption<string>[] = [
  { label: "Sans-serif", value: "sans" },
  { label: "Serif", value: "serif" },
  { label: "Monospace", value: "mono" },
  { disabled: true, label: "Cursive", value: "cursive" },
];

describe(Select, () => {
  describe("trigger", () => {
    it("renders a button trigger with the placeholder when no value is selected", () => {
      render(
        <Select
          aria-label="Font"
          options={OPTIONS}
          placeholder="Choose a font…"
        />,
      );
      const trigger = screen.getByRole("combobox", { name: "Font" });
      expect(trigger).toBeInTheDocument();
      expect(trigger.textContent).toContain("Choose a font…");
    });

    it("renders the matching option's label when a defaultValue is provided", () => {
      render(
        <Select
          aria-label="Font"
          defaultValue="serif"
          options={OPTIONS}
          placeholder="Choose a font…"
        />,
      );
      // The trigger contains the value span AND the caret icon; assert on
      // the substring so the caret's text representation doesn't poison the
      // equality check.
      expect(
        screen.getByRole("combobox", { name: "Font" }).textContent,
      ).toContain("Serif");
    });

    it("respects the disabled prop", () => {
      render(<Select aria-label="Font" disabled options={OPTIONS} />);
      expect(screen.getByRole("combobox", { name: "Font" })).toBeDisabled();
    });

    it("applies the numeric width prop as an inline inline-size style on the wrapper", () => {
      render(<Select aria-label="Font" options={OPTIONS} width={48} />);
      const trigger = screen.getByRole("combobox", { name: "Font" });
      const wrapper = trigger.parentElement;
      expect(wrapper?.style.inlineSize).toBe("12rem");
    });
  });

  describe("opening + selecting", () => {
    it("opens the popup and lists every option on trigger click", async () => {
      const user = userEvent.setup();
      render(<Select aria-label="Font" options={OPTIONS} />);
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      expect(
        screen.getByRole("option", { name: "Sans-serif" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Serif" })).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Monospace" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: "Cursive" }),
      ).toBeInTheDocument();
    });

    it("invokes onValueChange and updates the trigger label when an option is picked", async () => {
      const user = userEvent.setup();
      let seen: string | null | undefined;
      const Controlled = () => {
        // `null` (not `undefined`) for the initial controlled state so
        // base-ui doesn't see a controlled/uncontrolled transition when
        // the first selection lands.
        const [value, setValue] = useState<string | null>(null);
        return (
          <Select
            aria-label="Font"
            onValueChange={(next) => {
              seen = next;
              setValue(next);
            }}
            options={OPTIONS}
            placeholder="Choose a font…"
            value={value}
          />
        );
      };
      render(<Controlled />);
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      await user.click(screen.getByRole("option", { name: "Monospace" }));
      expect(seen).toBe("mono");
      expect(
        screen.getByRole("combobox", { name: "Font" }).textContent,
      ).toContain("Monospace");
    });

    it("marks options as disabled so they cannot be selected", async () => {
      const user = userEvent.setup();
      render(<Select aria-label="Font" options={OPTIONS} />);
      await user.click(screen.getByRole("combobox", { name: "Font" }));
      const cursive = screen.getByRole("option", { name: "Cursive" });
      expect(cursive).toHaveAttribute("data-disabled");
    });
  });

  describe("prefixIcon", () => {
    it("renders the prefixIcon alongside the trigger", () => {
      render(
        <Select
          aria-label="Font"
          options={OPTIONS}
          prefixIcon={<span data-testid="prefix">Aa</span>}
        />,
      );
      expect(screen.getByTestId("prefix")).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: "Font" }),
      ).toBeInTheDocument();
    });
  });
});
