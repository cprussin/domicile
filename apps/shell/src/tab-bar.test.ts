import { beforeEach, describe, expect, it } from "bun:test";

import { TabBar } from "./tab-bar";

const tabs = (root: Element): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
];

const labels = (root: Element): (string | null)[] =>
  tabs(root).map((tab) => tab.textContent);

const selected = (root: Element): (string | null)[] =>
  tabs(root)
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.textContent);

describe("TabBar", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="tabs"></div>';
    const strip = document.querySelector("#tabs");
    if (strip === null) {
      throw new Error("test setup: #tabs is missing");
    }
    root = strip as HTMLElement;
  });

  it("shows a tab per open window, in the order they opened", () => {
    const bar = new TabBar({ onSelect: () => undefined, root });
    bar.open("app:term", "Terminal");
    bar.open("browser:1", "example.com");

    expect(labels(root)).toEqual(["Terminal", "example.com"]);
  });

  it("reports the window whose tab was clicked", async () => {
    const clicked = await new Promise((resolve) => {
      const bar = new TabBar({ onSelect: resolve, root });
      bar.open("app:term", "Terminal");
      bar.open("browser:1", "example.com");
      tabs(root)[1]?.click();
    });

    expect(clicked).toBe("browser:1");
  });

  it("marks only the active window's tab", () => {
    const bar = new TabBar({ onSelect: () => undefined, root });
    bar.open("app:term", "Terminal");
    bar.open("browser:1", "example.com");

    bar.activate("browser:1");
    expect(selected(root)).toEqual(["example.com"]);

    bar.activate("app:term");
    expect(selected(root)).toEqual(["Terminal"]);
  });

  it("relabels a tab when its window's title changes", () => {
    const bar = new TabBar({ onSelect: () => undefined, root });
    bar.open("browser:1", "example.com");

    bar.rename("browser:1", "docs.example.com");
    expect(labels(root)).toEqual(["docs.example.com"]);
  });

  it("drops a tab when its window closes", () => {
    const bar = new TabBar({ onSelect: () => undefined, root });
    bar.open("app:term", "Terminal");
    bar.open("browser:1", "example.com");

    bar.close("app:term");
    expect(labels(root)).toEqual(["example.com"]);
  });

  it("refuses to touch a window it never opened", () => {
    const bar = new TabBar({ onSelect: () => undefined, root });

    expect(() => {
      bar.activate("app:ghost");
    }).toThrow("app:ghost");
    expect(() => {
      bar.rename("app:ghost", "Ghost");
    }).toThrow("app:ghost");
    expect(() => {
      bar.close("app:ghost");
    }).toThrow("app:ghost");
  });
});
