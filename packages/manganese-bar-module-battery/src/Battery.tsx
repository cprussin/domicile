import type { Option, Result } from "@cprussin/option-result";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import { isAbsent } from "@domicile-desktop/manganese-host/watch-presence";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Battery as BatteryReading } from "@domicile-desktop/system-battery/battery";
import { LightningIcon } from "@phosphor-icons/react/dist/ssr/Lightning";
import { useId } from "react";
import { css, cva, cx } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";

/** At or below this percentage the readout turns red. */
const DANGEROUS_PERCENT = 10;

/** At or below this percentage the readout also flashes. */
const FLASHING_PERCENT = 5;

/** The fill's widest extent, between the inside's 1-unit gaps. */
const FILL_WIDTH = 18;

type Props = {
  /** The desk's battery, from UPower. */
  battery: SharedWatch<Option<BatteryReading>>;
  /** Whether the machine has a battery, from `/sys`. */
  hardware: SharedWatch<Result<boolean, SystemError>>;
};

/**
 * The battery readout at the end of the top bar: a meter with a bolt in it
 * while on AC, and the percentage.
 *
 * The bolt matters because a full battery and a machine on AC look the same on
 * the meter.
 *
 * Holds the width of `100%`, so the items beside it never move.
 *
 * Until UPower reports the battery, a dimmed empty outline on a machine with
 * one, and nothing on a machine without, so it shows no false empty meter.
 */
export const Battery = ({ battery, hardware }: Props) => {
  const reading = useSharedWatch(battery)?.match({
    None: () => undefined,
    Some: (found) => found,
  });
  const present = useSharedWatch(hardware);
  if (reading === undefined) {
    return isAbsent(present) ? undefined : <Unavailable />;
  } else {
    return <Meter reading={reading} />;
  }
};

/** The outline alone, dimmed, as wide as the meter and its percentage. */
const Unavailable = () => (
  <div
    aria-label="Battery unavailable"
    className={cx(rootStyles({ charge: "fine" }), unavailableStyles)}
    role="img"
    title="Battery unavailable"
  >
    <svg aria-hidden className={meterStyles} viewBox="0 0 24 12">
      <Outline />
    </svg>
    <span className={percentSlotStyles}>
      <span aria-hidden className={percentSizerStyles}>
        100%
      </span>
      <span className={percentStyles}>–</span>
    </span>
  </div>
);

/** The meter's case and its terminal nub; the nub's left end hides under the case. */
const Outline = () => (
  <>
    <rect
      fill="none"
      height="10.5"
      rx="2.25"
      stroke="currentcolor"
      strokeWidth="1.5"
      width="21.5"
      x="0.75"
      y="0.75"
    />
    <rect fill="currentcolor" height="4" rx="1" width="2" x="22" y="4" />
  </>
);

/**
 * The readout once there is a reading.
 *
 * The meter is one SVG, 1 unit to a CSS pixel, so its outline has the same
 * weight on every side at any display scale.
 */
const Meter = ({ reading }: { reading: BatteryReading }) => {
  const percent = Math.round(reading.charge * 100);
  const halo = useId();
  return (
    <div
      className={rootStyles({ charge: chargeOf(percent, reading.charging) })}
    >
      <svg
        aria-label="Battery"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className={meterStyles}
        role="meter"
        viewBox="0 0 24 12"
      >
        {reading.charging && (
          // Cuts a gap around the bolt out of the fill.
          <mask id={halo}>
            <rect fill="white" height="12" width="24" />
            {/* 60 of the icon's 256 units: about 1px around the bolt. */}
            <LightningIcon
              color="black"
              size={8}
              stroke="black"
              strokeLinejoin="round"
              strokeWidth={60}
              weight="fill"
              x={7.5}
              y={2}
            />
          </mask>
        )}
        <Outline />
        <rect
          fill="currentcolor"
          height="7"
          mask={reading.charging ? `url(#${halo})` : undefined}
          rx="1"
          width={(FILL_WIDTH * percent) / 100}
          x="2.5"
          y="2.5"
        />
        {reading.charging && (
          // Centered in the inside, which runs from 1.5 to 21.5.
          <LightningIcon
            aria-label="Charging"
            role="img"
            size={8}
            weight="fill"
            x={7.5}
            y={2}
          />
        )}
      </svg>
      <span className={percentSlotStyles}>
        <span aria-hidden className={percentSizerStyles}>
          100%
        </span>
        <span className={percentStyles}>{percent}%</span>
      </span>
    </div>
  );
};

/**
 * Every part of the readout uses `currentcolor`, so setting `color` here turns
 * it all red, and one animation flashes it all.
 */
const rootStyles = cva({
  // The inset matches the icon buttons beside it, so the gaps on either side
  // look like the gaps between them. 6px, not their 6.5px, so the meter's
  // outline stays on whole pixels.
  base: hstack.raw({ gap: 1, paddingInline: 1.5 }),
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

const unavailableStyles = css({ opacity: "inactive" });

// One CSS pixel per unit of the viewBox.
const meterStyles = css({
  blockSize: 3,
  flexShrink: 0,
  inlineSize: 6,
});

// A hidden `100%` sets the width; the figure ends where it does.
const percentSlotStyles = css({
  display: "grid",
  justifyItems: "end",
});

const percentStyles = css({
  // 10px to match the bar; the font-size scale jumps from 8px to 12px.
  fontSize: "0.625rem",
  // Fixed-width digits, so the figure does not shift as the charge changes.
  fontVariantNumeric: "tabular-nums",
  gridArea: "1 / 1",
  // Keeps the item as tall as the meter. A taller line centers the meter on a
  // half pixel, which blurs its outline.
  lineHeight: "none",
  whiteSpace: "nowrap",
});

const percentSizerStyles = cx(percentStyles, css({ visibility: "hidden" }));

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
