// How a described desktop reads as one line.
//
// Shared rather than inlined per probe: two e2e scripts compare their output
// against an `EXPECTED` string in this format. A drifted copy would not go
// unnoticed — the script whose `EXPECTED` no longer matched fails on its next
// run — but it fails as a *compositor* verdict, which is three paragraphs of
// confident prose about the wrong thing. One definition, and a test, so a
// format change fails where it belongs.

import type { DisplayInfo } from "@domicile/chrome-sdk/protocol";

/**
 * A described desktop as one line, with the two silences kept apart.
 *
 * A compositor that described a desktop of no screens and one that described
 * nothing at all both produce an empty line otherwise, and a shell script
 * testing `[ -z ]` would report the first as its own harness failing. Neither
 * is what these scripts expect, and they are different bugs.
 */
export const asDesktopReport = (
  displays: readonly DisplayInfo[] | undefined,
): string => {
  if (displays === undefined) {
    return "(never told)";
  } else if (displays.length === 0) {
    return "(none)";
  } else {
    return asDesktopLine(displays);
  }
};

/**
 * `name@x,y+WxH@scale` per display, space-separated — everything a `<Screen>`
 * needs to put itself over the right part of the page.
 *
 * Not exported: {@link asDesktopReport} is what a probe prints, and widening
 * this to reach it from a test would export a function no caller wants. Below
 * it, since it is the helper and that is the only call.
 */
const asDesktopLine = (displays: readonly DisplayInfo[]): string =>
  displays
    .map(
      (display) =>
        `${display.name}@${display.position.join(",")}+${display.size.join("x")}@${display.scale.toString()}`,
    )
    .join(" ");
