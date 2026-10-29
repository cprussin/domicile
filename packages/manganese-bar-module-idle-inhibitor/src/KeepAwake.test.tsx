import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { idleInhibitor } from "./idle-inhibitor";
import { KeepAwakeTile } from "./KeepAwake";
import type { Release } from "./portal-inhibit";

/** An inhibitor whose portal never answers. */
const unanswered = () =>
  idleInhibitor(() => Promise.withResolvers<never>().promise);

describe(KeepAwakeTile, () => {
  it("holds the inhibitor when pressed, waiting on the portal", async () => {
    const taking = Promise.withResolvers<Result<Release, SystemError>>();
    render(<KeepAwakeTile inhibitor={idleInhibitor(() => taking.promise)} />);
    const tile = screen.getByRole("button", { name: "Keep awake" });
    expect(tile).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(tile);
    expect(tile).toBeDisabled();
    await act(async () => {
      taking.resolve(Ok(() => Promise.resolve(Ok("released" as const))));
      await taking.promise;
    });

    expect(tile).toHaveAttribute("aria-pressed", "true");
  });

  it("names what else keeps the screens on, a website by its site", async () => {
    render(
      <KeepAwakeTile
        holders={["Slack", "mpv", "domicile-browser"]}
        inhibitor={unanswered()}
        pages={[{ icon: undefined, site: "youtube.com" }]}
      />,
    );

    await userEvent.hover(screen.getByRole("button", { name: "Keep awake" }));

    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent("Kept on by Slack, mpv, and youtube.com");
  });
});
