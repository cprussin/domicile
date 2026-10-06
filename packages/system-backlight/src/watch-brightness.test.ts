import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  Exit,
  SpawnOptions,
  Subprocess,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Signal, SystemErrorKind } from "@domicile-desktop/sdk/system";

import type { Devices } from "./fake-system";
import { fakeSysfs, THINKPAD } from "./fake-system";
import type { BrightnessWatch } from "./watch-brightness";
import { watchBrightness } from "./watch-brightness";

/** What `udevadm monitor` printed on a ThinkPad when a brightness key was pressed. */
const HEADER =
  "monitor will print the received events for:\nKERNEL - the kernel uevent\n\n";
const CHANGE =
  "KERNEL[9214.375126] change   /devices/pci0000:00/0000:00:02.0/drm/card1/card1-eDP-1/intel_backlight (backlight)\n";

const LOCKED: SystemError = {
  kind: SystemErrorKind.Locked,
  message: "the desktop is locked",
};

/** A panel out of 10000, fine enough to move by less than a percent. */
const fine = (brightness: number): Devices => ({
  panel: {
    brightness: `${brightness}\n`,
    max_brightness: "10000\n",
    type: "raw\n",
  },
});

/** A machine with a `udevadm` the test speaks for and a clock it turns. */
const machine = (devices: Devices | undefined) => {
  const sysfs = fakeSysfs(devices);
  /** Each listing of `/sys/class/backlight`: one per read. */
  const listings: (() => void)[] = [];
  let listed = 0;
  const encoder = new TextEncoder();
  let stdout: ReadableStreamDefaultController<Uint8Array> | undefined;
  const exited = Promise.withResolvers<Result<Exit, SystemError>>();
  const killed: Signal[] = [];
  const firstKill = Promise.withResolvers<void>();
  const spawned: (readonly string[])[] = [];
  const timers: { ms: number; tick: () => void; cleared: boolean }[] = [];
  const process: Subprocess = {
    closeStdin: () => {
      throw new Error("the watch has no stdin");
    },
    exited: exited.promise,
    kill: (signal = Signal.Term) => {
      killed.push(signal);
      firstKill.resolve();
    },
    stderr: new ReadableStream(),
    stdout: new ReadableStream({
      start: (controller) => {
        stdout = controller;
      },
    }),
    write: () => {
      throw new Error("the watch has no stdin");
    },
  };
  const levels: number[] = [];
  const heard: (() => void)[] = [];
  return {
    every: (ms: number, tick: () => void) => {
      const timer = { cleared: false, ms, tick };
      timers.push(timer);
      return () => {
        timer.cleared = true;
      };
    },
    exit: (result: Result<Exit, SystemError>) => {
      stdout?.close();
      exited.resolve(result);
    },
    host: {
      ...sysfs.host,
      readDir: async (path: string) => {
        const listing = await sysfs.host.readDir(path);
        listed += 1;
        for (const waiting of listings.splice(0)) {
          waiting();
        }
        return listing;
      },
      spawn: (argv: readonly string[], _options?: SpawnOptions) => {
        spawned.push(argv);
        return Promise.resolve(Ok<Subprocess, SystemError>(process));
      },
    },
    killed,
    /** Resolves once udevadm has been signaled. */
    killing: firstKill.promise,
    levels,
    /** How many times the backlight was read. */
    listed: () => listed,
    onLevel: (level: number) => {
      levels.push(level);
      heard.shift()?.();
    },
    /** Resolves once the backlight has been read `count` times. */
    read: async (count: number) => {
      while (listed < count) {
        await new Promise<void>((resolve) => {
          listings.push(resolve);
        });
      }
    },
    say: (text: string) => {
      stdout?.enqueue(encoder.encode(text));
    },
    set: sysfs.set,
    spawned,
    timers,
    /** Resolves once `count` levels have been reported. */
    until: (count: number) =>
      levels.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            heard.push(() => {
              if (levels.length >= count) {
                resolve();
              }
            });
          }),
  };
};

