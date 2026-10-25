import { describe, expect, it } from "bun:test";
import { appDesktop } from "@domicile-desktop/sdk/desktop/app-desktop";
import {
  lockScreenReadouts,
  recordingHost,
} from "@domicile-desktop/test-support/lock-screen-readouts";

import { watchBluetooth } from "./bluetooth";

describe("on a lock screen", () => {
  it("sends only the recorded readouts", async () => {
    const { host, sent } = recordingHost();
    const read = Promise.withResolvers<void>();

    const stop = watchBluetooth(appDesktop(host), () => {
      read.resolve();
    });
    await read.promise;
    stop();

    expect(sent).toEqual(lockScreenReadouts("system-bluetooth"));
  });
});
