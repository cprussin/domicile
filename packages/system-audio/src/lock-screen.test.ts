import { describe, expect, it } from "bun:test";
import { system } from "@domicile-desktop/sdk/system";
import {
  lockScreenReadouts,
  recordingHost,
} from "@domicile-desktop/test-support/lock-screen-readouts";

import { soundServer } from "./sound-server";

describe("on a lock screen", () => {
  it("sends only the recorded readouts", async () => {
    const { host, sent } = recordingHost();
    const failed = Promise.withResolvers<void>();
    const sound = soundServer(
      system(host),
      { reopenMs: 60_000, settleMs: 0, tickMs: 0 },
      () => {
        failed.resolve();
      },
    );

    const stop = sound.watch(() => undefined);
    await failed.promise;
    stop();
    await sound.setVolume("output:alsa_output.pci", 1);
    await sound.setMuted("output:alsa_output.pci", true);

    expect(sent).toEqual(lockScreenReadouts("system-audio"));
  });
});
