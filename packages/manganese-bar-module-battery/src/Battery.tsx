import type { Option } from "@cprussin/option-result";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import type { Battery as BatteryReading } from "@domicile-desktop/system-battery/battery";
import { LightningIcon } from "@phosphor-icons/react/dist/ssr/Lightning";
import { css, cva, cx } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";

/** At or below this percentage the readout turns red. */
const DANGEROUS_PERCENT = 10;

/** At or below this percentage the readout also flashes. */
const FLASHING_PERCENT = 5;

type Props = {
  /** The desk's battery, from UPower. */
  battery: SharedWatch<Option<BatteryReading>>;
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
 * Draws nothing until UPower reports a battery, so a machine without one shows
 * no false empty meter.
 */
export const Battery = ({ battery }: Props) =>
  useSharedWatch(battery)?.match({
    None: () => undefined,
    Some: (reading) => <Meter reading={reading} />,
  });

/** The readout once there is a reading. */
const Meter = ({ reading }: { reading: BatteryReading }) => {
  const percent = Math.round(reading.charge * 100);
  return (
    <div
      className={rootStyles({ charge: chargeOf(percent, reading.charging) })}
    >
      <div
        aria-label="Battery"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className={caseStyles}
        role="meter"
      >
        {/* Not tokens: the clips follow the charge itself. */}
        <div
          className={fillStyles({ charging: reading.charging })}
          style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
        />
        {reading.charging && (
          <div
            className={boltStyles}
            style={{ clipPath: `inset(0 0 0 ${percent}%)` }}
          >
            <LightningIcon
              aria-label="Charging"
              role="img"
              size={8}
              weight="fill"
            />
          </div>
        )}
      </div>
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
  // Tall enough to hold the bolt.
  blockSize: 3,
  border: "1px solid currentcolor",
  borderRadius: "xs",
  inlineSize: 6,
  // Leaves room for the nub, which sits outside the box.
  marginInlineEnd: 0.5,
  padding: 0.25,
  position: "relative",
});

// Full width, clipped to the charge, so the bolt's hole stays centered.
const fillStyles = cva({
  base: {
    backgroundColor: "currentcolor",
    blockSize: "100%",
  },
  variants: {
    charging: {
      false: {},
      // Cuts the bolt out of the fill, so it shows where the fill is. The path
      // is Phosphor's filled Lightning, and a mask's colors only set opacity,
      // so neither is a token.
      true: {
        maskComposite: "exclude",
        maskImage:
          "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'><path d='M213.85,125.46l-112,120a8,8,0,0,1-13.69-7l14.66-73.33L45.19,143.49a8,8,0,0,1-3-13l112-120a8,8,0,0,1,13.69,7L153.18,90.9l57.63,21.61a8,8,0,0,1,3,12.95Z'/></svg>\"), linear-gradient(black, black)",
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "auto 100%, 100% 100%",
      },
    },
  },
});

// Over the case's inside, clipped to where the fill is not.
const boltStyles = css({
  alignItems: "center",
  display: "flex",
  inset: 0.25,
  justifyContent: "center",
  position: "absolute",
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
