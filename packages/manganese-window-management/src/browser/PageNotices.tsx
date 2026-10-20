import { Notice } from "@domicile-desktop/component-library/Notice";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";

import { vstack } from "../../styled-system/patterns";
import { zoomPercent } from "./zoom-steps";

type Props = {
  /** How many downloads have finished since the window opened; 0 shows none. */
  downloadsFinished: number;
  /** The page zoom factor. */
  zoom: number;
  /** How many times the user has zoomed; 0 shows none. */
  zoomsAnnounced: number;
};

/**
 * Brief popovers over a page saying what just changed: its zoom, or a finished
 * download. Each count keys its notice, so each change shows it again.
 */
export const PageNotices = ({
  downloadsFinished,
  zoom,
  zoomsAnnounced,
}: Props) => (
  <div className={noticesStyles}>
    {zoomsAnnounced === 0 ? undefined : (
      <Notice icon={<MagnifyingGlassIcon size={16} />} key={zoomsAnnounced}>
        {zoomPercent(zoom)}
      </Notice>
    )}
    {downloadsFinished === 0 ? undefined : (
      <Notice icon={<DownloadSimpleIcon size={16} />} key={downloadsFinished}>
        Download finished
      </Notice>
    )}
  </div>
);

// The page's top trailing corner, under the address bar's zoom and download
// controls. Ignores the pointer so it never blocks the page.
const noticesStyles = vstack({
  alignItems: "flex-end",
  gap: 2,
  insetBlockStart: 2,
  insetInlineEnd: 2,
  pointerEvents: "none",
  position: "absolute",
});
