// Where this shell's chrome mounts.
//
// Domicile hands `Shell` an empty body. The shell creates its own element
// inside it because the document reports failures by appending to the body, and
// a React root on the body would erase them.

/** The id of the element the chrome renders into. */
const MOUNT_ID = "domicile-shell";

/**
 * The chrome's mount point in `root`, created on the first call.
 *
 * Must stay unstyled, especially unpositioned. `<Screen>` is absolutely
 * positioned in desktop coordinates against the initial containing block, and a
 * positioned ancestor would offset every screen (see `Screen.tsx`). It needs no
 * size, since nothing inside is in normal flow.
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
