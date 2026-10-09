import { describe, expect, it } from "bun:test";
import type { Option, Result } from "@cprussin/option-result";
import { Err, None, Ok, Some } from "@cprussin/option-result";
import type { SystemError } from "@domicile-desktop/sdk/system";
import { SystemErrorKind } from "@domicile-desktop/sdk/system";

import { appIcons, themedIcons } from "./app-icons";
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
        "/user/icons/hicolor/48x48/apps/editor.png": "user",
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

  it("searches only the contexts it is given", async () => {
    const icon = appIcons(
      fakeSystem({
        "/share/icons/hicolor/16x16/status/exit.png": "status",
        "/share/icons/hicolor/48x48/apps/editor.png": "png",
        "/share/icons/hicolor/48x48/apps/exit.png": "app",
      }),
      ["/share"],
      ["status"],
    );

    expect(await icon("exit")).toStrictEqual(
      found("data:image/png;base64,c3RhdHVz"),
    );
    expect(await icon("editor")).toStrictEqual(missing);
  });

  describe("with an icon theme", () => {
    const THEMED = {
      "/share/icons/breeze/actions/16/quit.svg": "breeze",
      "/share/icons/breeze/index.theme": [
        "[Icon Theme]",
        "Inherits=Papirus",
        "Directories=actions/16",
        "[actions/16]",
        "Size=16",
        "Context=Actions",
      ].join("\n"),
      "/share/icons/hicolor/16x16/actions/exit.png": "hicolor",
      "/share/icons/hicolor/16x16/actions/help.png": "help",
      "/share/icons/Papirus/16x16/actions/exit.png": "16",
      "/share/icons/Papirus/24x24/actions/exit.png": "24",
      "/share/icons/Papirus/index.theme": [
        "[Icon Theme]",
        "Name=Papirus",
        "Inherits=breeze,hicolor",
        "Directories=16x16/actions,24x24/actions,symbolic/actions",
        "",
        "[16x16/actions]",
        "Size=16",
        "Context=Actions",
        "Type=Fixed",
        "",
        "[24x24/actions]",
        "Size=24",
        "Context=Actions",
        "Type=Threshold",
        "",
        "[symbolic/actions]",
        "Size=16",
        "MinSize=32",
        "MaxSize=512",
        "Context=Actions",
        "Type=Scalable",
      ].join("\n"),
      "/share/icons/Papirus/symbolic/actions/exit.svg": "scalable",
      "/share/icons/Papirus/symbolic/actions/mute-symbolic.svg": "mute",
    };

    const themed = (theme: string, size: number) =>
      themedIcons(fakeSystem(THEMED), ["/share"], ["actions"], {
        size,
        theme,
      });

    it("picks the directory that suits the size wanted", async () => {
      const at = async (size: number) =>
        (
          await appIcons(fakeSystem(THEMED), ["/share"], ["actions"], {
            size,
            theme: "Papirus",
          })("exit")
        ).map((icon) => icon.map((url) => atob(url.split(",")[1] ?? "")));

      expect(await at(16)).toStrictEqual(Ok(Some("16")));
      expect(await at(22)).toStrictEqual(Ok(Some("24")));
      expect(await at(64)).toStrictEqual(Ok(Some("scalable")));
    });

    it("follows the theme's parents, without looping, then hicolor", async () => {
      const icon = themed("Papirus", 16);

      expect(await icon("quit")).toStrictEqual(
        Ok(
          Some({ symbolic: false, url: "data:image/svg+xml;base64,YnJlZXpl" }),
        ),
      );
      expect(await icon("help")).toStrictEqual(
        Ok(Some({ symbolic: false, url: "data:image/png;base64,aGVscA==" })),
      );
      expect(await icon("missing")).toStrictEqual(Ok(None()));
    });

    it("falls back to a name's symbolic icon, and says it is one", async () => {
      expect(await themed("Papirus", 16)("mute")).toStrictEqual(
        Ok(Some({ symbolic: true, url: "data:image/svg+xml;base64,bXV0ZQ==" })),
      );
    });

    it("uses hicolor when the theme is not installed", async () => {
      expect(await themed("Adwaita", 16)("exit")).toStrictEqual(
        Ok(
          Some({ symbolic: false, url: "data:image/png;base64,aGljb2xvcg==" }),
        ),
      );
    });
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
