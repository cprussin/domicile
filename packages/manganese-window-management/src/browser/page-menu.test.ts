import { describe, expect, it } from "bun:test";

import type { PageContext } from "./page-menu";
import {
  MediaKind,
  PageMenuCommand,
  pageContextOf,
  pageMenuFor,
} from "./page-menu";

/** A right click over nothing in particular, with every flag down. */
const plain = (overrides: Partial<PageContext> = {}): PageContext => ({
  can: {
    copy: false,
    cut: false,
    delete: false,
    paste: false,
    redo: false,
    selectAll: false,
    undo: false,
  },
  editable: false,
  hasPixels: false,
  link: undefined,
  media: MediaKind.None,
  run: () => undefined,
  selection: "",
  source: undefined,
  x: 0,
  y: 0,
  ...overrides,
});

const history = { canGoBack: true, canGoForward: false };

/** The commands a menu offers, group by group, and which are grayed out. */
const commandsOf = (context: PageContext) =>
  pageMenuFor(context, history).map((group) =>
    group.map((item) => (item.disabled ? `(${item.command})` : item.command)),
  );

/** An event as the engine dispatches it, built since no DOM here has one. */
const event = (fields: Partial<DomicileContextMenuEvent>) =>
  Object.assign(new Event("domicile-context-menu"), {
    canCopy: false,
    canCut: false,
    canDelete: false,
    canPaste: false,
    canRedo: false,
    canSelectAll: false,
    canUndo: false,
    hasImageContents: false,
    isEditable: false,
    linkText: "",
    linkUrl: "",
    mediaType: "none",
    run: () => undefined,
    selectionText: "",
    srcUrl: "",
    x: 0,
    y: 0,
    ...fields,
  }) as DomicileContextMenuEvent;

describe("pageContextOf", () => {
  it("reads what was under the click off the engine's event", () => {
    const context = pageContextOf(
      event({
        hasImageContents: true,
        linkUrl: "https://example.test/opened",
        mediaType: "image",
        srcUrl: "https://example.test/picture.png",
        x: 12,
        y: 34,
      }),
    );
    expect(context.link).toBe("https://example.test/opened");
    expect(context.source).toBe("https://example.test/picture.png");
    expect(context.media).toBe(MediaKind.Image);
    expect(context.hasPixels).toBe(true);
    expect([context.x, context.y]).toEqual([12, 34]);
  });

  it("reads an empty address as none", () => {
    const context = pageContextOf(event({}));
    expect(context.link).toBeUndefined();
    expect(context.source).toBeUndefined();
  });

  it("refuses a media type it has never heard of", () => {
    expect(() => pageContextOf(event({ mediaType: "hologram" }))).toThrow();
  });

  it("hands an action back to the event it came from", async () => {
    const ran = await new Promise<string>((resolve) => {
      pageContextOf(event({ run: resolve })).run("copy-link-address");
    });
    expect(ran).toBe("copy-link-address");
  });
});

describe("pageMenuFor", () => {
  it("offers a page's history and DevTools over nothing in particular", () => {
    expect(commandsOf(plain())).toEqual([
      [
        PageMenuCommand.Back,
        `(${PageMenuCommand.Forward})`,
        PageMenuCommand.Reload,
      ],
      [PageMenuCommand.Inspect],
    ]);
  });

  it("offers a link's commands over a link", () => {
    expect(commandsOf(plain({ link: "https://example.test/" }))).toEqual([
      [
        PageMenuCommand.OpenLink,
        PageMenuCommand.SaveLinkAs,
        PageMenuCommand.CopyLinkAddress,
      ],
      [PageMenuCommand.Inspect],
    ]);
  });

  it("offers an image's commands over an image", () => {
    expect(
      commandsOf(
        plain({
          hasPixels: true,
          media: MediaKind.Image,
          source: "https://example.test/picture.png",
        }),
      ),
    ).toEqual([
      [
        PageMenuCommand.OpenMedia,
        PageMenuCommand.SaveMediaAs,
        PageMenuCommand.CopyImage,
        PageMenuCommand.CopyMediaAddress,
      ],
      [PageMenuCommand.Inspect],
    ]);
  });

  it("offers both over an image in a link", () => {
    expect(
      commandsOf(
        plain({
          hasPixels: true,
          link: "https://example.test/",
          media: MediaKind.Image,
          source: "https://example.test/picture.png",
        }),
      ),
    ).toHaveLength(3);
  });

  it("copies no pixels of a broken image", () => {
    expect(
      commandsOf(
        plain({
          media: MediaKind.Image,
          source: "https://example.test/picture.png",
        }),
      )[0],
    ).not.toContain(PageMenuCommand.CopyImage);
  });

  it("names a video's commands for a video", () => {
    const [media] = pageMenuFor(
      plain({
        media: MediaKind.Video,
        source: "https://example.test/film.webm",
      }),
      history,
    );
    expect(media?.map((item) => item.label)).toEqual([
      "Open video in new window",
      "Save video as…",
      "Copy video address",
    ]);
  });

  it("saves and copies a canvas, which has no address", () => {
    expect(
      commandsOf(plain({ hasPixels: true, media: MediaKind.Canvas }))[0],
    ).toEqual([PageMenuCommand.SaveMediaAs, PageMenuCommand.CopyImage]);
  });

  it("offers editing in a field, grayed out where the page says it cannot", () => {
    expect(
      commandsOf(
        plain({
          can: {
            copy: false,
            cut: false,
            delete: false,
            paste: true,
            redo: false,
            selectAll: true,
            undo: true,
          },
          editable: true,
        }),
      ),
    ).toEqual([
      [PageMenuCommand.Undo, `(${PageMenuCommand.Redo})`],
      [
        `(${PageMenuCommand.Cut})`,
        `(${PageMenuCommand.Copy})`,
        PageMenuCommand.Paste,
        PageMenuCommand.PasteAsPlainText,
        `(${PageMenuCommand.Delete})`,
        PageMenuCommand.SelectAll,
      ],
      [PageMenuCommand.Inspect],
    ]);
  });

  it("copies and searches for a selection outside a field", () => {
    const [selected] = pageMenuFor(
      plain({ can: { ...plain().can, copy: true }, selection: "domicile" }),
      history,
    );
    expect(selected?.map((item) => item.command)).toEqual([
      PageMenuCommand.Copy,
      PageMenuCommand.Search,
    ]);
    expect(selected?.[1]?.label).toBe("Search for “domicile”");
  });

  it("shortens a long selection in its label", () => {
    const [selected] = pageMenuFor(
      plain({ selection: "a".repeat(100) }),
      history,
    );
    expect(selected?.[1]?.label).toBe(`Search for “${"a".repeat(40)}…”`);
  });

  it("names DevTools' chord beside Inspect", () => {
    const inspect = pageMenuFor(plain(), history).at(-1)?.[0];
    expect(inspect?.shortcut).toBe("Ctrl+Shift+I");
  });
});
