import { describe, expect, it } from "bun:test";
import { WEBVIEW_TOOLTIP_CHANGE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { act, render, screen } from "@testing-library/react";

import { BELOW_POINTER, PageTooltip } from "./PageTooltip";

/** A fake `<webview>` showing `text` with the pointer at (`x`, `y`). */
const showing = (text: string, x = 0, y = 0) => {
  const element = document.createElement("webview");
  for (const [name, value] of [
    ["tooltip", text],
    ["tooltipX", x],
    ["tooltipY", y],
  ] as const) {
    Object.defineProperty(element, name, { configurable: true, value });
  }
  return element;
};

describe("PageTooltip", () => {
  it("shows the page's tooltip below the pointer", () => {
    render(<PageTooltip view={showing("Bold (Ctrl+B)", 40, 60)} />);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Bold (Ctrl+B)");
    expect(tip.style.insetInlineStart).toBe("40px");
    expect(tip.style.insetBlockStart).toBe(`${60 + BELOW_POINTER}px`);
  });

  it("shows nothing while the page has no tooltip", () => {
    render(<PageTooltip view={showing("")} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides when the page's tooltip goes away", () => {
    const view = showing("Bold");
    render(<PageTooltip view={view} />);
    Object.defineProperty(view, "tooltip", { configurable: true, value: "" });
    act(() => {
      view.dispatchEvent(new Event(WEBVIEW_TOOLTIP_CHANGE_EVENT));
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
