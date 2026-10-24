// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef UI_BASE_CURSOR_DOMICILE_DESK_CURSOR_IMAGE_H_
#define UI_BASE_CURSOR_DOMICILE_DESK_CURSOR_IMAGE_H_

#include <stdint.h>

#include <optional>
#include <utility>
#include <vector>

#include "base/component_export.h"
#include "base/functional/callback.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/size.h"

class SkBitmap;

namespace ui {

// The pointer on screen, as the DRM platform draws it. Empty while the
// pointer is hidden.
struct COMPONENT_EXPORT(DESK_CURSOR_IMAGE) DeskCursorImage {
  DeskCursorImage();
  DeskCursorImage(const DeskCursorImage&);
  DeskCursorImage(DeskCursorImage&&);
  DeskCursorImage& operator=(const DeskCursorImage&);
  DeskCursorImage& operator=(DeskCursorImage&&);
  ~DeskCursorImage();

  bool operator==(const DeskCursorImage&) const = default;

  bool hidden() const { return size.IsEmpty(); }

  // In pixels.
  gfx::Size size;
  // From the top left, in pixels.
  gfx::Point hotspot;
  // Pixels per logical pixel.
  float scale = 1;
  // Premultiplied BGRA, rows top to bottom, `size.width() * 4` bytes each.
  std::vector<uint8_t> bgra;
};

// `bitmap` with its hotspot, at `scale` pixels per logical pixel. An empty
// bitmap is a hidden pointer.
COMPONENT_EXPORT(DESK_CURSOR_IMAGE)
DeskCursorImage DeskCursorImageOf(const SkBitmap& bitmap,
                                  const gfx::Point& hotspot,
                                  float scale);

// The pointer on screen, for the compositor's screen casts.
//
// The compositor draws a pointer into a cast but has no pointer of its own:
// this process draws it, from the desk's theme or a page's cursor. The DRM
// platform's `DrmCursor` sets the image here each time the pointer changes,
// and every control channel sends it to the compositor as `desk_cursor`.
//
// Set on the UI thread and listened for from the IO thread, hence the lock.
// Callers must wrap callbacks with `base::BindPostTask`: they run on the
// thread that set the image, and never under the lock.
class COMPONENT_EXPORT(DESK_CURSOR_IMAGE) DeskCursorImageSource {
 public:
  // Handle for removing a listener. Never zero.
  using ListenerId = uint64_t;
  using Changed = base::RepeatingCallback<void(const DeskCursorImage&)>;

  // The process's source. Tests build their own instead.
  static DeskCursorImageSource& Get();

  DeskCursorImageSource();
  DeskCursorImageSource(const DeskCursorImageSource&) = delete;
  DeskCursorImageSource& operator=(const DeskCursorImageSource&) = delete;
  ~DeskCursorImageSource();

  // The pointer now, or `std::nullopt` before the platform first set one.
  std::optional<DeskCursorImage> current();

  // Calls `changed` on each later change.
  ListenerId AddListener(Changed changed);
  void RemoveListener(ListenerId listener);

  // The pointer is now `image`. The image it already is tells nobody: each
  // monitor's window sets the same pointer.
  void Set(DeskCursorImage image);

  // Back to never set, for tests of the process's source.
  void ResetForTesting();

 private:
  base::Lock lock_;
  ListenerId next_id_ GUARDED_BY(lock_) = 1;
  std::vector<std::pair<ListenerId, Changed>> listeners_ GUARDED_BY(lock_);
  std::optional<DeskCursorImage> image_ GUARDED_BY(lock_);
};

}  // namespace ui

#endif  // UI_BASE_CURSOR_DOMICILE_DESK_CURSOR_IMAGE_H_
