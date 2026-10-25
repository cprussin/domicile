// The Google Cast TVs the browser's Media Router finds, and casts of the
// desktop to them. See docs/CASTING-TO-TVS.md.

import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";

import type { DomicileCastSink, DomicileHost } from "../domicile-host";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type GoogleCastListeners = {
  /** {@link GoogleCast.receivers} changed. */
  change: () => void;
};

export type GoogleCast = {
  /** The TVs near, each with the route of its cast while one runs. */
  readonly receivers: readonly DomicileCastSink[];
  /** Cast the desktop to TV `id`: its route, or why the TV refused. */
  cast: (id: string) => Promise<Result<string, string>>;
  /** Stop cast `route`; its TV's `route` is null in the next `change`. */
  stop: (route: string) => void;
  on: On<GoogleCastListeners>;
};

export type GoogleCastHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "castSinks"
  | "removeEventListener"
  | "startCasting"
  | "stopCasting"
>;

export const googleCast = (host: GoogleCastHost): GoogleCast => ({
  cast: (id) =>
    host.startCasting(id).then(
      (route) => Ok<string, string>(route),
      (error: unknown) =>
        Err<string, string>(
          error instanceof Error ? error.message : String(error),
        ),
    ),
  on: on<GoogleCastListeners>({
    change: (listener) => hostEvent(host, "castsinkschanged", () => listener()),
  }),
  get receivers() {
    return host.castSinks ?? [];
  },
  stop: (route) => {
    host.stopCasting(route);
  },
});
