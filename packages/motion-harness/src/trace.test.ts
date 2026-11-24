import { describe, expect, it } from "bun:test";

import { animationsIn } from "./trace";

/** The `Animation` events Chromium traces for one animation. */
const traced = (
  local: string,
  property: string,
  failed?: { compositeFailed: number; unsupportedProperties: string[] },
) => [
  {
    args: {
      data: {
        displayName: property,
        id: "1",
        name: "",
        nodeId: 2,
        nodeName: "DIV class='tile'",
        state: "running",
      },
    },
    id2: { local },
    name: "Animation",
    ph: "b",
  },
  ...(failed === undefined
    ? []
    : [{ args: { data: failed }, id2: { local }, name: "Animation", ph: "n" }]),
  {
    args: { data: { state: "running" } },
    id2: { local },
    name: "Animation",
    ph: "n",
  },
  { args: {}, id2: { local }, name: "Animation", ph: "e" },
];

describe("animationsIn", () => {
  it("lists each animation with what kept it off the compositor", () => {
    const trace = {
      traceEvents: [
        { args: {}, name: "AnimationFrame", ph: "s" },
        ...traced("0x1", "transform"),
        ...traced("0x2", "block-size", {
          compositeFailed: 8192,
          unsupportedProperties: ["block-size"],
        }),
      ],
    };
    expect(animationsIn(trace)).toEqual([
      { element: "DIV class='tile'", failed: undefined, property: "transform" },
      {
        element: "DIV class='tile'",
        failed: { reasons: 8192, unsupported: ["block-size"] },
        property: "block-size",
      },
    ]);
  });

  it("tells apart animations that reuse an id once the first has ended", () => {
    const trace = {
      traceEvents: [
        ...traced("0x1", "color", {
          compositeFailed: 8192,
          unsupportedProperties: ["color"],
        }),
        ...traced("0x1", "transform"),
      ],
    };
    expect(animationsIn(trace).map(({ failed }) => failed)).toEqual([
      { reasons: 8192, unsupported: ["color"] },
      undefined,
    ]);
  });

  it("throws on a trace that is not one", () => {
    expect(() => animationsIn({ events: [] })).toThrow();
  });
});
