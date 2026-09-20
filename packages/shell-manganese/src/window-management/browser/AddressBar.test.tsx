import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectionSafety } from "../../address/connection-safety";
import { AddressBar } from "./AddressBar";

/** The props every case here shares; each overrides the one it is about. */
const BAR = {
  address: "https://example.com",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  onBack: () => undefined,
  onForward: () => undefined,
  onNavigate: () => undefined,
  onReload: () => undefined,
  onStop: () => undefined,
  security: ConnectionSafety.Secure,
  visited: ["https://example.com"],
} as const;

const address = (): HTMLInputElement =>
  screen.getByRole("combobox", { name: "Address" });

const control = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

describe("AddressBar", () => {
  it("shows where the window was sent", () => {
    render(<AddressBar {...BAR} />);

    expect(address()).toHaveValue("https://example.com");
  });

  // ONE BUTTON IN ONE PLACE, which is what every browser does with these two:
  // a page is either arriving or it is not, so a stop that is live while a
  // reload is live offers the user a choice that never exists — and two
  // buttons that are each dead half the time cost the width of both.
  describe("the reload button", () => {
    it("reloads the page while nothing is arriving", async () => {
      const calls: string[] = [];
      render(
        <AddressBar
          {...BAR}
          onReload={() => {
            calls.push("reload");
          }}
        />,
      );

      await userEvent.click(control("Reload"));

      expect(calls).toStrictEqual(["reload"]);
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    });

    it("becomes a stop button while a page is arriving", async () => {
      const calls: string[] = [];
      render(
        <AddressBar
          {...BAR}
          loading
          onStop={() => {
            calls.push("stop");
          }}
        />,
      );

      await userEvent.click(control("Stop"));

      expect(calls).toStrictEqual(["stop"]);
      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    });
  });

  // A CONTROL THAT WOULD DO NOTHING SAYS SO BEFORE IT IS PRESSED: `goBack()`
  // on a history with nothing behind it is a no-op in the browser process, so
  // a live-looking button is the window offering something it cannot do.
  describe("the history controls", () => {
    it("grays out what the history cannot reach", () => {
      render(<AddressBar {...BAR} />);

      expect(control("Back")).toBeDisabled();
      expect(control("Forward")).toBeDisabled();
    });

    it("sends the page back and forward when it can", async () => {
      const calls: string[] = [];
      render(
        <AddressBar
          {...BAR}
          canGoBack
          canGoForward
          onBack={() => {
            calls.push("back");
          }}
          onForward={() => {
            calls.push("forward");
          }}
        />,
      );

      await userEvent.click(control("Back"));
      await userEvent.click(control("Forward"));

      expect(calls).toStrictEqual(["back", "forward"]);
    });
  });

  describe("what Enter does", () => {
    it("loads a bare host over https", async () => {
      const sent: string[] = [];
      render(
        <AddressBar
          {...BAR}
          onNavigate={(url) => {
            sent.push(url);
          }}
        />,
      );

      await userEvent.clear(address());
      await userEvent.type(address(), "docs.example.com{Enter}");

      expect(sent).toStrictEqual(["https://docs.example.com"]);
    });

    // WHAT A BROWSER DOES WITH WORDS. A line that is not an address is a
    // search, and an address bar that loaded `https://how tall is a giraffe`
    // instead is one the user learns not to type into.
    it("searches for a line that is not an address", async () => {
      const sent: string[] = [];
      render(
        <AddressBar
          {...BAR}
          onNavigate={(url) => {
            sent.push(url);
          }}
        />,
      );

      await userEvent.clear(address());
      await userEvent.type(address(), "how tall is a giraffe{Enter}");

      expect(sent).toStrictEqual([
        "https://google.com/search?q=how%20tall%20is%20a%20giraffe",
      ]);
    });

    it("does nothing at all on an empty line", async () => {
      const sent: string[] = [];
      render(
        <AddressBar
          {...BAR}
          onNavigate={(url) => {
            sent.push(url);
          }}
        />,
      );

      await userEvent.clear(address());
      await userEvent.type(address(), "{Enter}");

      expect(sent).toStrictEqual([]);
    });
  });

  describe("the suggestions", () => {
    it("offers where the window has been, and loads the one that is taken", async () => {
      const sent: string[] = [];
      render(
        <AddressBar
          {...BAR}
          onNavigate={(url) => {
            sent.push(url);
          }}
          visited={["https://example.com", "https://docs.example.com/guide"]}
        />,
      );

      await userEvent.clear(address());
      await userEvent.type(address(), "docs");
      await userEvent.click(
        await screen.findByText("https://docs.example.com/guide"),
      );

      expect(sent).toStrictEqual(["https://docs.example.com/guide"]);
    });
  });

  it("goes back to showing the address when the window is sent somewhere else", async () => {
    const { rerender } = render(<AddressBar {...BAR} />);
    await userEvent.clear(address());
    await userEvent.type(address(), "half a typed add");

    rerender(<AddressBar {...BAR} address="https://docs.example.com" />);

    expect(address()).toHaveValue("https://docs.example.com");
  });

  // THE INDICATOR IS GIVEN THE VERDICT, NOT THE ADDRESS TO GUESS FROM. An
  // `https://` whose certificate did not validate is dangerous, and a bar that
  // read the scheme would put a padlock on it.
  it("carries the browser's verdict on the page it is showing", () => {
    render(
      <AddressBar
        {...BAR}
        address="https://expired.example.com"
        security={ConnectionSafety.Dangerous}
      />,
    );

    expect(control("Connection is not private")).toBeVisible();
  });
});
