import type { Result } from "@cprussin/option-result";
import type { Point } from "@domicile-desktop/component-library/ContextMenu";
import { ContextMenu } from "@domicile-desktop/component-library/ContextMenu";
import type { MenuEntry, MenuItem } from "@domicile-desktop/sdk/dbusmenu";
import { MenuEntryKind, ToggleKind } from "@domicile-desktop/sdk/dbusmenu";
import type { SystemError } from "@domicile-desktop/sdk/system";
import type { ThemedIcon } from "@domicile-desktop/system-apps/app-icons";
import type { ReactNode } from "react";

import { css } from "../../styled-system/css";

type Requests = {
  /** Activate the item `id`. */
  onClick: (id: number) => void;
  /** The submenu under `id` is opening. */
  onShow: (id: number) => void;
};

type Props = Requests & {
  /** Where the menu's corner goes, in the viewport's CSS pixels. */
  at: Point;
  /** The theme's pictures for the menu's icon names. */
  icons: ReadonlyMap<string, ThemedIcon>;
  /** The tray icon's title. */
  label: string;
  /** What the application's menu holds. */
  menu: Result<readonly MenuEntry[], SystemError>;
  /** It closed: chosen from, or put away with Escape or a press outside. */
  onClose: () => void;
};

/**
 * A tray icon's `com.canonical.dbusmenu` menu. A menu that cannot be read
 * shows one disabled entry saying so.
 *
 * An entry's icon is the theme's for its name, else the application's own
 * picture. Its mnemonic is underlined, and its key chooses it.
 */
export const TrayMenu = ({
  at,
  icons,
  label,
  menu,
  onClick,
  onClose,
  onShow,
}: Props) => (
  <ContextMenu
    at={at}
    label={label}
    onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}
    open
  >
    {menu.match({
      Err: () => <ContextMenu.Item disabled>Menu unavailable</ContextMenu.Item>,
      Ok: (entries) => (
        <Entries
          entries={entries}
          icons={icons}
          onClick={onClick}
          onShow={onShow}
        />
      ),
    })}
  </ContextMenu>
);

type EntriesProps = Requests & {
  entries: readonly MenuEntry[];
  icons: ReadonlyMap<string, ThemedIcon>;
};

const Entries = ({ entries, icons, onClick, onShow }: EntriesProps) =>
  entries.map((entry) => {
    switch (entry.kind) {
      case MenuEntryKind.Separator: {
        return <ContextMenu.Separator key={entry.id} />;
      }
      case MenuEntryKind.Item: {
        return (
          <Item
            icons={icons}
            item={entry}
            key={entry.id}
            onClick={onClick}
            onShow={onShow}
          />
        );
      }
    }
  });

type ItemProps = Requests & {
  icons: ReadonlyMap<string, ThemedIcon>;
  item: MenuItem;
};

/** An item, a submenu, a check box or a radio item. */
const Item = ({ icons, item, onClick, onShow }: ItemProps) => {
  if (item.submenu === undefined) {
    return <Leaf icons={icons} item={item} onClick={onClick} />;
  } else {
    return (
      <ContextMenu.Submenu
        disabled={!item.enabled}
        icon={picture(icons, item)}
        label={item.label}
        mnemonic={item.mnemonic}
        onOpenChange={(open) => {
          if (open) {
            onShow(item.id);
          }
        }}
      >
        <Entries
          entries={item.submenu}
          icons={icons}
          onClick={onClick}
          onShow={onShow}
        />
      </ContextMenu.Submenu>
    );
  }
};

/**
 * An item without a submenu. The application flips a toggle when clicked and
 * sends the new state, so a toggle shows `checked` as read. Each radio item is
 * its own group: dbusmenu does not group them.
 */
const Leaf = ({ icons, item, onClick }: Omit<ItemProps, "onShow">) => {
  const shared = {
    children: item.label,
    disabled: !item.enabled,
    icon: picture(icons, item),
    mnemonic: item.mnemonic,
    onClick: () => {
      onClick(item.id);
    },
  };
  switch (item.toggle?.kind) {
    case undefined: {
      return <ContextMenu.Item {...shared} />;
    }
    case ToggleKind.Checkmark: {
      return (
        <ContextMenu.CheckboxItem
          checked={item.toggle.checked}
          closeOnClick
          {...shared}
        />
      );
    }
    case ToggleKind.Radio: {
      return (
        <ContextMenu.RadioGroup
          value={item.toggle.checked ? item.id : undefined}
        >
          <ContextMenu.RadioItem closeOnClick value={item.id} {...shared} />
        </ContextMenu.RadioGroup>
      );
    }
  }
};

/**
 * `item`'s icon: the theme's for its name, else the application's picture. A
 * symbolic icon is a mask over the text's color, so it shows on any menu.
 */
const picture = (
  icons: ReadonlyMap<string, ThemedIcon>,
  item: MenuItem,
): ReactNode => {
  const themed = item.icon === undefined ? undefined : icons.get(item.icon);
  if (themed?.symbolic === true) {
    return (
      <span
        className={symbolicStyles}
        role="presentation"
        style={{ maskImage: `url("${themed.url}")` }}
      />
    );
  } else {
    const src = themed?.url ?? item.image;
    return src === undefined ? undefined : <img alt="" src={src} />;
  }
};

const symbolicStyles = css({
  backgroundColor: "currentColor",
  display: "block",
  maskPosition: "center",
  maskRepeat: "no-repeat",
  maskSize: "contain",
});
