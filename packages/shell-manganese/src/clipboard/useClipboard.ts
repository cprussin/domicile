import type {
  DomicileClipboardEntry,
  DomicileHost,
} from "@domicile-desktop/sdk/domicile-host";
import { useEffect, useState } from "react";

import { watchHost } from "../host/watch-host";

/**
 * The clipboard history, newest first.
 *
 * Pushed by the compositor, which sees every `wl_data_device.set_selection`,
 * so there is nothing to request. `navigator.clipboard` is no substitute: it
 * gives only the current entry, behind a permission prompt.
 *
 * The list starts empty, which is also the normal state after startup since
 * the history is kept only in memory.
 */
export const useClipboard = (
  domicile: DomicileHost,
): readonly DomicileClipboardEntry[] => {
  const [entries, setEntries] = useState<readonly DomicileClipboardEntry[]>([]);

  useEffect(
    () => watchHost(domicile, "clipboardchanged", entriesOf, setEntries),
    [domicile],
  );

  return entries;
};

const entriesOf = ({
  clipboard,
}: DomicileHost): readonly DomicileClipboardEntry[] | undefined =>
  clipboard ?? undefined;
