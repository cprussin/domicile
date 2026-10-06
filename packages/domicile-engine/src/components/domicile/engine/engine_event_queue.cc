// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/engine_event_queue.h"

#include <sys/eventfd.h>
#include <unistd.h>

#include <utility>

#include "base/logging.h"
#include "base/posix/eintr_wrapper.h"

namespace domicile {
namespace {

// Non-blocking so a drain of an empty queue does not block the compositor's
// thread.
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
  // Write outside the lock: the woken reader takes the same lock to drain.
  const uint64_t one = 1;
  if (HANDLE_EINTR(write(fd_, &one, sizeof(one))) != sizeof(one)) {
    // The event is still queued; the next successful write wakes the reader.
    PLOG(ERROR) << "domicile: could not signal the event fd";
  }
}

std::vector<EngineEvent> EngineEventQueue::Drain() {
  if (fd_ >= 0) {
    // Read before taking the queue. In the other order, a push between the
    // two would have its wakeup cleared while its event stays queued.
    uint64_t count = 0;
    if (HANDLE_EINTR(read(fd_, &count, sizeof(count))) != sizeof(count)) {
      // EAGAIN is normal when nothing was queued.
    }
  }
  base::AutoLock locked(lock_);
  return std::exchange(events_, {});
}

}  // namespace domicile
