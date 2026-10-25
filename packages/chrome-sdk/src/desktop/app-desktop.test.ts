import { describe, expect, it } from "bun:test";
import type { DomicileAppHost } from "../domicile-host";
import { Bus } from "../system";
import { appDesktop } from "./app-desktop";

describe("appDesktop", () => {
  it("makes files, processes and D-Bus calls through the app's host", async () => {
    const sent: unknown[] = [];
    const host: DomicileAppHost = {
      addEventListener: () => undefined,
      callSystem: (_, request) => {
        sent.push(JSON.parse(request).call);
      },
      removeEventListener: () => undefined,
    };
    const { dbus, files, processes } = appDesktop(host);
    const never = () => {
      /* never answered */
    };
    files.readText("notes.txt").catch(never);
    processes.run(["true"]).catch(never);
    dbus.match({ bus: Bus.Session }).catch(never);
    await Promise.resolve();

    expect(sent).toStrictEqual(["read_file", "spawn", "dbus_match"]);
  });
});
