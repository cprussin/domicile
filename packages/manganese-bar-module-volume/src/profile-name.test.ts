import { describe, expect, it } from "bun:test";

import { profileName } from "./profile-name";

const named = (name: string, description = "Raw description") =>
  profileName({ available: true, description, name });

describe(profileName, () => {
  it("names a sound card mode by what it plays and records", () => {
    expect(named("output:analog-stereo+input:analog-stereo")).toBe(
      "Stereo sound and microphone",
    );
    expect(named("output:analog-stereo")).toBe("Stereo sound only");
    expect(named("input:analog-stereo")).toBe("Microphone only");
    expect(named("output:analog-surround-51")).toBe("5.1 surround sound only");
    expect(named("output:hdmi-stereo-extra1")).toBe("HDMI stereo sound only");
    expect(named("off")).toBe("Off");
  });

  it("names a Bluetooth headset's modes", () => {
    expect(named("a2dp-sink-aac")).toBe("High-quality sound");
    expect(named("headset-head-unit-msbc")).toBe("Headset with microphone");
  });

  it("keeps the sound server's name for a mode it doesn't know", () => {
    expect(named("output:iec958-stereo", "Digital Stereo (IEC958)")).toBe(
      "Digital Stereo (IEC958)",
    );
    expect(named("pro-audio", "Pro Audio")).toBe("Pro Audio");
  });
});
