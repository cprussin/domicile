// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/base/cursor/domicile/xcursor_theme.h"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "base/containers/span.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/gfx/geometry/point.h"

namespace ui {
namespace {

using mojom::CursorType;

// One image chunk of an XCursor file, filled with one color.
struct Image {
  uint32_t nominal;
  uint32_t width;
  uint32_t height;
  uint32_t xhot = 0;
  uint32_t yhot = 0;
  uint32_t delay = 0;
  // Premultiplied ARGB, as the format stores it.
  uint32_t argb = 0xffff0000;
};

void Put(std::string& out, uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) {
    out.push_back(static_cast<char>((value >> shift) & 0xff));
  }
}

// An XCursor file holding `images` in order.
std::string XCursorFile(const std::vector<Image>& images) {
  constexpr uint32_t kFileHeader = 16;
  constexpr uint32_t kTocEntry = 12;
  constexpr uint32_t kChunkHeader = 36;
  constexpr uint32_t kImageType = 0xfffd0002;

  std::string out;
  Put(out, 0x72756358);  // "Xcur"
  Put(out, kFileHeader);
  Put(out, 0x10000);
  const uint32_t count = static_cast<uint32_t>(images.size());
  Put(out, count);

  uint32_t position = kFileHeader + kTocEntry * count;
  for (const Image& image : images) {
    Put(out, kImageType);
    Put(out, image.nominal);
    Put(out, position);
    position += kChunkHeader + 4 * image.width * image.height;
  }
  for (const Image& image : images) {
    Put(out, kChunkHeader);
    Put(out, kImageType);
    Put(out, image.nominal);
    Put(out, 1);
    Put(out, image.width);
    Put(out, image.height);
    Put(out, image.xhot);
    Put(out, image.yhot);
    Put(out, image.delay);
    for (uint32_t i = 0; i < image.width * image.height; ++i) {
      Put(out, image.argb);
    }
  }
  return out;
}

base::span<const uint8_t> Bytes(const std::string& file) {
  return base::as_byte_span(file);
}

TEST(XCursorThemeTest, AFileGivesTheFramesNearestTheSizeAskedFor) {
  const std::string file = XCursorFile({
      {.nominal = 24, .width = 24, .height = 24, .argb = 0xff0000ff},
      {.nominal = 48,
       .width = 48,
       .height = 48,
       .xhot = 7,
       .yhot = 9,
       .argb = 0xff00ff00},
  });

  const std::optional<XCursorImages> images = ParseXCursorFile(Bytes(file), 40);

  ASSERT_TRUE(images);
  ASSERT_EQ(images->frames.size(), 1u);
  EXPECT_EQ(images->frames[0].width(), 48);
  EXPECT_EQ(images->frames[0].height(), 48);
  EXPECT_EQ(images->frames[0].getColor(3, 3), SK_ColorGREEN);
  EXPECT_EQ(images->hotspot, gfx::Point(7, 9));
}

TEST(XCursorThemeTest, AnAnimatedCursorKeepsEveryFrameAndItsDelay) {
  const std::string file = XCursorFile({
      {.nominal = 32, .width = 32, .height = 32, .delay = 50},
      {.nominal = 32, .width = 32, .height = 32, .delay = 50},
      {.nominal = 64, .width = 64, .height = 64, .delay = 50},
  });

  const std::optional<XCursorImages> images = ParseXCursorFile(Bytes(file), 32);

  ASSERT_TRUE(images);
  EXPECT_EQ(images->frames.size(), 2u);
  EXPECT_EQ(images->frame_delay, base::Milliseconds(50));
}

TEST(XCursorThemeTest, AFileThatIsNotACursorGivesNothing) {
  const std::string whole =
      XCursorFile({{.nominal = 24, .width = 24, .height = 24}});

  EXPECT_FALSE(ParseXCursorFile(Bytes(std::string("not a cursor")), 24));
  EXPECT_FALSE(ParseXCursorFile(Bytes(whole.substr(0, whole.size() - 4)), 24));
}

TEST(XCursorThemeTest, XCursorPathOverridesTheDataDirectories) {
  const base::FilePath home("/home/me");

  EXPECT_EQ(XCursorSearchPath({.xcursor_path = "~/cursors:/opt/icons",
                               .xdg_data_dirs = "/ignored"},
                              home),
            (std::vector<base::FilePath>{base::FilePath("/home/me/cursors"),
                                         base::FilePath("/opt/icons")}));
}

// NixOS puts a profile's themes under a data directory, such as
// `/etc/profiles/per-user/me/share`, and nowhere else.
TEST(XCursorThemeTest, ThemesAreLookedUpUnderEachDataDirectory) {
  const base::FilePath home("/home/me");

  EXPECT_EQ(
      XCursorSearchPath({.xdg_data_dirs = "/run/current-system/sw/share:"
                                          "/etc/profiles/per-user/me/share"},
                        home),
      (std::vector<base::FilePath>{
          base::FilePath("/home/me/.local/share/icons"),
          base::FilePath("/home/me/.icons"),
          base::FilePath("/run/current-system/sw/share/icons"),
          base::FilePath("/etc/profiles/per-user/me/share/icons"),
          base::FilePath("/usr/share/pixmaps"),
      }));
  EXPECT_EQ(XCursorSearchPath({.xdg_data_home = "/data"}, home),
            (std::vector<base::FilePath>{
                base::FilePath("/data/icons"),
                base::FilePath("/home/me/.icons"),
                base::FilePath("/usr/local/share/icons"),
                base::FilePath("/usr/share/icons"),
                base::FilePath("/usr/share/pixmaps"),
            }));
}

class XCursorThemeDirectoryTest : public testing::Test {
 protected:
  void SetUp() override { ASSERT_TRUE(dir_.CreateUniqueTempDir()); }

