import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { DomicileClient } from "@domicile-desktop/sdk/domicile-client";
import type { Extension } from "@domicile-desktop/sdk/extension";
import { WEBVIEW_CLOSE_EVENT } from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { useContentSize } from "./useContentSize";

type Props = {
  /** Client every click goes through. */
  domicile: DomicileClient;
  /** Extension this action belongs to. */
  extension: Extension;
  /**
   * Requests the popup of the extension with this id, or `undefined` to close
   * it. The desktop decides, because an open popup takes the keyboard from
   * the windows (see `AppWindow`).
   */
  onOpen: (id: string | undefined) => void;
  /** Id of the extension whose popup is open, if any. */
  opened: string | undefined;
};

/**
 * An extension's toolbar action, drawn in the bar's tray.
 *
 * Every click calls `activateExtension`, which grants `activeTab` on the
 * focused browser window. An action with a popup then opens it in a
 * `<webview>` panel; the engine dispatches `action.onClicked` for one without.
 *
 * The panel closes on an outside press, Escape, or the popup's
 * `window.close()`. Escape works only while the shell page has the keyboard,
 * since keys pressed in the popup never reach it.
 */
export const ExtensionAction = ({
  domicile,
  extension,
  onOpen,
  opened,
}: Props) => {
  const { id, popup } = extension;
  return popup === undefined ? (
    <Button
      label={extension.title}
      onClick={() => {
        domicile.activateExtension(id);
      }}
      size="sm"
      variant="ghost"
    >
      <Icon extension={extension} />
    </Button>
  ) : (
    <Popover
      align="start"
      flush
      onOpenChange={(open) => {
        if (open) {
          domicile.activateExtension(id);
        }
        onOpen(open ? id : undefined);
      }}
      open={opened === id}
      side="bottom"
      trigger={
        <Button label={extension.title} size="sm" variant="ghost">
          <Icon extension={extension} />
        </Button>
      }
    >
      <PopupView
        onClose={() => {
          onOpen(undefined);
        }}
        popup={popup}
      />
    </Popover>
  );
};

/** An action's icon, with its badge over the corner when it has one. */
const Icon = ({ extension }: { extension: Extension }) => (
  <span className={iconStyles}>
    <img
      alt=""
      className={imageStyles}
      // Dragging reorders the tray, so the image itself is not draggable.
      draggable={false}
      src={extension.icon}
    />
    {extension.badgeText !== "" && (
      <span
        className={badgeStyles}
        // Inline because Panda can't read runtime values. `#rrggbbaa`,
        // transparent when the extension set none.
        style={{ backgroundColor: extension.badgeColor }}
      >
        {extension.badgeText}
      </span>
    )}
  </span>
);

type PopupViewProps = {
  /** The popup called `window.close()`. */
  onClose: () => void;
  popup: string;
};

/**
 * The popup page in a `<webview>`.
 *
 * The view reports `window.close()` as `domicile-close` and leaves closing to
 * the shell. Like Chrome's popup, it sizes to its content, capped at
 * `viewStyles`' box (also its size until the page reports one).
 */
const PopupView = ({ onClose, popup }: PopupViewProps) => {
  // `null` because React passes it to a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);
  const size = useContentSize(view);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      view.addEventListener(WEBVIEW_CLOSE_EVENT, onClose);
      return () => {
        view.removeEventListener(WEBVIEW_CLOSE_EVENT, onClose);
      };
    }
  }, [onClose, view]);

  return (
    <webview
      className={viewStyles}
      // Marks the page as an action popup rather than a tab, so extensions
      // that lay out differently in a tab match Chrome. Read once, when the
      // view loads its page.
      extensionpopup=""
      ref={setView}
      src={popup}
      // Inline because Panda can't read runtime values. `viewStyles` caps it.
      style={
        size === undefined
          ? undefined
          : { blockSize: size.height, inlineSize: size.width }
      }
    />
  );
};

// Positions the badge.
const iconStyles = css({ display: "inline-flex", position: "relative" });

// Chrome's 16px toolbar icon size, in CSS pixels. The engine renders the PNG at
// the page's density.
const imageStyles = css({ blockSize: 4, inlineSize: 4 });

// Over the icon's lower corner, with white text, as in Chrome.
const badgeStyles = css({
  borderRadius: "sm",
  color: "white",
  fontSize: "2xs",
  fontVariantNumeric: "tabular-nums",
  insetBlockEnd: -1,
  insetInlineEnd: -1.5,
  lineHeight: "none",
  paddingBlock: 0.25,
  paddingInline: 0.5,
  position: "absolute",
  whiteSpace: "nowrap",
});

// A `<webview>` defaults to 300x150, so this sets its size until the popup
// reports one and caps how far it grows. The cap fits typical popups
// (Bitwarden's is 380px wide) and stays under Chrome's 600px on short screens.
// `display: block` avoids a line-box gap under it in the panel.
const viewStyles = css({
  blockSize: "min({spacing.150}, 80vh)",
  borderStyle: "none",
  display: "block",
  inlineSize: 100,
  maxBlockSize: "min({spacing.150}, 80vh)",
  maxInlineSize: 100,
});
