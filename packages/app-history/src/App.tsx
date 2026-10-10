import { Button } from "@domicile-desktop/component-library/Button";
import type { Point } from "@domicile-desktop/component-library/ContextMenu";
import { ContextMenu } from "@domicile-desktop/component-library/ContextMenu";
import {
  createToastManager,
  Toaster,
} from "@domicile-desktop/component-library/Toaster";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ClockCounterClockwise";
import { LinkIcon } from "@phosphor-icons/react/dist/ssr/Link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { css } from "../styled-system/css";
import { flex, vstack } from "../styled-system/patterns";
import { Atmosphere } from "./Atmosphere";
import type { Browser } from "./browser";
import { ClearDataDialog } from "./ClearDataDialog";
import { domain } from "./domain";
import { EmptyState } from "./EmptyState";
import { groupByDay } from "./entries";
import type { Failure } from "./failure";
import { FailedTask } from "./failure";
import { Header } from "./Header";
import { HistoryList } from "./HistoryList";
import type { Entry } from "./history-page";
import { ListFoot } from "./ListFoot";
import { LoadingRows } from "./LoadingRows";
import { RemoveDialog } from "./RemoveDialog";
import { SelectionBar } from "./SelectionBar";
import { toggleSelection } from "./selection";
import { useDebounced } from "./useDebounced";
import { useHistory } from "./useHistory";

/** How long typing must pause before the list searches. */
const SEARCH_DELAY_MS = 150;

/** How long a toast stays. */
const TOAST_MS = 4000;

type Props = {
  browser: Browser;
  now?: (() => number) | undefined;
};

