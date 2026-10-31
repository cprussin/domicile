import { useBar } from "@domicile-desktop/manganese-bar/bar-context";
import {
  BatteryCharge,
  BatteryIndicator,
} from "@domicile-desktop/manganese-bar-module-battery/quick-settings";
import {
  BluetoothCard,
  BluetoothDevices,
  BluetoothIndicator,
} from "@domicile-desktop/manganese-bar-module-bluetooth/quick-settings";
import {
  BrightnessLevel,
  NightLight,
} from "@domicile-desktop/manganese-bar-module-brightness/quick-settings";
import { KeepAwake } from "@domicile-desktop/manganese-bar-module-idle-inhibitor/quick-settings";
import {
  NetworkCard,
  NetworkDetails,
  NetworkIndicator,
} from "@domicile-desktop/manganese-bar-module-network/quick-settings";
import { DarkModeTile } from "@domicile-desktop/manganese-bar-module-theme-switch/quick-settings";
import {
  SoundIndicator,
  SoundLevel,
  SoundMixer,
  useDeskSoundGestures,
} from "@domicile-desktop/manganese-bar-module-volume/quick-settings";
import { useDomicile } from "@domicile-desktop/react/domicile-provider";

import type { QuickSettingsParts } from "./QuickSettings";

/** Quick settings from the desk's own readouts. */
export const DESK_PARTS: QuickSettingsParts = {
  BatteryStatus: BatteryCharge,
  BluetoothDetails: BluetoothDevices,
  BluetoothTile: BluetoothCard,
  BrightnessRow: BrightnessLevel,
  DarkModeTile,
  Indicators: () => {
    const { locked } = useBar();
    return (
      <>
        {!locked && <NetworkIndicator />}
        <BluetoothIndicator />
        <SoundIndicator />
        <BatteryIndicator />
      </>
    );
  },
  KeepAwakeTile: KeepAwake,
  NetworkDetails,
  NetworkTile: NetworkCard,
  NightLightTile: NightLight,
  SoundDetails: SoundMixer,
  SoundRow: SoundLevel,
  useGestures: useDeskSoundGestures,
  // As the launcher runs it.
  useOpenSettings: () => {
    const { processes } = useDomicile();
    return () => {
      processes.launch(["domicile-settings"]);
    };
  },
};
