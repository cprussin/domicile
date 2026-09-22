import { describe, expect, it } from "bun:test";

import { DeskMessage, heardFrom } from "./desk-channel";
import { NO_WINDOWS, WindowAction } from "./window-state";

describe("what one page of a desk hears from another", () => {
  it("takes a command to run", () => {
    expect(
      heardFrom(DeskMessage.Acted(WindowAction.TerminalLaunched())),
    ).toEqual(DeskMessage.Acted(WindowAction.TerminalLaunched()));
  });

  it("takes the desktop as it stands", () => {
    expect(heardFrom(DeskMessage.Desk(NO_WINDOWS))).toEqual(
      DeskMessage.Desk(NO_WINDOWS),
    );
  });

  it("takes a page asking what the desktop is", () => {
    expect(heardFrom(DeskMessage.Asked())).toEqual(DeskMessage.Asked());
  });

  it("refuses anything that is not one of the three", () => {
    // The channel is this origin's, and nothing else on this origin has a
    // reason to be on it — so what this refuses did not come from this shell,
    // and a page that acted on it would be showing a desktop somebody else
    // described.
    expect(heardFrom({ type: "resized" })).toBeUndefined();
    expect(heardFrom("desk")).toBeUndefined();
    expect(heardFrom(undefined)).toBeUndefined();
  });

  it("has a constructor for every message there is", () => {
    // A variant that lost its constructor would be built as an object literal
    // somewhere, which is the one thing having constructors is for.
    const built: ReturnType<
      (typeof DeskMessage)[keyof typeof DeskMessage]
    >["type"] = "asked" as DeskMessage["type"];

    expect(built).toBe("asked");
  });

  it("refuses a message of the right name carrying nothing", () => {
    // A `desk` with no desktop in it would be adopted as `undefined` and taken
    // for the whole state, which is every window on the desk gone.
    expect(heardFrom({ type: "desk" })).toBeUndefined();
    expect(heardFrom({ desk: "everything", type: "desk" })).toBeUndefined();
  });
});
