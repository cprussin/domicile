// A browser window's site permissions, parsed from the `<webview>`.
//
// The engine stores the settings and reports them; this module only parses
// them. See `WEBVIEW_PERMISSIONS` in `@domicile-desktop/sdk/webview-element`.

import type {
  WebViewPermission,
  WebViewPermissionSetting,
} from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_PERMISSION_SETTINGS,
  WEBVIEW_PERMISSIONS,
} from "@domicile-desktop/sdk/webview-element";
import { z } from "zod";

/** One permission's stored setting for the page's site. */
export type SitePermission = {
  permission: WebViewPermission;
  setting: WebViewPermissionSetting;
};

/**
 * Parses `view.sitePermissions()`, in {@link WEBVIEW_PERMISSIONS}' order.
 *
 * Leaves out a permission this shell does not know, which a newer engine may
 * report: the shell cannot name it. Throws for an unknown setting.
 */
export const sitePermissionsOf = (
  reported: Readonly<Record<string, string>>,
): readonly SitePermission[] =>
  WEBVIEW_PERMISSIONS.flatMap((permission) => {
    const setting = reported[permission];
    return setting === undefined
      ? []
      : [{ permission, setting: settingSchema.parse(setting) }];
  });

/**
 * Parses what a permission request asks for. Throws for a permission this
 * shell cannot show, since it could not ask the user about it.
 */
export const permissionsAsked = (
  reported: readonly string[],
): readonly WebViewPermission[] => permissionsSchema.parse(reported);

const settingSchema = z.enum(WEBVIEW_PERMISSION_SETTINGS);

const permissionsSchema = z.array(z.enum(WEBVIEW_PERMISSIONS));
