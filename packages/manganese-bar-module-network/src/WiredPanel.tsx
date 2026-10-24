import type { NetworkInterface } from "@domicile-desktop/system-network/interfaces";
import { NetworkIcon } from "@phosphor-icons/react/dist/ssr/Network";
import { css } from "../styled-system/css";
import { flex, hstack } from "../styled-system/patterns";
import type { Addresses } from "./addressing";
import { addressRowsOf } from "./addressing";
import type { Value } from "./Details";
import { Details } from "./Details";

type Props = {
  /** The wired ports. */
  ports: readonly NetworkInterface[];
  addresses: Addresses;
};

/** Each wired port: whether a cable is in, its speed, addresses and hardware address. */
export const WiredPanel = ({ addresses, ports }: Props) => (
  <div className={panelStyles}>
    {ports.map((port) => (
      <Port addresses={addresses} key={port.name} port={port} />
    ))}
  </div>
);

const Port = ({
  addresses,
  port,
}: {
  port: NetworkInterface;
  addresses: Props["addresses"];
}) => (
  <section
    aria-label={`Wired: ${port.name}, ${port.up ? "connected" : "no cable"}`}
    className={portStyles}
  >
    <span className={headStyles}>
      <NetworkIcon aria-hidden size={14} weight="bold" />
      <span className={nameStyles}>Wired</span>
      <span className={noteStyles}>{port.up ? "Connected" : "No cable"}</span>
    </span>
    {addresses?.match({
      Err: (error) => <span className={errorStyles}>{error.message}</span>,
      Ok: () => undefined,
    })}
    <Details rows={detailsOf(port, addresses)} />
  </section>
);

/** The port's details, leaving out what is unknown. */
const detailsOf = (
  port: NetworkInterface,
  addresses: Props["addresses"],
): (readonly [string, Value])[] => [
  ...(port.speed === undefined
    ? []
    : [["Speed", `${port.speed} Mbit/s`] as const]),
  ...addressRowsOf(addresses, port.name),
  ["Interface", port.name],
  ["Hardware address", port.hardwareAddress],
];

const panelStyles = flex({ direction: "column", gap: 2 });

const portStyles = flex({
  borderBlockEnd:
    "1px solid color-mix(in oklab, currentcolor 15%, transparent)",
  direction: "column",
  gap: 1,
  paddingBlockEnd: 2,
});

const headStyles = hstack({ gap: 1.5 });

const nameStyles = css({ flex: "1 1 auto" });

const noteStyles = css({ opacity: 0.75 });

const errorStyles = css({ color: "warning" });
