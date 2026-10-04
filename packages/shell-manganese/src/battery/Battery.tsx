import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { BatteryMessage } from "@domicile-desktop/sdk/host-message";
import { LightningIcon } from "@phosphor-icons/react/dist/ssr/Lightning";
import { useEffect, useState } from "react";

import { css, cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { watchBattery } from "./watch-battery";

/** At or below this percentage the readout turns red. */
const DANGEROUS_PERCENT = 10;

/** At or below this percentage the readout also flashes. */
const FLASHING_PERCENT = 5;

type Props = {
  /** The host that reports the charge. */
  domicile: DomicileClient;
  /** Injectable so tests can drive their own battery. */
  watch?: typeof watchBattery | undefined;
};

/**
 * The battery readout at the end of the top bar: a bolt while on AC, a meter,
 * and the percentage.
 *
 * The bolt matters because a full battery and a machine on AC look the same on
 * the meter.
 *
 * Draws nothing until the host reports a charge. Machines without a battery
 * get no report, so they show nothing rather than a false empty meter.
 */
export const Battery = ({ domicile, watch = watchBattery }: Props) => {
  const [reading, setReading] = useState<BatteryMessage | undefined>(undefined);

  useEffect(() => watch(domicile, setReading), [domicile, watch]);

  return reading === undefined ? undefined : <Meter reading={reading} />;
};

/** The readout once there is a reading. */
const Meter = ({ reading }: { reading: BatteryMessage }) => {
  const percent = Math.round(reading.charge * 100);
  return (
    <div
      className={rootStyles({ charge: chargeOf(percent, reading.charging) })}
    >
      {reading.charging && (
        <LightningIcon
          aria-label="Charging"
          role="img"
          size={10}
          weight="fill"
        />
      )}
      <div
        aria-label="Battery"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className={caseStyles}
        role="meter"
      >
        {/* Not a token: the fill width is the charge itself. */}
        <div className={fillStyles} style={{ inlineSize: `${percent}%` }} />
      </div>
      <span className={percentStyles}>{percent}%</span>
    </div>
  );
};

/**
 * Every part of the readout uses `currentcolor`, so setting `color` here turns
 * it all red, and one animation flashes it all.
 */
const rootStyles = cva({
  base: hstack.raw({ gap: 1 }),
  variants: {
    charge: {
      // The whole readout turns red, not just the meter.
      dangerous: { color: "danger" },
      fine: {},
      // Stays red while flashing, so it still warns between flashes.
      flashing: {
        animationDuration: "{durations.pulse}",
        animationIterationCount: "infinite",
        animationName: "chargeFlashing",
        color: "danger",
      },
    },
  },
});

// Drawn in `currentcolor` so it follows the readout's color.
const caseStyles = css({
  // The terminal nub.
  _after: {
    backgroundColor: "currentcolor",
    blockSize: 1,
    borderEndEndRadius: "xs",
    borderStartEndRadius: "xs",
    content: '""',
    inlineSize: 0.5,
    insetBlockStart: "50%",
    insetInlineStart: "100%",
    position: "absolute",
    transform: "translateY(-50%)",
  },
  blockSize: 2.5,
  border: "1px solid currentcolor",
  borderRadius: "xs",
  inlineSize: 5.5,
  // Leaves room for the nub, which sits outside the box.
  marginInlineEnd: 0.5,
  padding: 0.25,
  position: "relative",
});

const fillStyles = css({
  backgroundColor: "currentcolor",
  blockSize: "100%",
});

const percentStyles = css({
  // 10px to match the bar; the font-size scale jumps from 8px to 12px.
  fontSize: "0.625rem",
  // Fixed-width digits so the bar's width does not change with the charge.
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});

/**
 * The readout's state.
 *
 * Based on the rounded percentage so the color matches the figures shown.
 * Always `fine` while charging.
 */
const chargeOf = (percent: number, charging: boolean) => {
  if (charging || percent > DANGEROUS_PERCENT) {
    return "fine";
  } else if (percent <= FLASHING_PERCENT) {
    return "flashing";
  } else {
    return "dangerous";
  }
};
