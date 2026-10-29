import { describe, expect, it } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type {
  DbusBody,
  DbusCall,
  SystemError,
} from "@domicile-desktop/sdk/system";
import { Bus, SystemErrorKind } from "@domicile-desktop/sdk/system";

import { inboxAddress } from "./addresses";
import type { Mail } from "./gmail-api";
import { heldBus } from "./held-bus";
import { EMAIL } from "./held-google";
import { mailNotices } from "./mail-notices";

const ACCOUNT = { email: EMAIL, nickname: "Work" };

const mail = (n: number): Mail => ({
  from: `Sender ${n.toString()}`,
  id: `m${n.toString()}`,
  subject: `Subject ${n.toString()}`,
  threadId: `t${n.toString()}`,
});

const arrived = (mail: readonly Mail[]) => ({ arrived: mail, read: [] });

const read = (...ids: readonly string[]) => ({ arrived: [], read: ids });

const closes = (calls: readonly DbusCall[]) =>
  calls
    .filter(({ member }) => member === "CloseNotification")
    .map(({ body }) => body);

/** The server's answer to `Notify`: the notification's id. */
const notified = (id: number) =>
  Ok<DbusBody, SystemError>({ body: [id], signature: "u" });

/** The server's answer to `CloseNotification`. */
const CLOSED = Ok<DbusBody, SystemError>({ body: [], signature: "" });

const pressed = (id: number) => ({
  body: [id, "default"],
  interface: "org.freedesktop.Notifications",
  member: "ActionInvoked",
  path: "/org/freedesktop/Notifications",
  sender: ":1.2",
  signature: "us",
});

/** A desk whose bus answers `replies`; `opened` settles on its first open. */
const desk = (...replies: Parameters<typeof heldBus>[0]) => {
  const bus = heldBus(replies);
  const opened = Promise.withResolvers<string>();
  return {
    bus,
    desk: {
      browser: {
        open: (url: string) => {
          opened.resolve(url);
        },
      },
      dbus: bus.dbus,
    },
    opened: opened.promise,
  };
};

describe("mailNotices", () => {
  it("notifies of a message: the account, its sender and its subject", async () => {
    const { bus, desk: held } = desk(notified(7));

    await mailNotices(held)(ACCOUNT, arrived([mail(1)]));

    expect(bus.calls).toStrictEqual([
      {
        body: [
          "Work",
          0,
          "mail-unread",
          "Sender 1",
          "Subject 1",
          ["default", "Open"],
          { "image-path": { signature: "s", value: "gmail" } },
          -1,
        ],
        bus: Bus.Session,
        destination: "org.freedesktop.Notifications",
        interface: "org.freedesktop.Notifications",
        member: "Notify",
        path: "/org/freedesktop/Notifications",
        signature: "susssasa{sv}i",
      },
    ]);
  });

  it("notifies of several messages oldest first, so the newest shows on top", async () => {
    const { bus, desk: held } = desk(notified(7), notified(8));

    await mailNotices(held)(ACCOUNT, arrived([mail(2), mail(1)]));

    expect(bus.calls.map(({ body }) => body?.[3])).toStrictEqual([
      "Sender 1",
      "Sender 2",
    ]);
  });

  it("opens a pressed message in Gmail, and only for its own notifications", async () => {
    const { bus, desk: held, opened } = desk(notified(7));
    const notify = mailNotices(held);

    await notify(ACCOUNT, arrived([mail(1)]));
    await bus.send(pressed(6));
    await bus.send(pressed(7));

    expect(await opened).toBe(`${inboxAddress(EMAIL)}#inbox/t1`);
    await notify(ACCOUNT, read("m1"));
    expect(closes(bus.calls)).toStrictEqual([]);
  });

  it("closes a message's notification once it is read, and no other", async () => {
    const { bus, desk: held } = desk(notified(7), notified(8), CLOSED);
    const notify = mailNotices(held);

    await notify(ACCOUNT, arrived([mail(2), mail(1)]));
    await notify(ACCOUNT, read("m1", "m9"));

    expect(closes(bus.calls)).toStrictEqual([[7]]);
  });

  it("closes a notification for many messages once all are read", async () => {
    const { bus, desk: held } = desk(notified(7), CLOSED);
    const notify = mailNotices(held);

    await notify(ACCOUNT, arrived([mail(4), mail(3), mail(2), mail(1)]));
    await notify(ACCOUNT, read("m1", "m2", "m3"));
    expect(closes(bus.calls)).toStrictEqual([]);
    await notify(ACCOUNT, read("m4"));

    expect(closes(bus.calls)).toStrictEqual([[7]]);
  });

  it("notifies of many messages at once as one, which opens the inbox", async () => {
    const { bus, desk: held, opened } = desk(notified(7));

    await mailNotices(held)(
      ACCOUNT,
      arrived([mail(4), mail(3), mail(2), mail(1)]),
    );
    await bus.send(pressed(7));

    expect(bus.calls.map(({ body }) => body?.slice(3, 5))).toStrictEqual([
      ["4 new emails", "Sender 4, Sender 3, Sender 2, and 1 more"],
    ]);
    expect(await opened).toBe(inboxAddress(EMAIL));
  });

  it("names each sender once", async () => {
    const { bus, desk: held } = desk(notified(7));

    await mailNotices(held)(
      ACCOUNT,
      arrived([mail(1), mail(1), mail(2), mail(1)]),
    );

    expect(bus.calls[0]?.body?.[4]).toBe("Sender 1 and Sender 2");
  });

  it("forgets its notifications once the compositor restarts", async () => {
    const { bus, desk: held, opened } = desk(notified(7), notified(8));
    const notify = mailNotices(held);

    await notify(ACCOUNT, arrived([mail(1)]));
    await bus.miss();
    await bus.send(pressed(7));
    await notify(ACCOUNT, arrived([mail(2)]));
    await bus.send(pressed(8));

    expect(await opened).toBe(`${inboxAddress(EMAIL)}#inbox/t2`);
  });

  it("fails when the notification server refuses", async () => {
    const { desk: held } = desk(
      Err<DbusBody, SystemError>({
        kind: SystemErrorKind.Dbus,
        message: "org.freedesktop.DBus.Error.ServiceUnknown",
      }),
    );

    await expect(
      mailNotices(held)(ACCOUNT, arrived([mail(1)])),
    ).rejects.toThrow("ServiceUnknown");
  });
});
