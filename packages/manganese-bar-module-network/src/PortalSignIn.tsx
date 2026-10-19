/// <reference types="@domicile-desktop/manganese-host/domicile-elements" />

import { ModalDialog } from "@domicile-desktop/component-library/ModalDialog";
import { css } from "../styled-system/css";

type Props = {
  /** The user closed the page before signing in. */
  onDismiss: () => void;
  /** The monitor to show it on. */
  screen: string | undefined;
  /** The captive portal's sign-in page, or `undefined` for none. */
  url: string | undefined;
};

/**
 * A captive portal's sign-in page, in a dialog over the desk. The desk closes
 * it once the portal lets it through.
 */
export const PortalSignIn = ({ onDismiss, screen, url }: Props) => (
  <ModalDialog
    onOpenChange={(open) => {
      if (!open) {
        onDismiss();
      }
    }}
    open={url !== undefined}
    screen={screen}
    size="xl"
    title="Sign in to the network"
  >
    <webview className={viewStyles} src={url} />
  </ModalDialog>
);

// A portal page is laid out for a phone or a laptop; this fits either.
const viewStyles = css({
  blockSize: "min(40rem, 70vh)",
  borderRadius: "md",
  display: "block",
  inlineSize: "full",
});
