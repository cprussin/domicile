import { describe, expect, it, spyOn } from "bun:test";
import { Err, Ok } from "@cprussin/option-result";
import type { System } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { act, renderHook } from "@testing-library/react";

import { usePictureUrl } from "./usePictureUrl";

const SKY = new TextEncoder().encode("sky");

// Each `files` is created outside render, since a new one reads again.
const files: Pick<System, "readFile"> = {
  readFile: (path) =>
    Promise.resolve(
      path === "/missing.jpg"
        ? Err({ kind: SystemErrorKind.NotFound, message: "gone" })
        : Ok(SKY),
    ),
};

describe("usePictureUrl", () => {
  it("is nothing for no path", () => {
    const { result } = renderHook(() => usePictureUrl(files, undefined));

    expect(result.current).toBeUndefined();
  });

  it("is a blob URL once the file is read", async () => {
    const { result } = renderHook(() => usePictureUrl(files, "/sky.jpg"));
    await act(() => Promise.resolve());

    expect(result.current).toStartWith("blob:");
  });

  it("is nothing, and says why, for a file it cannot read", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {
      /* asserted below */
    });
    const { result } = renderHook(() => usePictureUrl(files, "/missing.jpg"));
    await act(() => Promise.resolve());

    expect(result.current).toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
