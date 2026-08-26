// The windows on screen: one `<domicile-app>` per client the host announced,
// each absolutely positioned at a box this module owns.
//
// This is the whole of the shell's state. There is no tab list, no stage and no
// reducer — a window is where it is, and the only things that move it are the
// cascade it opened at and a drag. The host's per-app events are applied to the
// elements directly, because a client's frames arrive many times a second and
// carry a window of pixels each.

import type { DomicileAppElement } from "@domicile/chrome-sdk/app-element";
import type {
  AppCompositedMessage,
  AppCursorMessage,
  AppFrameMessage,
  AppResizedMessage,
} from "@domicile/chrome-sdk/protocol";
import { APP_TAG_NAME } from "@domicile/chrome-sdk/register-elements";

import { css } from "../styled-system/css";
import type { WindowBox } from "./window-box";
import { openingBox } from "./window-box";

/** A window on the desktop: the portal, and where this shell has put it. */
type OpenWindow = { box: WindowBox; element: DomicileAppElement };

export class Desktop {
  readonly #root: HTMLElement;
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

  constructor(root: HTMLElement) {
    this.#root = root;
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
   * news here: the size only ever
   * seeds the opening box, this desktop owns where a window is from then on,
   * and a client's real size arrives on `app_resized` regardless. So there is
   * nothing to apply, and applying it would undo a drag.
   *
   * Opening a second element instead would leave the *first* connected and
   * unreachable — the map holds the newer one, so every message from the host
   * goes there. The orphan still places a portal for the window, so two
   * elements place for one app id and the later measurement wins: a dragged
   * window snapping back to its cascade slot. And it is never taken down,
   * because `close` only knows the element in the map, so it outlives the
   * client.
   *
   * What is on screen depends on which way the window is drawn. Down the copy
   * path the new element is handed a frame and looks right, while the orphan
   * sits over it holding a still of the window from before the reconnect.
   * Where the compositor draws the client itself no frame is coming — the
   * hand-over skips a natively-drawn window — so the new element never learns
   * it has a surface and paints its placeholder over the live client for good.
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
      // element is appended: it places its portal as it connects, reading all
      // three off itself, and a placement sent without them is a window the
      // host puts nowhere, at nothing, behind everything — drawn that way for
      // a frame, until the next measurement corrects it.
      element.appId = appId;
      this.#windows.set(appId, { box, element });
      this.#opened += 1;
      this.raise(appId);
      this.#root.append(element);
      // After the append, and that order is load-bearing rather than tidy: the
      // element sends its portal as it connects, and `Scene::focus_app`
      // refuses an app it has no portal for — silently, while the seat is
      // moved anyway — so a focus that arrived first would leave the brain and
      // the compositor disagreeing with nothing to notice. The roadmap records
      // that exact no-op being found the hard way, in `e2e-chrome-layer.sh`.
      if (this.#caughtUp) {
        element.focusApp();
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

  drawFrame({
    app_id,
    width,
    height,
    scale,
    pixels,
    region,
  }: Pick<
    AppFrameMessage,
    "app_id" | "height" | "pixels" | "region" | "scale" | "width"
  >): void {
    this.#windows
      .get(app_id)
      ?.element.drawFrame(width, height, scale, pixels, region);
  }

  // The client redrew at a new resolution. The element needs it to scale
  // pointer coordinates before the first frame at that size arrives — and
  // where the compositor draws the client's own surface, no frame ever does.
  resizeSurface({
    app_id,
    size,
  }: Pick<AppResizedMessage, "app_id" | "size">): void {
    this.#windows.get(app_id)?.element.setSurfaceSize(size[0], size[1]);
  }

  applyCursor({
    app_id,
    cursor,
  }: Pick<AppCursorMessage, "app_id" | "cursor">): void {
    this.#windows.get(app_id)?.element.applyCursor(cursor);
  }

  // The compositor has taken this window back and is drawing the client's own
  // buffer. Whatever pixels this element holds are a still of the window, and
  // the chrome is composited over the client — so they would hide the live one.
  dropSurface({ app_id }: Pick<AppCompositedMessage, "app_id">): void {
    this.#windows.get(app_id)?.element.dropSurface();
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
const applyBox = (element: DomicileAppElement, box: WindowBox): void => {
  element.style.left = pixels(box.left);
  element.style.top = pixels(box.top);
  element.style.width = pixels(box.width);
  element.style.height = pixels(box.height);
};

/** A box's edge, as the inline style that puts the window there. */
const pixels = (length: number): string => `${length.toString()}px`;

const windowStyles = css({
  // Placeholder label until the window has something behind it, hidden the
  // moment the SDK says it has — a copied frame, or a client the compositor is
  // drawing itself.
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
