import { describe, expect, it } from "bun:test";

import { mediaDeviceChoiceFor, mediaDevicesOf } from "./media-devices";

const DEVICES = {
  cameras: [{ id: "/dev/video2", name: "USB Camera" }],
  microphones: [],
};

describe("mediaDevicesOf", () => {
  it("reads the engine's devices", () => {
    expect(mediaDevicesOf(DEVICES)).toStrictEqual(DEVICES);
  });

  it("throws for anything else", () => {
    expect(() => mediaDevicesOf({ cameras: [{ id: 2 }] })).toThrow();
  });
});

describe("mediaDeviceChoiceFor", () => {
  it("is nothing from an engine without media devices", () => {
    expect(
      mediaDeviceChoiceFor(
        document.createElement("div") as unknown as HTMLWebViewElement,
      ),
    ).toBeUndefined();
  });

  it("lists the view's devices and prefers one through it", async () => {
    const preferred: string[] = [];
    const view = Object.assign(document.createElement("div"), {
      mediaDevices: () => Promise.resolve(DEVICES),
      setMediaDevice: (kind: string, id: string) => {
        preferred.push(`${kind} ${id}`);
        return Promise.resolve();
      },
    }) as unknown as HTMLWebViewElement;
    const choice = mediaDeviceChoiceFor(view);

    expect(await choice?.list()).toStrictEqual(DEVICES);
    await choice?.prefer("camera", "/dev/video2");
    expect(preferred).toStrictEqual(["camera /dev/video2"]);
  });
});
