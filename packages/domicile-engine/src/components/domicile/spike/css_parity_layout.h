// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_SPIKE_CSS_PARITY_LAYOUT_H_
#define COMPONENTS_DOMICILE_SPIKE_CSS_PARITY_LAYOUT_H_

#include "third_party/skia/include/core/SkColor.h"

namespace domicile::spike {

// THROWAWAY. Step 4's page geometry, which
// packages/domicile-engine/scripts/spike-css-page.html in the Domicile
// repository lays out and this reads back.
//
// KEEP THE TWO IN SYNC. Nothing checks that they agree, but nothing has to:
// the measurement is a diff of two halves of a structured page, and a
// disagreement misaligns both of them. That reads as every cell failing, never
// as a cell passing that should not have — which is the direction an
// unverifiable constant is allowed to fail in.
//
// The page is a column-pair of cells. Each cell is one CSS property, applied
// identically to the two halves of it: an <app> — a <canvas> showing the
// producer's surface — on the left, and an ordinary <div> filled with the
// colour the producer submits on the right. "Does CSS treat an <app> like a
// <div>" is then the question of whether one half of a cell is the other half
// translated by kCellHalfWidth, which is a pixel comparison rather than a
// judgement.

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

// Within a half: where the <app> and its control sit. Only used to sanity check
// that the page is where this thinks it is; the diff itself needs no part of it.
inline constexpr int kBoxLeft = 80;
inline constexpr int kBoxTop = 50;
inline constexpr int kBoxWidth = 120;
inline constexpr int kBoxHeight = 90;

// One cell, in the order the page lays them out.
struct Cell {
  const char* name;
  // Whether the two halves are supposed to match. The last cell exists to be
  // different: a measurement that cannot fail has not measured anything, so one
  // cell paints its control a colour the producer never submits and the run
  // fails if the diff does not notice.
  bool halves_should_match;
  // Whether this cell's <app> is supposed to look different from the baseline
  // cell's. Every property cell is, and checking it is what rules out the way
  // this measurement would otherwise pass for the wrong reason: a property
  // that never reached the page at all — a class that does not match, a
  // stylesheet that did not load — leaves both halves plain, and two plain
  // halves match.
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

// The iframe-parity check, which is spike-iframe-page.html rather than
// spike-css-page.html and reuses the same cell geometry.
//
// ENGINE-FORK.md argued that an <app> under `transform` differs from a <div>
// only the way any surface-backed element does, an out-of-process <iframe>
// included, and that argument was read off child_frame_compositing_helper.cc
// rather than measured. Measuring it found something better and stranger than
// the argument: on a GPU an <app> is pixel-identical to a <div>, and it is the
// OOPIF that is not.
struct IframeCell {
  const char* name;
  enum class Expect {
    // The requirement, in the project's own words: no CSS may behave
    // differently for an <app> than for any other element. Nothing short of
    // every pixel is a pass.
    kIdentical,
    // The reference point. An OOPIF is Chromium's own surface embedder, and it
    // does *not* match an ordinary element pixel for pixel. If this row ever
    // comes back identical, either the iframe stopped being out of process —
    // in which case the whole page is comparing an <app> against a <div> three
    // times — or upstream changed, and either way the run should stop.
    kDiffers,
    // Reported, not asserted: how our embedding compares with Chromium's. It
    // is not a requirement that the two agree, only that each agrees with an
    // ordinary element, and only the first row is that.
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
