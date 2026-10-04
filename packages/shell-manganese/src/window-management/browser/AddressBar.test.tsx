import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConnectionSafety } from "../../address/connection-safety";
import { AddressBar } from "./AddressBar";

/** Shared props; each case overrides what it tests. */
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
  onZoomIn: () => undefined,
  onZoomOut: () => undefined,
  onZoomReset: () => undefined,
  security: ConnectionSafety.Secure,
  visited: ["https://example.com"],
  zoom: 1,
  zoomsAnnounced: 0,
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

  // One button for Reload and Stop, since only one applies at a time.
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

  // A button that would do nothing is disabled.
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

  // The indicator uses the browser's security state, not the URL scheme: an
  // `https://` page with an invalid certificate is not secure.
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

  describe("the zoom controls", () => {
    it("drives the zoom with each of its three", async () => {
      const calls: string[] = [];
      render(
        <AddressBar
          {...BAR}
          onZoomIn={() => {
            calls.push("in");
          }}
          onZoomOut={() => {
            calls.push("out");
          }}
          onZoomReset={() => {
            calls.push("reset");
          }}
          zoom={1.25}
        />,
      );

      await userEvent.click(control("Zoom in"));
      await userEvent.click(control("Zoom out"));
      await userEvent.click(control("125%"));

      expect(calls).toStrictEqual(["in", "out", "reset"]);
    });

    it("grays out what would do nothing at 100%", () => {
      render(<AddressBar {...BAR} zoom={1} />);

      expect(control("100%")).toBeDisabled();
      expect(control("Zoom in")).toBeEnabled();
      expect(control("Zoom out")).toBeEnabled();
    });

    it("grays out zooming past either end", () => {
      const { rerender } = render(<AddressBar {...BAR} zoom={5} />);
      expect(control("Zoom in")).toBeDisabled();

      rerender(<AddressBar {...BAR} zoom={0.25} />);
      expect(control("Zoom out")).toBeDisabled();
    });
  });

  describe("the zoom indicator", () => {
    it("says nothing until the user zooms", () => {
      render(<AddressBar {...BAR} zoom={1.5} />);

      expect(screen.queryByRole("status")).toBeNull();
    });

    it("shows the zoom the user zoomed to", () => {
      render(<AddressBar {...BAR} zoom={1.5} zoomsAnnounced={1} />);

      expect(screen.getByRole("status")).toHaveTextContent("150%");
    });

    // Hidden on `animationend`, not a timer, so the duration lives only in
    // the stylesheet.
    it("goes away when it has faded out, and comes back for the next zoom", () => {
      const { rerender } = render(
        <AddressBar {...BAR} zoom={1.1} zoomsAnnounced={1} />,
      );

      fireEvent.animationEnd(screen.getByRole("status"));
      expect(screen.queryByRole("status")).toBeNull();

      rerender(<AddressBar {...BAR} zoom={1.25} zoomsAnnounced={2} />);
      expect(screen.getByRole("status")).toHaveTextContent("125%");
    });
  });
});
