import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { standaloneThemeSource } from "./standalone-theme-source";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { applyTheme } from "./theme-core";
import type { ThemeSource } from "./theme-source";

const isLight = () =>
  document.documentElement.getAttribute("data-theme") === "light";

// A minimal consumer: shows the theme the page is in and asks for the other
// one on click, so the provider's state and its `<html>` side effects can both
// be observed.
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
    // Dark is the attribute-less state because the preset's condition is
    // `[data-theme=light] &`. Writing `data-theme="dark"` would be a second
    // spelling of the same thing, and the one the preset does not read.
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
    // The desk states a theme in its config and the compositor hands it over
    // with the handshake, which is before this provider mounts. A provider
    // that only listened would paint dark until somebody clicked something.
    render(
      <ThemeProvider source={standaloneThemeSource("light")}>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(isLight()).toBe(true);
  });

  it("paints dark while the desk has said nothing", () => {
    // Not a failure and not a guess: dark is the attribute-less state of
    // `<html>` AND what `[theme] mode` defaults to, so a page told nothing
    // paints in the theme the desk most likely has.
    render(
      <ThemeProvider source={{ ...standaloneThemeSource(), theme: undefined }}>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  });

  it("asks the source to flip rather than flipping the page itself", async () => {
    // THE LOAD-BEARING ONE. A desk of three monitors is three pages, and the
    // theme also has to reach the Wayland clients through the compositor — so
    // a click is a request, and what repaints this page is the answer coming
    // back to every page on the desk.
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
    // And nothing moved here, because nothing answered.
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
    // No view transitions here, so the theme snaps over -- and the desk's
    // windows still have to be told, or they wait out the compositor's
    // deadline.
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
    // happy-dom has no view transitions, so the one platform global the wipe
    // is made of is stood in for: it runs the update at once and keeps what
    // the update returned, which is what the browser holds the old frame for.
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
      // The frame the wipe leaves is captured before the update runs, so a
      // window told inside the update is in that frame the old way and
      // behind the wipe the new way -- as long as the wipe does not start
      // until it has repainted, which is what the update's promise holds.
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

      turning.done?.();
      await update;
    });
  });
});
