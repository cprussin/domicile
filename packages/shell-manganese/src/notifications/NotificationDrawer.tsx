import { Button } from "@domicile-desktop/component-library/Button";
import { SlideOver } from "@domicile-desktop/component-library/SlideOver";
import type { Notification } from "@domicile-desktop/sdk/notification";
import { BellSimpleIcon } from "@phosphor-icons/react/dist/ssr/BellSimple";
import { BroomIcon } from "@phosphor-icons/react/dist/ssr/Broom";

import { css } from "../../styled-system/css";
import { center, flex, vstack } from "../../styled-system/patterns";
import { NotificationCard } from "./NotificationCard";

type Props = {
  /** Every uncleared notification, in display order. */
  items: readonly Notification[];
  /** The current time, for the relative timestamps. */
  now: number;
  open: boolean;
  /** The screen it opens on: the one whose bell was pressed. */
  screen: string | undefined;
  onOpenChange: (open: boolean) => void;
  /** Clear `ids`. */
  onDismiss: (ids: readonly number[]) => void;
  /** Press `key` on `id`. */
  onAction: (id: number, key: string) => void;
};

/**
 * The notification drawer, sliding out from the bell's edge. Each notification
 * can be pressed or cleared, or all cleared at once.
 *
 * A notification stays here after its toast is gone, until it is cleared or its
 * application withdraws it. See docs/architecture/NOTIFICATIONS.md.
 */
export const NotificationDrawer = ({
  items,
  now,
  onAction,
  onDismiss,
  onOpenChange,
  open,
  screen,
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
    screen={screen}
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

// Each card on its own surface, lifted on hover. A card that arrives while the
// drawer is open slides in like a toast.
const rowStyles = css({
  _hover: {
    backgroundColor: "color-mix(in oklab, {colors.foreground} 7%, transparent)",
    borderColor: "color-mix(in oklab, {colors.foreground} 16%, transparent)",
  },
  _starting: {
    opacity: 0,
    transform: "translateX({spacing.4})",
  },
  // Critical notifications get a danger ring, as their toasts do.
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

// The empty state: no notifications is the normal case, not an error.
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
