import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import type { NetworkDesktop } from "./network-state";

/**
 * Whether `name` has an owner on the system bus. `NameHasOwner` does not start
 * a service that D-Bus can activate, as a call to the service would.
 */
export const hasOwner = async (
  domicile: NetworkDesktop,
  name: string,
): Promise<Result<boolean, SystemError>> =>
  (
    await domicile.dbus.call({
      body: [name],
      bus: Bus.System,
      destination: "org.freedesktop.DBus",
      interface: "org.freedesktop.DBus",
      member: "NameHasOwner",
      path: "/org/freedesktop/DBus",
      signature: "s",
    })
  ).map(({ body }) => z.tuple([z.boolean()]).parse(body)[0]);
