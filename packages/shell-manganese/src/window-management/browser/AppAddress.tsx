import { css } from "../../../styled-system/css";
import { hstack } from "../../../styled-system/patterns";
import type { ConnectionSafety } from "../../address/connection-safety";
import { siteOf } from "./app-origin";
import { ConnectionIndicator } from "./ConnectionIndicator";

type Props = {
  /**
   * The page's address. Must come from the same report as `security` (see
   * `useShownPage`).
   */
  address: string;
  /** The browser's security state for {@link Props.address}. */
  security: ConnectionSafety;
};

/**
 * An app window's read-only address, shown while its page is off the app's
 * origin, as Chrome does for an installed app. See
 * docs/architecture/WEB-APPS.md.
 */
export const AppAddress = ({ address, security }: Props) => (
  <div className={barStyles}>
    <ConnectionIndicator security={security} url={address} />
    <output aria-label="Address" className={siteStyles}>
      {siteOf(address)}
    </output>
  </div>
);

// The address bar's background and edge, so it reads as the same chrome.
const barStyles = hstack({
  backgroundColor:
    "color-mix(in oklab, {colors.foreground} 14%, {colors.background})",
  borderBlockEnd: "1px solid {colors.border}",
  flex: "none",
  gap: 1,
  paddingBlock: 0.5,
  paddingInline: 2,
});

const siteStyles = css({
  color: "muted",
  fontSize: "sm",
  minInlineSize: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
