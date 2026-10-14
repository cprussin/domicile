// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_BASE_CURSOR_DOMICILE_XCURSOR_THEME_H_
#define UI_BASE_CURSOR_DOMICILE_XCURSOR_THEME_H_

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "base/containers/flat_map.h"
#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/time/time.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/gfx/geometry/point.h"

// XCursor themes, read without libXcursor or a display server.
//
// The format and lookup are libXcursor's: a theme is `<dir>/<name>/cursors/`
// under a search path, and its `index.theme` names the themes it inherits.
namespace ui {

// One cursor's frames at one nominal size.
struct XCursorImages {
  std::vector<SkBitmap> frames;
  // The first frame's; a theme gives every frame the same one.
  gfx::Point hotspot;
  // The first frame's. Zero for a cursor that does not animate.
  base::TimeDelta frame_delay;
};

// The frames in an XCursor file whose nominal size is nearest `size`, or
// nullopt for a file that is not one.
std::optional<XCursorImages> ParseXCursorFile(base::span<const uint8_t> file,
                                              int size);

// The environment variables `XCursorSearchPath` reads.
struct XCursorEnvironment {
  std::optional<std::string> xcursor_path;
  std::optional<std::string> xdg_data_home;
  std::optional<std::string> xdg_data_dirs;
};

// The directories themes are looked up in, in order: `XCURSOR_PATH` when set,
// else `icons` under each XDG data directory, `~/.icons` and
// `/usr/share/pixmaps`, as libwayland-cursor does.
std::vector<base::FilePath> XCursorSearchPath(const XCursorEnvironment& env,
                                              const base::FilePath& home);

// Every cursor type `theme` or a theme it inherits has, at the nominal size
// nearest `size` pixels. A type the themes have none of the names for is
// left out. Reads the disk, so it may block.
base::flat_map<mojom::CursorType, XCursorImages> LoadXCursorTheme(
    const std::vector<base::FilePath>& search_path,
    const std::string& theme,
    int size);

}  // namespace ui

#endif  // UI_BASE_CURSOR_DOMICILE_XCURSOR_THEME_H_
