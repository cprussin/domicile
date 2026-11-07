import type { WebViewPickerKind } from "@domicile-desktop/sdk/webview-element";
import {
  WEBVIEW_PICKER_EVENT,
  WEBVIEW_PICKER_WITHDRAWN_EVENT,
} from "@domicile-desktop/sdk/webview-element";
import { useEffect, useState } from "react";

/** A suggestion a picker offers: a `<datalist>` option or a color. */
export type PickerOption = { value: string; label: string };

/**
 * A picker a form control in the page opened, waiting on the user: a color,
 * a date or time, or a text input's `<datalist>`.
 */
export type PickerRequest = {
  kind: WebViewPickerKind;
  /** The control's value now, in the kind's format. */
  value: string;
  /** The control's `min`, `max` and `step` as written, or `""`. */
  min: string;
  max: string;
  step: string;
  options: readonly PickerOption[];
  /** The control's box in the page's CSS pixels. */
  anchor: { x: number; y: number; width: number; height: number };
  /** Pick `value`, in the kind's format. */
  choose: (value: string) => void;
  /** Keep the old value. */
  cancel: () => void;
};

/**
 * The picker the page in `view` is waiting on, if any.
 *
 * Claimed and cleared as `usePromptRequest`'s prompts are: answering or the
 * engine withdrawing it clears it, and the engine keeps the old value for one
 * whose element is gone.
 */
export const usePickerRequest = (
  view: HTMLElement | null,
): PickerRequest | undefined => {
  const [request, setRequest] = useState<PickerRequest | undefined>(undefined);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      const cleared = () => {
        setRequest(undefined);
      };
      const asked = (event: DomicilePickerEvent) => {
        event.preventDefault();
        setRequest({
          anchor: {
            height: event.anchorHeight,
            width: event.anchorWidth,
            x: event.anchorX,
            y: event.anchorY,
          },
          cancel: () => {
            cleared();
            event.cancel();
          },
          choose: (value) => {
            cleared();
            event.choose(value);
          },
          kind: event.kind,
          max: event.max,
          min: event.min,
          options: event.options.map((value, index) => ({
            label: event.labels[index] ?? "",
            value,
          })),
          step: event.step,
          value: event.value,
        });
      };
      view.addEventListener(WEBVIEW_PICKER_EVENT, asked);
      view.addEventListener(WEBVIEW_PICKER_WITHDRAWN_EVENT, cleared);
      return () => {
        view.removeEventListener(WEBVIEW_PICKER_EVENT, asked);
        view.removeEventListener(WEBVIEW_PICKER_WITHDRAWN_EVENT, cleared);
      };
    }
  }, [view]);

  return request;
};
