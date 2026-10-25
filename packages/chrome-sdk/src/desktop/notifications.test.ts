import { describe, expect, it } from "bun:test";
import { FakeDomicileHost } from "../fake-host";
import { desktop } from "./desktop";

const sent = {
  actions: [{ key: "default", label: "Open" }],
  appName: "Mail",
  body: "Lunch?",
  clickable: true,
  icon: "data:image/png;base64,AA==",
  id: 7,
  summary: "Ann",
  time: 1_700_000_000_000,
  timeoutMs: 5000,
  urgency: "normal" as const,
};

describe("notifications", () => {
  it("lists nothing until the compositor says", () => {
    expect(
      desktop(new FakeDomicileHost().host).notifications.list,
    ).toBeUndefined();
  });

  it("lists each notification, with undefined for no icon or no timeout", () => {
    const fake = new FakeDomicileHost();
    fake.set({ notifications: [sent, { ...sent, icon: "", timeoutMs: -1 }] });

    expect(desktop(fake.host).notifications.list).toStrictEqual([
      sent,
      { ...sent, icon: undefined, timeoutMs: undefined },
    ]);
  });

  it("throws on an urgency it does not know", () => {
    const fake = new FakeDomicileHost();
    fake.set({ notifications: [{ ...sent, urgency: "loud" }] });

    expect(() => desktop(fake.host).notifications.list).toThrow();
  });

  it("dismisses, presses and replies", () => {
    const fake = new FakeDomicileHost();
    const { notifications } = desktop(fake.host);
    notifications.dismiss([7]);
    notifications.invoke(7, "default");
    notifications.reply(7, "Sure");

    expect(fake.calls).toStrictEqual([
      ["dismissNotifications", [7]],
      ["invokeNotificationAction", 7, "default"],
      ["replyToNotification", 7, "Sure"],
    ]);
  });

  it("says the notifications changed", async () => {
    const fake = new FakeDomicileHost();
    const changed = new Promise((resolve) => {
      desktop(fake.host).notifications.on("change", () => {
        resolve(undefined);
      });
    });
    fake.set({ notifications: [] });

    expect(await changed).toBeUndefined();
  });
});
