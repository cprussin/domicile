import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode, RefCallback } from "react";
import { useCallback, useContext, useState } from "react";

import { css } from "../../styled-system/css";
import type { ExtendProps } from "../extend-props";
import type { Alignment, Side } from "../Popover/Popover";
import { PopoverContainer } from "../Popover/Popover";

type Props = ExtendProps<
  typeof BaseTooltip.Root,
  {
    align?: Alignment | undefined;
    content: ReactNode;
    /** How long the pointer rests on the trigger before it opens, in ms. */
    delay?: number | undefined;
    side?: Side | undefined;
    trigger: ReactElement;
  }
>;

/**
 * A short, non-interactive label shown while the pointer rests on, or focus
 * is on, its trigger. For detail the trigger has no room for, such as a cut
 * title. Use `Popover` for anything the user acts on.
 *
 * Stays on its trigger's `<Screen>` region, as `Popover` does, and draws in
 * the same container.
 */
export const Tooltip = ({
  align = "center",
  content,
  delay,
  side = "bottom",
  trigger,
  ...rootProps
}: Props) => {
  const [screen, setScreen] = useState<Element | undefined>(undefined);
  const attachTrigger = useCallback<RefCallback<HTMLElement>>((element) => {
    setScreen(element?.closest("[data-screen]") ?? undefined);
  }, []);
  const container = useContext(PopoverContainer);
  return (
    <BaseTooltip.Root {...rootProps}>
      <BaseTooltip.Trigger delay={delay} ref={attachTrigger} render={trigger} />
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner
          align={align}
          className={positionerStyles}
          collisionBoundary={screen}
          side={side}
          sideOffset={6}
        >
          <BaseTooltip.Popup className={popupStyles} role="tooltip">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
};

const positionerStyles = css({ zIndex: "modal" });

const popupStyles = css({
  "&[data-ending-style]": { opacity: 0 },
  // base-ui's attribute instead of Panda's `_starting`, as in `Popover`.
  "&[data-starting-style]": { opacity: 0 },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "md",
  boxShadow: "lifted",
  color: "foreground",
  fontSize: "xs",
  lineHeight: "normal",
  maxInlineSize: "min({spacing.88}, 90vw)",
  opacity: 1,
  paddingBlock: 1.5,
  paddingInline: 2.5,
  transition: "opacity {durations.fast} {easings.out}",
});
