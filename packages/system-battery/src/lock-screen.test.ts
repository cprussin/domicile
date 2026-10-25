import { describe, expect, it } from "bun:test";
import { appDesktop } from "@domicile-desktop/sdk/desktop/app-desktop";
import {
  lockScreenReadouts,
  recordingHost,
} from "@domicile-desktop/test-support/lock-screen-readouts";

import { watchBattery } from "./battery";

describe("on a lock screen", () => {
  it("sends only the recorded readouts", async () => {
    const { host, sent } = recordingHost();

    await watchBattery(appDesktop(host));

    expect(sent).toEqual(lockScreenReadouts("system-battery"));
  });
});
