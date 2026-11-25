// Quick settings opened to network details listing 40 Wi-Fi networks.

import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { QuickTile } from "@domicile-desktop/component-library/QuickTile";
import type { QuickSettingsParts } from "@domicile-desktop/manganese-quick-settings";
import { QuickSettings } from "@domicile-desktop/manganese-quick-settings";
import { WifiHighIcon } from "@phosphor-icons/react/dist/ssr/WifiHigh";

import { Bar } from "../Bar";

const NETWORKS = Array.from(
  { length: 40 },
  (_, index) => `Network ${(index + 1).toString()}`,
);

const nothing = () => undefined;

const PARTS: QuickSettingsParts = {
  BatteryStatus: nothing,
  BluetoothDetails: nothing,
  BluetoothTile: nothing,
  BrightnessRow: nothing,
  DarkModeTile: nothing,
  Indicators: [() => <WifiHighIcon size={15} weight="bold" />],
  KeepAwakeTile: nothing,
  NetworkDetails: () => (
    <List label="Wi-Fi networks">
      {NETWORKS.map((name) => (
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
};

export const QuickSettingsScene = () => (
  <Bar>
    <QuickSettings parts={PARTS} />
  </Bar>
);
