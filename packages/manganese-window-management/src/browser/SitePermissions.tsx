import { Button } from "@domicile-desktop/component-library/Button";
import { Popover } from "@domicile-desktop/component-library/Popover";
import type { SelectOption } from "@domicile-desktop/component-library/Select";
import { Select } from "@domicile-desktop/component-library/Select";
import { PermissionAsk } from "@domicile-desktop/manganese-page-requests/PermissionAsk";
import {
  PERMISSION_ICONS,
  PERMISSION_LABELS,
} from "@domicile-desktop/manganese-page-requests/permission-names";
import type { SitePermission } from "@domicile-desktop/manganese-page-requests/site-permissions";
import type { PermissionRequest } from "@domicile-desktop/manganese-page-requests/usePermissionRequest";
import type {
  WebViewMediaDeviceKind,
  WebViewPermission,
  WebViewPermissionSetting,
} from "@domicile-desktop/sdk/webview-element";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { useCallback, useEffect, useState } from "react";
import { css } from "../../styled-system/css";
import { hstack, vstack } from "../../styled-system/patterns";
import type { MediaDeviceChoice, MediaDevices } from "./media-devices";

type Props = {
  /**
   * The cameras and microphones, to pick the one a page that names none
   * gets. Nothing from an engine without them.
   */
  devices?: MediaDeviceChoice | undefined;
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
 *
 * Under the camera and microphone, the device a page gets when it names none.
 * The choice is the profile's, so the panel lists the devices each time it
 * opens.
 */
export const SitePermissions = ({
  devices,
  onSet,
  permissions,
  request,
  url,
}: Props) => {
  // Whether the user opened the panel. A request opens it regardless.
  const [browsing, setBrowsing] = useState(false);
  const open = browsing || request !== undefined;
  const [listed, prefer] = useMediaDevices(devices, open);

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
      open={open}
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
              <li className={entryStyles} key={permission}>
                <span className={rowStyles}>
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
                </span>
                <DeviceChoice
                  devices={listed}
                  label={PERMISSION_LABELS[permission]}
                  onPrefer={prefer}
                  permission={permission}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
};

type DeviceChoiceProps = {
  devices: MediaDevices | undefined;
  label: string;
  onPrefer: (kind: WebViewMediaDeviceKind, id: string) => void;
  permission: WebViewPermission;
};

/**
 * The device `permission` grants, under its row: the first is what a page
 * that names none gets. Nothing for a permission that grants no device, or
 * with no device to pick.
 */
const DeviceChoice = ({
  devices,
  label,
  onPrefer,
  permission,
}: DeviceChoiceProps) => {
  const kind = mediaKindOf(permission);
  const listed =
    kind === undefined || devices === undefined
      ? []
      : devices[kind === "camera" ? "cameras" : "microphones"];
  const first = listed[0];
  return kind === undefined || first === undefined ? undefined : (
    <span className={deviceStyles}>
      <Select
        aria-label={`${label} device`}
        onValueChange={(id) => {
          if (id !== null && id !== first.id) {
            onPrefer(kind, id);
          }
        }}
        options={listed.map(({ id, name }) => ({ label: name, value: id }))}
        quiet
        size="xs"
        value={first.id}
      />
    </span>
  );
};

/**
 * The devices, listed each time the panel opens and after each choice, and a
 * way to prefer one. Nothing until the first listing answers.
 */
const useMediaDevices = (
  devices: MediaDeviceChoice | undefined,
  open: boolean,
): [
  MediaDevices | undefined,
  (kind: WebViewMediaDeviceKind, id: string) => void,
] => {
  const [listed, setListed] = useState<MediaDevices | undefined>(undefined);

  const reload = useCallback(() => {
    devices
      ?.list()
      .then(setListed)
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: the panel shows no devices, and this says why
        console.error("Could not list cameras and microphones", error);
      });
  }, [devices]);

  useEffect(() => {
    if (open) {
      reload();
    }
  }, [open, reload]);

  const prefer = (kind: WebViewMediaDeviceKind, id: string) => {
    devices
      ?.prefer(kind, id)
      .then(reload)
      .catch((error: unknown) => {
        // biome-ignore lint/suspicious/noConsole: the choice did not stick, and the list still shows the old one
        console.error("Could not choose the device", error);
      });
  };

  return [listed, prefer];
};

/** The kind of device `permission` grants, if it grants one. */
const mediaKindOf = (
  permission: WebViewPermission,
): WebViewMediaDeviceKind | undefined => {
  switch (permission) {
    case "camera":
    case "microphone":
      return permission;
    case "location":
    case "notifications":
    case "clipboard":
    case "midi":
      return undefined;
  }
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

const entryStyles = vstack({
  alignItems: "stretch",
  gap: 0,
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

// Under the permission's name, past its icon.
const deviceStyles = css({
  color: "muted",
  display: "flex",
  fontSize: "xs",
  minInlineSize: 0,
  paddingInlineStart: "calc({spacing.7} + {spacing.2.5})",
});

const noneStyles = css({
  color: "muted",
  fontSize: "sm",
  paddingBlock: 2,
  textAlign: "center",
});
