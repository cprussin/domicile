import { FilePreviewKind } from "@domicile/chrome-sdk/file-preview";
import type {
  DesktopEntry,
  FilePreviewMessage,
  FoundAppsMessage,
  FoundFilesMessage,
} from "@domicile/chrome-sdk/host-message";
import {
  WEBVIEW_FAVICON_CHANGE_EVENT,
  WEBVIEW_GUEST_FOCUS_EVENT,
} from "@domicile/chrome-sdk/webview-element";
import { Input } from "@domicile/component-library/Input";
import { Kbd } from "@domicile/component-library/Kbd";
import { ModalDialog } from "@domicile/component-library/ModalDialog";
import { AppWindowIcon } from "@phosphor-icons/react/dist/ssr/AppWindow";
import { BinaryIcon } from "@phosphor-icons/react/dist/ssr/Binary";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/dist/ssr/BookmarkSimple";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr/CircleNotch";
import { FileIcon } from "@phosphor-icons/react/dist/ssr/File";
import { FileXIcon } from "@phosphor-icons/react/dist/ssr/FileX";
import { FolderIcon } from "@phosphor-icons/react/dist/ssr/Folder";
import { FolderDashedIcon } from "@phosphor-icons/react/dist/ssr/FolderDashed";
import { GithubLogoIcon } from "@phosphor-icons/react/dist/ssr/GithubLogo";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/ssr/GlobeSimple";
import { GoogleLogoIcon } from "@phosphor-icons/react/dist/ssr/GoogleLogo";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { YoutubeLogoIcon } from "@phosphor-icons/react/dist/ssr/YoutubeLogo";
import type { ReactNode, RefObject } from "react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { css } from "../../styled-system/css";
import { flex, hstack, vstack } from "../../styled-system/patterns";
import { Engine } from "../address/search";
import { AudioPreview } from "./AudioPreview";
import type { Choice } from "./choices";
import { ChoiceKind, choicesFor, launchOf } from "./choices";
import { FolderPreview } from "./FolderPreview";
import type { FileRow } from "./file-row";
import type { Launch } from "./launch";
import type { LearnedIcons } from "./learned-icons";
import { learnedIcons, learnIcon } from "./learned-icons";
import type { Mark } from "./marked";
import { marked } from "./marked";
import { homeUrl, MediaKind, mediaOf } from "./media";
import { TextPreview } from "./TextPreview";
import { useFound } from "./useFound";
import type { FoundApps } from "./useFoundApps";
import { useFoundApps } from "./useFoundApps";
import { usePreview } from "./usePreview";
import { useSettled } from "./useSettled";
import { VideoPreview } from "./VideoPreview";
import { WikipediaLogoIcon } from "./WikipediaLogoIcon";
import { highlightIn, keepInView, stepOf, steppedTo } from "./walk";

/** What the box asks for, as its placeholder and as its accessible name. */
const PROMPT = "Open an app, a file, a URL, or search";

/**
 * How long the highlight has to stay on a row before it is previewed: long
 * enough that typing a name is not a preview per letter, short enough that
 * stopping on a row is not waiting for one.
 */
const PREVIEW_SETTLE_MS = 200;

/** `WheelEvent.DOM_DELTA_PIXEL`: a wheel's deltas in pixels. */
const DOM_DELTA_PIXEL = 0;

/** How big the glyph for a pane with no picture of its own is drawn. */
const EMPTY_ICON_SIZE = 64;

/** How big the glyph beside a row, and in the box, is drawn. */
const ICON_SIZE = 16;

type Props = {
  /**
   * Whether the press that put it up was heard on this page. A desk of several
   * monitors is several pages, all told the launcher is up: the panel goes on
   * the one the keys are arriving at, and the rest draw only the backdrop it
   * is up over.
   */
  here: boolean;
  /**
   * The panel has finished leaving, which is later than `open` going false:
   * it transitions out, and `here` has to hold until it has.
   */
  onClosed: () => void;
  /** Escape, or a click on the backdrop. The desktop decides what that means. */
  onDismiss: () => void;
  onLaunch: (launch: Launch) => void;
  open: boolean;
  /**
   * The applications and bookmarks its empty box offers, found before it was
   * opened, so they are drawn with the panel rather than landing a moment
   * after it. See `useOpeningApps`.
   */
  opening: FoundApps;
  /** What a path holds, answered by the host, for the preview. */
  preview: Preview;
  /**
   * What in the home matches a query, answered by the host.
   *
   * The host searches and the panel draws: the compositor's index is the whole
   * home, and all a page is ever told is what one query found in it.
   */
  search: Search;
  /** Which installed applications match a query, answered by the host. */
  searchApps: SearchApps;
};

/** How the panel asks what matches what is in its box. */
type Search = (query: string) => Promise<FoundFilesMessage>;

/** How the panel asks which applications match what is in its box. */
type SearchApps = (query: string) => Promise<FoundAppsMessage>;

/** How the panel asks what the highlighted file holds. */
type Preview = (path: string) => Promise<FilePreviewMessage>;

/** How a bookmark's preview says the icon its page named. */
type Learn = (bookmark: string, icon: string) => void;

/**
 * One box, over a backdrop, that runs an application or opens a file, a URL
 * or a search.
 *
 * `mod+space` is what puts it up. What goes in is a query rather than a
 * command — there is nothing to choose between first — and which of the
 * things it means is `launch.ts`'s to decide, on evidence rather than on a
 * prefix the user has to remember.
 *
 * **It does not close itself.** Whether the launcher is open is desktop state,
 * kept in the same reduction as everything else the keys do, so Escape and a
 * click on the backdrop are reported rather than acted on. A panel that closed
 * itself would be a second copy of that state, and the two would part company
 * the first time `mod+space` was pressed over one the desktop thought was
 * shut.
 */
