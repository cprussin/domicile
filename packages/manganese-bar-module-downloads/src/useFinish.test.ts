import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import type { Download } from "@domicile-desktop/sdk/desktop/downloads";
import { DownloadState } from "@domicile-desktop/sdk/desktop/downloads";
import { act, renderHook } from "@testing-library/react";

import { DONE_MS, FULL_MS, ItemPhase, useFinish } from "./useFinish";

const download = (state: DownloadState, id = "a"): Download => ({
  id,
  page: "",
  path: `/home/me/Downloads/${id}`,
  receivedBytes: 1,
  state,
  totalBytes: 2,
  window: undefined,
});

const RUNNING = [download(DownloadState.InProgress)];
const FINISHED = [download(DownloadState.Complete)];

const follow = (initial: readonly Download[] | undefined) =>
  renderHook(
    (downloads: readonly Download[] | undefined) => useFinish(downloads),
    { initialProps: initial },
  );

describe(useFinish, () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("rests with nothing running", () => {
    expect(follow(FINISHED).result.current).toBe(ItemPhase.Resting);
  });

  it("runs while a download is in progress", () => {
    expect(follow(RUNNING).result.current).toBe(ItemPhase.Running);
  });

  it("fills, says it is done, then rests, as the last download finishes", () => {
    const { rerender, result } = follow(RUNNING);
    rerender(FINISHED);
    expect(result.current).toBe(ItemPhase.Full);

    act(() => {
      jest.advanceTimersByTime(FULL_MS);
    });
    expect(result.current).toBe(ItemPhase.Done);

    act(() => {
      jest.advanceTimersByTime(DONE_MS);
    });
    expect(result.current).toBe(ItemPhase.Resting);
  });

  it("goes straight to rest when the last running one is canceled", () => {
    const { rerender, result } = follow(RUNNING);
    rerender([]);
    expect(result.current).toBe(ItemPhase.Resting);
  });

  it("goes straight to rest when the last running one fails", () => {
    const { rerender, result } = follow(RUNNING);
    rerender([download(DownloadState.Failed)]);
    expect(result.current).toBe(ItemPhase.Resting);
  });

  it("runs again when another download starts while it says done", () => {
    const { rerender, result } = follow(RUNNING);
    rerender(FINISHED);
    act(() => {
      jest.advanceTimersByTime(FULL_MS);
    });
    rerender([...FINISHED, download(DownloadState.InProgress, "b")]);
    expect(result.current).toBe(ItemPhase.Running);

    act(() => {
      jest.advanceTimersByTime(DONE_MS);
    });
    expect(result.current).toBe(ItemPhase.Running);
  });

  it("keeps running while another download is still in progress", () => {
    const both = [
      download(DownloadState.InProgress, "a"),
      download(DownloadState.InProgress, "b"),
    ];
    const { rerender, result } = follow(both);
    rerender([
      download(DownloadState.Complete, "a"),
      download(DownloadState.InProgress, "b"),
    ]);
    expect(result.current).toBe(ItemPhase.Running);
  });
});