/** The History page: the list, its search, and the dialogs around it. */
export const App = ({ browser, now = Date.now }: Props) => {
  const [toasts] = useState(createToastManager);
  const [search, setSearch] = useState("");
  const text = useDebounced(search, SEARCH_DELAY_MS);
  const history = useHistory({ browser, now, text });
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | undefined>(undefined);
  const [menu, setMenu] = useState<{ at: Point; entry: Entry } | undefined>(
    undefined,
  );
  const [removing, setRemoving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const scroller = useRef<HTMLElement>(null);

  const { entries, failure, leaving, loadMore, remove, settle } = history;
  const days = useMemo(() => groupByDay(entries), [entries]);
  const order = useMemo(() => entries.map((entry) => entry.id), [entries]);
  // Rows that were removed or reloaded away drop out of the selection.
  const selected = useMemo(
    () => checked.intersection(new Set(order)).difference(leaving),
    [checked, order, leaving],
  );

  const report = useCallback(
    (title: string) => (cause: unknown) => {
      toasts.add({
        description: cause instanceof Error ? cause.message : String(cause),
        timeout: TOAST_MS,
        title,
        type: "danger",
      });
    },
    [toasts],
  );

  // The last failure toasted, so a change in the rows doesn't toast it again.
  const reported = useRef<Failure | undefined>(undefined);
  useEffect(() => {
    if (
      failure !== undefined &&
      failure !== reported.current &&
      entries.length > 0
    ) {
      reported.current = failure;
      report("Couldn't update your history")(failure.error);
    }
  }, [entries.length, failure, report]);

  const onToggle = useCallback(
    (id: string, shift: boolean) => {
      setChecked((current) =>
        toggleSelection(current, order, {
          anchor: shift ? anchor : undefined,
          id,
        }),
      );
      setAnchor(id);
    },
    [anchor, order],
  );

  const openInNewWindow = useCallback(
    (entry: Entry) => {
      browser
        .openInNewWindow(entry.url)
        .catch(report("Couldn't open a new window"));
    },
    [browser, report],
  );

  const clearSelection = useCallback(() => {
    setChecked(new Set());
    setAnchor(undefined);
  }, []);

  const searchFor = (value: string) => {
    setSearch(value);
    scroller.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (selected.size > 0 && !isTextField(event.target)) {
        if (event.key === "Delete") {
          event.preventDefault();
          setRemoving(true);
        } else if (event.key === "Escape") {
          clearSelection();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [clearSelection, selected]);

  return (
    <Toaster.Provider toastManager={toasts}>
      <div className={pageStyles}>
        <Atmosphere />
        <Header
          onClearData={() => {
            setClearing(true);
          }}
          onSearch={searchFor}
          scrolled={scrolled}
          search={search}
        />
        <main
          className={scrollerStyles}
          onScroll={(event) => {
            setScrolled(event.currentTarget.scrollTop > 0);
          }}
          ref={scroller}
        >
          <div className={columnStyles}>
            <Content
              history={history}
              list={
                <HistoryList
                  days={days}
                  faviconUrl={browser.faviconUrl}
                  leaving={leaving}
                  menuFor={menu?.entry.id}
                  now={now()}
                  onLeft={settle}
                  onMenu={(entry, at) => {
                    setMenu({ at, entry });
                  }}
                  onOpenInNewWindow={openInNewWindow}
                  onToggle={onToggle}
                  search={text}
                  selected={selected}
                />
              }
              onClearSearch={() => {
                searchFor("");
              }}
              onLoadMore={loadMore}
              search={text}
            />
          </div>
        </main>
        <SelectionBar
          count={selected.size}
          onCancel={clearSelection}
          onDelete={() => {
            setRemoving(true);
          }}
        />
        {menu !== undefined && (
          <ContextMenu
            at={menu.at}
            label={`Actions for ${menu.entry.title === "" ? menu.entry.url : menu.entry.title}`}
            onOpenChange={(open) => {
              if (!open) {
                setMenu(undefined);
              }
            }}
            open
          >
            <ContextMenu.Item
              icon={<ArrowSquareOutIcon />}
              onClick={() => {
                openInNewWindow(menu.entry);
              }}
            >
              Open in new window
            </ContextMenu.Item>
            <ContextMenu.Item
              icon={<LinkIcon />}
              onClick={() => {
                browser
                  .copyText(menu.entry.url)
                  .then(() => {
                    toasts.add({ timeout: TOAST_MS, title: "Link copied" });
                  })
                  .catch(report("Couldn't copy the link"));
              }}
            >
              Copy link
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              icon={<MagnifyingGlassIcon />}
              onClick={() => {
                searchFor(domain(menu.entry.url));
              }}
            >
              More from this site
            </ContextMenu.Item>
            <ContextMenu.Item
              icon={<TrashIcon />}
              onClick={() => {
                remove(new Set([menu.entry.id]));
              }}
            >
              Remove from history
            </ContextMenu.Item>
          </ContextMenu>
        )}
        <RemoveDialog
          count={selected.size}
          onConfirm={() => {
            remove(selected);
            clearSelection();
            setRemoving(false);
          }}
          onOpenChange={setRemoving}
          open={removing}
        />
        <ClearDataDialog
          now={now}
          onCleared={() => {
            toasts.add({
              description: "The data you chose is gone from this browser.",
              timeout: TOAST_MS,
              title: "Browsing data cleared",
            });
          }}
          onFailed={report("Couldn't clear browsing data")}
          onOpenChange={setClearing}
          open={clearing}
          removeBrowsingData={browser.removeBrowsingData}
        />
        <div className={toastAreaStyles}>
          <Toaster label="Notifications">
            {(toast) => (
              <div className={toastStyles}>
                <span className={toastTitleStyles}>
                  <Toaster.Title>{toast.title}</Toaster.Title>
                </span>
                {toast.description !== undefined && (
                  <span className={toastDescriptionStyles}>
                    <Toaster.Description>
                      {toast.description}
                    </Toaster.Description>
                  </span>
                )}
              </div>
            )}
          </Toaster>
        </div>
      </div>
    </Toaster.Provider>
  );
};

type ContentProps = {
  history: ReturnType<typeof useHistory>;
  list: ReactNode;
  onClearSearch: () => void;
  onLoadMore: () => void;
  search: string;
};

/** The list, or what stands in for it while loading, empty or failed. */
const Content = ({
  history: { complete, entries, failure, loading, retry },
  list,
  onClearSearch,
  onLoadMore,
  search,
}: ContentProps) => {
  if (entries.length > 0) {
    return (
      <>
        {list}
        <ListFoot
          complete={complete}
          failed={
            failure?.task === FailedTask.LoadMore ||
            failure?.task === FailedTask.Reload
          }
          loading={loading}
          onLoadMore={onLoadMore}
          onRetry={retry}
        />
      </>
    );
  } else if (failure !== undefined) {
    return (
      <EmptyState
        icon={<WarningCircleIcon />}
        title="Couldn't load your history"
        tone="danger"
      >
        {failure.error instanceof Error
          ? failure.error.message
          : String(failure.error)}
      </EmptyState>
    );
  } else if (loading) {
    return <LoadingRows />;
  } else if (search === "") {
    return (
      <EmptyState
        icon={<ClockCounterClockwiseIcon />}
        title="Your history is empty"
      >
        Pages you visit show up here, newest first, so you can find your way
        back to them.
      </EmptyState>
    );
  } else {
    return (
      <EmptyState
        action={
          <Button onClick={onClearSearch} rounded size="sm" variant="outline">
            Clear search
          </Button>
        }
        icon={<MagnifyingGlassIcon />}
        title="No search results found"
      >
        Nothing in your history matches “{search}”.
      </EmptyState>
    );
  }
};

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

const pageStyles = flex({
  backgroundColor: "background",
  blockSize: "100dvh",
  direction: "column",
  isolation: "isolate",
  overflow: "hidden",
  position: "relative",
});

const scrollerStyles = css({
  flexGrow: 1,
  overflowY: "auto",
  paddingBlockEnd: 28,
  paddingInline: 6,
  position: "relative",
  scrollPaddingBlock: 14,
  zIndex: 1,
});

const columnStyles = css({
  marginInline: "auto",
  maxInlineSize: 200,
  paddingBlockStart: 2,
});

const toastAreaStyles = css({
  inlineSize: 96,
  insetBlockStart: 4,
  insetInlineEnd: 4,
  position: "fixed",
  zIndex: "toast",
});

const toastStyles = vstack({
  alignItems: "flex-start",
  gap: 0.5,
  paddingBlock: 3,
  paddingInline: 4,
});

const toastTitleStyles = css({
  color: "foreground",
  fontSize: "sm",
  fontWeight: "semibold",
});

const toastDescriptionStyles = css({
  color: "muted",
  fontSize: "xs",
});