export const Launcher = ({
  here,
  onClosed,
  onDismiss,
  onLaunch,
  open,
  opening,
  preview,
  search,
  searchApps,
}: Props) => (
  <ModalDialog
    // Escape and the backdrop are what put it away, and the footer says the
    // first of those — a corner ✕ on a panel driven from the keyboard is a
    // button nobody aims at and a line of chrome over the thing being read.
    closeButton={false}
    footer={<Keys />}
    onOpenChange={(next) => {
      if (!next) {
        onDismiss();
      }
    }}
    onOpenChangeComplete={(next) => {
      if (!next) {
        onClosed();
      }
    }}
    open={open}
    // Where a launcher has always been, and where it covers least of the
    // desktop it is opening something onto.
    placement="top"
    popup={here}
    // Wide, because a row is a name and the directory it is in, and beside
    // the rows is a preview of the one the highlight is on.
    size="xl"
    // A pane rather than a card, because there is a desktop behind it worth
    // keeping: a launcher is a thing held up over your work for a second and
    // a half, and one that blanked what it was over would read as a page the
    // desktop had navigated to.
    surface="glass"
    title="Open"
  >
    {/*
      Inside the dialog, so it is unmounted with it: base-ui portals the popup
      only while it is open, which is what makes every open start on an empty
      box and a full list without an effect anywhere to clear them.
    */}
    <Query
      onLaunch={onLaunch}
      opening={opening}
      preview={preview}
      search={search}
      searchApps={searchApps}
    />
  </ModalDialog>
);

type QueryProps = {
  onLaunch: (launch: Launch) => void;
  opening: FoundApps;
  preview: Preview;
  search: Search;
  searchApps: SearchApps;
};

/**
 * The box and the list under it, with the keyboard that moves between them.
 *
 * A combobox over a listbox rather than a box beside some buttons: the rows
 * are one choice among many and the keyboard never leaves the box, which is
 * what `aria-activedescendant` is for. It is also what the interaction
 * actually is — a person types, watches the list narrow, and presses Enter
 * without having looked at the screen for the last two of those.
 */
