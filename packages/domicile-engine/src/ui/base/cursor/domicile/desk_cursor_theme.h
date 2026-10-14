// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_BASE_CURSOR_DOMICILE_DESK_CURSOR_THEME_H_
#define UI_BASE_CURSOR_DOMICILE_DESK_CURSOR_THEME_H_

#include <optional>
#include <string>

#include "base/component_export.h"
#include "base/observer_list.h"
#include "base/observer_list_types.h"
#include "base/sequence_checker.h"

namespace ui {

// An XCursor theme at a size, from the desk config's `theme.cursor_theme` and
// `theme.cursor_size`.
struct DeskCursorTheme {
  bool operator==(const DeskCursorTheme&) const = default;

  // The theme's directory name, such as `Adwaita`.
  std::string name;
  // In logical pixels.
  int size = 0;
};

// The desk's pointer theme, for a platform that draws the pointer itself.
//
// The control channel sets the process's source from the compositor's
// `appearance` message, and `ui::DrmCursorFactory` loads its cursors from it.
// Unset leaves Chromium's own art. UI thread only.
class COMPONENT_EXPORT(DESK_CURSOR_THEME) DeskCursorThemeSource {
 public:
  class Observer : public base::CheckedObserver {
   public:
    virtual void OnDeskCursorThemeChanged() = 0;
  };

  // The process's source.
  static DeskCursorThemeSource& Get();

  DeskCursorThemeSource();

  DeskCursorThemeSource(const DeskCursorThemeSource&) = delete;
  DeskCursorThemeSource& operator=(const DeskCursorThemeSource&) = delete;

  ~DeskCursorThemeSource();

  const std::optional<DeskCursorTheme>& theme() const;

  // Logs the theme and tells every observer, unless `theme` is the one
  // already set.
  void Set(std::optional<DeskCursorTheme> theme);

  void AddObserver(Observer* observer);
  void RemoveObserver(Observer* observer);

 private:
  std::optional<DeskCursorTheme> theme_;
  base::ObserverList<Observer> observers_;
  SEQUENCE_CHECKER(sequence_checker_);
};

// Sets the process's source. The control channel's sink.
COMPONENT_EXPORT(DESK_CURSOR_THEME)
void SetDeskCursorTheme(std::optional<DeskCursorTheme> theme);

}  // namespace ui

#endif  // UI_BASE_CURSOR_DOMICILE_DESK_CURSOR_THEME_H_
