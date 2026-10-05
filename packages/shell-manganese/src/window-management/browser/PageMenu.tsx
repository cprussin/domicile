import { ContextMenu } from "@domicile-desktop/component-library/ContextMenu";
import { Fragment } from "react";

import type { PageMenuCommand, PageMenuItem } from "./page-menu";

type Props = {
  /** Where the click was, in the viewport's CSS pixels. */
  at: { x: number; y: number };
  /** The menu, in groups a line goes between — see `pageMenuFor`. */
  items: PageMenuItem[][];
  onChoose: (command: PageMenuCommand) => void;
  /** It closed: chosen from, or put away with Escape or a press outside. */
  onClose: () => void;
};

/** A browser window's context menu, drawn where the right click was. */
export const PageMenu = ({ at, items, onChoose, onClose }: Props) => (
  <ContextMenu
    at={at}
    label="Page"
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
    open
  >
    {items.map((group, index) => (
      <Fragment key={group.map((item) => item.command).join()}>
        {index > 0 && <ContextMenu.Separator />}
        {group.map((item) => (
          <ContextMenu.Item
            disabled={item.disabled}
            key={item.command}
            onClick={() => {
              onChoose(item.command);
            }}
            shortcut={item.shortcut}
          >
            {item.label}
          </ContextMenu.Item>
        ))}
      </Fragment>
    ))}
  </ContextMenu>
);
