import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { idleInhibitor } from "./idle-inhibitor";
import { KeepAwakeGlyph, KeepAwakeTile } from "./KeepAwake";
import type { Release } from "./portal-inhibit";

/** An inhibitor whose portal never answers. */
const unanswered = () =>
  idleInhibitor(() => Promise.withResolvers<never>().promise);

/** An inhibitor already held. */
const held = async () => {
  const inhibitor = idleInhibitor(() =>
    Promise.resolve(
      Ok<Release, SystemError>(() => Promise.resolve(Ok("released" as const))),
    ),
  );
  await act(async () => {
    inhibitor.toggle();
    await Promise.resolve();
  });
  return inhibitor;
};

describe(KeepAwakeGlyph, () => {
  it("shows nothing while the screens blank when idle", () => {
    const { container } = render(<KeepAwakeGlyph inhibitor={unanswered()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an eye while the screens are kept on", async () => {
    render(<KeepAwakeGlyph inhibitor={await held()} />);
    expect(
      screen.getByRole("img", { name: "Screens kept on" }),
    ).toBeInTheDocument();
  });

  it("shows an eye while something else keeps them on", () => {
    render(<KeepAwakeGlyph holders={["mpv"]} inhibitor={unanswered()} />);
    expect(
      screen.getByRole("img", { name: "Screens kept on by mpv" }),
    ).toBeInTheDocument();
  });
});

describe(KeepAwakeTile, () => {
  it("holds the inhibitor when pressed, waiting on the portal", async () => {
    const taking = Promise.withResolvers<Result<Release, SystemError>>();
    render(<KeepAwakeTile inhibitor={idleInhibitor(() => taking.promise)} />);
    const tile = screen.getByRole("button", { name: "Keep awake" });
    expect(tile).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Off")).toBeInTheDocument();

    await userEvent.click(tile);
    expect(tile).toBeDisabled();
    await act(async () => {
      taking.resolve(Ok(() => Promise.resolve(Ok("released" as const))));
      await taking.promise;
    });

    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("names what else keeps the screens on", () => {
    render(
      <KeepAwakeTile holders={["Slack", "mpv"]} inhibitor={unanswered()} />,
    );
    expect(screen.getByText("Kept on by Slack and mpv")).toBeInTheDocument();
  });
});
