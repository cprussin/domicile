import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useContext, useRef } from "react";
import { css } from "../../styled-system/css";
import { FilePicker } from "../FilePicker/FilePicker";
import type { FileRequest } from "../FilePicker/file-request";
import { DialogOrigin } from "../ModalDialog/ModalDialog";
import { useSpringFrom } from "../ModalDialog/useSpringFrom";
import { useScreenRegion } from "../Screen/DisplayProvider";
import type { Presence } from "./presence";

type Props = {
  /** Whether it is up; see {@link Presence}. */
  presence: Presence;
  request: FileRequest;
  /** The display to cover. Without it, the whole page. */
  screen: string | undefined;
};

/**
 * A `FilePicker` over `screen`, modal like `ModalDialog`: in a portal at the
 * dialogs' depth, with the rest of the page inert. Its box takes the keyboard
 * on open. It springs from `DialogOrigin`, as `ModalDialog` does.
 *
 * The picker answers every key and press itself, Escape included, so the
 * dialog never closes on its own.
 */
export const ModalFilePicker = ({ presence, request, screen }: Props) => {
  const region = useScreenRegion(screen);
  const box = useRef<HTMLInputElement>(null);
  const origin = useContext(DialogOrigin);
  const springFrom = useSpringFrom(origin);
  return (
    <BaseDialog.Root onOpenChange={stayOpen} {...presence}>
      <BaseDialog.Portal>
        {/* The picker is the dialog; this box only places it. */}
        <BaseDialog.Popup
          className={regionStyles}
          data-origin={origin === undefined ? undefined : ""}
          initialFocus={box}
          ref={springFrom}
          role="presentation"
          style={region}
        >
          <FilePicker ref={box} request={request} />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
};

/** Ignores base-ui's requests to close; see {@link ModalFilePicker}. */
const stayOpen = () => {
  // The picker cancels through its request.
};

// At the other dialogs' depth, over every window. The picker sits in the
// middle of this box, so moving the box springs the picker from its origin.
// No transition while starting, so setting the origin jumps there.
const regionStyles = css({
  "&[data-ending-style]": {
    transition:
      "opacity {durations.fast} {easings.in}, transform {durations.springs.snappy} {easings.springs.snappy}",
  },
  "&[data-origin]:is([data-starting-style], [data-ending-style])": {
    opacity: 0,
    transform: "translate(var(--origin-x), var(--origin-y)) scale(0.5)",
  },
  "&[data-starting-style]": {
    transition: "none",
  },
  inset: 0,
  position: "fixed",
  transition:
    "opacity {durations.normal} {easings.out}, transform {durations.springs.smooth} {easings.springs.smooth}",
  zIndex: "modal",
});
