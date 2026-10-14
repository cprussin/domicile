import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { css } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";
import { inboxAddress, signInAddress } from "./addresses";
import type { Inbox } from "./inbox";
import { InboxKind } from "./inbox";

type Props = {
  /** The Google account. */
  email: string;
  /** The account's name on the bar. */
  nickname: string;
  /** The account's inbox, read with the browser's sign-in. */
  inbox: SharedWatch<Inbox>;
  /** Opens an address in a browser window. */
  onOpen: (url: string) => void;
};

/**
 * One Gmail account on the bar: its conversation count, lit while any
 * is unread. A click opens the inbox. While the browser is not signed in to
 * the account, a button opens Google's sign-in instead.
 *
 * Draws nothing until the first reading, and nothing for an empty inbox.
 */
export const Gmail = ({ email, inbox, nickname, onOpen }: Props) => {
  const reading = useSharedWatch(inbox);
  return reading === undefined ? undefined : (
    <Reading
      email={email}
      inbox={reading}
      nickname={nickname}
      onOpen={onOpen}
    />
  );
};

type ReadingProps = Omit<Props, "inbox"> & { inbox: Inbox };

const Reading = ({ email, inbox, nickname, onOpen }: ReadingProps) => {
  switch (inbox.kind) {
    case InboxKind.SignedOut:
      return (
        <button
          className={itemStyles}
          onClick={() => {
            onOpen(signInAddress(email));
          }}
          type="button"
        >
          <EnvelopeSimpleIcon aria-hidden size={15} weight="bold" />
          <span className={textStyles}>Sign in to {email}</span>
        </button>
      );
    case InboxKind.Counted:
      return inbox.total === 0 ? undefined : (
        <Count
          email={email}
          figure={
            inbox.unread === 0
              ? inbox.total.toString()
              : `${inbox.unread.toString()} / ${inbox.total.toString()}`
          }
          label={
            inbox.unread === 0
              ? `${nickname}: ${inbox.total.toString()} conversations`
              : `${nickname}: ${inbox.unread.toString()} unread of ${inbox.total.toString()} conversations`
          }
          nickname={nickname}
          onOpen={onOpen}
          unread={inbox.unread > 0}
        />
      );
  }
};

type CountProps = Omit<Props, "inbox"> & {
  /** The count as the bar shows it. */
  figure: string;
  /** The count in words, for the button's name and tooltip. */
  label: string;
  unread: boolean;
};

/** The count, as a button that opens the inbox. */
const Count = ({
  email,
  figure,
  label,
  nickname,
  onOpen,
  unread,
}: CountProps) => (
  <button
    aria-label={label}
    className={itemStyles}
    data-unread={unread}
    onClick={() => {
      onOpen(inboxAddress(email));
    }}
    title={label}
    type="button"
  >
    <EnvelopeSimpleIcon aria-hidden size={15} weight="bold" />
    <span className={textStyles}>{nickname}</span>
    <span className={figureStyles} data-figure="">
      {figure}
    </span>
  </button>
);

// Matches the network item's button. Unread mail lights the item as the idle
// inhibitor lights when on, and sets the count in semibold.
const itemStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  "&[data-unread=true]": {
    backgroundColor: "color-mix(in oklab, white 24%, transparent)",
  },
  "&[data-unread=true] [data-figure]": { fontWeight: "semibold" },
  backgroundColor: "transparent",
  blockSize: 7,
  borderRadius: "full",
  borderStyle: "none",
  color: "inherit",
  cursor: "pointer",
  flexShrink: 0,
  font: "inherit",
  gap: 1,
  justifyContent: "center",
  paddingBlock: 0,
  paddingInline: 1.5,
  transition: "background-color {durations.fast} {easings.default}",
});

// 10px to match the bar's other figures; no font-size token fits.
const textStyles = css({ fontSize: "0.625rem", whiteSpace: "nowrap" });

// Fixed-width digits, so the bar does not shift as the count changes.
const figureStyles = css({
  fontSize: "0.625rem",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});
