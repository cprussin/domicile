// What `Keyboard.switchShortcutsInhibitor` does to the shortcuts inhibitor of
// the window with the keyboard. See docs/architecture/KEYBINDINGS.md.

/** Turn the inhibitor on, off, or to whichever it is not. */
export enum InhibitorAction {
  Activate,
  Deactivate,
  Toggle,
}

/** An action as the compositor names it. */
export const wireInhibitorAction = (action: InhibitorAction): string => {
  switch (action) {
    case InhibitorAction.Activate:
      return "activate";
    case InhibitorAction.Deactivate:
      return "deactivate";
    case InhibitorAction.Toggle:
      return "toggle";
  }
};
