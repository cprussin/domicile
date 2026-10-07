import { spelled } from "@domicile-desktop/sdk/own-keybindings";

/** What a trigger typed in a global shortcuts review is. */
export enum ChordCheckKind {
  /** Empty: the shortcut is left unbound. */
  Cleared,
  /** Not in the shell's chord syntax. */
  Invalid,
  /** A chord nobody else holds. */
  Free,
  /** A chord the shell, or another application, holds. */
  Taken,
}

export const ChordCheck = {
  Cleared: () => ({ kind: ChordCheckKind.Cleared as const }),
  Free: (chord: string) => ({ chord, kind: ChordCheckKind.Free as const }),
  Invalid: (message: string) => ({
    kind: ChordCheckKind.Invalid as const,
    message,
  }),
  /** `by` is the application's id, or `undefined` for the shell. */
  Taken: (chord: string, by: string | undefined) => ({
    by,
    chord,
    kind: ChordCheckKind.Taken as const,
  }),
};

export type ChordCheck = ReturnType<
  (typeof ChordCheck)[keyof typeof ChordCheck]
>;

/** Who holds a chord, by its one spelling. `undefined` is the shell. */
export type Holders = ReadonlyMap<string, string | undefined>;

/**
 * The chords `shellChords` and `taken` hold, by their one spelling. Throws on
 * a chord that does not parse: `bindKeys` refuses such a shell chord, and the
 * compositor holds only chords a review spelled.
 */
export const holders = (
  shellChords: readonly string[],
  taken: readonly { chord: string; appId: string }[],
): Holders =>
  new Map<string, string | undefined>([
    ...taken.map(({ appId, chord }) => [spelled(chord), appId] as const),
    ...shellChords.map((chord) => [spelled(chord), undefined] as const),
  ]);

/** Check `written` against the chords `held`. */
export const checkChord = (written: string, held: Holders): ChordCheck => {
  if (written === "") {
    return ChordCheck.Cleared();
  } else {
    const chord = spell(written);
    if (chord.kind !== ChordCheckKind.Free) {
      return chord;
    } else if (held.has(chord.chord)) {
      return ChordCheck.Taken(chord.chord, held.get(chord.chord));
    } else {
      return chord;
    }
  }
};

/** `written` in its one spelling, or why it is not a chord. */
const spell = (written: string): ChordCheck => {
  try {
    return ChordCheck.Free(spelled(written));
  } catch (error) {
    return ChordCheck.Invalid(
      error instanceof Error ? error.message : String(error),
    );
  }
};
