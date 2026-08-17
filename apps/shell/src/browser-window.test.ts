import { beforeEach, describe, expect, it } from "bun:test";

import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import { WEBVIEW_NAVIGATE_EVENT } from "@domicile/chrome-sdk/webview-element";

import { createBrowserWindow } from "./browser-window";

const viewOf = (window: Element): DomicileWebviewElement => {
  const view = window.querySelector("domicile-webview");
  if (view === null) {
    throw new Error("test setup: the browser window embedded no webview");
  }
  return view as DomicileWebviewElement;
};

const addressOf = (window: Element): HTMLInputElement => {
  const address = window.querySelector<HTMLInputElement>(
    'input[aria-label="Address"]',
  );
  if (address === null) {
    throw new Error("test setup: the browser window has no address field");
  }
  return address;
};

const click = (window: Element, label: string): void => {
  const button = window.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (button === null) {
    throw new Error(`test setup: the browser window has no ${label} button`);
  }
  button.click();
};

const submitAddress = (window: Element, url: string): void => {
  addressOf(window).value = url;
  window
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { cancelable: true }));
};

const navigate = (view: DomicileWebviewElement, url: string): void => {
  view.dispatchEvent(
    new CustomEvent(WEBVIEW_NAVIGATE_EVENT, { detail: { url } }),
  );
};

describe("createBrowserWindow", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // The webview element ignores the bridge; registration is what defines it.
    registerElements({} as BridgeClient);
  });

  it("opens the requested page with its address on show", () => {
    const window = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(window);

    expect(viewOf(window).src).toBe("https://example.com");
    expect(addressOf(window).value).toBe("https://example.com");
  });

  it("drives the page from the navigation controls", () => {
    const window = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(window);
    const calls: string[] = [];
    Object.assign(viewOf(window), {
      goBack: () => calls.push("goBack"),
      goForward: () => calls.push("goForward"),
      reload: () => calls.push("reload"),
      stop: () => calls.push("stop"),
    });

    click(window, "Back");
    click(window, "Forward");
    click(window, "Stop");
    click(window, "Reload");
    expect(calls).toEqual(["goBack", "goForward", "stop", "reload"]);
  });

  it("loads the address the user submits", () => {
    const window = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(window);

    submitAddress(window, "https://other.example/docs");
    expect(viewOf(window).src).toBe("https://other.example/docs");
  });

  it("assumes https for an address typed without a scheme", () => {
    const window = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(window);

    submitAddress(window, "other.example");
    expect(viewOf(window).src).toBe("https://other.example");
  });

  it("follows the page wherever it navigates", async () => {
    const reported = await new Promise((resolve) => {
      const window = createBrowserWindow({
        onNavigate: resolve,
        src: "https://example.com",
      });
      document.body.append(window);
      navigate(viewOf(window), "https://example.com/docs");

      expect(addressOf(window).value).toBe("https://example.com/docs");
    });

    expect(reported).toBe("https://example.com/docs");
  });
});
