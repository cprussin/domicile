import type { Result } from "@cprussin/option-result";
import type { DomicileHost } from "@domicile-desktop/sdk/domicile-host";

import type { GoogleClient } from "./consent";
import { consentAddress, redirectCode } from "./consent";
import { exchangeCode } from "./google-token";
import { storeToken } from "./stored-token";

type Desk = Pick<
  DomicileHost,
  | "addEventListener"
  | "browserWindows"
  | "closeBrowserWindow"
  | "fetchWithCookies"
  | "openBrowserWindow"
  | "removeEventListener"
>;

/**
 * Signs the account in: opens Google's consent page in a browser window,
 * reads the code from the window's address once Google redirects it, closes
 * the window, and stores the refresh token the code gets.
 *
 * Rejects when Google refuses the consent or the code. A consent window the
 * user closes leaves the sign-in waiting.
 */
export const signIn = async (
  domicile: Desk,
  client: GoogleClient,
  email: string,
  storage?: Parameters<typeof storeToken>[2],
  state: string = randomState(),
): Promise<void> => {
  const code = await new Promise<Result<string, string>>((resolve) => {
    const windowsChanged = () => {
      for (const window of domicile.browserWindows ?? []) {
        redirectCode(window.url, state).match({
          None: () => undefined,
          Some: (redirected) => {
            domicile.removeEventListener(
              "browserwindowschanged",
              windowsChanged,
            );
            domicile.closeBrowserWindow(window.id);
            resolve(redirected);
          },
        });
      }
    };
    domicile.addEventListener("browserwindowschanged", windowsChanged);
    domicile.openBrowserWindow(consentAddress(client, email, state));
  });
  const refreshToken = await code.match({
    Err: (why) => {
      throw new Error(`Google refused the sign-in: ${why}`);
    },
    Ok: (granted) => exchangeCode(domicile, client, granted),
  });
  refreshToken.match({
    Err: (why) => {
      throw new Error(why);
    },
    Ok: (token) => {
      storeToken(email, token, storage);
    },
  });
};

/** A sign-in's own state, so a redirect is matched to its sign-in. */
const randomState = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
