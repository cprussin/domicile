import type { Suggestion } from "@domicile/component-library/Autocomplete";
import { Autocomplete } from "@domicile/component-library/Autocomplete";
import { Button } from "@domicile/component-library/Button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import type { FormEvent } from "react";
import { useState } from "react";

import { hstack } from "../../../styled-system/patterns";
import type { AddressSuggestion } from "../../address/address-suggestions";
import {
  AddressSuggestionKind,
  addressSuggestions,
} from "../../address/address-suggestions";
import type { ConnectionSafety } from "../../address/connection-safety";
import { typedAddress } from "../../address/typed-address";
import { ConnectionIndicator } from "./ConnectionIndicator";

type Props = {
  /**
   * The address to show when nobody is typing into the bar: where the page is,
   * or where it was sent while nothing has arrived there yet.
   *
   * IT IS THE ONE `security` DESCRIBES. The two come off one report about one
   * entry — see `useShownPage` — and a bar that showed an address from one
   * place beside a lock from another would be drawing a padlock for a page it
   * is not displaying, which is the shape of every address-bar spoof.
   */
  address: string;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Whether a page is on its way, which is what makes Reload a Stop. */
  loading: boolean;
  onBack: () => void;
  onForward: () => void;
  /** Load this address. Already a URL — the bar has decided what was typed. */
  onNavigate: (url: string) => void;
  onReload: () => void;
  onStop: () => void;
  /** The browser's verdict on the connection behind {@link Props.address}. */
  security: ConnectionSafety;
  /** Everywhere the window has been sent, oldest first. */
  visited: readonly string[];
};

/**
 * A browser window's top bar: where it has been, where it is going, and the
 * lock that says how it got there.
 *
 * The shape is Chromium's, because it is the one the user already knows —
 * history controls and a single reload/stop at the inline start, then the
 * address as a pill with its connection indicator inside it.
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
  security,
  visited,
}: Props) => {
  // The bar shows the address until the user starts typing, and goes back to
  // showing it the moment the window is sent somewhere else. Adjusted during
  // the render that brings the new address rather than from an effect, because
  // an effect paints the line the user typed over the page they are now on
  // first and corrects it after — a visible flash of the wrong address.
  const [edit, setEdit] = useState({ address, typed: address });
  if (edit.address !== address) {
    setEdit({ address, typed: address });
  }
  const typed = edit.address === address ? edit.typed : address;

  const type = (next: string) => {
    setEdit({ address, typed: next });
  };

  // ENTER ON AN EMPTY LINE IS NOT A COMMAND. Every way of answering it — a
  // search for nothing, a reload of where the window already is — is worse
  // than leaving the user where they are, which is what a browser does.
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
          // A control that would do nothing says so before it is pressed:
          // `goBack()` on a history with nothing behind it is a no-op in the
          // browser process, and a live-looking button is this window offering
          // the user something it cannot do.
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
        {/* ONE BUTTON, BECAUSE THERE IS ONLY EVER ONE THING TO DO. A page is
            either arriving or it is not: a stop that is live while a reload is
            live offers a choice that never exists, and two buttons each dead
            half the time cost the width of both. Which one it is is also the
            whole of what the bar says about loading — the same trade every
            browser makes, and the reason there is no spinner here. */}
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
        // ENTER MEANS THE FIRST LINE, and the first line is what the typed
        // text would do — see `addressSuggestions`. So Enter takes the obvious
        // thing without an arrow key first, and the field fills with it ahead
        // of the caret, which is the inline completion an address bar does.
        //
        // Off for an empty line, where the list is the places the window has
        // been rather than anything the user is halfway to: Enter on an empty
        // bar would otherwise load whichever of them happened to be first.
        // With nothing highlighted the press reaches this form instead, which
        // answers an empty line by doing nothing.
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
    </form>
  );
};

/** The lines to offer under the bar, drawn the way an address bar draws them. */
const suggestionsFor = (
  typed: string,
  visited: readonly string[],
): readonly Suggestion<string>[] =>
  addressSuggestions(typed, visited).map(lineFor);

/**
 * One suggestion as a line of the list.
 *
 * `text` is what the field fills with when the line is highlighted, and it is
 * not always the URL: highlighting a search should leave the words in the bar
 * — replacing them with `google.com/search?q=…` is the bar telling the user
 * their query has become a URL they now have to edit.
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

// A ground of its own, a shade off the window's, so the bar reads as chrome
// over the page rather than as the top of it. The line under it is the seam
// the page starts at.
const barStyles = hstack({
  backgroundColor:
    "color-mix(in oklab, {colors.card} 88%, {colors.background})",
  borderBlockEnd: "1px solid {colors.border}",
  flex: "none",
  gap: 2,
  paddingBlock: 1.5,
  paddingInline: 2,
});

// Tighter than the bar's own gap: the three of them are one group of
// controls, and reading as one is what keeps the address the thing the eye
// lands on.
const historyStyles = hstack({
  flex: "none",
  gap: 0.5,
});
