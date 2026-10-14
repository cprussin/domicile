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
    expect(toggle.className).toContain(css({ opacity: "disabled" }));

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
    expect(toggle.className).not.toContain(css({ opacity: "disabled" }));
  });
});
