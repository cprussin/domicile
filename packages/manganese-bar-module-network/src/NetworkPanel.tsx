import type { Option, Result } from "@cprussin/option-result";
import { PanelNote } from "@domicile-desktop/component-library/PanelNote";
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
 * The panel, which watches Wi-Fi and the addresses while it is open: a Wired
 * section, then a Wi-Fi one. It takes its container's width; a long address
 * wraps rather than widening it.
 *
 * A port without a cable is left out, unless the machine has no Wi-Fi, when
 * an empty port is the news.
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
  const radio = useSharedWatch(wifi);
  const noRadio = radio?.match({
    Err: () => false,
    Ok: (found) => found.isNone(),
  });
  const plugged = wired.filter(({ up }) => up);
  const ports = plugged.length === 0 && noRadio === true ? wired : plugged;
  return (
    <div className={panelStyles}>
      {ports.length > 0 && <WiredPanel addresses={addressing} ports={ports} />}
      <WifiPanel
        actions={actions}
        addresses={addressing}
        host={host}
        wifi={radio}
      />
      {ports.length === 0 && noRadio === true && (
        <PanelNote>No network devices</PanelNote>
      )}
    </div>
  );
};

const panelStyles = flex({ direction: "column", gap: 3, minInlineSize: 0 });
