import { describe, expect, it } from "bun:test";
import { ConnectionSafety } from "@domicile-desktop/manganese-address/connection-safety";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { css } from "../../styled-system/css";
import { AddressBar } from "./AddressBar";

/** Shared props; each case overrides what it tests. */
const BAR = {
  address: "https://example.com",
  canGoBack: false,
  canGoForward: false,
  downloads: {
    completed: 0,
    completedPaths: [],
    count: 0,
    receivedBytes: 0,
    totalBytes: 0,
  },
  holdZoom: false,
  isPrivate: false,
  loading: false,
  loadProgress: 0,
  onBack: () => undefined,
  onClearDownloads: () => undefined,
  onDownloadsAnchor: () => undefined,
  onForward: () => undefined,
  onNavigate: () => undefined,
  onReload: () => undefined,
  onSetSitePermission: () => undefined,
  onShowDownloads: () => undefined,
  onStop: () => undefined,
  onZoomAnchor: () => undefined,
  onZoomIn: () => undefined,
  onZoomOut: () => undefined,
  onZoomReset: () => undefined,
  permissionRequest: undefined,
  security: ConnectionSafety.Secure,
  sitePermissions: [],
  visited: ["https://example.com"],
  zoom: 1,
} as const;

const address = (): HTMLInputElement =>
  screen.getByRole("combobox", { name: "Address" });

const control = (name: string): HTMLElement =>
  screen.getByRole("button", { name });