const Query = ({
  onLaunch,
  opening,
  preview,
  search,
  searchApps,
}: QueryProps) => {
  const listId = useId();
  const [query, setQuery] = useState("");
  // Where the arrow keys or the pointer have taken the highlight, from the
  // first row. Not the highlight itself — see `highlightIn`, which keeps it
  // inside a list that has narrowed since.
  const [stepped, setStepped] = useState(0);

  const found = useFound(search, query);
  const offered = useFoundApps(searchApps, query, opening);
  // Every row is a thing Enter can do — the applications, the bookmarks and
  // the files, and a site and a search around them — so the list is the whole
  // answer to what it will do.
  const choices = choicesFor(
    query,
    found.files,
    offered.apps,
    offered.bookmarks,
  );
  const highlighted = highlightIn(choices.length, stepped);
  const chosen = highlighted === undefined ? undefined : choices[highlighted];
  // What the pane shows: the highlighted row once the highlight has stood on
  // it, and until then the one it showed before — a preview, then the next,
  // with nothing in between. Keyed, because a choice is a new object on every
  // render and would never be seen to settle.
  const shown = useSettled(
    chosen,
    chosen === undefined ? undefined : keyOf(chosen),
    PREVIEW_SETTLE_MS,
  );
  const box = useRef<HTMLInputElement>(null);
  const pane = useRef<HTMLElement>(null);
  // The icons bookmarks' own pages named when they were previewed: read once
  // as the panel opens, and again whenever a preview names one.
  const [learned, setLearned] = useState(learnedIcons);
  const learn = useCallback((bookmark: string, icon: string) => {
    learnIcon(bookmark, icon);
    setLearned(learnedIcons());
  }, []);

  useEffect(() => keepKeyboardIn(mounted(box)), []);
  useEffect(() => scrollOnWheel(mounted(pane)), []);

  return (
    <div className={panelStyles}>
      <Input
        aria-activedescendant={
          highlighted === undefined ? undefined : rowId(listId, highlighted)
        }
        aria-controls={listId}
        aria-expanded
        // Named as well as placeheld, because it is no longer the only
        // combobox a desktop can have on screen: a browser window's address
        // bar is one too, and a placeholder is not an accessible name — it is
        // gone the moment anything is typed.
        aria-label={PROMPT}
        // The box is why the panel is up, and a launcher you have to click
        // into is a launcher that costs more than the terminal it replaces.
        autoFocus
        onChange={(event) => {
          setQuery(event.target.value);
          // The walk belongs to the list that was on screen when it happened.
          // A narrower list would otherwise keep an index into the old one,
          // which is a highlight on a row nobody chose.
          setStepped(0);
        }}
        onKeyDown={(event) => {
          const step = stepOf(event);
          if (step !== undefined) {
            // Taken from the box, which would otherwise put the caret at the
            // end of the query on the way past.
            event.preventDefault();
            // From the highlight rather than from `stepped`, which a list
            // that narrowed under it can have left past the end. No highlight
            // is no list, which has nowhere to walk to but the top.
            setStepped(steppedTo(highlighted ?? 0, step, choices.length));
          } else if (event.key === "Enter" && chosen !== undefined) {
            // Nothing highlighted is an empty list, which has nothing to open.
            onLaunch(launchOf(chosen));
          } else if (event.key === "Tab") {
            // The keyboard never leaves the box: see `keepKeyboardIn`.
            event.preventDefault();
          }
        }}
        placeholder={PROMPT}
        // The glyph the whole panel is about, at the head of the one thing in
        // it that takes typing.
        prefixIcon={<MagnifyingGlassIcon size={ICON_SIZE} />}
        ref={box}
        role="combobox"
        size="lg"
        // A home full of file names is not prose, and a list of them underlined
        // in red reads as a panel full of mistakes.
        spellCheck={false}
        // How much of the home is still answering, in the field doing the
        // narrowing — a find bar's counter, and the one number that says
        // whether one more letter is worth typing.
        suffixIcon={
          <span aria-hidden="true" className={countStyles}>
            {`${found.matched.toString()} matched`}
          </span>
        }
        value={query}
      />
      <div className={splitStyles}>
        {/*
          THE SAME SIZE WHATEVER IS IN IT. The rows are filtered on every
          keystroke and the host's answer lands after the panel is already up,
          so a box that fitted its contents would resize under the hand typing
          into it — a panel that grew and shrank between one letter and the
          next, taking everything below the rows with it.
        */}
        <div className={resultsStyles}>
          {/*
            A listbox of options rather than a list of buttons: the rows are
            one choice among many and the keyboard that walks them never leaves
            the box above, which is what `aria-activedescendant` says. Two
            hundred buttons would say there are two hundred things to press.

            Divs rather than `ul`/`li` because an `li` is non-interactive
            markup and an option is not — the roles are the structure here, and
            doubling them up with list elements is what the lint is objecting
            to.
          */}
          <div className={listStyles} id={listId} role="listbox">
            {choices.map((choice, at) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox above owns the keyboard for these rows, which is the whole point of `aria-activedescendant`
              <div
                aria-selected={at === highlighted}
                className={rowStyles}
                data-highlighted={at === highlighted ? "" : undefined}
                id={rowId(listId, at)}
                key={keyOf(choice)}
                onClick={() => {
                  onLaunch(launchOf(choice));
                }}
                // The pointer moves the one highlight rather than drawing a
                // hover of its own beside it: two marks on the list is two
                // answers to what Enter takes. A move rather than an enter,
                // because a row scrolled under a pointer that has not moved
                // is the keyboard's walk, not the pointer's.
                onPointerMove={() => {
                  setStepped(at);
                }}
                // Only the highlighted row carries it, and it is the same
                // function every render, so React calls it exactly when the
                // highlight arrives at a row rather than on every keystroke.
                ref={at === highlighted ? keepInView : undefined}
                role="option"
                // Reachable programmatically and never in the tab ring: focus
                // stays in the box, which is what makes typing and choosing
                // one gesture rather than two.
                tabIndex={-1}
              >
                <ChoiceRow choice={choice} learned={learned} query={query} />
              </div>
            ))}
          </div>
          {/*
            After the last row and inside the box they scroll in, because it is
            about the list rather than about any row in it: the end of the rows
            is where somebody looking for a file that is not there yet looks.
            Beside the listbox rather than in it, which holds options and
            nothing else.
          */}
          {found.indexing && <StillIndexing />}
        </div>
        <section aria-label="Preview" className={previewStyles} ref={pane}>
          <PreviewOf choice={shown} onLearn={learn} preview={preview} />
        </section>
      </div>
    </div>
  );
};

/** What `ref` holds once its element is mounted, which an effect runs after. */
const mounted = <T,>(ref: RefObject<T | null>): T => {
  if (ref.current === null) {
    throw new Error("An effect ran before its element was mounted");
  }
  return ref.current;
};

/**
 * Keep the keyboard in `box` for as long as the panel is up: a press anywhere
 * in the document does not move the focus, and a site in the preview that
 * takes it on a click gives it straight back. Tab is refused in the box
 * itself. Returns what undoes it.
 *
 * The whole document rather than the panel, because the dialog's title and
 * footer are outside it and are just as able to take the focus.
 */
const keepKeyboardIn = (box: HTMLInputElement): (() => void) => {
  const document = box.ownerDocument;
  const stayPut = (event: MouseEvent) => {
    if (event.target !== box) {
      event.preventDefault();
    }
  };
  const takeBack = () => {
    box.focus();
  };
  document.addEventListener("mousedown", stayPut);
  document.addEventListener(WEBVIEW_GUEST_FOCUS_EVENT, takeBack);
  return () => {
    document.removeEventListener("mousedown", stayPut);
    document.removeEventListener(WEBVIEW_GUEST_FOCUS_EVENT, takeBack);
  };
};

/**
 * Scroll `pane` by the wheel ourselves rather than leaving it to the engine,
 * which in Domicile scrolls a keyboard-focused pane but not one under the
 * pointer. Returns what undoes it.
 *
 * Pixels only, which is all Chromium sends.
 */
const scrollOnWheel = (pane: HTMLElement): (() => void) => {
  const scroll = (event: WheelEvent) => {
    if (event.deltaMode !== DOM_DELTA_PIXEL) {
      throw new RangeError(
        `unexpected WheelEvent.deltaMode: ${event.deltaMode.toString()}`,
      );
    }
    event.preventDefault();
    pane.scrollBy(event.deltaX, event.deltaY);
  };
  // Not passive, so the engine's own scroll is canceled rather than doubled
  // wherever it does work.
  pane.addEventListener("wheel", scroll, { passive: false });
  return () => {
    pane.removeEventListener("wheel", scroll);
  };
};

