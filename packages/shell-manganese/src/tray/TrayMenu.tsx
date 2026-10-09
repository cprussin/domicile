import type { Result } from "@cprussin/option-result";
import type { Point } from "@domicile-desktop/component-library/ContextMenu";
import { ContextMenu } from "@domicile-desktop/component-library/ContextMenu";
import type { MenuEntry, MenuItem } from "@domicile-desktop/sdk/dbusmenu";
import { MenuEntryKind, ToggleKind } from "@domicile-desktop/sdk/dbusmenu";
import type { SystemError } from "@domicile-desktop/sdk/system";

type Requests = {
  /** Activate the item `id`. */
  onClick: (id: number) => void;
  /** The submenu under `id` is opening. */
  onShow: (id: number) => void;
};

type Props = Requests & {
  /** Where the menu's corner goes, in the viewport's CSS pixels. */
  at: Point;
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
 */
export const TrayMenu = ({
  at,
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
        <Entries entries={entries} onClick={onClick} onShow={onShow} />
      ),
    })}
  </ContextMenu>
);

type EntriesProps = Requests & { entries: readonly MenuEntry[] };

const Entries = ({ entries, onClick, onShow }: EntriesProps) =>
  entries.map((entry) => {
    switch (entry.kind) {
      case MenuEntryKind.Separator: {
        return <ContextMenu.Separator key={entry.id} />;
      }
      case MenuEntryKind.Item: {
        return (
          <Item item={entry} key={entry.id} onClick={onClick} onShow={onShow} />
        );
      }
    }
  });

type ItemProps = Requests & { item: MenuItem };

/** An item, a submenu, a check box or a radio item. */
const Item = ({ item, onClick, onShow }: ItemProps) => {
  if (item.submenu === undefined) {
    return <Leaf item={item} onClick={onClick} />;
  } else {
    return (
      <ContextMenu.Submenu
        disabled={!item.enabled}
        label={item.label}
        onOpenChange={(open) => {
          if (open) {
            onShow(item.id);
          }
        }}
      >
        <Entries entries={item.submenu} onClick={onClick} onShow={onShow} />
      </ContextMenu.Submenu>
    );
  }
};

/**
 * An item without a submenu. The application flips a toggle when clicked and
 * sends the new state, so a toggle shows `checked` as read. Each radio item is
 * its own group: dbusmenu does not group them.
 */
const Leaf = ({ item, onClick }: Omit<ItemProps, "onShow">) => {
  const click = () => {
    onClick(item.id);
  };
  switch (item.toggle?.kind) {
    case undefined: {
      return (
        <ContextMenu.Item disabled={!item.enabled} onClick={click}>
          {item.label}
        </ContextMenu.Item>
      );
    }
    case ToggleKind.Checkmark: {
      return (
        <ContextMenu.CheckboxItem
          checked={item.toggle.checked}
          closeOnClick
          disabled={!item.enabled}
          onClick={click}
        >
          {item.label}
        </ContextMenu.CheckboxItem>
      );
    }
    case ToggleKind.Radio: {
      return (
        <ContextMenu.RadioGroup
          value={item.toggle.checked ? item.id : undefined}
        >
          <ContextMenu.RadioItem
            closeOnClick
            disabled={!item.enabled}
            onClick={click}
            value={item.id}
          >
            {item.label}
          </ContextMenu.RadioItem>
        </ContextMenu.RadioGroup>
      );
    }
  }
};
