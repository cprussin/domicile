import type { Suggestion } from "@domicile-desktop/component-library/Autocomplete";
import { Autocomplete } from "@domicile-desktop/component-library/Autocomplete";
import { Button } from "@domicile-desktop/component-library/Button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { MinusIcon } from "@phosphor-icons/react/dist/ssr/Minus";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { FormEvent } from "react";
import { useState } from "react";

import { css } from "../../../styled-system/css";
import { hstack } from "../../../styled-system/patterns";
import type { AddressSuggestion } from "../../address/address-suggestions";
import {
  AddressSuggestionKind,
  addressSuggestions,
} from "../../address/address-suggestions";
import type { ConnectionSafety } from "../../address/connection-safety";
import { typedAddress } from "../../address/typed-address";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { ZoomIndicator } from "./ZoomIndicator";
import {
  isFullyZoomedIn,
  isFullyZoomedOut,
  isUnzoomed,
  zoomPercent,
} from "./zoom-steps";

type Props = {
  /**
   * The address shown while the user is not typing: the current page, or the
   * pending one.
   *
   * Must come from the same report as `security` (see `useShownPage`), or the
   * lock could describe a different page, which enables address-bar spoofing.
   */
  address: string;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Whether a page is loading, which turns Reload into Stop. */
  loading: boolean;
  onBack: () => void;
  onForward: () => void;
  /** Loads `url`, already resolved from what was typed. */
  onNavigate: (url: string) => void;
  onReload: () => void;
  onStop: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  /** The browser's security state for {@link Props.address}. */
  security: ConnectionSafety;
  /** Visited addresses, oldest first. */
  visited: readonly string[];
  /** The page zoom factor; 1 is 100%. */
  zoom: number;
  /**
   * How many times the user has zoomed. Each change re-shows the zoom
   * indicator; 0 shows none.
   */
  zoomsAnnounced: number;
};

/**
 * A browser window's toolbar: history controls, address field and zoom.
 *
 * Follows Chromium's layout, which users already know.
 */
export const AddressBar = ({
  address,
  canGoBack,
  canGoForward,
  loading,
  onBack,
  onForward,
  onNavigate,
  onReload,
  onStop,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  security,
  visited,
  zoom,
  zoomsAnnounced,
}: Props) => {
  // Typing is discarded when the address changes. Reset during render, not in
  // an effect, to avoid a frame showing stale text over the new page.
  const [edit, setEdit] = useState({ address, typed: address });
  if (edit.address !== address) {
    setEdit({ address, typed: address });
  }
  const typed = edit.address === address ? edit.typed : address;

  const type = (next: string) => {
    setEdit({ address, typed: next });
  };

  // Enter on an empty line does nothing, as in other browsers.
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const action = typedAddress(typed);
    if (action !== undefined) {
      onNavigate(action.url);
    }
  };

  return (
    <form className={barStyles} onSubmit={submit}>
      <div className={historyStyles}>
        <Button
          disabled={!canGoBack}
          label="Back"
          onClick={onBack}
          rounded
          size="sm"
          variant="ghost"
        >
          <CaretLeftIcon size={16} />
        </Button>
        <Button
          disabled={!canGoForward}
          label="Forward"
          onClick={onForward}
          rounded
          size="sm"
          variant="ghost"
        >
          <CaretRightIcon size={16} />
        </Button>
        {/* One button for Reload and Stop, since only one applies at a time.
            It is also the only loading indicator, as in other browsers. */}
        <Button
          label={loading ? "Stop" : "Reload"}
          onClick={loading ? onStop : onReload}
          rounded
          size="sm"
          variant="ghost"
        >
          {loading ? <XIcon size={16} /> : <ArrowClockwiseIcon size={16} />}
        </Button>
      </div>
      <Autocomplete
        aria-label="Address"
        autoComplete="off"
        // Highlights the first suggestion, which is what the typed text would
        // do (see `addressSuggestions`), so Enter takes it and the field
        // completes inline.
        //
        // Off for an empty line, where the list is only history: Enter then
        // reaches the form, which ignores it.
        autoHighlight={typed.trim() !== ""}
        onSuggestionTaken={onNavigate}
        onValueChange={type}
        prefixButtons={
          <ConnectionIndicator security={security} url={address} />
        }
        rounded
        size="sm"
        spellCheck={false}
        suggestions={suggestionsFor(typed, visited)}
        value={typed}
      />
      {/* At the inline end, as in Chrome. Styled as a capsule like the
          address field, so the bar reads as two pills. */}
      <div aria-label="Zoom" className={zoomStyles} role="group">
        <Button
          disabled={isFullyZoomedOut(zoom)}
          label="Zoom out"
          onClick={onZoomOut}
          rounded
          size="xs"
          variant="ghost"
        >
          <MinusIcon size={12} weight="bold" />
        </Button>
        <span aria-hidden className={dividerStyles} />
        {/* The zoom level; pressing it resets to 100%. Fixed width so the
            bar does not shift as the number changes. */}
        <span className={readoutStyles}>
          <Button
            disabled={isUnzoomed(zoom)}
            onClick={onZoomReset}
            rounded
            size="xs"
            title="Reset zoom"
            variant="ghost"
          >
            {zoomPercent(zoom)}
          </Button>
        </span>
        <span aria-hidden className={dividerStyles} />
        <Button
          disabled={isFullyZoomedIn(zoom)}
          label="Zoom in"
          onClick={onZoomIn}
          rounded
          size="xs"
          variant="ghost"
        >
          <PlusIcon size={12} weight="bold" />
        </Button>
      </div>
      {zoomsAnnounced === 0 ? undefined : (
        <ZoomIndicator key={zoomsAnnounced} zoom={zoom} />
      )}
    </form>
  );
};

