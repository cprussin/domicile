import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChangeEvent } from "react";
import { useState } from "react";

import type { AnyComponent } from "./AnyComponent";
import { wrapperOf } from "./wrapperOf";

type ChangeTarget = ChangeEvent<HTMLInputElement | HTMLTextAreaElement>;

type Options = {
  /**
   * The wrapped control component (e.g. `Input` or `Textarea`).
   */
  Component: AnyComponent;
  /** Label used for `aria-label` (e.g. "Name" for Input, "Bio" for Textarea). */
  defaultLabel: string;
};

/**
 * Shared behavioural test suite for `Input` and `Textarea`. Both components
 * wrap the same `_control/` machinery, so the rendering / value-handling /
 * prop-forwarding / interactions / clearable assertions are identical apart
 * from the wrapped component itself.
 *
 * Component-specific tests (e.g. Textarea's resize handle or Input's `type`
 * variants) live in the host test file.
 */
export const runControlSuite = ({ Component, defaultLabel }: Options) => {
  describe("rendering", () => {
    it("renders a text-input element", () => {
      render(<Component aria-label={defaultLabel} placeholder="Type here" />);
      expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument();
    });

    it("renders the prefixIcon alongside the control", () => {
      render(
        <Component
          aria-label={defaultLabel}
          placeholder="Type"
          prefixIcon={<span data-testid="prefix">🔍</span>}
        />,
      );
      expect(screen.getByTestId("prefix")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders the suffixIcon alongside the control", () => {
      render(
        <Component
          aria-label={defaultLabel}
          placeholder="0.00"
          suffixIcon={<span data-testid="suffix-icon">USD</span>}
        />,
      );
      expect(screen.getByTestId("suffix-icon")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders suffixButtons alongside the control", () => {
      render(
        <Component
          aria-label={defaultLabel}
          placeholder="Type"
          suffixButtons={
            <>
              <button data-testid="clear" type="button">
                Clear
              </button>
              <button data-testid="submit" type="button">
                Go
              </button>
            </>
          }
        />,
      );
      expect(screen.getByTestId("clear")).toBeInTheDocument();
      expect(screen.getByTestId("submit")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("value handling", () => {
    it("forwards the value prop", () => {
      render(
        <Component
          aria-label={defaultLabel}
          onChange={() => {
            // no-op for controlled
          }}
          value="hello"
        />,
      );
      expect(screen.getByRole("textbox")).toHaveValue("hello");
    });

    it("uses the defaultValue when uncontrolled", () => {
      render(<Component aria-label={defaultLabel} defaultValue="prefilled" />);
      expect(screen.getByRole("textbox")).toHaveValue("prefilled");
    });

    it("reports typed text via onChange", async () => {
      const user = userEvent.setup();
      const seen: string[] = [];
      render(
        <Component
          aria-label={defaultLabel}
          onChange={(event: ChangeTarget) => {
            seen.push(event.target.value);
          }}
        />,
      );
      await user.type(screen.getByRole("textbox"), "hi");
      // onChange should fire on every keystroke and accumulate the value.
      expect(seen).toEqual(["h", "hi"]);
      expect(screen.getByRole("textbox")).toHaveValue("hi");
    });

    it("invokes the user's onChange handler when controlled", async () => {
      const user = userEvent.setup();
      let last = "";
      const Controlled = () => {
        const [value, setValue] = useState("");
        return (
          <Component
            aria-label={defaultLabel}
            onChange={(event: ChangeTarget) => {
              last = event.target.value;
              setValue(event.target.value);
            }}
            value={value}
          />
        );
      };
      render(<Controlled />);
      await user.type(screen.getByRole("textbox"), "ab");
      expect(last).toBe("ab");
      expect(screen.getByRole("textbox")).toHaveValue("ab");
    });
  });

  describe("prop forwarding", () => {
    it("respects the disabled prop", () => {
      render(<Component aria-label={defaultLabel} disabled />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("applies the numeric width prop as an inline inline-size style", () => {
      render(<Component aria-label={defaultLabel} width={80} />);
      expect(wrapperOf(screen.getByRole("textbox")).style.inlineSize).toBe(
        "20rem",
      );
    });

    it("does not apply an inline inline-size when no width prop is provided", () => {
      render(<Component aria-label={defaultLabel} />);
      expect(wrapperOf(screen.getByRole("textbox")).style.inlineSize).toBe("");
    });
  });

  describe("interactions", () => {
    it("focuses the control when the wrapper padding is clicked", async () => {
      const user = userEvent.setup();
      render(
        <Component
          aria-label={defaultLabel}
          prefixIcon={<span data-testid="prefix">icon</span>}
        />,
      );
      const control = screen.getByRole("textbox");
      await user.click(wrapperOf(control));
      expect(control).toHaveFocus();
    });
  });

  describe("clearable", () => {
    it("hides the clear button when the control is empty", () => {
      render(<Component aria-label={defaultLabel} clearable />);
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    });

    it("shows the clear button once the control has a value", async () => {
      const user = userEvent.setup();
      render(<Component aria-label={defaultLabel} clearable />);
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
      await user.type(screen.getByRole("textbox"), "hi");
      expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    });

    it("clears the control value when the clear button is pressed", async () => {
      const user = userEvent.setup();
      let value = "";
      render(
        <Component
          aria-label={defaultLabel}
          clearable
          defaultValue="hello"
          onChange={(event: ChangeTarget) => {
            value = event.target.value;
          }}
        />,
      );
      const control = screen.getByRole("textbox");
      expect(control).toHaveValue("hello");
      await user.click(screen.getByRole("button", { name: "Clear" }));
      expect(control).toHaveValue("");
      expect(value).toBe("");
      expect(control).toHaveFocus();
    });
  });
};
