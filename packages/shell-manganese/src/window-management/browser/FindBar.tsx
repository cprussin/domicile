import { Button } from "@domicile/component-library/Button";
import { Input } from "@domicile/component-library/Input";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretUpIcon } from "@phosphor-icons/react/dist/ssr/CaretUp";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { KeyboardEvent, Ref } from "react";
import { useState } from "react";

import { css } from "../../../styled-system/css";
import { hstack } from "../../../styled-system/patterns";
import type { FindResult } from "../useFindResult";

/** What the box is called, and what the bar around it is. */
const NAME = "Find in page";

type Props = {
  /** What the find has found so far — the browser's count. */
  found: FindResult;
  /** End the find. */
  onClose: () => void;
  /**
   * Find `text` in the page: the next match, or the one before when
   * `backward`. `""` is the box emptied, which ends the find.
   */
  onFind: (text: string, backward: boolean) => void;
  /**
   * The box, which is where the window's keyboard goes while the bar is up —
   * see `BrowserWindow`.
   */
  ref?: Ref<HTMLInputElement> | undefined;
};

/**
 * A browser window's find bar, over the top of its page.
 *
 * Chrome's, because it is the one the user knows: it finds as the user types,
 * Enter steps to the next match and Shift+Enter to the one before, and Escape
 * puts it away. The count is the browser's — every frame in the page, a
 * cross-site one included — so it is read rather than worked out here.
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
        // Not the box's own: a search box empties itself on Escape, which
        // would be a find ended and started over on the way to being closed.
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

// Over the page's top inline-end corner, where Chrome puts its own, and drawn
// the way the zoom indicator hanging from the address bar is: a card lifted
// off the page rather than a strip of the chrome.
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

// Figures that do not change width, so the box does not shift as the count
// settles a frame at a time.
const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
});
