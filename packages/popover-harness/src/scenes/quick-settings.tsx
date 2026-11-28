// Quick settings opened to network details: the connection, with a Details
// drawer, over 40 Wi-Fi networks, or over two, which fit. Bluetooth's details
// are a few devices, which fit.

import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { QuickTile } from "@domicile-desktop/component-library/QuickTile";
import type { QuickSettingsParts } from "@domicile-desktop/manganese-quick-settings";
import { QuickSettings } from "@domicile-desktop/manganese-quick-settings";
import { BluetoothIcon } from "@phosphor-icons/react/dist/ssr/Bluetooth";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";

import { Bar } from "../Bar";

/** Wi-Fi networks named "Network 1" to "Network `count`". */
const networksOf = (count: number) =>
  Array.from(
    { length: count },
    (_, index) => `Network ${(index + 1).toString()}`,
  );

const DEVICES = ["Headphones", "Keyboard", "Mouse", "Speaker", "Watch"];

const ADDRESSES = ["192.0.2.10", "2001:db8::10", "fe80::10"];

const nothing = () => undefined;

/** The parts, with `networks` in range. */
const partsOf = (networks: readonly string[]): QuickSettingsParts => ({
  BatteryStatus: nothing,
  BluetoothDetails: () => (
    <List label="Bluetooth devices">
      {DEVICES.map((name) => (
        <ListRow
          icon={<BluetoothIcon weight="bold" />}
          key={name}
          label={name}
          onPress={nothing}
        />
      ))}
    </List>
  ),
  BluetoothTile: ({ onMore }) => (
    <QuickTile
      detail="On"
      icon={<BluetoothIcon weight="bold" />}
      label="Bluetooth"
      lit
      onMore={onMore}
    />
  ),
  BrightnessRow: nothing,
  DarkModeTile: nothing,
  Indicators: [() => <WifiHighIcon size={15} weight="bold" />],
  KeepAwakeTile: nothing,
  NetworkDetails: () => (
    <List label="Wi-Fi networks">
      <ListRow
        detail="Connected"
        disclosure="Details"
        icon={<WifiHighIcon weight="bold" />}
        label="Home"
        surface="filled"
      >
        {ADDRESSES.map((address) => (
          <span key={address}>{address}</span>
        ))}
      </ListRow>
      {networks.map((name) => (
        <ListRow
          icon={<WifiHighIcon weight="bold" />}
          key={name}
          label={name}
          onPress={nothing}
        />
      ))}
    </List>
  ),
  NetworkTile: ({ onMore }) => (
    <QuickTile
      detail="Network 1"
      icon={<WifiHighIcon weight="bold" />}
      label="Wi-Fi"
      lit
      onMore={onMore}
    />
  ),
  NightLightTile: nothing,
  SoundDetails: nothing,
  SoundRow: nothing,
  useGestures: () => ({ onAuxClick: nothing, onWheel: nothing }),
  useOpenSettings: () => nothing,
});

const CROWDED = partsOf(networksOf(40));

const FITTING = partsOf(networksOf(2));

export const QuickSettingsScene = () => (
  <Bar>
    <QuickSettings parts={CROWDED} />
  </Bar>
);

/** Network details short enough that the panel grows and shrinks with them. */
export const FittingQuickSettingsScene = () => (
  <Bar>
    <QuickSettings parts={FITTING} />
  </Bar>
);
