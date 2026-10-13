import { describe, expect, it } from "bun:test";
import { standaloneThemeSource } from "@domicile-desktop/component-library/standalone-theme-source";
import { ThemeProvider } from "@domicile-desktop/component-library/ThemeProvider";
import { render, screen } from "@testing-library/react";

import { ThemeSwitch } from "./bar-item";

describe("ThemeSwitch", () => {
  it("toggles between light and dark, with no system setting", () => {
    render(
      <ThemeProvider source={standaloneThemeSource("dark")}>
        <ThemeSwitch />
      </ThemeProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Dark theme — click for light" }),
    ).toBeVisible();
    expect(screen.queryByLabelText(/system/i)).toBeNull();
  });
});
