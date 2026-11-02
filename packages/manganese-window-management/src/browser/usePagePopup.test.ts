import { describe, expect, it } from "bun:test";
import { act, renderHook } from "@testing-library/react";

import { PagePopupKind, usePagePopup } from "./usePagePopup";

describe(usePagePopup, () => {
  it("shows nothing at first, even with downloads already finished", () => {
    const { result } = renderHook(() => usePagePopup(2, true));
    expect(result.current.kind).toBeUndefined();
  });

  it("shows the downloads when one more finishes", () => {
    const { rerender, result } = renderHook(
      (completed: number) => usePagePopup(completed, true),
      { initialProps: 0 },
    );
    rerender(1);
    expect(result.current.kind).toBe(PagePopupKind.Downloads);
  });

  it("shows nothing when finished downloads are cleared", () => {
    const { rerender, result } = renderHook(
      (completed: number) => usePagePopup(completed, true),
      { initialProps: 2 },
    );
    rerender(1);
    expect(result.current.kind).toBeUndefined();
  });

  it("swaps one popup for another", () => {
    const { rerender, result } = renderHook(
      (completed: number) => usePagePopup(completed, true),
      { initialProps: 0 },
    );
    rerender(1);
    act(() => {
      result.current.show(PagePopupKind.Zoom);
    });
    expect(result.current.kind).toBe(PagePopupKind.Zoom);
  });

  // A zoom right after the downloads popup closed once brought it back.
  it("never brings a closed popup back", () => {
    const { rerender, result } = renderHook(
      (completed: number) => usePagePopup(completed, true),
      { initialProps: 0 },
    );
    rerender(1);
    act(() => {
      result.current.close(result.current.cue);
    });
    act(() => {
      result.current.show(PagePopupKind.Zoom);
    });
    rerender(1);
    expect(result.current.kind).toBe(PagePopupKind.Zoom);
  });

  it("closes only what it is asked to, not what replaced it", () => {
    const { rerender, result } = renderHook(
      (completed: number) => usePagePopup(completed, true),
      { initialProps: 0 },
    );
    rerender(1);
    const downloads = result.current.cue;
    act(() => {
      result.current.show(PagePopupKind.Zoom);
    });
    act(() => {
      result.current.close(downloads);
    });
    expect(result.current.kind).toBe(PagePopupKind.Zoom);
  });

  it("counts each showing, so a repeat restarts its time", () => {
    const { result } = renderHook(() => usePagePopup(0, true));
    act(() => {
      result.current.show(PagePopupKind.Zoom);
    });
    const first = result.current.cue;
    act(() => {
      result.current.show(PagePopupKind.Zoom);
    });
    expect(result.current.cue).toBeGreaterThan(first);
  });

  // Another window opening over it, or taking the focus, put it out of view;
  // its popup stayed over the new window.
  it("closes once its window is out of view, and stays closed after", () => {
    const { rerender, result } = renderHook(
      (inView: boolean) => usePagePopup(0, inView),
      { initialProps: true },
    );
    act(() => {
      result.current.show(PagePopupKind.Zoom);
    });
    rerender(false);
    expect(result.current.kind).toBeUndefined();
    rerender(true);
    expect(result.current.kind).toBeUndefined();
  });

  it("does not show downloads that finish while its window is out of view", () => {
    const { rerender, result } = renderHook(
      ({ completed, inView }: { completed: number; inView: boolean }) =>
        usePagePopup(completed, inView),
      { initialProps: { completed: 0, inView: false } },
    );
    rerender({ completed: 1, inView: false });
    rerender({ completed: 1, inView: true });
    expect(result.current.kind).toBeUndefined();
  });
});
