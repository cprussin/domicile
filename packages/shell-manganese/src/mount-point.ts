// Where this shell's chrome mounts.
//
// Domicile writes the document, and what it writes is a charset, a viewport, a
// body with no margin and the script tag that loads this module. There is no
// element to look up, so the shell makes one — which is the shape every shell
// in this position needs: `docs/WRITING-A-SHELL.md` says Domicile writes the
// document and the shell brings everything else.
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
