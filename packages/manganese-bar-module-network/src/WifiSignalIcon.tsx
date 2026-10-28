import { AnimatedWifiIcon } from "@domicile-desktop/component-library/AnimatedWifiIcon";

import type { Signal } from "./signal";
import { signalOf } from "./signal";

/** The arcs each grade lights. */
const BARS = { fair: 2, strong: 3, weak: 1 } as const satisfies Record<
  Signal,
  unknown
>;

type Props = {
  /** 0 through 1. */
  strength: number;
  /** Pulses its arcs, as it is joined. */
  connecting?: boolean | undefined;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  /** Slashes it: there is no connection. */
  off?: boolean | undefined;
};

/** A Wi-Fi icon with as many bars as the signal's grade. */
export const WifiSignalIcon = ({ connecting, label, off, strength }: Props) => (
  <AnimatedWifiIcon
    bars={BARS[signalOf(strength)]}
    connecting={connecting}
    label={label}
    off={off}
    size={15}
  />
);
