import type { SharedWatch } from "@domicile-desktop/react/shared-watch";
import { colorTemperature } from "./color-temperature";
import type { Every } from "./every";
import type { Override } from "./night-light-override";
import type { Night, Schedule } from "./night-light-schedule";
import { nightEnd, nightsAround, strengthAt } from "./night-light-schedule";

/** What the config and Settings set for the night light. */
export type NightLightSettings = {
  /** When it comes on by itself, or `undefined` for only by hand. */
  readonly schedule: Schedule | undefined;
  /** 0 to 100. See {@link colorTemperature}. */
  readonly warmth: number;
};

/** The night light, shared by the desktop that runs it and every bar. */
export type NightLight = {
  /** Whether the screen is warm, or warming, now. */
  on: SharedWatch<boolean>;
  /**
   * Turns it off when on and on when off, as macOS does: against the schedule
   * until the schedule's next change, or for good without one.
   */
  toggle: () => void;
  /** Tints the screen by `settings` until the returned function stops it. */
  run: (settings: NightLightSettings) => () => void;
};

/** What {@link nightLight} reads and changes. */
export type NightLightDeps = {
  /** Sets the screen's color temperature in kelvin. */
  tint: (kelvin: number) => void;
  now: () => Date;
  every: Every;
  stored: () => Override | undefined;
  store: (override: Override | undefined) => void;
};

/** How often the light follows its schedule: often enough to ease smoothly. */
const TICK_MS = 15_000;

/** A night light that tints through `tint` while it runs. */
export const nightLight = ({
  every,
  now,
  store,
  stored,
  tint,
}: NightLightDeps): NightLight => {
  const listeners = new Set<() => void>();
  const state: {
    on: boolean;
    override: Override | undefined;
    settings: NightLightSettings | undefined;
    // The last temperature sent, so each tick sends only a change.
    sent: number | undefined;
  } = { on: false, override: stored(), sent: undefined, settings: undefined };

  const nights = (at: Date): Night[] =>
    state.settings?.schedule === undefined
      ? []
      : nightsAround(at, state.settings.schedule);

  const setOverride = (override: Override | undefined) => {
    state.override = override;
    store(override);
  };

  const follow = () => {
    const at = now();
    if (
      state.override?.until !== undefined &&
      at.getTime() >= state.override.until
    ) {
      setOverride(undefined);
    }
    const strength =
      state.override === undefined
        ? strengthAt(at, nights(at))
        : Number(state.override.on);
    if (state.on !== strength > 0) {
      state.on = strength > 0;
      for (const listener of listeners) {
        listener();
      }
    }
    if (state.settings !== undefined) {
      const kelvin = colorTemperature(state.settings.warmth, strength);
      if (kelvin !== state.sent) {
        state.sent = kelvin;
        tint(kelvin);
      }
    }
  };

  return {
    on: {
      current: () => state.on,
      subscribe: (onChange) => {
        listeners.add(onChange);
        return () => {
          listeners.delete(onChange);
        };
      },
    },
    run: (settings) => {
      state.settings = settings;
      state.sent = undefined;
      follow();
      const stop = every(TICK_MS, follow);
      return () => {
        stop();
        state.settings = undefined;
      };
    },
    toggle: () => {
      const at = now();
      const tonight = nights(at);
      const turnOn = !state.on;
      setOverride(
        turnOn === strengthAt(at, tonight) > 0
          ? undefined
          : { on: turnOn, until: nightEnd(at, tonight)?.getTime() },
      );
      follow();
    },
  };
};
