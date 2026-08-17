import { describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Input } from "../Input/Input";

import { Field } from "./Field";

/**
 * happy-dom (the test runtime preload) implements `ValidityState` but doesn't
 * always populate the platform-specific `validationMessage` string for every
 * constraint. This probe runs once at module load so the dependent test can
 * be conditionally skipped rather than silently early-returning at runtime.
 */
const runtimeSupportsValidationMessage = () => {
  if (typeof document === "undefined") {
    return false;
  } else {
    const probe = document.createElement("input");
    probe.setAttribute("required", "");
    return probe.validationMessage !== "";
  }
};

describe(Field, () => {
  describe("rendering", () => {
    it("renders the label and the child control", () => {
      render(
        <Field label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByLabelText("name-input")).toBeInTheDocument();
    });

    it("renders a hint when provided", () => {
      render(
        <Field hint="An example hint" label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.getByText("An example hint")).toBeInTheDocument();
    });

    it("does not render a hint element when no hint is provided", () => {
      render(
        <Field label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.queryByText("An example hint")).not.toBeInTheDocument();
    });

    it("renders the error message when error is provided", async () => {
      render(
        <Field error="Name is required" label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(await screen.findByText("Name is required")).toBeInTheDocument();
    });

    it("does not render an error element when no error is provided", () => {
      render(
        <Field label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
    });

    it("renders hint and error simultaneously", async () => {
      render(
        <Field error="Name is required" hint="Your full name" label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.getByText("Your full name")).toBeInTheDocument();
      expect(await screen.findByText("Name is required")).toBeInTheDocument();
    });

    it("renders a ReactNode label", () => {
      render(
        <Field
          label={
            <>
              Name <span data-testid="required-marker">*</span>
            </>
          }
        >
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.getByText("Name", { exact: false })).toBeInTheDocument();
      expect(screen.getByTestId("required-marker")).toBeInTheDocument();
    });
  });

  describe("state propagation", () => {
    it("propagates disabled state to the label", () => {
      render(
        <Field disabled label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.getByText("Name")).toHaveAttribute("data-disabled");
    });

    it("marks the label as invalid when an error is provided", async () => {
      render(
        <Field error="Required" label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      // Await the error popover settling so its Floating UI positioning runs
      // inside act before the assertion on the label.
      await screen.findByText("Required");
      expect(screen.getByText("Name")).toHaveAttribute("data-invalid");
    });

    it("marks the label as invalid when invalid prop is set", () => {
      render(
        <Field invalid label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.getByText("Name")).toHaveAttribute("data-invalid");
    });

    it("does not mark the label as invalid when neither error nor invalid is set", () => {
      render(
        <Field label="Name">
          <input aria-label="name-input" />
        </Field>,
      );
      expect(screen.getByText("Name")).not.toHaveAttribute("data-invalid");
    });
  });

  describe("native validation forwarding", () => {
    it("prefers the explicit error prop over the browser validationMessage", async () => {
      render(
        <Field error="Custom error" label="Username">
          <Input defaultValue="x" minLength={5} required type="text" />
        </Field>,
      );
      expect(await screen.findByText("Custom error")).toBeInTheDocument();
    });

    it("toggles the error popover when the error prop changes", async () => {
      const { rerender } = render(
        <Field label="Username">
          <Input defaultValue="x" type="text" />
        </Field>,
      );
      expect(screen.queryByText("Too short")).not.toBeInTheDocument();
      rerender(
        <Field error="Too short" label="Username">
          <Input defaultValue="x" type="text" />
        </Field>,
      );
      await waitFor(() => {
        expect(screen.getByText("Too short")).toBeInTheDocument();
      });
      rerender(
        <Field label="Username">
          <Input defaultValue="x" type="text" />
        </Field>,
      );
      await waitFor(() => {
        expect(screen.queryByText("Too short")).not.toBeInTheDocument();
      });
    });

    it.skipIf(runtimeSupportsValidationMessage() === false)(
      "surfaces the browser validationMessage by reading the control's validity",
      async () => {
        const user = userEvent.setup();
        render(
          <Field label="Username" validationMode="onBlur">
            <Input minLength={5} required type="text" />
          </Field>,
        );
        const input = screen.getByRole("textbox") as HTMLInputElement;
        input.focus();
        await user.tab();
        const message = input.validationMessage;
        await waitFor(() => {
          expect(screen.getByText(message)).toBeInTheDocument();
        });
      },
    );
  });
});
