import type { Option, Result } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { Audio } from "@domicile-desktop/system-audio/audio";
import type { SoundServer } from "@domicile-desktop/system-audio/sound-server";
import { soundServer } from "@domicile-desktop/system-audio/sound-server";
import type { Battery } from "@domicile-desktop/system-battery/battery";
import type { Bluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";
import { watchBluetooth } from "@domicile-desktop/system-bluetooth/bluetooth";
import type { Network } from "@domicile-desktop/system-network/network";
import { watchNetwork } from "@domicile-desktop/system-network/network";
import type { Wifi } from "@domicile-desktop/system-network/wifi";
import { watchWifi } from "@domicile-desktop/system-network/wifi";

import { watchBattery } from "../battery/watch-battery";
import { hostBacklight } from "../brightness/host-backlight";
import { sharedMeters } from "../volume/shared-meters";
import type { SharedWatch } from "./shared-watch";
import { sharedWatch } from "./shared-watch";

/** The backlight's level, shared, and a way to change it. */
export type SharedBacklight = {
  /** 0 to 1. Never reported on a machine without a backlight. */
  level: SharedWatch<number>;
  /** Ask for a level from 0 to 1. `level` reports it once it is set. */
  set: (level: number) => void;
};

/** The sound server's requests. Its state is {@link Readouts.audio}. */
export type SoundControls = Omit<SoundServer, "watch">;

/**
 * The desk's system readouts, made once for the page and shared by every bar
 * and the lock screen. Each watch runs while anything shows it.
 */
export type Readouts = {
  audio: SharedWatch<Audio>;
  backlight: SharedBacklight;
  battery: SharedWatch<Option<Battery>>;
  bluetooth: SharedWatch<Result<Bluetooth, SystemError>>;
  network: SharedWatch<Result<Network, SystemError>>;
  /** The Wi-Fi device; `None` without one. */
  wifi: SharedWatch<Result<Option<Wifi>, SystemError>>;
  /** Its meters are shared by id among open mixers. */
  sound: SoundControls;
};

/** The readouts through `domicile`'s system calls. */
export const readouts = (domicile: DomicileHost): Readouts => {
  const host = system(domicile);
  const backlight = hostBacklight(domicile);
  const { watch, ...sound } = soundServer(host);
  return {
    audio: sharedWatch(watch),
    backlight: { level: sharedWatch(backlight.watch), set: backlight.set },
    battery: sharedWatch((onReading) => watchBattery(domicile, onReading)),
    bluetooth: sharedWatch((onBluetooth) => watchBluetooth(host, onBluetooth)),
    network: sharedWatch((onNetwork) => watchNetwork(host, onNetwork)),
    sound: { ...sound, meters: sharedMeters(sound.meters) },
    wifi: sharedWatch((onWifi) => watchWifi(host, onWifi)),
  };
};
