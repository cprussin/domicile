// Copyright 2026 Tom Mecattaf
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_input_opens.h"

#include <fcntl.h>
#include <unistd.h>

#include <map>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/test/mock_log.h"
#include "testing/gmock/include/gmock/gmock.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

class DrmInputOpensTest : public testing::Test {
 protected:
  struct PendingTake {
    DeviceNumber number;
    TakeAnswer answer;
  };
  struct PendingRelease {
    DeviceNumber number;
    ReleaseAnswer answer;
  };

  void Open(int id, DeviceNumber number = {13, 64}) {
    current_[id] = true;
    opens_.Open(
        number, id,
        base::FilePath("/dev/input/event" + std::to_string(number.minor)),
        base::BindRepeating([](const bool* current) { return *current; },
                            &current_[id]),
        base::BindOnce(
            [](std::map<int, base::ScopedFD>* results, int id,
               base::ScopedFD fd) {
              CHECK(results->try_emplace(id, std::move(fd)).second);
            },
            &results_, id));
  }

  int AnswerTake(size_t index, bool inactive = false) {
    base::ScopedFD fd(open("/dev/zero", O_RDONLY | O_CLOEXEC));
    CHECK(fd.is_valid());
    const int descriptor = fd.get();
    std::move(takes_[index].answer).Run(TakenDevice(std::move(fd), inactive));
    return descriptor;
  }

  void Take(DeviceNumber number, TakeAnswer answer) {
    takes_.push_back({number, std::move(answer)});
  }

  void Release(DeviceNumber number, ReleaseAnswer answer) {
    releases_.push_back({number, std::move(answer)});
  }

  void ReadActive(base::OnceCallback<void(bool)> answer) {
    active_.push_back(std::move(answer));
  }

  std::vector<PendingTake> takes_;
  std::vector<PendingRelease> releases_;
  std::vector<base::OnceCallback<void(bool)>> active_;
  std::map<int, bool> current_;
  std::map<int, base::ScopedFD> results_;
  std::vector<int> reopened_;
  DrmTakenDevices devices_{
      base::BindRepeating(&DrmInputOpensTest::Release, base::Unretained(this)),
      base::BindRepeating(
          [](std::vector<int>* reopened, int id, const base::FilePath&) {
            reopened->push_back(id);
          },
          &reopened_)};
  DrmInputOpens opens_{
      devices_,
      base::BindRepeating(&DrmInputOpensTest::Take, base::Unretained(this)),
      base::BindRepeating(&DrmInputOpensTest::ReadActive,
                          base::Unretained(this))};
};

TEST_F(DrmInputOpensTest, RemovedLiveReplyClosesAndReleasesBeforeCompleting) {
  Open(1);
  current_[1] = false;
  const int descriptor = AnswerTake(0);

  EXPECT_EQ(fcntl(descriptor, F_GETFD), -1);
  EXPECT_TRUE(results_.empty());
  ASSERT_EQ(releases_.size(), 1u);
  EXPECT_EQ(releases_[0].number, (DeviceNumber{13, 64}));
  EXPECT_FALSE(opens_.CanResume({13, 64}));
  EXPECT_EQ(devices_.Reclaim(), 0u);
  EXPECT_TRUE(reopened_.empty());
  std::move(releases_[0].answer).Run(true);
  ASSERT_TRUE(results_.contains(1));
  EXPECT_FALSE(results_[1].is_valid());
}

TEST_F(DrmInputOpensTest, ReplacementWaitsForOldClaimReleaseCompletion) {
  Open(1);
  current_[1] = false;
  Open(2);
  ASSERT_EQ(takes_.size(), 1u);
  AnswerTake(0);
  ASSERT_EQ(releases_.size(), 1u);
  EXPECT_EQ(takes_.size(), 1u);
  EXPECT_FALSE(opens_.CanResume({13, 64}));
  std::move(releases_[0].answer).Run(true);
  ASSERT_EQ(takes_.size(), 2u);
  EXPECT_FALSE(results_[1].is_valid());
  AnswerTake(1);
  ASSERT_TRUE(results_.contains(2));
  EXPECT_TRUE(results_[2].is_valid());
  EXPECT_TRUE(opens_.CanResume({13, 64}));
}

TEST_F(DrmInputOpensTest, DifferentDeviceNumbersOpenIndependently) {
  Open(1, {13, 64});
  Open(2, {13, 65});
  ASSERT_EQ(takes_.size(), 2u);
  EXPECT_EQ(takes_[0].number, (DeviceNumber{13, 64}));
  EXPECT_EQ(takes_[1].number, (DeviceNumber{13, 65}));
}

TEST_F(DrmInputOpensTest, LateCleanupEchoKeepsTheReplacementClaim) {
  Open(1);
  current_[1] = false;
  Open(2);
  AnswerTake(0);
  ASSERT_EQ(releases_.size(), 1u);
  std::move(releases_[0].answer).Run(true);
  ASSERT_EQ(takes_.size(), 2u);
  AnswerTake(1);
  ASSERT_TRUE(results_.contains(2));
  ASSERT_TRUE(results_[2].is_valid());
  EXPECT_EQ(devices_.Pause({13, 64}, "gone"), PauseAnswer::kNothingToSay);
  ASSERT_TRUE(
      devices_.Resume({13, 64}, base::ScopedFD(open("/dev/zero", O_RDONLY))));
  EXPECT_EQ(reopened_, (std::vector<int>{2}));
}

