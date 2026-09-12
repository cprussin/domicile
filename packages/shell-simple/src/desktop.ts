// The windows on screen: one `<app>` per client the host announced, each
// absolutely positioned at a box this module owns.
//
// This is the whole of the shell's state. There is no tab list, no stage and no
// reducer — a window is where it is, and the only things that move it are the
// cascade it opened at and a drag. What the host says about one client is
// applied to that client's element on the spot, because this shell has nowhere
// else to hold it and nothing that re-renders from what it held.

import { APP_TAG_NAME } from "@domicile/chrome-sdk/app-element";
import type { DomicileClient } from "@domicile/chrome-sdk/domicile-client";
import { focusApp } from "@domicile/chrome-sdk/focus-app";
import type {
  AppCursorMessage,
  AppResizedMessage,
} from "@domicile/chrome-sdk/host-message";

import { css } from "../styled-system/css";
import type { WindowBox } from "./window-box";
import { openingBox } from "./window-box";

/**
 * The class this shell's stylesheet hangs its placeholder off the absence of.
 *
 * The shell's rather than the SDK's, and that is the change the engine's `<app>`
 * brought: whether a window with nothing behind it yet shows a label is a
 * question about what this desktop looks like, and the element is this shell's
 * to put a class on. What the SDK used to do here it could only do because it
 * owned the element class.
 */
const HAS_SURFACE_CLASS = "has-surface";

/** A window on the desktop: the element, and where this shell has put it. */
type OpenWindow = { box: WindowBox; element: HTMLElement };

export class Desktop {
  readonly #root: HTMLElement;
  readonly #domicile: DomicileClient;
  readonly #windows = new Map<string, OpenWindow>();
  readonly #closeListeners: ((appId: string) => void)[] = [];

  /** How many windows have opened, which is where the next one cascades to. */
  #opened = 0;

  /** The stacking order handed out so far; the next raise takes one more. */
  #frontmost = 0;

  /**
   * Whether the desktop is past the catch-up a connecting chrome is given.
   *
   * Every chrome that connects is replayed every window already running — as
   * if each had just appeared — and told at the end of that who actually holds
   * the keyboard. A window replayed there is not a window the user just
   * opened, and focusing it would move the desktop's keyboard onto whichever
   * came last and broadcast that to every other chrome, throwing away an
   * answer the compositor already had. So the replayed ones are placed and
   * raised and otherwise left alone, and {@link caughtUp} — the `focus_changed`
   * that ends the replay — is what makes the next one a window someone opened.
   */
  #caughtUp = false;

  constructor(root: HTMLElement, domicile: DomicileClient) {
    this.#root = root;
    this.#domicile = domicile;
  }

