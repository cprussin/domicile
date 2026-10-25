import { describe, expect, it } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  SystemError,
  VirtualMonitor,
  VirtualMonitorMode,
} from "@domicile-desktop/sdk/system";

import { virtualMonitors } from "./virtual-monitors";

/** A desk that adds monitors `virtual-1`, `virtual-2`, … and logs removals. */
const fakeDesk = () => {
  const added: VirtualMonitorMode[] = [];
  const removed: string[] = [];
  const ends = new Map<string, () => void>();
  const addVirtual = (
    mode: VirtualMonitorMode,
  ): Promise<Result<VirtualMonitor, SystemError>> => {
    added.push(mode);
    const output = `virtual-${String(added.length)}`;
    const ended = new Promise<Result<"removed", SystemError>>((resolve) => {
      ends.set(output, () => {
        resolve(Ok("removed"));
      });
    });
    return Promise.resolve(
      Ok({
        ended,
        output,
        remove: () => {
          removed.push(output);
          ends.get(output)?.();
        },
      }),
    );
  };
  return { added, addVirtual, ends, removed };
};

describe("virtualMonitors", () => {
  it("adds a monitor of the size asked, at 60Hz", async () => {
    const desk = fakeDesk();

    const output = await virtualMonitors(desk).add({
      height: 1440,
      width: 2560,
    });

    expect(output).toStrictEqual(Ok("virtual-1"));
    expect(desk.added).toStrictEqual([
      {
        height: 1440,
        name: "Virtual monitor",
        refreshMhz: 60_000,
        width: 2560,
      },
    ]);
  });

  it("removes the newest it added, then the one before", async () => {
    const desk = fakeDesk();
    const monitors = virtualMonitors(desk);
    await monitors.add({ height: 1080, width: 1920 });
    await monitors.add({ height: 1080, width: 1920 });

    await monitors.remove();
    await monitors.remove();

    expect(desk.removed).toStrictEqual(["virtual-2", "virtual-1"]);
  });

  it("forgets a monitor that went by itself", async () => {
    const desk = fakeDesk();
    const monitors = virtualMonitors(desk);
    await monitors.add({ height: 1080, width: 1920 });
    await monitors.add({ height: 1080, width: 1920 });

    desk.ends.get("virtual-2")?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await monitors.remove();

    expect(desk.removed).toStrictEqual(["virtual-1"]);
  });

  it("removes nothing when it added none", async () => {
    const desk = fakeDesk();

    expect(await virtualMonitors(desk).remove()).toStrictEqual(
      Err("no virtual monitor to remove"),
    );
  });
});
