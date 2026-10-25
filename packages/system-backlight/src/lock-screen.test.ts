import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";
import { appDesktop } from "@domicile-desktop/sdk/desktop/app-desktop";
import type { DbusCall } from "@domicile-desktop/sdk/system";
import {
  lockScreenReadouts,
  recordingHost,
} from "@domicile-desktop/test-support/lock-screen-readouts";
import { fakeSysfs, THINKPAD } from "./fake-system";
import { brightnessSetter } from "./set-brightness";
import { watchAmbientLight } from "./watch-ambient-light";
import { watchBrightness } from "./watch-brightness";

/** iio-sensor-proxy's properties on a machine with a light sensor. */
const SENSORS = {
  HasAmbientLight: { signature: "b", value: true },
  LightLevel: { signature: "d", value: 120 },
};

describe("on a lock screen", () => {
  it("sends only the recorded readouts", async () => {
    const { host, sent } = recordingHost();
    const recorded = appDesktop(host);
    const sysfs = fakeSysfs(THINKPAD).host;

    await watchBrightness(
      { ...sysfs, processes: recorded.processes },
      () => undefined,
      () => () => undefined,
    );
    await brightnessSetter({ ...sysfs, dbus: recorded.dbus })(0.5);
    // Recorded as sent, answered as a machine with a sensor answers.
    await watchAmbientLight({
      dbus: {
        call: (call: DbusCall) => {
          recorded.dbus.call(call).catch(() => undefined);
          return Promise.resolve(Ok({ body: [SENSORS], signature: "a{sv}" }));
        },
        match: recorded.dbus.match,
      },
    });

    expect(sent).toEqual(lockScreenReadouts("system-backlight"));
  });
});
