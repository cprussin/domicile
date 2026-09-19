import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectionIndicator } from "./ConnectionIndicator";

const indicator = (): HTMLElement =>
  screen.getByRole("button", { name: /^Connection/ });

describe("ConnectionIndicator", () => {
  describe("what it says at a glance", () => {
    it("names an encrypted connection", () => {
      render(<ConnectionIndicator url="https://example.com" />);

      expect(indicator()).toHaveAccessibleName("Connection is encrypted");
    });

    it("names one that is not", () => {
      render(<ConnectionIndicator url="http://example.com" />);

      expect(indicator()).toHaveAccessibleName("Connection is not encrypted");
    });

    it("names an address that is not a connection at all", () => {
      render(<ConnectionIndicator url="about:blank" />);

      expect(indicator()).toHaveAccessibleName("Connection is local");
    });
  });

  describe("the details", () => {
    it("stays shut until the indicator is pressed", () => {
      render(<ConnectionIndicator url="https://example.com" />);

      expect(screen.queryByText(/cannot be read/)).not.toBeInTheDocument();
    });

    it("names the host the window was sent to", async () => {
      render(<ConnectionIndicator url="https://docs.example.com/guide" />);

      await userEvent.click(indicator());

      expect(await screen.findByText("docs.example.com")).toBeInTheDocument();
    });

    // WHAT THE WINDOW ASKED FOR IS NOT WHERE THE PAGE IS. The engine reports
    // no address for a guest, so a link or a redirect the page followed has
    // taken it somewhere this indicator was never told about — and an
    // indicator that let the user believe otherwise would be worse than none.
    it("says that it describes where the window was sent, not where the page went", async () => {
      render(<ConnectionIndicator url="https://example.com" />);

      await userEvent.click(indicator());

      expect(
        await screen.findByText(/where this window was sent/),
      ).toBeInTheDocument();
    });

    it("warns about a connection in the clear", async () => {
      render(<ConnectionIndicator url="http://example.com" />);

      await userEvent.click(indicator());

      expect(
        await screen.findByText(/can be read and changed/),
      ).toBeInTheDocument();
    });
  });
});
