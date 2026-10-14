// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/base/cursor/domicile/xcursor_theme.h"

#include <algorithm>
#include <cstdlib>
#include <utility>

#include "base/containers/span_reader.h"
#include "base/files/file_util.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "ui/base/cursor/cursor_factory.h"
#include "ui/gfx/skia_span_util.h"

namespace ui {
namespace {

constexpr uint32_t kMagic = 0x72756358u;  // "Xcur", little-endian.
constexpr uint32_t kFileHeaderSize = 16;
constexpr uint32_t kImageType = 0xfffd0002u;
constexpr uint32_t kImageHeaderSize = 36;
// libXcursor's `XCURSOR_IMAGE_MAX_SIZE`.
constexpr uint32_t kMaxDimension = 0x7fff;

struct TocEntry {
  uint32_t type;
  uint32_t subtype;
  uint32_t position;
};

struct Frame {
  SkBitmap bitmap;
  gfx::Point hotspot;
  base::TimeDelta delay;
};

// The image chunk `entry` points at, or nullopt if it is malformed.
std::optional<Frame> ReadFrame(base::span<const uint8_t> file,
                               const TocEntry& entry) {
  if (entry.position > file.size()) {
    return std::nullopt;
  }
  base::SpanReader<const uint8_t> reader(file.subspan(entry.position));
  uint32_t header, type, subtype, version, width, height, xhot, yhot, delay;
  if (!reader.ReadU32LittleEndian(header) ||
      !reader.ReadU32LittleEndian(type) ||
      !reader.ReadU32LittleEndian(subtype) ||
      !reader.ReadU32LittleEndian(version) ||
      !reader.ReadU32LittleEndian(width) ||
      !reader.ReadU32LittleEndian(height) ||
      !reader.ReadU32LittleEndian(xhot) ||
      !reader.ReadU32LittleEndian(yhot) ||
      !reader.ReadU32LittleEndian(delay) || header < kImageHeaderSize ||
      !reader.Skip(header - kImageHeaderSize) || type != entry.type ||
      subtype != entry.subtype || width == 0 || height == 0 ||
      width > kMaxDimension || height > kMaxDimension) {
    return std::nullopt;
  }
  // Checked before allocating, so a short file allocates nothing.
  if (size_t{width} * height * 4 > reader.remaining()) {
    return std::nullopt;
  }
  // Premultiplied ARGB in little-endian words, which is N32 on every
  // platform this builds for.
  SkBitmap bitmap;
  bitmap.allocN32Pixels(static_cast<int>(width), static_cast<int>(height));
  if (!reader.ReadCopy(gfx::SkPixmapToWritableSpan(bitmap.pixmap()))) {
    return std::nullopt;
  }
  return Frame{.bitmap = std::move(bitmap),
               .hotspot = gfx::Point(static_cast<int>(xhot),
                                     static_cast<int>(yhot)),
               .delay = base::Milliseconds(delay)};
}

// `~` and `~/...` under `home`, as libXcursor reads `XCURSOR_PATH`.
base::FilePath Expand(const std::string& dir, const base::FilePath& home) {
  if (dir == "~") {
    return home;
  }
  if (base::StartsWith(dir, "~/")) {
    return home.Append(dir.substr(2));
  }
  return base::FilePath(dir);
}

// The themes `theme`'s `index.theme` says it inherits. The first
// `index.theme` on the search path is the theme's.
std::vector<std::string> Inherits(
    const std::vector<base::FilePath>& search_path,
    const std::string& theme) {
  for (const base::FilePath& dir : search_path) {
    std::string index;
    if (!base::ReadFileToString(dir.Append(theme).Append("index.theme"),
                                &index)) {
      continue;
    }
    base::StringPairs pairs;
    base::SplitStringIntoKeyValuePairs(index, '=', '\n', &pairs);
    for (const auto& [key, value] : pairs) {
      if (base::TrimWhitespaceASCII(key, base::TRIM_ALL) == "Inherits") {
        return base::SplitString(value, ",;", base::TRIM_WHITESPACE,
                                 base::SPLIT_WANT_NONEMPTY);
      }
    }
    return {};
  }
  return {};
}

// Appends `theme`, then each theme it inherits, depth first and each once.
void AddThemeAndParents(const std::vector<base::FilePath>& search_path,
                        const std::string& theme,
                        std::vector<std::string>& themes) {
  // Not `base::Contains`: `base/containers/contains.h` is gone at our pin.
  if (std::ranges::find(themes, theme) != themes.end()) {
    return;
  }
  themes.push_back(theme);
  for (const std::string& parent : Inherits(search_path, theme)) {
    AddThemeAndParents(search_path, parent, themes);
  }
}

// The cursor file `name` in the first of `themes` that has one.
std::optional<XCursorImages> FindCursor(
    const std::vector<base::FilePath>& search_path,
    const std::vector<std::string>& themes,
    const std::string& name,
    int size) {
  for (const std::string& theme : themes) {
    for (const base::FilePath& dir : search_path) {
      std::string file;
      if (base::ReadFileToString(
              dir.Append(theme).Append("cursors").Append(name), &file)) {
        return ParseXCursorFile(base::as_byte_span(file), size);
      }
    }
  }
  return std::nullopt;
}

}  // namespace

std::optional<XCursorImages> ParseXCursorFile(base::span<const uint8_t> file,
                                              int size) {
  base::SpanReader<const uint8_t> reader(file);
  uint32_t magic, header, version, ntoc;
  if (!reader.ReadU32LittleEndian(magic) || magic != kMagic ||
      !reader.ReadU32LittleEndian(header) ||
      !reader.ReadU32LittleEndian(version) ||
      !reader.ReadU32LittleEndian(ntoc) || header < kFileHeaderSize ||
      !reader.Skip(header - kFileHeaderSize)) {
    return std::nullopt;
  }

  std::vector<TocEntry> toc;
  for (uint32_t i = 0; i < ntoc; ++i) {
    TocEntry entry;
    if (!reader.ReadU32LittleEndian(entry.type) ||
        !reader.ReadU32LittleEndian(entry.subtype) ||
        !reader.ReadU32LittleEndian(entry.position)) {
      return std::nullopt;
    }
    toc.push_back(entry);
  }

  const auto distance = [size](uint32_t nominal) {
    return std::abs(static_cast<int64_t>(nominal) - size);
  };
  std::optional<uint32_t> nearest;
  for (const TocEntry& entry : toc) {
    if (entry.type == kImageType &&
        (!nearest || distance(entry.subtype) < distance(*nearest))) {
      nearest = entry.subtype;
    }
  }
  if (!nearest) {
    return std::nullopt;
  }

  XCursorImages images;
  for (const TocEntry& entry : toc) {
    if (entry.type != kImageType || entry.subtype != *nearest) {
      continue;
    }
    std::optional<Frame> frame = ReadFrame(file, entry);
    if (!frame) {
      return std::nullopt;
    }
    if (images.frames.empty()) {
      images.hotspot = frame->hotspot;
      images.frame_delay = frame->delay;
    }
    images.frames.push_back(std::move(frame->bitmap));
  }
  return images;
}

std::vector<base::FilePath> XCursorSearchPath(const XCursorEnvironment& env,
                                              const base::FilePath& home) {
  std::vector<base::FilePath> path;
  if (env.xcursor_path && !env.xcursor_path->empty()) {
    for (const std::string& dir :
         base::SplitString(*env.xcursor_path, ":", base::TRIM_WHITESPACE,
                           base::SPLIT_WANT_NONEMPTY)) {
      path.push_back(Expand(dir, home));
    }
    return path;
  }

  // The XDG base directory spec's defaults for an unset or empty variable.
  const base::FilePath data_home =
      env.xdg_data_home && !env.xdg_data_home->empty()
          ? base::FilePath(*env.xdg_data_home)
          : home.Append(".local").Append("share");
  const std::string data_dirs = env.xdg_data_dirs && !env.xdg_data_dirs->empty()
                                    ? *env.xdg_data_dirs
                                    : "/usr/local/share:/usr/share";

  path.push_back(data_home.Append("icons"));
  path.push_back(home.Append(".icons"));
  for (const std::string& dir :
       base::SplitString(data_dirs, ":", base::TRIM_WHITESPACE,
                         base::SPLIT_WANT_NONEMPTY)) {
    path.push_back(base::FilePath(dir).Append("icons"));
  }
  path.push_back(base::FilePath("/usr/share/pixmaps"));
  return path;
}

base::flat_map<mojom::CursorType, XCursorImages> LoadXCursorTheme(
    const std::vector<base::FilePath>& search_path,
    const std::string& theme,
    int size) {
  std::vector<std::string> themes;
  AddThemeAndParents(search_path, theme, themes);

  // Several types share a name, such as `hand2`; each file is read once.
  base::flat_map<std::string, std::optional<XCursorImages>> by_name;
  base::flat_map<mojom::CursorType, XCursorImages> cursors;
  for (int i = static_cast<int>(mojom::CursorType::kMinValue);
       i <= static_cast<int>(mojom::CursorType::kMaxValue); ++i) {
    const auto type = static_cast<mojom::CursorType>(i);
    // `kNone` has no art, and `kCustom` is a page's own image.
    if (type == mojom::CursorType::kNone ||
        type == mojom::CursorType::kCustom) {
      continue;
    }
    for (const std::string& name : CursorNamesFromType(type)) {
      auto [found, inserted] = by_name.try_emplace(name);
      if (inserted) {
        found->second = FindCursor(search_path, themes, name, size);
      }
      if (found->second) {
        cursors.emplace(type, *found->second);
        break;
      }
    }
  }
  return cursors;
}

}  // namespace ui
