import { afterEach, describe, expect, it } from "bun:test";

import { storedPause, storePause } from "./stored-pause";

describe("storedPause", () => {
  afterEach(() => {
    globalThis.localStorage.clear();
  });

  it("is none until notifications are paused", () => {
    expect(storedPause()).toBeUndefined();
  });

  it("reads back a pause with an end, or without one", () => {
    storePause({ until: 1000 });
    expect(storedPause()).toEqual({ until: 1000 });

    storePause({});
    expect(storedPause()).toEqual({});
  });

  it("clears the pause", () => {
    storePause({ until: 1000 });

    storePause(undefined);

    expect(storedPause()).toBeUndefined();
  });

  it("counts an unreadable value as none", () => {
    globalThis.localStorage.setItem("notifications-paused:v1", "not json");
    expect(storedPause()).toBeUndefined();

    globalThis.localStorage.setItem(
      "notifications-paused:v1",
      '{"until":"soon"}',
    );
    expect(storedPause()).toBeUndefined();
  });

  it("takes do not disturb left on as a pause until resumed, once", () => {
    globalThis.localStorage.setItem("do-not-disturb:v1", "on");
    expect(storedPause()).toEqual({});

    storePause(undefined);

    expect(storedPause()).toBeUndefined();
  });
});
