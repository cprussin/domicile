import { AnimatedGearIcon } from "@domicile-desktop/component-library/AnimatedGearIcon";
import { Button } from "@domicile-desktop/component-library/Button";
import type { DrilldownDetail } from "@domicile-desktop/component-library/Drilldown";
import { Drilldown } from "@domicile-desktop/component-library/Drilldown";
import { PanelFooter } from "@domicile-desktop/component-library/PanelFooter";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import { useKeepsKeyboard } from "@domicile-desktop/manganese-bar/panel-keyboard";
import type { ComponentType, MouseEvent, WheelEvent } from "react";
import { useState } from "react";

import { css, cva } from "../styled-system/css";
import { flex, grid, hstack } from "../styled-system/patterns";
import { DESK_PARTS } from "./desk-parts";

/** A tile or slider with details: `onMore` opens them, absent while locked. */
type WithDetails = ComponentType<{ onMore?: (() => void) | undefined }>;

/** What quick settings is made of, injectable so tests can draw their own. */
export type QuickSettingsParts = {
  /** The icons in the button. */
  Indicators: ComponentType;
  /** The button's wheel and middle click. */
  useGestures: () => {
    onAuxClick: (event: MouseEvent) => void;
    onWheel: (event: WheelEvent) => void;
  };
  NetworkTile: WithDetails;
  BluetoothTile: WithDetails;
  KeepAwakeTile: ComponentType;
  NightLightTile: ComponentType;
  DarkModeTile: ComponentType;
  BrightnessRow: ComponentType;
  SoundRow: WithDetails;
  BatteryStatus: ComponentType;
  NetworkDetails: ComponentType;
  BluetoothDetails: ComponentType;
  SoundDetails: ComponentType;
  /** Opens the Settings app. */
  useOpenSettings: () => () => void;
};

/** Which details show over the tiles. */
enum Details {
  Network,
  Bluetooth,
  Sound,
}

/**
 * One bar item for the computer's settings: the network, Bluetooth, sound
 * and battery icons in a button, each shown only when it has something to
 * say. It opens a panel of tiles into the network and Bluetooth details, a
 * row of switches for what is turned on and off often, the brightness and
 * volume sliders, the battery, and a way to the Settings app. Details open
 * in place.
 *
 * Offers only what a locked desktop allows: no network, keep awake, theme,
 * details or Settings.
 */
export const QuickSettings = ({
  parts = DESK_PARTS,
}: {
  parts?: QuickSettingsParts | undefined;
}) => {
  const { locked } = useBar();
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | undefined>(undefined);
  const openSettings = parts.useOpenSettings();
  useKeepsKeyboard(open);
  const opener = (shown: Details) =>
    locked
      ? undefined
      : () => {
          setDetails(shown);
        };
  const { Indicators } = parts;
  const changeOpen = (opened: boolean) => {
    setOpen(opened);
    if (!opened) {
      setDetails(undefined);
    }
  };
  return (
    <Popover
      align="end"
      onOpenChange={changeOpen}
      open={open}
      side="bottom"
      tone="overPhoto"
      trigger={
        <button
          aria-label="Quick settings"
          className={triggerStyles}
          type="button"
          {...parts.useGestures()}
        >
          <Indicators />
        </button>
      }
      wide
    >
      <span className={panelStyles}>
        <Drilldown
          detail={detailOf(parts, details)}
          onBack={() => {
            setDetails(undefined);
          }}
        >
          <span className={mainStyles}>
            <span className={tilesStyles}>
              {!locked && (
                <parts.NetworkTile onMore={opener(Details.Network)} />
              )}
              <parts.BluetoothTile onMore={opener(Details.Bluetooth)} />
            </span>
            <span className={togglesStyles}>
              {!locked && <parts.KeepAwakeTile />}
              <parts.NightLightTile />
              {!locked && <parts.DarkModeTile />}
            </span>
            <span className={slidersStyles}>
              {/* Clear of the volume's arrow, so the sliders end together. */}
              <span className={brightnessStyles({ besideArrow: !locked })}>
                <parts.BrightnessRow />
              </span>
              <parts.SoundRow onMore={opener(Details.Sound)} />
            </span>
            <PanelFooter
              action={
                !locked && (
                  <Button
                    beforeIcon={<AnimatedGearIcon size={14} />}
                    onClick={() => {
                      openSettings();
                      changeOpen(false);
                    }}
                    rounded
                    size="xs"
                    variant="ghost"
                  >
                    Settings
                  </Button>
                )
              }
            >
              <parts.BatteryStatus />
            </PanelFooter>
          </span>
        </Drilldown>
      </span>
    </Popover>
  );
};

const detailOf = (
  parts: QuickSettingsParts,
  details: Details | undefined,
): DrilldownDetail | undefined => {
  switch (details) {
    case undefined:
      return undefined;
    case Details.Network:
      return { content: <parts.NetworkDetails />, title: "Network" };
    case Details.Bluetooth:
      return { content: <parts.BluetoothDetails />, title: "Bluetooth" };
    case Details.Sound:
      return { content: <parts.SoundDetails />, title: "Sound" };
  }
};

// The other bar items' hover circle, stretched around several icons.
const triggerStyles = hstack({
  _hoverOrOpen: { backgroundColor: "fillOverPhoto" },
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  flexShrink: 0,
  gap: 1.5,
  paddingInline: 1.5,
  transition: "background-color {durations.fast} {easings.default}",
});

// A popover's usual width, which its network and Bluetooth details fit. The
// padding evens out the panel's, which is thinner above and below.
const panelStyles = css({
  display: "block",
  inlineSize: 88,
  paddingBlock: 1.5,
});

// Tiles, sliders and the footer, a step apart.
const mainStyles = flex({ direction: "column", gap: 3 });

const slidersStyles = flex({ direction: "column", gap: 1.5 });

const tilesStyles = grid({ columns: 2, gap: 2 });

// The switches share the row evenly, however many a locked desktop leaves.
const togglesStyles = flex({ gap: 2 });

// The volume's arrow, an `IconButton`, and the gap before it.
const brightnessStyles = cva({
  base: { display: "flex" },
  variants: {
    besideArrow: {
      false: {},
      true: { paddingInlineEnd: 8 },
    },
  },
});
