import { Button } from "@domicile-desktop/component-library/Button";
import { EmptyState } from "@domicile-desktop/component-library/EmptyState";
import { IconButton } from "@domicile-desktop/component-library/IconButton";
import { List, ListRow } from "@domicile-desktop/component-library/ListRow";
import { Menu } from "@domicile-desktop/component-library/Menu";
import { Panel } from "@domicile-desktop/component-library/Panel";
import { PanelFooter } from "@domicile-desktop/component-library/PanelFooter";
import { PanelNote } from "@domicile-desktop/component-library/PanelNote";
import { PanelSection } from "@domicile-desktop/component-library/PanelSection";
import { Popover } from "@domicile-desktop/component-library/Popover";
import { Switch } from "@domicile-desktop/component-library/Switch";
import type { watchMenu } from "@domicile-desktop/sdk/dbusmenu";
import type { BrowserProfile } from "@domicile-desktop/sdk/desktop/browser";
import type { Domicile } from "@domicile-desktop/sdk/desktop/desktop";
import type {
  Extension,
  ExtensionPopup,
  ExtensionSettings,
  InstalledExtension,
} from "@domicile-desktop/sdk/extension";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { LockIcon } from "@phosphor-icons/react/dist/ssr/Lock";
import { PushPinIcon } from "@phosphor-icons/react/dist/ssr/PushPin";
import { PuzzlePieceIcon } from "@phosphor-icons/react/dist/ssr/PuzzlePiece";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";

import { css } from "../styled-system/css";
import { center } from "../styled-system/patterns";
import { useActionMenu } from "./extensions/useActionMenu";
import type { MenuIcons } from "./menu-icons";
import { extensionKey, statusNotifierKey } from "./tray-entry";
import { useItemMenu } from "./useItemMenu";

/** What a locked setting says while the pointer rests on it. */
const SET_IN_CONFIG = "Set in your config";

type Props = {
  /** Where clicks and changes are sent. */
  domicile: Domicile;
  /** The extensions with an action, for their popups and badges. */
  extensions: readonly Extension[];
  /** Every installed extension, switched on or off. */
  installed: readonly InstalledExtension[];
  /** The applications' icons. */
  items: readonly TrayItem[];
  /** Extension `id`'s action was clicked, from its row. */
  onActivate: (id: string) => void;
  /** Open an extension's popup. */
  onOpen: (popup: ExtensionPopup) => void;
  /** Put icon `key` back in the tray. */
  onPin: (key: string) => void;
  /** Open the Settings app. */
  onSettings: () => void;
  /** Keep icon `key` out of the tray. */
  onUnpin: (key: string) => void;
  /**
   * The last focused page's browser profile, whose switches the menu shows;
   * `undefined` before the engine lists profiles.
   */
  profile: BrowserProfile | undefined;
  /** The keys of the icons kept out of the tray. */
  unpinned: ReadonlySet<string>;
  /** Injectable so tests can answer for the applications' menus. */
  watch?: typeof watchMenu | undefined;
  /** Injectable so tests can answer for the menus' icons. */
  icons?: MenuIcons | undefined;
};

/**
 * The button at the end of the tray, and its menu of every tray icon:
 * applications' and every installed extension, each pinned to the tray or
 * not. Extensions also switch on and off in the last focused page's browser
 * profile, and their `⋯` menu holds their options, what they can read, and
 * uninstalling.
 *
 * Clicking a row does what clicking its icon does. An unpinned extension's
 * popup opens from the tray, where its icon shows while it is open.
 */
