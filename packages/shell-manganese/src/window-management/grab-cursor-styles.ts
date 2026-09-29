// The class for each cursor a grab sheet shows — see `useGrabCursor`.

import { css } from "../../styled-system/css";
import { GrabCursor } from "./useGrabCursor";

export const grabCursorStyles: Record<GrabCursor, string> = {
  [GrabCursor.Move]: css({ cursor: "move" }),
  [GrabCursor.ResizeEw]: css({ cursor: "ew-resize" }),
  [GrabCursor.ResizeNesw]: css({ cursor: "nesw-resize" }),
  [GrabCursor.ResizeNs]: css({ cursor: "ns-resize" }),
  [GrabCursor.ResizeNwse]: css({ cursor: "nwse-resize" }),
};
