// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_SPIKE_CSS_PARITY_LAYOUT_H_
#define COMPONENTS_DOMICILE_SPIKE_CSS_PARITY_LAYOUT_H_

#include "third_party/skia/include/core/SkColor.h"

namespace domicile::spike {

// Spike: page geometry for the CSS parity check. Must match
// packages/domicile-engine/scripts/spike-css-page.html. Nothing checks this; a
// mismatch misaligns the halves, so every cell fails rather than one passing
// wrongly.
//
// Each cell applies one CSS property to both halves: an <app> on the left and
// a <div> in the producer's color on the right. The property has parity when
// the right half equals the left half shifted by kCellHalfWidth.

// Page-wide.
inline constexpr SkColor kPageBackground = SkColorSetARGB(0xFF, 0x10, 0x14, 0x18);
inline constexpr int kGridLeft = 16;
inline constexpr int kGridTop = 16;
inline constexpr int kCellWidth = 560;
inline constexpr int kCellHeight = 190;
inline constexpr int kColumnGap = 24;
inline constexpr int kRowGap = 10;
inline constexpr int kColumns = 2;

// Within a cell.
inline constexpr int kCellHalfWidth = kCellWidth / 2;

// Within a half: where the <app> and its control sit. Used only to check that
// the page loaded where expected; the diff does not need it.
inline constexpr int kBoxLeft = 80;
inline constexpr int kBoxTop = 50;
inline constexpr int kBoxWidth = 120;
inline constexpr int kBoxHeight = 90;

// One cell, in the order the page lays them out.
struct Cell {
  const char* name;
  // Whether the two halves should match. The negative control paints its
  // <div> a different color, so the run fails if the diff misses it.
  bool halves_should_match;
  // Whether this cell's <app> should differ from the baseline cell's. Catches a
  // property that was never applied, which leaves both halves plain and
  // matching.
  bool differs_from_baseline;
};

inline constexpr Cell kCells[] = {
    {"baseline", true, false},
    {"z-index", true, true},
    {"transform", true, true},
    {"border-radius", true, true},
    {"opacity", true, true},
    {"filter: blur()", true, true},
    {"mix-blend-mode", true, true},
    {"negative control", false, false},
};

// A cell of the iframe parity check, against spike-iframe-page.html. Uses the
// same cell geometry as kCells.
struct IframeCell {
  const char* name;
  enum class Expect {
    // The pair must match in every pixel: CSS must treat an <app> like any
    // other element.
    kIdentical,
    // The pair must differ. An out-of-process <iframe> does not match a <div>
    // pixel for pixel; if it does, the iframe is no longer out of process or
    // Chromium changed, and the run fails.
    kDiffers,
    // Reported, not asserted. The <app> and the iframe need not agree.
    kInformational,
  } expect;
};

// In the order spike-iframe-page.html lays them out.
inline constexpr IframeCell kIframeCells[] = {
    {"<app> vs <div>", IframeCell::Expect::kIdentical},
    {"<app> vs OOPIF", IframeCell::Expect::kInformational},
    {"OOPIF vs <div>", IframeCell::Expect::kDiffers},
};

}  // namespace domicile::spike

#endif  // COMPONENTS_DOMICILE_SPIKE_CSS_PARITY_LAYOUT_H_
