import type { Result } from "@cprussin/option-result";
import type {
  Detail,
  DetailOptions,
} from "@domicile-desktop/component-library/DetailList";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { Addressing } from "@domicile-desktop/system-network/interfaces";

/** An address or a name, which people paste elsewhere. */
export const COPYABLE: DetailOptions = { copyable: true };

/** An IP address, which people paste elsewhere. */
const ADDRESS: DetailOptions = { address: true, copyable: true };

/** Each interface's addresses, by name; `undefined` until `ip` answers. */
export type Addresses =
  | Result<Map<string, Addressing>, SystemError>
  | undefined;

/** The address and gateway rows for interface `name`, leaving out what is unknown. */
export const addressRowsOf = (addresses: Addresses, name: string): Detail[] => {
  const addressing = addresses?.match({
    Err: () => undefined,
    Ok: (byName) => byName.get(name),
  });
  return [
    ...(addressing === undefined || addressing.ipv4.length === 0
      ? []
      : [["IPv4 address", addressing.ipv4, ADDRESS] as const]),
    ...(addressing === undefined || addressing.ipv6.length === 0
      ? []
      : [["IPv6 address", addressing.ipv6, ADDRESS] as const]),
    ...(addressing?.gateway === undefined
      ? []
      : [["Gateway", addressing.gateway, ADDRESS] as const]),
  ];
};
