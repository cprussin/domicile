// The clipboard's history, which the compositor keeps.

import type { DomicileClipboardEntry, DomicileHost } from "../domicile-host";
import { defined } from "./defined";
import { memoizeLast } from "./memoize-last";
import type { On } from "./subscribe";
import { hostEvent, on } from "./subscribe";

/** One copy: an id and enough of it to recognize. */
export type ClipboardEntry = { readonly id: number; readonly preview: string };

export type ClipboardListeners = {
  change: () => void;
};

export type Clipboard = {
  /** Newest first; `undefined` until the compositor says. */
  readonly entries: readonly ClipboardEntry[] | undefined;
  /** Put entry `id` back on the clipboard. An id since dropped sets nothing. */
  copy: (id: number) => void;
  on: On<ClipboardListeners>;
};

export type ClipboardHost = Pick<
  DomicileHost,
  | "addEventListener"
  | "clipboard"
  | "copyClipboardEntry"
  | "removeEventListener"
>;

export const clipboard = (host: ClipboardHost): Clipboard => {
  const entriesOf = memoizeLast(
    (list: readonly DomicileClipboardEntry[] | null) => list?.map(defined),
  );
  return {
    copy: (id) => {
      host.copyClipboardEntry(id);
    },
    get entries() {
      return entriesOf(host.clipboard);
    },
    on: on<ClipboardListeners>({
      change: (listener) =>
        hostEvent(host, "clipboardchanged", () => listener()),
    }),
  };
};
