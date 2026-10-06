// Copyright 2026 Connor Prussin
// SPDX-License-Identifier: MIT

#include "ui/ozone/platform/drm/domicile/drm_master.h"

#include <errno.h>
#include <fcntl.h>

#include <algorithm>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace ui {
namespace {

// `DrmMaster` closes the descriptors it holds, so tests need real ones. Each
// open of /dev/null gets a distinct number, which lets a test check which card
// a call reached.
base::ScopedFD OpenScratchFd() {
  base::ScopedFD fd(open("/dev/null", O_RDONLY | O_CLOEXEC));
  CHECK(fd.is_valid());
  return fd;
}

// Fakes `drmSetMaster` or `drmDropMaster`: records each descriptor in order
// and fails the ones passed to `Refuse`.
class RecordedCall {
 public:
  DrmMasterCall Bind() {
    return base::BindRepeating(&RecordedCall::Run, base::Unretained(this));
  }

  void Refuse(int fd) { refused_.push_back(fd); }

  const std::vector<int>& calls() const { return calls_; }

 private:
  int Run(int fd) {
    calls_.push_back(fd);
    return std::find(refused_.begin(), refused_.end(), fd) == refused_.end()
               ? 0
               : -EACCES;
  }

  std::vector<int> calls_;
  std::vector<int> refused_;
};

// Sysfs paths, which `DrmDisplayHostManager` keys devices by and `Forget`
// receives.
constexpr char kCard0[] = "/sys/class/drm/card0";
constexpr char kCard1[] = "/sys/class/drm/card1";
constexpr char kCard2[] = "/sys/class/drm/card2";

TEST(DrmMasterTest, DropsMasterOnEveryCardItHolds) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  const int first_fd = first.get();
  const int second_fd = second.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));

  EXPECT_TRUE(master.Drop());
  // The drops go through the browser's descriptors, which share the GPU
  // process's `struct drm_file`.
  EXPECT_EQ(drop.calls(), std::vector<int>({first_fd, second_fd}));
  // Only the takes from `Add`.
  EXPECT_EQ(set.calls(), std::vector<int>({first_fd, second_fd}));
}

TEST(DrmMasterTest, TakesMasterBackOnEveryCardItHolds) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  const int first_fd = first.get();
  const int second_fd = second.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));

  EXPECT_TRUE(master.Take());
  // One take per `Add`, then one per card from `Take`.
  EXPECT_EQ(set.calls(),
            std::vector<int>({first_fd, second_fd, first_fd, second_fd}));
  EXPECT_TRUE(drop.calls().empty());
}

TEST(DrmMasterTest, ACardIsMasteredAsItArrives) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD arrived = OpenScratchFd();
  const int arrived_fd = arrived.get();
  master.Add(base::FilePath(kCard0), std::move(arrived));

  // The browser's `open` takes master only if the card had none, and nothing
  // else takes it at startup. Without this the first commit fails with EACCES.
  EXPECT_EQ(set.calls(), std::vector<int>({arrived_fd}));
  EXPECT_TRUE(drop.calls().empty());
}

TEST(DrmMasterTest, ACardThatArrivesOnSomebodyElsesConsoleIsNotMastered) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD held = OpenScratchFd();
  const int held_fd = held.get();
  master.Add(base::FilePath(kCard0), std::move(held));
  ASSERT_TRUE(master.Drop());

  base::ScopedFD arrived = OpenScratchFd();
  const int arrived_fd = arrived.get();
  master.Add(base::FilePath(kCard1), std::move(arrived));

  // A card added while another console is active must not be taken.
  EXPECT_EQ(set.calls(), std::vector<int>({held_fd}));

  // Switching back takes it along with the others.
  EXPECT_TRUE(master.Take());
  EXPECT_EQ(set.calls(), std::vector<int>({held_fd, held_fd, arrived_fd}));
}

TEST(DrmMasterTest, ACardThatRefusesFailsTheDropAndTheRestAreStillAsked) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  base::ScopedFD third = OpenScratchFd();
  const int first_fd = first.get();
  const int second_fd = second.get();
  const int third_fd = third.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));
  master.Add(base::FilePath(kCard2), std::move(third));
  drop.Refuse(second_fd);

  EXPECT_FALSE(master.Drop());
  // Stopping at the failure would leave the cards in different states.
  EXPECT_EQ(drop.calls(), std::vector<int>({first_fd, second_fd, third_fd}));
}

TEST(DrmMasterTest, ACardThatWentAwayIsNotTouched) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  const int first_fd = first.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));
  master.Forget(base::FilePath(kCard1));

  EXPECT_TRUE(master.Drop());
  EXPECT_EQ(drop.calls(), std::vector<int>({first_fd}));
}

TEST(DrmMasterTest, ADeadGpuProcessCardsAreLetGoOf) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  base::ScopedFD first = OpenScratchFd();
  base::ScopedFD second = OpenScratchFd();
  const int first_fd = first.get();
  const int second_fd = second.get();
  master.Add(base::FilePath(kCard0), std::move(first));
  master.Add(base::FilePath(kCard1), std::move(second));

  master.ForgetEvery();

  // The descriptors must be closed. While one is open, the new GPU process's
  // `open` of that card cannot get master.
  EXPECT_EQ(fcntl(first_fd, F_GETFD), -1);
  EXPECT_EQ(fcntl(second_fd, F_GETFD), -1);
  EXPECT_FALSE(master.Drop());
  EXPECT_TRUE(drop.calls().empty());
}

TEST(DrmMasterTest, ADropWithNothingHeldIsARefusal) {
  RecordedCall set;
  RecordedCall drop;
  DrmMaster master(set.Bind(), drop.Bind());

  // The primary card is always added before the GPU process starts, so an
  // empty set means a card was missed. Reporting success would tell the VT
  // switcher a display was released while it is still scanning out.
  EXPECT_FALSE(master.Drop());
  EXPECT_TRUE(drop.calls().empty());
}

}  // namespace
}  // namespace ui
