import { beforeEach, describe, expect, it } from "bun:test";

import type { BridgeClient } from "@domicile/chrome-sdk/bridge";
import { registerElements } from "@domicile/chrome-sdk/register-elements";
import type { DomicileWebviewElement } from "@domicile/chrome-sdk/webview-element";
import { WEBVIEW_NAVIGATE_EVENT } from "@domicile/chrome-sdk/webview-element";

import { createBrowserWindow } from "./browser-window";

const viewOf = (element: Element): DomicileWebviewElement => {
  const view = element.querySelector("domicile-webview");
  if (view === null) {
    throw new Error("test setup: the browser window embedded no webview");
  }
  return view as DomicileWebviewElement;
};

const addressOf = (element: Element): HTMLInputElement => {
  const address = element.querySelector<HTMLInputElement>(
    'input[aria-label="Address"]',
  );
  if (address === null) {
    throw new Error("test setup: the browser window has no address field");
  }
  return address;
};

const click = (element: Element, label: string): void => {
  const button = element.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (button === null) {
    throw new Error(`test setup: the browser window has no ${label} button`);
  }
  button.click();
};

const submitAddress = (element: Element, url: string): void => {
  addressOf(element).value = url;
  element
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
    const { element } = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(element);

    expect(viewOf(element).src).toBe("https://example.com");
    expect(addressOf(element).value).toBe("https://example.com");
  });

  it("drives the page from the navigation controls", () => {
    const { element } = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(element);
    const calls: string[] = [];
    Object.assign(viewOf(element), {
      goBack: () => calls.push("goBack"),
      goForward: () => calls.push("goForward"),
      reload: () => calls.push("reload"),
      stop: () => calls.push("stop"),
    });

    click(element, "Back");
    click(element, "Forward");
    click(element, "Stop");
    click(element, "Reload");
    expect(calls).toEqual(["goBack", "goForward", "stop", "reload"]);
  });

  it("loads the address the user submits", () => {
    const { element } = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(element);

    submitAddress(element, "https://other.example/docs");
    expect(viewOf(element).src).toBe("https://other.example/docs");
  });

  it("assumes https for an address typed without a scheme", () => {
    const { element } = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(element);

    submitAddress(element, "other.example");
    expect(viewOf(element).src).toBe("https://other.example");
  });

  it("hands the keyboard to the page when focused", () => {
    const { element, focus } = createBrowserWindow({
      onNavigate: () => undefined,
      src: "https://example.com",
    });
    document.body.append(element);
    const focused: string[] = [];
    Object.assign(viewOf(element), {
      focus: () => focused.push("page"),
    });

    focus();
    expect(focused).toEqual(["page"]);
  });

  it("follows the page wherever it navigates", async () => {
    const reported = await new Promise((resolve) => {
      const { element } = createBrowserWindow({
        onNavigate: resolve,
        src: "https://example.com",
      });
      document.body.append(element);
      navigate(viewOf(element), "https://example.com/docs");

      expect(addressOf(element).value).toBe("https://example.com/docs");
    });

    expect(reported).toBe("https://example.com/docs");
  });
});
