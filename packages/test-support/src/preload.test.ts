import { describe, expect, it } from "bun:test";

describe("preload", () => {
  it("leaves a frame where it was sent rather than fetching it", async () => {
    // A frame's page is the engine's to load, and `domicile://` is a scheme
    // only the engine serves.
    const frame = document.createElement("iframe");
    frame.src = "domicile://home/notes.pdf";

    const event = await new Promise<string>((resolve) => {
      frame.addEventListener("load", () => {
        resolve("load");
      });
      frame.addEventListener("error", () => {
        resolve("error");
      });
      document.body.append(frame);
    });

    expect(event).toBe("load");
  });
});
