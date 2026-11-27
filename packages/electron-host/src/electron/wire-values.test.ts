import { describe, expect, it } from "bun:test";
import { allFromWire, allToWire, fromWire, toWire } from "./wire-values";

describe(toWire, () => {
  it("carries what JSON carries as JSON does", () => {
    expect(toWire({ a: [1, undefined], b: "c", d: undefined })).toEqual({
      a: [1, null],
      b: "c",
    });
  });

  it("carries every kind of bytes as base64", () => {
    const backing = new Uint8Array([9, 1, 2, 255, 9]).buffer;

    expect(
      toWire([
        Buffer.from([1, 2, 255]),
        new Uint8Array(backing, 1, 3),
        new DataView(backing, 1, 3),
        backing.slice(1, 4),
      ]),
    ).toEqual([
      { $domicileBytes: "AQL/" },
      { $domicileBytes: "AQL/" },
      { $domicileBytes: "AQL/" },
      { $domicileBytes: "AQL/" },
    ]);
  });
});

describe(fromWire, () => {
  it("gives a page's bytes back as Buffers, wherever they are", () => {
    const got = fromWire({ deep: [{ $domicileBytes: "AQL/" }], n: 1 });

    expect(got).toEqual({ deep: [Buffer.from([1, 2, 255])], n: 1 });
    expect(Buffer.isBuffer((got as { deep: unknown[] }).deep[0])).toBe(true);
  });

  it("leaves an object with more than the one key as it is", () => {
    expect(fromWire({ $domicileBytes: "AQL/", other: 1 })).toEqual({
      $domicileBytes: "AQL/",
      other: 1,
    });
  });

  it("round-trips VS Code's IPC message, a Uint8Array", () => {
    const message = new Uint8Array([0, 1, 2, 3, 250]);

    expect(allFromWire(toWire([message]) as unknown[])).toEqual([
      Buffer.from(message),
    ]);
  });
});

describe(allToWire, () => {
  it("gives a Date as JSON does and an undefined as null", () => {
    expect(allToWire([new Date(0), undefined])).toEqual([
      "1970-01-01T00:00:00.000Z",
      null,
    ]);
  });
});
