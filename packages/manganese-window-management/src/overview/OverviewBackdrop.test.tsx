import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import { overviewOf } from "./fixture";
import { OverviewBackdrop } from "./OverviewBackdrop";

const backdropOf = (container: HTMLElement): Element => {
  const found = container.querySelector("[data-overview-backdrop]");
  if (found === null) {
    throw new Error("test: no backdrop");
  } else {
    return found;
  }
};

describe("OverviewBackdrop", () => {
  it("names each workspace under its tile", () => {
    const { container } = render(
      <OverviewBackdrop
        closing={false}
        onClosed={() => undefined}
        overviews={[overviewOf(false)]}
      />,
    );

    expect(backdropOf(container).textContent).toBe("13");
  });

  it("is not closed by its fade in ending", () => {
    const closed: string[] = [];
    const { container } = render(
      <OverviewBackdrop
        closing={false}
        onClosed={() => closed.push("closed")}
        overviews={[overviewOf(false)]}
      />,
    );

    fireEvent.animationEnd(backdropOf(container));

    expect(closed).toStrictEqual([]);
  });

  it("says when it has faded out", async () => {
    const closed = new Promise<void>((resolve) => {
      const { container } = render(
        <OverviewBackdrop
          closing
          onClosed={resolve}
          overviews={[overviewOf(true)]}
        />,
      );
      fireEvent.animationEnd(backdropOf(container));
    });

    expect(await closed).toBeUndefined();
  });
});
