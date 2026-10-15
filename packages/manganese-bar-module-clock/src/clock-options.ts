import { createContext } from "react";

/** How the clock tells the time. */
export type ClockOptions = {
  /** A 24-hour clock, or a 12-hour one with AM or PM. */
  readonly format: "24h" | "12h";
  /** Whether it shows the seconds. */
  readonly seconds: boolean;
};

/** A 24-hour clock to the second. */
export const CLOCK_DEFAULTS: ClockOptions = { format: "24h", seconds: true };

/**
 * How every `<Clock />` under it tells the time. manganese provides the
 * shell's `clock` options here.
 */
export const ClockOptionsContext = createContext<ClockOptions>(CLOCK_DEFAULTS);
