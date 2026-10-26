import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, within } from "@testing-library/react";

import { useDomicile } from "./domicile-provider";
import { mount } from "./mount";

const Focused = () => <p>{useDomicile().windows.focused ?? "the shell"}</p>;

const Broken = () => {
  throw new Error("no wallpaper");
};

const roots: HTMLElement[] = [];

/** A root on the page, as Domicile hands `Shell` one. */
const pageRoot = () => {
  const root = document.createElement("div");
  document.body.append(root);
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    root.remove();
  }
});

describe("mount", () => {
  it("draws the app with the desktop it is handed, before returning", () => {
    const fake = new FakeDomicileHost();
    fake.set({ focusedWindow: "term" });
    const root = pageRoot();

    // The page draws nothing until `Shell` returns, so the app must be in it
    // by then.
    act(() => {
      mount(Focused)(root, fake.domicile);
      expect(within(root).getByText("term")).toBeInTheDocument();
    });
  });

  it("draws in an element of its own, keeping what `root` already holds", () => {
    const root = pageRoot();
    const report = document.createElement("pre");
    root.append(report);

    act(() => {
      mount(Focused)(root, new FakeDomicileHost().domicile);
    });

    expect(root.firstElementChild).toBe(report);
    expect(within(root).getByText("the shell")).toBeInTheDocument();
  });

  it("lays the app out as if drawn in `root`, which sizes it", () => {
    const root = pageRoot();

    act(() => {
      mount(Focused)(root, new FakeDomicileHost().domicile);
    });

    expect(root.lastElementChild).toHaveStyle({ display: "contents" });
  });

  it("says the app stopped working, with the error, when it throws", () => {
    // React logs the error the boundary caught; that is the failure under test.
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    const root = pageRoot();

    act(() => {
      mount(Broken)(root, new FakeDomicileHost().domicile);
    });

    expect(within(root).getByRole("alert")).toHaveTextContent(
      "Something went wrong",
    );
    expect(within(root).getByText("no wallpaper")).toBeInTheDocument();
    logged.mockRestore();
  });
});