  /**
   * Put a client the host has announced on the desktop, in front.
   *
   * A window this desktop already holds is left exactly as it is, because a
   * client can be announced more than once: the compositor replays every open
   * window to *every* chrome whenever any chrome shakes hands.
   *
   * Left as it is rather than merely not duplicated, and the reason is local
   * rather than borrowed. A repeat differs from the first announcement — that
   * one carries no size at all, and the replay is rebuilt from live state, so
   * it carries whatever the client has committed since — but nothing in it is
   * news to a window this desktop already holds. Both things the size does
   * below have already happened to it: it took its opening box then and owns
   * where it is from now on, and it was told what it had drawn — by the
   * announcement it opened on, or by the `app_resized` that followed its
   * first draw. So there is nothing to apply, and applying the box again
   * would undo a drag.
   *
   * Opening a second element instead would leave the *first* connected and
   * unreachable — the map holds the newer one, so every message from the host
   * goes there. The orphan still stands for the window — it embeds the same
   * surface and reports its own box as the size to configure the client at, so
   * two elements configure one client and the later one wins: a window that
   * was dragged wider snapping back to its cascade size. And it is never taken
   * down,
   * because `close` only knows the element in the map, so it outlives the
   * client.
   *
   * What is on screen depends on which way the window is drawn. Down the copy
   * path the new element is handed a frame and looks right, while the orphan
   * sits over it holding a still of the window from before the reconnect.
   * Where the compositor draws the client itself no frame is coming — the
   * hand-over skips a natively-drawn window — but the size the replay carries
   * tells the new element it has a surface anyway, so what is wrong there is
   * the size fight above rather than anything painted over the client.
   *
   * A window that opens on a desktop past its catch-up takes the keyboard with
   * it, for the same reason it opens in front: it is the one the user just
   * asked for. Nothing else would give it to them — the SDK routes keys to
   * whichever window was last clicked, and a window nobody has clicked yet is
   * not one of those — so without this Alt+Enter opens a terminal that hears
   * nothing until it is clicked, which is not a terminal anything can be
   * started from. See {@link #caughtUp} for the windows this does not apply
   * to.
   */
  open(
    appId: string,
    size: readonly [width: number, height: number] | undefined,
  ): void {
    if (!this.#windows.has(appId)) {
      const box = openingBox(this.#opened, size);
      const element = document.createElement(APP_TAG_NAME);
      element.className = windowStyles;
      applyBox(element, box);
      // The app id, the box and the stacking order all go on before the
      // element is appended: the browser draws the window where this element
      // is, and it reads its own box to say what resolution the client should
      // draw at — so an element appended bare is a window drawn at nothing,
      // behind everything, for the frame before the styles land.
      //
      // As an attribute rather than through the reflected `appId` property, so
      // this shell runs on a stock browser as well: there `<app>` is an
      // `HTMLUnknownElement` with no such property, and the assignment would be
      // a window that never names a client.
      element.setAttribute("app-id", appId);
      // A size means the client has drawn at least once, which makes this the
      // replay a reloading chrome gets rather than a window that has just
      // mapped — so the element has a surface behind it already and must not
      // paint its placeholder over one. Nothing else would tell it: the
      // hand-over the compositor does on a chrome's handshake skips a
      // natively-drawn window, so no frame arrives, and `app_resized` fires
      // only on a size that *changed*, so an idle client never sends one. The
      // label would stay over the live window until the user resized it.
      if (size !== undefined) {
        element.classList.add(HAS_SURFACE_CLASS);
      }
      this.#windows.set(appId, { box, element });
      this.#opened += 1;
      this.raise(appId);
      this.#root.append(element);
      // After the append, so a window is on the page before it is given the
      // keyboard. The compositor used to refuse a focus for a window it had
      // not been told the position of, which made this order load-bearing;
      // it knows nothing about positions now, and `Host` refuses a focus for
      // an app it does not know regardless of what this element has sent.
      if (this.#caughtUp) {
        focusApp(this.#domicile, appId);
      }
    }
  }

  /**
   * The host has said who holds the keyboard, which ends the catch-up.
   *
   * That message is the last of the replay a connecting chrome is given, and
   * it arrives whether or not anything is running — so it is the one signal
   * that always separates "these windows were already here" from "the user
   * opened this". What it *says* is not used: this shell draws nothing to show
   * which window has the keyboard, and the SDK is already told by the click or
   * the open that moved it.
   */
  caughtUp(): void {
    this.#caughtUp = true;
  }

  /** Take a window down, because its client is gone. */
  close(appId: string): void {
    this.#windowFor(appId).element.remove();
    this.#windows.delete(appId);
    for (const listener of this.#closeListeners) {
      listener(appId);
    }
  }

  /**
   * Hear which window left.
   *
   * Anything holding an app id across time — a drag in progress — is holding
   * one this desktop can stop answering for at any moment, because a client
   * exits when it likes. This is how it finds out, rather than each holder
   * checking before every use.
   */
  onWindowClosed(listener: (appId: string) => void): void {
    this.#closeListeners.push(listener);
  }

  /** Move and resize a window — what a drag commits. */
  place(appId: string, box: WindowBox): void {
    const { element } = this.#windowFor(appId);
    applyBox(element, box);
    this.#windows.set(appId, { box, element });
  }

  /**
   * Where a window is, so a drag can be measured from where it was grabbed.
   *
   * Kept here rather than read back off the element: `style.left` is a string
   * this class wrote, and parsing it back would make the source of truth a
   * round trip through CSS.
   */
  boxOf(appId: string): WindowBox {
    return this.#windowFor(appId).box;
  }

  /** Bring a window to the front of the stack. */
  raise(appId: string): void {
    this.#frontmost += 1;
    this.#windowFor(appId).element.style.zIndex = this.#frontmost.toString();
  }

  /**
   * The window an event landed in, or `undefined` for the bare desktop.
   *
   * The target is usually not the window itself but the canvas the client's
   * frames are drawn into, so this asks what the target is *inside*.
   */
  appIdAt(target: EventTarget | undefined | null): string | undefined {
    const element =
      target instanceof Element ? target.closest(APP_TAG_NAME) : undefined;
    return element?.getAttribute("app-id") ?? undefined;
  }

  // What the host pushes at one window. Each is a no-op for a window that is
  // not here, unlike the methods above: the host may still be draining frames
  // for a client whose `app_closed` this desktop has already acted on.

  /**
   * The client drew, so there is something behind that window now.
   *
   * The size itself is not wanted here — the SDK records it as the message goes
   * past, because scaling the pointer by it is the only thing anyone does with
   * it. What this desktop takes from the message is that the window has stopped
   * being empty, which is when its placeholder comes down. Nothing else would
   * say so: where the compositor draws the client's own surface no frame ever
   * reaches the page.
   */
  resizeSurface({ app_id }: Pick<AppResizedMessage, "app_id">): void {
    this.#windows.get(app_id)?.element.classList.add(HAS_SURFACE_CLASS);
  }

  /**
   * Show the cursor the client asked for while the pointer is over its window.
   *
   * Plain CSS on an element this shell owns, which is what a cursor always was:
   * the SDK used to write it only because it owned the element class.
   */
  applyCursor({
    app_id,
    cursor,
  }: Pick<AppCursorMessage, "app_id" | "cursor">): void {
    const open = this.#windows.get(app_id);
    if (open !== undefined) {
      open.element.style.cursor = cursor;
    }
  }

  #windowFor(appId: string): OpenWindow {
    const open = this.#windows.get(appId);
    if (open === undefined) {
      throw new Error(`shell: no window for ${appId}`);
    } else {
      return open;
    }
  }
}

/** Put the element where its box says, in the page's own coordinates. */
const applyBox = (element: HTMLElement, box: WindowBox): void => {
  element.style.left = pixels(box.left);
  element.style.top = pixels(box.top);
  element.style.width = pixels(box.width);
  element.style.height = pixels(box.height);
};

/** A box's edge, as the inline style that puts the window there. */
const pixels = (length: number): string => `${length.toString()}px`;

const windowStyles = css({
  // Placeholder label until the window has something behind it, hidden the
  // moment the SDK says it has.
  "&:not(.has-surface)::after": {
    color: "muted",
    content: '"⬚  app surface: " attr(app-id)',
    display: "grid",
    fontSize: "sm",
    inset: 0,
    placeItems: "center",
    position: "absolute",
    textAlign: "center",
  },
  position: "absolute",
});
