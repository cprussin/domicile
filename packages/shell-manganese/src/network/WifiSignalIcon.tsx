import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";
import { WifiLowIcon } from "@phosphor-icons/react/dist/ssr/WifiLow";
import { WifiMediumIcon } from "@phosphor-icons/react/dist/ssr/WifiMedium";

import { signalOf } from "./signal";

type Props = {
  /** 0 through 1. */
  strength: number;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
};

/** A Wi-Fi icon with as many bars as the signal's grade. */
export const WifiSignalIcon = ({ label, strength }: Props) => {
  const named =
    label === undefined
      ? { "aria-hidden": true }
      : { "aria-label": label, role: "img" };
  switch (signalOf(strength)) {
    case "strong":
      return <WifiHighIcon {...named} size={15} weight="bold" />;
    case "fair":
      return <WifiMediumIcon {...named} size={15} weight="bold" />;
    case "weak":
      return <WifiLowIcon {...named} size={15} weight="bold" />;
  }
};
