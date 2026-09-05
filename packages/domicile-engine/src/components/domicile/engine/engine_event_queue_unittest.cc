// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "components/domicile/engine/engine_event_queue.h"

#include <poll.h>

#include <vector>

#include "base/threading/simple_thread.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

// Whether a caller that put fd() in its own poll loop would be woken right now.
bool Readable(int fd) {
  pollfd descriptor = {.fd = fd, .events = POLLIN, .revents = 0};
  return poll(&descriptor, 1, /*timeout=*/0) == 1;
}

TEST(EngineEventQueueTest, AnIdleQueueDoesNotWakeThePollingThread) {
  EngineEventQueue queue;

  ASSERT_GE(queue.fd(), 0);
  EXPECT_FALSE(Readable(queue.fd()));
  EXPECT_TRUE(queue.Drain().empty());
}

TEST(EngineEventQueueTest, PushingWakesThePollingThreadAndCarriesTheEvent) {
  EngineEventQueue queue;

  queue.Push({.type = EngineEvent::Type::kConfigure,
              .surface = 7,
              .width = 180,
              .height = 130});

  EXPECT_TRUE(Readable(queue.fd()));
  const std::vector<EngineEvent> drained = queue.Drain();
  ASSERT_EQ(drained.size(), 1u);
  EXPECT_EQ(drained[0].type, EngineEvent::Type::kConfigure);
  EXPECT_EQ(drained[0].surface, 7u);
  EXPECT_EQ(drained[0].width, 180u);
  EXPECT_EQ(drained[0].height, 130u);
}

// The compositor dispatches once per wakeup, so a burst has to arrive whole
// rather than one per poll — otherwise a frame callback sits in the queue until
// something unrelated wakes the loop again.
TEST(EngineEventQueueTest, DrainTakesEverythingQueuedAndThenSleeps) {
  EngineEventQueue queue;

  queue.Push({.type = EngineEvent::Type::kFrame, .surface = 1});
  queue.Push({.type = EngineEvent::Type::kReleased, .surface = 1, .buffer = 9});
  queue.Push({.type = EngineEvent::Type::kFrame, .surface = 2});

  EXPECT_EQ(queue.Drain().size(), 3u);
  EXPECT_FALSE(Readable(queue.fd()));
  EXPECT_TRUE(queue.Drain().empty());
}

// A drain that races a push must not swallow it: the compositor would wait for
// a wakeup that had already been spent.
TEST(EngineEventQueueTest, AnEventPushedAfterADrainStillWakesThePoller) {
  EngineEventQueue queue;

  queue.Push({.type = EngineEvent::Type::kFrame, .surface = 1});
  EXPECT_EQ(queue.Drain().size(), 1u);

  queue.Push({.type = EngineEvent::Type::kFrame, .surface = 2});

  EXPECT_TRUE(Readable(queue.fd()));
  ASSERT_EQ(queue.Drain().size(), 1u);
}

// Pushes come off mojo's thread and drains off the compositor's; nothing in
// between is allowed to lose one.
class Pusher : public base::DelegateSimpleThread::Delegate {
 public:
  Pusher(EngineEventQueue* queue, int count) : queue_(queue), count_(count) {}

  void Run() override {
    for (int i = 0; i < count_; ++i) {
      queue_->Push({.type = EngineEvent::Type::kFrame,
                    .surface = static_cast<uint32_t>(i)});
    }
  }

 private:
  const raw_ptr<EngineEventQueue> queue_;
  const int count_;
};

TEST(EngineEventQueueTest, EveryEventPushedFromAnotherThreadArrives) {
  constexpr int kEvents = 500;
  EngineEventQueue queue;
  Pusher pusher(&queue, kEvents);
  base::DelegateSimpleThread thread(&pusher, "pusher");

  thread.Start();
  std::vector<EngineEvent> seen;
  while (static_cast<int>(seen.size()) < kEvents) {
    for (const EngineEvent& event : queue.Drain()) {
      seen.push_back(event);
    }
  }
  thread.Join();

  ASSERT_EQ(seen.size(), static_cast<size_t>(kEvents));
  for (int i = 0; i < kEvents; ++i) {
    EXPECT_EQ(seen[i].surface, static_cast<uint32_t>(i)) << "at " << i;
  }
}

}  // namespace
}  // namespace domicile
