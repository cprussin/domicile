import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Picks `option` from the `Select` called `name`.
 *
 * Base UI opens a select on the animation frame after the press, which can
 * land after the click resolves, so this waits for the option to show.
 */
export const choose = async (
  user: Pick<UserEvent, "click">,
  name: string,
  option: string,
): Promise<void> => {
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
};
