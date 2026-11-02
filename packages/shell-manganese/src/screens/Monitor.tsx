import { Screen } from "@domicile-desktop/component-library/Screen";
import { BarContext } from "@domicile-desktop/manganese-bar/bar-context";
import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import { TopBar } from "@domicile-desktop/manganese-bar/TopBar";
import { memo, useMemo } from "react";

type Props = {
  /** The bar layout, shared by every monitor. */
  bar: BarLayout;
  /** Which monitor this is. */
  name: string;
  /** Whether it has the keyboard, so its bar's panels may open by themselves. */
  focused: boolean;
};

/**
 * One monitor: the bar across its top.
 *
 * Windows are not drawn here. The page spans the whole desktop, so `Stage`
 * draws each window once at its place on the page.
 *
 * Memoized, so a change no bar shows redraws none of them.
 */
export const Monitor = memo(({ bar, focused, name }: Props) => {
  const onBar = useMemo(
    () => ({ locked: false, popsUp: focused, screen: name }),
    [focused, name],
  );
  return (
    <Screen name={name}>
      <BarContext value={onBar}>
        <TopBar layout={bar} />
      </BarContext>
    </Screen>
  );
});
