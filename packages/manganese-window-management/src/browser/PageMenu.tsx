import { ContextMenu } from "@domicile-desktop/component-library/ContextMenu";
import type { AppMenuEntry } from "@domicile-desktop/sdk/app-menu";
import { Fragment } from "react";
import { css } from "../../styled-system/css";
import { AppMenuEntries } from "./AppMenuBar";

import type { PageMenuItem } from "./page-menu";

type Props = {
  /** Where the click was, in the viewport's CSS pixels. */
  at: { x: number; y: number };
  /** The menu, in groups a line goes between — see `pageMenuFor`. */
  items: PageMenuItem[][];
  /** Extensions' items, drawn above the last group, as Chrome does. */
  extensionItems: readonly AppMenuEntry[];
  onChoose: (item: PageMenuItem) => void;
  /** One of `extensionItems` was chosen, by its id. */
  onChooseExtensionItem: (item: number) => void;
  /** It closed: chosen from, or put away with Escape or a press outside. */
  onClose: () => void;
};

/** A browser window's context menu, drawn where the right click was. */
export const PageMenu = ({
  at,
  extensionItems,
  items,
  onChoose,
  onChooseExtensionItem,
  onClose,
}: Props) => (
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
      <Fragment key={group.map(keyOf).join()}>
        {index > 0 && <ContextMenu.Separator />}
        {index === items.length - 1 && extensionItems.length > 0 && (
          <>
            <AppMenuEntries
              entries={extensionItems}
              onChoose={onChooseExtensionItem}
            />
            <ContextMenu.Separator />
          </>
        )}
        {group.map((item) => (
          <ContextMenu.Item
            disabled={item.disabled}
            key={keyOf(item)}
            onClick={() => {
              onChoose(item);
            }}
            shortcut={item.shortcut}
          >
            {item.replacement === undefined ? (
              item.label
            ) : (
              <span className={suggestionStyles}>{item.label}</span>
            )}
          </ContextMenu.Item>
        ))}
      </Fragment>
    ))}
  </ContextMenu>
);

/** Spelling suggestions share a command, so their words tell them apart. */
const keyOf = (item: PageMenuItem): string =>
  item.replacement === undefined
    ? item.command
    : `${item.command}:${item.replacement}`;

/** A misspelled word's suggestions stand out from the commands below them. */
const suggestionStyles = css({ fontWeight: "semibold" });