export const TrayIconsMenu = ({
  domicile,
  extensions,
  icons,
  installed,
  items,
  onActivate,
  onOpen,
  onPin,
  onSettings,
  onUnpin,
  profile,
  unpinned,
  watch,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const changed = useChangedExtensions(domicile, open ? profile : undefined);
  const actions = new Map(extensions.map((action) => [action.id, action]));
  /** Runs `request`, saying `what` failed if it is refused. */
  const ask = (what: string, request: Promise<void>) => {
    request.then(
      () => {
        setFailure(undefined);
        changed.reload();
      },
      (error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: the panel says it in words; this keeps the error itself
        console.error(`tray: couldn't ${what}`, error);
        setFailure({
          detail: error instanceof Error ? error.message : String(error),
          what,
        });
      },
    );
  };
  const pinOf = (key: string, name: string) =>
    unpinned.has(key) ? (
      <IconButton
        label={`Pin ${name}`}
        onClick={() => {
          onPin(key);
        }}
        size="sm"
      >
        <PushPinIcon />
      </IconButton>
    ) : (
      <IconButton
        label={`Unpin ${name}`}
        onClick={() => {
          onUnpin(key);
        }}
        size="sm"
      >
        <PushPinIcon weight="fill" />
      </IconButton>
    );
  return (
    <Popover
      align="end"
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      tone="overPhoto"
      trigger={
        <Button label="All tray icons" size="sm" variant="ghost">
          <span className={caretStyles}>
            <CaretDownIcon aria-hidden size={12} weight="bold" />
          </span>
        </Button>
      }
    >
      <Panel title="Tray icons" width="standard">
        {failure !== undefined && (
          <PanelNote detail={failure.detail} tone="warning">
            {`Couldn't ${failure.what}`}
          </PanelNote>
        )}
        {items.length === 0 && installed.length === 0 && (
          <EmptyState
            hint="Apps and extensions with an icon show up here."
            icon={PuzzlePieceIcon}
            title="Nothing in the tray"
          />
        )}
        {items.length > 0 && (
          <PanelSection label="Apps">
            <List>
              {items.map((item) => (
                <AppRow
                  domicile={domicile}
                  icons={icons}
                  item={item}
                  key={item.id}
                  onClose={() => {
                    setOpen(false);
                  }}
                  pin={pinOf(statusNotifierKey(item.id), item.title)}
                  watch={watch}
                />
              ))}
            </List>
          </PanelSection>
        )}
        {installed.length > 0 && (
          <PanelSection
            label={
              profile === undefined
                ? "Extensions"
                : `Extensions in ${profile.name}`
            }
          >
            <List>
              {installed.map((extension) => (
                <ExtensionRow
                  action={actions.get(extension.id)}
                  ask={ask}
                  changed={changed.ids.includes(extension.id)}
                  domicile={domicile}
                  extension={extension}
                  key={extension.id}
                  on={profile?.enabledExtensions.includes(extension.id)}
                  onActivate={(action) => {
                    setOpen(false);
                    onActivate(action.id);
                    domicile.extensions.activate(action.id);
                    if (action.popup !== undefined) {
                      onOpen({
                        id: action.id,
                        popup: action.popup,
                        profile: action.profile,
                      });
                    }
                  }}
                  onReset={() => {
                    if (profile !== undefined) {
                      ask(
                        `reset ${extension.name} in ${profile.name}`,
                        domicile.browser.resetExtension(
                          profile.id,
                          extension.id,
                        ),
                      );
                    }
                  }}
                  onSettings={onSettings}
                  onSwitch={(on) => {
                    if (profile !== undefined) {
                      ask(
                        `switch ${extension.name} ${on ? "on" : "off"} in ${profile.name}`,
                        domicile.browser.setExtensionEnabled(
                          profile.id,
                          extension.id,
                          on,
                        ),
                      );
                    }
                  }}
                  pin={pinOf(extensionKey(extension.id), extension.name)}
                />
              ))}
            </List>
          </PanelSection>
        )}
        <PanelFooter
          action={
            <Button
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
              rounded
              size="xs"
              variant="ghost"
            >
              Settings
            </Button>
          }
        />
      </Panel>
    </Popover>
  );
};

/**
 * The extensions a temporary change switches in `profile` apart from the
 * config, read again whenever the engine lists the profile again, as when a
 * switch changed here or in Settings; none while `profile` is `undefined`.
 */
const useChangedExtensions = (
  domicile: Domicile,
  profile: BrowserProfile | undefined,
) => {
  const [ids, setIds] = useState<readonly string[]>([]);
  const read = useCallback(
    (of: BrowserProfile | undefined) => {
      if (of === undefined) {
        setIds([]);
      } else {
        domicile.browser
          .changedExtensions(of.id)
          .then(setIds, (error: unknown) => {
            // biome-ignore lint/suspicious/noConsole: a switch shows no Reset, and this keeps why
            console.error("tray: couldn't read the temporary changes", error);
          });
      }
    },
    [domicile],
  );
  useEffect(() => {
    read(profile);
  }, [read, profile]);
  return {
    ids,
    reload: () => {
      read(profile);
    },
  };
};

/** A request the engine refused: what it was, and the engine's words. */
type Failure = { detail: string; what: string };

type AppRowProps = Pick<Props, "icons" | "watch"> & {
  domicile: Domicile;
  item: TrayItem;
  /** Closes the tray's menu. */
  onClose: () => void;
  /** Its pin button. */
  pin: ReactNode;
};

/**
 * An application's row. A click is its icon's primary click; a right click
 * anywhere on it opens its own menu there.
 */
const AppRow = ({
  domicile,
  icons,
  item,
  onClose,
  pin,
  watch,
}: AppRowProps) => {
  const menu = useItemMenu(domicile, item, watch, icons);
  return (
    <ListRow
      // The menu beside the row's button, so its clicks don't bubble into it.
      actions={
        <>
          {pin}
          {menu.opened}
        </>
      }
      icon={
        item.icon === undefined ? (
          <span className={letterStyles}>{item.title.slice(0, 1)}</span>
        ) : (
          <img alt="" className={iconStyles} src={item.icon} />
        )
      }
      label={item.title}
      onPress={() => {
        onClose();
        domicile.tray.activate(item.id, "primary");
      }}
      onSecondaryPress={menu.show}
    />
  );
};

type ExtensionRowProps = {
  /** Its action, while it has one in the tray. */
  action: Extension | undefined;
  /** Runs a request, saying what failed if it is refused. */
  ask: (what: string, request: Promise<void>) => void;
  domicile: Domicile;
  extension: InstalledExtension;
  /**
   * Whether it is on in the profile the menu shows; `undefined` before the
   * engine lists profiles, when it cannot switch.
   */
  on: boolean | undefined;
  /** A temporary change switches it apart from the config. */
  changed: boolean;
  /** Its row was clicked: click `action`. */
  onActivate: (action: Extension) => void;
  /** Open the Settings app. */
  onSettings: () => void;
  /** Switch it on or off in the profile the menu shows. */
  onSwitch: (on: boolean) => void;
  /** Put it back as the config switches it. */
  onReset: () => void;
  /** Its pin button. */
  pin: ReactNode;
};

/**
 * An installed extension's row: its pin while it is on, its switch, and its
 * `⋯` menu. Its icon is its manifest's, so it shows while it is off.
 */
const ExtensionRow = ({
  action,
  ask,
  changed,
  domicile,
  extension,
  on,
  onActivate,
  onReset,
  onSettings,
  onSwitch,
  pin,
}: ExtensionRowProps) => {
  const [uninstalling, setUninstalling] = useState(false);
  const { id, name } = extension;
  const enabled = on === true;
  const controls = (
    <>
      {enabled && pin}
      <Switch
        checked={enabled}
        disabled={on === undefined}
        hideLabel
        label={name}
        onCheckedChange={onSwitch}
      />
      <ExtensionMore
        ask={ask}
        domicile={domicile}
        extension={extension}
        onSettings={onSettings}
        onUninstall={() => {
          setUninstalling(true);
        }}
      />
    </>
  );
  const icon = <img alt="" className={iconStyles} src={extension.icon} />;
  const confirm = uninstalling && (
    <div className={confirmStyles}>
      <span>{`Uninstall ${name}?`}</span>
      <span className={confirmButtonsStyles}>
        <Button
          onClick={() => {
            setUninstalling(false);
          }}
          rounded
          size="xs"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          onClick={() => {
            setUninstalling(false);
            ask(`uninstall ${name}`, domicile.extensions.uninstall(id));
          }}
          rounded
          size="xs"
          variant="danger"
        >
          Uninstall
        </Button>
      </span>
    </div>
  );
  const differs = changed && (
    <span className={changedStyles}>
      Changed from your config
      <Button
        label={`Reset ${name}`}
        onClick={onReset}
        rounded
        size="xs"
        variant="ghost"
      >
        Reset
      </Button>
    </span>
  );
  return action === undefined ? (
    <ListRow
      detail={enabled ? undefined : "Off"}
      end={controls}
      icon={icon}
      label={name}
    >
      {differs}
      {confirm}
    </ListRow>
  ) : (
    <ActionRow
      action={action}
      controls={controls}
      domicile={domicile}
      icon={icon}
      onActivate={onActivate}
    >
      {differs}
      {confirm}
    </ActionRow>
  );
};

type ActionRowProps = Pick<ExtensionRowProps, "domicile" | "onActivate"> & {
  action: Extension;
  /** What goes below its label. */
  children: ReactNode;
  /** Its pin, switch and `⋯` menu. */
  controls: ReactNode;
  icon: ReactNode;
};

/**
 * The row of an extension with an action. A click is its icon's click; a
 * right click anywhere on it opens the action's menu there.
 */
const ActionRow = ({
  action,
  children,
  controls,
  domicile,
  icon,
  onActivate,
}: ActionRowProps) => {
  const menu = useActionMenu(domicile, action);
  return (
    <ListRow
      // The menu beside the row's button, so its clicks don't bubble into it.
      actions={
        <>
          {controls}
          {menu.opened}
        </>
      }
      icon={icon}
      label={action.name}
      onPress={() => {
        onActivate(action);
      }}
      onSecondaryPress={menu.show}
    >
      {children}
    </ListRow>
  );
};

type ExtensionMoreProps = {
  ask: (what: string, request: Promise<void>) => void;
  domicile: Domicile;
  extension: InstalledExtension;
  onSettings: () => void;
  /** Uninstall… was chosen: ask first. */
  onUninstall: () => void;
};

/**
 * An extension's `⋯` menu: its options page, what it can read, and the
 * settings it can use. What the desk's config sets is locked, with a lock and
 * a word on why.
 */
const ExtensionMore = ({
  ask,
  domicile,
  extension,
  onSettings,
  onUninstall,
}: ExtensionMoreProps) => {
  const {
    configured,
    fileAccess,
    fromConfig,
    id,
    name,
    optionsUrl,
    siteAccess,
    userScripts,
  } = extension;
  const configure = (settings: ExtensionSettings) => {
    ask(`change ${name}`, domicile.extensions.configure(id, settings));
  };
  const locked = (setting: InstalledExtension["configured"][number]) =>
    configured.includes(setting);
  const lock = (setting: InstalledExtension["configured"][number]) =>
    locked(setting)
      ? { disabled: true, icon: lockIcon, title: SET_IN_CONFIG }
      : {};
  return (
    <Menu
      trigger={
        <IconButton label={`More for ${name}`} size="sm">
          <DotsThreeIcon weight="bold" />
        </IconButton>
      }
    >
      {optionsUrl !== undefined && (
        <Menu.Item
          onClick={() => {
            domicile.browser.open(optionsUrl);
          }}
        >
          Options
        </Menu.Item>
      )}
      {siteAccess !== undefined && (
        <Menu.Submenu
          disabled={locked("siteAccess")}
          icon={locked("siteAccess") ? lockIcon : undefined}
          label="Can read websites"
        >
          <Menu.RadioGroup
            onValueChange={(chosen: string) => {
              if (chosen === "specific_sites") {
                onSettings();
              } else if (chosen === "on_click" || chosen === "all_sites") {
                configure({ siteAccess: chosen });
              } else {
                throw new Error(`tray: no site access ${chosen}`);
              }
            }}
            value={siteAccess}
          >
            <Menu.RadioItem value="on_click">
              Only when you click it
            </Menu.RadioItem>
            <Menu.RadioItem value="all_sites">On all sites</Menu.RadioItem>
            <Menu.RadioItem value="specific_sites">
              On sites you choose…
            </Menu.RadioItem>
          </Menu.RadioGroup>
        </Menu.Submenu>
      )}
      {fileAccess !== undefined && (
        <Menu.CheckboxItem
          checked={fileAccess}
          onCheckedChange={(checked) => {
            configure({ fileAccess: checked });
          }}
          {...lock("fileAccess")}
        >
          Allow on local files
        </Menu.CheckboxItem>
      )}
      {userScripts !== undefined && (
        <Menu.CheckboxItem
          checked={userScripts}
          onCheckedChange={(checked) => {
            configure({ userScripts: checked });
          }}
          {...lock("userScripts")}
        >
          Allow user scripts
        </Menu.CheckboxItem>
      )}
      {!fromConfig && (
        <>
          <Menu.Separator />
          <Menu.Item onClick={onUninstall}>Uninstall…</Menu.Item>
        </>
      )}
    </Menu>
  );
};

/** Marks a setting the desk's config sets. */
const lockIcon = <LockIcon aria-label={SET_IN_CONFIG} role="img" />;

// Chrome's 16px toolbar icon size, as the tray's icons.
const iconStyles = css({ blockSize: 4, inlineSize: 4, objectFit: "contain" });

// The same box as an icon, for an application without one.
const letterStyles = center({
  blockSize: 4,
  fontSize: "ui",
  inlineSize: 4,
});

// The caret, in the box of a tray icon.
const caretStyles = center({ blockSize: 4, inlineSize: 4 });

const changedStyles = css({
  alignItems: "center",
  color: "warning",
  display: "flex",
  fontSize: "xs",
  gap: 1,
});

const confirmStyles = css({
  alignItems: "center",
  display: "flex",
  gap: 2,
  justifyContent: "space-between",
  textStyle: "panelDetail",
});

const confirmButtonsStyles = css({ display: "flex", gap: 1 });
