import { useDisplays } from "@domicile/component-library/DisplayProvider";
import { Screen } from "@domicile/component-library/Screen";
import type { PropsWithChildren } from "react";

/**
 * Every display the chrome is not on.
 *
 * There is one stage and it is on the first screen, so this is what the others
 * have to show. Nothing at all before the desktop is described, rather than
 * everywhere: the first screen is not known yet, so "the others" is not either.
 */
export const OtherScreens = ({ children }: PropsWithChildren) => {
  const first = useDisplays()?.[0];
  return first === undefined ? undefined : (
    <Screen match={(display) => display.name !== first.name}>{children}</Screen>
  );
};
