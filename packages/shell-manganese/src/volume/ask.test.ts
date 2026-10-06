import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import { Asked } from "@domicile-desktop/system-audio/asked";
import { AudioError } from "@domicile-desktop/system-audio/audio-error";

import { ask } from "./ask";

describe("ask", () => {
  const logged = spyOn(console, "error").mockImplementation(() => undefined);

  afterEach(() => {
    logged.mockClear();
  });

  afterAll(() => {
    logged.mockRestore();
  });

  it("logs a refusal", async () => {
    const asking: Promise<Result<Asked, AudioError>> = Promise.resolve(
      Err(AudioError.Refused("No such entity")),
    );

    ask(asking);
    await asking;

    expect(logged).toHaveBeenCalledWith(
      "the sound server refused the mixer",
      AudioError.Refused("No such entity"),
    );
  });

  it("says nothing when the server did it", async () => {
    const asking: Promise<Result<Asked, AudioError>> = Promise.resolve(
      Ok(Asked.Done),
    );

    ask(asking);
    await asking;

    expect(logged).not.toHaveBeenCalled();
  });
});