/** The suggestion list for the typed text. */
const suggestionsFor = (
  typed: string,
  visited: readonly string[],
): readonly Suggestion<string>[] =>
  addressSuggestions(typed, visited).map(lineFor);

/**
 * One suggestion as a list line.
 *
 * `text` fills the field when the line is highlighted. For a search it is the
 * query, not the search URL, so the user can keep editing their words.
 */
const lineFor = (suggestion: AddressSuggestion): Suggestion<string> => {
  switch (suggestion.kind) {
    case AddressSuggestionKind.Search: {
      return {
        description: "Search",
        icon: <MagnifyingGlassIcon size={14} />,
        label: suggestion.query,
        text: suggestion.query,
        value: suggestion.url,
      };
    }
    case AddressSuggestionKind.Site: {
      return {
        description: "Open",
        icon: <GlobeSimpleIcon size={14} />,
        label: suggestion.url,
        text: suggestion.url,
        value: suggestion.url,
      };
    }
    case AddressSuggestionKind.Visited: {
      return {
        description: "Visited",
        icon: <ClockCounterClockwiseIcon size={14} />,
        label: suggestion.url,
        text: suggestion.url,
        value: suggestion.url,
      };
    }
  }
};

// A slightly different background, so the bar reads as chrome, not page.
const barStyles = hstack({
  backgroundColor:
    "color-mix(in oklab, {colors.card} 88%, {colors.background})",
  borderBlockEnd: "1px solid {colors.border}",
  flex: "none",
  gap: 2,
  paddingBlock: 1.5,
  paddingInline: 2,
  // Anchors the zoom indicator.
  position: "relative",
});

// Tighter than the bar's gap, so the three buttons read as one group.
const historyStyles = hstack({
  flex: "none",
  gap: 0.5,
});

// Matches the address field's height, border and background. The buttons
// are a size smaller so they sit inside the capsule's edge.
const zoomStyles = hstack({
  backgroundColor: "background",
  blockSize: 6,
  border: "1px solid {colors.border}",
  borderRadius: "full",
  flex: "none",
  gap: 1,
  paddingInline: 0.5,
});

// Fits the widest value, 500%, with fixed-width digits.
const readoutStyles = css({
  display: "inline-flex",
  fontVariantNumeric: "tabular-nums",
  justifyContent: "center",
  minInlineSize: 14,
});

const dividerStyles = css({
  backgroundColor: "border",
  blockSize: 3,
  flex: "none",
  inlineSize: "1px",
});
