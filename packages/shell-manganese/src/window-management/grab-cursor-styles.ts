// The class for each cursor a grab sheet shows — see `useGrabCursor`.

import { css } from "../../styled-system/css";
import { GrabCursor } from "./useGrabCursor";

export const grabCursorStyles: Record<GrabCursor, string> = {
  [GrabCursor.Move]: css({ cursor: "move" }),
  [GrabCursor.ResizeNesw]: css({ cursor: "nesw-resize" }),
  [GrabCursor.ResizeNwse]: css({ cursor: "nwse-resize" }),
};
