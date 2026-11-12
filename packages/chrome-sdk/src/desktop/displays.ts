// The desktop's screens.

import type { DisplayTransform } from "../display-transform";
import { asDisplayTransform } from "../display-transform";
import type { DomicileDisplay, DomicileHost } from "../domicile-host";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";
import type { System } from "./system-calls";

/**
 * Whether a screen scans out with a variable refresh rate. `unsupported` when
 * its panel, connector or driver cannot, or when Domicile runs in a window.
 * `off` when it can and its display profile does not ask for it, or the
 * driver refused it.
 */
export type AdaptiveSync = "unsupported" | "off" | "on";

/** One screen. Sizes are whole CSS pixels; see `DomicileDisplay`. */
export type Display = Omit<DomicileDisplay, "adaptiveSync" | "transform"> & {
  readonly adaptiveSync: AdaptiveSync;
  readonly transform: DisplayTransform;
};

// A state this SDK has no name for asks nothing of a shell.
const asAdaptiveSync = (adaptiveSync: string): AdaptiveSync =>
  adaptiveSync === "off" || adaptiveSync === "on"
    ? adaptiveSync
    : "unsupported";

export type DisplaysListeners = {
  /** A screen arrived or left, or one was resized or rescaled. */
  change: () => void;
};

export type Displays = {
  /**
   * The screens. `undefined` until the compositor describes the desktop: wait.
   * Empty for a desktop with no screens.
   */
  readonly list: readonly Display[] | undefined;
  /**
   * Add a monitor with no connector, which the desk extends onto and only a
   * capture shows: casting to a TV. A later `list` has it. It lasts until
   * removed, or until the page goes away. See
   * docs/CASTING-TO-TVS.md.
   */
  addVirtual: System["addVirtualMonitor"];
  /**
   * Draw `display` (a {@link Display.name}), or every monitor when it is
   * left out, as if its white were a light of `kelvin` (1000 to 6500), as a
   * night light does; 6500 draws colors as they are. Every monitor's replaces
   * each one's. Allowed while the desktop is locked. Changes nothing on a
   * nested desktop, nor on a monitor a night-light app such as gammastep
   * holds.
   */
  setColorTemperature: System["setColorTemperature"];
  /**
   * Turn every monitor off now, keeping windows and workspaces as they are.
   * Input more than a second later lights them again, as does
   * {@link Displays.wake}. With `display` (a {@link Display.name}), turn only
   * that one off until it is woken. See docs/IDLE.md#sleeping-on-demand.
   */
  sleep: System["sleepDisplays"];
  /**
   * Light the monitors again, after {@link Displays.sleep} or idle blanking,
   * or only `display`.
   */
  wake: System["wakeDisplays"];
  on: On<DisplaysListeners>;
};

export type DisplaysHost = Pick<
  DomicileHost,
  "addEventListener" | "displays" | "removeEventListener"
>;

export const displays = (
  host: DisplaysHost,
  calls: Pick<
    System,
    | "addVirtualMonitor"
    | "setColorTemperature"
    | "sleepDisplays"
    | "wakeDisplays"
  >,
): Displays => {
  const listOf = memoizeLast((list: readonly DomicileDisplay[] | null) =>
    list?.map(displayOf),
  );
  return {
    addVirtual: (mode) => calls.addVirtualMonitor(mode),
    get list() {
      return listOf(host.displays);
    },
    on: on<DisplaysListeners>({
      change: (listener) =>
        hostEvent(host, "displayschanged", () => listener()),
    }),
    setColorTemperature: (kelvin, display) =>
      calls.setColorTemperature(kelvin, display),
    sleep: (display) => calls.sleepDisplays(display),
    wake: (display) => calls.wakeDisplays(display),
  };
};

const displayOf = (display: DomicileDisplay): Display => ({
  adaptiveSync: asAdaptiveSync(display.adaptiveSync),
  height: display.height,
  modeHeight: display.modeHeight,
  modeWidth: display.modeWidth,
  name: display.name,
  refreshMhz: display.refreshMhz,
  scale: display.scale,
  transform: asDisplayTransform(display.transform),
  width: display.width,
  x: display.x,
  y: display.y,
});
