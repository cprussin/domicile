// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_cursor_factory.h"

#include <memory>
#include <optional>
#include <utility>

#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/numerics/safe_conversions.h"
#include "base/task/thread_pool.h"
#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/base/cursor/platform_cursor.h"

namespace ui {
namespace {

// The theme from the XCursor search path this process was started with.
base::flat_map<mojom::CursorType, XCursorImages> LoadFromDisk(
    const DeskCursorTheme& theme,
    int size) {
  const std::unique_ptr<base::Environment> env = base::Environment::Create();
  return LoadXCursorTheme(
      XCursorSearchPath({.xcursor_path = env->GetVar("XCURSOR_PATH"),
                         .xdg_data_home = env->GetVar("XDG_DATA_HOME"),
                         .xdg_data_dirs = env->GetVar("XDG_DATA_DIRS")},
                        base::GetHomeDir()),
      theme.name, size);
}

}  // namespace

DrmCursorFactory::DrmCursorFactory()
    : DrmCursorFactory(DeskCursorThemeSource::Get(),
                       base::BindRepeating(&LoadFromDisk)) {}

DrmCursorFactory::DrmCursorFactory(DeskCursorThemeSource& source,
                                   ThemeLoader load)
    : source_(source), load_(std::move(load)) {
  observation_.Observe(&source);
}

DrmCursorFactory::~DrmCursorFactory() = default;

scoped_refptr<PlatformCursor> DrmCursorFactory::GetDefaultCursor(
    mojom::CursorType type) {
  return GetDefaultCursor(type, 1.0f);
}

scoped_refptr<PlatformCursor> DrmCursorFactory::GetDefaultCursor(
    mojom::CursorType type,
    float scale) {
  // `kNone` has no art. `DrmCursor` hides the cursor based on its type, so
  // return the base's typed, bitmapless cursor.
  if (type == mojom::CursorType::kNone) {
    return BitmapCursorFactory::GetDefaultCursor(type);
  }

  // Null makes `CursorLoader` load the cursor from assets. A typed,
  // bitmapless cursor would draw nothing on a CRTC.
  const std::optional<DeskCursorTheme>& theme = source_->theme();
  if (!theme) {
    return nullptr;
  }

  const int size = base::ClampRound(theme->size * scale);
  const auto cursors = loaded_.find(size);
  if (cursors == loaded_.end()) {
    if (loading_.insert(size).second) {
      base::ThreadPool::PostTaskAndReplyWithResult(
          FROM_HERE,
          {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
           base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
          base::BindOnce(load_, *theme, size),
          base::BindOnce(&DrmCursorFactory::Loaded,
                         weak_factory_.GetWeakPtr(), *theme, size));
    }
    return nullptr;
  }

  const auto cursor = cursors->second.find(type);
  return cursor == cursors->second.end() ? nullptr : cursor->second;
}

void DrmCursorFactory::ObserveThemeChanges() {}

void DrmCursorFactory::OnDeskCursorThemeChanged() {
  loaded_.clear();
  loading_.clear();
  weak_factory_.InvalidateWeakPtrs();
  NotifyObserversOnThemeLoaded();
}

void DrmCursorFactory::Loaded(
    const DeskCursorTheme& theme,
    int size,
    base::flat_map<mojom::CursorType, XCursorImages> images) {
  loading_.erase(size);
  const float scale = static_cast<float>(size) / theme.size;
  base::flat_map<mojom::CursorType, scoped_refptr<PlatformCursor>>& cursors =
      loaded_[size];
  for (const auto& [type, cursor] : images) {
    cursors[type] =
        cursor.frames.size() == 1
            ? CreateImageCursor(type, cursor.frames[0], cursor.hotspot, scale)
            : CreateAnimatedCursor(type, cursor.frames, cursor.hotspot, scale,
                                   cursor.frame_delay);
  }

  // The lines to look for on hardware when the pointer did not change.
  if (cursors.empty()) {
    LOG(WARNING) << "domicile: no cursor theme \"" << theme.name
                 << "\" on the XCursor path (XCURSOR_PATH, or icons under "
                    "XDG_DATA_HOME and XDG_DATA_DIRS); the pointer is "
                    "Chromium's own";
  } else {
    LOG(INFO) << "domicile: loaded " << cursors.size() << " cursors from \""
              << theme.name << "\" at " << size << " px";
  }
  NotifyObserversOnThemeLoaded();
}

}  // namespace ui
