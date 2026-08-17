import { beforeEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeProvider } from "./ThemeProvider";
import { ThemeSwitch } from "./ThemeSwitch";
import { THEME_CYCLE, THEME_PREFERENCES } from "./theme-core";

const THEME_KEY = "theme:v1";

describe(ThemeSwitch, () => {
  describe("rendering (theme injected)", () => {
    it("exposes the current preference via data attribute", () => {
      render(
        <ThemeSwitch
          useTheme={() => ({ cycle: () => undefined, preference: "dark" })}
        />,
      );
      expect(
        screen.getByRole("button").getAttribute("data-theme-preference"),
      ).toBe("dark");
    });

    it("uses a preference-specific aria-label that hints at the next step", () => {
      render(
        <ThemeSwitch
          useTheme={() => ({ cycle: () => undefined, preference: "light" })}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Light theme — click for dark" }),
      ).toBeInTheDocument();
    });

    it("calls the context's cycle when clicked", async () => {
      const cycle = mock();
      render(
        <ThemeSwitch useTheme={() => ({ cycle, preference: "system" })} />,
      );
      await userEvent.click(screen.getByRole("button"));
      expect(cycle).toHaveBeenCalledTimes(1);
    });
  });

  describe("wired to a real provider", () => {
    beforeEach(() => {
      globalThis.localStorage.clear();
      document.documentElement.removeAttribute("data-theme");
    });

    it("renders the provider's current preference with no props", () => {
      globalThis.localStorage.setItem(THEME_KEY, "dark");
      render(
        <ThemeProvider>
          <ThemeSwitch />
        </ThemeProvider>,
      );
      expect(screen.getByRole("button")).toHaveAttribute(
        "data-theme-preference",
        "dark",
      );
    });

    it("cycles the preference through the provider when clicked", async () => {
      globalThis.localStorage.setItem(THEME_KEY, "dark");
      render(
        <ThemeProvider>
          <ThemeSwitch />
        </ThemeProvider>,
      );
      const button = screen.getByRole("button");
      await userEvent.click(button);
      // dark → system, committed after the async wipe.
      await waitFor(() => {
        expect(button).toHaveAttribute("data-theme-preference", "system");
      });
    });

    it("throws when rendered without a provider", () => {
      const Bare = () => <ThemeSwitch />;
      expect(() => render(<Bare />)).toThrow(
        "must be used within a <ThemeProvider>",
      );
    });
  });

  describe("THEME_CYCLE", () => {
    it("covers every preference", () => {
      for (const preference of THEME_PREFERENCES) {
        expect(THEME_CYCLE[preference]).toBeDefined();
      }
    });

    it("cycles light → dark → system → light", () => {
      expect(THEME_CYCLE.light).toBe("dark");
      expect(THEME_CYCLE.dark).toBe("system");
      expect(THEME_CYCLE.system).toBe("light");
    });
  });
});
