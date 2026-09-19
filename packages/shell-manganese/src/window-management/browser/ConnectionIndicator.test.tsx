import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectionSafety } from "../../address/connection-safety";
import { ConnectionIndicator } from "./ConnectionIndicator";

const indicator = (): HTMLElement =>
  screen.getByRole("button", { name: /^Connection/ });

describe("ConnectionIndicator", () => {
  describe("what it says at a glance", () => {
    it("names a connection the browser validated", () => {
      render(
        <ConnectionIndicator
          security={ConnectionSafety.Secure}
          url="https://example.com"
        />,
      );

      expect(indicator()).toHaveAccessibleName("Connection is secure");
    });

    it("names one the browser marks not secure", () => {
      render(
        <ConnectionIndicator
          security={ConnectionSafety.Warning}
          url="http://example.com"
        />,
      );

      expect(indicator()).toHaveAccessibleName("Connection is not secure");
    });

    // THE ONE THE OLD INDICATOR COULD NOT DRAW AT ALL. A scheme test reads an
    // expired certificate, a name mismatch and active mixed content as
    // `https://` and puts a padlock on every one of them.
    it("names a connection the browser found dangerous", () => {
      render(
        <ConnectionIndicator
          security={ConnectionSafety.Dangerous}
          url="https://expired.example.com"
        />,
      );

      expect(indicator()).toHaveAccessibleName("Connection is not private");
    });

    it("names an address that is not a connection at all", () => {
      render(
        <ConnectionIndicator
          security={ConnectionSafety.Neutral}
          url="about:blank"
        />,
      );

      expect(indicator()).toHaveAccessibleName("Connection is local");
    });

    it("says the browser has not judged this page when it has not", () => {
      render(
        <ConnectionIndicator security={ConnectionSafety.Unstated} url="" />,
      );

      expect(indicator()).toHaveAccessibleName("Connection is not known");
    });
  });

  describe("the details", () => {
    it("stays shut until the indicator is pressed", () => {
      render(
        <ConnectionIndicator
          security={ConnectionSafety.Secure}
          url="https://example.com"
        />,
      );

      expect(screen.queryByText(/certificate/)).not.toBeInTheDocument();
    });

    it("names the host of the page it is describing", async () => {
      render(
        <ConnectionIndicator
          security={ConnectionSafety.Secure}
          url="https://docs.example.com/guide"
        />,
      );

      await userEvent.click(indicator());

      expect(await screen.findByText("docs.example.com")).toBeInTheDocument();
    });

    it("warns that a dangerous connection may not be private", async () => {
      render(
        <ConnectionIndicator
          security={ConnectionSafety.Dangerous}
          url="https://expired.example.com"
        />,
      );

      await userEvent.click(indicator());

      expect(
        await screen.findByText(/should not enter anything sensitive/),
      ).toBeInTheDocument();
    });

    it("says what it cannot tell you, rather than implying safety", async () => {
      render(
        <ConnectionIndicator security={ConnectionSafety.Unstated} url="" />,
      );

      await userEvent.click(indicator());

      expect(await screen.findByText(/has not reported/)).toBeInTheDocument();
    });
  });
});
