import { describe, expect, it, spyOn } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";
import { act, renderHook } from "@testing-library/react";

import { useRequests } from "./useRequests";

const REFUSED: SystemError = {
  kind: SystemErrorKind.Dbus,
  message: "org.bluez.Error.Failed: Page Timeout",
};

/** A request the test settles. */
const held = () => Promise.withResolvers<Result<"done", SystemError>>();

describe("useRequests", () => {
  it("marks a request pending until it settles", async () => {
    const { result } = renderHook(() => useRequests());
    const request = held();

    act(() => {
      result.current.run("connect", () => request.promise);
    });

    expect(result.current.pending("connect")).toBe(true);
    expect(result.current.pending("scan")).toBe(false);

    await act(async () => {
      request.resolve(Ok("done"));
      await request.promise;
    });

    expect(result.current.pending("connect")).toBe(false);
    expect(result.current.failed("connect")).toBeUndefined();
  });

  it("keeps a refusal until the request runs again", async () => {
    const { result } = renderHook(() => useRequests());

    await act(async () => {
      result.current.run("connect", () => Promise.resolve(Err(REFUSED)));
      await Bun.sleep(0);
    });

    expect(result.current.failed("connect")).toStrictEqual(REFUSED);

    const again = held();
    act(() => {
      result.current.run("connect", () => again.promise);
    });

    expect(result.current.failed("connect")).toBeUndefined();
  });

  it("logs a request that throws", async () => {
    const logged = new Promise<unknown[]>((resolve) => {
      spyOn(console, "error").mockImplementationOnce((...args) => {
        resolve(args);
      });
    });
    const { result } = renderHook(() => useRequests());
    const broken = new Error("test: broken");

    await act(async () => {
      result.current.run("scan", () => Promise.reject(broken));
      await Bun.sleep(0);
    });

    expect(await logged).toStrictEqual(["Failed to send scan", broken]);
    expect(result.current.pending("scan")).toBe(false);
  });
});
