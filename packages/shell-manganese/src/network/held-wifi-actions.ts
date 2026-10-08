import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";

import type { WifiActions } from "./wifi-actions";

/** A request as a test sees it: its name and what it named. */
export type Asked = [string, ...unknown[]];

/**
 * The Wi-Fi service's requests for tests: each is recorded in `asked` and
 * answers with `answer`, `Ok` by default.
 */
export const heldWifiActions = (
  answer: (asked: Asked) => Result<"done", SystemError> = () => Ok("done"),
) => {
  const asked: Asked[] = [];
  const ask = (request: Asked) => {
    asked.push(request);
    return Promise.resolve(answer(request));
  };
  const actions: WifiActions = {
    connectWifi: (_system, wifi, network, passphrase) =>
      ask(["connect", wifi.device, network.ssid, passphrase]),
    disconnectWifi: (_system, wifi) => ask(["disconnect", wifi.device]),
    scanWifi: (_system, wifi) => ask(["scan", wifi.device]),
    setWifiEnabled: (_system, wifi, enabled) =>
      ask(["setEnabled", wifi.device, enabled]),
  };
  return { actions, asked };
};
