import { useDomicile } from "@domicile-desktop/react/domicile-provider";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import { InterfaceKind } from "@domicile-desktop/system-network/interfaces";
import { deskNetwork } from "@domicile-desktop/system-network/react";

import { NetworkPanel } from "./NetworkPanel";
import { NetworkGlyph, NetworkTile } from "./NetworkQuick";
import { WIFI_ACTIONS } from "./wifi-actions";

/** The desk's network icon, for the quick settings button. */
export const NetworkIndicator = () => {
  const { interfaces, network } = deskNetwork(useDomicile());
  return <NetworkGlyph interfaces={interfaces} network={network} />;
};

/** The desk's network tile, for the quick settings panel. */
export const NetworkCard = ({
  onMore,
}: {
  onMore?: (() => void) | undefined;
}) => {
  const { interfaces, wifi } = deskNetwork(useDomicile());
  return <NetworkTile interfaces={interfaces} onMore={onMore} wifi={wifi} />;
};

/** The desk's wired ports and Wi-Fi panel, for the quick settings panel's details. */
export const NetworkDetails = () => {
  const domicile = useDomicile();
  const { addresses, interfaces, wifi } = deskNetwork(domicile);
  const ports = useSharedWatch(interfaces)?.match({
    Err: () => [],
    Ok: (found) => found,
  });
  return (
    <NetworkPanel
      actions={WIFI_ACTIONS}
      addresses={addresses}
      host={domicile}
      wifi={wifi}
      wired={(ports ?? []).filter(({ kind }) => kind === InterfaceKind.Wired)}
    />
  );
};
