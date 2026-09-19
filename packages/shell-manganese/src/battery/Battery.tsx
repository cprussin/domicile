import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { BatteryMessage } from "@domicile/chrome-sdk/host-message";
import { LightningIcon } from "@phosphor-icons/react/dist/ssr/Lightning";
import { useEffect, useState } from "react";

import { css, cva } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { watchBattery } from "./watch-battery";

/** A tenth left is a warning rather than a reading. */
const DANGEROUS_PERCENT = 10;

/** And a twentieth is one that has waited long enough to be looked at. */
const FLASHING_PERCENT = 5;

type Props = {
  /** Where the charge comes from: the host, over the control channel. */
  domicile: DomicileClient;
  /** How it is watched; injected so tests can drive a battery of their own. */
  watch?: typeof watchBattery | undefined;
};

/**
 * The charge, at the far end of the top bar: a bolt whenever AC is in, the
 * meter, and the percentage in figures.
 *
 * Three readings of one number rather than a choice between them. The meter is
 * the one that is read at a glance and the only one that is wrong by less than
 * a percent — its fill is the level itself — and the figures are what a
 * decision about a lead is made on. The bolt is the plug: a full battery and a
 * machine on AC look the same on a meter, and they are not the same thing.
 *
 * Nothing is drawn until the host has said a charge, which is a moment rather
 * than a state worth marking — and is also how a machine with no battery
 * looks, because the compositor sends nothing for one. A bar that flashed an
 * empty meter in either case would be saying something false, which is the
 * whole failure this readout was rebuilt to stop making.
 */
export const Battery = ({ domicile, watch = watchBattery }: Props) => {
  const [reading, setReading] = useState<BatteryMessage | undefined>(undefined);

  useEffect(() => watch(domicile, setReading), [domicile, watch]);

  return reading === undefined ? undefined : <Meter reading={reading} />;
};

/** The reading itself, once there is one. */
const Meter = ({ reading }: { reading: BatteryMessage }) => {
  const percent = Math.round(reading.charge * 100);
  return (
    <div className={rootStyles({ charge: chargeOf(percent) })}>
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
        {/*
          The one length in here that is not a token, because it is not a
          decision: the fill IS the charge, so the number is the reading.
        */}
        <div className={fillStyles} style={{ inlineSize: `${percent}%` }} />
      </div>
      <span className={percentStyles}>{percent}%</span>
    </div>
  );
};

/**
 * The whole readout goes to danger together, and flashes together: the case,
 * the fill, the bolt and the figures are all `currentcolor` and all inside
 * this, so `color` here is the only place red is said and the animation is one
 * animation rather than four in step.
 */
const rootStyles = cva({
  base: hstack.raw({ gap: 1 }),
  variants: {
    charge: {
      // A tenth left, which the whole readout says rather than the meter
      // alone: a red bar beside white figures reads as a half-finished
      // thought.
      dangerous: { color: "danger" },
      // The charge as it usually is, which is the bar's own white.
      fine: {},
      // A battery with minutes left, which asks to be noticed rather than
      // read. It stays red as well: a flash that was the whole signal would
      // say nothing in the half of every turn it is at rest.
      flashing: {
        animationDuration: "{durations.pulse}",
        animationIterationCount: "infinite",
        animationName: "chargeFlashing",
        color: "danger",
      },
    },
  },
});

// Drawn in `currentcolor` throughout, which is whatever the readout above has
// set `color` to — the bar's white, or `danger`. A meter is boxes rather than
// type, so naming a colour here would leave it behind when the figures beside
// it went red.
const caseStyles = css({
  // The terminal nub, which is what makes a rounded box a battery.
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
  // The nub is out beyond the box, so without this the gap after it is the
  // gap the nub is standing in and the figures run into the battery.
  marginInlineEnd: 0.5,
  padding: 0.25,
  position: "relative",
});

const fillStyles = css({
  backgroundColor: "currentcolor",
  blockSize: "100%",
});

const percentStyles = css({
  // Ten pixels, the bar's own size, which no font-size token is — the scale
  // steps from 8px to 12px.
  fontSize: "0.625rem",
  // A charge that changes must not change the width of the bar's end with it.
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});

/**
 * Which of the three the readout is in.
 *
 * Off the *percentage* rather than off the level behind it, so the colour and
 * the figures cannot disagree: a tenth and a bit reads as `10%`, and a readout
 * saying ten while looking comfortable would be two answers to one question.
 */
const chargeOf = (percent: number) => {
  if (percent <= FLASHING_PERCENT) {
    return "flashing";
  } else if (percent <= DANGEROUS_PERCENT) {
    return "dangerous";
  } else {
    return "fine";
  }
};
