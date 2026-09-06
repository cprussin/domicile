// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_
#define COMPONENTS_DOMICILE_ENGINE_ENGINE_EVENT_QUEUE_H_

#include <cstdint>
#include <vector>

#include "base/synchronization/lock.h"
#include "base/thread_annotations.h"

namespace domicile {

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
