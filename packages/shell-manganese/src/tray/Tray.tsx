import type { DomicileClient } from "@domicile/sdk/domicile-client";
import type { Extension } from "@domicile/sdk/extension";
import type { TrayItem } from "@domicile/sdk/tray";
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
  /** What every click asks. */
  domicile: DomicileClient;
  /** Every extension with an action, as the engine last described them. */
  extensions: readonly Extension[];
  /** The applications' icons, as the compositor last described them. */
  items: readonly TrayItem[];
  /** Drag `dragged` onto `target`, among the `shown` keys; see `moveTo`. */
  onMove: (shown: readonly string[], dragged: string, target: string) => void;
  /** Open an extension's popup, or close the open one with `undefined`. */
  onOpen: (id: string | undefined) => void;
  /** The extension whose popup is open, or `undefined` when none is. */
  opened: string | undefined;
  /** The order the user put the icons in; see `useTrayOrder`. */
  order: readonly string[];
};

/**
 * The tray: every application's StatusNotifierItem and every extension's
 * action, in one row, in the order the user dragged them into.
 *
 * **One row rather than two**, because to the user both are the same thing —
 * an icon for something running, whose click is its own. Which kind each is
 * decides only what the click asks.
 *
 * **A drag is the pointer's, not the engine's**: pressed on an icon, the icon
 * moves to wherever the pointer goes over another, and is left there when the
 * button comes up. A native drag and drop would go through the platform's
 * drag controller, which a desk on a bare tty does not have. A press that
 * moved an icon is not a click — the icon is not activated for being put
 * down — and one that moved none is.
 *
 * A disabled action is not drawn. The state is each action's default rather
 * than the focused page's until actions are per tab — see EXTENSIONS.md.
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

  // The key of the icon being dragged, while the button is down on one.
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  // Whether this press moved an icon, which makes its click not one. A ref,
  // because the click that reads it is in the same event loop turn as the
  // release that ends the drag, and nothing is drawn from it.
  const moved = useRef(false);

  // Ended wherever the button comes up — over the bar or not.
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

/** One icon, drawn by its kind. */
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

// A box of the icon's own size, so the row is laid out as it was without one.
const entryStyles = css({ display: "flex" });
