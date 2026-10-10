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
    // update at once, and the test settles `ready` and `finished`.
    const wipe: {
      start?: ((ready: boolean) => void) | undefined;
      end?: (() => void) | undefined;
    } = {};
    beforeEach(() => {
      Object.assign(document, {
        startViewTransition: (update: () => void) => {
          update();
          return {
            finished: new Promise<void>((resolve) => {
              wipe.end = resolve;
            }),
            ready: new Promise<void>((resolve, reject) => {
              wipe.start = (ready) => {
                if (ready) {
                  resolve();
                } else {
                  reject(new Error("skipped"));
                }
              };
            }),
          };
        },
      });
    });
    afterEach(() => {
      Reflect.deleteProperty(document, "startViewTransition");
      wipe.start = undefined;
      wipe.end = undefined;
    });

    /** Renders a provider whose windows turn when the test says so. */
    const renderTurning = () => {
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
      return turning;
    };

    const isHeld = () =>
      document.documentElement.hasAttribute("data-theme-holding");

    it("turns the windows once the old frame is on screen, and holds the wipe until they have", async () => {
      // Windows are drawn live until the transition is ready: an `<app>` in
      // the old frame would turn on screen, and the capture may not have run.
      const turning = renderTurning();

      await userEvent.click(screen.getByTestId("theme"));
      await waitFor(() => {
        expect(wipe.start).toBeDefined();
      });
      // The page itself turned in the update.
      expect(isLight()).toBe(true);
      expect(turning.theme).toBeUndefined();

      wipe.start?.(true);
      await waitFor(() => {
        expect(turning.theme).toBe("light");
      });
      expect(isHeld()).toBe(true);

      turning.done?.();
      await waitFor(() => {
        expect(isHeld()).toBe(false);
      });

      // Ending the wipe commits state, so `act`.
      await act(async () => {
        wipe.end?.();
        await Promise.resolve();
      });
    });

    it("turns the windows when the wipe is skipped", async () => {
      const turning = renderTurning();

      await userEvent.click(screen.getByTestId("theme"));
      await waitFor(() => {
        expect(wipe.start).toBeDefined();
      });
      wipe.start?.(false);

      await waitFor(() => {
        expect(turning.theme).toBe("light");
      });
      turning.done?.();
      await act(async () => {
        wipe.end?.();
        await Promise.resolve();
      });
    });
  });
});
