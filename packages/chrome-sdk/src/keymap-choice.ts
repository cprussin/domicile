// The keymap `System.selectKeymap` switches to, and the keymaps
// `System.keymaps` hears. See docs/SHELL-CONFIG.md.

export enum KeymapChoiceKind {
  Next,
  Named,
}

/** Which of `input.keyboard`'s keymaps to switch to. */
export const KeymapChoice = {
  /** The keymap with this name. */
  Named: (name: string) => ({
    kind: KeymapChoiceKind.Named as const,
    name,
  }),
  /** The one after the active keymap, or the first after the last. */
  Next: () => ({ kind: KeymapChoiceKind.Next as const }),
};

export type KeymapChoice = ReturnType<
  (typeof KeymapChoice)[keyof typeof KeymapChoice]
>;

/** The keymaps, in the config's order, and the name of the active one. */
export type Keymaps = {
  active: string;
  keymaps: readonly ListedKeymap[];
};

/** One of the config's keymaps. */
export type ListedKeymap = {
  /**
   * xkb's name for its layouts, such as "English (programmer Dvorak)", if
   * xkb names any.
   */
  description: string | undefined;
  /** The config's name for it. */
  name: string;
};

/** A choice as the compositor reads it. */
export const wireKeymapChoice = (
  choice: KeymapChoice,
): { kind: "next" } | { kind: "named"; name: string } => {
  switch (choice.kind) {
    case KeymapChoiceKind.Next:
      return { kind: "next" };
    case KeymapChoiceKind.Named:
      return { kind: "named", name: choice.name };
  }
};
