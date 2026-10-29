import { InboxRow } from "./InboxRow";
import type { Inbox, InboxReading } from "./inbox";
import { InboxKind, InboxReadingKind } from "./inbox";

type Props = {
  inboxes: readonly Inbox[];
  /** Each inbox's reading, by its place in `inboxes`. */
  readings: readonly (InboxReading | undefined)[];
  /** Opens the inbox at `index`, as its row was pressed. */
  onOpen: (index: number) => void;
};

/**
 * The drawer's list of inboxes: each one's name and counts. An inbox read from
 * outside shows a spinner until its first reading; a page has no count until
 * it has unread conversations, so it shows none.
 */
export const InboxList = ({ inboxes, onOpen, readings }: Props) => (
  <>
    {inboxes.map((inbox, index) => {
      const reading = readings[index];
      const Icon = inbox.icon;
      return (
        <InboxRow
          icon={<Icon size={15} weight="bold" />}
          key={index}
          name={inbox.name}
          onOpen={() => {
            onOpen(index);
          }}
          {...(inbox.kind === InboxKind.Watched && reading === undefined
            ? { checking: true, label: `${inbox.name}: checking`, unread: 0 }
            : shownAs(inbox.name, reading))}
        />
      );
    })}
  </>
);

/** What a row shows for `reading`. */
const shownAs = (name: string, reading: InboxReading | undefined) => {
  switch (reading?.kind) {
    case undefined:
      return { label: name, unread: 0 };
    case InboxReadingKind.SignedOut:
      return { figure: "Sign in", label: `Sign in to ${name}`, unread: 0 };
    case InboxReadingKind.Counted:
      return reading.total === 0
        ? { detail: "Empty", label: `${name}: empty`, unread: 0 }
        : {
            detail: conversations(
              reading.total,
              reading.total.toLocaleString(),
            ),
            label: countLabel(name, reading.total, reading.unread),
            unread: reading.unread,
          };
    case InboxReadingKind.Unread:
      return {
        label:
          reading.unread === 0
            ? name
            : `${name}: ${reading.unread.toString()} unread`,
        unread: reading.unread,
      };
    case InboxReadingKind.Failed:
      return {
        figure: "Couldn't check",
        label: `${name}: could not read the inbox: ${reading.reason}`,
        unread: 0,
        warning: true,
      };
  }
};

/** The counts of a nonempty inbox in words, for the row's name. */
const countLabel = (name: string, total: number, unread: number) =>
  unread === 0
    ? `${name}: ${conversations(total)}`
    : `${name}: ${unread.toString()} unread of ${conversations(total)}`;

/** `total` conversations, with `total` written as `written`. */
const conversations = (total: number, written = total.toString()) =>
  total === 1 ? `${written} conversation` : `${written} conversations`;
