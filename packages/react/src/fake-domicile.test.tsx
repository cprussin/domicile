import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { FakeDomicile } from "./fake-domicile";
import { useFocusedWindow } from "./windows";

const Focused = () => <span>{useFocusedWindow() ?? "the shell"}</span>;

describe("FakeDomicile", () => {
  it("hands the hooks below the desktop the test drives", () => {
    const fake = new FakeDomicileHost();
    render(
      <FakeDomicile fake={fake}>
        <Focused />
      </FakeDomicile>,
    );

    act(() => {
      fake.set({ focusedWindow: "term" });
    });

    expect(screen.getByText("term")).toBeInTheDocument();
  });

  it("hands a desktop of its own to a test that drives none", () => {
    render(
      <FakeDomicile>
        <Focused />
      </FakeDomicile>,
    );

    expect(screen.getByText("the shell")).toBeInTheDocument();
  });
});
