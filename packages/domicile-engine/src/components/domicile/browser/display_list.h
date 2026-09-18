// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_
#define COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_

#include <vector>

#include "components/domicile/mojom/frame_sink_broker.mojom.h"
#include "ui/display/display.h"

namespace domicile {

// Domicile's display list, off the screen ozone built.
//
// The producer is a Wayland compositor and what it is being told is what to
// advertise as wl_output, so this is where the browser's units become the
// protocol's: millimeters rather than the density display::Display carries
// them as, and mHz rather than Hz.
//
// The name is carried straight through: `drm_screen.cc` built it from the
// panel's EDID and put it on `label`, and nothing here is in a position to
// improve on it. See that file for what it is made of and why the serial in it
// had to be parsed rather than read off display::EdidParser.
//
// Here rather than beside its one caller in //content/browser because the
// millimeters are arithmetic and arithmetic gets a test. The DENSITY is not
// this file's choice: display::Display has no physical size, and
// ui/ozone/platform/drm/domicile/drm_screen.cc says why the panel leaves the
// snapshot as one.
std::vector<mojom::DisplayPtr> DisplayListFor(
    const std::vector<display::Display>& displays);

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_BROWSER_DISPLAY_LIST_H_
