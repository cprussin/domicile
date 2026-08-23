// The main process's half of sizing the window to the desktop.
//
// The desktop's size arrives on the *renderer's* socket, because the renderer
// is what holds the connection to the compositor — and the window is this
// process's. So the page asks, over `CHROME_DESKTOP_SIZE_CHANNEL`, and this is
// what answers. See `desktop-size` for why the two have to agree.

import { CHROME_DESKTOP_SIZE_CHANNEL } from "./desktop-size-channel";

/** The window being sized, and the page whose asks count as its own. */
type Window = {
  /**
   * The *content* size: the window's frame is furniture around the desktop
   * rather than part of it, and the page's coordinates are the content's.
   */
  setContentSize: (width: number, height: number) => void;
  webContents: {
    once: (event: "destroyed", listener: () => void) => void;
  };
};

/** A page asking for a size, and the page it came from. */
type Ask = (event: { sender: unknown }, width: number, height: number) => void;

/**
 * The main process's IPC. It is the whole process's rather than one window's,
 * which is why an ask carries its sender and why the listener comes back off
 * again.
 */
type Ipc = {
  off: (channel: string, listener: Ask) => void;
  on: (channel: string, listener: Ask) => void;
};

/**
 * Size the window to the desktop, except where Domicile is compositing it.
 *
 * That is the one case where the size is not ours to set: the compositor gives
 * that window the whole output whatever is asked for, so a `setContentSize`
 * would be a request fighting a configure it always loses to. The page asks
 * either way — it holds the socket the desktop is described over, and cannot
 * tell the two paths apart — so this is where the difference is known.
 *
 * @param composited - Whether Domicile is drawing this window's clients itself.
 */
export const sizeToDesktopUnlessComposited = (
  composited: boolean,
  window: Window,
  ipc: Ipc,
): void => {
  if (!composited) {
    sizeToDesktop(window, ipc);
  }
};

/**
 * Resize `window` whenever its own page says how big the desktop is — the half
 * of {@link sizeToDesktopUnlessComposited} that runs when the size is ours.
 *
 * `ipcMain` is the whole process's, so the sizes another window asked for are
 * on this channel too — they are that window's wiring's, and this one takes
 * only its own page's and gives the listener back when that page is gone.
 * Otherwise a second window would resize the first, and every window that
 * ever existed would keep being resized by the next one.
 */
const sizeToDesktop = (window: Window, ipc: Ipc): void => {
  const asked: Ask = (event, width, height) => {
    if (event.sender === window.webContents) {
      window.setContentSize(width, height);
    }
  };
  ipc.on(CHROME_DESKTOP_SIZE_CHANNEL, asked);
  window.webContents.once("destroyed", () => {
    ipc.off(CHROME_DESKTOP_SIZE_CHANNEL, asked);
  });
};
