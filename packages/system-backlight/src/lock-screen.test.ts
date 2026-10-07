import { describe, expect, it } from "bun:test";
import { system } from "@domicile-desktop/sdk/system";
import {
  lockScreenReadouts,
  recordingHost,
} from "@domicile-desktop/test-support/lock-screen-readouts";

import { fakeSysfs, THINKPAD } from "./fake-system";
import { brightnessSetter } from "./set-brightness";
import { watchBrightness } from "./watch-brightness";

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

    expect(sent).toEqual(lockScreenReadouts("system-backlight"));
  });
});
