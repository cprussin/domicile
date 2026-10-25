import { describe, expect, it } from "bun:test";
import { Ok } from "@cprussin/option-result";
import type { DbusCall } from "@domicile-desktop/sdk/system";
import { system } from "@domicile-desktop/sdk/system";
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
    const recorded = system(host);
    const sysfs = fakeSysfs(THINKPAD).host;

    await watchBrightness(
      { ...sysfs, spawn: recorded.spawn },
      () => undefined,
      () => () => undefined,
    );
    await brightnessSetter({ ...sysfs, dbusCall: recorded.dbusCall })(0.5);
    // Recorded as sent, answered as a machine with a sensor answers.
    await watchAmbientLight({
      dbusCall: (call: DbusCall) => {
        recorded.dbusCall(call).catch(() => undefined);
        return Promise.resolve(Ok({ body: [SENSORS], signature: "a{sv}" }));
      },
      dbusMatch: recorded.dbusMatch,
    });

    expect(sent).toEqual(lockScreenReadouts("system-backlight"));
  });
});
