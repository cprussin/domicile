import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

import { Notice } from "./Notice";

describe(Notice, () => {
  describe("rendering", () => {
    it("announces its icon and label as a status", () => {
      render(<Notice icon={<svg data-testid="icon" />}>150%</Notice>);

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("150%");
      expect(screen.getByTestId("icon")).toBeInTheDocument();
    });

    it("shows no meter without a level", () => {
      render(<Notice icon={undefined}>Done</Notice>);

      expect(screen.queryByRole("meter")).toBeNull();
    });

    it("shows a level as a meter", () => {
      render(
        <Notice icon={undefined} level={0.4}>
          Volume
        </Notice>,
      );

      expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "40");
    });

    it("marks a muted meter", () => {
      render(
        <Notice icon={undefined} level={0.4} muted>
          Volume
        </Notice>,
      );

      expect(screen.getByRole("meter")).toHaveAttribute("data-muted");
    });
  });

  // Hidden on `animationend`, not a timer, so the duration lives only in the
  // stylesheet. Callers key it per change to show it again.
  describe("dismissal", () => {
    it("goes away once it has faded out", () => {
      render(<Notice icon={undefined}>150%</Notice>);

      fireEvent.animationEnd(screen.getByRole("status"));

      expect(screen.queryByRole("status")).toBeNull();
    });

    it("comes back when the caller keys a new one", () => {
      const { rerender } = render(
        <Notice icon={undefined} key={1}>
          110%
        </Notice>,
      );
      fireEvent.animationEnd(screen.getByRole("status"));

      rerender(
        <Notice icon={undefined} key={2}>
          125%
        </Notice>,
      );

      expect(screen.getByRole("status")).toHaveTextContent("125%");
    });
  });
});
