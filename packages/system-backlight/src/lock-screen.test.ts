import { describe, expect, it } from "bun:test";
import { appDesktop } from "@domicile-desktop/sdk/desktop/app-desktop";
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
    const recorded = appDesktop(host);
    const sysfs = fakeSysfs(THINKPAD).host;

    await watchBrightness(
      { ...sysfs, processes: recorded.processes },
      () => undefined,
      () => () => undefined,
    );
    await brightnessSetter({ ...sysfs, dbus: recorded.dbus })(0.5);

    expect(sent).toEqual(lockScreenReadouts("system-backlight"));
  });
});
