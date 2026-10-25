// The desk's browser windows, which the browser holds and a shell draws with
// `<webview window="id">`, and fetches with the browser's cookies.

import type {
  DomicileBrowserWindow,
  DomicileFetchHeader,
  DomicileFetchResponse,
  DomicileHost,
} from "../domicile-host";
import type { Defined } from "./defined";
import { defined } from "./defined";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

export type BrowserWindow = Defined<DomicileBrowserWindow>;

export type FetchHeader = DomicileFetchHeader;
export type FetchResponse = DomicileFetchResponse;

/** A fetch with the cookies of the profile the browser windows use. */
export type FetchInit = {
  /** `GET` by default. */
  method?: "GET" | "POST";
  headers?: readonly FetchHeader[];
  /** A POST's body. */
  body?: string;
  /**
   * An https origin to send Google's `Authorization: SAPISIDHASH` header for,
   * computed from the SAPISID cookie the page never sees.
   */
  sapisidHashOrigin?: string;
};

export type BrowserListeners = {
  /** A window opened, closed or changed. */
  change: () => void;
};

export type Browser = {
  /** The desk's browser windows, oldest first; `undefined` until the browser lists them. */
  readonly windows: readonly BrowserWindow[] | undefined;
  /** Open a browser window, with storage of its own under `partition`. */
  open: (url: string, options?: { partition?: string }) => void;
  /** Open a window in the off-the-record profile. */
  openPrivate: (url: string) => void;
  /** Open an app window, with no address bar. */
  openApp: (url: string) => void;
  /** Close window `id`. Its page may ask to stay. */
  close: (id: string) => void;
  /**
   * Fetch `url` from the browser process with its cookies. Resolves whatever
   * the status; rejects with a NetworkError for a refusal or a network
   * failure.
   */
  fetch: (url: string, init?: FetchInit) => Promise<FetchResponse>;
  on: On<BrowserListeners>;
};

export type BrowserHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "browserWindows"
  | "closeBrowserWindow"
  | "fetchWithCookies"
  | "openAppWindow"
  | "openBrowserWindow"
  | "openPrivateBrowserWindow"
  | "removeEventListener"
>;

export const browser = (host: BrowserHost): Browser => {
  const windowsOf = memoizeLast(
    (list: readonly DomicileBrowserWindow[] | null) => list?.map(defined),
  );
  return {
    close: (id) => {
      host.closeBrowserWindow(id);
    },
    fetch: (
      url,
      { method = "GET", headers = [], body, sapisidHashOrigin } = {},
    ) =>
      host.fetchWithCookies(
        url,
        method,
        headers,
        body ?? null,
        sapisidHashOrigin ?? null,
      ),
    on: on<BrowserListeners>({
      change: (listener) =>
        hostEvent(host, "browserwindowschanged", () => listener()),
    }),
    open: (url, { partition = "" } = {}) => {
      host.openBrowserWindow(url, partition);
    },
    openApp: (url) => {
      host.openAppWindow(url);
    },
    openPrivate: (url) => {
      host.openPrivateBrowserWindow(url);
    },
    get windows() {
      return windowsOf(host.browserWindows);
    },
  };
};
