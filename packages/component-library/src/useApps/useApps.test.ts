import { describe, expect, it } from "bun:test";
import { fakeSystem } from "@domicile-desktop/system-apps/fake-system";
import { renderHook, waitFor } from "@testing-library/react";

import { useApps } from "./useApps";

// Created outside render, since a new system reads again.
const system = fakeSystem(
  {
    "/share/applications/us.zoom.Zoom.desktop":
      "[Desktop Entry]\nType=Application\nName=Zoom\nExec=zoom\nIcon=zoom\n",
    "/share/icons/hicolor/scalable/apps/zoom.svg": "svg",
  },
  () => ({ code: 0, stderr: "", stdout: "XDG_DATA_DIRS=/share\0" }),
);

describe("useApps", () => {
  it("names an application by its desktop entry, with its icon", async () => {
    const { result } = renderHook(() => useApps(system, ["us.zoom.Zoom"]));

    await waitFor(() => {
      expect(result.current("us.zoom.Zoom")).toStrictEqual({
        icon: "data:image/svg+xml;base64,c3Zn",
        name: "Zoom",
      });
    });
  });

  it("names an application with no entry by its id", async () => {
    const { result } = renderHook(() =>
      useApps(system, ["us.zoom.Zoom", "org.example.Unknown"]),
    );
    await waitFor(() => {
      expect(result.current("us.zoom.Zoom").name).toBe("Zoom");
    });

    expect(result.current("org.example.Unknown")).toStrictEqual({
      icon: undefined,
      name: "org.example.Unknown",
    });
  });

  it("names an application with no id", () => {
    const { result } = renderHook(() => useApps(system, [""]));

    expect(result.current("")).toStrictEqual({
      icon: undefined,
      name: "An application",
    });
  });
});
