// The rows the list shows, kept in step with the browser's history.

import { useCallback, useEffect, useRef, useState } from "react";

import type { Browser } from "./browser";
import { startOfDay } from "./day";
import { appendEntries } from "./entries";
import { FailedTask, Failure } from "./failure";
import type { Entry, Page, PageQuery } from "./history-page";
import { loadPage, loadSince } from "./history-page";

/** Rows per page, as chrome://history loads them. */
const PAGE_SIZE = 150;

/**
 * How long the history must be quiet before the list reloads. Longer than a
 * row takes to leave, so a removal's own change doesn't cut its rows short.
 */
const RELOAD_DELAY_MS = 500;

type Options = {
  browser: Browser;
  /** The search; empty for the whole history. */
  text: string;
  now?: (() => number) | undefined;
  pageSize?: number | undefined;
};

export type History = {
  /** Whether every row has loaded. */
  complete: boolean;
  entries: Entry[];
  /** What failed last, until a load succeeds. */
  failure: Failure | undefined;
  /** Rows whose visits are gone, on their way out until {@link settle}. */
  leaving: ReadonlySet<string>;
  loading: boolean;
  /** Loads the next page, unless one is loading or none is left. */
  loadMore: () => void;
  /** Tries a failed load again. A failed removal is not retried. */
  retry: () => void;
  /** Deletes the rows' visits from the history, then marks them leaving. */
  remove: (ids: ReadonlySet<string>) => void;
  /** Drops a row that has finished leaving. */
  settle: (id: string) => void;
};

type State = {
  entries: Entry[];
  failure: Failure | undefined;
  leaving: ReadonlySet<string>;
  loading: boolean;
  next: number | undefined;
  /** Rows removed since the rows were last replaced. */
  removed: ReadonlySet<string>;
};

const LOADING: State = {
  entries: [],
  failure: undefined,
  leaving: new Set(),
  loading: true,
  next: undefined,
  removed: new Set(),
};

/** The history's rows for `text`, newest first, a page at a time. */
export const useHistory = ({
  browser,
  now = Date.now,
  pageSize = PAGE_SIZE,
  text,
}: Options): History => {
  const [state, setState] = useState<State>(LOADING);
  // Bumped by every load that replaces the rows, so an older load's answer
  // is dropped.
  const generation = useRef(0);

  /**
   * Loads with `fetch` and puts its rows in place with `merge`, which sees
   * the rows as they are when the answer comes.
   */
  const load = useCallback(
    (
      fetch: (query: PageQuery) => Promise<Page>,
      endTime: number,
      merge: (current: State, page: Entry[]) => Merged,
      failed: (error: unknown) => Failure,
    ) => {
      const started = ++generation.current;
      fetch({
        endTime,
        hiddenOrigin: browser.hiddenOrigin,
        maxResults: pageSize,
        text,
      }).then(
        (page) => {
          if (started === generation.current) {
            setState((current) => {
              const { entries, removed } = merge(current, page.entries);
              return {
                entries,
                failure: undefined,
                // A leaving row the new rows lack will never end its
                // animation, so it stops leaving here.
                leaving: current.leaving.intersection(
                  new Set(entries.map((entry) => entry.id)),
                ),
                loading: false,
                next: page.next,
                removed,
              };
            });
          }
        },
        (error: unknown) => {
          if (started === generation.current) {
            setState((current) => ({
              ...current,
              failure: failed(error),
              loading: false,
            }));
          }
        },
      );
    },
    [browser, pageSize, text],
  );

  const start = useCallback(() => {
    setState(LOADING);
    load(
      (query) => loadPage(browser, query),
      now(),
      replaceEntries,
      Failure.Load,
    );
  }, [browser, load, now]);

  useEffect(start, [start]);

  // Read when a reload fires, so loading more rows meanwhile doesn't cancel it.
  const oldest = useRef<number | undefined>(undefined);
  useEffect(() => {
    oldest.current = state.entries.at(-1)?.time;
  }, [state.entries]);

  const reload = useCallback(() => {
    // Loading, so no page is asked for while this answer is due.
    setState((current) => ({ ...current, loading: true }));
    load(
      (query) => loadSince(browser, oldest.current ?? now(), query),
      now(),
      replaceEntries,
      Failure.Reload,
    );
  }, [browser, load, now]);

  useEffect(() => {
    const timer: { id: ReturnType<typeof setTimeout> | undefined } = {
      id: undefined,
    };
    const stop = browser.onChange(() => {
      clearTimeout(timer.id);
      timer.id = setTimeout(reload, RELOAD_DELAY_MS);
    });
    return () => {
      clearTimeout(timer.id);
      stop();
    };
  }, [browser, reload]);

  const { loading, next } = state;
  const loadMore = useCallback(() => {
    if (!loading && next !== undefined) {
      setState((current) => ({ ...current, loading: true }));
      load(
        (query) => loadPage(browser, query),
        next,
        appendPage,
        Failure.LoadMore,
      );
    }
  }, [browser, load, loading, next]);

  const remove = useCallback(
    (ids: ReadonlySet<string>) => {
      const rows = state.entries.filter((entry) => ids.has(entry.id));
      Promise.all(rows.map((row) => visitsOnDay(browser, row)))
        .then((visits) => browser.deleteVisits(visits.flat()))
        .then(
          () => {
            setState((current) => ({
              ...current,
              leaving: current.leaving.union(ids),
              removed: current.removed.union(ids),
            }));
          },
          (error: unknown) => {
            setState((current) => ({
              ...current,
              failure: Failure.Remove(error),
            }));
          },
        );
    },
    [browser, state.entries],
  );

  const settle = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== id),
      leaving: current.leaving.difference(new Set([id])),
    }));
  }, []);

  const { failure } = state;
  const retry = useCallback(() => {
    switch (failure?.task) {
      case FailedTask.Load:
        return start();
      case FailedTask.LoadMore:
        return loadMore();
      case FailedTask.Reload:
        return reload();
      case FailedTask.Remove:
      case undefined:
        throw new Error("nothing to try again");
    }
  }, [failure, loadMore, reload, start]);

  return {
    complete: !state.loading && state.next === undefined,
    entries: state.entries,
    failure,
    leaving: state.leaving,
    loading: state.loading,
    loadMore,
    remove,
    retry,
    settle,
  };
};

/** The rows after a load, and the removed rows a later page must not restore. */
type Merged = { entries: Entry[]; removed: ReadonlySet<string> };

/**
 * A reload's rows replace the list. They come from the history after any
 * removal, so nothing removed needs holding back.
 */
const replaceEntries = (_current: State, page: Entry[]): Merged => ({
  entries: page,
  removed: new Set(),
});

/**
 * A later page's rows follow the list's, except removed rows: the page may
 * have been read before they went.
 */
const appendPage = (current: State, page: Entry[]): Merged => ({
  entries: appendEntries(
    current.entries,
    page.filter((entry) => !current.removed.has(entry.id)),
  ),
  removed: current.removed,
});

/**
 * Every visit to `row`'s page on `row`'s day, loaded or not, which is what
 * Chrome removes with a row.
 */
const visitsOnDay = async (browser: Browser, row: Entry): Promise<number[]> =>
  (await browser.getVisits(row.url)).filter(
    (visit) => startOfDay(visit) === row.day,
  );
