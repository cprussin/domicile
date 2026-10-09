import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { appIcons } from "./app-icons";
import { fakeSystem } from "./fake-system";

const found = (url: string): Result<Option<string>, SystemError> =>
  Ok(Some(url));

const missing: Result<Option<string>, SystemError> = Ok(None());

describe("appIcons", () => {
  it("finds a themed icon in hicolor at the size a row wants", async () => {
    const icon = appIcons(
      fakeSystem({
        "/share/icons/hicolor/16x16/apps/editor.png": "small",
        "/share/icons/hicolor/48x48/apps/editor.png": "png",
      }),
      ["/share"],
    );

    expect(await icon("editor")).toStrictEqual(
      found("data:image/png;base64,cG5n"),
    );
  });

  it("reads a scalable icon as an SVG", async () => {
    const icon = appIcons(
      fakeSystem({ "/share/icons/hicolor/scalable/apps/editor.svg": "svg" }),
      ["/share"],
    );

    expect(await icon("editor")).toStrictEqual(
      found("data:image/svg+xml;base64,c3Zn"),
    );
  });

  it("prefers an earlier data directory, and uses pixmaps last", async () => {
    const icon = appIcons(
      fakeSystem({
        "/system/icons/hicolor/48x48/apps/editor.png": "system",
        "/system/pixmaps/clock.png": "png",
        "/user/icons/hicolor/16x16/apps/editor.png": "user",
        "/user/pixmaps/editor.png": "pixmap",
      }),
      ["/user", "/system"],
    );

    expect(await icon("editor")).toStrictEqual(
      found("data:image/png;base64,dXNlcg=="),
    );
    expect(await icon("clock")).toStrictEqual(
      found("data:image/png;base64,cG5n"),
    );
  });

  it("searches the contexts it is given, in order", async () => {
    const icon = appIcons(
      fakeSystem({
        "/share/icons/hicolor/16x16/status/exit.png": "status",
        "/share/icons/hicolor/48x48/apps/exit.png": "app",
        "/share/icons/hicolor/48x48/status/muted.png": "png",
      }),
      ["/share"],
      ["status", "apps"],
    );

    expect(await icon("exit")).toStrictEqual(
      found("data:image/png;base64,c3RhdHVz"),
    );
    expect(await icon("muted")).toStrictEqual(
      found("data:image/png;base64,cG5n"),
    );
  });

  it("reads an absolute icon as that file", async () => {
    const icon = appIcons(fakeSystem({ "/opt/editor/icon.svg": "svg" }), [
      "/share",
    ]);

    expect(await icon("/opt/editor/icon.svg")).toStrictEqual(
      found("data:image/svg+xml;base64,c3Zn"),
    );
  });

  it("finds nothing a page cannot draw, nothing too large, and nothing missing", async () => {
    const icon = appIcons(
      fakeSystem({
        "/share/icons/hicolor/48x48/apps/huge.png": new Uint8Array(
          128 * 1024 + 1,
        ),
        "/share/pixmaps/old.xpm": "xpm",
      }),
      ["/share"],
    );

    expect(await icon("old")).toStrictEqual(missing);
    expect(await icon("huge")).toStrictEqual(missing);
    expect(await icon("missing")).toStrictEqual(missing);
  });

  it("looks each name up once", async () => {
    const system = fakeSystem({
      "/share/icons/hicolor/48x48/apps/editor.png": "png",
    });
    const icon = appIcons(system, ["/share"]);

    await icon("editor");
    const looked = system.touched.length;
    await icon("editor");

    expect(system.touched.length).toBe(looked);
  });

  it("fails when the desktop refuses to look", async () => {
    const icon = appIcons(
      fakeSystem({
        "/share/icons/hicolor": { fails: SystemErrorKind.Locked },
      }),
      ["/share"],
    );

    expect(await icon("editor")).toStrictEqual(
      Err({ kind: SystemErrorKind.Locked, message: "/share/icons/hicolor" }),
    );
  });
});
