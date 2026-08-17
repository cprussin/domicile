import { beforeEach, describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  loadPreference,
  resolveTheme,
  ThemeProvider,
  useTheme,
} from "./ThemeProvider";

const THEME_KEY = "theme:v1";

const isLight = () =>
  document.documentElement.getAttribute("data-theme") === "light";

// A minimal consumer: shows the current preference and cycles on click, so the
// provider's state and its `<html>` side effects can both be observed.
const Probe = () => {
  const { cycle, preference } = useTheme();
  return (
    <button data-testid="pref" onClick={cycle} type="button">
      {preference}
    </button>
  );
};

beforeEach(() => {
  globalThis.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("resolveTheme", () => {
  it("passes explicit preferences straight through", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
});

describe("loadPreference", () => {
  it("defaults to following the system", () => {
    expect(loadPreference()).toBe("system");
  });

  it("reads back a previously saved preference", () => {
    globalThis.localStorage.setItem(THEME_KEY, "light");
    expect(loadPreference()).toBe("light");
  });

  it("ignores an unrecognized stored value", () => {
    globalThis.localStorage.setItem(THEME_KEY, "chartreuse");
    expect(loadPreference()).toBe("system");
  });
});

describe("useTheme", () => {
  it("throws when used outside a ThemeProvider", () => {
    const Bare = () => {
      useTheme();
      return null;
    };
    expect(() => render(<Bare />)).toThrow(
      "must be used within a <ThemeProvider>",
    );
  });
});

describe("ThemeProvider", () => {
  it("applies the saved preference to <html> on mount", () => {
    globalThis.localStorage.setItem(THEME_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("pref")).toHaveTextContent("light");
    expect(isLight()).toBe(true);
  });

  it("cycles the preference, re-applies the theme, and persists it", async () => {
    globalThis.localStorage.setItem(THEME_KEY, "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const pref = screen.getByTestId("pref");
    expect(pref).toHaveTextContent("light");

    // light → dark: the wipe runs asynchronously, so wait for the commit.
    await userEvent.click(pref);
    await waitFor(() => {
      expect(pref).toHaveTextContent("dark");
    });
    expect(isLight()).toBe(false);
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBe("dark");
  });
});
