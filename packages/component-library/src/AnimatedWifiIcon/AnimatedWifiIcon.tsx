import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { WIFI_BOLD } from "../_icon/phosphor-parts";

/** The dot the arcs spread from. */
const DOT = [128, 204] as const;

type Props = {
  /** The signal's grade: how many arcs are lit. */
  bars: 1 | 2 | 3;
  /** Pulses the arcs in turn, as a connection is made. */
  connecting?: boolean | undefined;
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  /** Slashes the icon: Wi-Fi is off or unconnected. */
  off?: boolean | undefined;
  size: number;
};

/**
 * Phosphor's bold `WifiHigh`, `WifiMedium`, `WifiLow` and `WifiSlash` in one.
 * Arcs fill outward from the dot as the signal grows, pulse while
 * connecting, and ripple while the control the icon is in is pointed at.
 */
export const AnimatedWifiIcon = ({
  bars,
  connecting = false,
  label,
  off = false,
  size,
}: Props) => (
  <IconFrame label={label} size={size} slash={{ shown: off, weight: "bold" }}>
    <IconPart d={WIFI_BOLD.dot} name="dot" />
    {WIFI_BOLD.arcs.map((d, index) => (
      <IconPart
        d={d}
        hoverStyles={off || connecting ? undefined : arcRippleStyles}
        key={d}
        name="arc"
        order={index}
        origin={DOT}
        state={arcState(index, bars, connecting, off)}
        stateStyles={arcStyles}
      />
    ))}
  </IconFrame>
);

const arcStyles = css({
  "&[data-state=connecting]": {
    animation:
      "iconArcSearch calc({durations.slowest} * 2) {easings.in-out} calc(var(--part-order) * {durations.normal}) infinite",
    opacity: 0.25,
  },
  "&[data-state=lit]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.slow} {easings.out}, transform {durations.slow} {easings.outBack}",
    transitionDelay: "calc(var(--part-order) * {durations.faster})",
  },
  "&[data-state=unlit]": {
    opacity: 0,
    transform: "scale(0.86)",
    transition:
      "opacity {durations.normal} {easings.in}, transform {durations.normal} {easings.in}",
  },
});

const arcRippleStyles = css({
  _controlHover: {
    animation:
      "iconArcRipple {durations.slowest} {easings.in-out} calc(var(--part-order) * {durations.faster}) both",
  },
});

/** An arc's state: lit up to `bars`, every arc while off or connecting. */
const arcState = (
  index: number,
  bars: number,
  connecting: boolean,
  off: boolean,
) => {
  if (connecting) {
    return "connecting";
  } else {
    return off || index < bars ? "lit" : "unlit";
  }
};
