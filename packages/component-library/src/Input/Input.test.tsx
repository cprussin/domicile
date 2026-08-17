import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { runControlSuite } from "../__test__/runControlSuite";

import { Input } from "./Input";

describe(Input, () => {
  runControlSuite({ Component: Input, defaultLabel: "Name" });

  describe("input-specific prop forwarding", () => {
    it("forwards the type prop to the underlying input", () => {
      render(<Input aria-label="Password" type="password" />);
      expect(screen.getByLabelText("Password")).toHaveAttribute(
        "type",
        "password",
      );
    });

    it("forwards arbitrary HTML attributes", () => {
      render(
        <Input
          aria-label="Name"
          autoComplete="name"
          maxLength={20}
          name="full-name"
        />,
      );
      const input = screen.getByRole("textbox");
      expect(input).toHaveAttribute("name", "full-name");
      expect(input).toHaveAttribute("maxlength", "20");
      expect(input).toHaveAttribute("autocomplete", "name");
    });
  });
});
