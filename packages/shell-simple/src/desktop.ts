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

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  /** Put a client the host has announced on the desktop, in front. */
  open(appId: string, size: readonly [width: number, height: number]): void {
    const box = openingBox(this.#opened, size);
    const element = document.createElement(APP_TAG_NAME);
    element.className = windowStyles;
    applyBox(element, box);
    // The app id, the box and the stacking order all go on before the element
    // is appended: it places its portal as it connects, reading all three off
    // itself, and a placement sent without them is a window the host puts
    // nowhere, at nothing, behind everything — drawn that way for a frame,
    // until the next measurement corrects it.
    element.appId = appId;
    this.#windows.set(appId, { box, element });
    this.#opened += 1;
    this.raise(appId);
    this.#root.append(element);
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