TEST_F(DrmInputOpensTest, KeepsOnlyTheLatestQueuedRequest) {
  Open(1);
  current_[1] = false;
  Open(2);
  current_[2] = false;
  Open(3);
  ASSERT_EQ(takes_.size(), 1u);
  ASSERT_TRUE(results_.contains(2));
  EXPECT_FALSE(results_[2].is_valid());
  AnswerTake(0);
  ASSERT_EQ(releases_.size(), 1u);
  std::move(releases_[0].answer).Run(true);
  ASSERT_EQ(takes_.size(), 2u);
  AnswerTake(1);
  ASSERT_TRUE(results_.contains(3));
  EXPECT_TRUE(results_[3].is_valid());
}

TEST_F(DrmInputOpensTest, CanceledQueuedRequestNeverTakesADevice) {
  Open(1);
  current_[1] = false;
  Open(2);
  current_[2] = false;
  AnswerTake(0);
  ASSERT_EQ(releases_.size(), 1u);
  std::move(releases_[0].answer).Run(true);
  EXPECT_EQ(takes_.size(), 1u);
  ASSERT_TRUE(results_.contains(2));
  EXPECT_FALSE(results_[2].is_valid());
}

TEST_F(DrmInputOpensTest, RemovedRevokedReplyNeverChecksActiveOrReclaims) {
  Open(1);
  current_[1] = false;
  const int descriptor = AnswerTake(0, true);
  EXPECT_EQ(fcntl(descriptor, F_GETFD), -1);
  EXPECT_TRUE(active_.empty());
  EXPECT_EQ(devices_.Reclaim(), 0u);
  EXPECT_TRUE(reopened_.empty());
  ASSERT_EQ(releases_.size(), 1u);
  std::move(releases_[0].answer).Run(true);
  ASSERT_TRUE(results_.contains(1));
  EXPECT_FALSE(results_[1].is_valid());
}

TEST_F(DrmInputOpensTest, RemovalDuringActiveQueryPreventsRetryAndReclaim) {
  Open(1);
  AnswerTake(0, true);
  ASSERT_EQ(active_.size(), 1u);
  EXPECT_TRUE(results_.empty());
  current_[1] = false;
  std::move(active_[0]).Run(true);
  EXPECT_EQ(takes_.size(), 1u);
  EXPECT_EQ(devices_.Reclaim(), 0u);
  EXPECT_FALSE(opens_.CanResume({13, 64}));
  ASSERT_EQ(releases_.size(), 1u);
  std::move(releases_[0].answer).Run(true);
  ASSERT_TRUE(results_.contains(1));
  EXPECT_FALSE(results_[1].is_valid());
}

TEST_F(DrmInputOpensTest, CurrentInactiveDeviceRemainsEligibleForResume) {
  Open(1);
  AnswerTake(0, true);
  ASSERT_EQ(active_.size(), 1u);
  std::move(active_[0]).Run(false);
  ASSERT_TRUE(results_.contains(1));
  EXPECT_FALSE(results_[1].is_valid());
  EXPECT_TRUE(opens_.CanResume({13, 64}));
  EXPECT_EQ(devices_.Reclaim(), 1u);
  EXPECT_EQ(reopened_, (std::vector<int>{1}));
}

TEST_F(DrmInputOpensTest, FailedOldTakeStartsReplacementWithoutReleasing) {
  Open(1);
  current_[1] = false;
  Open(2);
  std::move(takes_[0].answer).Run(std::nullopt);
  ASSERT_EQ(takes_.size(), 2u);
  EXPECT_TRUE(releases_.empty());
  EXPECT_FALSE(results_[1].is_valid());
  AnswerTake(1);
  EXPECT_TRUE(results_[2].is_valid());
}

TEST_F(DrmInputOpensTest, ResumedDescriptorIsConsumedWithoutAnotherTake) {
  Open(1);
  AnswerTake(0);
  results_.erase(1);
  base::ScopedFD resumed(open("/dev/zero", O_RDONLY | O_CLOEXEC));
  CHECK(resumed.is_valid());
  const int descriptor = resumed.get();
  ASSERT_TRUE(devices_.Resume({13, 64}, std::move(resumed)));
  current_[1] = false;
  Open(2);
  EXPECT_EQ(takes_.size(), 1u);
  ASSERT_TRUE(results_.contains(2));
  EXPECT_EQ(results_[2].get(), descriptor);
  reopened_.clear();
  ASSERT_TRUE(
      devices_.Resume({13, 64}, base::ScopedFD(open("/dev/zero", O_RDONLY))));
  EXPECT_EQ(reopened_, (std::vector<int>{2}));
}

