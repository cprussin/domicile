import { describe, expect, it } from "bun:test";
import { system } from "@domicile-desktop/sdk/system";
import {
  lockScreenReadouts,
  recordingHost,
} from "@domicile-desktop/test-support/lock-screen-readouts";

import { watchBattery } from "./battery";

describe("on a lock screen", () => {
  it("sends only the recorded readouts", async () => {
    const { host, sent } = recordingHost();

    await watchBattery(system(host));

    expect(sent).toEqual(lockScreenReadouts("system-battery"));
  });
});
