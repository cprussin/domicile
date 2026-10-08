import type { BarReadouts } from "../top-bar/bar-context";
import { BarReadoutsContext } from "../top-bar/bar-context";
import { LOCK_TOP_BAR } from "../top-bar/layout";
import { BarColumns } from "../top-bar/TopBar";

type Props = Omit<BarReadouts, "locked">;

/**
 * The lock screen's bar: the desktop's bar with only Bluetooth, volume,
 * brightness and battery, each limited to what a locked desktop allows. See
 * docs/LOCK.md.
 */
export const LockBar = ({ domicile, readouts }: Props) => (
  <BarReadoutsContext value={{ domicile, locked: true, readouts }}>
    <BarColumns layout={LOCK_TOP_BAR} />
  </BarReadoutsContext>
);
