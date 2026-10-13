import {
  connect,
  disconnect,
  forget,
  pair,
  setPowered,
  startDiscovery,
  stopDiscovery,
} from "@domicile-desktop/system-bluetooth/bluetooth";

/** BlueZ's requests, injectable so tests can see what a panel asks for. */
export const BLUETOOTH_ACTIONS = {
  connect,
  disconnect,
  forget,
  pair,
  setPowered,
  startDiscovery,
  stopDiscovery,
};

export type BluetoothActions = typeof BLUETOOTH_ACTIONS;
