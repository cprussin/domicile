import { describe, expect, it } from "bun:test";
import { loadEmittedStylesheet } from "@domicile-desktop/test-support/emitted-stylesheet";
import { render } from "@testing-library/react";

import { FROST } from "./frost";
import { ModalDialog } from "./ModalDialog";

// Loads the real stylesheet so computed styles reflect the emitted CSS.
loadEmittedStylesheet(
  document,
  new URL("../../styled-system/styles.css", import.meta.url),
);

describe("FROST", () => {
  it("takes the numbers the glass backdrop passes", () => {
    expect(
      [...FROST.sksl.matchAll(/^uniform (\w+) (\w+);$/gm)].map(
        ([, type, name]) => `${type ?? ""} ${name ?? ""}`,
      ),
    ).toStrictEqual([
      "shader content",
      "float2 size",
      "float grain",
      "float scale",
    ]);
  });

  // The shell lists the effects that may draw on `<html>`, with the device
  // pixels to a CSS pixel.
  it.each([
    ["", "blur(0.625rem) saturate(140%)"],
    ["frost", "blur(0.625rem) saturate(140%) domicile-shader(frost, 1, 2)"],
  ])("frosts a glass backdrop with effects '%s' as %s", (listed, filter) => {
    document.documentElement.setAttribute("data-shader-effects", listed);
    document.documentElement.style.setProperty("--device-pixel-ratio", "2");
    const { baseElement } = render(
      <ModalDialog open popup={false} surface="glass" title="Settings">
        Body
      </ModalDialog>,
    );
    const backdrop = baseElement.querySelector<HTMLElement>("[data-backdrop]");
    const drawn =
      backdrop === null ? "" : getComputedStyle(backdrop).backdropFilter;
    document.documentElement.removeAttribute("data-shader-effects");
    document.documentElement.style.removeProperty("--device-pixel-ratio");

    expect(drawn).toBe(filter);
  });
});
