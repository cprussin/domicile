// New mail as desktop notifications, sent to the notification server the
// compositor runs. See docs/architecture/NOTIFICATIONS.md.

import type { Browser } from "@domicile-desktop/sdk/desktop/browser";
import type { Dbus } from "@domicile-desktop/sdk/desktop/dbus";
import type {
  DbusSignal,
  Listened,
  Listening,
} from "@domicile-desktop/sdk/system";
import { Bus, ListenedKind } from "@domicile-desktop/sdk/system";
import { z } from "zod";

import { inboxAddress } from "./addresses";
import type { Mail } from "./gmail-api";

/** The notification server's address on the session bus. */
const SERVER = {
  bus: Bus.Session,
  destination: "org.freedesktop.Notifications",
  interface: "org.freedesktop.Notifications",
  path: "/org/freedesktop/Notifications",
};

/** The most messages notified one by one. More become one notification. */
const MOST_APART = 3;

/** The most senders a notification for many messages names. */
const MOST_NAMED = 3;

/** What notifies: the bus, and the browser a press opens Gmail in. */
export type NoticeDesk = {
  readonly dbus: Pick<Dbus, "call" | "match">;
  readonly browser: Pick<Browser, "open">;
};

/** The account mail arrived for. */
export type MailAccount = { email: string; nickname: string };

/**
 * Notifies the desk of new `mail`, newest first, under the account's
 * nickname: a notification per message, or one for all of them when more than
 * {@link MOST_APART} arrive at once. A press opens the message, or the inbox,
 * in a browser window. Rejects when the server refuses.
 */
export const mailNotices = (desk: NoticeDesk) => {
  // Each notification sent, and the address a press opens.
  const opens = new Map<number, string>();
  const presses: { listening: Promise<void> | undefined } = {
    listening: undefined,
  };
  return async (account: MailAccount, mail: readonly Mail[]): Promise<void> => {
    presses.listening ??= listen(desk, opens);
    await presses.listening;
    for (const notice of notices(account.email, mail)) {
      const id = await notify(desk, account.nickname, notice);
      opens.set(id, notice.opens);
    }
  };
};

type Notice = { summary: string; body: string; opens: string };

/** `mail`'s notifications, oldest first, so the newest shows on top. */
const notices = (email: string, mail: readonly Mail[]): Notice[] =>
  mail.length > MOST_APART
    ? [
        {
          body: senders(mail),
          opens: inboxAddress(email),
          summary: `${mail.length.toString()} new emails`,
        },
      ]
    : mail.toReversed().map(({ from, subject, threadId }) => ({
        body: subject,
        opens: `${inboxAddress(email)}#inbox/${threadId}`,
        summary: from,
      }));

/** Who sent `mail`, each once, newest first. */
const senders = (mail: readonly Mail[]): string => {
  const names = [...new Set(mail.map(({ from }) => from))];
  const more = names.length - MOST_NAMED;
  return new Intl.ListFormat("en-US").format(
    more > 0
      ? [...names.slice(0, MOST_NAMED), `${more.toString()} more`]
      : names,
  );
};

/** Sends `notice`, and resolves its id. */
const notify = async (
  desk: NoticeDesk,
  nickname: string,
  { body, summary }: Notice,
): Promise<number> =>
  (
    await desk.dbus.call({
      ...SERVER,
      body: [
        nickname,
        0,
        // The theme's mail icon, unless it has Gmail's own.
        "mail-unread",
        summary,
        body,
        ["default", "Open"],
        { "image-path": { signature: "s", value: "gmail" } },
        -1,
      ],
      member: "Notify",
      signature: "susssasa{sv}i",
    })
  ).match({
    Err: (error) => {
      throw new Error(`could not notify of new mail: ${error.message}`);
    },
    Ok: ({ body: reply }) => notifiedSchema.parse(reply)[0],
  });

const notifiedSchema = z.tuple([z.number().int()]);

/**
 * Opens each press of one of `opens` from now on. Resolves once listening, or
 * rejects when the bus refuses.
 */
const listen = async (
  desk: NoticeDesk,
  opens: Map<number, string>,
): Promise<void> =>
  (
    await desk.dbus.match({
      bus: SERVER.bus,
      interface: SERVER.interface,
      member: "ActionInvoked",
      path: SERVER.path,
    })
  ).match({
    Err: (error) => {
      throw new Error(`could not hear presses of mail: ${error.message}`);
    },
    Ok: (listening) => {
      follow(desk, opens, listening).catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: a broken listener leaves presses unanswered, with nothing else to tell
        console.error("Stopped hearing presses of mail", error);
      });
    },
  });

const follow = async (
  desk: NoticeDesk,
  opens: Map<number, string>,
  listening: Listening<Listened<DbusSignal>>,
): Promise<void> => {
  const reader = listening.items.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    switch (next.value.kind) {
      case ListenedKind.Heard: {
        // Ours offer only the default action: a press on the notification.
        const [id] = invokedSchema.parse(next.value.item.body);
        const address = opens.get(id);
        if (address !== undefined) {
          opens.delete(id);
          desk.browser.open(address);
        }
        break;
      }
      case ListenedKind.Missed: {
        // A new compositor numbers its notifications from scratch.
        opens.clear();
        break;
      }
    }
  }
};

const invokedSchema = z.tuple([z.number().int(), z.string()]);
