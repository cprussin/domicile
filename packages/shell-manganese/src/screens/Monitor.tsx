import { Screen } from "@domicile-desktop/component-library/Screen";
import { memo, useMemo } from "react";

import { BarContext } from "../top-bar/bar-context";
import type { BarLayout } from "../top-bar/layout";
import { TopBar } from "../top-bar/TopBar";

type Props = {
  /** The bar layout, shared by every monitor. */
  bar: BarLayout;
  /** Which monitor this is. */
  name: string;
};

/**
 * One monitor: the bar across its top.
 *
 * Windows are not drawn here. The page spans the whole desktop, so `Stage`
 * draws each window once at its place on the page.
 *
 * Memoized, so a change no bar shows redraws none of them.
 */
export const Monitor = memo(({ bar, name }: Props) => {
  const onBar = useMemo(() => ({ locked: false, screen: name }), [name]);
  return (
    <Screen name={name}>
      <BarContext value={onBar}>
        <TopBar layout={bar} />
      </BarContext>
    </Screen>
  );
});
