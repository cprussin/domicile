import { describe, expect, it } from "bun:test";
import { ChooserMode } from "@domicile-desktop/component-library/file-request";
import type { Folders } from "@domicile-desktop/component-library/folders";
import { WEBVIEW_FILE_CHOOSER_EVENT } from "@domicile-desktop/sdk/webview-element";
import { fileRequestOf } from "./file-request";

/**
 * A fake engine file chooser event, recording its answers in order. Built by
 * hand because the test DOM lacks the engine's event type.
 */
const asking = (mode: string, answers: string[] = []) =>
  Object.assign(new Event(WEBVIEW_FILE_CHOOSER_EVENT), {
    accept: ["png", "jpg"],
    cancel: () => {
      answers.push("cancel");
    },
    choose: (paths: readonly string[]) => {
      answers.push(`choose ${paths.join(",")}`);
    },
    home: "/home/someone",
    mode,
    suggestedName: "photo.png",
  });

/** Folders the request should hand to the picker as they are. */
const listed: Folders = {
  create: () => {
    throw new Error("unexpected create");
  },
  list: (path) => Promise.resolve([`${path}/a`, `${path}/b/`]),
  watch: () => () => undefined,
};

describe("fileRequestOf", () => {
  it("reads each of the engine's modes", () => {
    expect(
      ["open", "open-multiple", "open-folder", "save"].map(
        (mode) => fileRequestOf(asking(mode), listed).mode,
      ),
    ).toStrictEqual([
      ChooserMode.Open,
      ChooserMode.OpenMultiple,
      ChooserMode.OpenFolder,
      ChooserMode.Save,
    ]);
  });

  // A newer engine may send a mode this shell does not know.
  it("refuses a mode it cannot name", () => {
    expect(() => fileRequestOf(asking("open-everything"), listed)).toThrow();
  });

  it("keeps what the page will take, the name it suggests and the home", () => {
    const request = fileRequestOf(asking("save"), listed);

    expect(request.accept).toStrictEqual(["png", "jpg"]);
    expect(request.suggestedName).toBe("photo.png");
    expect(request.home).toBe("/home/someone");
  });

  it("answers the engine through the event", () => {
    const answers: string[] = [];

    fileRequestOf(asking("open-multiple", answers), listed).choose([
      "a.png",
      "b.jpg",
    ]);
    fileRequestOf(asking("open", answers), listed).cancel();

    expect(answers).toStrictEqual(["choose a.png,b.jpg", "cancel"]);
  });

  it("browses the folders it is given", () => {
    expect(fileRequestOf(asking("open"), listed).folders).toBe(listed);
  });
});
