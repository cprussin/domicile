// The desktop's screens.

import type { DisplayTransform } from "../display-transform";
import { asDisplayTransform } from "../display-transform";
import type { DomicileDisplay, DomicileHost } from "../domicile-host";
import type { System } from "../system";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/** One screen. Sizes are whole CSS pixels; see `DomicileDisplay`. */
export type Display = Omit<DomicileDisplay, "transform"> & {
  readonly transform: DisplayTransform;
};

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
   * docs/architecture/CASTING-TO-TVS.md.
   */
  addVirtual: System["addVirtualMonitor"];
  on: On<DisplaysListeners>;
};

export type DisplaysHost = Pick<
  DomicileHost,
  "addEventListener" | "displays" | "removeEventListener"
>;

export const displays = (
  host: DisplaysHost,
  calls: Pick<System, "addVirtualMonitor">,
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
  };
};

const displayOf = (display: DomicileDisplay): Display => ({
  height: display.height,
  modeHeight: display.modeHeight,
  modeWidth: display.modeWidth,
  name: display.name,
  scale: display.scale,
  transform: asDisplayTransform(display.transform),
  width: display.width,
  x: display.x,
  y: display.y,
});