const watching = async (
  desk: ReturnType<typeof machine>,
  host: ReturnType<typeof machine>["host"] = desk.host,
): Promise<BrightnessWatch> =>
  (await watchBrightness(host, desk.onLevel, desk.every)).match({
    Err: (error) => {
      throw new Error(`the watch did not start: ${error.message}`);
    },
    Ok: (watch) => watch,
  });

describe("watchBrightness", () => {
  it("reports the level it starts at", async () => {
    const desk = machine(THINKPAD);

    await watching(desk);
    await desk.until(1);

    expect(desk.spawned).toStrictEqual([
      ["udevadm", "monitor", "--kernel", "--subsystem-match=backlight"],
    ]);
    expect(desk.levels).toStrictEqual([0.6]);
  });

  // Any write through `/sys`, logind's and a brightness key's included, sends
  // a uevent.
  it("reads again when the kernel announces a change", async () => {
    const desk = machine(fine(4200));
    await watching(desk);
    await desk.until(1);

    desk.set(fine(7000));
    desk.say(HEADER);
    desk.say(CHANGE.slice(0, 20));
    desk.say(CHANGE.slice(20));
    await desk.until(2);

    expect(desk.levels).toStrictEqual([0.42, 0.7]);
    expect(desk.listed()).toBe(2);
  });

  // The slider shows no finer.
  it("reports only a move of a whole percent", async () => {
    const desk = machine(fine(4200));
    await watching(desk);
    await desk.until(1);

    desk.set(fine(4204));
    desk.say(CHANGE);
    await desk.read(2);
    desk.set(fine(4300));
    desk.say(CHANGE);
    await desk.until(2);

    expect(desk.levels).toStrictEqual([0.42, 0.43]);
  });

  it("reports a backlight that comes back", async () => {
    const desk = machine(fine(5000));
    await watching(desk);
    await desk.until(1);

    desk.set(undefined);
    desk.say(CHANGE);
    await desk.read(2);
    desk.set(fine(5000));
    desk.say(CHANGE);
    await desk.until(2);

    expect(desk.levels).toStrictEqual([0.5, 0.5]);
  });

  // Firmware brightness keys may send no uevent.
  it("reads again every two minutes", async () => {
    const desk = machine(fine(4200));
    await watching(desk);
    await desk.until(1);

    desk.set(fine(6000));
    for (const timer of desk.timers) {
      timer.tick();
    }
    await desk.until(2);

    expect(desk.timers.map(({ ms }) => ms)).toStrictEqual([120_000]);
    expect(desk.levels).toStrictEqual([0.42, 0.6]);
  });

  it("fails when udevadm cannot start", async () => {
    const desk = machine(THINKPAD);

    expect(
      await watchBrightness(
        { ...desk.host, spawn: async () => Err(LOCKED) },
        desk.onLevel,
        desk.every,
      ),
    ).toStrictEqual(Err(LOCKED));
    expect(desk.timers).toStrictEqual([]);
  });

  it("stops udevadm and the clock when stopped", async () => {
    const desk = machine(THINKPAD);
    const watch = await watching(desk);

    watch.stop();
    desk.exit(Ok({ code: undefined, signal: 15 }));

    expect(await watch.ended).toStrictEqual(Ok("stopped"));
    expect(desk.killed).toStrictEqual([Signal.Term]);
    expect(desk.timers.map(({ cleared }) => cleared)).toStrictEqual([true]);
  });

  it("ends with an error when udevadm exits on its own", async () => {
    const desk = machine(THINKPAD);
    const watch = await watching(desk);

    desk.exit(Ok({ code: 1, signal: undefined }));

    expect(await watch.ended).toStrictEqual(
      Err({
        kind: SystemErrorKind.Other,
        message: "udevadm monitor exited with code 1",
      }),
    );
    expect(desk.timers.map(({ cleared }) => cleared)).toStrictEqual([true]);
  });

  it("stops with the error when /sys cannot be read", async () => {
    const desk = machine(THINKPAD);
    const watch = await watching(desk, {
      ...desk.host,
      readDir: async () => Err(LOCKED),
    });

    await desk.killing;
    desk.exit(Ok({ code: undefined, signal: 15 }));

    expect(await watch.ended).toStrictEqual(Err(LOCKED));
    expect(desk.killed).toStrictEqual([Signal.Term]);
  });
});