describe("AddressBar", () => {
  it("shuts its lock when a page turns out to be secure", () => {
    const { rerender } = render(
      <AddressBar {...BAR} security={ConnectionSafety.Unstated} />,
    );
    expect(document.querySelector("[data-part=shackle]")).toBeNull();
    rerender(<AddressBar {...BAR} />);

    expect(document.querySelector("[data-part=shackle]")).not.toBeNull();
  });

  it("shows where the window was sent", () => {
    render(<AddressBar {...BAR} />);

    expect(address()).toHaveValue("https://example.com");
  });

  // The open tab above is the same color, so the two read as one piece of
  // chrome.
  it("is the same surface as the open tab above", () => {
    render(<AddressBar {...BAR} />);

    expect(address().closest("form")?.className).toContain(
      css({ backgroundColor: "chrome" }),
    );
  });

  describe("a private window", () => {
    it("says it is private beside the address", () => {
      render(<AddressBar {...BAR} isPrivate />);

      expect(screen.getByText("Private")).toBeInTheDocument();
    });

    it("says nothing of the kind for an ordinary window", () => {
      render(<AddressBar {...BAR} />);

      expect(screen.queryByText("Private")).toBeNull();
    });
  });

  it("puts the site permissions just after the connection", () => {
    render(<AddressBar {...BAR} />);

    const buttons = screen.getAllByRole("button");
    const connection = buttons.indexOf(
      screen.getByRole("button", { name: /^Connection/ }),
    );

    expect(buttons[connection + 1]).toBe(control("Site permissions"));
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

    it("spins its arrow into the X, in the same drawing, as a page starts arriving", () => {
      const { rerender } = render(<AddressBar {...BAR} />);
      const svg = control("Reload").querySelector("svg");
      rerender(<AddressBar {...BAR} loading />);

      expect(control("Stop").querySelector("svg")).toBe(svg);
      expect(
        control("Stop").querySelector("[data-part=arrow]"),
      ).toHaveAttribute("data-state", "hidden");
    });
  });

  describe("the loading bar", () => {
    it("says how far a page that is arriving has loaded", () => {
      render(<AddressBar {...BAR} loading loadProgress={0.4} />);

      expect(
        screen.getByRole("progressbar", { name: "Loading" }),
      ).toHaveAttribute("aria-valuenow", "40");
    });

    it("is gone once the page has arrived", () => {
      render(<AddressBar {...BAR} />);

      expect(screen.queryByRole("progressbar")).toBeNull();
    });
  });

  describe("the download indicator", () => {
    it("says how far the page's download has come", () => {
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 0,
            completedPaths: [],
            count: 1,
            receivedBytes: 456,
            totalBytes: 1000,
          }}
        />,
      );

      const indicator = screen.getByRole("progressbar", {
        name: "Downloading",
      });
      expect(indicator).toHaveAttribute("aria-valuenow", "45");
      expect(indicator).toHaveTextContent("45%");
    });

    it("says how many files when there are several", () => {
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 0,
            completedPaths: [],
            count: 3,
            receivedBytes: 10,
            totalBytes: 100,
          }}
        />,
      );

      expect(
        screen.getByRole("progressbar", { name: "Downloading 3 files" }),
      ).toBeInTheDocument();
    });

    // A sum missing one size would read as nearly done when it is not.
    it("claims no amount when a download's size is unknown", () => {
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 0,
            completedPaths: [],
            count: 1,
            receivedBytes: 10,
            totalBytes: 0,
          }}
        />,
      );

      const indicator = screen.getByRole("progressbar", {
        name: "Downloading",
      });
      expect(indicator).not.toHaveAttribute("aria-valuenow");
      expect(indicator.textContent).toBe("");
    });

    it("keeps saying a download finished until it is cleared", async () => {
      const calls: string[] = [];
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 1,
            completedPaths: [],
            count: 0,
            receivedBytes: 0,
            totalBytes: 0,
          }}
          onClearDownloads={() => {
            calls.push("clear");
          }}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent("Downloaded");
      await userEvent.click(control("Clear finished downloads"));

      expect(calls).toStrictEqual(["clear"]);
    });

    it("shows the finished downloads when pressed", async () => {
      const calls: string[] = [];
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 1,
            completedPaths: [],
            count: 0,
            receivedBytes: 0,
            totalBytes: 0,
          }}
          onShowDownloads={() => {
            calls.push("show");
          }}
        />,
      );

      await userEvent.click(control("Downloaded"));

      expect(calls).toStrictEqual(["show"]);
    });

    it("hands over the indicator for the downloads popup to hang from", () => {
      const anchors: (HTMLElement | null)[] = [];
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 1,
            completedPaths: [],
            count: 0,
            receivedBytes: 0,
            totalBytes: 0,
          }}
          onDownloadsAnchor={(anchor) => {
            anchors.push(anchor);
          }}
        />,
      );

      expect(anchors.at(-1)).toContainElement(screen.getByRole("status"));
    });

    it("says how many finished when there are several", () => {
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 2,
            completedPaths: [],
            count: 0,
            receivedBytes: 0,
            totalBytes: 0,
          }}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent("2 downloaded");
    });

    // The finished ones wait until nothing is in progress.
    it("shows progress over finished downloads", () => {
      render(
        <AddressBar
          {...BAR}
          downloads={{
            completed: 1,
            completedPaths: [],
            count: 1,
            receivedBytes: 10,
            totalBytes: 100,
          }}
        />,
      );

      expect(
        screen.getByRole("progressbar", { name: "Downloading" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("is gone when nothing is downloading", () => {
      render(<AddressBar {...BAR} />);

      expect(
        screen.queryByRole("progressbar", { name: /Downloading/ }),
      ).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
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

    it("stays out of the way at 100%", () => {
      render(<AddressBar {...BAR} zoom={1} />);

      expect(screen.queryByRole("group", { name: "Zoom" })).toBeNull();
    });

    it("stays at 100% while the zoom popup hangs from it", () => {
      render(<AddressBar {...BAR} holdZoom zoom={1} />);

      expect(screen.getByRole("group", { name: "Zoom" })).toBeInTheDocument();
    });

    it("hands over its controls for the zoom popup to hang from", () => {
      const anchors: (HTMLElement | null)[] = [];
      render(
        <AddressBar
          {...BAR}
          onZoomAnchor={(anchor) => {
            anchors.push(anchor);
          }}
          zoom={1.25}
        />,
      );

      expect(anchors.at(-1)).toBe(screen.getByRole("group", { name: "Zoom" }));
    });

    it("grays out zooming past either end", () => {
      const { rerender } = render(<AddressBar {...BAR} zoom={5} />);
      expect(control("Zoom in")).toBeDisabled();

      rerender(<AddressBar {...BAR} zoom={0.25} />);
      expect(control("Zoom out")).toBeDisabled();
    });
  });
});
