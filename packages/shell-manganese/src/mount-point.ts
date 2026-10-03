// Where this shell's chrome mounts.
//
// Domicile writes the document and hands `Shell` its body, empty. The shell
// makes its own element inside it rather than rendering into the root itself:
// the document reports a failure by appending to that root, and a React root
// that owned it would wipe the report.

/** The element the chrome is rendered into, made if it is not there yet. */
const MOUNT_ID = "domicile-shell";

/**
 * The chrome's mount point in `root`, created on the first call.
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
export const mountPoint = (root: HTMLElement): HTMLElement => {
  const existing = root.ownerDocument.getElementById(MOUNT_ID);
  if (existing !== null) {
    return existing;
  }
  const made = root.ownerDocument.createElement("div");
  made.id = MOUNT_ID;
  root.append(made);
  return made;
};
