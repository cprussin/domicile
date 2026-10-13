import type { Option } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";
import type { Listening } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
import type { Battery } from "@domicile-desktop/system-battery/battery";
import { watchBattery as watchUPower } from "@domicile-desktop/system-battery/battery";

/** Injectable so tests can drive their own library and see failures. */
type Dependencies = {
  fail?: (error: unknown) => void;
  watch?: typeof watchUPower;
};

/**
 * Watches the battery through UPower: calls `onReading` with the current
 * reading and each change, and returns a function that stops watching.
 */
export const watchBattery = (
  domicile: DomicileHost,
  onReading: (reading: Option<Battery>) => void,
  { fail = logFailure, watch = watchUPower }: Dependencies = {},
): (() => void) => {
  const now: { stop: () => void; stopped: boolean } = {
    stop: () => undefined,
    stopped: false,
  };
  watch(system(domicile))
    .then((result) => {
      if (now.stopped) {
        result.map(stopNow);
      } else {
        now.stop = result.match({
          Err: (error) => failed(fail, error),
          Ok: (battery) => follow(battery, onReading, fail),
        });
      }
    })
    .catch(fail);
  return () => {
    now.stopped = true;
    now.stop();
  };
};

/** Hand each reading to `onReading`; returns what stops it. */
const follow = (
  battery: Listening<Option<Battery>>,
  onReading: (reading: Option<Battery>) => void,
  fail: (error: unknown) => void,
): (() => void) => {
  each(battery.items, onReading).catch(fail);
  battery.ended
    .then((ended) => {
      ended.match({ Err: fail, Ok: () => undefined });
    })
    .catch(fail);
  return battery.stop;
};

/** Calls `onItem` with each item until `items` closes. */
const each = async <T>(
  items: ReadableStream<T>,
  onItem: (item: T) => void,
): Promise<void> => {
  const reader = items.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    onItem(next.value);
  }
};

const stopNow = (battery: Listening<Option<Battery>>) => {
  battery.stop();
  return battery;
};

/** Report `error`; there is nothing to stop. */
const failed = (fail: (error: unknown) => void, error: unknown) => {
  fail(error);
  return () => undefined;
};

const logFailure = (error: unknown) => {
  // biome-ignore lint/suspicious/noConsole: the bar shows no battery, and this says why
  console.error("manganese: no battery reading", error);
};
