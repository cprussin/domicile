import { Button } from "@domicile-desktop/component-library/Button";
import { Input } from "@domicile-desktop/component-library/Input";
import type { KeyboardEvent, RefCallback } from "react";
import { useId, useState } from "react";

import { css } from "../styled-system/css";
import { center, flex } from "../styled-system/patterns";
import type { DialogRequest } from "./useDialogRequest";

type Props = {
  /**
   * Who asks, as the user knows it, such as an extension's name. Defaults to
   * the calling site's host.
   */
  asker?: string | undefined;
  /** Gets the element to focus: a prompt's field, or else OK. */
  ref?: RefCallback<HTMLElement> | undefined;
  request: DialogRequest;
};

/**
 * A page's `alert()`, `confirm()`, `prompt()` or `beforeunload`, over the page
 * it pauses.
 *
 * Covers only its page, as Chrome's tab-modal dialogs do: the rest of the
 * desktop stays usable. Styled as the library's `ModalDialog` popup. Enter is
 * OK and Escape is Cancel.
 *
 * Takes no focus itself: the caller focuses `ref`'s element as its own focus
 * rules allow.
 */
export const PageDialog = ({ asker, ref, request }: Props) => {
  const titleId = useId();
  const messageId = useId();
  const [value, setValue] = useState(request.defaultValue);
  const words = wordsFor(request, asker ?? hostOf(request.origin));
  return (
    <div className={scrimStyles}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Escape cancels the dialog wherever focus is in it, as base-ui's dialogs do */}
      <form
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        className={popupStyles}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.preventDefault();
            request.dismiss();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          request.accept(request.type === "prompt" ? value : undefined);
        }}
        role="alertdialog"
      >
        <h2 className={titleStyles} id={titleId}>
          {words.title}
        </h2>
        <p className={messageStyles} id={messageId}>
          {words.message}
        </p>
        {request.type === "prompt" && (
          <Input
            aria-labelledby={messageId}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            ref={ref}
            value={value}
          />
        )}
        <footer className={footerStyles}>
          {request.type !== "alert" && (
            <Button onClick={request.dismiss} variant="outline">
              Cancel
            </Button>
          )}
          <Button
            ref={request.type === "prompt" ? undefined : ref}
            type="submit"
            variant="accent"
          >
            {words.accept}
          </Button>
        </footer>
      </form>
    </div>
  );
};

/**
 * The dialog's title, text and OK button. A `beforeunload` has Chrome's words,
 * since Chrome shows no text from the page.
 */
const wordsFor = (
  request: DialogRequest,
  name: string | undefined,
): { accept: string; message: string; title: string } => {
  if (request.type === "beforeunload") {
    return {
      accept: "Leave",
      message: "Changes you made may not be saved.",
      title: "Leave site?",
    };
  } else {
    return {
      accept: "OK",
      message: request.message,
      title: name === undefined ? "This page says" : `${name} says`,
    };
  }
};

/**
 * The host of `origin`, or nothing for a frame with no site (`null`).
 *
 * Uses `URL.parse`, which does not throw, for `ConnectionIndicator`'s reason.
 */
const hostOf = (origin: string): string | undefined => {
  const parsed = URL.parse(origin);
  return parsed === null || parsed.host === "" ? undefined : parsed.host;
};

// Dims the page it pauses, as `ModalDialog`'s backdrop dims the screen.
const scrimStyles = center({
  _starting: { opacity: 0 },
  alignItems: "flex-start",
  backgroundColor: "backdrop",
  inset: 0,
  opacity: 1,
  paddingBlockStart: 10,
  paddingInline: 4,
  position: "absolute",
  transition: "opacity {durations.normal} {easings.out}",
});

// `ModalDialog`'s popup, at the top of the page as Chrome places these.
const popupStyles = flex({
  _starting: {
    opacity: 0,
    transform: "translateY({spacing.3}) scale(0.96)",
  },
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  boxShadow: "modal",
  direction: "column",
  gap: 4,
  inlineSize: "min({spacing.120}, 100%)",
  opacity: 1,
  outlineStyle: "none",
  padding: 5,
  transform: "translateY(0) scale(1)",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.normal} {easings.out}",
});

const titleStyles = css({
  color: "foreground",
  fontSize: "md",
  fontWeight: "semibold",
  lineHeight: "snug",
  margin: 0,
  overflowWrap: "anywhere",
});

// A page's message keeps its line breaks; a long one scrolls.
const messageStyles = css({
  color: "foreground",
  fontSize: "sm",
  margin: 0,
  maxBlockSize: 80,
  overflowWrap: "anywhere",
  overflowY: "auto",
  whiteSpace: "pre-wrap",
});

const footerStyles = flex({
  gap: 2,
  justifyContent: "flex-end",
});
