import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";
import { act, render, screen } from "@testing-library/react";

import { useAppearance } from "./appearance";
import { DomicileProvider } from "./domicile-provider";

const Shows = () => {
  const { accentColor, highContrast, reducedMotion } = useAppearance();
  return (
    <span>
      {[accentColor ?? "own accent", highContrast, reducedMotion].join(" ")}
    </span>
  );
};

describe("useAppearance", () => {
  it("is the config's appearance, following each change", () => {
    const fake = new FakeDomicileHost();
    render(
      <DomicileProvider domicile={fake.domicile}>
        <Shows />
      </DomicileProvider>,
    );
    expect(screen.getByText("own accent false false")).toBeInTheDocument();

    act(() => {
      fake.set({ accentColor: "#336699", reducedMotion: true });
    });

    expect(screen.getByText("#336699 false true")).toBeInTheDocument();
  });
});
