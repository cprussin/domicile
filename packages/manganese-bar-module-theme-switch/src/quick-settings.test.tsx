import { afterEach, describe, expect, it } from "bun:test";
import { standaloneThemeSource } from "@domicile-desktop/component-library/standalone-theme-source";
import { ThemeProvider } from "@domicile-desktop/component-library/ThemeProvider";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  describe("with a wipe", () => {
    afterEach(() => {
      Reflect.deleteProperty(document, "startViewTransition");
    });

    it("takes its new state in the wipe's new frame", async () => {
      // A wipe that never ends, so the theme never commits.
      Object.assign(document, {
        startViewTransition: (update: () => void) => {
          update();
          return {
            finished: new Promise(() => undefined),
            ready: new Promise(() => undefined),
          };
        },
      });
      render(
        <ThemeProvider source={standaloneThemeSource("dark")}>
          <DarkModeTile />
        </ThemeProvider>,
      );
      const tile = screen.getByRole("button", { name: "Dark mode" });

      await userEvent.click(tile);

      await waitFor(() => {
        expect(tile).toHaveAttribute("aria-pressed", "false");
      });
    });
  });
});