/** What one row says, by the kind of thing Enter on it would do. */
const ChoiceRow = ({
  choice,
  learned,
  query,
}: {
  choice: Choice;
  learned: LearnedIcons;
  query: string;
}) => {
  switch (choice.kind) {
    case ChoiceKind.App: {
      return (
        <>
          <AppTile icon={choice.entry.icon} />
          <span className={rowNameStyles}>
            <Marked marks={marked(choice.entry.name, query)} />
          </span>
        </>
      );
    }
    case ChoiceKind.Bookmark: {
      return (
        <>
          {/* Keyed on what it would draw, so an icon that would not load does
              not leave the next one learned drawn as the fallback. */}
          <BookmarkTile
            found={choice.icon}
            key={`${choice.url} ${learned[choice.url] ?? ""}`}
            learned={learned[choice.url]}
          />
          <span className={rowNameStyles}>
            <Marked marks={marked(choice.name, query)} />
          </span>
        </>
      );
    }
    case ChoiceKind.File: {
      return <FileChoice query={query} row={choice.row} />;
    }
    case ChoiceKind.Site: {
      return (
        <>
          <RowTile icon={GlobeSimpleIcon} />
          <span className={rowNameStyles}>
            <span className={rowVerbStyles}>Go to</span> {choice.url}
          </span>
        </>
      );
    }
    case ChoiceKind.Search: {
      return (
        <>
          <RowTile icon={MagnifyingGlassIcon} />
          <span className={rowNameStyles}>
            <span className={rowVerbStyles}>Search for</span> {choice.query}
          </span>
        </>
      );
    }
    case ChoiceKind.TaggedSearch: {
      return (
        <>
          <RowTile icon={logoOf(choice.engine)} />
          <span className={rowNameStyles}>
            <span className={rowVerbStyles}>Search for</span> {choice.query}{" "}
            <span className={rowVerbStyles}>on</span> {nameOf(choice.engine)}
          </span>
        </>
      );
    }
    case ChoiceKind.TaggedSite: {
      return (
        <>
          <RowTile icon={logoOf(choice.engine)} />
          <span className={rowNameStyles}>
            <span className={rowVerbStyles}>Go to</span> {choice.path}{" "}
            <span className={rowVerbStyles}>on</span> {nameOf(choice.engine)}
          </span>
        </>
      );
    }
  }
};

/** A path's row: the directory it is in, over its name. */
const FileChoice = ({ query, row }: { query: string; row: FileRow }) => (
  <>
    <RowTile icon={row.isDirectory ? FolderIcon : FileIcon} />
    <span className={rowTextStyles}>
      {row.directory !== undefined && (
        <span className={rowDirectoryStyles}>
          <Marked marks={marked(row.directory, query)} />
        </span>
      )}
      <span className={rowNameStyles}>
        <Marked marks={marked(row.name, query)} />
      </span>
    </span>
  </>
);

/**
 * The glyph a row starts with, in a tile of its own.
 *
 * Drawn twice and one of them shown, because a weight is a different set of
 * paths rather than a color: an outline Phosphor glyph is filled shapes with
 * holes in them, so nothing in CSS can thicken one. The pair is what the
 * component library does for its own icon swap — see
 * `_control/PrefixIconStack` — and it costs the row a second `<svg>` that is
 * never laid out on its own.
 */
const RowTile = ({ icon: Icon }: { icon: typeof FileIcon }) => (
  <span className={rowTileStyles} data-row-tile="">
    <span className={rowGlyphStyles} data-row-glyph="resting">
      <Icon size={ICON_SIZE} />
    </span>
    <span className={rowGlyphStyles} data-row-glyph="reached">
      <Icon size={ICON_SIZE} weight="fill" />
    </span>
  </span>
);

/**
 * An application's tile: the icon its entry names, or a generic glyph for one
 * the host did not find.
 */
const AppTile = ({ icon }: { icon: string | undefined }) =>
  icon === undefined ? (
    <RowTile icon={AppWindowIcon} />
  ) : (
    <PictureTile picture={icon} />
  );

/**
 * A bookmark's tile: the icon learned from its own page, or else the one the
 * host found its site naming, or else a bookmark's glyph. A learned icon that
 * will not load — a signed-in page's, say, once the user has signed out —
 * gives way to the host's.
 */
const BookmarkTile = ({
  found,
  learned,
}: {
  found: string | undefined;
  learned: string | undefined;
}) => {
  const [failed, setFailed] = useState(false);
  const picture = failed || learned === undefined ? found : learned;
  return picture === undefined ? (
    <RowTile icon={BookmarkSimpleIcon} />
  ) : (
    <PictureTile
      onError={
        picture === learned
          ? () => {
              setFailed(true);
            }
          : undefined
      }
      picture={picture}
    />
  );
};

/**
 * An icon that is a picture — an application's, a site's — in a glyph tile's
 * place, and without its frame: the picture is its own shape, and a box round
 * it is a box drawn round somebody else's logo.
 *
 * One picture rather than RowTile's pair: there is no second weight of it to
 * swap to when the row is reached.
 */
const PictureTile = ({
  onError,
  picture,
}: {
  onError?: (() => void) | undefined;
  picture: string;
}) => (
  <span className={pictureTileStyles}>
    {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: `error` is the picture failing to load, not something a person does to it */}
    <img alt="" className={rowPictureStyles} onError={onError} src={picture} />
  </span>
);

/**
 * What the pane shows, which is never nothing: a blank pane reads as a broken
 * one. With no row highlighted it says how to choose one.
 */
