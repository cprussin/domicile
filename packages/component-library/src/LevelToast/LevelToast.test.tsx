import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { LevelToast } from "./LevelToast";

/** Volume at `level`, after `changes` changes. */
const volume = (
  changes: number,
  level: number,
  muted = false,
): ComponentProps<typeof LevelToast> => ({
  changes,
  icon: <svg data-testid="icon" />,
  label: "Volume",
  level,
  muted,
});

describe(LevelToast, () => {
  describe("rendering", () => {
    it("announces its label and level as a status", () => {
      render(<LevelToast {...volume(1, 0.4)} />);

      expect(screen.getByRole("status")).toHaveTextContent("Volume40%");
      expect(screen.getByTestId("icon")).toBeInTheDocument();
      expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "40");
    });

    it("says muted and grays the meter", () => {
      render(<LevelToast {...volume(1, 0.4, true)} />);

      expect(screen.getByRole("status")).toHaveTextContent("VolumeMuted");
      expect(screen.getByRole("meter")).toHaveAttribute("data-muted");
    });
  });

  // Hidden on its own `animationend`, not a timer, so the duration lives only
  // in the stylesheet.
  describe("changes", () => {
    it("stays up and updates in place on a change", () => {
      const { rerender } = render(<LevelToast {...volume(1, 0.4)} />);
      const shown = screen.getByRole("status");

      rerender(<LevelToast {...volume(2, 0.45)} />);

      expect(screen.getByRole("status")).toBe(shown);
      expect(shown).toHaveTextContent("Volume45%");
    });

    it("starts its fade-out over on each change", () => {
      const { rerender } = render(<LevelToast {...volume(1, 0.4)} />);
      const again = screen.getByRole("status").hasAttribute("data-again");

      rerender(<LevelToast {...volume(2, 0.45)} />);

      expect(screen.getByRole("status").hasAttribute("data-again")).toBe(
        !again,
      );
    });

    it("stays up when only its entrance ends", () => {
      render(<LevelToast {...volume(1, 0.4)} />);

      fireEvent.animationEnd(screen.getByRole("meter"));

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("goes away once it has faded out", () => {
      render(<LevelToast {...volume(1, 0.4)} />);

      fireEvent.animationEnd(screen.getByRole("status"));

      expect(screen.queryByRole("status")).toBeNull();
    });

    it("comes back on the next change", () => {
      const { rerender } = render(<LevelToast {...volume(1, 0.4)} />);
      fireEvent.animationEnd(screen.getByRole("status"));

      rerender(<LevelToast {...volume(2, 0.45)} />);

      expect(screen.getByRole("status")).toHaveTextContent("Volume45%");
    });
  });
});
