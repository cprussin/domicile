import { describe, expect, it } from "bun:test";

import { askingWindow } from "./asking-window";

/** A page drawing an `<app>` for each of `appIds`. */
const page = (...appIds: string[]): ParentNode => {
  const root = document.createElement("div");
  for (const appId of appIds) {
    const app = document.createElement("app");
    app.setAttribute("app-id", appId);
    root.append(app);
  }
  return root;
};

describe(askingWindow, () => {
  it("is the `<app>` showing the parent window", () => {
    expect(askingWindow(page("kitty", "app-3"), "app-3")).toHaveAttribute(
      "app-id",
      "app-3",
    );
  });

  it("is nothing without a parent window", () => {
    expect(askingWindow(page("kitty"), undefined)).toBeUndefined();
  });

  it("is nothing when the page does not draw the parent window", () => {
    expect(askingWindow(page("kitty"), "app-3")).toBeUndefined();
  });
});
