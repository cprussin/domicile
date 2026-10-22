import type { FrozenDesk, ShotRect } from "@domicile-desktop/sdk/portal";
import type { PageBox } from "./shown-windows";

/**
 * `box`, in the page's CSS pixels, which are the desk's logical pixels, in
 * `desk`'s frame pixels. Clipped to the desk; `undefined` off it.
 */
export const onFrame = (
  desk: FrozenDesk,
  box: PageBox,
): ShotRect | undefined => {
  const [deskX, deskY] = desk.desk.position;
  const [deskWidth, deskHeight] = desk.desk.size;
  const left = Math.max(box.x, deskX) - deskX;
  const top = Math.max(box.y, deskY) - deskY;
  const right = Math.min(box.x + box.width, deskX + deskWidth) - deskX;
  const bottom = Math.min(box.y + box.height, deskY + deskHeight) - deskY;
  const area = {
    height: pixels(desk, bottom) - pixels(desk, top),
    width: pixels(desk, right) - pixels(desk, left),
    x: pixels(desk, left),
    y: pixels(desk, top),
  };
  return area.width > 0 && area.height > 0 ? area : undefined;
};

/**
 * The frame pixel `logical` pixels into `desk`, rounded as the compositor
 * rounds its monitors.
 */
const pixels = (desk: FrozenDesk, logical: number): number =>
  Math.round((logical * desk.width) / desk.desk.size[0]);

/**
 * `area` of `desk`'s frame on the desktop, in its logical pixels: the
 * inverse of `onFrame`. Grown to whole pixels, so it covers all of `area`.
 */
export const onDesk = (
  desk: FrozenDesk,
  area: ShotRect,
): { position: [number, number]; size: [number, number] } => {
  const [deskX, deskY] = desk.desk.position;
  const left = Math.floor(deskX + logical(desk, area.x));
  const top = Math.floor(deskY + logical(desk, area.y));
  const right = Math.ceil(deskX + logical(desk, area.x + area.width));
  const bottom = Math.ceil(deskY + logical(desk, area.y + area.height));
  return { position: [left, top], size: [right - left, bottom - top] };
};

/** The logical pixels `frame` pixels into `desk`. */
const logical = (desk: FrozenDesk, frame: number): number =>
  (frame * desk.desk.size[0]) / desk.width;
