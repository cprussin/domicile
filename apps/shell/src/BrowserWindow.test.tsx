import { beforeEach, describe, expect, it } from "bun:test";
import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import type { Measure } from "@domicile/chrome-sdk/measure";
import {
  registerElements,
  WEBVIEW_TAG_NAME,
} from "@domicile/chrome-sdk/register-elements";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import { WEBVIEW_NAVIGATE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BrowserWindow } from "./BrowserWindow";

const silentBridge = {
  focusApp: () => undefined,
  focusChrome: () => undefined,
  placePortal: () => undefined,
  removePortal: () => undefined,
  resizeApp: () => undefined,
} as unknown as BridgeClient;

const stubMeasure: Measure = () => ({
  size: [100, 100],
  transform: [1, 0, 0, 1, 0, 0],
  visible: true,
  zIndex: 0,
});

const view = (container: HTMLElement): DomicileWebviewElement => {
  const element = container.querySelector(WEBVIEW_TAG_NAME);
  if (element === null) {
    throw new Error("test: the browser window rendered no view");
  } else {
    return element as DomicileWebviewElement;
  }
};

const navigateTo = (element: DomicileWebviewElement, url: string): void => {
  act(() => {
    element.dispatchEvent(
      new CustomEvent(WEBVIEW_NAVIGATE_EVENT, { detail: { url } }),
    );
  });
};

const address = (): HTMLInputElement =>
  screen.getByRole("textbox", { name: "Address" });

beforeEach(() => {
  registerElements(silentBridge, { measure: stubMeasure });
});

describe("BrowserWindow", () => {
  it("points its view at the address it opened with", () => {
    const { container } = render(
      <BrowserWindow
        active
        onNavigate={() => undefined}
        src="https://example.com"
      />,
    );
    expect(view(container).getAttribute("src")).toBe("https://example.com");
    expect(address()).toHaveValue("https://example.com");
  });

  describe("the address bar", () => {
    it("loads what was typed, filling in a missing scheme", async () => {
      const { container } = render(
        <BrowserWindow
          active
          onNavigate={() => undefined}
          src="https://example.com"
        />,
      );
      await userEvent.clear(address());
      await userEvent.type(address(), "docs.example.com{Enter}");
      expect(view(container).getAttribute("src")).toBe(
        "https://docs.example.com",
      );
    });

    it("follows the page wherever it goes", () => {
      const { container } = render(
        <BrowserWindow
          active
          onNavigate={() => undefined}
          src="https://example.com"
        />,
      );
      navigateTo(view(container), "https://example.com/deep/link");
      expect(address()).toHaveValue("https://example.com/deep/link");
    });

    it("reports each navigation so the window's tab can be retitled", () => {
      const seen: string[] = [];
      const { container } = render(
        <BrowserWindow
          active
          onNavigate={(url) => {
            seen.push(url);
          }}
          src="https://example.com"
        />,
      );
      navigateTo(view(container), "https://docs.example.com/");
      expect(seen).toStrictEqual(["https://docs.example.com/"]);
    });
  });

  it("hides the window when it is not on the stage", () => {
    render(
      <BrowserWindow
        active={false}
        onNavigate={() => undefined}
        src="https://example.com"
      />,
    );
    // A hidden element is out of the accessibility tree, so it has no
    // accessible name left to match on — being the only region is enough.
    expect(screen.getByRole("region", { hidden: true })).not.toBeVisible();
  });
});
