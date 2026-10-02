// The keys a browser window answers, as Chrome binds them.
//
// Matched on `key` — the character — rather than `code`, the physical key,
// because that is what Chrome's own bindings follow and what a user reads off
// the keycap: Ctrl+plus zooms in wherever the layout puts plus. The desktop's
// bindings are the config's, claimed from the compositor — see
// `keyboard/useKeybindings.ts` — and a chord claimed is never delivered here.

/** What a browser window can be told to do from the keyboard. */
export enum BrowserCommand {
  Back = "Back",
  Find = "Find",
  Forward = "Forward",
  Reload = "Reload",
  ZoomIn = "ZoomIn",
  ZoomOut = "ZoomOut",
  ZoomReset = "ZoomReset",
}

/** A key that went down, as much of a `KeyboardEvent` as a binding reads. */
type Press = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey"
>;

/**
 * The command a press is bound to, or `undefined` for one that is not a
 * browser's — which is most keys, and not a failure.
 *
 * Every other modifier has to be up: a chord with one more held is a different
 * chord, and answering it anyway would be a browser taking a key somebody
 * bound to something else.
 */
export const browserCommandFor = (press: Press): BrowserCommand | undefined => {
  if (press.altKey && !press.ctrlKey && !press.metaKey && !press.shiftKey) {
    return altCommandFor(press.key);
  } else if (press.ctrlKey && !press.altKey && !press.metaKey) {
    // Shift either way: it is what turns `=` into `+` and `r` into `R`, and
    // Chrome answers both halves of each pair.
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
