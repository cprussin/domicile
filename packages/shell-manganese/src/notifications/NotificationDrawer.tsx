import type { Notification } from "@domicile/chrome-sdk/notification";
import { Button } from "@domicile/component-library/Button";
import { SlideOver } from "@domicile/component-library/SlideOver";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";

import { css } from "../../styled-system/css";
import { center, flex, vstack } from "../../styled-system/patterns";
import { NotificationCard } from "./NotificationCard";

type Props = {
  /** Every notification nobody has cleared, in the order to list them. */
  items: readonly Notification[];
  /** The time now, for how long ago each arrived. */
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Clear `ids`. */
  onDismiss: (ids: readonly number[]) => void;
  /** Press `key` on `id`. */
  onAction: (id: number, key: string) => void;
};

/**
 * Every recent notification, in a drawer that slides out from the edge the
 * bell is on: each one to press or clear, and all of them to clear at once.
 *
 * A notification stays here after its toast has gone, until it is cleared or
 * its application takes it back, so this is where something missed is found
 * again.
 */
export const NotificationDrawer = ({
  items,
  now,
  onAction,
  onDismiss,
  onOpenChange,
  open,
}: Props) => (
  <SlideOver
    footer={
      items.length === 0 ? undefined : (
        <div className={footerStyles}>
          <span className={countStyles}>
            {items.length === 1
              ? "1 notification"
              : `${items.length} notifications`}
          </span>
          <Button
            beforeIcon={<BroomIcon />}
            onClick={() => {
              onDismiss(items.map(({ id }) => id));
            }}
            size="sm"
            variant="ghost"
          >
            Clear all
          </Button>
        </div>
      )
    }
    onOpenChange={onOpenChange}
    open={open}
    title="Notifications"
  >
    {items.length === 0 ? (
      <div className={emptyStyles}>
        <span aria-hidden className={glowStyles}>
          <BellSimpleIcon size={28} weight="duotone" />
        </span>
        <span className={emptyTitleStyles}>You're all caught up</span>
        <span className={emptyBodyStyles}>
          What your applications and sites have to say will be here.
        </span>
      </div>
    ) : (
      <ul className={listStyles}>
        {items.map((notification) => (
          <li className={rowStyles} key={notification.id}>
            <NotificationCard
              closeLabel="Clear"
              notification={notification}
              now={now}
              onAction={(key) => {
                onAction(notification.id, key);
              }}
              onClose={() => {
                onDismiss([notification.id]);
              }}
            />
          </li>
        ))}
      </ul>
    )}
  </SlideOver>
);

const listStyles = flex({
  direction: "column",
  gap: 2,
  listStyle: "none",
  margin: 0,
  paddingBlock: 1,
  paddingInline: 0,
});

// Each one on a surface of its own, a shade off the panel's, which is lifted
// on hover — and slides in from the edge when it arrives while the drawer is
// open, which is the toast's own entrance, smaller.
const rowStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 7%, transparent)",
    borderColor: "color-mix(in oklab, {colors.foreground} 16%, transparent)",
  },
  _starting: {
    opacity: 0,
    transform: "translateX({spacing.4})",
  },
  // A critical one is ringed in the danger color, as its toast was.
  "&:has([data-urgency=critical])": {
    borderColor: "color-mix(in oklab, {colors.danger} 55%, transparent)",
  },
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  border: "1px solid color-mix(in oklab, {colors.foreground} 9%, transparent)",
  borderRadius: "xl",
  opacity: 1,
  overflow: "hidden",
  transform: "translateX(0)",
  transition:
    "background-color {durations.fast} {easings.default}, border-color {durations.fast} {easings.default}, opacity {durations.slow} {easings.outQuart}, transform {durations.slow} {easings.outQuart}",
});

const footerStyles = flex({
  align: "center",
  flex: 1,
  justify: "space-between",
});

const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});

const emptyStyles = vstack({
  flex: 1,
  gap: 2,
  justify: "center",
  paddingBlock: 16,
  textAlign: "center",
});

// The bell, quiet, in a pool of the accent: the drawer is not broken, it is
// empty, and that is the good case.
const glowStyles = center({
  backgroundImage:
    "radial-gradient(circle, color-mix(in oklab, {colors.accent} 28%, transparent), transparent 70%)",
  blockSize: 20,
  color: "accent",
  inlineSize: 20,
  marginBlockEnd: 1,
});

const emptyTitleStyles = css({
  color: "foreground",
  fontSize: "md",
  fontWeight: "semibold",
});

const emptyBodyStyles = css({
  color: "muted",
  fontSize: "sm",
  maxInlineSize: 64,
});
