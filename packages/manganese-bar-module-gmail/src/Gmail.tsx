import { CountBadge } from "@domicile-desktop/component-library/CountBadge";
import { Tooltip } from "@domicile-desktop/component-library/Tooltip";
import type { SharedWatch } from "@domicile-desktop/manganese-host/shared-watch";
import { useSharedWatch } from "@domicile-desktop/manganese-host/useSharedWatch";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr/EnvelopeSimple";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { css } from "../styled-system/css";
import { hstack } from "../styled-system/patterns";
import { inboxAddress } from "./addresses";
import type { Inbox } from "./inbox";
import { InboxKind } from "./inbox";

type Props = {
  /** The Google account. */
  email: string;
  /** The account's name on the bar. */
  nickname: string;
  /** The account's inbox. */
  inbox: SharedWatch<Inbox>;
  /** Opens an address in a browser window. */
  onOpen: (url: string) => void;
  /** Signs the account in. */
  onSignIn: () => void;
};

/**
 * One Gmail account on the bar: its conversation count, lit while any
 * is unread. A click opens the inbox. Before the account signs in, a button
 * signs it in instead.
 *
 * Draws nothing until the first reading, and nothing for an empty inbox. A
 * failed read draws a warning, with why in its tooltip.
 */
export const Gmail = ({ email, inbox, nickname, onOpen, onSignIn }: Props) => {
  const reading = useSharedWatch(inbox);
  return reading === undefined ? undefined : (
    <Reading
      email={email}
      inbox={reading}
      nickname={nickname}
      onOpen={onOpen}
      onSignIn={onSignIn}
    />
  );
};

type ReadingProps = Omit<Props, "inbox"> & { inbox: Inbox };

const Reading = ({
  email,
  inbox,
  nickname,
  onOpen,
  onSignIn,
}: ReadingProps) => {
  switch (inbox.kind) {
    case InboxKind.SignedOut:
      return (
        <button className={itemStyles} onClick={onSignIn} type="button">
          <EnvelopeSimpleIcon aria-hidden size={15} weight="bold" />
          <span className={textStyles}>Sign in to {email}</span>
        </button>
      );
    case InboxKind.Counted:
      return inbox.total === 0 ? undefined : (
        <Count
          email={email}
          label={
            inbox.unread === 0
              ? `${nickname}: ${inbox.total.toString()} conversations`
              : `${nickname}: ${inbox.unread.toString()} unread of ${inbox.total.toString()} conversations`
          }
          nickname={nickname}
          onOpen={onOpen}
          total={inbox.total}
          unread={inbox.unread}
        />
      );
    case InboxKind.Failed:
      return (
        <Tooltip
          content={`${nickname}: could not read the inbox: ${inbox.reason}`}
          tone="overPhoto"
          trigger={
            <button
              aria-label={`${nickname}: could not read the inbox`}
              className={itemStyles}
              onClick={() => {
                onOpen(inboxAddress(email));
              }}
              type="button"
            >
              <EnvelopeSimpleIcon aria-hidden size={15} weight="bold" />
              <span className={textStyles}>{nickname}</span>
              <WarningCircleIcon aria-hidden size={15} weight="bold" />
            </button>
          }
        />
      );
  }
};

type CountProps = Omit<Props, "inbox" | "onSignIn"> & {
  /** The count in words, for the button's name and tooltip. */
  label: string;
  /** How many conversations are in the inbox. */
  total: number;
  /** How many of them are unread. */
  unread: number;
};

/**
 * The total, as a button that opens the inbox. The unread count sits in a
 * badge on its end corner, as on the Messages and notification buttons.
 */
const Count = ({
  email,
  label,
  nickname,
  onOpen,
  total,
  unread,
}: CountProps) => (
  <Tooltip
    content={label}
    tone="overPhoto"
    trigger={
      <button
        aria-label={label}
        className={itemStyles}
        data-unread={unread > 0}
        onClick={() => {
          onOpen(inboxAddress(email));
        }}
        type="button"
      >
        <EnvelopeSimpleIcon aria-hidden size={15} weight="bold" />
        <span className={textStyles}>{nickname}</span>
        <span className={figureStyles} data-figure="">
          {total}
        </span>
        <CountBadge count={unread} />
      </button>
    }
  />
);

// Matches the network item's button. Unread mail lights the item as the idle
// inhibitor lights when on, and sets the count in semibold.
const itemStyles = hstack({
  _hover: {
    backgroundColor: "color-mix(in oklab, white 16%, transparent)",
  },
  "&[data-unread=true]": {
    backgroundColor: "color-mix(in oklab, white 24%, transparent)",
    // Clears the total from the badge on the end corner.
    paddingInlineEnd: 5,
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
  // The ends' radius, so the text stays clear of the curve.
  paddingInline: 3,
  // Anchors the unread badge.
  position: "relative",
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
