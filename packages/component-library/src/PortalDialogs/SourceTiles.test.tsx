import { describe, expect, it, mock } from "bun:test";
import type { FrozenDesk } from "@domicile-desktop/sdk/portal";
import { MonitorIcon } from "@phosphor-icons/react/dist/ssr/Monitor";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SourceTile } from "./SourceTiles";
import { SourceTiles } from "./SourceTiles";

const DESK: FrozenDesk = {
  desk: { position: [0, 0], size: [300, 100] },
  frame: "data:image/png;base64,AA==",
  height: 100,
  monitors: [],
  width: 300,
  windows: [],
};

const tile = (key: string, area: SourceTile["area"]): SourceTile => ({
  area,
  icon: <MonitorIcon aria-hidden />,
  key,
  name: `Source ${key}`,
});

/** The preview drawn on the tile named `name`. */
const preview = (name: string): HTMLElement | null =>
  screen.getByRole("button", { name }).querySelector("[data-preview]");

describe("SourceTiles", () => {
  it("previews each source cropped from the desk, under the group's name", () => {
    render(
      <SourceTiles
        desk={DESK}
        label="Screens"
        multiple={false}
        onValueChange={() => undefined}
        tiles={[tile("a", { height: 50, width: 100, x: 100, y: 0 })]}
        value={[]}
      />,
    );

    expect(screen.getByRole("group", { name: "Screens" })).toBeInTheDocument();
    expect(preview("Source a")).toHaveStyle({
      backgroundImage: "url(data:image/png;base64,AA==)",
      backgroundPosition: "50% 0%",
      backgroundSize: "300% 200%",
    });
  });

  it("draws a source's icon instead where it has no preview", () => {
    render(
      <SourceTiles
        desk={undefined}
        label="Screens"
        multiple={false}
        onValueChange={() => undefined}
        tiles={[tile("a", { height: 50, width: 100, x: 100, y: 0 })]}
        value={[]}
      />,
    );

    expect(preview("Source a")?.querySelector("svg")).not.toBeNull();
    expect(preview("Source a")).not.toHaveStyle({
      backgroundImage: "url(data:image/png;base64,AA==)",
    });
  });

  it("shows which sources are picked and picks another", async () => {
    const picked = mock((_: string[]) => undefined);
    render(
      <SourceTiles
        desk={DESK}
        label="Screens"
        multiple
        onValueChange={picked}
        tiles={[tile("a", undefined), tile("b", undefined)]}
        value={["a"]}
      />,
    );

    expect(screen.getByRole("button", { name: "Source a" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Source b" }));
    expect(picked.mock.calls[0]?.[0]).toEqual(["a", "b"]);
  });
});
