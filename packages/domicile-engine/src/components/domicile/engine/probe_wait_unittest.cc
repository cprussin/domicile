// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "components/domicile/engine/probe_wait.h"

#include "base/location.h"
#include "base/run_loop.h"
#include "base/task/sequenced_task_runner.h"
#include "base/test/task_environment.h"
#include "base/time/time.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace domicile {
namespace {

constexpr base::TimeDelta kPatience = base::Seconds(30);

class ProbeWaitTest : public testing::Test {
 protected:
  base::test::SingleThreadTaskEnvironment task_environment_{
      base::test::TaskEnvironment::TimeSource::MOCK_TIME};
};

TEST_F(ProbeWaitTest, AnAnswerEndsTheWait) {
  base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
  base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE, loop.QuitClosure(), kPatience / 2);
  const base::TimeTicks started = base::TimeTicks::Now();

  EXPECT_TRUE(RunUntilQuit(loop, kPatience));
  EXPECT_EQ(base::TimeTicks::Now() - started, kPatience / 2);
}

// A capture viz never serves would otherwise hold the producer forever.
TEST_F(ProbeWaitTest, NoAnswerEndsTheWaitAfterThePatience) {
  base::RunLoop loop(base::RunLoop::Type::kNestableTasksAllowed);
  const base::TimeTicks started = base::TimeTicks::Now();

  EXPECT_FALSE(RunUntilQuit(loop, kPatience));
  EXPECT_EQ(base::TimeTicks::Now() - started, kPatience);
}

TEST_F(ProbeWaitTest, TheReasonNamesTheRequestAndTheWait) {
  EXPECT_EQ(NeverAnswered("window capture", 12, kPatience),
            "domicile: the browser never answered window capture 12 after "
            "30s, so the producer stops here rather than wait forever");
}

}  // namespace
}  // namespace domicile