  // Writes `contents` to `<root>/<theme>/<file>`.
  void Write(const std::string& root,
             const std::string& theme,
             const std::string& file,
             const std::string& contents) {
    const base::FilePath path =
        dir_.GetPath().Append(root).Append(theme).Append(file);
    ASSERT_TRUE(base::CreateDirectory(path.DirName()));
    ASSERT_TRUE(base::WriteFile(path, contents));
  }

  std::vector<base::FilePath> Path(const std::vector<std::string>& roots) {
    std::vector<base::FilePath> path;
    for (const std::string& root : roots) {
      path.push_back(dir_.GetPath().Append(root));
    }
    return path;
  }

  base::ScopedTempDir dir_;
};

// Each type is looked up by its freedesktop name, then its X11 ones.
TEST_F(XCursorThemeDirectoryTest, ATypeIsFoundByAnyOfItsNames) {
  Write("icons", "Bibata", "cursors/left_ptr",
        XCursorFile({{.nominal = 24, .width = 24, .height = 24}}));
  Write("icons", "Bibata", "cursors/xterm",
        XCursorFile({{.nominal = 24, .width = 24, .height = 24}}));

  const auto cursors = LoadXCursorTheme(Path({"icons"}), "Bibata", 24);

  EXPECT_TRUE(cursors.contains(CursorType::kPointer));
  EXPECT_TRUE(cursors.contains(CursorType::kIBeam));
  EXPECT_FALSE(cursors.contains(CursorType::kHand));
  EXPECT_FALSE(cursors.contains(CursorType::kNone));
}

// A theme that holds a few cursors names the one it borrows the rest from.
// The theme's own directory comes first, wherever the parent is.
TEST_F(XCursorThemeDirectoryTest, ACursorTheThemeLacksComesFromItsParent) {
  Write("home", "Amber", "index.theme",
        "[Icon Theme]\nName=Amber\nInherits=Base\n");
  Write("home", "Amber", "cursors/left_ptr",
        XCursorFile(
            {{.nominal = 24, .width = 24, .height = 24, .argb = 0xff00ff00}}));
  Write("system", "Base", "cursors/left_ptr",
        XCursorFile(
            {{.nominal = 24, .width = 24, .height = 24, .argb = 0xff0000ff}}));
  Write("system", "Base", "cursors/text",
        XCursorFile({{.nominal = 24, .width = 24, .height = 24}}));

  const auto cursors =
      LoadXCursorTheme(Path({"home", "system"}), "Amber", 24);

  ASSERT_TRUE(cursors.contains(CursorType::kPointer));
  EXPECT_EQ(cursors.at(CursorType::kPointer).frames[0].getColor(0, 0),
            SK_ColorGREEN);
  EXPECT_TRUE(cursors.contains(CursorType::kIBeam));
}

TEST_F(XCursorThemeDirectoryTest, ThemesThatInheritEachOtherStillLoad) {
  Write("icons", "A", "index.theme", "[Icon Theme]\nInherits=B\n");
  Write("icons", "B", "index.theme", "[Icon Theme]\nInherits=A\n");
  Write("icons", "B", "cursors/left_ptr",
        XCursorFile({{.nominal = 24, .width = 24, .height = 24}}));

  const auto cursors = LoadXCursorTheme(Path({"icons"}), "A", 24);

  EXPECT_TRUE(cursors.contains(CursorType::kPointer));
  EXPECT_FALSE(cursors.contains(CursorType::kIBeam));
}

TEST_F(XCursorThemeDirectoryTest, AThemeThatIsNotInstalledHasNoCursors) {
  EXPECT_TRUE(LoadXCursorTheme(Path({"icons"}), "Missing", 24).empty());
}

}  // namespace
}  // namespace ui