TEST_F(DrmInputOpensTest, CanceledReplacementForgetsPreviousResumeName) {
  Open(1);
  AnswerTake(0);
  current_[1] = false;
  Open(2);
  current_[2] = false;
  AnswerTake(1);
  ASSERT_EQ(releases_.size(), 2u);
  // The first release belongs to the completed device, before its replacement.
  std::move(releases_[0].answer).Run(true);
  std::move(releases_[1].answer).Run(true);
  EXPECT_EQ(devices_.Pause({13, 64}, "gone"), PauseAnswer::kNothingToSay);
  base::test::MockLog log;
  EXPECT_CALL(log, Log(logging::LOGGING_ERROR, testing::_, testing::_,
                       testing::_, testing::HasSubstr("never took")))
      .Times(1);
  log.StartCapturingLogs();
  EXPECT_FALSE(
      devices_.Resume({13, 64}, base::ScopedFD(open("/dev/zero", O_RDONLY))));
  log.StopCapturingLogs();
  EXPECT_TRUE(reopened_.empty());
}

TEST_F(DrmInputOpensTest, CleanupRefusalFailsQueuedRequestsWithoutNewTake) {
  Open(1);
  current_[1] = false;
  Open(2);
  AnswerTake(0);
  ASSERT_EQ(releases_.size(), 1u);
  base::test::MockLog log;
  EXPECT_CALL(log, Log(logging::LOGGING_ERROR, testing::_, testing::_,
                       testing::_, testing::HasSubstr("refused to take back")))
      .Times(1);
  log.StartCapturingLogs();
  std::move(releases_[0].answer).Run(false);
  log.StopCapturingLogs();
  EXPECT_EQ(takes_.size(), 1u);
  ASSERT_TRUE(results_.contains(1));
  ASSERT_TRUE(results_.contains(2));
  EXPECT_FALSE(results_[1].is_valid());
  EXPECT_FALSE(results_[2].is_valid());
  EXPECT_FALSE(opens_.CanResume({13, 64}));
}

TEST_F(DrmInputOpensTest, CurrentRevokedReplyRetriesOnceWhenSessionIsActive) {
  Open(1);
  AnswerTake(0, true);
  ASSERT_EQ(active_.size(), 1u);
  base::test::MockLog log;
  EXPECT_CALL(log, Log(logging::LOGGING_ERROR, testing::_, testing::_,
                       testing::_, testing::HasSubstr("revoked while")))
      .Times(1);
  log.StartCapturingLogs();
  std::move(active_[0]).Run(true);
  log.StopCapturingLogs();
  ASSERT_EQ(takes_.size(), 2u);
  EXPECT_EQ(releases_.size(), 1u);
  EXPECT_TRUE(results_.empty());
  AnswerTake(1);
  ASSERT_TRUE(results_.contains(1));
  EXPECT_TRUE(results_[1].is_valid());
}

TEST_F(DrmInputOpensTest, RepeatedRevokedReplyStopsRetrying) {
  Open(1);
  AnswerTake(0, true);
  ASSERT_EQ(active_.size(), 1u);
  base::test::MockLog log;
  EXPECT_CALL(log,
              Log(logging::LOGGING_VERBOSE,
                  testing::HasSubstr("drm_input_devices.cc"), testing::_,
                  testing::_, testing::HasSubstr("took input device 13:64")))
      .Times(testing::AtMost(1));
  EXPECT_CALL(log, Log(logging::LOGGING_ERROR, testing::_, testing::_,
                       testing::_, testing::HasSubstr("revoked while")))
      .Times(1);
  EXPECT_CALL(log, Log(logging::LOGGING_ERROR, testing::_, testing::_,
                       testing::_, testing::HasSubstr("kept handing")))
      .Times(1);
  log.StartCapturingLogs();
  std::move(active_[0]).Run(true);
  AnswerTake(1, true);
  log.StopCapturingLogs();
  EXPECT_EQ(takes_.size(), 2u);
  EXPECT_EQ(active_.size(), 1u);
  ASSERT_TRUE(results_.contains(1));
  EXPECT_FALSE(results_[1].is_valid());
  EXPECT_TRUE(opens_.CanResume({13, 64}));
}

TEST_F(DrmInputOpensTest, CurrentRefusalIsReportedAndCompletesInvalid) {
  Open(1);
  base::test::MockLog log;
  EXPECT_CALL(log, Log(logging::LOGGING_ERROR, testing::_, testing::_,
                       testing::_, testing::HasSubstr("refused device")))
      .Times(1);
  log.StartCapturingLogs();
  std::move(takes_[0].answer).Run(std::nullopt);
  log.StopCapturingLogs();
  ASSERT_TRUE(results_.contains(1));
  EXPECT_FALSE(results_[1].is_valid());
  EXPECT_TRUE(releases_.empty());
  EXPECT_FALSE(opens_.CanResume({13, 64}));
}

TEST_F(DrmInputOpensTest, LiveDescriptorUsesNonblockingReads) {
  Open(1);
  AnswerTake(0);
  ASSERT_TRUE(results_.contains(1));
  ASSERT_TRUE(results_[1].is_valid());
  EXPECT_NE(fcntl(results_[1].get(), F_GETFL) & O_NONBLOCK, 0);
}

}  // namespace
}  // namespace ui
