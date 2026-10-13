import { BarContext } from "@domicile-desktop/manganese-bar/bar-context";
import type { BarLayout } from "@domicile-desktop/manganese-bar/bar-layout";
import { TopBar } from "@domicile-desktop/manganese-bar/TopBar";

type Props = {
  /** The items, such as `LOCK_BAR`'s. Each offers only what a lock allows. */
  layout: BarLayout;
  /** The monitor this bar is on. */
  screen: string;
};

/** The lock screen's bar on monitor `screen`. See docs/LOCK.md. */
export const LockBar = ({ layout, screen }: Props) => (
  <BarContext value={{ locked: true, screen }}>
    <TopBar layout={layout} />
  </BarContext>
);
