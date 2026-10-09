import type { DomicileBrowserWindow } from "@domicile-desktop/sdk/domicile-host";
import type { FrozenDesk, ShotRect } from "@domicile-desktop/sdk/portal";

/** A browser window a page draws, where it is on a frozen desk's frame. */
export type ShotBrowserWindow = { title: string; area: ShotRect };

/**
 * The browser windows `views` draw, where they are on `desk`'s frame. The
 * compositor sees only `<app>` windows, so the page places these itself.
 *
 * A view's box is in the page's CSS pixels, which are the desk's logical
 * pixels. It is clipped to the desk, and left out when off it, as one on a
 * hidden workspace is.
 */
export const browserWindowsOn = (
  desk: FrozenDesk,
  listed: readonly DomicileBrowserWindow[],
  views: Iterable<Element>,
): ShotBrowserWindow[] =>
  [...views].flatMap((view) => {
    const shown = listed.find(({ id }) => id === view.getAttribute("window"));
    const area = onFrame(desk, view.getBoundingClientRect());
    return shown === undefined || area === undefined
      ? []
      : [{ area, title: shown.title }];
  });

/** `box`, in logical pixels, in `desk`'s frame pixels; `undefined` off it. */
const onFrame = (desk: FrozenDesk, box: DOMRect): ShotRect | undefined => {
  const [deskX, deskY] = desk.desk.position;
  const [deskWidth, deskHeight] = desk.desk.size;
  const left = Math.max(box.left, deskX) - deskX;
  const top = Math.max(box.top, deskY) - deskY;
  const right = Math.min(box.right, deskX + deskWidth) - deskX;
  const bottom = Math.min(box.bottom, deskY + deskHeight) - deskY;
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
 * rounds its windows.
 */
const pixels = (desk: FrozenDesk, logical: number): number =>
  Math.round((logical * desk.width) / desk.desk.size[0]);
