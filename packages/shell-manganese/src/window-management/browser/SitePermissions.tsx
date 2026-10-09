import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { SelectOption } from "@domicile-desktop/component-library/Select";
import { Select } from "@domicile-desktop/component-library/Select";
import type {
  WebViewPermission,
  WebViewPermissionSetting,
} from "@domicile-desktop/sdk/webview-element";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { useState } from "react";

import { css } from "../../../styled-system/css";
import { hstack, vstack } from "../../../styled-system/patterns";
import { PermissionAsk } from "./PermissionAsk";
import { PERMISSION_ICONS, PERMISSION_LABELS } from "./permission-names";
import type { SitePermission } from "./site-permissions";
import type { PermissionRequest } from "./usePermissionRequest";

type Props = {
  /** Stores `setting` for `permission` on the page's site. */
  onSet: (
    permission: WebViewPermission,
    setting: WebViewPermissionSetting,
  ) => void;
  /** The page's site's settings; empty for a page with no site. */
  permissions: readonly SitePermission[];
  /** The request the page is waiting on, if any. Opens the panel. */
  request: PermissionRequest | undefined;
  /**
   * The page's address, for the panel's heading. Must come from the same
   * report as `permissions` (see `useShownPage`).
   */
  url: string;
};

/**
 * The site permissions button in the address bar, with a panel that answers
 * the page's permission requests and edits the site's settings.
 *
 * The engine draws no prompt, so a request opens the panel. Closing it
 * without an answer dismisses the request, as closing Chrome's prompt does.
 */
export const SitePermissions = ({
  onSet,
  permissions,
  request,
  url,
}: Props) => {
  // Whether the user opened the panel. A request opens it regardless.
  const [browsing, setBrowsing] = useState(false);

  const changeOpen = (open: boolean) => {
    if (!open && request !== undefined) {
      request.dismiss();
    }
    setBrowsing(open);
  };

  return (
    <Popover
      align="start"
      onOpenChange={changeOpen}
      open={browsing || request !== undefined}
      side="bottom"
      title={
        <span className={headingStyles}>
          <span className={hostStyles}>{hostOf(url)}</span>
          <span className={subtitleStyles}>Site permissions</span>
        </span>
      }
      trigger={
        <Button label="Site permissions" size="sm" variant="ghost">
          <SlidersHorizontalIcon size={14} />
        </Button>
      }
      wide
    >
      <div className={panelStyles}>
        {request === undefined ? undefined : (
          <PermissionAsk
            // The heading names the page's site, so only another site is
            // named again.
            asker={
              hostOf(request.origin) === hostOf(url)
                ? "This site"
                : hostOf(request.origin)
            }
            request={request}
          />
        )}
        {permissions.length === 0 ? (
          <span className={noneStyles}>This page has no site permissions.</span>
        ) : (
          <ul aria-label="Permissions" className={settingsStyles}>
            {permissions.map(({ permission, setting }) => (
              <li className={rowStyles} key={permission}>
                <span className={tileStyles} data-setting={setting}>
                  {PERMISSION_ICONS[permission]}
                </span>
                <span className={nameStyles}>
                  {PERMISSION_LABELS[permission]}
                </span>
                <span className={choiceStyles}>
                  <Select
                    aria-label={PERMISSION_LABELS[permission]}
                    onValueChange={(next) => {
                      if (next !== null && next !== setting) {
                        onSet(permission, next);
                      }
                    }}
                    options={SETTING_OPTIONS}
                    quiet
                    size="xs"
                    value={setting}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
};

const SETTING_OPTIONS: readonly SelectOption<WebViewPermissionSetting>[] = [
  { label: "Ask", value: "ask" },
  { label: "Allow", value: "allow" },
  { label: "Block", value: "block" },
];

/**
 * The host of `url`, or the address itself if it has none.
 *
 * Uses `URL.parse`, which does not throw, for `ConnectionIndicator`'s reason.
 */
const hostOf = (url: string): string => {
  const parsed = URL.parse(url);
  return parsed === null || parsed.host === "" ? url : parsed.host;
};

const headingStyles = vstack({
  alignItems: "flex-start",
  gap: 0,
});

const hostStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
  overflowWrap: "anywhere",
});

const subtitleStyles = css({
  color: "muted",
  fontSize: "xs",
  fontWeight: "normal",
});

// Wide enough that every label stays on one line and the choices line up.
const panelStyles = vstack({
  alignItems: "stretch",
  gap: 3,
  minInlineSize: 64,
});

const settingsStyles = vstack({
  alignItems: "stretch",
  gap: 1,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const rowStyles = hstack({
  gap: 2.5,
  paddingBlock: 0.5,
});

// One size for every icon, tinted by the stored setting so the list reads at
// a glance.
const tileStyles = css({
  "&[data-setting=allow]": {
    backgroundColor: "color-mix(in oklab, {colors.success} 18%, {colors.card})",
    color: "success",
  },
  "&[data-setting=block]": {
    backgroundColor: "color-mix(in oklab, {colors.danger} 18%, {colors.card})",
    color: "danger",
  },
  alignItems: "center",
  backgroundColor: "color-mix(in oklab, {colors.foreground} 8%, {colors.card})",
  blockSize: 7,
  borderRadius: "md",
  color: "muted",
  display: "inline-flex",
  flex: "none",
  inlineSize: 7,
  justifyContent: "center",
});

const nameStyles = css({
  color: "foreground",
  flex: "1",
  fontSize: "sm",
  whiteSpace: "nowrap",
});

// A fixed column, so every choice's caret lines up.
const choiceStyles = css({
  display: "flex",
  flex: "none",
  inlineSize: 16,
  justifyContent: "flex-end",
});

const noneStyles = css({
  color: "muted",
  fontSize: "sm",
  paddingBlock: 2,
  textAlign: "center",
});
