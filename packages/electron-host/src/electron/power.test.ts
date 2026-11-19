import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DesktopStatus } from "./power";
import { createPowerMonitor, createPowerSaveBlocker, onBattery } from "./power";

const supplies = (entries: Record<string, Record<string, string>>) => {
  const root = mkdtempSync(join(tmpdir(), "power-supply-"));
  for (const [name, fields] of Object.entries(entries)) {
    mkdirSync(join(root, name));
    for (const [field, value] of Object.entries(fields)) {
      writeFileSync(join(root, name, field), `${value}\n`);
    }
  }
  return root;
};

describe("powerMonitor", () => {
  it("says when the desktop locks and unlocks, not how it started", () => {
    let hear: (status: DesktopStatus) => void = () => undefined;
    const monitor = createPowerMonitor(
      (heard) => {
        hear = heard;
      },
      () => 0,
      () => false,
    );
    const seen: string[] = [];
    monitor.on("lock-screen", () => seen.push("lock"));
    monitor.on("unlock-screen", () => seen.push("unlock"));

    hear({ locked: false });
    hear({ locked: true });
    expect(monitor.getSystemIdleState(60)).toBe("locked");
    hear({ locked: true });
    hear({ locked: false });

    expect(seen).toEqual(["lock", "unlock"]);
    expect(monitor.getSystemIdleState(60)).toBe("active");
  });

  it("reads how long nobody has used the desktop", () => {
    let idle = 30;
    const monitor = createPowerMonitor(
      () => undefined,
      () => idle,
      () => false,
    );

    expect(monitor.getSystemIdleTime()).toBe(30);
    expect(monitor.getSystemIdleState(60)).toBe("active");
    idle = 60;
    expect(monitor.getSystemIdleState(60)).toBe("idle");
  });

  it("reads a locked desktop as locked however long it sat", () => {
    let hear: (status: DesktopStatus) => void = () => undefined;
    const monitor = createPowerMonitor(
      (heard) => {
        hear = heard;
      },
      () => 600,
      () => false,
    );

    monitor.getSystemIdleState(60);
    hear({ locked: true });

    expect(monitor.getSystemIdleState(60)).toBe("locked");
  });

  it("reads the battery from sysfs", () => {
    expect(
      onBattery(
        supplies({
          AC: { online: "0", type: "Mains" },
          BAT0: { status: "Discharging", type: "Battery" },
        }),
      ),
    ).toBe(true);
    expect(
      onBattery(
        supplies({
          AC: { online: "1", type: "Mains" },
          BAT0: { status: "Charging", type: "Battery" },
        }),
      ),
    ).toBe(false);
    expect(onBattery(join(tmpdir(), "no-such-power-supply"))).toBe(false);
  });
});

describe("powerSaveBlocker", () => {
  it("keeps an inhibitor running from start to stop", () => {
    const running: string[] = [];
    const blocker = createPowerSaveBlocker(() => {
      const name = `inhibitor ${running.length}`;
      running.push(name);
      return { stop: () => running.splice(running.indexOf(name), 1) };
    });

    const id = blocker.start("prevent-display-sleep");
    expect(blocker.isStarted(id)).toBe(true);
    expect(running).toEqual(["inhibitor 0"]);

    expect(blocker.stop(id)).toBe(true);
    expect(blocker.isStarted(id)).toBe(false);
    expect(running).toEqual([]);
  });
});
