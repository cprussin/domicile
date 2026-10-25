// The monitors with no connector that `virtual-monitor add` adds, for trying
// a second screen or capturing one. Each lasts until `virtual-monitor remove`
// or the page goes away. See docs/SHELL-SYSTEM-ACCESS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { perHost } from "@domicile-desktop/manganese-host/per-host";
import type { Displays } from "@domicile-desktop/sdk/desktop/displays";
import type { SystemError, VirtualMonitor } from "@domicile-desktop/sdk/system";

/** A virtual monitor's size, in pixels. */
export type MonitorSize = { readonly width: number; readonly height: number };

export type VirtualMonitors = {
  /** Adds one of `size` at 60Hz; `Ok` names its output. */
  add: (size: MonitorSize) => Promise<Result<string, SystemError>>;
  /** Removes the newest still here; `Ok` names its output. */
  remove: () => Result<string, string>;
};

/** What a virtual monitor shows as, such as in Settings. */
const NAME = "Virtual monitor";

const REFRESH_MHZ = 60_000;

/** The virtual monitors added through `displays`. */
export const virtualMonitors = (
  displays: Pick<Displays, "addVirtual">,
): VirtualMonitors => {
  const added: VirtualMonitor[] = [];
  const forget = (monitor: VirtualMonitor) => {
    const at = added.indexOf(monitor);
    if (at !== -1) {
      added.splice(at, 1);
    }
  };
  return {
    add: async (size) => {
      const result = await displays.addVirtual({
        ...size,
        name: NAME,
        refreshMhz: REFRESH_MHZ,
      });
      return result.map((monitor) => {
        added.push(monitor);
        void monitor.ended.then(() => {
          forget(monitor);
        });
        return monitor.output;
      });
    },
    remove: () => {
      const monitor = added.pop();
      if (monitor === undefined) {
        return Err("no virtual monitor to remove");
      } else {
        monitor.remove();
        return Ok(monitor.output);
      }
    },
  };
};

/** The desk's virtual monitors, shared by every caller. */
export const deskVirtualMonitors = perHost((domicile) =>
  virtualMonitors(domicile.displays),
);
