// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_
#define COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_

#include <cstdint>
#include <string>
#include <vector>

#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"

namespace domicile {

// One display the browser is scanning out on, as the C ABI carries it.
//
// Flat scalars because an array of these crosses to a caller that has no
// tuples, and `int32_t` throughout because a mode is measured the way a
// position is. Mirrors DomicileDisplay in domicile_engine.h -- except for
// `name`, which is a std::string here and a borrowed `const char*` there: the
// queue owns the characters, and what crosses the ABI points at them.
struct EngineDisplay {
  int64_t id = 0;
  // "<MAKE> <MODEL> <SERIAL>" off the panel's EDID, or empty for a monitor
  // that states none of the three. The id is identity; this is what a person
  // can write down. See the mojom this is filled in from.
  std::string name;
  int32_t x = 0;
  int32_t y = 0;
  int32_t width = 0;
  int32_t height = 0;
  // The panel, in millimeters, and the rate it is running at in mHz. Zero for
  // a display that reports neither, which is what wl_output states for one --
  // see the mojom this is filled in from.
  int32_t physical_width_mm = 0;
  int32_t physical_height_mm = 0;
  int32_t refresh_mhz = 0;
};

// What the library has to tell domicile-compositor, and the fd it says it on.
//
// libdomicile_engine.so must not own the compositor's thread: the compositor
// runs a calloop and mojo wants a task runner of its own, so the library keeps
// mojo on a thread of its own and hands the compositor something to poll. This
// is that seam — mojo's thread pushes, the compositor's thread drains, and an
// eventfd in between is what makes the compositor's poll wake up.
//
// The shape is wl_display_get_fd and wl_display_dispatch, which is the loop the
// compositor already runs. See docs/architecture/ENGINE-FORK.md in the Domicile
// repository, "The seam: a C ABI, and what crosses it".
struct EngineEvent {
  enum class Type {
    // xdg_toplevel.configure: the page's layout box changed, so the producer
    // renders at the new size.
    kConfigure,
    // wl_surface.frame: viz asked for a frame.
    kFrame,
    // wl_buffer.release: viz is done sampling a buffer, so the client may
    // draw into it again. Without this the compositor would reuse a dmabuf viz
    // is still reading, which is a tear rather than an error.
    kReleased,
    // wl_output: the whole display list, primary first. On a tty the browser
    // is the process holding DRM master, so this is the compositor's only
    // reading of what its screens are.
    kDisplays,
    // A copy made in a page or a browser window. The browser is not a Wayland
    // client of the compositor, so this is the only way one reaches a seat --
    // see ui/ozone/platform/drm/domicile/drm_clipboard.h.
    kCopied,
  };

  Type type = Type::kFrame;
  uint32_t surface = 0;
  // kConfigure.
  uint32_t width = 0;
  uint32_t height = 0;
  // kFrame.
  uint64_t deadline_us = 0;
  // kReleased.
  uint64_t buffer = 0;
  // kDisplays. Never empty: an empty list is a screen nobody has read yet
  // rather than a desktop with no displays, and the browser does not send one.
  std::vector<EngineDisplay> displays;
  // kCopied: which of the two clipboards, as DomicileClipboard numbers them,
  // and the bytes that were copied. Empty text is a clipboard with nothing on
  // it, which is what copying something that is not text leaves behind.
  uint32_t clipboard = 0;
  std::string copied;
};

// Thread-safe, and deliberately only just: one writer thread (mojo's) and one
// reader thread (the compositor's) is the whole of the concurrency here.
class EngineEventQueue {
 public:
  EngineEventQueue();

  EngineEventQueue(const EngineEventQueue&) = delete;
  EngineEventQueue& operator=(const EngineEventQueue&) = delete;

  ~EngineEventQueue();

  // The fd to poll. Readable exactly when Drain would return something, so a
  // caller that adds it to its own loop is woken for every event and for
  // nothing else. -1 if the eventfd could not be created.
  int fd() const { return fd_; }

  // Called from mojo's thread. Wakes fd().
  void Push(const EngineEvent& event);

  // Called from the compositor's thread: takes everything queued and clears
  // the fd's readable state. Returns empty when there was nothing, which is
  // what a spurious wakeup looks like and is not an error.
  std::vector<EngineEvent> Drain();

 private:
  const int fd_;
  base::Lock lock_;
  std::vector<EngineEvent> events_ GUARDED_BY(lock_);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_
