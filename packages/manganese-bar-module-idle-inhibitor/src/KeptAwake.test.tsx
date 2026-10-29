import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { idleInhibitor } from "./idle-inhibitor";
import { KeptAwake } from "./KeptAwake";
import type { Release } from "./portal-inhibit";

/** An inhibitor whose portal never answers. */
const unanswered = () =>
  idleInhibitor(() => Promise.withResolvers<never>().promise);

/** An inhibitor already held, which releases at once. */
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

describe(KeptAwake, () => {
  it("shows nothing while the screens blank when idle", () => {
    const { container } = render(<KeptAwake inhibitor={unanswered()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the one app keeping the screens on, once", () => {
    render(
      <KeptAwake holders={["Firefox", "Firefox"]} inhibitor={unanswered()} />,
    );
    expect(
      screen.getByRole("button", { name: "Kept awake by Firefox" }),
    ).toBeInTheDocument();
  });

  it("counts several apps, and lists them when opened", async () => {
    render(
      <KeptAwake holders={["Firefox", "Zoom"]} inhibitor={unanswered()} />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Kept awake by 2 apps" }),
    );

    const list = await screen.findByRole("list", {
      name: "Keeping your screens on",
    });
    expect(list).toHaveTextContent("Firefox");
    expect(list).toHaveTextContent("Zoom");
  });

  it("lets you turn off your own hold", async () => {
    render(<KeptAwake inhibitor={await held()} />);

    await userEvent.click(screen.getByRole("button", { name: "Kept awake" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Turn off" }),
    );

    expect(
      screen.queryByRole("button", { name: "Kept awake" }),
    ).not.toBeInTheDocument();
  });
});