const PreviewOf = ({
  choice,
  onLearn,
  preview,
}: {
  choice: Choice | undefined;
  onLearn: Learn;
  preview: Preview;
}) =>
  choice === undefined ? (
    <Placeholder
      icon={MagnifyingGlassIcon}
      note="Type to find an app, a file, a site or a search"
      title="Nothing selected"
    />
  ) : (
    <ChoicePreview choice={choice} onLearn={onLearn} preview={preview} />
  );

/**
 * An application: the picture of itself its entry names, or else its name,
 * what its entry says it is for, and the command Enter runs — which is the one
 * thing a launcher's row cannot show and the thing that tells two entries of
 * the same name apart.
 */
const AppPreview = ({ entry }: { entry: DesktopEntry }) =>
  entry.preview === undefined ? (
    <AppCard entry={entry} />
  ) : (
    <img alt={entry.name} className={mediaStyles} src={entry.preview} />
  );

/** An application with no picture of itself, described. */
const AppCard = ({ entry }: { entry: DesktopEntry }) => (
  <Placeholder
    icon={AppWindowIcon}
    note={
      <span className={appNoteStyles}>
        {entry.comment !== "" && <span>{entry.comment}</span>}
        <code className={commandStyles}>{entry.command.join(" ")}</code>
      </span>
    }
    picture={entry.icon}
    title={entry.name}
  />
);

/** A file by name and kind alone, with `note` saying why that is all. */
const NamedFile = ({ note, row }: { note?: string; row: FileRow }) => (
  <Placeholder
    icon={row.isDirectory ? FolderIcon : FileIcon}
    note={note}
    title={row.name}
  />
);

/**
 * A large glyph over a title and a quieter line: a pane with no picture — or
 * with only a small one, `picture`, drawn in the glyph's place.
 */
const Placeholder = ({
  icon: Icon,
  note,
  picture,
  title,
}: {
  icon: typeof FileIcon;
  note?: ReactNode;
  picture?: string | undefined;
  title: string;
}) => (
  <div className={placeholderStyles}>
    {picture === undefined ? (
      <Icon size={EMPTY_ICON_SIZE} weight="thin" />
    ) : (
      <img alt="" className={placeholderPictureStyles} src={picture} />
    )}
    <span className={placeholderTitleStyles}>{title}</span>
    {note !== undefined && (
      <span className={placeholderNoteStyles}>{note}</span>
    )}
  </div>
);

/**
 * What the highlighted row is: a file's front, the file itself, or the page a
 * URL is.
 *
 * A site in a `<webview>` of its own, which the pointer reaches so the wheel
 * scrolls it; a click in it takes the keyboard, which `keepKeyboardIn` hands
 * straight back to the box. A file the engine can draw — an image, a video, a
 * PDF — is drawn from `domicile://home/`; a song is played from there too,
 * under what the host reads of its tags; anything else is what the host reads
 * of it.
 */
const ChoicePreview = ({
  choice,
  onLearn,
  preview,
}: {
  choice: Choice;
  onLearn: Learn;
  preview: Preview;
}) => {
  switch (choice.kind) {
    // Everything there is to say about one arrived with the row, so there is
    // nothing to wait for.
    case ChoiceKind.App: {
      return <AppPreview entry={choice.entry} />;
    }
    case ChoiceKind.File: {
      // Keyed on the path, so what one row learned — an image that would not
      // load, a song that was playing — is not carried onto the next.
      return (
        <FileChoicePreview
          key={choice.row.path}
          preview={preview}
          row={choice.row}
        />
      );
    }
    case ChoiceKind.Bookmark: {
      // Keyed on the address, so each bookmark has a guest of its own and no
      // icon the last one's page names is heard as this one's.
      return (
        <BookmarkPreview key={choice.url} onLearn={onLearn} url={choice.url} />
      );
    }
    case ChoiceKind.Site:
    case ChoiceKind.Search:
    case ChoiceKind.TaggedSearch:
    case ChoiceKind.TaggedSite: {
      return (
        <webview className={viewStyles} src={choice.url} title={choice.url} />
      );
    }
  }
};

/**
 * A bookmark's page, from which its icon is learned: the page is the user's
 * browser, signed in as they are, so the icon it names is the one a site keeps
 * for people signed in — which no anonymous lookup sees.
 */
const BookmarkPreview = ({ onLearn, url }: { onLearn: Learn; url: string }) => {
  // `null` rather than `undefined` because that is what React's ref API hands
  // a callback ref on unmount.
  const [view, setView] = useState<HTMLWebViewElement | null>(null);

  useEffect(() => {
    if (view === null) {
      return undefined;
    } else {
      // Only from the bookmark's own site: signed out, its page is a sign-in
      // page, and a link followed in the preview is another site's.
      const heard = () => {
        if (view.favicon !== "" && sameOrigin(view.url, url)) {
          onLearn(url, view.favicon);
        }
      };
      view.addEventListener(WEBVIEW_FAVICON_CHANGE_EVENT, heard);
      return () => {
        view.removeEventListener(WEBVIEW_FAVICON_CHANGE_EVENT, heard);
      };
    }
  }, [onLearn, url, view]);

  return <webview className={viewStyles} ref={setView} src={url} title={url} />;
};

/** Whether `a` and `b` are on one origin; an address that is none is not. */
const sameOrigin = (a: string, b: string) =>
  URL.canParse(a) && URL.canParse(b) && new URL(a).origin === new URL(b).origin;

