import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { DomicileProvider } from "./domicile-provider";
import { useIdle, useLocked } from "./session";

const Shows = () => (
  <span>{`idle ${useIdle() ?? "?"}, locked ${useLocked() ?? "?"}`}</span>
);

describe("useIdle and useLocked", () => {
  it("are undefined until the compositor says, then follow it", () => {
    const fake = new FakeDomicileHost();
    render(
      <DomicileProvider domicile={fake.domicile}>
        <Shows />
      </DomicileProvider>,
    );
    expect(screen.getByText("idle ?, locked ?")).toBeInTheDocument();

    act(() => {
      fake.set({ idle: true, locked: false });
    });

    expect(screen.getByText("idle true, locked false")).toBeInTheDocument();
  });
});
