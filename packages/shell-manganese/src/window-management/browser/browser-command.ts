// Browser window keybindings, matching Chrome's.
//
// Matches on `key` (the character), not `code`, as Chrome does, so Ctrl+plus
// works on any layout. Desktop bindings are claimed from the compositor and
// never reach here; see `keyboard/useKeybindings.ts`.

/** A browser action triggered from the keyboard. */
export enum BrowserCommand {
  Back = "Back",
  Find = "Find",
  Forward = "Forward",
  Inspect = "Inspect",
  Reload = "Reload",
  ZoomIn = "ZoomIn",
  ZoomOut = "ZoomOut",
  ZoomReset = "ZoomReset",
}

/** The `KeyboardEvent` fields a binding reads. */
type Press = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

/**
 * The command bound to a press, if any.
 *
 * Extra modifiers make a different chord, which may be bound elsewhere, so
 * they return `undefined`.
 */
export const browserCommandFor = (press: Press): BrowserCommand | undefined => {
  if (press.altKey && !press.ctrlKey && !press.metaKey && !press.shiftKey) {
    return altCommandFor(press.key);
  } else if (press.ctrlKey && !press.altKey && !press.metaKey) {
    // Shift is ignored: Chrome accepts both `=` and `+`, `r` and `R`.
    return ctrlCommandFor(press.key);
  } else {
    return undefined;
  }
};

const altCommandFor = (key: string): BrowserCommand | undefined => {
  switch (key) {
    case "ArrowLeft": {
      return BrowserCommand.Back;
    }
    case "ArrowRight": {
      return BrowserCommand.Forward;
    }
    default: {
      return undefined;
    }
  }
};

const ctrlCommandFor = (key: string): BrowserCommand | undefined => {
  switch (key) {
    case "f":
    case "F": {
      return BrowserCommand.Find;
    }
    // Shift is the whole of it: Ctrl+I alone is a page's italic, and a
    // shifted letter arrives capital.
    case "I": {
      return BrowserCommand.Inspect;
    }
    case "r":
    case "R": {
      return BrowserCommand.Reload;
    }
    case "+":
    case "=": {
      return BrowserCommand.ZoomIn;
    }
    case "-":
    case "_": {
      return BrowserCommand.ZoomOut;
    }
    case "0": {
      return BrowserCommand.ZoomReset;
    }
    default: {
      return undefined;
    }
  }
};
