// `Properties.GetAll` on the objects of one of the network services.

import type { Result } from "@cprussin/option-result";
import { allProperties } from "@domicile-desktop/sdk/desktop/dbus-properties";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { Bus } from "@domicile-desktop/sdk/system";
import type { z } from "zod";

import type { NetworkDesktop } from "./network-state";

/** Reads the properties of `service`'s objects on the system bus. */
export const propertiesOn =
  (service: string) =>
  <T extends NonNullable<unknown>>(
    domicile: NetworkDesktop,
    path: string,
    interfaceName: string,
    schema: z.ZodType<T>,
  ): Promise<Result<T, SystemError>> =>
    allProperties(
      domicile.dbus,
      { bus: Bus.System, destination: service, interface: interfaceName, path },
      schema,
    );
