import type { Browser } from "@domicile-desktop/sdk/desktop/browser";
import { AppReuse } from "@domicile-desktop/sdk/desktop/browser";

import { composeAddress, gmailAppId } from "./addresses";

/** The browser {@link writeMail} opens Gmail in. */
export type WriteBrowser = Pick<Browser, "openApp">;

/**
 * Opens the account's Gmail window on its inbox with a new message, filled in
 * from the `mailto:` link `link`, from address `from`. A new window is in
 * browser profile `profile`, or its site's when `undefined`.
 */
export const writeMail = (
  browser: WriteBrowser,
  email: string,
  link: string,
  from: string,
  profile?: string,
): void => {
  browser.openApp(composeAddress(email, link, profile), {
    id: gmailAppId(email),
    reuse: AppReuse.Navigate,
    ...(profile === undefined ? {} : { profile }),
  });
  if (from !== email) {
    throw new Error(`picking ${from} as the sender is not written yet`);
  }
};
