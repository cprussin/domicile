import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Extension } from "@domicile-desktop/sdk/extension";
import type { TrayItem } from "@domicile-desktop/sdk/tray";
import { useEffect, useRef, useState } from "react";

import { css } from "../../styled-system/css";
import { hstack } from "../../styled-system/patterns";
import { ExtensionAction } from "../extensions/ExtensionAction";
import { TrayIcon } from "./TrayIcon";
import type { TrayEntry } from "./tray-entry";
import { TrayEntryKind, trayEntries } from "./tray-entry";

/** The primary button, as `PointerEvent.button` numbers it. */
const PRIMARY_BUTTON = 0;

type Props = {
  /** Where clicks are sent. */
  domicile: DomicileClient;
  /** Every extension with an action, as the engine last described them. */
  extensions: readonly Extension[];
  /** The applications' icons, as the compositor last described them. */
  items: readonly TrayItem[];
  /** Move `dragged` onto `target` among the `shown` keys; see `moveTo`. */
  onMove: (shown: readonly string[], dragged: string, target: string) => void;
  /** Open an extension's popup, or close the open one with `undefined`. */
  onOpen: (id: string | undefined) => void;
  /** The extension whose popup is open, or `undefined`. */
  opened: string | undefined;
  /** The user's icon order; see `useTrayOrder`. */
  order: readonly string[];
};

/**
 * The tray: application StatusNotifierItems and extension actions, in one row,
 * in the user's order. See docs/architecture/SYSTEM-TRAY.md.
 *
 * One row because to the user both are icons for something running; the kind
 * only decides what a click does.
 *
 * Reordering uses pointer events, not native drag and drop, which needs a
 * platform drag controller that a bare tty lacks. A press that moved an icon
 * does not also activate it.
 *
 * Disabled actions are hidden. The state is each action's default, not the
 * focused tab's; see docs/architecture/EXTENSIONS.md.
 */
export const Tray = ({
  domicile,
  extensions,
  items,
  onMove,
  onOpen,
  opened,
  order,
}: Props) => {
  const entries = trayEntries(items, extensions, order);
  const shown = entries.map(({ key }) => key);

  // The key of the icon being dragged while the button is down.
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  // Whether this press moved an icon, which suppresses its click. A ref because
  // the click fires in the same turn as the release and nothing renders from
  // it.
  const moved = useRef(false);

  // Ends wherever the button is released, on the bar or not.
  useEffect(() => {
    if (dragged === undefined) {
      return undefined;
    } else {
      const end = () => {
        setDragged(undefined);
      };
      globalThis.addEventListener("pointerup", end);
      globalThis.addEventListener("pointercancel", end);
      return () => {
        globalThis.removeEventListener("pointerup", end);
        globalThis.removeEventListener("pointercancel", end);
      };
    }
  }, [dragged]);

  return (
    <div
      className={trayStyles}
      onClickCapture={(event) => {
        if (moved.current) {
          event.stopPropagation();
        }
      }}
    >
      {entries.map((entry) => (
        <div
          className={entryStyles}
          key={entry.key}
          onPointerDown={(event) => {
            if (event.button === PRIMARY_BUTTON) {
              moved.current = false;
              setDragged(entry.key);
            }
          }}
          onPointerOver={() => {
            if (dragged !== undefined && dragged !== entry.key) {
              moved.current = true;
              onMove(shown, dragged, entry.key);
            }
          }}
        >
          <Entry
            domicile={domicile}
            entry={entry}
            onOpen={onOpen}
            opened={opened}
          />
        </div>
      ))}
    </div>
  );
};

type EntryProps = Pick<Props, "domicile" | "onOpen" | "opened"> & {
  entry: TrayEntry;
};

/** One icon, rendered by kind. */
const Entry = ({ domicile, entry, onOpen, opened }: EntryProps) => {
  switch (entry.kind) {
    case TrayEntryKind.Extension: {
      return (
        <ExtensionAction
          domicile={domicile}
          extension={entry.extension}
          onOpen={onOpen}
          opened={opened}
        />
      );
    }
    case TrayEntryKind.StatusNotifier: {
      return <TrayIcon domicile={domicile} item={entry.item} />;
    }
  }
};

const trayStyles = hstack({ gap: 0.5 });

// A box the icon's size, so the row layout does not change.
const entryStyles = css({ display: "flex" });
