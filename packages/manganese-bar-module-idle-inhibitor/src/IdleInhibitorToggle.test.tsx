import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { css } from "../styled-system/css";
import { IdleInhibitorToggle } from "./IdleInhibitorToggle";
import { idleInhibitor } from "./idle-inhibitor";
import type { Release } from "./portal-inhibit";

const OFF = "Screens blank when idle — click to keep them on";
const ON = "Screens kept on — click to let them blank";

describe("IdleInhibitorToggle", () => {
  it("is pressed while the inhibitor is held, dimmed while not, and waits on the portal", async () => {
    const taking = Promise.withResolvers<Result<Release, SystemError>>();
    render(
      <IdleInhibitorToggle inhibitor={idleInhibitor(() => taking.promise)} />,
    );
    const toggle = screen.getByRole("button", { name: OFF });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.hover(toggle);
    expect(
      await screen.findByRole("tooltip", {}, { timeout: 2000 }),
    ).toHaveTextContent(OFF);
    expect(toggle.className).toContain(
      css({ "& > svg": { opacity: "inactive" } }),
    );

    await userEvent.click(toggle);
    expect(toggle).toBeDisabled();
    await act(async () => {
      taking.resolve(Ok(() => Promise.resolve(Ok("released" as const))));
      await taking.promise;
    });

    expect(screen.getByRole("button", { name: ON })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(toggle).toBeEnabled();
    expect(toggle.className).not.toContain(
      css({ "& > svg": { opacity: "inactive" } }),
    );
  });

  it("names what else keeps the screens on, open but not pressed", () => {
    render(
      <IdleInhibitorToggle
        holders={["Slack", "mpv"]}
        inhibitor={idleInhibitor(() => Promise.withResolvers<never>().promise)}
      />,
    );
    const toggle = screen.getByRole("button", {
      name: "Screens kept on by Slack and mpv — click to keep them on too",
    });

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.className).not.toContain(
      css({ "& > svg": { opacity: "inactive" } }),
    );
  });

  it("names what else keeps the screens on while held", async () => {
    render(
      <IdleInhibitorToggle
        holders={["mpv"]}
        inhibitor={idleInhibitor(() =>
          Promise.resolve(Ok(() => Promise.resolve(Ok("released" as const)))),
        )}
      />,
    );
    await userEvent.click(screen.getByRole("button"));

    expect(
      screen.getByRole("button", {
        name: "Screens kept on, also by mpv — click to stop keeping them on",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
