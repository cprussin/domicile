import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";

import { AVATAR_SIZES, Avatar } from "./Avatar";

describe(Avatar, () => {
  describe("initials", () => {
    it("derives a single initial from a one-word name", () => {
      render(<Avatar name="Connor" />);
      expect(screen.getByText("C")).toBeInTheDocument();
    });

    it("derives initials from a first and last name", () => {
      render(<Avatar name="Connor Prussin" />);
      expect(screen.getByText("CP")).toBeInTheDocument();
    });

    it("uses the first and last initials when there are middle names", () => {
      render(<Avatar name="Connor Patrick Prussin" />);
      expect(screen.getByText("CP")).toBeInTheDocument();
    });

    it("renders a placeholder when the name is blank", () => {
      render(<Avatar name="   " />);
      expect(screen.getByText("?")).toBeInTheDocument();
    });

    it("uppercases lowercase names", () => {
      render(<Avatar name="ada lovelace" />);
      expect(screen.getByText("AL")).toBeInTheDocument();
    });
  });

  describe("gradient", () => {
    it("applies a gradient background derived from the name", () => {
      render(<Avatar name="Ada Lovelace" />);
      const fallback = screen.getByText("AL");
      expect(fallback.getAttribute("style")).toContain("linear-gradient");
    });

    it("produces a stable gradient for the same name", () => {
      const { unmount: unmountA } = render(<Avatar name="Ada Lovelace" />);
      const styleA = screen.getByText("AL").getAttribute("style");
      unmountA();
      render(<Avatar name="Ada Lovelace" />);
      const styleB = screen.getByText("AL").getAttribute("style");
      expect(styleA).toBe(styleB);
    });

    it("produces a different gradient for different names", () => {
      const { unmount: unmountA } = render(<Avatar name="Ada Lovelace" />);
      const styleA = screen.getByText("AL").getAttribute("style");
      unmountA();
      render(<Avatar name="Grace Hopper" />);
      const styleB = screen.getByText("GH").getAttribute("style");
      expect(styleA).not.toBe(styleB);
    });
  });

  describe("image loading", () => {
    it("renders the initials fallback as a hidden overlay while an image src is loading", () => {
      render(<Avatar name="Ada Lovelace" src="https://example.com/ada.png" />);
      expect(screen.getByText("AL")).toBeInTheDocument();
    });

    it("does not render an image element when src is omitted", () => {
      render(<Avatar name="Ada Lovelace" />);
      expect(screen.queryByRole("img")).toBeNull();
    });
  });

  describe("prop forwarding", () => {
    it("forwards arbitrary props (title, data-*) to the root element", () => {
      render(
        <Avatar
          data-testid="avatar-root"
          name="Ada Lovelace"
          title="A scientist"
        />,
      );
      const root = screen.getByTestId("avatar-root");
      expect(root).toHaveAttribute("title", "A scientist");
    });
  });

  describe("sizes", () => {
    for (const size of AVATAR_SIZES) {
      it(`renders without error for the "${size}" size`, () => {
        render(<Avatar name="Ada Lovelace" size={size} />);
        expect(screen.getByText("AL")).toBeInTheDocument();
      });
    }
  });
});
