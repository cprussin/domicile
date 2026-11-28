import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Asked } from "@domicile-desktop/test-support/recorded-requests";
import { recordedRequests } from "@domicile-desktop/test-support/recorded-requests";

import type { WifiActions } from "./wifi-actions";

/**
 * The Wi-Fi service's requests for tests: each is recorded in `asked` and
 * answers with `answer`, `Ok` by default.
 */
export const heldWifiActions = (
  answer: (asked: Asked) => Result<"done", SystemError> = () => Ok("done"),
) => {
  const { ask, asked } = recordedRequests(answer);
  const actions: WifiActions = {
    connectWifi: (_system, wifi, network, passphrase) =>
      ask(["connect", wifi.device, network.ssid, passphrase]),
    disconnectWifi: (_system, wifi) => ask(["disconnect", wifi.device]),
    forgetWifi: (_system, wifi, saved) =>
      ask(["forget", wifi.device, saved.ssid]),
    scanWifi: (_system, wifi) => ask(["scan", wifi.device]),
    setWifiAutoJoin: (_system, wifi, saved, autoJoin) =>
      ask(["autoJoin", wifi.device, saved.ssid, autoJoin]),
    setWifiEnabled: (_system, wifi, enabled) =>
      ask(["setEnabled", wifi.device, enabled]),
  };
  return { actions, asked };
};

export type { Asked };
