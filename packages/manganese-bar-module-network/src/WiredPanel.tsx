import type { Detail } from "@domicile-desktop/component-library/DetailList";
import { DetailList } from "@domicile-desktop/component-library/DetailList";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { PanelNote } from "@domicile-desktop/component-library/PanelNote";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import type { NetworkInterface } from "@domicile-desktop/system-network/interfaces";
import { NetworkIcon } from "@phosphor-icons/react/dist/ssr/Network";
import type { Addresses } from "./addressing";
import { addressRowsOf, COPYABLE } from "./addressing";
import { speedOf } from "./speed";

type Props = {
  /** The wired ports. */
  ports: readonly NetworkInterface[];
  addresses: Addresses;
};

/** Each wired port: whether a cable is in and its speed, with its addresses folded away. */
export const WiredPanel = ({ addresses, ports }: Props) => (
  <PanelSection label="Wired">
    <List>
      {ports.map((port) => (
        <ListRow
          detail={
            port.up && port.speed !== undefined
              ? speedOf(port.speed)
              : undefined
          }
          disclosure="Details"
          icon={<NetworkIcon size={15} weight="bold" />}
          key={port.name}
          label={port.up ? "Connected" : "No cable"}
          surface="filled"
        >
          {addresses?.match({
            Err: (error) => (
              <PanelNote detail={error.message} tone="warning">
                Couldn't read the addresses
              </PanelNote>
            ),
            Ok: () => undefined,
          })}
          <DetailList rows={detailsOf(port, addresses)} />
        </ListRow>
      ))}
    </List>
  </PanelSection>
);

/** The port's details, leaving out what is unknown. */
const detailsOf = (port: NetworkInterface, addresses: Addresses): Detail[] => [
  ...addressRowsOf(addresses, port.name),
  ["Interface", port.name, COPYABLE],
  ["Hardware address", port.hardwareAddress, COPYABLE],
];
