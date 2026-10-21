import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { deskNetwork } from "./desk-network";
import { Network as Connection } from "./Network";

/** The primary network connection, whose panel shows the wired ports and controls Wi-Fi. */
export const Network = () => {
  const domicile = useDomicile();
  const { addresses, interfaces, network, wifi } = deskNetwork(domicile);
  return (
    <Connection
      addresses={addresses}
      domicile={domicile}
      interfaces={interfaces}
      network={network}
      wifi={wifi}
    />
  );
};
