import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";
import { ContextMenu } from "../ContextMenu/ContextMenu";
import { popupStyles, positionerStyles } from "../ContextMenu/menu-popup";
import type { ExtendProps } from "../extend-props";
import { usePopupBoundary } from "../PopupBoundary/PopupBoundary";
import "../stylesheet";

type Props = ExtendProps<
  typeof BaseMenu.Root,
  {
    children: ReactNode;
    /** The button that opens it, such as a `Button`. */
    trigger: ReactElement;
  }
>;

/**
 * A menu opened from a button, under its end, and named by it. Its items are
 * `ContextMenu`'s. It stays inside its `PopupBoundary`, such as its window.
 */
const MenuComponent = ({ children, trigger, ...rootProps }: Props) => {
  const { boundary } = usePopupBoundary(false);
  return (
    <BaseMenu.Root {...rootProps}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          align="end"
          className={positionerStyles}
          collisionBoundary={boundary}
          sideOffset={4}
        >
          <BaseMenu.Popup className={popupStyles}>{children}</BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
};

export const Menu = Object.assign(MenuComponent, {
  Item: ContextMenu.Item,
  Separator: ContextMenu.Separator,
});
