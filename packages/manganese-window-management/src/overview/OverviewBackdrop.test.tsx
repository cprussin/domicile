import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

import type { Rect } from "../rect";
import { besideOf, overviewOf } from "./fixture";
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
        cards={{}}
        closing={false}
        onClosed={() => undefined}
        overviews={[overviewOf(false)]}
      />,
    );

    expect(backdropOf(container).textContent).toBe("13");
  });

  it("pulls back from the shown workspace's tile, and pushes back into it as it closes", () => {
    // The tiles move with the windows: from the camera on workspace 3, which
    // fills the screen, to where they rest, and back.
    const gridOf = (closing: boolean) => {
      const { container, unmount } = render(
        <OverviewBackdrop
          cards={{}}
          closing={closing}
          onClosed={() => undefined}
          overviews={[overviewOf(closing)]}
        />,
      );
      const grid = container.querySelector<HTMLElement>("[data-overview-grid]");
      const style = {
        from: grid?.style.getPropertyValue("--overview-from"),
        to: grid?.style.getPropertyValue("--overview-to"),
      };
      unmount();
      return style;
    };
    const opening = gridOf(false);
    const closing = gridOf(true);

    expect(opening.from).toMatch(/^matrix\(/);
    expect(opening.to).toBe("");
    expect(closing.to).toBe(opening.from);
  });

  it("slides the two tiles' cards along with their windows as they swap", () => {
    // The same cards, moved, so a swap cut short turns back as its windows
    // do. The names stay: they are the workspaces' places.
    const overview = overviewOf(false);
    const [one, three] = overview.tiles;
    const { container, rerender } = render(
      <OverviewBackdrop
        cards={{}}
        closing={false}
        onClosed={() => undefined}
        overviews={[overview]}
      />,
    );
    const cardOf = (id: string) =>
      container.querySelector<HTMLElement>(`[data-overview-card="${id}"]`);
    const before = cardOf("3");

    rerender(
      <OverviewBackdrop
        cards={{ "1": "3", "3": "1" }}
        closing={false}
        onClosed={() => undefined}
        overviews={[overview]}
      />,
    );

    // Screen-sized and shown through its tile, as the windows are, so its
    // size eases with them too.
    const { screen } = overview.screen.geometry;
    const seenIn = (box: Rect | undefined) => {
      const scale = (box?.width ?? 0) / screen.width;
      return `matrix(${scale.toString()}, 0, 0, ${scale.toString()}, ${(box?.x ?? 0).toString()}, ${(box?.y ?? 0).toString()})`;
    };
    expect(cardOf("3")).toBe(before);
    expect(cardOf("3")?.style.getPropertyValue("--card-at")).toBe(
      seenIn(one?.box),
    );
    expect(cardOf("1")?.style.getPropertyValue("--card-at")).toBe(
      seenIn(three?.box),
    );
    expect(cardOf("1")?.style.getPropertyValue("inline-size")).toBe(
      `${screen.width.toString()}px`,
    );
    expect(container.textContent).toBe("13");
  });

  it("draws a second screen's cards from that screen's corner", () => {
    const right = besideOf(overviewOf(false));
    const [five, six] = right.tiles;
    const { container } = render(
      <OverviewBackdrop
        cards={{ "5": "6", "6": "5" }}
        closing={false}
        onClosed={() => undefined}
        overviews={[overviewOf(false), right]}
      />,
    );
    const { screen } = right.screen.geometry;
    const seenIn = (box: Rect | undefined) => {
      const scale = (box?.width ?? 0) / screen.width;
      return `matrix(${scale.toString()}, 0, 0, ${scale.toString()}, ${((box?.x ?? 0) - screen.x).toString()}, ${((box?.y ?? 0) - screen.y).toString()})`;
    };
    const cardOf = (id: string) =>
      container.querySelector<HTMLElement>(`[data-overview-card="${id}"]`);

    expect(screen.x).not.toBe(0);
    expect(cardOf("6")?.style.getPropertyValue("--card-at")).toBe(
      seenIn(five?.box),
    );
    expect(cardOf("5")?.style.getPropertyValue("--card-at")).toBe(
      seenIn(six?.box),
    );
  });

  it("slides a card crossing to another monitor in from where it was", () => {
    // Each screen's cards are its own, so the card is drawn afresh on the
    // other: from its old tile, as that screen sees it.
    const left = overviewOf(false);
    const right = besideOf(left);
    const { container, rerender } = render(
      <OverviewBackdrop
        cards={{}}
        closing={false}
        onClosed={() => undefined}
        overviews={[left, right]}
      />,
    );
    const threesBox = left.tiles.find(({ name }) => name === "3")?.box;

    rerender(
      <OverviewBackdrop
        cards={{ "3": "5", "5": "3" }}
        closing={false}
        onClosed={() => undefined}
        overviews={[left, right]}
      />,
    );

    const { screen } = right.screen.geometry;
    const crossed = container.querySelector<HTMLElement>(
      '[data-overview-card="3"]',
    );
    const scale = (threesBox?.width ?? 0) / screen.width;
    expect(crossed?.closest("[data-overview-backdrop]")).toBe(
      container.querySelectorAll("[data-overview-backdrop]")[1] ?? null,
    );
    expect(crossed?.style.getPropertyValue("--card-from")).toBe(
      `matrix(${scale.toString()}, 0, 0, ${scale.toString()}, ${((threesBox?.x ?? 0) - screen.x).toString()}, ${((threesBox?.y ?? 0) - screen.y).toString()})`,
    );
    // Its next drawing is where it is.
    rerender(
      <OverviewBackdrop
        cards={{ "3": "5", "5": "3" }}
        closing={false}
        onClosed={() => undefined}
        overviews={[left, right]}
      />,
    );
    expect(
      container
        .querySelector<HTMLElement>('[data-overview-card="3"]')
        ?.style.getPropertyValue("--card-from"),
    ).toBe("");
  });

  it("is not closed by its fade in ending", () => {
    const closed: string[] = [];
    const { container } = render(
      <OverviewBackdrop
        cards={{}}
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
          cards={{}}
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
