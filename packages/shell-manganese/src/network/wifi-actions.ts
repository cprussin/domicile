import {
  connectWifi,
  disconnectWifi,
  scanWifi,
  setWifiEnabled,
} from "@domicile-desktop/system-network/wifi";

/** The Wi-Fi service's requests, injectable so tests can see what a panel asks for. */
export const WIFI_ACTIONS = {
  connectWifi,
  disconnectWifi,
  scanWifi,
  setWifiEnabled,
};

export type WifiActions = typeof WIFI_ACTIONS;
