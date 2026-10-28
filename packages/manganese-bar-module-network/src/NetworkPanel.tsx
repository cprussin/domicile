import type { Option, Result } from "@cprussin/option-result";
import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { useSharedWatch } from "@domicile-desktop/react/use-shared-watch";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type {
  Addressing,
  NetworkInterface,
} from "@domicile-desktop/system-network/interfaces";
import type { Wifi } from "@domicile-desktop/system-network/wifi";

import { flex } from "../styled-system/patterns";
import { WifiPanel } from "./WifiPanel";
import { WiredPanel } from "./WiredPanel";
import type { WifiActions } from "./wifi-actions";

/**
 * The panel, which watches Wi-Fi and the addresses while it is open. It
 * takes its container's width; a long address wraps rather than widening
 * it.
 */
export const NetworkPanel = ({
  actions,
  addresses,
  host,
  wifi,
  wired,
}: {
  actions: WifiActions;
  addresses: SharedWatch<Result<Map<string, Addressing>, SystemError>>;
  host: Domicile;
  wifi: SharedWatch<Result<Option<Wifi>, SystemError>>;
  wired: NetworkInterface[];
}) => {
  const addressing = useSharedWatch(addresses);
  return (
    <div className={panelStyles}>
      {wired.length > 0 && <WiredPanel addresses={addressing} ports={wired} />}
      <WifiPanel
        actions={actions}
        addresses={addressing}
        host={host}
        wifi={useSharedWatch(wifi)}
      />
    </div>
  );
};

const panelStyles = flex({ direction: "column", gap: 3, minInlineSize: 0 });
