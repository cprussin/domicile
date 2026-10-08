import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { SelectOption } from "@domicile-desktop/component-library/Select";
import { Select } from "@domicile-desktop/component-library/Select";
import type {
  WebViewPermission,
  WebViewPermissionSetting,
} from "@domicile-desktop/sdk/webview-element";
import { BellIcon } from "@phosphor-icons/react/dist/ssr/Bell";
import { CameraIcon } from "@phosphor-icons/react/dist/ssr/Camera";
import { ClipboardIcon } from "@phosphor-icons/react/dist/ssr/Clipboard";
import { MapPinIcon } from "@phosphor-icons/react/dist/ssr/MapPin";
import { MicrophoneIcon } from "@phosphor-icons/react/dist/ssr/Microphone";
import { PianoKeysIcon } from "@phosphor-icons/react/dist/ssr/PianoKeys";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import type { ReactNode } from "react";
import { useState } from "react";

import { css } from "../../../styled-system/css";
import { hstack, vstack } from "../../../styled-system/patterns";
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
};

/**
 * The site permissions button in the address bar, with a panel that answers
 * the page's permission requests and edits the site's settings.
 *
 * The engine draws no prompt, so a request opens the panel. Closing it
 * without an answer dismisses the request, as closing Chrome's prompt does.
 */
export const SitePermissions = ({ onSet, permissions, request }: Props) => {
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
      title="Site permissions"
      trigger={
        <Button label="Site permissions" size="sm" variant="ghost">
          <SlidersHorizontalIcon size={14} />
        </Button>
      }
      wide
    >
      {request === undefined ? undefined : <Asking request={request} />}
      {permissions.length === 0 ? (
        <span className={noneStyles}>This page has no site permissions.</span>
      ) : (
        <div className={settingsStyles}>
          {permissions.map(({ permission, setting }) => (
            <div className={rowStyles} key={permission}>
              <span className={nameStyles}>
                {ICONS[permission]}
                {LABELS[permission]}
              </span>
              <Select
                aria-label={LABELS[permission]}
                onValueChange={(next) => {
                  if (next !== null) {
                    onSet(permission, next);
                  }
                }}
                options={SETTING_OPTIONS}
                size="sm"
                value={setting}
              />
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
};

/** The page's request: who asks, for what, and the two answers. */
const Asking = ({ request }: { request: PermissionRequest }) => (
  <div className={askingStyles}>
    <span>{hostOf(request.origin)} wants to use</span>
    <ul aria-label="Requested" className={requestedStyles}>
      {request.permissions.map((permission) => (
        <li className={nameStyles} key={permission}>
          {ICONS[permission]}
          {LABELS[permission]}
        </li>
      ))}
    </ul>
    <div className={answersStyles}>
      <Button onClick={request.deny} size="sm" variant="outline">
        Block
      </Button>
      <Button onClick={request.allow} size="sm" variant="accent">
        Allow
      </Button>
    </div>
  </div>
);

/** Each permission's name, as Chrome's site settings word it. */
const LABELS: Readonly<Record<WebViewPermission, string>> = {
  camera: "Camera",
  clipboard: "Clipboard",
  location: "Location",
  microphone: "Microphone",
  midi: "MIDI devices",
  notifications: "Notifications",
};

const ICONS: Readonly<Record<WebViewPermission, ReactNode>> = {
  camera: <CameraIcon size={14} />,
  clipboard: <ClipboardIcon size={14} />,
  location: <MapPinIcon size={14} />,
  microphone: <MicrophoneIcon size={14} />,
  midi: <PianoKeysIcon size={14} />,
  notifications: <BellIcon size={14} />,
};

const SETTING_OPTIONS: readonly SelectOption<WebViewPermissionSetting>[] = [
  { label: "Ask", value: "ask" },
  { label: "Allow", value: "allow" },
  { label: "Block", value: "block" },
];

/**
 * The host of `origin`, or the origin itself if it has none.
 *
 * Uses `URL.parse`, which does not throw, for `ConnectionIndicator`'s reason.
 */
const hostOf = (origin: string): string => {
  const parsed = URL.parse(origin);
  return parsed === null || parsed.host === "" ? origin : parsed.host;
};

const askingStyles = vstack({
  alignItems: "stretch",
  borderBlockEnd: "1px solid {colors.border}",
  gap: 2,
  paddingBlockEnd: 3,
});

const requestedStyles = vstack({
  alignItems: "stretch",
  gap: 1,
  listStyle: "none",
  margin: 0,
  padding: 0,
});

const answersStyles = hstack({
  gap: 2,
  justifyContent: "flex-end",
});

const settingsStyles = vstack({
  alignItems: "stretch",
  gap: 1.5,
});

const rowStyles = hstack({
  gap: 4,
  justifyContent: "space-between",
});

const nameStyles = hstack({
  gap: 2,
});

const noneStyles = css({
  color: "muted",
});
