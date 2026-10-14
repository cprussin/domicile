// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/base/cursor/domicile/desk_cursor_theme.h"

#include <optional>

#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

class CountingObserver : public DeskCursorThemeSource::Observer {
 public:
  void OnDeskCursorThemeChanged() override { ++changes_; }

  int changes_ = 0;
};

TEST(DeskCursorThemeSourceTest, AChangeIsToldToEveryObserver) {
  DeskCursorThemeSource source;
  CountingObserver first;
  CountingObserver second;
  source.AddObserver(&first);
  source.AddObserver(&second);

  source.Set(DeskCursorTheme{.name = "Adwaita", .size = 32});

  EXPECT_EQ(source.theme(), (DeskCursorTheme{.name = "Adwaita", .size = 32}));
  EXPECT_EQ(first.changes_, 1);
  EXPECT_EQ(second.changes_, 1);

  source.RemoveObserver(&first);
  source.RemoveObserver(&second);
}

// The compositor sends `appearance` on every reload that changes any of it,
// and on every connect. Each change drops every loaded cursor.
TEST(DeskCursorThemeSourceTest, TheSameThemeAgainIsNoChange) {
  DeskCursorThemeSource source;
  CountingObserver observer;
  source.AddObserver(&observer);

  source.Set(DeskCursorTheme{.name = "Adwaita", .size = 32});
  source.Set(DeskCursorTheme{.name = "Adwaita", .size = 32});
  source.Set(DeskCursorTheme{.name = "Adwaita", .size = 48});
  source.Set(std::nullopt);
  source.Set(std::nullopt);

  EXPECT_EQ(source.theme(), std::nullopt);
  EXPECT_EQ(observer.changes_, 3);

  source.RemoveObserver(&observer);
}

}  // namespace
}  // namespace ui
