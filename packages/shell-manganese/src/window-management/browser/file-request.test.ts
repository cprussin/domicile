import { describe, expect, it } from "bun:test";
import { WEBVIEW_FILE_CHOOSER_EVENT } from "@domicile/sdk/webview-element";

import { ChooserMode, fileRequestOf } from "./file-request";

/**
 * The engine's question, built rather than constructed: its type is the
 * fork's, and no DOM these tests run on has it. What it was answered with is
 * kept, in order.
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
    list: (path: string) => Promise.resolve([`${path}/a`, `${path}/b/`]),
    mode,
    suggestedName: "photo.png",
  });

describe("fileRequestOf", () => {
  it("reads each of the engine's modes", () => {
    expect(
      ["open", "open-multiple", "open-folder", "save"].map(
        (mode) => fileRequestOf(asking(mode)).mode,
      ),
    ).toStrictEqual([
      ChooserMode.Open,
      ChooserMode.OpenMultiple,
      ChooserMode.OpenFolder,
      ChooserMode.Save,
    ]);
  });

  // An engine newer than this shell can ask for something it cannot draw, and
  // a picker drawn for the wrong question answers it wrongly.
  it("refuses a mode it cannot name", () => {
    expect(() => fileRequestOf(asking("open-everything"))).toThrow();
  });

  it("keeps what the page will take, the name it suggests and the home", () => {
    const request = fileRequestOf(asking("save"));

    expect(request.accept).toStrictEqual(["png", "jpg"]);
    expect(request.suggestedName).toBe("photo.png");
    expect(request.home).toBe("/home/someone");
  });

  it("answers the engine through the event", () => {
    const answers: string[] = [];

    fileRequestOf(asking("open-multiple", answers)).choose(["a.png", "b.jpg"]);
    fileRequestOf(asking("open", answers)).cancel();

    expect(answers).toStrictEqual(["choose a.png,b.jpg", "cancel"]);
  });

  it("lists a directory through the event", async () => {
    expect(await fileRequestOf(asking("open")).list("/mnt")).toStrictEqual([
      "/mnt/a",
      "/mnt/b/",
    ]);
  });
});
