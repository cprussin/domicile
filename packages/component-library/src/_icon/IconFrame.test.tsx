import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { IconFrame } from "./IconFrame";

describe(IconFrame, () => {
  it("is an image named by its label", () => {
    render(
      <IconFrame label="Wi-Fi" size={15}>
        <path d="M0 0Z" />
      </IconFrame>,
    );
    expect(screen.getByRole("img", { name: "Wi-Fi" })).toHaveAttribute(
      "width",
      "15",
    );
  });

  it("is hidden from assistive tech without a label", () => {
    const { container } = render(
      <IconFrame size={15}>
        <path d="M0 0Z" />
      </IconFrame>,
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  describe("slash", () => {
    it("is drawn while slashed", () => {
      render(
        <IconFrame
          label="Wi-Fi off"
          size={15}
          slash={{ shown: true, weight: "bold" }}
        >
          <path d="M0 0Z" />
        </IconFrame>,
      );
      expect(screen.getByRole("img")).toHaveAttribute("data-slashed");
    });

    it("is put away while not", () => {
      render(
        <IconFrame
          label="Wi-Fi"
          size={15}
          slash={{ shown: false, weight: "bold" }}
        >
          <path d="M0 0Z" />
        </IconFrame>,
      );
      expect(screen.getByRole("img")).not.toHaveAttribute("data-slashed");
    });
  });
});
