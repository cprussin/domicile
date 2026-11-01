import { css } from "../../styled-system/css";
import { IconFrame } from "../_icon/IconFrame";
import { IconPart } from "../_icon/IconPart";
import { BLUETOOTH_BOLD } from "../_icon/phosphor-parts";
import "../stylesheet";

type Props = {
  /** Names the icon; without one it is decorative. */
  label?: string | undefined;
  size: number;
  /** Off is slashed; connected shows the dots beside the rune. */
  state: "connected" | "off" | "on";
};

/**
 * Phosphor's bold `Bluetooth`, `BluetoothConnected` and `BluetoothSlash` in
 * one. The dots slide out of the rune when a device connects, back in when
 * it goes, and blink while the control the icon is in is pointed at.
 */
export const AnimatedBluetoothIcon = ({ label, size, state }: Props) => {
  const dots = state === "connected" ? "shown" : "hidden";
  return (
    <IconFrame
      label={label}
      size={size}
      slash={{ shown: state === "off", weight: "bold" }}
    >
      <IconPart d={BLUETOOTH_BOLD.rune} name="rune" />
      <IconPart
        d={BLUETOOTH_BOLD.dotStart}
        hoverStyles={state === "connected" ? dotBlinkStyles : undefined}
        name="dot"
        origin={[56, 128]}
        state={dots}
        stateStyles={dotStartStyles}
      />
      <IconPart
        d={BLUETOOTH_BOLD.dotEnd}
        hoverStyles={state === "connected" ? dotBlinkStyles : undefined}
        name="dot"
        order={1}
        origin={[208, 128]}
        state={dots}
        stateStyles={dotEndStyles}
      />
    </IconFrame>
  );
};

const dotStartStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "translateX(28px) scale(0.3)",
    transition:
      "opacity {durations.normal} {easings.in}, transform {durations.normal} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.slow} {easings.out}, transform {durations.slower} {easings.outBack}",
  },
});

const dotEndStyles = css({
  "&[data-state=hidden]": {
    opacity: 0,
    transform: "translateX(-28px) scale(0.3)",
    transition:
      "opacity {durations.normal} {easings.in}, transform {durations.normal} {easings.in}",
  },
  "&[data-state=shown]": {
    opacity: 1,
    transform: "none",
    transition:
      "opacity {durations.slow} {easings.out}, transform {durations.slower} {easings.outBack}",
  },
});

const dotBlinkStyles = css({
  _controlHover: {
    animation:
      "iconDotBlink {durations.slower} {easings.in-out} calc(var(--part-order) * {durations.fast}) both",
  },
});
