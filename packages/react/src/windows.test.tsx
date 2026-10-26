import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { DomicileProvider } from "./domicile-provider";
import { useFocusedWindow, useWindows } from "./windows";

const Titles = () => (
  <span>
    {useWindows()
      .map(({ title }) => title)
      .join(", ") || "none"}
  </span>
);

const Focused = () => <span>{useFocusedWindow() ?? "the shell"}</span>;

const rendered = (fake: FakeDomicileHost) =>
  render(
    <DomicileProvider domicile={fake.domicile}>
      <Titles />
      <Focused />
    </DomicileProvider>,
  );

describe("useWindows", () => {
  it("is every window, following each that appears or closes", () => {
    const fake = new FakeDomicileHost();
    fake.appear("term", { title: "Terminal" });
    rendered(fake);
    expect(screen.getByText("Terminal")).toBeInTheDocument();

    act(() => {
      fake.appear("web", { title: "Browser" });
    });
    expect(screen.getByText("Terminal, Browser")).toBeInTheDocument();

    act(() => {
      fake.close("term");
      fake.close("web");
    });
    expect(screen.getByText("none")).toBeInTheDocument();
  });
});

describe("useFocusedWindow", () => {
  it("is the window holding the keyboard, as it moves", () => {
    const fake = new FakeDomicileHost();
    rendered(fake);
    expect(screen.getByText("the shell")).toBeInTheDocument();

    act(() => {
      fake.set({ focusedWindow: "term" });
    });

    expect(screen.getByText("term")).toBeInTheDocument();
  });
});
