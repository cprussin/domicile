import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import type { Extension } from "@domicile/chrome-sdk/extension";
import { WEBVIEW_CLOSE_EVENT } from "@domicile/chrome-sdk/webview-element";
import { Button } from "@domicile/component-library/Button";
import { Popover } from "@domicile/component-library/Popover";
import { useEffect, useState } from "react";

import { css } from "../../styled-system/css";
import { PAGE_FOCUS } from "../page-focus";

type Props = {
  /** What every click asks, popup or not. */
  domicile: DomicileClient;
  /** The extension whose action this is, as the engine last described it. */
  extension: Extension;
  /**
   * Asked to open the popup of the extension with this id, or to close the
   * one that is open with `undefined`. The desktop decides: a popup is a panel
   * over the windows, which takes the keyboard off them — see `AppWindow`.
   */
  onOpen: (id: string | undefined) => void;
  /** The extension whose popup is open, or `undefined` when none is. */
  opened: string | undefined;
};

/**
 * An extension's action: Chrome's toolbar icon, on the bar's tray.
 *
 * **Every click is `activateExtension`**, which is Chrome's toolbar click: the
 * extension gets `activeTab` on the focused browser window. Then one with a
 * popup opens it in a panel under its icon, as a `<webview>` of the popup's
 * address — the page gets the extension API from its origin, not from the
 * view it is in. One without is `action.onClicked`, which the engine
 * dispatches.
 *
 * **The panel closes the way Chrome's does**: a press outside it, Escape, or
 * the popup's own `window.close()`, which the view says as `domicile-close`.
 * Escape is heard only while this page has the keyboard: a key pressed inside
 * the popup's page never reaches it, like every other guest's.
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
      outsideFocusEvents={PAGE_FOCUS}
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
      // Not the engine's to drag: a press and a move reorders the tray.
      draggable={false}
      src={extension.icon}
    />
    {extension.badgeText !== "" && (
      <span
        className={badgeStyles}
        // Inline because it is the extension's runtime color, which Panda
        // cannot read. `#rrggbbaa`, transparent when the extension set none.
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
 * The popup's page, in a view of its own.
 *
 * The view says `window.close()` as `domicile-close` and closes nothing
 * itself: it is this page's element, so taking it down is this page's answer.
 */
const PopupView = ({ onClose, popup }: PopupViewProps) => {
  // `null` rather than `undefined` because that is what React's ref API hands
  // a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);

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

  return <webview className={viewStyles} ref={setView} src={popup} />;
};

// What the badge is placed against.
const iconStyles = css({ display: "inline-flex", position: "relative" });

// Chrome's toolbar size for an action icon: 16px. The engine renders the PNG
// at the page's density, so this is its layout size and not its pixels.
const imageStyles = css({ blockSize: 4, inlineSize: 4 });

// Over the icon's lower corner, as Chrome draws it. White, as Chrome's default
// badge text is, and as the bar's own text is.
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

// A `<webview>` is a replaced element that is 300x150 left to itself, and an
// extension's popup has no size to give this page — Chrome sizes its bubble to
// the popup's document, which a guest does not report. So a fixed box, at the
// size popups are laid out for — Bitwarden's is 380px wide — and short of
// Chrome's 600px cap on a screen too short for it. Block, so no line box
// leaves a gap under it in the flush panel.
const viewStyles = css({
  blockSize: "min({spacing.150}, 80vh)",
  borderStyle: "none",
  display: "block",
  inlineSize: 100,
});
