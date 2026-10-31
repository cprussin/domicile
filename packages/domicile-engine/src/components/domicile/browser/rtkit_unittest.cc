// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/browser/rtkit.h"

#include <cstdint>
#include <memory>

#include "dbus/message.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

TEST(RtkitTest, TheRaiseNamesTheProcessTheThreadAndTheNiceValue) {
  std::unique_ptr<dbus::MethodCall> raise =
      RtkitRaise(4321, base::PlatformThreadId::ForTest(4325), -8);

  EXPECT_EQ(raise->GetInterface(), "org.freedesktop.RealtimeKit1");
  EXPECT_EQ(raise->GetMember(), "MakeThreadHighPriorityWithPID");
  dbus::MessageReader reader(raise.get());
  uint64_t process_id = 0;
  uint64_t thread_id = 0;
  int32_t nice = 0;
  ASSERT_TRUE(reader.PopUint64(&process_id));
  ASSERT_TRUE(reader.PopUint64(&thread_id));
  ASSERT_TRUE(reader.PopInt32(&nice));
  EXPECT_FALSE(reader.HasMoreData());
  EXPECT_EQ(process_id, 4321u);
  EXPECT_EQ(thread_id, 4325u);
  EXPECT_EQ(nice, -8);
}

}  // namespace
}  // namespace domicile
