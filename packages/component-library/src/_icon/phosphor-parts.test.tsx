import { describe, expect, it } from "bun:test";
import type { Icon, IconWeight } from "@phosphor-icons/react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { BluetoothConnectedIcon } from "@phosphor-icons/react/dist/ssr/BluetoothConnected";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/ssr/ChatCircleText";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { CornersInIcon } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { CornersOutIcon } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { EyeIcon } from "@phosphor-icons/react/dist/ssr/Eye";
import { EyeClosedIcon } from "@phosphor-icons/react/dist/ssr/EyeClosed";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { KeyboardIcon } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { LightningIcon } from "@phosphor-icons/react/dist/ssr/Lightning";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { MoonIcon } from "@phosphor-icons/react/dist/ssr/Moon";
import { RowsIcon } from "@phosphor-icons/react/dist/ssr/Rows";
import { SpeakerHighIcon } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { SunIcon } from "@phosphor-icons/react/dist/ssr/Sun";
import { TabsIcon } from "@phosphor-icons/react/dist/ssr/Tabs";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";
import { renderToStaticMarkup } from "react-dom/server";

import { absoluteSubpaths } from "../__test__/absolute-subpaths";
import * as parts from "./phosphor-parts";

/** Each set of parts, and the Phosphor icon and weight it must join back into. */
const SOURCES: [string, readonly string[], Icon, IconWeight][] = [
  ["BELL_FILL", Object.values(parts.BELL_FILL), BellSimpleIcon, "fill"],
  [
    "WIFI_BOLD",
    [parts.WIFI_BOLD.dot, ...parts.WIFI_BOLD.arcs],
    WifiHighIcon,
    "bold",
  ],
  [
    "BLUETOOTH_BOLD",
    Object.values(parts.BLUETOOTH_BOLD),
    BluetoothConnectedIcon,
    "bold",
  ],
  ["BLUETOOTH_BOLD rune", [parts.BLUETOOTH_BOLD.rune], BluetoothIcon, "bold"],
  [
    "SPEAKER_BOLD",
    [parts.SPEAKER_BOLD.cone, ...parts.SPEAKER_BOLD.waves],
    SpeakerHighIcon,
    "bold",
  ],
  [
    "SPEAKER_REGULAR",
    [parts.SPEAKER_REGULAR.cone, ...parts.SPEAKER_REGULAR.waves],
    SpeakerHighIcon,
    "regular",
  ],
  [
    "SPEAKER_FILL",
    [parts.SPEAKER_FILL.cone, ...parts.SPEAKER_FILL.waves],
    SpeakerHighIcon,
    "fill",
  ],
  [
    "MICROPHONE_REGULAR",
    Object.values(parts.MICROPHONE_REGULAR),
    MicrophoneIcon,
    "regular",
  ],
  [
    "MICROPHONE_FILL",
    Object.values(parts.MICROPHONE_FILL),
    MicrophoneIcon,
    "fill",
  ],
  ["SUN_BOLD", [parts.SUN_BOLD.core, ...parts.SUN_BOLD.rays], SunIcon, "bold"],
  ["SUN_FILL", [parts.SUN_FILL.core, ...parts.SUN_FILL.rays], SunIcon, "fill"],
  ["MOON_BOLD", [parts.MOON_BOLD.moon], MoonIcon, "bold"],
  ["MOON_FILL", [parts.MOON_FILL.moon], MoonIcon, "fill"],
  ["EYE_BOLD", [parts.EYE_BOLD.outline, parts.EYE_BOLD.pupil], EyeIcon, "bold"],
  ["EYE_BOLD closed", [parts.EYE_BOLD.closed], EyeClosedIcon, "bold"],
  [
    "CHAT_BOLD",
    [parts.CHAT_BOLD.bubble, ...parts.CHAT_BOLD.lines],
    ChatCircleTextIcon,
    "bold",
  ],
  [
    "KEYBOARD_BOLD",
    [parts.KEYBOARD_BOLD.frame, ...parts.KEYBOARD_BOLD.keys],
    KeyboardIcon,
    "bold",
  ],
  [
    "SQUARES_REGULAR",
    parts.SQUARES_REGULAR.squares,
    SquaresFourIcon,
    "regular",
  ],
  ["GEAR_REGULAR", [parts.GEAR_REGULAR.gear], GearSixIcon, "regular"],
  ["LIGHTNING_FILL", [parts.LIGHTNING_FILL.bolt], LightningIcon, "fill"],
  ["CHECK_BOLD", [parts.CHECK_BOLD.check], CheckIcon, "bold"],
  [
    "CORNERS_OUT_REGULAR",
    parts.CORNERS_OUT_REGULAR.corners,
    CornersOutIcon,
    "regular",
  ],
  [
    "CORNERS_IN_REGULAR",
    parts.CORNERS_IN_REGULAR.corners,
    CornersInIcon,
    "regular",
  ],
  ["ROWS_REGULAR", parts.ROWS_REGULAR.rows, RowsIcon, "regular"],
  ["TABS_REGULAR", [parts.TABS_REGULAR.tabs], TabsIcon, "regular"],
  [
    "ARROW_CLOCKWISE_REGULAR",
    [parts.ARROW_CLOCKWISE_REGULAR.arrow],
    ArrowClockwiseIcon,
    "regular",
  ],
  [
    "DOWNLOAD_REGULAR",
    Object.values(parts.DOWNLOAD_REGULAR),
    DownloadSimpleIcon,
    "regular",
  ],
];

describe("phosphor parts", () => {
  it.each(SOURCES)(
    "%s joins back into Phosphor's icon",
    (_, set, Source, weight) => {
      const markup = renderToStaticMarkup(<Source weight={weight} />);
      const phosphor = normalized(
        [...markup.matchAll(/ d="([^"]+)"/g)].map(([, d]) => d ?? ""),
      );
      const joined = normalized(set);
      expect(joined.map(({ shape }) => shape)).toEqual(
        phosphor.map(({ shape }) => shape),
      );
      expect(
        Math.max(
          ...joined.flatMap(({ values }, i) =>
            values.map((value, j) =>
              Math.abs(value - (phosphor[i]?.values[j] ?? Number.NaN)),
            ),
          ),
        ),
      ).toBeLessThan(TOLERANCE);
    },
  );
});

/** The parts are written to two decimal places. */
const TOLERANCE = 0.01;

/**
 * Every subpath of `paths`, sorted so their order does not matter: its
 * commands and where it starts as `shape`, and its coordinates.
 */
const normalized = (paths: readonly string[]) =>
  paths
    .flatMap((d) => absoluteSubpaths(d))
    .map((subpath) => ({
      shape: subpath
        .map(
          ({ name, values }) =>
            `${name}${values.slice(0, 2).map(Math.round).join(",")}`,
        )
        .join(""),
      values: subpath.flatMap(({ values }) => values),
    }))
    .sort((a, b) => a.shape.localeCompare(b.shape));
