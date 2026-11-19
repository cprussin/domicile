// The stand-ins for Electron's `powerMonitor` and `powerSaveBlocker`.
//
// `powerMonitor` says when the desktop locks and unlocks, from
// `domicile subscribe status`, reads how long nobody has used it from
// `domicile idle-time`, and reads the battery from sysfs. `powerSaveBlocker`
// keeps the screens on with `domicile inhibit-idle`.

import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The fields of `domicile status --json` this reads. */
export type DesktopStatus = { readonly locked?: boolean };

const POWER_SUPPLY = "/sys/class/power_supply";

/** Whether the machine runs on a battery: one discharges and no mains is online. */
export const onBattery = (root = POWER_SUPPLY) => {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return false;
  }
  const read = (name: string, field: string) => {
    try {
      return readFileSync(join(root, name, field), "utf8").trim();
    } catch {
      return undefined;
    }
  };
  const mains = names.filter((name) => read(name, "type") === "Mains");
  if (mains.some((name) => read(name, "online") === "1")) {
    return false;
  }
  return names.some(
    (name) =>
      read(name, "type") === "Battery" &&
      read(name, "status") === "Discharging",
  );
};

/**
 * Electron's `powerMonitor`. `statuses` hands each desktop status to its
 * argument; `idleSeconds` says how many whole seconds nobody has used the
 * desktop.
 */
export const createPowerMonitor = (
  statuses: (heard: (status: DesktopStatus) => void) => void,
  idleSeconds: () => number,
  battery = onBattery,
) => {
  const monitor = new EventEmitter();
  let locked: boolean | undefined;
  let following = false;
  // Followed once the app listens or asks whether the desktop is locked.
  const follow = () => {
    if (!following) {
      following = true;
      statuses(heard);
    }
  };
  monitor.on("newListener", follow);
  const heard = (status: DesktopStatus) => {
    if (status.locked !== undefined && status.locked !== locked) {
      const first = locked === undefined;
      locked = status.locked;
      if (!first) {
        monitor.emit(locked ? "lock-screen" : "unlock-screen");
      }
    }
  };
  return Object.assign(monitor, {
    getCurrentThermalState: () => "unknown" as const,
    getSystemIdleState: (threshold: number) => {
      follow();
      if (locked === true) {
        return "locked" as const;
      }
      return idleSeconds() >= threshold
        ? ("idle" as const)
        : ("active" as const);
    },
    getSystemIdleTime: () => idleSeconds(),
    isOnBatteryPower: () => battery(),
    get onBatteryPower() {
      return battery();
    },
  });
};

/** A running `domicile inhibit-idle`, which `stop` ends. */
export type Inhibitor = { readonly stop: () => void };

/** Electron's `powerSaveBlocker`. `inhibit` keeps the screens on until stopped. */
export const createPowerSaveBlocker = (inhibit: () => Inhibitor) => {
  const blockers = new Map<number, Inhibitor>();
  let next = 0;
  return {
    isStarted: (id: number) => blockers.has(id),
    /** Both of Electron's types keep the screens on: Domicile has one idle. */
    start: (_type: "prevent-app-suspension" | "prevent-display-sleep") => {
      const id = next++;
      blockers.set(id, inhibit());
      return id;
    },
    stop: (id: number) => {
      const blocker = blockers.get(id);
      blocker?.stop();
      blockers.delete(id);
      return blocker !== undefined;
    },
  };
};