/** A file, drawn by the element its kind is drawn in. */
const FileChoicePreview = ({
  preview,
  row,
}: {
  preview: Preview;
  row: FileRow;
}) => {
  const media = mediaIn(row);
  switch (media) {
    case undefined: {
      return <FilePreviewPane preview={preview} row={row} />;
    }
    case MediaKind.Audio: {
      return <SongPane preview={preview} row={row} />;
    }
    case MediaKind.Image:
    case MediaKind.Video:
    case MediaKind.Pdf: {
      return <MediaPreview kind={media} row={row} />;
    }
  }
};

/**
 * A file drawn as itself, from where the engine serves the home — or, when
 * the engine could not draw it after all, named as one it cannot. An extension
 * is a guess, and a broken image is a blank pane.
 */
const MediaPreview = ({
  kind,
  row,
}: {
  kind: Exclude<MediaKind, MediaKind.Audio>;
  row: FileRow;
}) => {
  const [failed, setFailed] = useState(false);
  const url = homeUrl(row.path);
  const fail = () => {
    setFailed(true);
  };
  if (failed) {
    return <CannotPreview row={row} />;
  } else {
    switch (kind) {
      case MediaKind.Image: {
        return (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: `error` is the image failing to load, not something a person does to it
          <img
            alt={row.name}
            className={mediaStyles}
            onError={fail}
            src={url}
          />
        );
      }
      case MediaKind.Video: {
        return <VideoPreview name={row.name} onError={fail} url={url} />;
      }
      case MediaKind.Pdf: {
        // The viewer's open parameters: no toolbar, no page sidebar — the
        // page is all a pane this size has room for.
        return (
          <iframe
            className={viewStyles}
            src={`${url}#toolbar=0&navpanes=0`}
            title={row.name}
          />
        );
      }
    }
  }
};

/** A file whose kind nothing here can draw, by name. */
const CannotPreview = ({ row }: { row: FileRow }) => (
  <Placeholder
    icon={BinaryIcon}
    note="No preview for this file"
    title={row.name}
  />
);

/**
 * What kind of element `row` is drawn in, or `undefined` for one the host
 * reads. Only under home, which is all the engine serves, and never a
 * directory, whatever its name ends in.
 */
const mediaIn = (row: FileRow): MediaKind | undefined =>
  row.isDirectory || row.path.startsWith("/") ? undefined : mediaOf(row.path);

/**
 * A song, played from where the engine serves the home, under the tags the
 * host reads of it. One the host could not read as a song is still offered:
 * its name said it is one, and the engine may yet play it.
 */
const SongPane = ({ preview, row }: { preview: Preview; row: FileRow }) => {
  const shown = usePreview(preview, row.path);
  return shown === undefined ? (
    <NamedFile row={row} />
  ) : (
    <AudioPreview
      row={row}
      tags={shown.kind === FilePreviewKind.Audio ? shown.tags : undefined}
    />
  );
};

/** What the host says a path holds, drawn by kind. */
const FilePreviewPane = ({
  preview,
  row,
}: {
  preview: Preview;
  row: FileRow;
}) => {
  const shown = usePreview(preview, row.path);
  switch (shown?.kind) {
    // The host has not answered yet, and a desktop with no index never will:
    // either way the row is known, so it is what the pane says.
    case undefined: {
      return <NamedFile row={row} />;
    }
    case FilePreviewKind.Text: {
      return <TextPreview path={row.path} text={shown.text} />;
    }
    case FilePreviewKind.Directory: {
      // An empty list is an answer, and a blank pane would read as one still
      // on its way.
      return shown.entries.length === 0 ? (
        <Placeholder
          icon={FolderDashedIcon}
          note="Empty folder"
          title={row.name}
        />
      ) : (
        <FolderPreview entries={shown.entries} row={row} />
      );
    }
    case FilePreviewKind.Audio: {
      return <AudioPreview row={row} tags={shown.tags} />;
    }
    case FilePreviewKind.Binary: {
      return <CannotPreview row={row} />;
    }
    case FilePreviewKind.Unreadable: {
      return (
        <Placeholder
          icon={FileXIcon}
          note="This file can't be read"
          title={row.name}
        />
      );
    }
  }
};

/**
 * A row's text with the letters the query is responsible for lit.
 *
 * `mark` rather than a styled span, because that is what the element is for
 * and because it is the one piece of this the browser's own find-in-page and
 * a screen reader already understand. It leaves the text alone — the run it
 * wraps is the run it was given — so what a row *says* is what it said
 * before anybody typed.
 */
const Marked = ({ marks }: { marks: readonly Mark[] }) => (
  <>
    {marks.map((mark, at) =>
      mark.matched ? (
        // Index as the key because that is what a run is: the third piece of
        // this name, which is a different piece the moment the query changes.
        <mark className={markStyles} key={at}>
          {mark.text}
        </mark>
      ) : (
        <Fragment key={at}>{mark.text}</Fragment>
      ),
    )}
  </>
);

/**
 * The line that says the list is not all of the home yet.
 *
 * `role="status"` so it is announced rather than only drawn: a person driving
 * this from the keyboard with a screen reader is the person least able to
 * notice rows arriving on their own.
 */
const StillIndexing = () => (
  <p className={indexingStyles} role="status">
    <span className={spinnerStyles}>
      <CircleNotchIcon size={ICON_SIZE} />
    </span>
    Still finding your files
  </p>
);

/**
 * The three keys the panel answers, spelled out under it.
 *
 * A launcher is a keyboard instrument, and the whole of its interface is keys
 * nothing on screen otherwise names.
 */
const Keys = () => (
  <div className={keysStyles}>
    <span className={keyStyles}>
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd> Move
    </span>
    <span className={keyStyles}>
      <Kbd>↵</Kbd> Open
    </span>
    <span className={keyStyles}>
      <Kbd>esc</Kbd> Close
    </span>
  </div>
);

