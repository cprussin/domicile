import { describe, expect, it } from "bun:test";
import { standaloneThemeSource } from "@domicile-desktop/component-library/standalone-theme-source";
import { ThemeProvider } from "@domicile-desktop/component-library/ThemeProvider";
import { render, screen } from "@testing-library/react";

import { DarkModeTile } from "./quick-settings";

describe(DarkModeTile, () => {
  it("is pressed in the dark theme", () => {
    render(
      <ThemeProvider source={standaloneThemeSource("dark")}>
        <DarkModeTile />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("is not pressed in the light theme", () => {
    render(
      <ThemeProvider source={standaloneThemeSource("light")}>
        <DarkModeTile />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Dark mode" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
