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
 * outside is left out until its first reading.
 */
export const InboxList = ({ inboxes, onOpen, readings }: Props) => (
  <>
    {inboxes.map((inbox, index) => {
      const reading = readings[index];
      if (inbox.kind === InboxKind.Watched && reading === undefined) {
        return undefined;
      } else {
        const Icon = inbox.icon;
        return (
          <InboxRow
            icon={<Icon size={15} weight="bold" />}
            key={index}
            name={inbox.name}
            onOpen={() => {
              onOpen(index);
            }}
            {...shownAs(inbox.name, reading)}
          />
        );
      }
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
      return {
        figure: reading.total === 0 ? "Empty" : reading.total.toString(),
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

/** The counts in words, for the row's name. */
const countLabel = (name: string, total: number, unread: number) => {
  if (total === 0) {
    return `${name}: empty`;
  } else if (unread === 0) {
    return `${name}: ${total.toString()} conversations`;
  } else {
    return `${name}: ${unread.toString()} unread of ${total.toString()} conversations`;
  }
};
