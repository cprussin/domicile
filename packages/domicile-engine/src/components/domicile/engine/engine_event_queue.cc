// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/engine/engine_event_queue.h"

#include <sys/eventfd.h>
#include <unistd.h>

#include <utility>

#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"

namespace domicile {
namespace {

// Semaphore semantics rather than a counter: one read clears it, which is what
// "drain everything and go back to sleep" wants. Non-blocking so that a drain
// racing an empty queue returns instead of parking the compositor's thread.
int CreateEventFd() {
  const int fd = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
  if (fd < 0) {
    PLOG(ERROR) << "domicile: eventfd";
  }
  return fd;
}

}  // namespace

EngineEventQueue::EngineEventQueue() : fd_(CreateEventFd()) {}

EngineEventQueue::~EngineEventQueue() {
  if (fd_ >= 0) {
    close(fd_);
  }
}

void EngineEventQueue::Push(const EngineEvent& event) {
  {
    base::AutoLock locked(lock_);
    events_.push_back(event);
  }
  if (fd_ < 0) {
    return;
  }
  // The write happens outside the lock: the reader may wake the moment this
  // lands, and it takes the same lock to drain.
  const uint64_t one = 1;
  if (HANDLE_EINTR(write(fd_, &one, sizeof(one))) != sizeof(one)) {
    // EAGAIN means the counter is saturated at UINT64_MAX-1, which needs 2^64
    // undrained events and cannot happen; anything else is a broken fd. Either
    // way the event is queued and the next successful write wakes the reader
    // for both.
    PLOG(ERROR) << "domicile: could not signal the event fd";
  }
}

std::vector<EngineEvent> EngineEventQueue::Drain() {
  if (fd_ >= 0) {
    // Read first, then take the queue. The other order would drop an event
    // pushed between the two: the push would land in a vector already emptied,
    // and its wakeup would be cleared by a read that came after it.
    uint64_t count = 0;
    if (HANDLE_EINTR(read(fd_, &count, sizeof(count))) != sizeof(count)) {
      // EAGAIN is the ordinary case for a caller that polls and finds nothing.
    }
  }
  base::AutoLock locked(lock_);
  return std::exchange(events_, {});
}

}  // namespace domicile
