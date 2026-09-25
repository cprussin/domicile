import { beforeEach, describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { standaloneThemeSource } from "./standalone-theme-source";
import { ThemeProvider } from "./ThemeProvider";
import { ThemeSwitch } from "./ThemeSwitch";
import { OTHER_THEME, THEMES } from "./theme-core";

describe(ThemeSwitch, () => {
  describe("rendering (theme injected)", () => {
    it("exposes the theme via a data attribute", () => {
      // `data-theme-mode` rather than `data-theme`: the preset's light
      // condition is `[data-theme=light] &`, so naming it that would make the
      // toggle's own descendants resolve light tokens over a dark page.
      render(
        <ThemeSwitch
          useTheme={() => ({ flip: () => undefined, theme: "dark" })}
        />,
      );
      expect(screen.getByRole("button").getAttribute("data-theme-mode")).toBe(
        "dark",
      );
    });

    it("uses a theme-specific aria-label that names the other one", () => {
      render(
        <ThemeSwitch
          useTheme={() => ({ flip: () => undefined, theme: "light" })}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Light theme — click for dark" }),
      ).toBeInTheDocument();
    });

    it("calls the context's flip when clicked", async () => {
      const flip = mock();
      render(<ThemeSwitch useTheme={() => ({ flip, theme: "dark" })} />);
      await userEvent.click(screen.getByRole("button"));
      expect(flip).toHaveBeenCalledTimes(1);
    });
  });

  describe("wired to a real provider", () => {
    beforeEach(() => {
      document.documentElement.removeAttribute("data-theme");
    });

    it("renders the theme the desk is on with no props", () => {
      render(
        <ThemeProvider source={standaloneThemeSource("light")}>
          <ThemeSwitch />
        </ThemeProvider>,
      );
      expect(screen.getByRole("button")).toHaveAttribute(
        "data-theme-mode",
        "light",
      );
    });

    it("flips through the provider when clicked", async () => {
      render(
        <ThemeProvider source={standaloneThemeSource("dark")}>
          <ThemeSwitch />
        </ThemeProvider>,
      );
      const button = screen.getByRole("button");
      await userEvent.click(button);
      // Committed after the async wipe, and only because the source answered.
      await waitFor(() => {
        expect(button).toHaveAttribute("data-theme-mode", "light");
      });
    });

    it("throws when rendered without a provider", () => {
      const Bare = () => <ThemeSwitch />;
      expect(() => render(<Bare />)).toThrow(
        "must be used within a <ThemeProvider>",
      );
    });
  });

  describe("OTHER_THEME", () => {
    it("takes every theme to the only other one", () => {
      // Two members, so "the other one" is total and an involution. A third
      // member would break both, which is what this is here to notice — see
      // `theme-core.ts` for why there is not going to be one.
      for (const theme of THEMES) {
        expect(OTHER_THEME[theme]).not.toBe(theme);
        expect(OTHER_THEME[OTHER_THEME[theme]]).toBe(theme);
      }
    });
  });
});
