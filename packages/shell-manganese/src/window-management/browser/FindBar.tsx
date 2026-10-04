import { Button } from "@domicile-desktop/component-library/Button";
import { Input } from "@domicile-desktop/component-library/Input";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/dist/ssr/CaretUp";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { KeyboardEvent, Ref } from "react";
import { useState } from "react";

import { css } from "../../../styled-system/css";
import { hstack } from "../../../styled-system/patterns";
import type { FindResult } from "../useFindResult";

/** The accessible name of the bar and its box. */
const NAME = "Find in page";

type Props = {
  /** The browser's match count. */
  found: FindResult;
  /** Ends the find. */
  onClose: () => void;
  /**
   * Finds the next match of `text`, or the previous one when `backward`.
   * `""` ends the find.
   */
  onFind: (text: string, backward: boolean) => void;
  /**
   * The search box, which takes the window's keyboard focus while the bar is
   * open. See `BrowserWindow`.
   */
  ref?: Ref<HTMLInputElement> | undefined;
};

/**
 * A browser window's find bar, drawn over its page.
 *
 * Behaves like Chrome's: finds as you type, Enter and Shift+Enter step through
 * matches, Escape closes. The count comes from the browser, since it covers
 * cross-site frames.
 */
export const FindBar = ({ found, onClose, onFind, ref }: Props) => {
  const [text, setText] = useState("");
  const nothingToStep = found.matches === 0;

  const pressed = (event: KeyboardEvent) => {
    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        if (text !== "") {
          onFind(text, event.shiftKey);
        }
        break;
      }
      case "Escape": {
        // Stops the search input's default clear-on-Escape, which would end
        // and restart the find before closing.
        event.preventDefault();
        onClose();
        break;
      }
      default: {
        break;
      }
    }
  };

  return (
    <search aria-label={NAME} className={barStyles}>
      <Input
        aria-label={NAME}
        onChange={(event) => {
          setText(event.target.value);
          onFind(event.target.value, false);
        }}
        onKeyDown={pressed}
        ref={ref}
        rounded
        size="sm"
        spellCheck={false}
        suffixIcon={
          text === "" ? undefined : (
            <span className={countStyles}>
              {`${found.activeMatch.toString()}/${found.matches.toString()}`}
            </span>
          )
        }
        type="search"
        value={text}
      />
      <Button
        disabled={nothingToStep}
        label="Previous match"
        onClick={() => {
          onFind(text, true);
        }}
        rounded
        size="sm"
        variant="ghost"
      >
        <CaretUpIcon size={16} />
      </Button>
      <Button
        disabled={nothingToStep}
        label="Next match"
        onClick={() => {
          onFind(text, false);
        }}
        rounded
        size="sm"
        variant="ghost"
      >
        <CaretDownIcon size={16} />
      </Button>
      <Button
        label="Close find bar"
        onClick={onClose}
        rounded
        size="sm"
        variant="ghost"
      >
        <XIcon size={16} />
      </Button>
    </search>
  );
};

// In the page's top inline-end corner, as in Chrome, styled like the zoom
// indicator.
const barStyles = hstack({
  backgroundColor: "card",
  border: "1px solid {colors.border}",
  borderRadius: "lg",
  boxShadow: "lifted",
  gap: 1,
  insetBlockStart: 2,
  insetInlineEnd: 4,
  padding: 1.5,
  position: "absolute",
});

// Fixed-width digits, so the bar does not shift as the count updates.
const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});
