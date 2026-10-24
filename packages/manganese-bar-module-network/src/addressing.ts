import type { Result } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Addressing } from "@domicile-desktop/system-network/interfaces";
import type { Value } from "./Details";

/** Each interface's addresses, by name; `undefined` until `ip` answers. */
export type Addresses =
  | Result<Map<string, Addressing>, SystemError>
  | undefined;

/** The address and gateway rows for interface `name`, leaving out what is unknown. */
export const addressRowsOf = (
  addresses: Addresses,
  name: string,
): (readonly [string, Value])[] => {
  const addressing = addresses?.match({
    Err: () => undefined,
    Ok: (byName) => byName.get(name),
  });
  return [
    ...(addressing === undefined || addressing.addresses.length === 0
      ? []
      : [["Address", addressing.addresses] as const]),
    ...(addressing?.gateway === undefined
      ? []
      : [["Gateway", addressing.gateway] as const]),
  ];
};
