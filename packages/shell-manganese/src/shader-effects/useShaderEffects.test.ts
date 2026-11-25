import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Result } from "@cprussin/option-result";
import { Err, Ok } from "@cprussin/option-result";
import type {
  Effects,
  EffectsListeners,
  ShaderEffect,
} from "@domicile-desktop/sdk/desktop/effects";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useShaderEffects } from "./useShaderEffects";

const PROGRAMS = {
  dissolve: { sksl: "dissolve's SkSL" },
  "slide-blur": { sksl: "slide-blur's SkSL" },
} as const satisfies Record<string, ShaderEffect>;

/**
 * Effects that compile every program but those `refused` names, and a `lose`
 * that drops one as a GPU hang does.
 */
const fakeEffects = (refused: Readonly<Record<string, string>> = {}) => {
  const registered: [string, ShaderEffect][] = [];
  const listeners = new Set<EffectsListeners["lost"]>();
  const effects: Effects = {
    on: (_type, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register: (name, effect) => {
      registered.push([name, effect]);
      const why = refused[name];
      return Promise.resolve<Result<number, string>>(
        why === undefined ? Ok(1) : Err(why),
      );
    },
  };
  return {
    effects,
    lose: (name: string) => {
      for (const listener of listeners) {
        listener(name);
      }
    },
    registered,
  };
};

/** Effects switched on, with motion not reduced. */
const ON = { reducedMotion: false, switchedOn: true };

const shown = (root: HTMLElement) => root.getAttribute("data-shader-effects");

/** The device pixels to a CSS pixel `root` hands the effects. */
const ratioOf = (root: HTMLElement) =>
  root.style.getPropertyValue("--device-pixel-ratio");

afterEach(() => {
  document.documentElement.removeAttribute("data-shader-effects");
  document.documentElement.style.removeProperty("--device-pixel-ratio");
});

describe("useShaderEffects", () => {
  it("registers each program once", async () => {
    const { effects, registered } = fakeEffects();
    const { rerender } = renderHook(
      ({ wanted }) => useShaderEffects(effects, PROGRAMS, wanted, 1.5),
      { initialProps: { wanted: ON } },
    );
    rerender({ wanted: { ...ON, switchedOn: false } });
    rerender({ wanted: ON });

    await waitFor(() => {
      expect(shown(document.documentElement)).toBe("dissolve slide-blur");
    });
    expect(ratioOf(document.documentElement)).toBe("1.5");
    expect(registered).toStrictEqual([
      ["dissolve", PROGRAMS.dissolve],
      ["slide-blur", PROGRAMS["slide-blur"]],
    ]);
  });

  it.each([
    ["switched off", { reducedMotion: false, switchedOn: false }],
    ["under reduced motion", { reducedMotion: true, switchedOn: true }],
  ])("names none %s", async (_, wanted) => {
    const { effects } = fakeEffects();
    const root = document.createElement("html");
    const { rerender } = renderHook(
      ({ wanted }) => useShaderEffects(effects, PROGRAMS, wanted, 1.5, root),
      { initialProps: { wanted: ON } },
    );
    await waitFor(() => {
      expect(shown(root)).toBe("dissolve slide-blur");
    });
    rerender({ wanted });

    expect(root.hasAttribute("data-shader-effects")).toBe(false);
    expect(ratioOf(root)).toBe("");
  });

  // `size` and `p` are in device pixels; the effects measure in CSS pixels.
  it("hands the effects the pixel ratio as it changes", async () => {
    const { effects } = fakeEffects();
    const root = document.createElement("html");
    const { rerender } = renderHook(
      ({ ratio }) => useShaderEffects(effects, PROGRAMS, ON, ratio, root),
      { initialProps: { ratio: 1 } },
    );
    await waitFor(() => {
      expect(ratioOf(root)).toBe("1");
    });
    rerender({ ratio: 2 });

    expect(ratioOf(root)).toBe("2");
  });

  it("leaves out a program the compiler refused, and says why", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const { effects } = fakeEffects({ dissolve: "error: 1: expected ';'" });
    const root = document.createElement("html");
    renderHook(() => useShaderEffects(effects, PROGRAMS, ON, 1.5, root));

    await waitFor(() => {
      expect(shown(root)).toBe("slide-blur");
    });
    expect(error).toHaveBeenCalledWith(
      "shell: shader effect dissolve did not compile; its motions play without it: error: 1: expected ';'",
    );
    error.mockRestore();
  });

  it("drops an effect the GPU lost, and says so", async () => {
    const error = spyOn(console, "error").mockImplementation(() => undefined);
    const { effects, lose, registered } = fakeEffects();
    const root = document.createElement("html");
    renderHook(() => useShaderEffects(effects, PROGRAMS, ON, 1.5, root));
    await waitFor(() => {
      expect(shown(root)).toBe("dissolve slide-blur");
    });
    act(() => {
      lose("dissolve");
    });

    expect(shown(root)).toBe("slide-blur");
    // Registered again, it could hang the GPU again.
    expect(registered).toHaveLength(2);
    expect(error).toHaveBeenCalledWith(
      "shell: the GPU dropped shader effect dissolve; its motions play without it",
    );
    error.mockRestore();
  });
});
