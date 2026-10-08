// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#ifndef COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_
#define COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "base/files/scoped_file.h"
#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"

namespace domicile {

// One display the browser scans out to.
//
// Mirrors DomicileDisplay in domicile_engine.h, except `name`: the queue owns
// the string, and the C ABI borrows a `const char*` into it.
struct EngineDisplay {
  int64_t id = 0;
  // "<MAKE> <MODEL> <SERIAL>" from the EDID, or empty if it has none. A
  // human-readable label; `id` is the identity.
  std::string name;
  int32_t x = 0;
  int32_t y = 0;
  int32_t width = 0;
  int32_t height = 0;
  // Physical size and refresh rate. Zero when the display does not report
  // them, as in wl_output.
  int32_t physical_width_mm = 0;
  int32_t physical_height_mm = 0;
  int32_t refresh_mhz = 0;
};

// One frame of a display capture.
//
// Mirrors DomicileCapturedFrame in domicile_engine.h, except the fds: the
// event owns them, and the C ABI lends them for the callback.
struct EngineCapturedFrame {
  // DOMICILE_CAPTURE_DMABUF or DOMICILE_CAPTURE_SHM.
  uint32_t memory = 0;
  uint32_t width = 0;
  uint32_t height = 0;
  uint32_t fourcc = 0;
  uint64_t modifier = 0;
  struct Plane {
    uint32_t offset = 0;
    uint32_t stride = 0;
  };
  std::vector<Plane> planes;
  // One per plane. Shared so events stay copyable; the last copy closes them.
  std::shared_ptr<const std::vector<base::ScopedFD>> fds;
  int32_t content_x = 0;
  int32_t content_y = 0;
  int32_t content_width = 0;
  int32_t content_height = 0;
  // Empty means the whole frame.
  int32_t damage_x = 0;
  int32_t damage_y = 0;
  int32_t damage_width = 0;
  int32_t damage_height = 0;
};

// An event the library sends to domicile-compositor.
//
// Mojo runs on its own thread and pushes events; the compositor's calloop
// polls an eventfd and drains them, like wl_display_get_fd and
// wl_display_dispatch. See docs/architecture/ENGINE-FORK.md#the-c-abi in the
// Domicile repository.
struct EngineEvent {
  enum class Type {
    // xdg_toplevel.configure: the page's layout box changed, so the producer
    // renders at the new size.
    kConfigure,
    // wl_surface.frame: viz asked for a frame.
    kFrame,
    // wl_buffer.release: viz is done sampling a buffer, so the client may
    // draw into it again. Reusing it earlier would tear.
    kReleased,
    // wl_output: the whole display list, primary first. On a tty the browser
    // holds DRM master, so this is the compositor's only source of displays.
    kDisplays,
    // A copy in a page or browser window. The browser is not a Wayland
    // client, so this is how its copies reach a seat. See
    // ui/ozone/platform/drm/domicile/drm_clipboard.h.
    kCopied,
    // A frame of a display capture, for a screen cast.
    kCaptured,
    // The browser ended a display capture; no frame follows.
    kCaptureEnded,
  };

  Type type = Type::kFrame;
  uint32_t surface = 0;
  // kConfigure.
  uint32_t width = 0;
  uint32_t height = 0;
  // kConfigure: device pixels per CSS pixel of the page the box is in.
  double scale = 1.0;
  // kConfigure: the box's number, which a submit names to be shown at it.
  uint64_t box = 0;
  // kFrame.
  uint64_t deadline_us = 0;
  // kReleased.
  uint64_t buffer = 0;
  // kDisplays. Never empty: the browser does not send an empty list.
  std::vector<EngineDisplay> displays;
  // kCopied: the DomicileClipboard and the copied text. Empty when the copy
  // was not text.
  uint32_t clipboard = 0;
  std::string copied;
  // kCaptured and kCaptureEnded: the DomicileCaptureId.
  uint32_t capture = 0;
  // kCaptured: the frame's id, which releases it, and the frame.
  uint64_t frame = 0;
  EngineCapturedFrame captured;
};

// Queue of engine events with a pollable fd.
//
// Supports one writer thread (mojo's) and one reader thread (the
// compositor's).
class EngineEventQueue {
 public:
  EngineEventQueue();

  EngineEventQueue(const EngineEventQueue&) = delete;
  EngineEventQueue& operator=(const EngineEventQueue&) = delete;

  ~EngineEventQueue();

  // The fd to poll; readable when Drain has events. -1 if the eventfd could
  // not be created.
  int fd() const { return fd_; }

  // Called from mojo's thread. Wakes fd().
  void Push(const EngineEvent& event);

  // Called from the compositor's thread: takes everything queued and clears
  // the fd. Returns empty on a spurious wakeup.
  std::vector<EngineEvent> Drain();

 private:
  const int fd_;
  base::Lock lock_;
  std::vector<EngineEvent> events_ GUARDED_BY(lock_);
};

}  // namespace domicile

#endif  // COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_
