// The Battery Status API, which TypeScript's DOM library does not declare:
// only some browsers implement it, and `lib.dom.d.ts` carries what all of them
// do. Domicile's engine is Chromium, which does — the browser process answers
// it off UPower, and `domicile://` is registered as a secure scheme, which is
// what the API is gated on.
//
// Declared here rather than parsed with Zod at the boundary because there is
// no serialized frame to parse: these are a live object's own properties, as
// the engine's IDL defines them.

/** The machine's battery, as `navigator.getBattery` answers with it. */
interface BatteryManager extends EventTarget {
  /** Whether the machine is running on AC. */
  readonly charging: boolean;
  /** How full, 0 through 1. */
  readonly level: number;
}

// biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging into `Navigator` requires an interface
interface Navigator {
  /** Optional: a browser that does not implement the API does not have it. */
  getBattery?: () => Promise<BatteryManager>;
}
