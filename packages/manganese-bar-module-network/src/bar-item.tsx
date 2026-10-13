import { useDomicile } from "@domicile-desktop/manganese-host/domicile-context";
import { deskNetwork } from "./desk-network";
import { Network as Connection } from "./Network";

/** The primary network connection, whose panel controls Wi-Fi. */
export const Network = () => {
  const domicile = useDomicile();
  const { network, wifi } = deskNetwork(domicile);
  return <Connection domicile={domicile} network={network} wifi={wifi} />;
};
