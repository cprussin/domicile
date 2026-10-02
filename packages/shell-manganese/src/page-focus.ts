import { WEBVIEW_GUEST_FOCUS_EVENT } from "@domicile/chrome-sdk/webview-element";

/**
 * What a `Popover` here is told a click in a page is, as its
 * `outsideFocusEvents`: the `<webview>`'s own event, since the page's press and
 * the focus it takes never reach the shell's document as anything else.
 */
export const PAGE_FOCUS: readonly string[] = [WEBVIEW_GUEST_FOCUS_EVENT];
