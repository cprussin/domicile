// Where this shell's chrome mounts.
//
// Its own file because it is the one thing the entry point does that can be
// wrong quietly. It used to be `document.getElementById("root")` and a throw,
// against an id that came from an `index.html` this shell had of its own.
// There is no second file any more — Domicile writes the document, and what it
// writes is a charset, a viewport, a body with no margin and the script tag
// that loads this module. No `#root`, so the lookup returned null on every
// launch that was not a test, the module threw before React was reached, and
// the desktop came up as a white window with the reason only in a console that
// `--app` gives nobody a way to open.
//
// So the element is made rather than found. That is the shape every shell in
// this position needs: `docs/WRITING-A-SHELL.md` says Domicile writes the
// document and the shell brings everything else, and `shell-simple` is already
// written that way — it treats `document.body` as the desktop and appends.
//
// A container of our own rather than `document.body` itself, for one reason:
// the body holds Domicile's script tag, and a React root that owns the body
// owns that too.

/** The element the chrome is rendered into, made if it is not there yet. */
const MOUNT_ID = "domicile-shell";

/**
 * The chrome's mount point in `document`, created on the first call.
 *
 * **Deliberately unstyled, and `position` is the part that matters.**
 * `<Screen>` is `position: absolute` and carries the desktop's own
 * coordinates, so it resolves against the initial containing block —
 * `Screen.tsx` is explicit that a `relative`, `absolute` or `fixed` ancestor
 * silently reinterprets every screen's position as an offset from it, which
 * looks like a desktop where every display has slid. This is that ancestor, so
 * this is the one that has to stay out of the way. It needs no size for the
 * same reason: nothing inside it is in normal flow.
 */
export const mountPoint = (document: Document): HTMLElement => {
  const existing = document.getElementById(MOUNT_ID);
  if (existing !== null) {
    return existing;
  }
  const made = document.createElement("div");
  made.id = MOUNT_ID;
  document.body.append(made);
  return made;
};
