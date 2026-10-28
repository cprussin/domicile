import { describe, expect, it, spyOn } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import type { Shell } from "@domicile-desktop/sdk/shell";
import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";

import { FakeDomicile } from "./fake-domicile";
import { mount } from "./mount";
import { NestedShell } from "./nested-shell";

const Focused: Shell = (root, domicile) => {
  const p = document.createElement("p");
  p.textContent = domicile.windows.focused ?? "the shell";
  root.append(p);
};

describe("NestedShell", () => {
  it("runs the shell in a box of its own, on the desktop above", async () => {
    const fake = new FakeDomicileHost();
    fake.set({ focusedWindow: "term" });

    render(
      <FakeDomicile fake={fake}>
        <NestedShell shell={Focused} />
      </FakeDomicile>,
    );

    expect(await screen.findByText("term")).toBeInTheDocument();
  });

  // `mount` draws synchronously, which React refuses while it commits.
  it("runs a `mount`ed shell without React's warnings", async () => {
    const error = spyOn(console, "error");

    render(
      <FakeDomicile>
        <NestedShell shell={mount(() => <p>inner</p>)} />
      </FakeDomicile>,
    );

    expect(await screen.findByText("inner")).toBeInTheDocument();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  // `Shell` runs once per page and can't be undone, so strict mode's second
  // effect must not run it again.
  it("runs the shell once in strict mode", async () => {
    render(
      <StrictMode>
        <FakeDomicile>
          <NestedShell shell={Focused} />
        </FakeDomicile>
      </StrictMode>,
    );

    expect(await screen.findAllByText("the shell")).toHaveLength(1);
  });

  it("lays the shell out against the element it is placed in", async () => {
    render(
      <FakeDomicile>
        <NestedShell shell={Focused} />
      </FakeDomicile>,
    );

    expect((await screen.findByText("the shell")).parentElement).toHaveStyle({
      display: "contents",
    });
  });
});