/** What tells one row from the others across a keystroke. */
const keyOf = (choice: Choice): string => {
  switch (choice.kind) {
    case ChoiceKind.App: {
      return `app:${choice.entry.id}`;
    }
    case ChoiceKind.Bookmark: {
      return `bookmark:${choice.name}:${choice.url}`;
    }
    case ChoiceKind.File: {
      return `file:${choice.row.path}`;
    }
    // The URL as well as the kind, so a search that changed with the typing
    // is a new row for the preview to settle on.
    case ChoiceKind.Site: {
      return `site:${choice.url}`;
    }
    case ChoiceKind.Search: {
      return `search:${choice.url}`;
    }
    case ChoiceKind.TaggedSearch: {
      return `tagged:${choice.url}`;
    }
    case ChoiceKind.TaggedSite: {
      return `tagged-site:${choice.url}`;
    }
  }
};

/**
 * The logo of the site a tagged search goes to: the row says where the words
 * are going before its text is read. Images and Maps are Google's.
 */
const logoOf = (engine: Engine): typeof FileIcon => {
  switch (engine) {
    case Engine.GitHub: {
      return GithubLogoIcon;
    }
    case Engine.GoogleImages:
    case Engine.GoogleMaps: {
      return GoogleLogoIcon;
    }
    case Engine.Wikipedia: {
      return WikipediaLogoIcon;
    }
    case Engine.YouTube: {
      return YoutubeLogoIcon;
    }
  }
};

const nameOf = (engine: Engine): string => {
  switch (engine) {
    case Engine.GitHub: {
      return "GitHub";
    }
    case Engine.GoogleImages: {
      return "Google Images";
    }
    case Engine.GoogleMaps: {
      return "Google Maps";
    }
    case Engine.Wikipedia: {
      return "Wikipedia";
    }
    case Engine.YouTube: {
      return "YouTube";
    }
  }
};

/** A row's own id, which is what `aria-activedescendant` points at. */
const rowId = (listId: string, at: number): string =>
  `${listId}-${at.toString()}`;

const panelStyles = vstack({
  alignItems: "stretch",
  gap: 3,
});

// The rows and the preview side by side, the preview the wider: a row is a
// name over its directory and needs little width, and the preview is a page,
// a picture or a file's text.
const splitStyles = css({
  display: "grid",
  gap: 3,
  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
});

// Tall enough to be worth scrolling and short enough to leave the backdrop
// showing: the panel is a thing over the desktop, and one that reached the
// bottom of the screen would read as a page. A block size rather than a
// maximum, so the panel is the same height however many rows the query left
// — see the note at the call site.
const resultsStyles = css({
  // A ground a shade off the panel's, so the room the fixed height keeps
  // reads as a box waiting to be filled rather than as panel nobody used.
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  // A fraction of the screen rather than a spacing token, because what it is
  // measured against is the screen: most of it, less the room the box, the
  // footer and the offset from the top take, so the panel stops short of the
  // bottom edge on any monitor.
  blockSize: "60vh",
  borderRadius: "md",
  overflowY: "auto",
  padding: 1,
  // A bar the width of a hairline and the color of one, because this list is
  // scrolled with the arrow keys: what it is for here is saying there is more
  // below, not being dragged.
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
  // So a row scrolled to by `keepInView` lands inside the box rather than
  // flush against the edge it came over.
  scrollPaddingBlock: 1,
});

// The same ground and the same height as the rows beside it, so the two read
// as one box split in half.
//
// Its own color, because the pane is a region of its own: text in it is drawn
// in the panel's foreground rather than whatever the document defaults to,
// which over the glass was a dark gray on dark glass.
//
// Scrolled when a file's text or a folder's entries run past it, with the same
// hairline bar as the rows.
const previewStyles = css({
  backgroundColor: "color-mix(in oklab, {colors.foreground} 4%, transparent)",
  blockSize: "60vh",
  borderRadius: "md",
  color: "foreground",
  overflowY: "auto",
  scrollbarColor: "{colors.border} transparent",
  scrollbarWidth: "thin",
});

// A picture or a video the size of the pane at most, and never cropped.
const mediaStyles = css({
  blockSize: "100%",
  display: "block",
  inlineSize: "100%",
  objectFit: "contain",
});

// A pane with no picture of its own: a large outline glyph for the kind of
// thing it is about, in the middle, quiet enough to read as an absence rather
// than as something to look at, over what it is and why that is all.
const placeholderStyles = vstack({
  blockSize: "100%",
  color: "muted",
  gap: 2,
  justifyContent: "center",
  padding: 6,
  textAlign: "center",
});

// An application's icon at the glyph's size, whatever size the file is.
const placeholderPictureStyles = css({
  blockSize: 16,
  inlineSize: 16,
  objectFit: "contain",
});

