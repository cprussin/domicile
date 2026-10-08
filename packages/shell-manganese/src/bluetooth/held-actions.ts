import type { Result } from "@cprussin/option-result";
import { Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Device } from "@domicile-desktop/system-bluetooth/bluetooth";

import type { BluetoothActions } from "./bluetooth-actions";

/** A request as a test sees it: its name and what it named. */
export type Asked = [string, ...unknown[]];

/**
 * BlueZ's requests for tests: each is recorded in `asked` and answers with
 * `answer`, `Ok` by default.
 */
export const heldActions = (
  answer: (asked: Asked) => Result<"done", SystemError> = () => Ok("done"),
) => {
  const asked: Asked[] = [];
  const ask = (request: Asked) => {
    asked.push(request);
    return Promise.resolve(answer(request));
  };
  const actions: BluetoothActions = {
    connect: (_system, device: string) => ask(["connect", device]),
    disconnect: (_system, device: string) => ask(["disconnect", device]),
    forget: (_system, device: Pick<Device, "adapter" | "path">) =>
      ask(["forget", device.path]),
    pair: (_system, device: string) => ask(["pair", device]),
    setPowered: async (_system, adapter: string, powered: boolean) =>
      (await ask(["setPowered", adapter, powered])).map(() => "set"),
    startDiscovery: (_system, adapter: string) =>
      ask(["startDiscovery", adapter]),
    stopDiscovery: (_system, adapter: string) =>
      ask(["stopDiscovery", adapter]),
  };
  return { actions, asked };
};
