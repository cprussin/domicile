import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "@domicile-desktop/sdk/fake-host";

import { answerSystemCalls, THINKPAD_BACKLIGHT } from "./fixture";
import { hostBacklight } from "./host-backlight";

/** The system calls the shell made, as the compositor reads them. */
const requests = (fake: FakeDomicileHost): unknown[] =>
  fake.calls
    .filter(([method]) => method === "callSystem")
    .map(([, , request]) => JSON.parse(String(request)));

describe("hostBacklight", () => {
  it("watches the backlight through udevadm and /sys", async () => {
    const fake = new FakeDomicileHost();

    const level = new Promise((resolve) => {
      hostBacklight(fake.host).watch(resolve);
    });
    await answerSystemCalls(fake, THINKPAD_BACKLIGHT);

    expect(await level).toBe(0.6);
    expect(requests(fake)).toContainEqual(
      expect.objectContaining({
        argv: ["udevadm", "monitor", "--kernel", "--subsystem-match=backlight"],
        call: "spawn",
      }),
    );
  });

  it("stops udevadm when the watch stops", async () => {
    const fake = new FakeDomicileHost();
    const stop = hostBacklight(fake.host).watch(() => undefined);
    await answerSystemCalls(fake, THINKPAD_BACKLIGHT);

    stop();
    await answerSystemCalls(fake, THINKPAD_BACKLIGHT);

    expect(requests(fake)).toContainEqual({ call: "kill", signal: "term" });
  });

  it("sets the level through logind", async () => {
    const fake = new FakeDomicileHost();

    hostBacklight(fake.host).set(0.5);
    await answerSystemCalls(fake, THINKPAD_BACKLIGHT);

    expect(requests(fake)).toContainEqual(
      expect.objectContaining({
        body: JSON.stringify(["backlight", "acpi_video0", 8]),
        call: "dbus_call",
        member: "SetBrightness",
      }),
    );
  });
});
