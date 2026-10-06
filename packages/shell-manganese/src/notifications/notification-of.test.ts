import { describe, expect, it } from "bun:test";
import type { DomicileNotification } from "@domicile-desktop/sdk/domicile-host";

import { notification } from "./fixture";
import { notificationOf } from "./notification-of";

/** A notification as the engine holds one: the fixture's, in its spellings. */
const ENGINE: DomicileNotification = {
  actions: [{ key: "reply", label: "Reply" }],
  appName: "Firefox",
  body: "",
  clickable: false,
  icon: "",
  id: 1,
  summary: "New message",
  time: 0,
  timeoutMs: -1,
  urgency: "normal",
};

describe("notificationOf", () => {
  it("reads no picture and the shell's choice of timeout as nothing said", () => {
    expect(notificationOf(ENGINE)).toEqual(
      notification({ actions: [{ key: "reply", label: "Reply" }] }),
    );
  });

  it("keeps a picture and a timeout the notification asked for", () => {
    expect(
      notificationOf({
        ...ENGINE,
        icon: "data:image/png;base64,",
        timeoutMs: 0,
      }),
    ).toMatchObject({ icon: "data:image/png;base64,", timeoutMs: 0 });
  });

  it("throws for an urgency it has no name for", () => {
    expect(() => notificationOf({ ...ENGINE, urgency: "panic" })).toThrow();
  });
});