const placeholderTitleStyles = css({
  color: "foreground",
  fontSize: "md",
  maxInlineSize: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const placeholderNoteStyles = css({
  fontSize: "sm",
});

// An application's comment over its command, each a line of its own.
const appNoteStyles = vstack({
  gap: 2,
});

// The command as it will be run: monospaced, and broken anywhere rather than
// run off the pane, because a path in it has no spaces to break at.
const commandStyles = css({
  color: "textTertiary",
  fontFamily: "mono",
  wordBreak: "break-all",
});

// The page a URL is, drawn small. The pointer reaches it so the wheel scrolls
// it; the focus a click takes is `keepKeyboardIn`'s to give back.
const viewStyles = css({
  blockSize: "100%",
  border: "none",
  display: "block",
  inlineSize: "100%",
});

const listStyles = flex({
  direction: "column",
  gap: 0.5,
});

const rowStyles = hstack({
  // The highlighted row, walked to by the keyboard or the pointer, in the
  // desktop's own accent: a wash that fades across the row rather than a band
  // of flat color. There is no hover beside it — the pointer moves this.
  "&[data-highlighted]": {
    backgroundImage:
      "linear-gradient(to right, color-mix(in oklab, {colors.accent} 30%, transparent), color-mix(in oklab, {colors.accent} 8%, transparent))",
  },
  // A SOLID GLYPH FOR THE HIGHLIGHTED ROW. An outline glyph is mostly the
  // ground it is drawn on, so a row that lightens its ground takes the glyph's
  // contrast with it and the thing meant to be read best is read worst.
  "&[data-highlighted] [data-row-glyph=reached]": { opacity: 1 },
  "&[data-highlighted] [data-row-glyph=resting]": { opacity: 0 },
  "&[data-highlighted] [data-row-tile]": {
    backgroundColor: "color-mix(in oklab, {colors.accent} 28%, transparent)",
    borderColor: "color-mix(in oklab, {colors.accent} 45%, transparent)",
    color: "accent",
  },
  borderRadius: "md",
  color: "foreground",
  cursor: "pointer",
  fontSize: "sm",
  gap: 2.5,
  paddingBlock: 1.5,
  paddingInline: 2,
  transition: "background-color {durations.fast} {easings.out}",
});

// The glyph sits in a tile of its own rather than loose beside the name: it
// gives every row the same shoulder to start at whatever the name's length,
// and it is the thing the highlight can light up without touching the text.
const rowTileStyles = css({
  blockSize: 7,
  border: "1px solid color-mix(in oklab, {colors.foreground} 8%, transparent)",
  borderRadius: "sm",
  color: "muted",
  display: "grid",
  flexShrink: 0,
  inlineSize: 7,
  placeItems: "center",
  transition:
    "background-color {durations.fast} {easings.out}, border-color {durations.fast} {easings.out}, color {durations.fast} {easings.out}",
});

// A picture in a glyph tile's place: the tile's size, with no frame to stay
// inside of.
const pictureTileStyles = css({
  blockSize: 7,
  display: "grid",
  flexShrink: 0,
  inlineSize: 7,
  placeItems: "center",
});

// An icon a little bigger than the glyph, whatever size the file is: the frame
// a glyph has is what makes up the difference.
const rowPictureStyles = css({
  blockSize: 5,
  inlineSize: 5,
  objectFit: "contain",
});

// Both weights in the one cell the tile has, so the swap moves nothing and
// the tile's size is the glyph's whichever of them is showing.
const rowGlyphStyles = css({
  // The outline one is what a row is drawn with, so it is the one that needs
  // no rule; the row above is what shows the other.
  "&[data-row-glyph=reached]": { opacity: 0 },
  display: "inline-flex",
  gridArea: "1 / 1",
  transition: "opacity {durations.fast} {easings.out}",
});

// The letters the query is responsible for. `mark`'s own yellow is a
// highlighter pen on a page; what this is marking is why a row is on screen,
// so it is said in the color the desktop says "this one" in. Bold by stroke
// rather than weight: a heavier letter is a wider one, and the row would shift
// with every key pressed. The stroke is painted under each letter so only its
// outer half shows, which thickens the letter without filling in its holes.
const markStyles = css({
  backgroundColor: "transparent",
  color: "accent",
  paintOrder: "stroke",
  WebkitTextStroke: "{borderWidths.fauxBold} currentColor",
});

// The directory over the name, each a line of its own that gives way at its
// own end: stacked, neither can take the other's width, and the row needs only
// as much of the panel as its longer line.
const rowTextStyles = css({
  display: "flex",
  flex: "1 1 auto",
  flexDirection: "column",
  minInlineSize: 0,
});

// What was typed part of, so the larger of the two lines.
const rowNameStyles = css({
  fontSize: "md",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// What a site or a search row does, said quieter than what it does it to.
const rowVerbStyles = css({
  color: "muted",
});

// A small line over the name. A directory is what tells two files of one name
// apart, so it is read when the names alone have not settled it, and it is
// said quieter than the name for that reason.
const rowDirectoryStyles = css({
  color: "muted",
  fontSize: "xs",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

// Figures that keep their width as they change, so the counter does not
// shuffle sideways under the typing.
const countStyles = css({
  color: "muted",
  fontSize: "xs",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});

// A row's inset, so its glyph lines up under the tiles above it, in the color
// the panel says everything provisional in.
const indexingStyles = hstack({
  color: "muted",
  fontSize: "xs",
  gap: 1.5,
  margin: 0,
  paddingBlock: 1.5,
  paddingInline: 2,
});

// A full turn, for the one thing on this panel that is still happening. On the
// span rather than on the glyph, because a Phosphor icon is somebody else's
// component and this panel styles its icons by what they sit in — the same
// wrapper the row tiles use.
//
// `prefers-reduced-motion` stops it: what the line says is in the words, and
// the turn is only what keeps them from reading as a state nobody is working
// on.
const spinnerStyles = css({
  _motionReduce: { animationName: "none" },
  alignItems: "center",
  animation: "spin {durations.spin} {easings.linear} infinite",
  color: "accent",
  display: "inline-flex",
  flexShrink: 0,
});

const keysStyles = hstack({
  color: "muted",
  fontSize: "xs",
  gap: 4,
});

const keyStyles = hstack({
  gap: 1,
});
