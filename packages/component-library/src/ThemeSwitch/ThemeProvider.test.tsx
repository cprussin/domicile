import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { standaloneThemeSource } from "./standalone-theme-source";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { applyTheme } from "./theme-core";
import type { ThemeSource } from "./theme-source";

const isLight = () =>
  document.documentElement.getAttribute("data-theme") === "light";

// Shows the theme and flips it on click.
const Probe = () => {
  const { flip, theme } = useTheme();
  return (
    <button data-testid="theme" onClick={flip} type="button">
      {theme}
    </button>
  );
};

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("applyTheme", () => {
  it("writes light as an attribute and dark as its absence", () => {
    // The preset only reads `[data-theme=light]`; dark has no attribute.
    applyTheme("light");
    expect(isLight()).toBe(true);

    applyTheme("dark");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
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

describe(ThemeProvider, () => {
  it("paints in the theme the source was already holding", () => {
    // The compositor sends the configured theme before the provider mounts.
    render(
      <ThemeProvider source={standaloneThemeSource("light")}>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isLight()).toBe(true);
  });

  it("paints dark while the desk has said nothing", () => {
    // Dark is both the attribute-less `<html>` state and the default
    // `theme.mode`.
    render(
      <ThemeProvider source={{ ...standaloneThemeSource(), theme: undefined }}>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("asks the source to flip rather than flipping the page itself", async () => {
    // The theme must reach every monitor's page and the Wayland clients, so
    // the page repaints only when the compositor reports the change.
    const asked: unknown[] = [];
    const source: ThemeSource = {
      onTheme: () => () => undefined,
      setTheme: (theme) => {
        asked.push(theme);
      },
      theme: "dark",
      turnWindows: () => Promise.resolve(),
    };
    render(
      <ThemeProvider source={source}>
        <Probe />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByTestId("theme"));

    expect(asked).toStrictEqual(["light"]);
    // Unchanged, since the source never reported a change.
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(isLight()).toBe(false);
  });

  it("repaints when the desk answers", async () => {
    render(
      <ThemeProvider source={standaloneThemeSource("dark")}>
        <Probe />
      </ThemeProvider>,
    );
    const probe = screen.getByTestId("theme");

    // The wipe runs asynchronously, so wait for the commit.
    await userEvent.click(probe);
    await waitFor(() => {
      expect(probe).toHaveTextContent("light");
    });
    expect(isLight()).toBe(true);
  });

  it("turns the windows even with no wipe to hold them in", async () => {
    // Without view transitions there is no wipe, but windows must still be
    // told, or the compositor waits for its deadline.
    const turned: unknown[] = [];
    const source = {
      ...standaloneThemeSource("dark"),
      turnWindows: (theme: string) => {
        turned.push(theme);
        return Promise.resolve();
      },
    };
    render(
      <ThemeProvider source={source}>
        <Probe />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByTestId("theme"));

    await waitFor(() => {
      expect(turned).toStrictEqual(["light"]);
    });
  });

  describe("with a wipe", () => {
    // A stand-in for happy-dom's missing `startViewTransition`. It runs the
    // update at once and keeps its promise.
    const held: { update?: Promise<unknown> | undefined } = {};
    beforeEach(() => {
      Object.assign(document, {
        startViewTransition: (update: () => Promise<unknown>) => {
          held.update = update();
          return { finished: held.update };
        },
      });
    });
    afterEach(() => {
      Reflect.deleteProperty(document, "startViewTransition");
      held.update = undefined;
    });

    it("turns the windows inside it, and holds the old frame until they have", async () => {
      // The old frame is captured before the update, so windows must repaint
      // before the wipe starts. The update's promise waits for them.
      const turning: { theme?: string; done?: () => void } = {};
      const source = {
        ...standaloneThemeSource("dark"),
        turnWindows: (theme: string) =>
          new Promise<void>((resolve) => {
            turning.theme = theme;
            turning.done = resolve;
          }),
      };
      render(
        <ThemeProvider source={source}>
          <Probe />
        </ThemeProvider>,
      );

      await userEvent.click(screen.getByTestId("theme"));

      await waitFor(() => {
        expect(turning.theme).toBe("light");
      });
      // The page itself turned in the same update, ahead of the windows.
      expect(isLight()).toBe(true);
      const update = held.update ?? Promise.reject(new Error("no wipe ran"));
      expect(
        await Promise.race([
          update.then(() => "wiped"),
          Promise.resolve("held"),
        ]),
      ).toBe("held");

      // Finishing the windows ends the wipe, which commits state, so `act`.
      await act(async () => {
        turning.done?.();
        await update;
      });
    });
  });
});
