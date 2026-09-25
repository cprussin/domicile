import { describe, expect, it } from "bun:test";
import { FilePreview } from "@domicile/chrome-sdk/file-preview";
import type { FilePreviewMessage } from "@domicile/chrome-sdk/host-message";
import { act, renderHook } from "@testing-library/react";

import { usePreview } from "./usePreview";

/** The host's preview, answered by the test in whatever order it likes. */
const host = () => {
  const asked: { path: string; settle: (found: FilePreviewMessage) => void }[] =
    [];
  const preview = (path: string) =>
    new Promise<FilePreviewMessage>((settle) => {
      asked.push({ path, settle });
    });
  return {
    answers: async (at: number, text: string): Promise<void> => {
      const asking = asked[at];
      if (asking === undefined) {
        throw new Error(`nothing was asked at ${at.toString()}`);
      } else {
        await act(async () => {
          asking.settle({
            path: asking.path,
            preview: FilePreview.Text(text),
          });
          await Promise.resolve();
        });
      }
    },
    preview,
  };
};

describe("usePreview", () => {
  it("is what the host said the path holds", async () => {
    const home = host();
    const { result } = renderHook(() => usePreview(home.preview, "a.txt"));

    await home.answers(0, "ay");

    expect(result.current).toStrictEqual(FilePreview.Text("ay"));
  });

  it("drops the answer for a path the highlight has already left", async () => {
    // An arrow key is faster than a disk, and the host owes the answers no
    // order: the pane shows the row it is on, not the one answered last.
    const home = host();
    const { rerender, result } = renderHook(
      ({ path }) => usePreview(home.preview, path),
      { initialProps: { path: "a.txt" } },
    );
    rerender({ path: "b.txt" });

    await home.answers(1, "bee");
    await home.answers(0, "ay");

    expect(result.current).toStrictEqual(FilePreview.Text("bee"));
  });
});
